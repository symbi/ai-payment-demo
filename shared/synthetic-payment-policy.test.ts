import { describe, expect, it, vi } from 'vitest';
import {
  evaluateLivePaymentPolicy, evaluateSyntheticPaymentPolicy, type LivePaymentPolicyResult,
} from './live-payment-policy.ts';
import { isPrivateScanRecord, PRIVATE_RISK_CANDIDATES } from './private-risk.ts';

type Evidence = {
  synthetic: true; toxicScore: number; traitsCount: number; traitLabels: string[];
  unknownTraitsCount?: number;
};
const evidence = (traitLabels: string[] = ['mixer_transfers'], patch: Partial<Evidence> = {}): Evidence => ({
  synthetic: true, toxicScore: 50, traitsCount: traitLabels.length,
  traitLabels: [...traitLabels], unknownTraitsCount: 0, ...patch,
});
// Literal full-object oracles; do not derive expectations from either adapter.
const expected = (
  decision: LivePaymentPolicyResult['decision'], reasonCode: LivePaymentPolicyResult['reasonCode'],
  amountWithinLimit = false, capUsdc: LivePaymentPolicyResult['capUsdc'] = null,
): LivePaymentPolicyResult => ({
  policyRevision: 'project-intercepta-payment-policy-v1', policyName: 'Project/Intercepta Payment Policy v1',
  decision, reasonCode, capUsdc, amountWithinLimit, execution: 'NOT_CONNECTED',
});
const unavailable = expected('HOLD', 'evidence_unavailable');
const unknown = expected('HOLD', 'unknown_traits');
const incomplete = expected('HOLD', 'incomplete_traits');
const unmapped = expected('HOLD', 'unmapped_trait');
const deny = expected('DENY', 'hard_deny_trait');
const allow = expected('ALLOW', 'no_traits', true);
const limited = expected('ALLOW_WITH_LIMIT', 'moderate_trait', true, '0.001');
const over = expected('ALLOW_WITH_LIMIT', 'moderate_trait', false, '0.001');
const invalid = expected('HOLD', 'invalid_amount');

// TEST-ONLY offline envelope to exercise the unchanged live guard. Never a scan,
// provider observation, fixture catalog entry, or UI input. No IO occurs here.
function offlineLive(input: Evidence) {
  const scan = {
    transport: 'received', httpStatus: 200, requestedNetwork: 'eip155:1',
    coverage: 'unverified', semantics: 'unverified', toxicScore: input.toxicScore,
    traitsCount: input.traitsCount, traitLabels: [...input.traitLabels],
    ...(Object.hasOwn(input, 'unknownTraitsCount') ? { unknownTraitsCount: input.unknownTraitsCount } : {}),
  };
  return {
    candidateId: 'H1', state: 'completed', attemptedAt: '2026-09-27T01:00:00.000Z',
    risk: {
      address: PRIVATE_RISK_CANDIDATES.find(candidate => candidate.id === 'H1')!.address,
      checkedAt: '2026-09-27T01:00:01.000Z', provider: 'intercepta', source: 'live',
      decision: 'hold', reasons: ['Offline synthetic unit-test fixture only.'], scan,
    },
  };
}
function parity(input: Evidence, amount: string, oracle: LivePaymentPolicyResult) {
  const record = offlineLive(input);
  expect(isPrivateScanRecord(record), 'offline fixture must pass the existing live guard').toBe(true);
  const live = evaluateLivePaymentPolicy(record, amount);
  expect(live).toStrictEqual(oracle);
  expect(evaluateSyntheticPaymentPolicy(input, amount)).toStrictEqual(oracle);
  expect(evaluateSyntheticPaymentPolicy(input, amount)).toStrictEqual(live);
}

describe('shared ordered policy behavior via distinct adapters', () => {
  it.each([
    { name: 'mixer', input: evidence(), oracle: limited },
    { name: 'sanction', input: evidence(['sanction_address']), oracle: deny },
    { name: 'explicit unknown', input: evidence([], { traitsCount: 1, unknownTraitsCount: 1 }), oracle: unknown },
    { name: 'unknown before hard', input: evidence(['sanction_address'], { traitsCount: 2, unknownTraitsCount: 1 }), oracle: unknown },
    { name: 'hard before moderate', input: evidence(['mixer_transfers', 'sanction_address']), oracle: deny },
    { name: 'hard before truncation', input: evidence(['sanction_address'], { traitsCount: 2 }), oracle: deny },
    { name: 'truncation before moderate', input: evidence(['mixer_transfers'], { traitsCount: 2 }), oracle: incomplete },
    { name: 'moderate before unmapped', input: evidence(['rug_pull', 'mixer_transfers']), oracle: limited },
    { name: 'explicit empty', input: evidence([]), oracle: allow },
    { name: 'unmapped', input: evidence(['rug_pull']), oracle: unmapped },
    { name: 'empty but incomplete', input: evidence([], { traitsCount: 1 }), oracle: incomplete },
    { name: '20 complete duplicates', input: evidence(Array<string>(20).fill('mixer_transfers')), oracle: limited },
    { name: '20 of 21 duplicates', input: evidence(Array<string>(20).fill('mixer_transfers'), { traitsCount: 21 }), oracle: incomplete },
    { name: 'maximum count', input: evidence([], { traitsCount: 100, unknownTraitsCount: 100 }), oracle: unknown },
  ])('$name has the full canonical disconnected result', ({ input, oracle }) => parity(input, '0.0005', oracle));

  it.each([
    ['sanction_address', deny], ['blacklist', deny], ['known_scammer', deny],
    ['mixer_transfers', limited], ['non_kyc_transfers', limited], ['sanction_address_communication', limited],
    ['fake_phishing_transfer', limited], ['fake_phishing_contract_communication', limited], ['rug_pull_trader', limited],
    ['initiator_scam_transactions', unmapped], ['suspicious_dex_pair_deployer', unmapped],
    ['suspicious_deployer', unmapped], ['attack_money_target', unmapped], ['zero_address_risk', unmapped], ['rug_pull', unmapped],
  ] as const)('preserves the existing mapping for %s', (label, oracle) => parity(evidence([label]), '0.0005', oracle));

  it.each([-7, 0, 50, 1_000_000])('does not use finite score %s as a rule input', toxicScore => {
    for (const [labels, oracle] of [[[], allow], [['mixer_transfers'], limited], [['sanction_address'], deny], [['rug_pull'], unmapped]] as const) {
      parity(evidence([...labels], { toxicScore }), '0.0005', oracle);
    }
    parity(evidence([], { toxicScore, traitsCount: 1, unknownTraitsCount: 1 }), '0.0005', unknown);
  });

  it.each(['absent', 'undefined'] as const)('treats own unknown count %s as unknown before hard', mode => {
    const input = evidence(['sanction_address']);
    if (mode === 'absent') delete input.unknownTraitsCount;
    else input.unknownTraitsCount = undefined;
    parity(input, '0.0005', unknown);
  });

  it.each([
    ['0.000001', limited], ['0.000999', limited], ['0.001', limited], ['0.001000', limited],
    ['0.001001', over], ['0.005', over], ['9'.repeat(78), over],
  ] as const)('preserves the exact atomic cap at %s', (amount, oracle) => parity(evidence(), amount, oracle));

  it.each([
    '', '0', '0.000000', '-1', '+1', ' 0.001', '0.001 ', '0.001\n', '0.001\r\n',
    '1e-3', 'NaN', 'Infinity', '00.001', '.001', '1.', '0.0000001', '１', '9'.repeat(79),
    null, undefined, 0.001, {}, ['0.001'], new String('0.001'),
  ])('rejects invalid amount %# before inspecting hostile evidence', amount => {
    const touched = vi.fn(() => { throw new Error('must not inspect'); });
    const hostile = new Proxy({}, { get: touched, ownKeys: touched, getPrototypeOf: touched, getOwnPropertyDescriptor: touched });
    expect(evaluateSyntheticPaymentPolicy(hostile, amount as string)).toStrictEqual(invalid);
    expect(evaluateLivePaymentPolicy(hostile, amount as string)).toStrictEqual(invalid);
    expect(evaluateSyntheticPaymentPolicy(evidence(['sanction_address']), amount as string)).toStrictEqual(invalid);
    expect(touched).not.toHaveBeenCalled();
  });
});

describe('strict synthetic own-data trust boundary', () => {
  it.each([null, undefined, false, 50, 'synthetic', [], () => evidence()])('rejects non-object evidence %#', input => {
    expect(evaluateSyntheticPaymentPolicy(input, '0.0005')).toStrictEqual(unavailable);
  });

  it.each(['synthetic', 'toxicScore', 'traitsCount', 'traitLabels'] as const)('requires own data field %s', key => {
    const input = evidence();
    const inherited = input[key];
    Reflect.deleteProperty(input, key);
    expect(evaluateSyntheticPaymentPolicy(input, '0.0005')).toStrictEqual(unavailable);
    Object.setPrototypeOf(input, { [key]: inherited });
    expect(evaluateSyntheticPaymentPolicy(input, '0.0005')).toStrictEqual(unavailable);
  });

  it.each([
    { synthetic: false }, { synthetic: 'true' }, { toxicScore: NaN }, { toxicScore: Infinity },
    { toxicScore: -Infinity }, { toxicScore: '50' }, { toxicScore: undefined },
    { traitsCount: -1 }, { traitsCount: 101 }, { traitsCount: 0.5 }, { traitsCount: '1' },
    { traitsCount: NaN }, { traitsCount: Infinity }, { traitsCount: 0 },
    { unknownTraitsCount: -1 }, { unknownTraitsCount: 2 }, { unknownTraitsCount: 0.5 },
    { unknownTraitsCount: '0' }, { unknownTraitsCount: NaN }, { unknownTraitsCount: null },
    { traitLabels: ['ARBITRARY_UNTRUSTED_TEXT'] }, { traitLabels: [123] },
    { traitLabels: null }, { traitLabels: 'mixer_transfers' }, { traitLabels: { 0: 'mixer_transfers', length: 1 } },
    { traitLabels: Array<string>(1) }, { traitLabels: Array<string>(21).fill('mixer_transfers'), traitsCount: 21 },
  ])('fails closed on malformed shape %#, even with a hard trait', patch => {
    const input = { ...evidence(['sanction_address']), ...patch };
    expect(evaluateSyntheticPaymentPolicy(input, '0.0005')).toStrictEqual(unavailable);
  });

  it('validates malformed evidence before unknown and hard rule precedence', () => {
    expect(evaluateSyntheticPaymentPolicy({ ...evidence(['sanction_address'], { unknownTraitsCount: 1 }), toxicScore: NaN }, '0.0005')).toStrictEqual(unavailable);
  });

  it.each(['address', 'source', 'httpStatus', 'provider', 'checkedAt', 'decision', 'extra'])('rejects extra %s, enumerable or hidden', key => {
    for (const enumerable of [true, false]) {
      const input = evidence();
      Object.defineProperty(input, key, { value: 'ARBITRARY_UNTRUSTED_TEXT', enumerable });
      expect(evaluateSyntheticPaymentPolicy(input, '0.0005')).toStrictEqual(unavailable);
    }
  });

  it('rejects symbols and hidden extra array fields', () => {
    for (const key of ['extra', Symbol('extra')]) {
      const input = evidence();
      Object.defineProperty(input, key, { value: 1 });
      expect(evaluateSyntheticPaymentPolicy(input, '0.0005')).toStrictEqual(unavailable);
      const withArrayExtra = evidence();
      Object.defineProperty(withArrayExtra.traitLabels, key, { value: 1 });
      expect(evaluateSyntheticPaymentPolicy(withArrayExtra, '0.0005')).toStrictEqual(unavailable);
    }
  });

  it.each(['synthetic', 'toxicScore', 'traitsCount', 'traitLabels', 'unknownTraitsCount', 'extra'] as const)(
    'never invokes an accessor on %s (valid-looking, stateful, or throwing)', key => {
      for (const mode of ['valid', 'stateful', 'throwing']) {
        const input = evidence();
        let reads = 0;
        const value = key === 'extra' ? 0 : input[key];
        const getter = vi.fn(() => {
          reads += 1;
          if (mode === 'throwing') throw new Error('ARBITRARY_UNTRUSTED_TEXT');
          return mode === 'stateful' && reads > 1 ? 'ARBITRARY_UNTRUSTED_TEXT' : value;
        });
        const setter = vi.fn();
        Object.defineProperty(input, key, { enumerable: true, get: getter, set: setter });
        expect(evaluateSyntheticPaymentPolicy(input, '0.0005')).toStrictEqual(unavailable);
        expect(getter).not.toHaveBeenCalled();
        expect(setter).not.toHaveBeenCalled();
      }
    },
  );

  it('rejects accessor array indices and setter-only fields without invoking them', () => {
    const getter = vi.fn(() => 'mixer_transfers');
    const input = evidence();
    Object.defineProperty(input.traitLabels, '0', { get: getter });
    expect(evaluateSyntheticPaymentPolicy(input, '0.0005')).toStrictEqual(unavailable);
    expect(getter).not.toHaveBeenCalled();
    const setter = vi.fn();
    const setterOnly = evidence();
    Object.defineProperty(setterOnly, 'unknownTraitsCount', { set: setter });
    expect(evaluateSyntheticPaymentPolicy(setterOnly, '0.0005')).toStrictEqual(unavailable);
    expect(setter).not.toHaveBeenCalled();
  });

  it('rejects custom prototypes, inherited unknown zero and inherited array indices', () => {
    const custom = Object.assign(Object.create({}), evidence());
    expect(evaluateSyntheticPaymentPolicy(custom, '0.0005')).toStrictEqual(unavailable);
    const inherited = evidence();
    delete inherited.unknownTraitsCount;
    Object.setPrototypeOf(inherited, { unknownTraitsCount: 0 });
    expect(evaluateSyntheticPaymentPolicy(inherited, '0.0005')).toStrictEqual(unavailable);
    const labels = Array<string>(1);
    Object.setPrototypeOf(labels, Object.assign(Object.create(Array.prototype), { 0: 'mixer_transfers' }));
    expect(evaluateSyntheticPaymentPolicy(evidence(labels, { traitLabels: labels }), '0.0005')).toStrictEqual(unavailable);
    class CustomLabels extends Array<string> {}
    expect(evaluateSyntheticPaymentPolicy(evidence([], { traitsCount: 1, traitLabels: new CustomLabels('mixer_transfers') }), '0.0005')).toStrictEqual(unavailable);
  });

  it('accepts ordinary and null-prototype own data, including nonenumerable known fields', () => {
    expect(evaluateSyntheticPaymentPolicy(evidence(), '0.0005')).toStrictEqual(limited);
    const input = Object.assign(Object.create(null), evidence());
    Object.defineProperty(input, 'synthetic', { value: true, enumerable: false });
    expect(evaluateSyntheticPaymentPolicy(input, '0.0005')).toStrictEqual(limited);
  });

  it.each(['ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf'] as const)('contains %s reflection failures on evidence and labels', trap => {
    const handler = { [trap]: () => { throw new Error('ARBITRARY_UNTRUSTED_TEXT'); } };
    expect(evaluateSyntheticPaymentPolicy(new Proxy(evidence(), handler), '0.0005')).toStrictEqual(unavailable);
    const input = evidence();
    input.traitLabels = new Proxy(input.traitLabels, handler);
    expect(evaluateSyntheticPaymentPolicy(input, '0.0005')).toStrictEqual(unavailable);
  });

  it('contains revoked proxies', () => {
    const { proxy, revoke } = Proxy.revocable(evidence(), {});
    revoke();
    expect(evaluateSyntheticPaymentPolicy(proxy, '0.0005')).toStrictEqual(unavailable);
  });

  it('uses inspected data copies without reading caller properties or repeating reflection', () => {
    const reads = vi.fn(() => { throw new Error('use detached descriptor values'); });
    function guarded<T extends object>(target: T): T {
      const descriptors = new Set<string | symbol>();
      let keyReads = 0;
      return new Proxy(target, {
        get: reads,
        ownKeys(value) { expect(++keyReads).toBe(1); return Reflect.ownKeys(value); },
        getOwnPropertyDescriptor(value, key) {
          expect(descriptors.has(key)).toBe(false);
          descriptors.add(key);
          return Reflect.getOwnPropertyDescriptor(value, key);
        },
      });
    }
    const input = evidence();
    input.traitLabels = guarded(input.traitLabels);
    expect(evaluateSyntheticPaymentPolicy(guarded(input), '0.0005')).toStrictEqual(limited);
    expect(reads).not.toHaveBeenCalled();
  });

  it('keeps synthetic and validated-live eligibility separate', () => {
    for (const input of [evidence(), evidence(['sanction_address']), evidence([], { traitsCount: 1, unknownTraitsCount: 1 })]) {
      expect(evaluateLivePaymentPolicy(input, '0.0005')).toStrictEqual(unavailable);
      const record = offlineLive(input);
      expect(isPrivateScanRecord(record)).toBe(true);
      expect(evaluateSyntheticPaymentPolicy(record, '0.0005')).toStrictEqual(unavailable);
      expect(evaluateSyntheticPaymentPolicy({ ...record, synthetic: true }, '0.0005')).toStrictEqual(unavailable);
    }
  });

  it('is deterministic, preserves duplicate observations and does not mutate frozen caller data', () => {
    const input = evidence(['mixer_transfers', 'mixer_transfers']);
    Object.freeze(input.traitLabels);
    Object.freeze(input);
    const before = Object.getOwnPropertyDescriptors(input);
    const first = evaluateSyntheticPaymentPolicy(input, '0.0005');
    const second = evaluateSyntheticPaymentPolicy(input, '0.0005');
    expect(first).toStrictEqual(limited);
    expect(second).toStrictEqual(first);
    expect(second).not.toBe(first);
    expect(Object.getOwnPropertyDescriptors(input)).toStrictEqual(before);
    expect(input.traitLabels).toStrictEqual(['mixer_transfers', 'mixer_transfers']);
  });
});
