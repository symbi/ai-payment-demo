import { describe, expect, it, vi } from 'vitest';
import { normalizeInterceptaEvidence, normalizeSyntheticEvidence } from './risk-evidence-adapters.ts';
import { evaluatePaymentPolicy, type LivePaymentPolicyResult } from './payment-policy.ts';
import { evaluateLivePaymentPolicy, evaluateSyntheticPaymentPolicy } from './live-payment-policy.ts';
import { isPrivateScanRecord, PRIVATE_RISK_CANDIDATES } from './private-risk.ts';
import { POLICY_SCENARIOS } from './policy-scenarios.ts';

type Input = {
  synthetic: true; toxicScore: number; traitsCount: number;
  traitLabels: string[]; unknownTraitsCount?: number;
};
const input = (traitLabels: string[] = ['mixer_transfers'], patch: Partial<Input> = {}): Input => ({
  synthetic: true, toxicScore: 50, traitsCount: traitLabels.length,
  traitLabels: [...traitLabels], unknownTraitsCount: 0, ...patch,
});

// TEST ONLY: in-memory regression envelope for the existing validator, never a
// scan, provider observation, saved record, sandbox card or external request.
function offlineRecord(evidence: Input = input()) {
  return {
    candidateId: 'H1', state: 'completed', attemptedAt: '2026-09-27T01:00:00.000Z',
    risk: {
      address: PRIVATE_RISK_CANDIDATES.find(candidate => candidate.id === 'H1')!.address,
      checkedAt: '2026-09-27T01:00:01.000Z', provider: 'intercepta', source: 'live',
      decision: 'hold', reasons: ['Offline synthetic unit-test fixture only.'],
      scan: {
        transport: 'received', httpStatus: 200, requestedNetwork: 'eip155:1',
        coverage: 'unverified', semantics: 'unverified', toxicScore: evidence.toxicScore,
        traitsCount: evidence.traitsCount, traitLabels: [...evidence.traitLabels],
        ...(Object.hasOwn(evidence, 'unknownTraitsCount') ? { unknownTraitsCount: evidence.unknownTraitsCount } : {}),
      },
    },
  };
}
const expected = (
  decision: LivePaymentPolicyResult['decision'], reasonCode: LivePaymentPolicyResult['reasonCode'],
  amountWithinLimit = false, capUsdc: LivePaymentPolicyResult['capUsdc'] = null,
): LivePaymentPolicyResult => ({
  policyRevision: 'project-intercepta-payment-policy-v1', policyName: 'Project/Intercepta Payment Policy v1',
  decision, reasonCode, capUsdc, amountWithinLimit, execution: 'NOT_CONNECTED',
});
const limited = expected('ALLOW_WITH_LIMIT', 'moderate_trait', true, '0.001');
const over = expected('ALLOW_WITH_LIMIT', 'moderate_trait', false, '0.001');
const deny = expected('DENY', 'hard_deny_trait');
const unknown = expected('HOLD', 'unknown_traits');
const incomplete = expected('HOLD', 'incomplete_traits');
const unmapped = expected('HOLD', 'unmapped_trait');
const allow = expected('ALLOW', 'no_traits', true);
const missing = expected('HOLD', 'evidence_unavailable');
const invalid = expected('HOLD', 'invalid_amount');
const unavailable = (origin: 'LIVE' | 'SYNTHETIC') => ({
  origin, provider: origin === 'LIVE' ? 'intercepta' : 'synthetic', available: false,
  traits: [], traitsCount: null, unknownTraitsCount: null, complete: false,
});

function parity(evidence: Input, oracle: LivePaymentPolicyResult, amountUsdc = '0.0005') {
  const record = offlineRecord(evidence);
  expect(isPrivateScanRecord(record), 'fixture must satisfy the unchanged live guard').toBe(true);
  // Pin both compatibility paths to literal full results BEFORE comparing paths.
  expect(evaluateLivePaymentPolicy(record, amountUsdc)).toStrictEqual(oracle);
  expect(evaluateSyntheticPaymentPolicy(evidence, amountUsdc)).toStrictEqual(oracle);
  const live = normalizeInterceptaEvidence(record);
  const synthetic = normalizeSyntheticEvidence(evidence);
  expect(evaluatePaymentPolicy(live, { amountUsdc })).toStrictEqual(oracle);
  expect(evaluatePaymentPolicy(synthetic, { amountUsdc })).toStrictEqual(oracle);
  const unknownCount = evidence.unknownTraitsCount ?? null;
  const complete = unknownCount === 0 && evidence.traitLabels.length === evidence.traitsCount;
  const common = { available: true, toxicScore: evidence.toxicScore, traitsCount: evidence.traitsCount, unknownTraitsCount: unknownCount, complete };
  expect(live).toStrictEqual({ ...common, origin: 'LIVE', provider: 'intercepta', traits: unknownCount === 0 ? evidence.traitLabels : [] });
  expect(synthetic).toStrictEqual({ ...common, origin: 'SYNTHETIC', provider: 'synthetic', traits: evidence.traitLabels });
}

describe('dual normalization and compatibility-wrapper parity', () => {
  it.each([
    { name: 'mixer', evidence: input(), oracle: limited },
    { name: 'hard', evidence: input(['sanction_address']), oracle: deny },
    { name: 'explicit unknown only', evidence: input([], { traitsCount: 1, unknownTraitsCount: 1 }), oracle: unknown },
    { name: 'unknown before hard', evidence: input(['sanction_address'], { traitsCount: 2, unknownTraitsCount: 1 }), oracle: unknown },
    { name: 'legacy accepted counts need not fully account', evidence: input(['sanction_address'], { unknownTraitsCount: 1 }), oracle: unknown },
    { name: 'hard before moderate', evidence: input(['mixer_transfers', 'sanction_address']), oracle: deny },
    { name: 'hard before truncation', evidence: input(['sanction_address'], { traitsCount: 2 }), oracle: deny },
    { name: 'truncation before moderate', evidence: input(['mixer_transfers'], { traitsCount: 2 }), oracle: incomplete },
    { name: 'moderate before unmapped', evidence: input(['rug_pull', 'mixer_transfers']), oracle: limited },
    { name: 'explicit zero', evidence: input([]), oracle: allow },
    { name: 'unmapped', evidence: input(['rug_pull']), oracle: unmapped },
    { name: 'empty incomplete', evidence: input([], { traitsCount: 1 }), oracle: incomplete },
    { name: '20 complete duplicates', evidence: input(Array<string>(20).fill('mixer_transfers')), oracle: limited },
    { name: '20 of 21 duplicates', evidence: input(Array<string>(20).fill('mixer_transfers'), { traitsCount: 21 }), oracle: incomplete },
    { name: 'maximum count', evidence: input([], { traitsCount: 100, unknownTraitsCount: 100 }), oracle: unknown },
  ])('$name preserves full result and normalized shape', ({ evidence, oracle }) => parity(evidence, oracle));

  it.each([
    ['sanction_address', deny], ['blacklist', deny], ['known_scammer', deny],
    ['mixer_transfers', limited], ['non_kyc_transfers', limited], ['sanction_address_communication', limited],
    ['fake_phishing_transfer', limited], ['fake_phishing_contract_communication', limited], ['rug_pull_trader', limited],
    ['initiator_scam_transactions', unmapped], ['suspicious_dex_pair_deployer', unmapped],
    ['suspicious_deployer', unmapped], ['attack_money_target', unmapped], ['zero_address_risk', unmapped], ['rug_pull', unmapped],
  ] as const)('retains label %s without generalizing its meaning', (label, oracle) => parity(input([label]), oracle));

  it.each([
    ['0.000001', limited], ['0.000999', limited], ['0.001', limited], ['0.001000', limited],
    ['0.001001', over], ['0.005', over], ['9'.repeat(78), over], ['0', invalid], ['0.001\n', invalid],
  ] as const)('preserves amount/cap outcome %s across both adapters and wrappers', (amount, oracle) => parity(input(), oracle, amount));

  it.each([-7, 0, 50, 1_000_000])('preserves finite score %s as evidence, not a threshold', toxicScore => {
    for (const [labels, oracle] of [[[], allow], [['mixer_transfers'], limited], [['sanction_address'], deny], [['rug_pull'], unmapped]] as const) {
      parity(input([...labels], { toxicScore }), oracle);
    }
  });

  it.each(['absent', 'undefined'] as const)('normalizes own unknown %s to null, never zero', mode => {
    const evidence = input(['sanction_address']);
    if (mode === 'absent') delete evidence.unknownTraitsCount;
    else evidence.unknownTraitsCount = undefined;
    parity(evidence, unknown);
  });

  it('normalizes inherited-only live unknown zero to null without adding synthetic prototype restrictions', () => {
    const record = offlineRecord(input(['sanction_address']));
    delete record.risk.scan.unknownTraitsCount;
    Object.setPrototypeOf(record.risk.scan, { unknownTraitsCount: 0 });
    expect(isPrivateScanRecord(record)).toBe(true);
    expect(evaluateLivePaymentPolicy(record, '0.0005')).toStrictEqual(unknown);
    const normalized = normalizeInterceptaEvidence(record);
    expect(normalized).toStrictEqual({ origin: 'LIVE', provider: 'intercepta', available: true,
      toxicScore: 50, traits: [], traitsCount: 1, unknownTraitsCount: null, complete: false });
    expect(evaluatePaymentPolicy(normalized, { amountUsdc: '0.0005' })).toStrictEqual(unknown);
  });

  it('keeps the existing three cards on the same normalized engine path', () => {
    const oracles = [limited, deny, unknown];
    expect(POLICY_SCENARIOS).toHaveLength(3);
    POLICY_SCENARIOS.forEach((scenario, index) => {
      expect(evaluateSyntheticPaymentPolicy(scenario.input, scenario.amountUsdc)).toStrictEqual(oracles[index]);
      expect(evaluatePaymentPolicy(normalizeSyntheticEvidence(scenario.input), { amountUsdc: scenario.amountUsdc })).toStrictEqual(oracles[index]);
    });
  });
});

describe('live guard/read compatibility and amount-first wrappers', () => {
  it.each(['absent', 'undefined', 'positive'] as const)('unknown %s never reads labels again after the legacy guard', mode => {
    function statefulFixture() {
      const evidence = input(['sanction_address'], { unknownTraitsCount: 1 });
      if (mode === 'absent') delete evidence.unknownTraitsCount;
      if (mode === 'undefined') evidence.unknownTraitsCount = undefined;
      const record = offlineRecord(evidence);
      let labelReads = 0;
      const read = vi.fn(() => {
        // Existing guard reads index0 once via Array.from and once via every.
        // The old unknown path copies no labels. A third read is a regression.
        if (++labelReads > 2) throw new Error('unexpected post-guard label read');
        return 'sanction_address';
      });
      Object.defineProperty(record.risk.scan.traitLabels, '0', { enumerable: true, get: read });
      return { record, read };
    }
    const control = statefulFixture();
    expect(isPrivateScanRecord(control.record)).toBe(true);
    expect(control.read).toHaveBeenCalledTimes(2);
    const wrapped = statefulFixture();
    expect(evaluateLivePaymentPolicy(wrapped.record, '0.0005')).toStrictEqual(unknown);
    expect(wrapped.read).toHaveBeenCalledTimes(2);
    const direct = statefulFixture();
    const normalized = normalizeInterceptaEvidence(direct.record);
    expect(normalized).toStrictEqual({ origin: 'LIVE', provider: 'intercepta', available: true,
      toxicScore: 50, traits: [], traitsCount: 1, unknownTraitsCount: mode === 'positive' ? 1 : null, complete: false });
    expect(direct.read).toHaveBeenCalledTimes(2);
    expect(evaluatePaymentPolicy(normalized, { amountUsdc: '0.0005' })).toStrictEqual(unknown);
    expect(direct.read).toHaveBeenCalledTimes(2);
  });

  it('retains accepted live accessors/custom prototypes when unknown is explicitly zero', () => {
    const record = offlineRecord();
    Object.setPrototypeOf(record.risk.scan, {});
    const score = vi.fn(() => 50);
    const label = vi.fn(() => 'mixer_transfers');
    Object.defineProperty(record.risk.scan, 'toxicScore', { enumerable: true, get: score });
    Object.defineProperty(record.risk.scan.traitLabels, '0', { enumerable: true, get: label });
    expect(isPrivateScanRecord(record)).toBe(true);
    expect(evaluateLivePaymentPolicy(record, '0.0005')).toStrictEqual(limited);
    expect(normalizeInterceptaEvidence(record)).toStrictEqual({ origin: 'LIVE', provider: 'intercepta', available: true,
      toxicScore: 50, traits: ['mixer_transfers'], traitsCount: 1, unknownTraitsCount: 0, complete: true });
    expect(score).toHaveBeenCalled();
    expect(label).toHaveBeenCalled();
  });

  it.each(['transport', 'httpStatus', 'toxicScore', 'traitsCount', 'traitLabels'] as const)('still requires own live %s', key => {
    const record = offlineRecord();
    const inherited = record.risk.scan[key];
    Reflect.deleteProperty(record.risk.scan, key);
    for (const prototype of [Object.prototype, { [key]: inherited }]) {
      Object.setPrototypeOf(record.risk.scan, prototype);
      expect(normalizeInterceptaEvidence(record)).toStrictEqual(unavailable('LIVE'));
      expect(evaluateLivePaymentPolicy(record, '0.0005')).toStrictEqual(missing);
    }
  });

  it.each([
    { httpStatus: 201 }, { httpStatus: 404 }, { transport: 'unavailable' },
    { toxicScore: NaN }, { unknownTraitsCount: -1 }, { requestedNetwork: 'eip155:84532' },
    { traitLabels: ['ARBITRARY_UNTRUSTED_TEXT'] }, { traitLabels: Array<string>(1) },
  ])('retains live scan rejection %#', patch => {
    const record = offlineRecord();
    Object.assign(record.risk.scan, patch);
    expect(normalizeInterceptaEvidence(record)).toStrictEqual(unavailable('LIVE'));
    expect(evaluateLivePaymentPolicy(record, '0.0005')).toStrictEqual(missing);
  });

  it('retains state/source/guard failures and never promotes unavailable to zero-trait ALLOW', () => {
    const nonlive = offlineRecord();
    nonlive.risk.source = 'fixture';
    const provider = offlineRecord();
    provider.risk.provider = 'other';
    const badIdentity = offlineRecord();
    badIdentity.candidateId = 'not-a-candidate';
    for (const record of [null, undefined, {}, nonlive, provider, badIdentity,
      { candidateId: 'H1', state: 'pending', attemptedAt: nonlive.attemptedAt, risk: null },
      { candidateId: 'H1', state: 'unavailable', attemptedAt: nonlive.attemptedAt, risk: null }]) {
      const normalized = normalizeInterceptaEvidence(record);
      expect(normalized).toStrictEqual(unavailable('LIVE'));
      expect(evaluatePaymentPolicy(normalized, { amountUsdc: '0.0005' })).toStrictEqual(missing);
      expect(evaluateLivePaymentPolicy(record, '0.0005')).toStrictEqual(missing);
    }
  });

  it.each(['0', '0.001\n', '9'.repeat(79), null, undefined])('wrappers reject amount %# before touching any input getter/reflection', amount => {
    const touched = vi.fn(() => { throw new Error('must not inspect evidence'); });
    const hostile = new Proxy({}, { get: touched, ownKeys: touched, getPrototypeOf: touched, getOwnPropertyDescriptor: touched });
    expect(evaluateLivePaymentPolicy(hostile, amount as string)).toStrictEqual(invalid);
    expect(evaluateSyntheticPaymentPolicy(hostile, amount as string)).toStrictEqual(invalid);
    expect(touched).not.toHaveBeenCalled();
  });

  it('contains live getter/guard exceptions', () => {
    const record = offlineRecord();
    Object.defineProperty(record, 'risk', { enumerable: true, get() { throw new Error('ARBITRARY_UNTRUSTED_TEXT'); } });
    expect(normalizeInterceptaEvidence(record)).toStrictEqual(unavailable('LIVE'));
    expect(evaluateLivePaymentPolicy(record, '0.0005')).toStrictEqual(missing);
  });
});

describe('normalization provenance, detachment and synthetic own-data boundary', () => {
  it('does not interchange synthetic and live eligibility or fabricate provenance fields', () => {
    const evidence = input();
    const record = offlineRecord(evidence);
    expect(normalizeInterceptaEvidence(evidence)).toStrictEqual(unavailable('LIVE'));
    expect(normalizeSyntheticEvidence(record)).toStrictEqual(unavailable('SYNTHETIC'));
    expect(normalizeSyntheticEvidence({ ...record, synthetic: true })).toStrictEqual(unavailable('SYNTHETIC'));
    for (const value of [normalizeInterceptaEvidence(record), normalizeSyntheticEvidence(evidence)]) {
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
      expect(Object.getPrototypeOf(value.traits)).toBe(Array.prototype);
      expect(Object.keys(value).sort()).toStrictEqual(['available', 'complete', 'origin', 'provider', 'toxicScore', 'traits', 'traitsCount', 'unknownTraitsCount'].sort());
    }
  });

  it('detaches arrays, retains label order/duplicates, and cannot alias caller or later results', () => {
    const evidence = input(['rug_pull', 'mixer_transfers', 'rug_pull']);
    const record = offlineRecord(evidence);
    const synthetic = normalizeSyntheticEvidence(evidence);
    const live = normalizeInterceptaEvidence(record);
    expect(synthetic.traits).toStrictEqual(['rug_pull', 'mixer_transfers', 'rug_pull']);
    expect(live.traits).toStrictEqual(synthetic.traits);
    expect(synthetic.traits).not.toBe(evidence.traitLabels);
    expect(live.traits).not.toBe(record.risk.scan.traitLabels);
    expect(normalizeSyntheticEvidence(evidence).traits).not.toBe(synthetic.traits);
    expect(normalizeInterceptaEvidence(record).traits).not.toBe(live.traits);
    evidence.traitLabels[0] = 'sanction_address';
    record.risk.scan.traitLabels[0] = 'sanction_address';
    evidence.toxicScore = 100;
    record.risk.scan.toxicScore = 100;
    for (const normalized of [synthetic, live]) {
      expect(normalized.traits).toStrictEqual(['rug_pull', 'mixer_transfers', 'rug_pull']);
      expect(normalized.toxicScore).toBe(50);
      expect(evaluatePaymentPolicy(normalized, { amountUsdc: '0.0005' })).toStrictEqual(limited);
    }
  });

  it('does not mutate frozen source objects', () => {
    const evidence = input();
    const record = offlineRecord(evidence);
    Object.freeze(evidence.traitLabels); Object.freeze(evidence);
    Object.freeze(record.risk.scan.traitLabels); Object.freeze(record.risk.scan);
    Object.freeze(record.risk.reasons); Object.freeze(record.risk); Object.freeze(record);
    const before = JSON.stringify([evidence, record]);
    expect(normalizeSyntheticEvidence(evidence).available).toBe(true);
    expect(normalizeInterceptaEvidence(record).available).toBe(true);
    expect(JSON.stringify([evidence, record])).toBe(before);
  });

  it.each([
    { synthetic: false }, { toxicScore: Infinity }, { traitsCount: 101 }, { unknownTraitsCount: null },
    { unknownTraitsCount: 2 }, { traitLabels: Array<string>(1) }, { traitLabels: ['ARBITRARY_UNTRUSTED_TEXT'] },
    { traitLabels: Array<string>(21).fill('mixer_transfers'), traitsCount: 21 }, { source: 'live' },
  ])('direct synthetic normalizer rejects malformed evidence %# with null counts', patch => {
    const evidence = { ...input(), ...patch };
    const normalized = normalizeSyntheticEvidence(evidence);
    expect(normalized).toStrictEqual(unavailable('SYNTHETIC'));
    expect(evaluatePaymentPolicy(normalized, { amountUsdc: '0.0005' })).toStrictEqual(missing);
    expect(evaluateSyntheticPaymentPolicy(evidence, '0.0005')).toStrictEqual(missing);
  });

  it('accepts null-prototype own data but rejects inherited marker/unknown and hidden extras', () => {
    const plain = Object.assign(Object.create(null), input());
    Object.defineProperty(plain, 'synthetic', { value: true, enumerable: false });
    expect(normalizeSyntheticEvidence(plain)).toStrictEqual({ origin: 'SYNTHETIC', provider: 'synthetic', available: true,
      toxicScore: 50, traits: ['mixer_transfers'], traitsCount: 1, unknownTraitsCount: 0, complete: true });
    const inheritedUnknown = input();
    delete inheritedUnknown.unknownTraitsCount;
    Object.setPrototypeOf(inheritedUnknown, { unknownTraitsCount: 0 });
    const inheritedMarker = input();
    Reflect.deleteProperty(inheritedMarker, 'synthetic');
    Object.setPrototypeOf(inheritedMarker, { synthetic: true });
    for (const evidence of [inheritedUnknown, inheritedMarker]) {
      expect(normalizeSyntheticEvidence(evidence)).toStrictEqual(unavailable('SYNTHETIC'));
    }
    for (const key of ['toJSON', Symbol('extra')]) {
      const evidence = input();
      const touched = vi.fn(() => input());
      Object.defineProperty(evidence, key, { value: touched });
      expect(normalizeSyntheticEvidence(evidence)).toStrictEqual(unavailable('SYNTHETIC'));
      expect(touched).not.toHaveBeenCalled();
    }
  });

  it.each(['synthetic', 'toxicScore', 'traitsCount', 'traitLabels', 'unknownTraitsCount'] as const)('rejects synthetic accessor %s without invocation', key => {
    const evidence = input();
    const original = evidence[key];
    const touched = vi.fn(() => original);
    Object.defineProperty(evidence, key, { enumerable: true, get: touched });
    expect(normalizeSyntheticEvidence(evidence)).toStrictEqual(unavailable('SYNTHETIC'));
    expect(touched).not.toHaveBeenCalled();
  });

  it('rejects accessor label indices without invocation', () => {
    const evidence = input();
    const touched = vi.fn(() => 'mixer_transfers');
    Object.defineProperty(evidence.traitLabels, '0', { get: touched });
    expect(normalizeSyntheticEvidence(evidence)).toStrictEqual(unavailable('SYNTHETIC'));
    expect(touched).not.toHaveBeenCalled();
  });

  it('snapshots synthetic descriptors once without reading caller properties', () => {
    const touched = vi.fn(() => { throw new Error('use own data descriptors'); });
    function guarded<T extends object>(target: T): T {
      const seen = new Set<string | symbol>();
      let keyReads = 0;
      return new Proxy(target, {
        get: touched,
        ownKeys(value) { expect(++keyReads).toBe(1); return Reflect.ownKeys(value); },
        getOwnPropertyDescriptor(value, key) {
          expect(seen.has(key)).toBe(false); seen.add(key);
          return Reflect.getOwnPropertyDescriptor(value, key);
        },
      });
    }
    const evidence = input();
    evidence.traitLabels = guarded(evidence.traitLabels);
    expect(normalizeSyntheticEvidence(guarded(evidence))).toStrictEqual({ origin: 'SYNTHETIC', provider: 'synthetic', available: true,
      toxicScore: 50, traits: ['mixer_transfers'], traitsCount: 1, unknownTraitsCount: 0, complete: true });
    expect(touched).not.toHaveBeenCalled();
  });

  it.each(['ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf'] as const)('contains synthetic %s reflection failures', trap => {
    const handler = { [trap]: () => { throw new Error('ARBITRARY_UNTRUSTED_TEXT'); } };
    expect(normalizeSyntheticEvidence(new Proxy(input(), handler))).toStrictEqual(unavailable('SYNTHETIC'));
    const evidence = input();
    evidence.traitLabels = new Proxy(evidence.traitLabels, handler);
    expect(normalizeSyntheticEvidence(evidence)).toStrictEqual(unavailable('SYNTHETIC'));
  });
});
