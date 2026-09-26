import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';
import { isTaskPaymentPreflight } from '../../../shared/task-payment-preflight.ts';
import type { TaskGrantContext } from '../../../shared/task-grant.ts';
import { TaskGrantStore } from './task-grant-store.ts';
import { createTaskPaymentPreflight, createRuntimeTaskPaymentPreflight } from './task-payment-preflight.ts';
import { BuyerService } from './service.ts';
import { SellerClient, type Quote } from './seller.ts';
import { createBuyerApp } from './app.ts';
import { Duplex } from 'node:stream';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

// Synthetic offline fixtures, never provider observations or a real payer/seller.
const account = `0x${'1'.repeat(40)}`, payTo = `0x${'2'.repeat(40)}`;
const origin = 'http://127.0.0.1:4032';
const context: TaskGrantContext = { taskId: 'report-purchase-task', taskName: '购买结构报告',
  agentId: 'report-buyer-01', agentName: '报告购买任务执行器（待接通）', account, payTo,
  network: TEST_NETWORK, asset: TEST_USDC, resource: RESOURCE_PATH };
const input = { totalBudgetAtomic: '10000', perTransactionAtomic: '1000', validForMinutes: 30, confirmed: true as const };
const now = new Date('2026-09-27T01:00:00Z');
const quote: Quote = { method: 'GET', url: origin + RESOURCE_PATH, fingerprint: 'fixture', full: {},
  terms: { scheme: 'exact', network: TEST_NETWORK, asset: TEST_USDC, amount: '1000', payTo } };
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function setup(saved = true) {
  const folder = await mkdtemp(join(tmpdir(), 'grant-preflight-')); folders.push(folder);
  const path = join(folder, 'task-grant.json');
  const writer = new TaskGrantStore({ path, context, now: () => now });
  if (saved) await writer.save(input);
  // A distinct reader instance models the buyer process, not an in-memory shared Grant.
  const reader = new TaskGrantStore({ path, context });
  const check = createTaskPaymentPreflight(reader, origin, () => now);
  return { folder, path, writer, reader, check };
}
it('rereads the sole saved Grant across instances, freezes result and never writes or reserves', async () => {
  const { path, folder, check } = await setup();
  const before = await readFile(path, 'utf8');
  const a = await check(quote), b = await check(quote);
  expect(a).toMatchObject({ passed: true, code: 'passed', amountAtomic: '1000', executionConnected: false, paymentEnabled: false });
  expect(isTaskPaymentPreflight(a)).toBe(true); expect(Object.isFrozen(a)).toBe(true); expect(b).toEqual(a);
  expect(await readFile(path, 'utf8')).toBe(before); expect(await readdir(folder)).toEqual(['task-grant.json']);
});
it('holds missing Grant, then reads a newly persisted Grant without rebuilding the reader', async () => {
  const { check, writer } = await setup(false);
  expect(await check(quote)).toMatchObject({ passed: false, code: 'grant_missing', intentHash: null });
  await writer.save(input);
  expect(await check(quote)).toMatchObject({ passed: true });
});
it.each([
  ['payTo', `0x${'3'.repeat(40)}`, 'scope_mismatch'],
  ['network', 'eip155:1', 'scope_mismatch'],
  ['asset', `0x${'3'.repeat(40)}`, 'scope_mismatch'],
  ['amount', '1001', 'amount_exceeds_limit'],
] as const)('holds a quote with changed %s', async (key, value, code) => {
  const { check } = await setup();
  expect(await check({ ...quote, terms: { ...quote.terms, [key]: value } })).toMatchObject({ passed: false, code, grantId: null, intentHash: null });
});
it.each([origin + '/other', origin + RESOURCE_PATH + '?other=1', 'http://localhost:4032' + RESOURCE_PATH, ''])('rejects a resource not exactly bound to the configured seller: %s', async url => {
  const { check } = await setup();
  expect(await check({ ...quote, url })).toMatchObject({ passed: false, code: 'invalid_quote' });
});
it('holds expired/future Grants, invalid clocks and mismatched server context', async () => {
  const { reader } = await setup();
  for (const [time, code] of [[new Date('2026-09-27T01:30:00Z'), 'grant_expired'], [new Date('2026-09-27T00:59:59Z'), 'grant_not_started'], [new Date(NaN), 'invalid_clock']] as const) {
    expect(await createTaskPaymentPreflight(reader, origin, () => time)(quote)).toMatchObject({ passed: false, code });
  }
  expect(await createTaskPaymentPreflight({ context: { ...context, taskId: 'other-task' }, status: () => reader.status() }, origin)(quote)).toMatchObject({ code: 'grant_unavailable' });
});
it('holds corrupt/unreadable journals without leaking raw contents or creating a replacement', async () => {
  const { path, check } = await setup();
  await writeFile(path, 'SECRET-JOURNAL-CONTENT');
  const result = await check(quote);
  expect(result).toMatchObject({ passed: false, code: 'grant_unavailable' });
  expect(JSON.stringify(result)).not.toContain('SECRET'); expect(await readFile(path, 'utf8')).toBe('SECRET-JOURNAL-CONTENT');
});
it('runtime factory fails closed with missing server identity without reading or creating an actual journal', async () => {
  expect(await createRuntimeTaskPaymentPreflight({}, origin)(quote)).toMatchObject({ code: 'not_configured', passed: false });
});
it('snapshots server-held quote before an asynchronous Grant read', async () => {
  const { reader } = await setup();
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  const check = createTaskPaymentPreflight({ context, status: async () => { await barrier; return reader.status(); } }, origin, () => now);
  const mutable = structuredClone(quote); const pending = check(mutable);
  mutable.terms.amount = '9999'; release();
  expect(await pending).toMatchObject({ passed: true, amountAtomic: '1000' });
});
function sellerTransport(amounts = ['1000', '1000']) {
  let index = 0;
  return vi.fn<typeof fetch>(async () => new Response(null, { status: 402, headers: {
    'PAYMENT-REQUIRED': Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: origin + RESOURCE_PATH },
      accepts: [{ ...quote.terms, amount: amounts[Math.min(index++, amounts.length - 1)], maxTimeoutSeconds: 300 }] })).toString('base64'),
  } }));
}
it.each([true, false])('BuyerService connects the actual Grant reader and holds without scan, retry or execution (saved=%s)', async saved => {
  const { check, path } = await setup(saved);
  const fetcher = sellerTransport(); const scan = vi.fn(); const preflight = vi.fn(check);
  const service = new BuyerService({ sellerUrl: origin, payTo, riskKeyConfigured: false, paymentRequested: false }, new SellerClient(origin, fetcher), scan, undefined, preflight);
  await service.inspect('request-preflight1', 'sample report');
  expect(preflight).not.toHaveBeenCalled();
  const [a, b] = await Promise.all([service.pay('request-preflight1'), service.pay('request-preflight1')]);
  expect(a).toEqual(b); expect(a).toMatchObject({ status: 'held', decision: 'hold', paymentEnabled: false,
    counters: { sign: 0, settle: 0 }, grantPreflight: { passed: saved, code: saved ? 'passed' : 'grant_missing' } });
  expect(a.execution).toBeUndefined(); expect(a.data).toBeUndefined(); expect(scan).not.toHaveBeenCalled();
  await service.pay('request-preflight1'); expect(preflight).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(service.get('request-preflight1')).toEqual(a);
  if (saved) expect((await readFile(path, 'utf8'))).not.toMatch(/reserved|spent|operation/);
});
it('changed seller quote stops before preflight or scan', async () => {
  const { check } = await setup(); const preflight = vi.fn(check), scan = vi.fn();
  const service = new BuyerService({ sellerUrl: origin, payTo, riskKeyConfigured: false, paymentRequested: false }, new SellerClient(origin, sellerTransport(['1000', '999'])), scan, undefined, preflight);
  await service.inspect('request-changed1', 'sample report');
  const result = await service.pay('request-changed1');
  expect(result.reasons.join()).toContain('已变化'); expect(result.grantPreflight).toBeUndefined();
  expect(preflight).not.toHaveBeenCalled(); expect(scan).not.toHaveBeenCalled();
});

async function inject(app: ReturnType<typeof createBuyerApp>, method: string, url: string, body?: unknown, raw?: Buffer) {
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

it('real buyer HTTP routes ignore client-supplied permission and expose only server-held checks', async () => {
  const { check } = await setup();
  const config = { sellerUrl: origin, payTo, riskKeyConfigured: false, paymentRequested: false };
  const scanner = vi.fn(); const fetcher = sellerTransport();
  const app = createBuyerApp(config, new BuyerService(config, new SellerClient(origin, fetcher), scanner, undefined, check));
  const inspected = await inject(app, 'POST', '/api/inspect', { requestId: 'request-route1', prompt: 'sample report' });
  expect(inspected.status).toBe(200);
  const forged = await inject(app, 'POST', '/api/pay', { requestId: 'request-route1', grantId: 'forged', amountAtomic: '1' });
  expect(forged.status).toBe(400);
  const paid = await inject(app, 'POST', '/api/pay', { requestId: 'request-route1' });
  expect(paid.status).toBe(200);
  expect(paid.body).toMatchObject({ decision: 'hold', paymentEnabled: false, grantPreflight: { passed: true, amountAtomic: '1000' } });
  expect(paid.body.grantPreflight.grantId).not.toBe('forged');
  expect((await inject(app, 'GET', '/api/requests/request-route1')).body).toEqual(paid.body);
  expect(scanner).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(2);
});
