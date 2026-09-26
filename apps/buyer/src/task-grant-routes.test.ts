import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';
import type { TaskGrantContext, TaskGrantInput } from '../../../shared/task-grant.ts';
import { createTaskGrantRouter } from './task-grant-routes.ts';
import { TaskGrantStore } from './task-grant-store.ts';

const folders: string[] = [];
const context: TaskGrantContext = {
  taskId: 'GH-15', taskName: 'grant persistence', agentId: 'symphony', agentName: 'Symphony',
  account: `0x${'1'.repeat(40)}`, payTo: `0x${'2'.repeat(40)}`,
  network: TEST_NETWORK, asset: TEST_USDC, resource: RESOURCE_PATH,
};
const input: TaskGrantInput = { totalBudgetAtomic: '10000', perTransactionAtomic: '1000', validForMinutes: 30, confirmed: true };

afterEach(async () => {
  vi.restoreAllMocks();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function setup() {
  const folder = await mkdtemp(join(tmpdir(), 'task-grant-route-'));
  folders.push(folder);
  const path = join(folder, 'journal.json');
  const app = express();
  app.use(createTaskGrantRouter(new TaskGrantStore({ path, context, now: () => new Date('2026-09-27T00:00:00.000Z') })));
  app.use((_request, response) => response.status(404).json({ error: 'parent fallback' }));
  return { app, path };
}

async function inject(app: ReturnType<typeof express>, method: string, url: string, body?: unknown, raw?: Buffer) {
  const bytes = raw ?? (body === undefined ? null : Buffer.from(JSON.stringify(body)));
  const chunks: Buffer[] = [];
  const socket = new class extends Duplex {
    _read() { /* The request bytes are injected below. */ }
    _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) { chunks.push(Buffer.from(chunk)); done(); }
  }();
  const request = new IncomingMessage(socket as unknown as Socket);
  request.method = method;
  request.url = url;
  request.headers = bytes ? { host: '127.0.0.1', 'content-type': 'application/json', 'content-length': String(bytes.length) } : { host: '127.0.0.1' };
  const response = new ServerResponse(request);
  response.assignSocket(socket as unknown as Socket);
  const finished = new Promise<void>((resolve, reject) => { response.once('finish', resolve); response.once('error', reject); });
  app(request, response);
  setImmediate(() => {
    request.complete = true;
    if (bytes) request.push(bytes);
    request.push(null);
  });
  await finished;
  const wire = Buffer.concat(chunks).toString('utf8');
  const split = wire.indexOf('\r\n\r\n');
  return { status: Number(/^HTTP\/1\.1 (\d+)/m.exec(wire)?.[1]), headers: wire.slice(0, split), body: JSON.parse(wire.slice(split + 4)) };
}

describe('task grant router', () => {
  it('saves once, returns the same grant through GET after restart, and never calls fetch', async () => {
    const { app, path } = await setup();
    const fetch = vi.spyOn(globalThis, 'fetch');
    const saved = await inject(app, 'POST', '/api/task-grant', input);
    expect(saved.status).toBe(200);
    expect(saved.headers).toContain('Cache-Control: no-store');

    const restarted = express();
    restarted.use(createTaskGrantRouter(new TaskGrantStore({ path, context })));
    const found = await inject(restarted, 'GET', '/api/task-grant');
    expect(found.status).toBe(200);
    expect(found.body).toEqual(saved.body);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('exposes only fixed validation and conflict errors', async () => {
    const { app } = await setup();
    const invalid = await inject(app, 'POST', '/api/task-grant', { ...input, confirmed: false });
    expect(invalid).toMatchObject({ status: 400, body: { error: '任务许可输入无效。', code: 'invalid_task_grant' } });
    await inject(app, 'POST', '/api/task-grant', input);
    const changed = await inject(app, 'POST', '/api/task-grant', { ...input, totalBudgetAtomic: '20000' });
    expect(changed).toMatchObject({ status: 409, body: { code: 'task_grant_conflict' } });
  });

  it('rejects malformed and over-4KB JSON without starting a service', async () => {
    const { app } = await setup();
    expect(await inject(app, 'POST', '/api/task-grant', undefined, Buffer.from('{'))).toMatchObject({ status: 400, body: { code: 'invalid_task_grant' } });
    expect(await inject(app, 'POST', '/api/task-grant', { ...input, extra: 'x'.repeat(5000) })).toMatchObject({ status: 413, body: { code: 'invalid_task_grant' } });
  });

  it('passes unknown paths to the parent router', async () => {
    const { app } = await setup();
    const response = await inject(app, 'GET', '/api/task-grant/unknown');
    expect(response).toMatchObject({ status: 404, body: { error: 'parent fallback' } });
    expect(response.headers).not.toContain('Cache-Control: no-store');
  });
});
