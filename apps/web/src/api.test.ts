import { expect, it } from 'vitest';
import { displayAmount, isHealth, isPurchase } from './api.ts';
it('formats atomic values without floating point rounding', () => {
  expect(displayAmount('1000')).toBe('0.001'); expect(displayAmount('1')).toBe('0.000001');
  expect(displayAmount('1000000')).toBe('1'); expect(displayAmount('01000')).toBe('Invalid amount');
});
it('does not accept incomplete or invalid server state', () => {
  expect(isPurchase({ status: 'paid' })).toBe(false); expect(isPurchase(null)).toBe(false);
  expect(isHealth({ seller: { ready: true } })).toBe(false);
  const result = { requestId: 'request-0001', status: 'held', decision: 'hold', reasons: ['未扫描'], events: [], counters: { sign: 0, settle: 0 }, paymentEnabled: false, aiMode: 'not_configured' };
  expect(isPurchase(result)).toBe(true);
  expect(isPurchase({ ...result, counters: { sign: -1, settle: 0 } })).toBe(false);
  expect(isPurchase({ ...result, reasons: [null] })).toBe(false);
  expect(isPurchase({ ...result, events: [{}] })).toBe(false);
});
const valid = { requestId: 'request-0001', status: 'held', decision: 'hold', reasons: ['未扫描'], events: [], counters: { sign: 0, settle: 0 }, paymentEnabled: false, aiMode: 'not_configured', risk: { decision: 'hold', source: 'unavailable', reasons: ['未扫描'], address: '0x1111111111111111111111111111111111111111', checkedAt: '2026-09-26T00:00:00Z', provider: 'intercepta' } };
it.each(['status', 'decision', 'aiMode'])('rejects coerced top-level enum %s', key => {
  const value = valid[key as keyof typeof valid];
  for (const invalid of [[value], {}, 0, null]) expect(isPurchase({ ...valid, [key]: invalid })).toBe(false);
});
it.each(['decision', 'source'])('rejects coerced risk enum %s', key => {
  const value = valid.risk[key as keyof typeof valid.risk];
  for (const invalid of [[value], {}, 0, null]) expect(isPurchase({ ...valid, risk: { ...valid.risk, [key]: invalid } })).toBe(false);
});
it('accepts the literal unknown state without coercion for the UI retry lock', () => {
  expect(isPurchase({ ...valid, status: 'settlement_unknown' })).toBe(true);
  expect(isPurchase({ ...valid, status: ['settlement_unknown'] })).toBe(false);
});
it('rejects malformed scan facts instead of reporting receipt', () => {
  const risk = { ...valid.risk, address: '0x1111111111111111111111111111111111111111', checkedAt: '2026-09-26T00:00:00.000Z', provider: 'intercepta', scan: { transport: 'received', coverage: 'unverified', semantics: 'unverified', requestedNetwork: 'eip155:84532', toxicScore: 0, traitsCount: 0 } };
  expect(isPurchase({ ...valid, risk })).toBe(true);
  for (const delta of [{ transport: ['received'] }, { toxicScore: Infinity }, { toxicScore: '0' }, { traitsCount: 1 }, { coverage: 'verified' }, { semantics: 'safe' }, { requestedNetwork: 1 }]) expect(isPurchase({ ...valid, risk: { ...risk, scan: { ...risk.scan, ...delta } } })).toBe(false);
});

it.each(['address', 'checkedAt', 'provider'])('rejects invalid risk %s even without scan metadata', key => {
  for (const value of [{}, [], null, undefined]) expect(isPurchase({ ...valid, risk: { ...valid.risk, [key]: value } })).toBe(false);
});
