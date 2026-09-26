import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuyerApp } from '../../apps/buyer/src/app.ts';
import type { BuyerConfig } from '../../apps/buyer/src/config.ts';
import type { TestPaymentDependencies } from '../../apps/buyer/src/protected-payment.ts';
import { BuyerService } from '../../apps/buyer/src/service.ts';
import { SellerClient, type Quote } from '../../apps/buyer/src/seller.ts';
import { TaskGrantStore } from '../../apps/buyer/src/task-grant-store.ts';
import { createTaskPaymentPreflight } from '../../apps/buyer/src/task-payment-preflight.ts';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../shared/contracts.ts';
import type { TaskGrantContext, TaskGrantStatus } from '../../shared/task-grant.ts';

// Synthetic fixtures only: no provider, risk API, wallet, signer, RPC or payment system.
const origin = 'http://127.0.0.1:4032';
const account = `0x${'1'.repeat(40)}`;
const payTo = `0x${'2'.repeat(40)}`;
const otherPayTo = `0x${'3'.repeat(40)}`;
const now = new Date('2026-09-27T01:00:00.000Z');
const context: TaskGrantContext = {
  taskId: 'offline-boundary-task', taskName: 'Offline boundary fixture',
  agentId: 'offline-boundary-agent', agentName: 'Offline boundary executor',
  account, payTo, network: TEST_NETWORK, asset: TEST_USDC, resource: RESOURCE_PATH,
};
const grantInput = {
  totalBudgetAtomic: '10000', perTransactionAtomic: '1000', validForMinutes: 30, confirmed: true as const,
};
const config: BuyerConfig = {
  sellerUrl: origin, payTo, riskKeyConfigured: false, paymentRequested: false,
};
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })));
});

async function fixture(saved = true) {
  const folder = await mkdtemp(join(tmpdir(), 'task-preflight-boundary-'));
  folders.push(folder);
  const grantPath = join(folder, 'task-grant.json');
  const writer = new TaskGrantStore({ path: grantPath, context, now: () => now });
  if (saved) await writer.save(grantInput);
  const reader = new TaskGrantStore({ path: grantPath, context });
  return { folder, grantPath, writer, reader };
}

function paymentRequired(amount = '1000', recipient = payTo) {
  return {
    x402Version: 2,
    resource: { url: origin + RESOURCE_PATH },
    accepts: [{ scheme: 'exact', network: TEST_NETWORK, asset: TEST_USDC, amount, payTo: recipient, maxTimeoutSeconds: 300 }],
  };
}

function sellerTransport(sequence: Array<ReturnType<typeof paymentRequired>> = [paymentRequired()]) {
  let call = 0;
  return vi.fn<typeof fetch>(async () => {
    const payload = sequence[Math.min(call++, sequence.length - 1)];
    return new Response(null, {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(payload)).toString('base64') },
    });
  });
}

function inertPayment(folder: string): { dependencies: TestPaymentDependencies; calls: ReturnType<typeof vi.fn>[]; journalPath: string } {
  const journalPath = join(folder, 'payment-budget.json');
  const authorize = vi.fn(async () => undefined);
  const assess = vi.fn(async () => undefined);
  const createSigningInput = vi.fn(async () => undefined);
  const signTypedData = vi.fn(async () => 'fixture-signature');
  const submit = vi.fn(async () => undefined);
  const validateReport = vi.fn(() => false);
  return {
    journalPath,
    calls: [authorize, assess, createSigningInput, signTypedData, submit, validateReport],
    dependencies: {
      testFixtureOnly: true, journalPath, authorize, assess, createSigningInput,
      signTypedData, submit, validateReport,
    },
  };
}

async function inject(app: ReturnType<typeof createBuyerApp>, method: string, url: string, body?: unknown) {
  const bytes = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const chunks: Buffer[] = [];
  const socket = new class extends Duplex {
    _read() { /* Request bytes are injected after Express installs its listeners. */ }
    _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
      chunks.push(Buffer.from(chunk)); done();
    }
  }();
  const request = new IncomingMessage(socket as unknown as Socket);
  request.method = method;
  request.url = url;
  request.headers = bytes
    ? { host: '127.0.0.1', 'content-type': 'application/json', 'content-length': String(bytes.length) }
    : { host: '127.0.0.1' };
  const response = new ServerResponse(request);
  response.assignSocket(socket as unknown as Socket);
  const finished = new Promise<void>((resolve, reject) => {
    response.once('finish', resolve); response.once('error', reject);
  });
  app(request, response);
  setImmediate(() => {
    request.complete = true;
    if (bytes) request.push(bytes);
    request.push(null);
  });
  await finished;
  const wire = Buffer.concat(chunks).toString('utf8');
  const split = wire.indexOf('\r\n\r\n');
  return { status: Number(/^HTTP\/1\.1 (\d+)/m.exec(wire)?.[1]), body: JSON.parse(wire.slice(split + 4)) as Record<string, unknown> };
}

describe('connected saved-task-permission boundary', () => {
  it.each([
    { grantId: 'client-grant' },
    { permission: { passed: true } },
    { amountAtomic: '1' },
    { grant: grantInput },
  ])('rejects client permission fields before the saved Grant reader: %j', async extra => {
    const { folder, reader } = await fixture();
    const status = vi.spyOn(reader, 'status');
    const preflight = vi.fn(createTaskPaymentPreflight(reader, origin, () => now));
    const scanner = vi.fn();
    const payment = inertPayment(folder);
    const app = createBuyerApp(config, new BuyerService(
      config, new SellerClient(origin, sellerTransport()), scanner, payment.dependencies, preflight,
    ));

    expect((await inject(app, 'POST', '/api/inspect', { requestId: 'client-fields-01', prompt: 'offline report' })).status).toBe(200);
    const response = await inject(app, 'POST', '/api/pay', { requestId: 'client-fields-01', ...extra });

    expect(response.status).toBe(400);
    expect(status).not.toHaveBeenCalled();
    expect(preflight).not.toHaveBeenCalled();
    expect(scanner).not.toHaveBeenCalled();
    payment.calls.forEach(callback => expect(callback).not.toHaveBeenCalled());
    expect(await readdir(folder)).toEqual(['task-grant.json']);
  });

  it('holds missing, expired and context-mismatched saved permissions deterministically without writes', async () => {
    const missing = await fixture(false);
    const missingCheck = createTaskPaymentPreflight(missing.reader, origin, () => now);
    const missingBefore = await readdir(missing.folder);
    expect(await missingCheck(quote())).toMatchObject({ passed: false, code: 'grant_missing' });
    expect(await missingCheck(quote())).toMatchObject({ passed: false, code: 'grant_missing' });
    expect(await readdir(missing.folder)).toEqual(missingBefore);

    const expired = await fixture();
    const expiredBefore = await readFile(expired.grantPath, 'utf8');
    const expiredCheck = createTaskPaymentPreflight(expired.reader, origin, () => new Date('2026-09-27T01:30:00.000Z'));
    expect(await expiredCheck(quote())).toMatchObject({ passed: false, code: 'grant_expired' });
    expect(await expiredCheck(quote())).toMatchObject({ passed: false, code: 'grant_expired' });
    expect(await readFile(expired.grantPath, 'utf8')).toBe(expiredBefore);

    const mismatched = await fixture();
    const mismatchReader = new TaskGrantStore({
      path: mismatched.grantPath, context: { ...context, taskId: 'different-task' },
    });
    const mismatchCheck = createTaskPaymentPreflight(mismatchReader, origin, () => now);
    const mismatchBefore = await readFile(mismatched.grantPath, 'utf8');
    expect(await mismatchCheck(quote())).toMatchObject({ passed: false, code: 'grant_unavailable' });
    expect(await mismatchCheck(quote())).toMatchObject({ passed: false, code: 'grant_unavailable' });
    expect(await readFile(mismatched.grantPath, 'utf8')).toBe(mismatchBefore);
  });

  it('fails closed on malformed status and clock failures, returning immutable snapshots', async () => {
    const { reader } = await fixture();
    const valid = await reader.status();
    const malformed = { ...structuredClone(valid), unexpected: true };
    const malformedReader = {
      context, status: async () => malformed,
    } as unknown as Pick<TaskGrantStore, 'context' | 'status'>;
    const wrongContextStatus: TaskGrantStatus = {
      ...structuredClone(valid), context: { ...context, taskId: 'different-task' },
    };
    const wrongContextReader = {
      context, status: async () => wrongContextStatus,
    } as unknown as Pick<TaskGrantStore, 'context' | 'status'>;

    const malformedResult = await createTaskPaymentPreflight(malformedReader, origin, () => now)(quote());
    const mismatchResult = await createTaskPaymentPreflight(wrongContextReader, origin, () => now)(quote());
    const thrownClock = await createTaskPaymentPreflight(reader, origin, () => { throw new Error('clock unavailable'); })(quote());
    const invalidClock = await createTaskPaymentPreflight(reader, origin, () => new Date(Number.NaN))(quote());

    expect(malformedResult).toMatchObject({ passed: false, code: 'grant_unavailable' });
    expect(mismatchResult).toMatchObject({ passed: false, code: 'grant_unavailable' });
    expect(thrownClock).toMatchObject({ passed: false, code: 'invalid_clock' });
    expect(invalidClock).toMatchObject({ passed: false, code: 'invalid_clock' });
    for (const result of [malformedResult, mismatchResult, thrownClock, invalidClock]) {
      expect(Object.isFrozen(result)).toBe(true);
      expect(result).toMatchObject({ grantId: null, intentHash: null, amountAtomic: null, paymentEnabled: false, executionConnected: false });
    }
  });

  it('snapshots the server quote before an asynchronous read and never accepts later mutation', async () => {
    const { reader, grantPath, folder } = await fixture();
    const savedStatus = await reader.status();
    const before = await readFile(grantPath, 'utf8');
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const delayedReader = {
      context,
      status: vi.fn(async () => { await barrier; return savedStatus; }),
    } as unknown as Pick<TaskGrantStore, 'context' | 'status'>;
    const mutable = quote();
    const pending = createTaskPaymentPreflight(delayedReader, origin, () => now)(mutable);
    mutable.terms.amount = '9999';
    mutable.terms.payTo = otherPayTo;
    mutable.url = origin + '/different';
    release();
    const result = await pending;

    expect(result).toMatchObject({ passed: true, code: 'passed', amountAtomic: '1000', paymentEnabled: false, executionConnected: false });
    expect(Object.isFrozen(result)).toBe(true);
    expect(await readFile(grantPath, 'utf8')).toBe(before);
    expect(await readdir(folder)).toEqual(['task-grant.json']);
  });

  it('stops denied policy before the reader, scanner and every fixture payment dependency', async () => {
    const { folder, reader } = await fixture();
    const status = vi.spyOn(reader, 'status');
    const preflight = vi.fn(createTaskPaymentPreflight(reader, origin, () => now));
    const scanner = vi.fn();
    const payment = inertPayment(folder);
    const seller = new SellerClient(origin, sellerTransport([paymentRequired('1001')]));
    const service = new BuyerService(config, seller, scanner, payment.dependencies, preflight);

    await service.inspect('policy-denied-01', 'offline report');
    const first = await service.pay('policy-denied-01');
    const repeated = await service.pay('policy-denied-01');

    expect(first).toEqual(repeated);
    expect(first).toMatchObject({ status: 'denied', decision: 'deny', paymentEnabled: false, counters: { sign: 0, settle: 0 } });
    expect(status).not.toHaveBeenCalled();
    expect(preflight).not.toHaveBeenCalled();
    expect(scanner).not.toHaveBeenCalled();
    payment.calls.forEach(callback => expect(callback).not.toHaveBeenCalled());
    expect(await readdir(folder)).toEqual(['task-grant.json']);
  });

  it('uses connected preflight for each request once and fixture payment cannot override it', async () => {
    const { folder, grantPath, reader } = await fixture();
    const before = await readFile(grantPath, 'utf8');
    const status = vi.spyOn(reader, 'status');
    const preflight = vi.fn(createTaskPaymentPreflight(reader, origin, () => now));
    const scanner = vi.fn();
    const payment = inertPayment(folder);
    const fetcher = sellerTransport();
    const service = new BuyerService(
      config, new SellerClient(origin, fetcher), scanner, payment.dependencies, preflight,
    );

    await Promise.all([
      service.inspect('cross-request-01', 'same offline report'),
      service.inspect('cross-request-02', 'same offline report'),
    ]);
    const [first, second] = await Promise.all([
      service.pay('cross-request-01'), service.pay('cross-request-02'),
    ]);
    const [firstAgain, secondAgain] = await Promise.all([
      service.pay('cross-request-01'), service.pay('cross-request-02'),
    ]);

    expect(firstAgain).toEqual(first);
    expect(secondAgain).toEqual(second);
    expect(first.grantPreflight).toEqual(second.grantPreflight);
    expect(first.grantPreflight).toMatchObject({ passed: true, code: 'passed', amountAtomic: '1000', paymentEnabled: false, executionConnected: false });
    expect(first).toMatchObject({ status: 'held', decision: 'hold', paymentEnabled: false, counters: { sign: 0, settle: 0 } });
    expect(second).toMatchObject({ status: 'held', decision: 'hold', paymentEnabled: false, counters: { sign: 0, settle: 0 } });
    expect(preflight).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(scanner).not.toHaveBeenCalled();
    payment.calls.forEach(callback => expect(callback).not.toHaveBeenCalled());
    expect(await readFile(grantPath, 'utf8')).toBe(before);
    expect(await readdir(folder)).toEqual(['task-grant.json']);
  });

  it('rejects a changed seller quote before reader, scan, sign, submit or budget writes', async () => {
    const { folder, reader } = await fixture();
    const status = vi.spyOn(reader, 'status');
    const preflight = vi.fn(createTaskPaymentPreflight(reader, origin, () => now));
    const scanner = vi.fn();
    const payment = inertPayment(folder);
    const service = new BuyerService(
      config,
      new SellerClient(origin, sellerTransport([paymentRequired(), paymentRequired('999')])),
      scanner,
      payment.dependencies,
      preflight,
    );

    await service.inspect('quote-change-01', 'offline report');
    const result = await service.pay('quote-change-01');
    const repeated = await service.pay('quote-change-01');

    expect(repeated).toEqual(result);
    expect(result).toMatchObject({ status: 'held', decision: 'hold', paymentEnabled: false, counters: { sign: 0, settle: 0 } });
    expect(result.reasons.join(' ')).toContain('已变化');
    expect(result.grantPreflight).toBeUndefined();
    expect(status).not.toHaveBeenCalled();
    expect(preflight).not.toHaveBeenCalled();
    expect(scanner).not.toHaveBeenCalled();
    payment.calls.forEach(callback => expect(callback).not.toHaveBeenCalled());
    expect(await readdir(folder)).toEqual(['task-grant.json']);
  });
});

function quote(): Quote {
  return {
    method: 'GET', url: origin + RESOURCE_PATH, fingerprint: 'synthetic-fixed-quote', full: paymentRequired(),
    terms: { scheme: 'exact', network: TEST_NETWORK, asset: TEST_USDC, amount: '1000', payTo },
  };
}
