import { Duplex } from 'node:stream';
import { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import type { RiskScanner } from '../../buyer/src/intercepta.ts';
import { PRIVATE_RISK_CANDIDATES } from '../../../shared/private-risk.ts';
import { createPrivateRiskApp } from './app.ts';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

function journalPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'private-risk-app-'));
  temporaryDirectories.push(directory);
  return join(directory, 'journal.json');
}

async function inject(app: Express, method: string, url: string, body?: unknown, headers: Record<string, string | undefined> = {}) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({
    read() {},
    write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
  });
  const request = new IncomingMessage(socket as never);
  request.method = method;
  request.url = url;
  // No HTTP parser is present in this in-memory harness. Mark its supplied
  // request complete so IncomingMessage does not abort the fake socket at EOF.
  request.complete = true;
  const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
  request.headers = encoded
    ? { 'content-type': 'application/json', 'content-length': String(encoded.length), host: '127.0.0.1' }
    : { host: '127.0.0.1' };
  request.headers = { ...request.headers, ...headers };
  const response = new ServerResponse(request);
  response.assignSocket(socket as never);
  const finished = new Promise<void>((resolve, reject) => { response.once('finish', resolve); response.once('error', reject); });
  app(request, response);
  if (encoded) request.push(encoded);
  request.push(null);
  await finished;
  const raw = Buffer.concat(chunks).toString('utf8');
  const [head, payload = ''] = raw.split('\r\n\r\n');
  return { status: Number(/^HTTP\/1\.1 (\d+)/m.exec(head)?.[1]), json: JSON.parse(payload), headers: head };
}

function observed(address: string, network: string) {
  return {
    address,
    checkedAt: '2026-09-27T00:00:00.000Z',
    provider: 'intercepta' as const,
    source: 'live' as const,
    decision: 'hold' as const,
    reasons: ['Observed facts only.'],
    scan: { transport: 'received' as const, toxicScore: 1, traitsCount: 0, traitLabels: [], requestedNetwork: network, coverage: 'unverified' as const, semantics: 'unverified' as const },
  };
}

function app(path: string, scanner: RiskScanner, ready = true) {
  return createPrivateRiskApp({ journalPath: path, scanner, ready, message: ready ? 'ready' : 'disabled', html: '<!doctype html><title>private</title>' });
}

describe('private scan server (in-memory Express only)', () => {
  it('rejects disabled scanning before calling the scanner', async () => {
    const scanner = vi.fn<RiskScanner>();
    const response = await inject(app(journalPath(), scanner, false), 'POST', '/api/private-risk/scan', { candidateId: 'H1' });
    expect(response.status).toBe(503);
    expect(response.json).toMatchObject({ ready: false, usedRequests: 0, records: [] });
    expect(scanner).not.toHaveBeenCalled();
  });

  it('accepts only catalog candidate ids and never caller-controlled addresses or URLs', async () => {
    const scanner = vi.fn<RiskScanner>();
    const instance = app(journalPath(), scanner);
    for (const body of [{ candidateId: 'unknown' }, { candidateId: 'H1', address: PRIVATE_RISK_CANDIDATES[1].address }, { candidateId: 'H1', url: 'https://example.invalid' }]) {
      expect((await inject(instance, 'POST', '/api/private-risk/scan', body)).status).toBe(400);
    }
    expect(scanner).not.toHaveBeenCalled();
  });

  it('persists at most three consumed attempts and rejects a fourth before scanning', async () => {
    const scanner = vi.fn<RiskScanner>(async (address, network) => observed(address, network));
    const instance = app(journalPath(), scanner);
    for (const candidateId of ['H1', 'H2', 'G1']) expect((await inject(instance, 'POST', '/api/private-risk/scan', { candidateId })).status).toBe(200);
    const fourth = await inject(instance, 'POST', '/api/private-risk/scan', { candidateId: 'G2' });
    expect(fourth.status).toBe(429);
    expect(fourth.json).toMatchObject({ usedRequests: 3, records: [{ state: 'completed' }, { state: 'completed' }, { state: 'completed' }] });
    expect(scanner).toHaveBeenCalledTimes(3);
  });

  it('rejects a repeated candidate after an unavailable attempt without retrying', async () => {
    const scanner = vi.fn<RiskScanner>(async () => { throw new Error('secret exception'); });
    const path = journalPath();
    const instance = app(path, scanner);
    const first = await inject(instance, 'POST', '/api/private-risk/scan', { candidateId: 'H1' });
    expect(first.json.records[0]).toMatchObject({ candidateId: 'H1', state: 'unavailable', risk: null });
    expect(JSON.stringify(first.json)).not.toContain('secret exception');
    expect((await inject(instance, 'POST', '/api/private-risk/scan', { candidateId: 'H1' })).status).toBe(409);
    expect(scanner).toHaveBeenCalledTimes(1);
  });

  it('allows only one pending scan globally', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const scanner = vi.fn<RiskScanner>(async (address, network) => { await gate; return observed(address, network); });
    const instance = app(journalPath(), scanner);
    const first = inject(instance, 'POST', '/api/private-risk/scan', { candidateId: 'H1' });
    await vi.waitFor(() => expect(scanner).toHaveBeenCalledTimes(1));
    const second = await inject(instance, 'POST', '/api/private-risk/scan', { candidateId: 'H2' });
    expect(second.status).toBe(409);
    expect(second.json.records[0]).toMatchObject({ candidateId: 'H1', state: 'pending' });
    release();
    expect((await first).status).toBe(200);
    expect(scanner).toHaveBeenCalledTimes(1);
  });

  it('retains records across restart and GET has no scanning side effect', async () => {
    const path = journalPath();
    const firstScanner = vi.fn<RiskScanner>(async (address, network) => observed(address, network));
    await inject(app(path, firstScanner), 'POST', '/api/private-risk/scan', { candidateId: 'H1' });
    const restartedScanner = vi.fn<RiskScanner>();
    const response = await inject(app(path, restartedScanner), 'GET', '/api/private-risk/status');
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({ usedRequests: 1, records: [{ candidateId: 'H1', state: 'completed' }] });
    expect(restartedScanner).not.toHaveBeenCalled();
  });

  it('fails closed on a damaged journal without clearing it or scanning', async () => {
    const path = journalPath();
    writeFileSync(path, '{damaged', 'utf8');
    const scanner = vi.fn<RiskScanner>();
    const before = readFileSync(path, 'utf8');
    expect((await inject(app(path, scanner), 'GET', '/api/private-risk/status')).status).toBe(503);
    expect((await inject(app(path, scanner), 'POST', '/api/private-risk/scan', { candidateId: 'H1' })).status).toBe(503);
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(scanner).not.toHaveBeenCalled();
  });

  it('preserves another process lock and makes no scan while it exists', async () => {
    const path = journalPath();
    writeFileSync(`${path}.lock`, 'owned by another process');
    const scanner = vi.fn<RiskScanner>();
    expect((await inject(app(path, scanner), 'POST', '/api/private-risk/scan', { candidateId: 'H1' })).status).toBe(503);
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe('owned by another process');
    expect(scanner).not.toHaveBeenCalled();
  });

  it('preserves a pending attempt after restart and prevents every new scan', async () => {
    const path = journalPath();
    const records = [{ candidateId: 'H1', state: 'pending', attemptedAt: '2026-09-27T00:00:00Z', risk: null }];
    writeFileSync(path, JSON.stringify({ version: 1, records }));
    const scanner = vi.fn<RiskScanner>();
    const instance = app(path, scanner);
    expect((await inject(instance, 'GET', '/api/private-risk/status')).json.records).toEqual(records);
    for (const candidateId of ['H1', 'G1']) {
      expect((await inject(instance, 'POST', '/api/private-risk/scan', { candidateId })).status).toBe(409);
    }
    expect(JSON.parse(readFileSync(path, 'utf8')).records).toEqual(records);
    expect(scanner).not.toHaveBeenCalled();
  });

  it('drops free-form scanner fields, rejects invalid scanner binding, and enforces local origin', async () => {
    const path = journalPath();
    const scanner = vi.fn<RiskScanner>(async (address, network) => ({ ...observed(address, network), observation: { secret: 'provider free text' } } as never));
    const instance = app(path, scanner);
    const forbidden = await inject(instance, 'POST', '/api/private-risk/scan', { candidateId: 'H1' }, { origin: 'http://elsewhere.invalid' });
    expect(forbidden.status).toBe(403);
    const accepted = await inject(instance, 'POST', '/api/private-risk/scan', { candidateId: 'H1' });
    expect(JSON.stringify(accepted.json)).not.toContain('provider free text');
    expect(Object.keys(accepted.json.records[0].risk)).toEqual(['address', 'checkedAt', 'provider', 'source', 'decision', 'reasons', 'scan']);

    const invalidScanner = vi.fn<RiskScanner>(async (_address, network) => observed(PRIVATE_RISK_CANDIDATES[1].address, network));
    const invalid = await inject(app(journalPath(), invalidScanner), 'POST', '/api/private-risk/scan', { candidateId: 'H1' });
    expect(invalid.json.records[0]).toMatchObject({ state: 'unavailable', risk: null });
  });
});
