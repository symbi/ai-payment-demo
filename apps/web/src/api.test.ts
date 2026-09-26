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
  expect(isPurchase({ ...valid, risk: { ...risk, scan: { ...risk.scan, traitsCount: 2, traitLabels: ['known_scammer', 'blacklist'] } } })).toBe(true);
  for (const delta of [{ transport: ['received'] }, { toxicScore: Infinity }, { toxicScore: '0' }, { traitsCount: -1 }, { traitsCount: 1.5 }, { traitsCount: 101 }, { coverage: 'verified' }, { semantics: 'safe' }, { requestedNetwork: 1 }]) expect(isPurchase({ ...valid, risk: { ...risk, scan: { ...risk.scan, ...delta } } })).toBe(false);
});

it('accepts only bounded allowlisted trait labels consistent with the count', () => {
  const scan = { transport: 'received', coverage: 'unverified', semantics: 'unverified', requestedNetwork: 'eip155:84532', toxicScore: 11, traitsCount: 21, traitLabels: Array.from({ length: 20 }, () => 'rug_pull') };
  expect(isPurchase({ ...valid, risk: { ...valid.risk, scan } })).toBe(true);
  for (const delta of [
    { traitLabels: Array.from({ length: 21 }, () => 'rug_pull') }, { traitLabels: ['arbitrary provider text'] },
    { traitLabels: [1] }, { traitLabels: ['rug_pull'], traitsCount: 0 }, { traitLabels: ['rug_pull'], traitsCount: undefined },
  ]) expect(isPurchase({ ...valid, risk: { ...valid.risk, scan: { ...scan, ...delta } } })).toBe(false);
});

it.each(['address', 'checkedAt', 'provider'])('rejects invalid risk %s even without scan metadata', key => {
  for (const value of [{}, [], null, undefined]) expect(isPurchase({ ...valid, risk: { ...valid.risk, [key]: value } })).toBe(false);
});

const execution = { operationId: 'op-1', decision: 'hold', reasonCodes: ['COVERAGE_UNVERIFIED'], reasons: ['Coverage unverified'], evidence: { source: 'live', evidenceId: null, address: null, checkedAt: null, requestedPaymentNetwork: 'eip155:84532', providerEvidenceNetwork: null, coverage: 'unverified', semantics: 'unverified' }, checkedQuoteHash: null, signingInputHash: null, signing: 'not_signed', submission: 'not_submitted', settlement: 'not_settled', retryAllowed: false, taskComplete: false };
const unidentified = { identity: 'unavailable', operationId: null, decision: 'hold', reasonCodes: ['IDENTITY_UNAVAILABLE'], reasons: ['Backend stopped because no trusted operation identity was available.'], evidence: { source: 'unavailable', evidenceId: null, address: null, checkedAt: null, requestedPaymentNetwork: 'eip155:84532', providerEvidenceNetwork: null, coverage: 'unverified', semantics: 'unverified' }, checkedQuoteHash: null, signingInputHash: null, signing: 'unknown', submission: 'unknown', settlement: 'unknown', retryAllowed: false, taskComplete: false };
it('accepts complete execution and nullable evidence without inventing missing fields', () => {
  expect(isPurchase({ ...valid, execution })).toBe(true);
  expect(isPurchase({ ...valid, execution: { ...execution, signing: 'unknown', submission: 'unknown', settlement: 'unknown' } })).toBe(true);
});
it('rejects every omitted execution field and malformed nested field', () => {
  for (const key of Object.keys(execution)) { const partial = { ...execution } as Record<string, unknown>; delete partial[key]; expect(isPurchase({ ...valid, execution: partial }), key).toBe(false); }
  for (const key of Object.keys(execution.evidence)) {
    const partial = { ...execution.evidence } as Record<string, unknown>; delete partial[key];
    expect(isPurchase({ ...valid, execution: { ...execution, evidence: partial } }), key).toBe(false);
    expect(isPurchase({ ...valid, execution: { ...execution, evidence: { ...execution.evidence, [key]: [] } } }), key).toBe(false);
  }
});
it('rejects coerced execution values and impossible completion', () => {
  for (const [key, value] of Object.entries(execution)) expect(isPurchase({ ...valid, execution: { ...execution, [key]: [value] } }), key).toBe(false);
  for (const change of [{ retryAllowed: true }, { taskComplete: true }, { submission: 'submitted' }, { settlement: 'settled' }, { taskComplete: true, signing: 'unknown', settlement: 'settled', submission: 'submitted' }]) expect(isPurchase({ ...valid, execution: { ...execution, ...change } })).toBe(false);
  expect(isPurchase({ ...valid, execution: { ...execution, taskComplete: true, signing: 'signed', submission: 'submitted', settlement: 'settled' } })).toBe(true);
});
it('accepts only the complete unidentified hold outcome', () => {
  expect(isPurchase({ ...valid, execution: unidentified })).toBe(true);
  for (const key of Object.keys(unidentified)) {
    const partial = { ...unidentified } as Record<string, unknown>; delete partial[key];
    expect(isPurchase({ ...valid, execution: partial }), key).toBe(false);
  }
  for (const key of Object.keys(unidentified.evidence)) {
    const partial = { ...unidentified.evidence } as Record<string, unknown>; delete partial[key];
    expect(isPurchase({ ...valid, execution: { ...unidentified, evidence: partial } }), key).toBe(false);
  }
});
it('rejects mixed or fabricated facts in the unidentified branch', () => {
  const changes = [
    { operationId: '' }, { operationId: 'op-invented' }, { identity: '' }, { identity: 'available' }, { decision: 'allow' },
    { reasonCodes: [] }, { reasonCodes: [''] }, { reasons: [] }, { reasons: ['  '] }, { checkedQuoteHash: '' }, { signingInputHash: 'digest' },
    { signing: 'not_signed' }, { signing: 'signed' }, { submission: 'not_submitted' }, { settlement: 'not_settled' },
    { retryAllowed: true }, { taskComplete: true },
  ];
  for (const change of changes) expect(isPurchase({ ...valid, execution: { ...unidentified, ...change } }), JSON.stringify(change)).toBe(false);
  for (const change of [{ source: 'live' }, { evidenceId: '' }, { address: '' }, { checkedAt: '' }, { requestedPaymentNetwork: '' }, { providerEvidenceNetwork: '' }, { coverage: 'verified' }, { semantics: 'verified' }]) {
    expect(isPurchase({ ...valid, execution: { ...unidentified, evidence: { ...unidentified.evidence, ...change } } }), JSON.stringify(change)).toBe(false);
  }
});
it('rejects top-level success claims that contradict unavailable identity', () => {
  for (const change of [{ decision: 'allow' }, { status: 'paid' }, { data: null }, { data: {} }, { transaction: '' }, { transaction: '0xabc' }]) {
    expect(isPurchase({ ...valid, ...change, execution: unidentified }), JSON.stringify(change)).toBe(false);
  }
});
it('keeps identified operation IDs strict and does not use identity as a bypass', () => {
  expect(isPurchase({ ...valid, execution: { ...execution, operationId: '' } })).toBe(false);
  expect(isPurchase({ ...valid, execution: { ...execution, operationId: '   ' } })).toBe(false);
  expect(isPurchase({ ...valid, execution: { ...execution, identity: 'unavailable' } })).toBe(false);
  expect(isPurchase({ ...valid, execution: { ...execution, identity: 'other' } })).toBe(false);
});
