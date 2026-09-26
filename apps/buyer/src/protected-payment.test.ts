import { afterEach, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Duplex } from 'node:stream';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { decodePaymentSignatureHeader, encodePaymentResponseHeader } from '@x402/core/http';
import { TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';
import { isPurchase } from '../../web/src/api.ts';
import { createBuyerApp } from './app.ts';
import { BuyerService } from './service.ts';
import { SellerClient, parseQuote } from './seller.ts';
import { createEmptyPaymentJournal, type TestPaymentDependencies } from './protected-payment.ts';
import { createProductionPaymentAdapter, EXPECTED_SOURCE_SHA256, type PinnedOrder, type SettlementExpectation, type SettlementProof } from './production-payment.ts';

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
    types: { TransferWithAuthorization: [
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
  expect(isPurchase(result.body)).toBe(true);
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
  ['extra domain type', (v: ReturnType<typeof typed>) => { (v.types as Record<string, unknown>).EIP712Domain = []; }],
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
  const originalAuthorization = deps.authorize;
  deps.authorize = async request => ({ ...(await originalAuthorization(request) as Record<string, unknown>),
    operationId: `backend-${request.requestId}` });
  const results = await Promise.all([inspectAndPay(app, 'request-004'), inspectAndPay(app, 'request-005')]);
  expect(results.every(result => isPurchase(result.body))).toBe(true);
  expect(results.every(result => String(result.body.execution?.operationId).startsWith('backend-'))).toBe(true);
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
    expect(isPurchase(first.body)).toBe(true);
    expect(first.body.execution).toMatchObject({ signing, submission, taskComplete: false });
    const restarted = await setup({ journalPath, taskBudget: '1000' });
    const authorization = vi.fn(restarted.deps.authorize);
    restarted.deps.authorize = authorization;
    const repeat = await inspectAndPay(restarted.app, 'request-006');
    expect(isPurchase(repeat.body)).toBe(true);
    expect(repeat.body.execution).toMatchObject({ signing, submission });
    expect(authorization).not.toHaveBeenCalled();
    const next = await inspectAndPay(restarted.app, 'request-007');
    expect(isPurchase(next.body)).toBe(true);
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
  expect(isPurchase(result.body)).toBe(true);
  expect(result.body.execution).toMatchObject({ settlement: 'settled', taskComplete: false, reasonCodes: ['REPORT_INVALID'] });
  await post(app, '/api/pay', { requestId: 'request-008' }); expect(sign).toHaveBeenCalledTimes(1);
});

it('fails closed on missing or corrupt durable journal', async () => {
  const { app, sign, journalPath } = await setup();
  await rm(journalPath);
  const result = await inspectAndPay(app, 'request-009');
  // No operation identity or proven unsigned state exists before journal recovery.
  expect(result.body.status).toBe('settlement_unknown');
  expect(result.body.execution).toMatchObject({ identity: 'unavailable', operationId: null,
    decision: 'hold', signing: 'unknown', submission: 'unknown', settlement: 'unknown',
    checkedQuoteHash: null, signingInputHash: null, taskComplete: false, retryAllowed: false });
  expect(result.body.execution.evidence).toMatchObject({ source: 'unavailable', evidenceId: null,
    coverage: 'unverified', semantics: 'unverified' });
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
  const originalAuthorization = deps.authorize;
  deps.authorize = async request => ({ ...(await originalAuthorization(request) as Record<string, unknown>), operationId: 'backend-op-risk-001' });
  deps.assess = async () => ({ source: 'fixture', decision: 'allow', evidenceId: 'fixture-001', address: payTo,
    checkedAt: new Date().toISOString(), requestedNetwork: TEST_NETWORK, coverage: 'unverified', semantics: 'unverified' });
  const result = await inspectAndPay(app, 'request-012');
  expect(isPurchase(result.body)).toBe(true);
  expect(result.body.execution.operationId).toBe('backend-op-risk-001');
  expect(result.body.execution.reasonCodes).toContain('RISK_UNVERIFIED'); expect(sign).not.toHaveBeenCalled();
});

it('keeps an unreserved risk rejection distinct from a new authorization after restart', async () => {
  const first = await setup();
  const firstAuthorization = first.deps.authorize;
  first.deps.authorize = async request => ({ ...(await firstAuthorization(request) as Record<string, unknown>), operationId: 'backend-risk-first' });
  first.deps.assess = async () => ({ source: 'fixture', decision: 'hold', evidenceId: 'fixture-001', address: payTo,
    checkedAt: new Date().toISOString(), requestedNetwork: TEST_NETWORK, coverage: 'unverified', semantics: 'unverified' });
  const stopped = await inspectAndPay(first.app, 'request-030');
  expect(isPurchase(stopped.body)).toBe(true);
  expect(stopped.body.execution).toMatchObject({ operationId: 'backend-risk-first', reasonCodes: ['RISK_UNVERIFIED'], signing: 'not_signed' });
  const restarted = await setup({ journalPath: first.journalPath });
  const nextAuthorization = restarted.deps.authorize;
  restarted.deps.authorize = async request => ({ ...(await nextAuthorization(request) as Record<string, unknown>), operationId: 'backend-risk-second' });
  restarted.deps.assess = first.deps.assess;
  const checkedAgain = await inspectAndPay(restarted.app, 'request-030');
  expect(isPurchase(checkedAgain.body)).toBe(true);
  expect(checkedAgain.body.execution).toMatchObject({ operationId: 'backend-risk-second', reasonCodes: ['RISK_UNVERIFIED'], signing: 'not_signed' });
  expect(first.sign).not.toHaveBeenCalled(); expect(restarted.sign).not.toHaveBeenCalled();
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

it('does not label a risk stop with another request’s previously executed operation', async () => {
  const { app, deps, sign } = await setup();
  const originalAuthorization = deps.authorize;
  deps.authorize = async request => ({ ...(await originalAuthorization(request) as Record<string, unknown>), operationId: 'backend-shared-operation' });
  const first = await inspectAndPay(app, 'request-028');
  expect(first.body.execution?.taskComplete).toBe(true);
  deps.assess = async () => ({ source: 'fixture', decision: 'allow', evidenceId: 'fixture-001', address: payTo,
    checkedAt: new Date().toISOString(), requestedNetwork: TEST_NETWORK, coverage: 'unverified', semantics: 'unverified' });
  const collision = await inspectAndPay(app, 'request-029');
  expect(collision.body.execution.reasonCodes).toContain('OPERATION_CONFLICT');
  expect(collision.body.execution).toMatchObject({ identity: 'unavailable', operationId: null,
    signing: 'unknown', submission: 'unknown', settlement: 'unknown', retryAllowed: false });
  expect(sign).toHaveBeenCalledTimes(1);
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
    expect(isPurchase(result.body)).toBe(true);
    expect(result.body.execution).toMatchObject({ signing: 'unknown', submission: 'not_submitted',
      settlement: 'not_settled', reasonCodes: ['SIGNING_PERSISTENCE_UNKNOWN'] });
    expect(result.body.execution.signing).not.toBe('not_signed');
  } finally { await chmod(folder, 0o700); }
  expect(deps.signTypedData).toHaveBeenCalledTimes(1);
  const restarted = await setup({ journalPath, taskBudget: '1000' });
  const authorization = vi.fn(restarted.deps.authorize);
  restarted.deps.authorize = authorization;
  const repeat = await inspectAndPay(restarted.app, 'request-025');
  expect(isPurchase(repeat.body)).toBe(true);
  expect(repeat.body.execution.signing).toBe('unknown');
  expect(authorization).not.toHaveBeenCalled(); expect(restarted.sign).not.toHaveBeenCalled();
  const next = await inspectAndPay(restarted.app, 'request-026');
  expect(isPurchase(next.body)).toBe(true);
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

function paidReport() {
  return { kind: 'paid-structure-report', schemaVersion: 'contract-insights/v1', sampleName: 'ExampleVault',
    source: { filename: 'ExampleVault.sol', path: 'apps/seller/samples/ExampleVault.sol', sha256: EXPECTED_SOURCE_SHA256,
      language: 'Solidity', origin: 'bundled-demo' },
    metrics: [
      { key: 'functions', label: 'Functions', value: 0 },
      { key: 'events', label: 'Events', value: 0 },
      { key: 'modifiers', label: 'Modifiers', value: 0 },
    ], declarations: { functions: [], events: [], modifiers: [] },
    method: 'offline fixture', limitations: ['Not a security audit.'] };
}

async function productionAdapterRoute(options: { proof?: boolean; report?: unknown; operationId?: string;
  journalPath?: string; receiptPayer?: string } = {}) {
  const folder = options.journalPath ? undefined : await mkdtemp(join(tmpdir(), '03a-pay-r6-'));
  if (folder) folders.push(folder);
  const journalPath = options.journalPath ?? join(folder!, 'payment-journal.json');
  if (!options.journalPath) await createEmptyPaymentJournal(journalPath);
  const operationId = options.operationId ?? 'request-r6-001';
  const description = 'Contract Insights: bundled Solidity sample declaration report; not a security audit';
  const order: PinnedOrder = { orderId: 'order-0001', sellerOrigin: origin, resourceUrl: resource,
    resource: { url: resource, description, mimeType: 'application/json' },
    expectedSourceSha256: EXPECTED_SOURCE_SHA256, wallet,
    requirements: { scheme: 'exact', network: TEST_NETWORK, asset: TEST_USDC, amount: '1000', payTo,
      maxTimeoutSeconds: 300, extra: { name: 'USDC', version: '2' } } };
  const seller = new SellerClient(origin, vi.fn<typeof fetch>(async () => new Response(null, { status: 402,
    headers: { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify({ x402Version: 2,
      accepts: [order.requirements], resource: order.resource })).toString('base64') } })));
  const preparedQuote = parseQuote({ x402Version: 2, accepts: [order.requirements], resource: order.resource });
  const sign = vi.fn(async (_input: unknown): Promise<`0x${string}`> => `0x${'a'.repeat(130)}`);
  let headerPayload: ReturnType<typeof decodePaymentSignatureHeader> | undefined;
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe(resource);
    expect(init?.method).toBe('GET');
    const header = new Headers(init?.headers).get('PAYMENT-SIGNATURE');
    expect(header).toBeTruthy();
    headerPayload = decodePaymentSignatureHeader(header!);
    return Response.json(options.report ?? paidReport(), { headers: { 'PAYMENT-RESPONSE': encodePaymentResponseHeader({
      success: true, transaction: `0x${'b'.repeat(64)}`, network: TEST_NETWORK,
      ...(options.receiptPayer ? { payer: options.receiptPayer } : {}),
    }) } });
  });
  const verifySettlement = vi.fn(async (_receipt: unknown, _order: Readonly<PinnedOrder>, expectation: Readonly<SettlementExpectation>): Promise<SettlementProof> => ({
    verified: true, orderId: order.orderId, operationId: expectation.operationId,
    transaction: `0x${'b'.repeat(64)}`, network: TEST_NETWORK, asset: TEST_USDC, payTo, amount: '1000',
    // Controlled positive fixture only. A real verifier must obtain both fields from the transaction.
    observedAuthorization: expectation.authorization, observedSignature: expectation.signature }));
  const adapter = createProductionPaymentAdapter(order, { signer: { address: wallet as `0x${string}`, signTypedData: sign },
    fetcher, ...(options.proof === false ? {} : { verifySettlement }) });
  const prepared = await adapter.prepare(preparedQuote, operationId);
  const authorize = vi.fn(async (request: Parameters<TestPaymentDependencies['authorize']>[0]) => ({ ...request, taskId: 'task-0001',
    operationId: request.requestId, authorizationId: `auth-${request.requestId}`, wallet,
    expiresAt: new Date(Date.now() + 60_000).toISOString(), taskBudgetAtomic: '1000', typedData: prepared.typedData }));
  const deps: TestPaymentDependencies = { testFixtureOnly: true, journalPath,
    authorize,
    // An explicit backend test fixture is the only allow source here; no live risk policy exists.
    assess: async () => approvedRiskAt(Date.now()),
    createSigningInput: async approved => structuredClone(approved),
    signTypedData: actual => adapter.signPrepared(prepared, actual),
    submit: (_quote, signature, operationId) => adapter.submit(prepared, signature, operationId),
    validateReport: value => adapter.validateReport(value) };
  const app = createBuyerApp(config, new BuyerService(config, seller, undefined, deps));
  return { app, sign, fetcher, verifySettlement, adapter, prepared, preparedQuote, order, operationId, journalPath,
    authorize, getHeaderPayload: () => headerPayload };
}

it('uses one SDK signing snapshot through the Express final gate and the fixed x402 header', async () => {
  const { app, sign, fetcher, verifySettlement, prepared, order, getHeaderPayload } = await productionAdapterRoute();
  const result = await inspectAndPay(app, 'request-r6-001');
  expect(result.body.execution).toMatchObject({ signing: 'signed', submission: 'submitted', settlement: 'settled', taskComplete: true });
  expect(sign).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1); expect(verifySettlement).toHaveBeenCalledTimes(1);
  expect(sign.mock.calls[0][0]).toEqual(prepared.typedData);
  expect(Object.isFrozen(sign.mock.calls[0][0])).toBe(true);
  const payload = getHeaderPayload();
  expect(payload?.accepted).toEqual(order.requirements);
  expect(payload?.resource).toEqual(order.resource);
  expect(payload?.payload).toEqual({ authorization: prepared.authorization, signature: `0x${'a'.repeat(130)}` });
  expect(JSON.stringify(result.body)).not.toContain('a'.repeat(130));
});

it('retains unknown settlement without an independent proof even when a signer is injected', async () => {
  const { app, sign, fetcher } = await productionAdapterRoute({ proof: false, operationId: 'request-r6-002' });
  const result = await inspectAndPay(app, 'request-r6-002');
  expect(result.body.execution).toMatchObject({ signing: 'signed', submission: 'unknown', settlement: 'unknown', taskComplete: false });
  expect(sign).toHaveBeenCalledTimes(1); expect(fetcher).not.toHaveBeenCalled();
});

it('keeps a settled order incomplete when the pinned report source hash is wrong', async () => {
  const report = paidReport(); report.source.sha256 = '0'.repeat(64);
  const { app, sign } = await productionAdapterRoute({ report, operationId: 'request-r6-003' });
  const result = await inspectAndPay(app, 'request-r6-003');
  expect(result.body.execution).toMatchObject({ signing: 'signed', settlement: 'settled', taskComplete: false,
    reasonCodes: ['REPORT_INVALID'] });
  expect(sign).toHaveBeenCalledTimes(1);
});

it.each(['recipient', 'amount', 'resource'])('rejects a %s change after the order is pinned without signing', async field => {
  const { adapter, preparedQuote, prepared, sign } = await productionAdapterRoute();
  const changed = structuredClone(preparedQuote);
  const full = changed.full as { accepts: PinnedOrder['requirements'][]; resource: PinnedOrder['resource'] };
  if (field === 'recipient') full.accepts[0].payTo = wallet;
  else if (field === 'amount') full.accepts[0].amount = '999';
  else full.resource.description = 'Changed paid resource';
  await expect(adapter.prepare(changed, 'request-r6-001')).rejects.toThrow('Quote differs from pinned order');
  const changedInput = structuredClone(prepared.typedData) as { message: { value: bigint } };
  changedInput.message.value = 999n;
  expect(() => adapter.signPrepared(prepared, changedInput)).toThrow('Final signing input differs');
  expect(sign).not.toHaveBeenCalled();
});

it('does not settle a second SDK nonce using the first transaction proof, even with a matching operation label', async () => {
  const { adapter, prepared, preparedQuote, verifySettlement, fetcher, sign } = await productionAdapterRoute({ operationId: 'operation-first' });
  const second = await adapter.prepare(preparedQuote, 'operation-second');
  expect(second.authorization.nonce).not.toBe(prepared.authorization.nonce);
  sign.mockImplementation(async input => {
    const nonce = (input as { message: { nonce: string } }).message.nonce;
    return `0x${nonce.slice(2)}${'a'.repeat(66)}`;
  });
  let firstProof: SettlementProof | undefined;
  verifySettlement.mockImplementation(async (_receipt, _order, expected) => {
    if (!firstProof) {
      firstProof = { verified: true, orderId: expected.orderId, operationId: expected.operationId,
        transaction: `0x${'b'.repeat(64)}`, network: TEST_NETWORK, asset: TEST_USDC, payTo, amount: '1000',
        observedAuthorization: expected.authorization, observedSignature: expected.signature };
      return firstProof;
    }
    // The old transaction's observed authorization/signature cannot prove the new payment.
    return { ...firstProof, operationId: expected.operationId };
  });
  const firstSignature = await adapter.signPrepared(prepared, prepared.typedData);
  const secondSignature = await adapter.signPrepared(second, second.typedData);
  const wrongOperation = await adapter.submit(prepared, firstSignature, 'operation-second') as { settlement: string };
  expect(wrongOperation.settlement).toBe('unknown'); expect(fetcher).not.toHaveBeenCalled();
  const first = await adapter.submit(prepared, firstSignature, 'operation-first') as { settlement: string };
  const replay = await adapter.submit(second, secondSignature, 'operation-second') as { settlement: string };
  expect(first.settlement).toBe('settled'); expect(replay.settlement).toBe('unknown');
  expect(verifySettlement.mock.calls[0][2].authorization.nonce).not.toBe(verifySettlement.mock.calls[1][2].authorization.nonce);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(sign).toHaveBeenCalledTimes(2);
});

it('keeps settlement unknown when the receipt payer or observed authorization differs', async () => {
  const receiptMismatch = await productionAdapterRoute({ operationId: 'request-r6-004', receiptPayer: payTo });
  const badReceipt = await inspectAndPay(receiptMismatch.app, 'request-r6-004');
  expect(badReceipt.body.execution).toMatchObject({ signing: 'signed', settlement: 'unknown', taskComplete: false });
  expect(receiptMismatch.verifySettlement).not.toHaveBeenCalled();

  const proofMismatch = await productionAdapterRoute({ operationId: 'request-r6-005' });
  proofMismatch.verifySettlement.mockResolvedValue({ verified: true, orderId: proofMismatch.order.orderId,
    operationId: 'request-r6-005', transaction: `0x${'b'.repeat(64)}`, network: TEST_NETWORK,
    asset: TEST_USDC, payTo, amount: '1000',
    observedAuthorization: { ...proofMismatch.prepared.authorization, nonce: `0x${'0'.repeat(64)}` },
    observedSignature: `0x${'a'.repeat(130)}` });
  const badAuthorization = await inspectAndPay(proofMismatch.app, 'request-r6-005');
  expect(badAuthorization.body.execution).toMatchObject({ signing: 'signed', settlement: 'unknown', taskComplete: false });
  expect(proofMismatch.verifySettlement).toHaveBeenCalledTimes(1);
});

it('reuses a settled journal operation on repeated query and restart without authorization, signing or submission', async () => {
  const first = await productionAdapterRoute({ operationId: 'request-r6-006' });
  const paid = await inspectAndPay(first.app, 'request-r6-006');
  expect(paid.body.execution?.taskComplete).toBe(true);
  const repeat = await post(first.app, '/api/pay', { requestId: 'request-r6-006' });
  expect(repeat.body.execution?.taskComplete).toBe(true);
  expect(first.authorize).toHaveBeenCalledTimes(1); expect(first.sign).toHaveBeenCalledTimes(1);
  expect(first.fetcher).toHaveBeenCalledTimes(1);
  const restarted = await productionAdapterRoute({ operationId: 'request-r6-006', journalPath: first.journalPath });
  const afterRestart = await inspectAndPay(restarted.app, 'request-r6-006');
  expect(afterRestart.body.execution?.taskComplete).toBe(true);
  expect(restarted.authorize).not.toHaveBeenCalled(); expect(restarted.sign).not.toHaveBeenCalled();
  expect(restarted.fetcher).not.toHaveBeenCalled();
});

it('retains unknown on restart without reauthorizing, resigning or submitting', async () => {
  const first = await productionAdapterRoute({ operationId: 'request-r6-007', proof: false });
  const unknown = await inspectAndPay(first.app, 'request-r6-007');
  expect(unknown.body.execution).toMatchObject({ signing: 'signed', settlement: 'unknown', taskComplete: false });
  await post(first.app, '/api/pay', { requestId: 'request-r6-007' });
  expect(first.authorize).toHaveBeenCalledTimes(1); expect(first.sign).toHaveBeenCalledTimes(1);
  expect(first.fetcher).not.toHaveBeenCalled();
  const restarted = await productionAdapterRoute({ operationId: 'request-r6-007', journalPath: first.journalPath });
  const afterRestart = await inspectAndPay(restarted.app, 'request-r6-007');
  expect(afterRestart.body.execution).toMatchObject({ signing: 'signed', settlement: 'unknown', taskComplete: false });
  expect(restarted.authorize).not.toHaveBeenCalled(); expect(restarted.sign).not.toHaveBeenCalled();
  expect(restarted.fetcher).not.toHaveBeenCalled();
});
