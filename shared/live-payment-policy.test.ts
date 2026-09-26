import { describe, expect, it } from 'vitest';
import type { RiskResult } from './contracts.ts';
import {
  isPrivateScanRecord,
  PRIVATE_RISK_CANDIDATES,
  type PrivateScanRecord,
} from './private-risk.ts';
import {
  evaluateLivePaymentPolicy,
  LIVE_PAYMENT_POLICY_NAME,
  LIVE_PAYMENT_POLICY_REVISION,
  type LivePaymentPolicyResult,
} from './live-payment-policy.ts';

// Synthetic saved records only. Catalog identity satisfies the existing guard;
// it is not a provider observation or a claim about the candidate address.
type Scan = NonNullable<RiskResult['scan']>;
type Fixture = PrivateScanRecord & { risk: RiskResult & { scan: Scan } };
const completed = (traitLabels: string[] = [], toxicScore = 50): Fixture => ({
  candidateId: 'H1',
  state: 'completed',
  attemptedAt: '2026-09-27T01:00:00.000Z',
  risk: {
    address: PRIVATE_RISK_CANDIDATES.find(candidate => candidate.id === 'H1')!.address,
    checkedAt: '2026-09-27T01:00:01.000Z',
    provider: 'intercepta',
    source: 'live',
    decision: 'hold',
    reasons: ['Synthetic fixture evidence; original scan decision remains hold.'],
    scan: {
      transport: 'received', httpStatus: 200,
      requestedNetwork: 'eip155:1', coverage: 'unverified', semantics: 'unverified',
      toxicScore, traitsCount: traitLabels.length, traitLabels, unknownTraitsCount: 0,
    },
  },
});
const withScan = (patch: Record<string, unknown>): Fixture => {
  const record = completed();
  Object.assign(record.risk.scan, patch);
  return record;
};
type Expected = Pick<LivePaymentPolicyResult, 'decision' | 'reasonCode' | 'capUsdc' | 'amountWithinLimit'>;
const unavailable: Expected = {
  decision: 'HOLD', reasonCode: 'evidence_unavailable', capUsdc: null, amountWithinLimit: false,
};
const unknown: Expected = { ...unavailable, reasonCode: 'unknown_traits' };
const incomplete: Expected = { ...unavailable, reasonCode: 'incomplete_traits' };
const unmapped: Expected = { ...unavailable, reasonCode: 'unmapped_trait' };
const invalidAmount: Expected = { ...unavailable, reasonCode: 'invalid_amount' };
const deny: Expected = { ...unavailable, decision: 'DENY', reasonCode: 'hard_deny_trait' };
const allow: Expected = { decision: 'ALLOW', reasonCode: 'no_traits', capUsdc: null, amountWithinLimit: true };
const limitWithin: Expected = {
  decision: 'ALLOW_WITH_LIMIT', reasonCode: 'moderate_trait', capUsdc: '0.001', amountWithinLimit: true,
};
const limitOver: Expected = { ...limitWithin, amountWithinLimit: false };

// Literal full-shape oracle: extra claims, reflected text, payment permissions,
// wrong revision/name, caps and execution flags all fail in every rule family.
function expectPolicy(record: unknown, amount: string, expected: Expected) {
  if (expected.reasonCode !== 'evidence_unavailable' && expected.reasonCode !== 'invalid_amount') {
    expect(isPrivateScanRecord(record), 'fixture must reach the policy through the existing guard').toBe(true);
  }
  const result = evaluateLivePaymentPolicy(record, amount);
  expect(result).toStrictEqual({
    policyRevision: 'project-intercepta-payment-policy-v1',
    policyName: 'Project/Intercepta Payment Policy v1',
    ...expected,
    execution: 'NOT_CONNECTED',
  });
  return result;
}

describe('1. Saved evidence availability and untrusted schema', () => {
  it.each([
    { record: null }, { record: undefined }, { record: {} },
    { record: [] }, { record: 'record' }, { record: 1 },
  ])('holds malformed envelope %#', ({ record }) => {
    expectPolicy(record, '0.005', unavailable);
  });

  it.each(['pending', 'unavailable'] as const)('holds %s records without evidence', state => {
    expectPolicy({ candidateId: 'H1', state, attemptedAt: completed().attemptedAt, risk: null }, '0.005', unavailable);
  });

  it('does not treat received HTTP 200 with unsupported schema as usable evidence', () => {
    const record = completed();
    record.state = 'unavailable';
    record.risk.source = 'unavailable';
    record.risk.scan = {
      transport: 'received', httpStatus: 200, diagnosticCode: 'schema-unsupported',
      requestedNetwork: 'eip155:1', coverage: 'unverified', semantics: 'unverified',
    };
    expect(isPrivateScanRecord(record)).toBe(true);
    expectPolicy(record, '0.005', unavailable);
  });

  it.each([201, 404, 503])('requires HTTP 200, not %i', httpStatus => {
    expectPolicy(withScan({ httpStatus }), '0.005', unavailable);
  });

  it.each(['transport', 'httpStatus', 'toxicScore', 'traitsCount', 'traitLabels'] as const)(
    'requires own %s evidence, including when inherited values look valid', field => {
      const record = completed();
      const inheritedValue = record.risk.scan[field];
      Reflect.deleteProperty(record.risk.scan, field);
      expectPolicy(record, '0.005', unavailable);
      Object.setPrototypeOf(record.risk.scan, { [field]: inheritedValue });
      expectPolicy(record, '0.005', unavailable);
    },
  );

  it.each([
    ['transport unavailable', { transport: 'unavailable' }],
    ['non-finite score', { toxicScore: Infinity }],
    ['NaN score', { toxicScore: NaN }],
    ['string score', { toxicScore: '50' }],
    ['negative count', { traitsCount: -1 }],
    ['fractional count', { traitsCount: 0.5 }],
    ['oversized count', { traitsCount: 101 }],
    ['string count', { traitsCount: '0' }],
    ['network mismatch', { requestedNetwork: 'eip155:84532' }],
  ] as const)('holds %s', (_name, patch) => {
    expectPolicy(withScan(patch), '0.005', unavailable);
  });

  it.each([
    ['non-live source', { source: 'fixture' }],
    ['provider mismatch', { provider: 'test' }],
    ['address mismatch', { address: '0x0000000000000000000000000000000000000000' }],
    ['legacy decision mismatch', { decision: 'allow' }],
  ] as const)('holds %s', (_name, patch) => {
    const record = completed();
    Object.assign(record.risk, patch);
    expectPolicy(record, '0.005', unavailable);
  });

  it('contains exceptions from the existing record guard', () => {
    const record = completed();
    Object.defineProperty(record, 'risk', { enumerable: true, get() { throw new Error('fixture getter'); } });
    expectPolicy(record, '0.005', unavailable);
    const proxy = new Proxy({}, { ownKeys() { throw new Error('fixture proxy'); } });
    expectPolicy(proxy, '0.005', unavailable);
  });
});

describe('2. Unknown evidence precedes hard traits', () => {
  it.each([{ labels: [] }, { labels: ['sanction_address'] }])('holds missing or inherited-only unknown count %#', ({ labels }) => {
    const record = completed(labels);
    delete record.risk.scan.unknownTraitsCount;
    expectPolicy(record, '0.005', unknown);
    Object.setPrototypeOf(record.risk.scan, { unknownTraitsCount: 0 });
    expectPolicy(record, '0.005', unknown);
  });

  it.each([{ labels: [] }, { labels: ['sanction_address'] }, { labels: ['mixer_transfers'] }])('holds explicit unknown observations %#', ({ labels }) => {
    const record = completed(labels);
    record.risk.scan.traitsCount = labels.length + 1;
    record.risk.scan.unknownTraitsCount = 1;
    expectPolicy(record, '0.005', unknown);
  });

  it.each([-1, 0.5, 2, '0'])('rejects malformed unknown count %s', unknownTraitsCount => {
    expectPolicy(withScan({ traitsCount: 1, unknownTraitsCount }), '0.005', unavailable);
  });

  it('rejects arbitrary unknown label text without reflecting it', () => {
    expectPolicy(completed(['unrecognized-fixture-text']), '0.005', unavailable);
  });
});

describe('3. Named hard traits', () => {
  it.each(['sanction_address', 'blacklist', 'known_scammer'])('denies %s', trait => {
    expectPolicy(completed([trait]), '0.005', deny);
  });

  it.each([
    { labels: ['mixer_transfers', 'sanction_address'] },
    { labels: ['blacklist', 'mixer_transfers'] },
    { labels: ['rug_pull', 'known_scammer'] },
  ])('hard trait outranks other recognized traits %#', ({ labels }) => {
    expectPolicy(completed(labels), '0.005', deny);
  });

  it('denies an observed hard trait even when other labels were truncated', () => {
    const record = completed(['sanction_address', ...Array<string>(19).fill('mixer_transfers')]);
    record.risk.scan.traitsCount = 21;
    expectPolicy(record, '0.005', deny);
  });
});

describe('4. Moderate traits and exact atomic cap boundary', () => {
  it.each([
    'mixer_transfers', 'non_kyc_transfers', 'sanction_address_communication',
    'fake_phishing_transfer', 'fake_phishing_contract_communication', 'rug_pull_trader',
  ])('limits %s at the default requested amount', trait => {
    expectPolicy(completed([trait]), '0.005', limitOver);
  });

  it.each([
    ['0.000001', true], ['0.000999', true], ['0.001', true],
    ['0.001000', true], ['0.001001', false], ['0.005', false],
  ] as const)('compares %s with cap without reducing the requested amount', (amount, within) => {
    expectPolicy(completed(['mixer_transfers']), amount, within ? limitWithin : limitOver);
  });

  it('limits moderate plus recognized unmapped evidence', () => {
    expectPolicy(completed(['rug_pull', 'mixer_transfers']), '0.005', limitOver);
  });
});

describe('5. Complete empty evidence allows within this disconnected demo only', () => {
  it.each([-7, 0, 50, 1_000_000])('permits empty live evidence at raw score %s', score => {
    // H1 source context is not an observed sanction trait.
    expectPolicy(completed([], score), '0.005', allow);
  });
});

describe('6. Recognized traits without an action mapping', () => {
  it.each([
    'initiator_scam_transactions', 'suspicious_dex_pair_deployer', 'suspicious_deployer',
    'attack_money_target', 'zero_address_risk', 'rug_pull',
  ])('holds %s', trait => {
    expectPolicy(completed([trait]), '0.005', unmapped);
  });
});

describe('7. Strict amount boundary and amount-first precedence', () => {
  it.each(['0.000001', '1', '1.123456', '9'.repeat(78)])('accepts positive bounded amount %s', amount => {
    expectPolicy(completed(), amount, allow);
  });

  it.each([
    '', '0', '0.000000', '-1', '+1', ' 0.001', '0.001 ', '0.001\n',
    '0.001\r\n', '1e-3', 'NaN', 'Infinity', '00.001', '.001', '1.',
    '0.0000001', '１', '9'.repeat(79),
  ])('rejects malformed amount %#', amount => {
    expectPolicy(completed(), amount, invalidAmount);
  });

  it.each([
    { amount: null }, { amount: undefined }, { amount: 0.001 },
    { amount: {} }, { amount: ['0.001'] }, { amount: new String('0.001') },
  ])(
    'rejects runtime non-string amount without coercion %#', ({ amount }) => {
      expectPolicy(completed(), amount as unknown as string, invalidAmount);
    },
  );

  it('checks amount before invalid or throwing evidence', () => {
    expectPolicy(null, '0', invalidAmount);
    let inspected = false;
    const record = new Proxy({}, { ownKeys() {
      inspected = true;
      throw new Error('must not inspect invalid-amount evidence');
    } });
    expectPolicy(record, '0.005\n', invalidAmount);
    expect(inspected).toBe(false);
  });
});

describe('8. Score independence, completeness and pure result contract', () => {
  it('uses different traits, not the same score 50, to distinguish LIMIT from DENY', () => {
    expectPolicy(completed(['mixer_transfers'], 50), '0.005', limitOver);
    expectPolicy(completed(['sanction_address'], 50), '0.005', deny);
  });

  it('does not use low or high finite scores to upgrade or downgrade traits', () => {
    expectPolicy(completed(['sanction_address'], -7), '0.005', deny);
    expectPolicy(completed(['mixer_transfers'], 1_000_000), '0.001', limitWithin);
  });

  it('distinguishes 20 complete duplicate observations from 20 of 21 labels', () => {
    const record = completed(Array<string>(20).fill('mixer_transfers'));
    expectPolicy(record, '0.001', limitWithin);
    record.risk.scan.traitsCount = 21;
    expectPolicy(record, '0.001', incomplete);
  });

  it.each([{ labels: [] }, { labels: ['mixer_transfers'] }, { labels: ['rug_pull'] }])('holds incomplete visible labels %#', ({ labels }) => {
    const record = completed(labels);
    record.risk.scan.traitsCount = labels.length + 1;
    expectPolicy(record, '0.005', incomplete);
  });

  it.each([
    ['labels exceed count', { traitLabels: ['mixer_transfers'], traitsCount: 0 }],
    ['sparse labels', { traitLabels: Array<string>(1), traitsCount: 1 }],
    ['invalid label type', { traitLabels: [123], traitsCount: 1 }],
    ['too many saved labels', { traitLabels: Array<string>(21).fill('mixer_transfers'), traitsCount: 21 }],
  ] as const)('rejects inconsistent evidence: %s', (_name, patch) => {
    expectPolicy(withScan(patch), '0.005', unavailable);
  });

  it('exports the exact frozen project identity', () => {
    expect(LIVE_PAYMENT_POLICY_REVISION).toBe('project-intercepta-payment-policy-v1');
    expect(LIVE_PAYMENT_POLICY_NAME).toBe('Project/Intercepta Payment Policy v1');
  });

  it.each([
    { name: 'ALLOW', labels: [], expected: allow },
    { name: 'LIMIT', labels: ['mixer_transfers'], expected: limitOver },
    { name: 'DENY', labels: ['sanction_address'], expected: deny },
    { name: 'HOLD', labels: ['rug_pull'], expected: unmapped },
  ])('$name is deterministic with fresh output and unchanged frozen evidence', ({ labels, expected }) => {
    const record = completed(labels);
    const before = JSON.stringify(record);
    Object.freeze(record.risk.scan.traitLabels);
    Object.freeze(record.risk.scan);
    Object.freeze(record.risk.reasons);
    Object.freeze(record.risk);
    Object.freeze(record);
    const first = evaluateLivePaymentPolicy(record, '0.005');
    const second = evaluateLivePaymentPolicy(record, '0.005');
    expect(first).toStrictEqual(second);
    expect(first).not.toBe(second);
    expect(first.execution).toBe('NOT_CONNECTED');
    expect(JSON.stringify(record)).toBe(before);
    expect(record.risk.decision).toBe('hold');
    expectPolicy(record, '0.005', expected);
  });
});
