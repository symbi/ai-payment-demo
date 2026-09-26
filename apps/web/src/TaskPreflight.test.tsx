import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { TEST_USDC, type PurchaseResult, type ProtectedPaymentOutcome } from '../../../shared/contracts.ts';
import { TASK_PREFLIGHT_REVISION, type TaskPaymentPreflight } from '../../../shared/task-payment-preflight.ts';
import { isPurchase } from './api.ts';
import { LivePaymentCheck } from './LivePaymentCheck.tsx';

const base: PurchaseResult = {
  requestId: 'request-preflight', status: 'held', decision: 'hold', reasons: ['Permission scope checked'],
  terms: { scheme: 'exact', network: 'eip155:84532', asset: TEST_USDC, amount: '1000', payTo: '0x2222222222222222222222222222222222222222' },
  events: [], counters: { sign: 0, settle: 0 }, paymentEnabled: false, aiMode: 'not_configured',
};
const passed: TaskPaymentPreflight = {
  contractRevision: TASK_PREFLIGHT_REVISION, passed: true, code: 'passed', grantId: 'grant-preflight',
  intentHash: 'a'.repeat(64), amountAtomic: '1000', paymentEnabled: false, executionConnected: false,
};
const paused: TaskPaymentPreflight = {
  contractRevision: TASK_PREFLIGHT_REVISION, passed: false, code: 'scope_mismatch', grantId: null,
  intentHash: null, amountAtomic: null, paymentEnabled: false, executionConnected: false,
};
const identifiedExecution: ProtectedPaymentOutcome = {
  operationId: 'op-1', decision: 'hold', reasonCodes: ['COVERAGE_UNVERIFIED'], reasons: ['Coverage unverified'],
  evidence: { source: 'live', evidenceId: null, address: null, checkedAt: null, requestedPaymentNetwork: 'eip155:84532', providerEvidenceNetwork: null, coverage: 'unverified', semantics: 'unverified' },
  checkedQuoteHash: null, signingInputHash: null, signing: 'not_signed', submission: 'not_submitted', settlement: 'not_settled', retryAllowed: false, taskComplete: false,
};
const props = (result: PurchaseResult, overrides: Partial<Parameters<typeof LivePaymentCheck>[0]> = {}) => ({
  result, uncertain: false, requestId: result.requestId, busy: '', error: '', serviceReady: true, canCheck: true, checked: true, paymentDisabled: true,
  onQuote: vi.fn(), onCheck: vi.fn(), onQuery: vi.fn(), onRequest: vi.fn(), onServices: vi.fn(), onScenario: vi.fn(), onDetails: vi.fn(), ...overrides,
});

it('accepts a bounded passing preflight and renders only scope facts with explicit capability limits', () => {
  const result = { ...base, grantPreflight: passed };
  expect(isPurchase(result)).toBe(true);
  const html = renderToStaticMarkup(createElement(LivePaymentCheck, props(result)));
  expect(html).toContain('Passed · Scope only');
  expect(html).toContain('Reason code: passed · Scope matched');
  expect(html).toContain('grant-preflight'); expect(html).toContain('a'.repeat(64)); expect(html).toContain('1000</code> atomic');
  expect(html).toContain('not remaining budget, risk approval, payment, or execution permission');
  expect(html).toContain('Unknown · Remaining budget not connected');
  expect(html).toContain('Signature: <strong>Unknown · Not reported</strong>');
});

it('renders a bounded pause code without exposing passing-only identifiers', () => {
  const result = { ...base, grantPreflight: paused };
  expect(isPurchase(result)).toBe(true);
  const html = renderToStaticMarkup(createElement(LivePaymentCheck, props(result)));
  expect(html).toContain('Paused · Scope check did not pass');
  expect(html).toContain('Reason code: scope_mismatch · Task permission does not match this scope');
  expect(html).not.toContain('grant-preflight'); expect(html).not.toContain('a'.repeat(64));
  expect(html).not.toContain('&quot;grantId&quot;'); expect(html).not.toContain('&quot;intentHash&quot;'); expect(html).not.toContain('&quot;amountAtomic&quot;');
});

it('preserves a legacy response with no preflight and does not invent execution state', () => {
  expect(isPurchase(base)).toBe(true);
  const html = renderToStaticMarkup(createElement(LivePaymentCheck, props(base)));
  expect(html).toContain('Not reported · Legacy response');
  expect(html).toContain('Signature: <strong>Unknown · Not reported</strong>');
  expect(html).toContain('Settlement: <strong>Unknown · Not reported</strong>');
});

it('rejects invalid or unbounded preflight DTOs', () => {
  expect(isPurchase({ ...base, grantPreflight: { ...paused, code: 'provider free text' } })).toBe(false);
  expect(isPurchase({ ...base, grantPreflight: { ...passed, extra: 'not public' } })).toBe(false);
  expect(isPurchase({ ...base, grantPreflight: undefined })).toBe(false);
  expect(isPurchase({ ...base, grantPreflight: passed, execution: undefined })).toBe(false);
});

it('rejects a forged parent execution claim or amount mismatch around a valid preflight', () => {
  expect(isPurchase({ ...base, grantPreflight: passed, execution: identifiedExecution })).toBe(false);
  expect(isPurchase({ ...base, terms: { ...base.terms!, amount: '2000' }, grantPreflight: passed })).toBe(false);
  expect(isPurchase({ ...base, grantPreflight: passed, data: {} })).toBe(false);
  expect(isPurchase({ ...base, grantPreflight: passed, transaction: '0xabc' })).toBe(false);
});

it.each([
  { status: 'quoted' }, { decision: 'allow' }, { paymentEnabled: true },
  { counters: { sign: 1, settle: 0 } }, { counters: { sign: 0, settle: 1 } },
])('requires a held, disabled and untouched parent response: %o', change => {
  expect(isPurchase({ ...base, grantPreflight: paused, ...change })).toBe(false);
});

it.each([{ uncertain: true, busy: '' }, { uncertain: false, busy: 'pay' }])('hides a previous pass while current state is stale or busy: %o', state => {
  const result = { ...base, grantPreflight: passed };
  const html = renderToStaticMarkup(createElement(LivePaymentCheck, props(result, state)));
  expect(html).toContain('Unknown · Previous result is not current');
  expect(html).not.toContain('grant-preflight'); expect(html).not.toContain('a'.repeat(64));
  expect(html).not.toContain('&quot;grantPreflight&quot;');
});
