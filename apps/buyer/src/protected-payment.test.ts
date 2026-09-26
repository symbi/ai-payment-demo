import { afterEach, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Duplex } from 'node:stream';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';
import { createBuyerApp } from './app.ts';
import { BuyerService } from './service.ts';
import { SellerClient } from './seller.ts';
import { createEmptyPaymentJournal, type TestPaymentDependencies } from './protected-payment.ts';

const payTo = `0x${'1'.repeat(40)}`;
const wallet = `0x${'2'.repeat(40)}`;
const origin = 'http://127.0.0.1:4032';
const resource = `${origin}/api/contract-insights`;
const config = { sellerUrl: origin, payTo, riskKeyConfigured: false, paymentRequested: false };
const folders: string[] = [];
afterEach(async () => { for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });

function quote(overrides: Record<string, unknown> = {}) {
  const terms = { scheme: 'exact', network: TEST_NETWORK, asset: TEST_USDC, amount: '1000', payTo,
    maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' }, ...overrides };
  const payload = { x402Version: 2, accepts: [terms], resource: { url: resource, description: 'sample', mimeType: 'application/json' } };
  return new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(payload)).toString('base64') } });
}
function typed(amount = '1000') {
  return { domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: TEST_USDC },
    types: { EIP712Domain: [
      { name: 'name', type: 'string' }, { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' },
    ], TransferWithAuthorization: [
      { name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
    ] }, primaryType: 'TransferWithAuthorization',
    message: { from: wallet, to: payTo, value: amount,
      validAfter: Math.floor(Date.now() / 1000) - 10, validBefore: Math.floor(Date.now() / 1000) + 300,
      nonce: `0x${'3'.repeat(64)}` } };
}
function approvedRiskAt(now: number) {
  return { source: 'fixture', decision: 'allow', evidenceId: 'fixture-001', address: payTo,
    checkedAt: new Date(now).toISOString(), requestedNetwork: TEST_NETWORK, coverage: 'verified', semantics: 'verified' };
}

/** Express request injection through Node's HTTP request/response objects; no listen/socket/network. */
async function post(app: ReturnType<typeof createBuyerApp>, path: string, body: unknown) {
  const bytes = Buffer.from(JSON.stringify(body));
  const chunks: Buffer[] = [];
  const socket = new class extends Duplex {
    _read() { /* In-memory request is pushed directly. */ }
    _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) { chunks.push(Buffer.from(chunk)); done(); }
  }();
  const req = new IncomingMessage(socket as unknown as Socket);
  req.method = 'POST'; req.url = path;
  req.headers = { host: '127.0.0.1:4031', 'content-type': 'application/json', 'content-length': String(bytes.length) };
  const res = new ServerResponse(req);
  res.assignSocket(socket as unknown as Socket);
  const finished = new Promise<void>((resolve, reject) => { res.on('finish', resolve); res.on('error', reject); });
  app(req, res);
  setImmediate(() => { req.complete = true; req.push(bytes); req.push(null); });
  await finished;
  const wire = Buffer.concat(chunks).toString();
  const split = wire.indexOf('\r\n\r\n');
  return { status: Number(wire.match(/^HTTP\/1\.1 (\d+)/)?.[1]), body: JSON.parse(wire.slice(split + 4)) };
}

async function setup(options: { taskBudget?: string; amount?: string; mutate?: (value: ReturnType<typeof typed>) => void;
  signThrow?: boolean; submitThrow?: boolean; reportValid?: boolean; journalPath?: string; quoteOverride?: Record<string, unknown> } = {}) {
  const folder = await mkdtemp(join(tmpdir(), '03a-pay-r5-')); folders.push(folder);
  const journalPath = options.journalPath ?? join(folder, 'payment-journal.json');
  if (!options.journalPath) await createEmptyPaymentJournal(journalPath);
  const seller = new SellerClient(origin, vi.fn<typeof fetch>(async () => quote({ amount: options.amount ?? '1000', ...options.quoteOverride })));
  const sign = vi.fn(async (_value: unknown) => { if (options.signThrow) throw new Error('signer uncertain'); return 'FAKE-SIGNATURE'; });
  const submit = vi.fn(async (_quote: unknown, _signature: string, operationId: string) => { if (options.submitThrow) throw new Error('response lost'); return { settlement: 'settled',
    receipt: { success: true, operationId, network: TEST_NETWORK, asset: TEST_USDC, payTo, amount: options.amount ?? '1000' },
    report: { valid: options.reportValid !== false } }; });
  const deps: TestPaymentDependencies = { testFixtureOnly: true, journalPath,
    authorize: async request => ({ ...request, taskId: 'task-0001', operationId: request.requestId, authorizationId: `auth-${request.requestId}`,
      wallet, expiresAt: new Date(Date.now() + 60_000).toISOString(), taskBudgetAtomic: options.taskBudget ?? '2000',
      typedData: typed(options.amount ?? '1000') }),
    assess: async () => ({ source: 'fixture', decision: 'allow', evidenceId: 'fixture-001', address: payTo,
      checkedAt: new Date().toISOString(), requestedNetwork: TEST_NETWORK, coverage: 'verified', semantics: 'verified' }),
    createSigningInput: async approved => { const value = structuredClone(approved) as ReturnType<typeof typed>; options.mutate?.(value); return value; },
    signTypedData: sign, submit, validateReport: value => typeof value === 'object' && value !== null && (value as { valid?: unknown }).valid === true };
  const service = new BuyerService(config, seller, undefined, deps);
  return { app: createBuyerApp(config, service), service, sign, submit, journalPath, deps };
}
async function inspectAndPay(app: ReturnType<typeof createBuyerApp>, id: string) {
  expect((await post(app, '/api/inspect', { requestId: id, prompt: 'sample' })).status).toBe(200);
  return post(app, '/api/pay', { requestId: id });
}

it('routes one offline authorization through Express and hides the fake signature', async () => {
  const { app, sign, submit } = await setup();
  const result = await inspectAndPay(app, 'request-001');
  expect(result.status).toBe(200);
  expect(result.body.execution).toMatchObject({ operationId: 'request-001', signing: 'signed', submission: 'submitted', settlement: 'settled', taskComplete: true });
  expect(sign).toHaveBeenCalledTimes(1); expect(submit).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(result.body)).not.toContain('FAKE-SIGNATURE');
  expect(Object.isFrozen(sign.mock.calls[0][0])).toBe(true);
  expect(Object.isFrozen((sign.mock.calls[0][0] as ReturnType<typeof typed>).message)).toBe(true);
  expect((await post(app, '/api/pay', { requestId: 'request-001', allow: true })).status).toBe(400);
});

it('shares concurrent POST /api/pay for the same request with one signer call', async () => {
  const { app, sign, submit } = await setup();
  await post(app, '/api/inspect', { requestId: 'request-018', prompt: 'sample' });
  const results = await Promise.all([
    post(app, '/api/pay', { requestId: 'request-018' }),
    post(app, '/api/pay', { requestId: 'request-018' }),
  ]);
  expect(results.every(r => r.body.execution?.taskComplete === true)).toBe(true);
  expect(sign).toHaveBeenCalledTimes(1); expect(submit).toHaveBeenCalledTimes(1);
});

it.each([
  ['to', (v: ReturnType<typeof typed>) => { v.message.to = wallet; }],
  ['amount', (v: ReturnType<typeof typed>) => { v.message.value = '999'; }],
  ['domain', (v: ReturnType<typeof typed>) => { v.domain.version = '9'; }],
  ['extra', (v: ReturnType<typeof typed>) => { (v.message as unknown as Record<string, unknown>).permit2 = true; }],
  ['types', (v: ReturnType<typeof typed>) => { v.types.TransferWithAuthorization[0].type = 'uint256'; }],
])('rejects final %s mutation before signTypedData', async (_name, mutate) => {
  const { app, sign } = await setup({ mutate });
  const response = await inspectAndPay(app, 'request-002');
  expect(response.body.execution.reasonCodes).toContain('SIGNING_INPUT_MISMATCH'); expect(sign).not.toHaveBeenCalled();
});

it.each([
  ['per-payment cap', { amount: '1001' }],
  ['changed recipient', { quoteOverride: { payTo: wallet } }],
  ['expired approval', { }],
])('does not sign invalid %s', async (name, options) => {
  const { app, sign, deps } = await setup(options);
  if (name === 'expired approval') deps.authorize = async r => ({ ...r, taskId: 'task-0001', operationId: r.requestId,
    authorizationId: `auth-${r.requestId}`, wallet, expiresAt: new Date(Date.now() - 1).toISOString(), taskBudgetAtomic: '2000', typedData: typed() });
  const response = await inspectAndPay(app, 'request-003');
  expect(response.body.status).not.toBe('paid'); expect(sign).not.toHaveBeenCalled();
});

it('atomically reserves task budget for concurrent operations and restart holds the same identity', async () => {
  const { app, sign, journalPath, deps } = await setup({ taskBudget: '1000' });
  const results = await Promise.all([inspectAndPay(app, 'request-004'), inspectAndPay(app, 'request-005')]);
  expect(results.map(r => r.body.execution?.reasonCodes?.[0]).sort()).toEqual(['REPORT_VALIDATED', 'TASK_BUDGET_EXCEEDED']);
  expect(sign).toHaveBeenCalledTimes(1);
  const restarted = await setup({ journalPath, taskBudget: '1000' });
  const again = await inspectAndPay(restarted.app, 'request-004');
  expect(again.body.execution?.signing).toBe('signed'); expect(restarted.sign).not.toHaveBeenCalled();
  // Preserve one journal owner for the duration of this test.
  void deps;
});

it.each([['sign', { signThrow: true }, 'unknown', 'not_submitted'], ['submit', { submitThrow: true }, 'signed', 'unknown']])(
  'retains budget and uncertain %s result without signing again', async (_name, options, signing, submission) => {
    const { app, sign, journalPath } = await setup({ ...options, taskBudget: '1000' });
    const first = await inspectAndPay(app, 'request-006');
    expect(first.body.execution).toMatchObject({ signing, submission, taskComplete: false });
    const restarted = await setup({ journalPath, taskBudget: '1000' });
    const authorization = vi.fn(restarted.deps.authorize);
    restarted.deps.authorize = authorization;
    const repeat = await inspectAndPay(restarted.app, 'request-006');
    expect(repeat.body.execution).toMatchObject({ signing, submission });
    expect(authorization).not.toHaveBeenCalled();
    const next = await inspectAndPay(restarted.app, 'request-007');
    expect(next.body.execution.reasonCodes).toContain('TASK_BUDGET_EXCEEDED');
    expect(sign).toHaveBeenCalledTimes(1); expect(restarted.sign).not.toHaveBeenCalled();
  });

it.each(['sign', 'submit'])('bounds a never-resolving %s callback and retains the reservation', async stage => {
  const { app, deps, journalPath } = await setup({ taskBudget: '1000' });
  deps.timeoutMs = 20;
  const never = () => new Promise<never>(() => {});
  if (stage === 'sign') deps.signTypedData = never;
  else deps.submit = never;
  const result = await inspectAndPay(app, 'request-020');
  expect(result.body.execution).toMatchObject({ signing: stage === 'sign' ? 'unknown' : 'signed',
    submission: stage === 'sign' ? 'not_submitted' : 'unknown', taskComplete: false });
  const restarted = await setup({ journalPath, taskBudget: '1000' });
  const second = await inspectAndPay(restarted.app, 'request-021');
  expect(second.body.execution.reasonCodes).toContain('TASK_BUDGET_EXCEEDED');
  expect(restarted.sign).not.toHaveBeenCalled();
});

it('keeps settled payment incomplete when the report is invalid', async () => {
  const { app, sign } = await setup({ reportValid: false });
  const result = await inspectAndPay(app, 'request-008');
  expect(result.body.execution).toMatchObject({ settlement: 'settled', taskComplete: false, reasonCodes: ['REPORT_INVALID'] });
  await post(app, '/api/pay', { requestId: 'request-008' }); expect(sign).toHaveBeenCalledTimes(1);
});

it('fails closed on missing or corrupt durable journal', async () => {
  const { app, sign, journalPath } = await setup();
  await rm(journalPath);
  const result = await inspectAndPay(app, 'request-009');
  expect(result.body.execution.reasonCodes).toContain('JOURNAL_UNAVAILABLE'); expect(sign).not.toHaveBeenCalled();
});

it('rejects damaged journal contents without recreating its budget', async () => {
  const { app, sign, journalPath } = await setup();
  await writeFile(journalPath, '{broken');
  const result = await inspectAndPay(app, 'request-010');
  expect(result.body.execution.reasonCodes).toContain('JOURNAL_UNAVAILABLE'); expect(sign).not.toHaveBeenCalled();
});

it.each([
  ['wrong quote domain', { extra: { name: 'Wrong', version: '2' } }],
  ['wrong quote asset', { asset: wallet }],
  ['unsupported quote extension', { extra: { name: 'USDC', version: '2', permit2: true } }],
])('rejects %s before signing', async (_name, quoteOverride) => {
  const { app, sign } = await setup({ quoteOverride });
  const result = await inspectAndPay(app, 'request-011');
  expect(result.body.status).not.toBe('paid'); expect(sign).not.toHaveBeenCalled();
});

it('requires explicit verified fixture semantics and coverage', async () => {
  const { app, deps, sign } = await setup();
  deps.assess = async () => ({ source: 'fixture', decision: 'allow', evidenceId: 'fixture-001', address: payTo,
    checkedAt: new Date().toISOString(), requestedNetwork: TEST_NETWORK, coverage: 'unverified', semantics: 'unverified' });
  const result = await inspectAndPay(app, 'request-012');
  expect(result.body.execution.reasonCodes).toContain('RISK_UNVERIFIED'); expect(sign).not.toHaveBeenCalled();
});

it('rejects malformed risk timestamps even when a fixture claims allow', async () => {
  const { app, deps, sign } = await setup();
  deps.assess = async () => ({ source: 'fixture', decision: 'allow', evidenceId: 'fixture-001', address: payTo,
    checkedAt: 'not-a-date', requestedNetwork: TEST_NETWORK, coverage: 'verified', semantics: 'verified' });
  const result = await inspectAndPay(app, 'request-019');
  expect(result.body.execution.reasonCodes).toContain('RISK_UNVERIFIED'); expect(sign).not.toHaveBeenCalled();
});

it('blocks reused authorization identity across different operation IDs', async () => {
  const { app, deps, sign } = await setup();
  const original = deps.authorize;
  deps.authorize = async request => ({ ...(await original(request) as Record<string, unknown>), authorizationId: 'auth-shared' });
  await inspectAndPay(app, 'request-013');
  const second = await inspectAndPay(app, 'request-014');
  expect(second.body.execution.reasonCodes).toContain('AUTHORIZATION_REUSED'); expect(sign).toHaveBeenCalledTimes(1);
});

it('blocks the same operation ID with a changed request ID after restart', async () => {
  const { app, deps, journalPath } = await setup();
  const original = deps.authorize;
  deps.authorize = async request => ({ ...(await original(request) as Record<string, unknown>), operationId: 'shared-operation' });
  await inspectAndPay(app, 'request-015');
  const restarted = await setup({ journalPath });
  const secondOriginal = restarted.deps.authorize;
  restarted.deps.authorize = async request => ({ ...(await secondOriginal(request) as Record<string, unknown>), operationId: 'shared-operation' });
  const second = await inspectAndPay(restarted.app, 'request-016');
  expect(second.body.execution.reasonCodes).toContain('OPERATION_CONFLICT'); expect(restarted.sign).not.toHaveBeenCalled();
});

it.each([null, 'not-json', { settlement: 'settled' }, { settlement: 'failed' }])('treats untrusted submit response %j as unknown', async response => {
  const { app, deps, sign } = await setup();
  deps.submit = vi.fn(async () => response);
  const result = await inspectAndPay(app, 'request-017');
  expect(result.body.execution).toMatchObject({ signing: 'signed', submission: 'unknown', settlement: 'unknown', taskComplete: false });
  expect(sign).toHaveBeenCalledTimes(1);
});

it.each(['preparation', 'journal'])('rechecks risk freshness after %s time crosses the TTL', async stage => {
  let now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const { app, deps, sign } = await setup();
    deps.assess = async () => approvedRiskAt(now);
    if (stage === 'preparation') {
      const original = deps.createSigningInput;
      deps.createSigningInput = async value => { const result = await original(value); now += 61_001; return result; };
    } else deps.afterSigningInputPersisted = async () => { now += 61_001; };
    const result = await inspectAndPay(app, 'request-022');
    expect(result.body.execution.reasonCodes).toContain('RISK_EXPIRED');
    expect(result.body.execution.signing).toBe('not_signed');
    expect(sign).not.toHaveBeenCalled();
  } finally { clock.mockRestore(); }
});

it.each(['preparation', 'journal'])('rechecks authorization expiry after %s', async stage => {
  let now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const { app, deps, sign } = await setup();
    deps.assess = async () => approvedRiskAt(now);
    const originalAuthorization = deps.authorize;
    let mutableAuthorization: Record<string, unknown> | undefined;
    deps.authorize = async request => {
      mutableAuthorization = { ...(await originalAuthorization(request) as Record<string, unknown>), expiresAt: new Date(now + 1000).toISOString() };
      return mutableAuthorization;
    };
    if (stage === 'preparation') {
      const original = deps.createSigningInput;
      deps.createSigningInput = async value => { const result = await original(value); now += 1100; return result; };
    } else deps.afterSigningInputPersisted = async () => {
      // Mutating the callback's old object cannot extend the frozen approved snapshot.
      if (mutableAuthorization) mutableAuthorization.expiresAt = new Date(now + 3_600_000).toISOString();
      now += 1100;
    };
    const result = await inspectAndPay(app, 'request-023');
    expect(result.body.execution.reasonCodes).toContain('AUTHORIZATION_EXPIRED');
    expect(sign).not.toHaveBeenCalled();
  } finally { clock.mockRestore(); }
});

it('rechecks the EIP-3009 validity window after the journal write', async () => {
  let now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const { app, deps, sign } = await setup();
    deps.assess = async () => approvedRiskAt(now);
    const original = deps.authorize;
    deps.authorize = async request => {
      const auth = await original(request) as Record<string, unknown>;
      const data = auth.typedData as ReturnType<typeof typed>;
      data.message.validBefore = Math.floor(now / 1000) + 2;
      return auth;
    };
    deps.afterSigningInputPersisted = async () => { now += 3000; };
    const result = await inspectAndPay(app, 'request-024');
    expect(result.body.execution.reasonCodes).toContain('SIGNING_INPUT_MISMATCH');
    expect(sign).not.toHaveBeenCalled();
  } finally { clock.mockRestore(); }
});

it('reports unknown after a successful signer when the next journal write fails, and restart does not reauthorize', async () => {
  const { app, deps, sign, journalPath } = await setup({ taskBudget: '1000' });
  const folder = dirname(journalPath);
  deps.signTypedData = vi.fn(async () => { await chmod(folder, 0o500); return 'FAKE-SIGNATURE'; });
  try {
    const result = await inspectAndPay(app, 'request-025');
    expect(result.body.execution).toMatchObject({ signing: 'unknown', submission: 'not_submitted',
      settlement: 'not_settled', reasonCodes: ['SIGNING_PERSISTENCE_UNKNOWN'] });
    expect(result.body.execution.signing).not.toBe('not_signed');
  } finally { await chmod(folder, 0o700); }
  expect(deps.signTypedData).toHaveBeenCalledTimes(1);
  const restarted = await setup({ journalPath, taskBudget: '1000' });
  const authorization = vi.fn(restarted.deps.authorize);
  restarted.deps.authorize = authorization;
  const repeat = await inspectAndPay(restarted.app, 'request-025');
  expect(repeat.body.execution.signing).toBe('unknown');
  expect(authorization).not.toHaveBeenCalled(); expect(restarted.sign).not.toHaveBeenCalled();
  const next = await inspectAndPay(restarted.app, 'request-026');
  expect(next.body.execution.reasonCodes).toContain('TASK_BUDGET_EXCEEDED');
});

it('keeps submission and settlement unknown if the final receipt write fails', async () => {
  const { app, deps, journalPath } = await setup({ taskBudget: '1000' });
  const folder = dirname(journalPath);
  const originalSubmit = deps.submit;
  deps.submit = async (quote, signature, operationId) => {
    const receipt = await originalSubmit(quote, signature, operationId);
    await chmod(folder, 0o500);
    return receipt;
  };
  try {
    const result = await inspectAndPay(app, 'request-027');
    expect(result.body.execution).toMatchObject({ signing: 'signed', submission: 'unknown', settlement: 'unknown', taskComplete: false });
  } finally { await chmod(folder, 0o700); }
  const restarted = await setup({ journalPath, taskBudget: '1000' });
  const authorization = vi.fn(restarted.deps.authorize);
  restarted.deps.authorize = authorization;
  const repeat = await inspectAndPay(restarted.app, 'request-027');
  expect(repeat.body.execution).toMatchObject({ signing: 'signed', submission: 'unknown', settlement: 'unknown' });
  expect(authorization).not.toHaveBeenCalled(); expect(restarted.sign).not.toHaveBeenCalled();
});
