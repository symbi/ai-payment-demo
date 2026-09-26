import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';
import { type TaskGrant, TASK_GRANT_REVISION } from '../../../shared/task-grant.ts';
import { checkTaskGrantIntent, type TaskPaymentIntent } from './task-grant-intent.ts';

// Fail if this standalone check ever imports execution or risk components.
vi.mock('./protected-payment.ts', () => { throw new Error('Synthetic test: payment core forbidden'); });
vi.mock('./production-payment.ts', () => { throw new Error('Synthetic test: production payment forbidden'); });
vi.mock('./service.ts', () => { throw new Error('Synthetic test: service forbidden'); });
vi.mock('./intercepta.ts', () => { throw new Error('Synthetic test: risk service forbidden'); });

// SYNTHETIC offline fixtures: no real task, account ownership or authorization asserted.
const grant: TaskGrant = {
  grantId: 'synthetic-grant-21', version: 1, taskId: 'synthetic-task', agentId: 'synthetic-agent',
  account: `0x${'ab'.repeat(20)}`, payTo: `0x${'cd'.repeat(20)}`,
  network: TEST_NETWORK, asset: TEST_USDC, resource: RESOURCE_PATH,
  totalBudgetAtomic: '10000', perTransactionAtomic: '1000', validForMinutes: 30, confirmed: true,
  createdAt: '2026-09-27T00:00:00.000Z', expiresAt: '2026-09-27T00:30:00.000Z',
};
const intent: TaskPaymentIntent = {
  taskId: grant.taskId, agentId: grant.agentId, account: grant.account, payTo: grant.payTo,
  network: grant.network, asset: grant.asset, resource: grant.resource, amountAtomic: '1000',
};
const now = new Date('2026-09-27T00:15:00.000Z');
const check = (g: unknown = grant, i: unknown = intent, time: Date = now) => checkTaskGrantIntent(g, i, time);
const uppercaseAddress = (address: string) => `0x${address.slice(2).toUpperCase()}`;
const reverseKeys = (value: object) => Object.fromEntries(Object.entries(value).reverse());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('synthetic offline TaskGrant intent binding', () => {
  it('passes only the local scope check with a deterministic, domain-separated digest', () => {
    const result = check();
    const expected = createHash('sha256').update(JSON.stringify([
      'task-grant-intent-v1', TASK_GRANT_REVISION, grant.grantId, 1,
      grant.taskId, grant.agentId, grant.account.toLowerCase(), grant.payTo.toLowerCase(),
      TEST_NETWORK, TEST_USDC.toLowerCase(), RESOURCE_PATH, '10000', '1000', 30, true,
      Date.parse(grant.createdAt), Date.parse(grant.expiresAt), '1000',
    ]), 'utf8').digest('hex');
    expect(result).toEqual({ passed: true, code: 'passed', grantId: grant.grantId, intentHash: expected, paymentEnabled: false });
  });

  it.each([
    ['taskId', 'different-task'], ['agentId', 'different-agent'],
    ['account', `0x${'ef'.repeat(20)}`], ['payTo', `0x${'ef'.repeat(20)}`],
    ['network', 'eip155:1'], ['asset', `0x${'ef'.repeat(20)}`], ['resource', '/different-resource'],
  ])('rejects mismatched %s without a reusable hash', (key, value) => {
    expect(check(grant, { ...intent, [key]: value })).toEqual({
      passed: false, code: 'scope_mismatch', grantId: grant.grantId, intentHash: null, paymentEnabled: false,
    });
  });

  it.each([null, undefined, [], 'intent', {}, { ...intent, extra: true },
    { ...intent, taskId: '' }, { ...intent, agentId: '__proto__' },
    { ...intent, account: `0x${'0'.repeat(40)}` }, { ...intent, payTo: 'invalid' },
    { ...intent, asset: 'invalid' }, { ...intent, resource: null }, { ...intent, network: 84532 },
    ...['0', '-1', '1.5', '01', '1e3', '+1', ' 1', '1 ', '1'.repeat(31), '', 1, Number.MAX_SAFE_INTEGER + 1, 1n]
      .map(amountAtomic => ({ ...intent, amountAtomic })),
  ])('rejects malformed or unsafe intent %#', value => {
    expect(checkTaskGrantIntent(grant, value, now)).toMatchObject({ passed: false, code: 'invalid_intent', intentHash: null, paymentEnabled: false });
  });

  it.each(Object.keys(intent))('rejects missing intent key %s', key => {
    const value: Record<string, unknown> = { ...intent };
    delete value[key];
    expect(check(grant, value).code).toBe('invalid_intent');
  });

  it.each([
    null, [], {}, { ...grant, extra: 'secret-value' }, { ...grant, version: 2 },
    { ...grant, grantId: 'constructor' }, { ...grant, confirmed: false },
    { ...grant, totalBudgetAtomic: '0' }, { ...grant, totalBudgetAtomic: '999' },
    { ...grant, perTransactionAtomic: '-1' }, { ...grant, perTransactionAtomic: '1.2' },
    { ...grant, totalBudgetAtomic: '1'.repeat(31) }, { ...grant, validForMinutes: 0 },
    { ...grant, validForMinutes: 31 }, { ...grant, createdAt: 'invalid' },
    { ...grant, expiresAt: 'invalid' }, { ...grant, network: 'eip155:1' },
    { ...grant, asset: `0x${'ef'.repeat(20)}` }, { ...grant, resource: '/wrong' },
  ])('strictly rejects invalid saved grant %# before returning its identity', value => {
    expect(check(value)).toEqual({ passed: false, code: 'invalid_grant', grantId: null, intentHash: null, paymentEnabled: false });
  });

  it.each(Object.keys(grant))('rejects missing grant key %s', key => {
    const value: Record<string, unknown> = { ...grant };
    delete value[key];
    expect(check(value).code).toBe('invalid_grant');
  });

  it('rejects symbols, hidden extras and accessors without invoking getters', () => {
    const getter = vi.fn(() => intent.account);
    const accessor = Object.defineProperty({ ...intent }, 'account', { get: getter });
    const hidden = Object.defineProperty({ ...grant }, 'hidden', { value: true });
    expect(check(grant, accessor).code).toBe('invalid_intent');
    expect(check(grant, { ...intent, [Symbol('extra')]: true }).code).toBe('invalid_intent');
    expect(check(hidden).code).toBe('invalid_grant');
    expect(getter).not.toHaveBeenCalled();
  });

  it('accepts exactly the single limit and rejects one atomic unit above it', () => {
    expect(check().passed).toBe(true);
    expect(check(grant, { ...intent, amountAtomic: '1001' })).toMatchObject({
      passed: false, code: 'amount_exceeds_limit', intentHash: null, paymentEnabled: false,
    });
  });

  it('compares bounded decimal strings as exact BigInts, never unsafe JS numbers', () => {
    const large = { ...grant, totalBudgetAtomic: '999999999999999999999999999999', perTransactionAtomic: '9007199254740993' };
    expect(check(large, { ...intent, amountAtomic: '9007199254740993' }).passed).toBe(true);
    expect(check(large, { ...intent, amountAtomic: '9007199254740994' }).code).toBe('amount_exceeds_limit');
  });

  it.each([
    ['2026-09-26T23:59:59.999Z', 'grant_not_started'],
    ['2026-09-27T00:30:00.000Z', 'grant_expired'],
    ['2026-09-27T00:30:00.001Z', 'grant_expired'], ['invalid', 'invalid_clock'],
  ])('rejects clock %s', (clock, code) => {
    expect(check(grant, intent, new Date(clock))).toMatchObject({ passed: false, code, intentHash: null, paymentEnabled: false });
  });
  it('accepts createdAt and the last millisecond before expiresAt; uses the default clock', () => {
    expect(check(grant, intent, new Date(grant.createdAt)).passed).toBe(true);
    expect(check(grant, intent, new Date(Date.parse(grant.expiresAt) - 1)).passed).toBe(true);
    expect(check(grant, intent, null as unknown as Date).code).toBe('invalid_clock');
    vi.useFakeTimers(); vi.setSystemTime(now);
    expect(checkTaskGrantIntent(grant, intent)).toEqual(check());
  });

  it('normalizes all EVM address casing on both inputs', () => {
    const addresses = { account: uppercaseAddress(grant.account), payTo: uppercaseAddress(grant.payTo), asset: uppercaseAddress(grant.asset) };
    expect(check({ ...grant, ...addresses }, { ...intent, ...addresses })).toEqual(check());
    expect(check(grant, { ...intent, ...addresses })).toEqual(check());
    expect(check({ ...grant, ...addresses })).toEqual(check());
  });
  it('is stable across key order, equivalent time spelling and repeated calls', () => {
    expect(check(reverseKeys(grant), reverseKeys(intent))).toEqual(check());
    expect(check({ ...grant, createdAt: '2026-09-27T09:00:00+09:00', expiresAt: '2026-09-27T09:30:00+09:00' })).toEqual(check());
    expect(check(grant, intent, new Date(Date.parse(now.toISOString()) + 1))).toEqual(check());
  });

  it.each([
    { grantId: 'synthetic-new-grant' }, { totalBudgetAtomic: '10001' }, { perTransactionAtomic: '1001' },
    { validForMinutes: 31, expiresAt: '2026-09-27T00:31:00.000Z' },
    { createdAt: '2026-09-27T00:01:00.000Z', expiresAt: '2026-09-27T00:31:00.000Z' },
  ])('changes the hash for changed valid grant content %# even with the same identity', changes => {
    const result = check({ ...grant, ...changes });
    expect(result.passed).toBe(true);
    expect(result.intentHash).not.toBe(check().intentHash);
  });
  it.each(['taskId', 'agentId', 'account', 'payTo'] as const)('binds changed valid %s scope', key => {
    const value = key === 'taskId' || key === 'agentId' ? 'synthetic-new-id' : `0x${'ef'.repeat(20)}`;
    const result = check({ ...grant, [key]: value }, { ...intent, [key]: value });
    expect(result.passed).toBe(true);
    expect(result.intentHash).not.toBe(check().intentHash);
  });
  it('binds every valid amount change', () => {
    const result = check(grant, { ...intent, amountAtomic: '999' });
    expect(result.passed).toBe(true);
    expect(result.intentHash).not.toBe(check().intentHash);
  });
  it('does not mutate frozen inputs or make fetch calls and never enables payment', () => {
    const fetch = vi.fn(() => { throw new Error('Synthetic offline test: network forbidden'); });
    vi.stubGlobal('fetch', fetch);
    const saved = Object.freeze({ ...grant }), bound = Object.freeze({ ...intent });
    expect(check(saved, bound).paymentEnabled).toBe(false);
    expect(check(saved, { ...bound, amountAtomic: '1001' }).paymentEnabled).toBe(false);
    expect(saved).toEqual(grant); expect(bound).toEqual(intent);
    expect(fetch).not.toHaveBeenCalled();
  });
});
