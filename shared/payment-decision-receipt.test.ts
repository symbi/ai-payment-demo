import { describe, expect, it } from 'vitest';
import type { RiskResult } from './contracts.ts';
import { evaluateLivePaymentPolicy } from './live-payment-policy.ts';
import {
  CANDIDATE_NETWORK, isPrivateScanStatus, PRIVATE_RISK_CANDIDATES, PRIVATE_SCAN_REVISION,
  type PrivateCandidateId, type PrivateScanRecord, type PrivateScanStatus,
} from './private-risk.ts';
import { buildRiskReceipt } from './risk-receipt.ts';
import { TRAIT_COUNT_KEYS, type SchemaDiagnostic, type TraitDiagnostic } from './scan-diagnostic.ts';
import {
  buildPaymentDecisionReceipt, PAYMENT_DECISION_RECEIPT_SCHEMA_VERSION,
} from './payment-decision-receipt.ts';

// Synthetic in-memory fixtures only. Catalog identity is not a provider observation.
const EXPORTED_AT = '2026-09-27T02:03:04.005Z';
const ATTEMPTED_AT = '2026-09-27T01:00:00.000Z';
const RECEIVED_AT = '2026-09-27T01:00:01.000Z';
const SECRET = 'SYNTHETIC_PRIVATE_MARKER_NOT_A_CREDENTIAL';
type Scan = NonNullable<RiskResult['scan']>;
type CompletedFixture = PrivateScanRecord & { risk: RiskResult & { scan: Scan } };
const address = (id: PrivateCandidateId) => PRIVATE_RISK_CANDIDATES.find(item => item.id === id)!.address;
function completed(id: PrivateCandidateId = 'H1', labels: string[] = [], score = 50): CompletedFixture {
  return {
    candidateId: id, state: 'completed', attemptedAt: ATTEMPTED_AT,
    risk: {
      address: address(id), checkedAt: RECEIVED_AT, provider: 'intercepta', source: 'live',
      decision: 'hold', reasons: [SECRET],
      scan: {
        transport: 'received', httpStatus: 200, requestedNetwork: CANDIDATE_NETWORK,
        coverage: 'unverified', semantics: 'unverified', toxicScore: score,
        traitsCount: labels.length, traitLabels: labels, unknownTraitsCount: 0,
        diagnosticCode: 'observed', additionalFieldsCount: 7,
      },
    },
  };
}
function status(records: PrivateScanRecord[] = [completed()]): PrivateScanStatus {
  return {
    contractRevision: PRIVATE_SCAN_REVISION, mode: 'private-scan-only', paymentEnabled: false,
    ready: true, message: SECRET, maxRequests: Math.max(3, records.length),
    usedRequests: records.length, records,
  };
}
function diagnostics(): SchemaDiagnostic {
  return {
    topLevelKeys: ['toxicScore', 'traits', 'status', 'version', 'network', 'timestamp', 'metadata'],
    otherKeysCount: 16384, toxicScoreType: 'number', traitsType: 'array', traitsCount: 100,
    traitDiagnostic: Object.fromEntries(TRAIT_COUNT_KEYS.map(key => [key,
      key === 'totalItems' ? 16384 : 100,
    ])) as TraitDiagnostic,
  };
}
function expectSnapshot(input: PrivateScanStatus, id: PrivateCandidateId = 'H1', amount = '0.005') {
  expect(isPrivateScanStatus(input), 'positive fixture must pass the unchanged status boundary').toBe(true);
  const record = input.records.find(item => item.candidateId === id)!;
  const original = buildRiskReceipt(input, id);
  expect(original).not.toBeNull();
  const result = buildPaymentDecisionReceipt(input, id, amount, EXPORTED_AT);
  expect(result, 'valid saved evidence must produce an object, not the null scaffold').not.toBeNull();
  expect(result).toStrictEqual({
    schemaVersion: 'project-payment-decision-receipt-v1', exportedAt: EXPORTED_AT,
    intent: { candidateId: id, address: address(id), network: 'eip155:1', amountUsdc: amount },
    policy: evaluateLivePaymentPolicy(record, amount), originalScanReceipt: original,
    execution: 'NOT_CONNECTED',
  });
  return result!;
}
function expectNull(input: unknown, ...args: unknown[]) {
  // Preserve an explicitly supplied undefined: it is an invalid runtime argument,
  // not a request to use a helper default.
  const id = args.length > 0 ? args[0] : 'H1';
  const amount = args.length > 1 ? args[1] : '0.005';
  const at = args.length > 2 ? args[2] : EXPORTED_AT;
  // A throw fails this assertion; neither coercion nor a partial object is acceptable.
  expect(buildPaymentDecisionReceipt(input, id, amount as string, at as string)).toBeNull();
}
function freezeTree(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const item of Object.values(value)) freezeTree(item);
  Object.freeze(value);
}

describe('exact independent artifact and canonical composition', () => {
  it.each([
    { labels: [], decision: 'ALLOW', reasonCode: 'no_traits', capUsdc: null, within: true },
    { labels: ['mixer_transfers'], decision: 'ALLOW_WITH_LIMIT', reasonCode: 'moderate_trait', capUsdc: '0.001', within: false },
    { labels: ['sanction_address'], decision: 'DENY', reasonCode: 'hard_deny_trait', capUsdc: null, within: false },
    { labels: ['rug_pull'], decision: 'HOLD', reasonCode: 'unmapped_trait', capUsdc: null, within: false },
  ])('composes $decision from the saved record while the original v2 remains hold', row => {
    const result = expectSnapshot(status([completed('H1', row.labels)]));
    expect(PAYMENT_DECISION_RECEIPT_SCHEMA_VERSION).toBe('project-payment-decision-receipt-v1');
    expect(Object.keys(result).sort()).toEqual([
      'execution', 'exportedAt', 'intent', 'originalScanReceipt', 'policy', 'schemaVersion',
    ]);
    expect(Object.keys(result.intent).sort()).toEqual(['address', 'amountUsdc', 'candidateId', 'network']);
    expect(result.policy).toStrictEqual({
      policyRevision: 'project-intercepta-payment-policy-v1', policyName: 'Project/Intercepta Payment Policy v1',
      decision: row.decision, reasonCode: row.reasonCode, capUsdc: row.capUsdc,
      amountWithinLimit: row.within, execution: 'NOT_CONNECTED',
    });
    expect(result.originalScanReceipt).toMatchObject({
      schemaVersion: 'risk-receipt-v2', decision: 'hold', paymentEnabled: false,
      coverage: 'unverified', semantics: 'unverified', supplierUpdatedAt: null,
    });
    // The embedded v2 intentionally omits transport: reconstructing a policy record
    // from that receipt would turn these positive ALLOW/LIMIT/DENY oracles into HOLD.
    expect(result.originalScanReceipt).not.toHaveProperty('transport');
  });

  it('selects current intent, policy and evidence together across two saved candidates', () => {
    const input = status([completed('H1', [], 0), completed('G1', ['blacklist'], 97)]);
    const first = expectSnapshot(input, 'H1');
    const second = expectSnapshot(input, 'G1');
    expect(first.policy.decision).toBe('ALLOW');
    expect(first.originalScanReceipt.rawToxicScore).toBe(0);
    expect(second.policy.decision).toBe('DENY');
    expect(second.originalScanReceipt.rawToxicScore).toBe(97);
    expect(second.originalScanReceipt.traitLabels).toEqual(['blacklist']);
    expect(JSON.stringify(first)).not.toContain(address('G1'));
    expect(JSON.stringify(first)).not.toContain('blacklist');
    expect(JSON.stringify(second)).not.toContain(address('H1'));
  });

  it.each(['pending', 'unavailable'] as const)('exports valid %s saved evidence as HOLD', state => {
    const input = status([{ candidateId: 'H1', state, attemptedAt: ATTEMPTED_AT, risk: null }]);
    const result = expectSnapshot(input);
    expect(result.policy).toMatchObject({ decision: 'HOLD', reasonCode: 'evidence_unavailable' });
    expect(result.originalScanReceipt).toMatchObject({
      state, source: state, rawToxicScore: null, traitsCount: null, traitLabels: [], localReceivedAt: null,
    });
  });

  it('preserves unavailable HTTP/schema diagnostics without making them usable evidence', () => {
    const record = completed();
    record.state = 'unavailable';
    record.risk.source = 'unavailable';
    record.risk.scan = {
      transport: 'received', requestedNetwork: 'eip155:1', coverage: 'unverified', semantics: 'unverified',
      httpStatus: 200, diagnosticCode: 'schema-unsupported', schemaDiagnostic: diagnostics(),
    };
    const result = expectSnapshot(status([record]));
    expect(result.policy).toMatchObject({ decision: 'HOLD', reasonCode: 'evidence_unavailable' });
    expect(result.originalScanReceipt.schemaDiagnostic).toStrictEqual(diagnostics());
    expect(result.originalScanReceipt.rawToxicScore).toBeNull();
  });

  it.each([
    { name: 'legacy missing HTTP', patch: (s: Scan) => { delete s.httpStatus; }, reason: 'evidence_unavailable', count: 0 },
    { name: 'legacy missing unknown count', patch: (s: Scan) => { delete s.unknownTraitsCount; }, reason: 'unknown_traits', count: null },
    { name: 'unknown observations', patch: (s: Scan) => { s.traitsCount = 2; s.unknownTraitsCount = 1; }, reason: 'unknown_traits', count: 1 },
    { name: 'truncated labels', patch: (s: Scan) => { s.traitsCount = 2; }, reason: 'incomplete_traits', count: 0 },
  ])('preserves $name and the canonical HOLD reason', ({ patch, reason, count }) => {
    const record = completed('H1', ['mixer_transfers']);
    patch(record.risk.scan);
    const result = expectSnapshot(status([record]));
    expect(result.policy).toMatchObject({ decision: 'HOLD', reasonCode: reason });
    expect(result.originalScanReceipt.unknownTraitsCount).toBe(count);
  });
});

describe('current amount and export clock', () => {
  it.each([
    ['0.000001', true], ['0.000999', true], ['0.001', true], ['0.001000', true],
    ['0.001001', false], ['0.005', false], ['9'.repeat(78), false],
  ] as const)('preserves literal %s and compares it with the project cap', (amount, within) => {
    const result = expectSnapshot(status([completed('H1', ['mixer_transfers'])]), 'H1', amount);
    expect(result.intent.amountUsdc).toBe(amount);
    expect(result.policy).toMatchObject({ decision: 'ALLOW_WITH_LIMIT', capUsdc: '0.001', amountWithinLimit: within });
  });

  it('changing 0.005 to 0.001 changes intent and policy but never rewrites saved evidence', () => {
    const input = status([completed('H1', ['mixer_transfers'])]);
    const before = expectSnapshot(input, 'H1', '0.005');
    const after = expectSnapshot(input, 'H1', '0.001');
    expect(before.intent.amountUsdc).toBe('0.005');
    expect(before.policy.amountWithinLimit).toBe(false);
    expect(after.policy.amountWithinLimit).toBe(true);
    expect(before.originalScanReceipt).toStrictEqual(after.originalScanReceipt);
    expect(before.exportedAt).toBe(after.exportedAt);
    expect(before.policy).toStrictEqual({ ...after.policy, amountWithinLimit: false });
  });

  it.each([
    '', '0', '0.000000', '-1', '+1', ' 0.001', '0.001 ', '0.001\n', '0.001\r\n',
    '1e-3', 'NaN', 'Infinity', '00.001', '01', '.001', '1.', '0.0000001', '１', '9'.repeat(79),
    null, undefined, 0.001, {}, ['0.001'], new String('0.001'),
  ].map(amount => ({ amount })))('rejects invalid runtime amount %# rather than exporting an invalid-amount HOLD', ({ amount }) => {
    const input = status();
    expect(evaluateLivePaymentPolicy(input.records[0], amount as string).reasonCode).toBe('invalid_amount');
    expectNull(input, 'H1', amount);
    expectNull(status([{ candidateId: 'H1', state: 'pending', attemptedAt: ATTEMPTED_AT, risk: null }]), 'H1', amount);
  });

  it.each([
    '', 'not-a-date', '2026-09-27', '2026-09-27T02:03:04Z', '2026-09-27T02:03:04.005+00:00',
    '2026-09-27T02:03:04.005Z\n', 'Sun, 27 Sep 2026 02:03:04 GMT', '2026-02-30T00:00:00.000Z',
    null, undefined, 0, {}, new Date(EXPORTED_AT), new String(EXPORTED_AT),
  ])('rejects noncanonical or non-string export time %#', at => {
    expectNull(status(), 'H1', '0.005', at);
  });

  it('uses only the supplied clock and preserves normalized attempt/receive times', () => {
    const record = completed();
    record.attemptedAt = `Sun, 27 Sep 2026 01:00:00 GMT (${SECRET})`;
    record.risk.checkedAt = `Sun, 27 Sep 2026 01:00:01 GMT (${SECRET})`;
    const input = status([record]);
    const first = expectSnapshot(input);
    const second = expectSnapshot(input);
    expect(first).toStrictEqual(second);
    expect(first).not.toBe(second);
    expect(first.originalScanReceipt).toMatchObject({ attemptedAt: ATTEMPTED_AT, localReceivedAt: RECEIVED_AT });
    const later = '2026-09-28T02:03:04.005Z';
    expect(buildPaymentDecisionReceipt(input, 'H1', '0.005', later)).toStrictEqual({ ...first, exportedAt: later });
    expect(JSON.stringify(first)).not.toContain(SECRET);
  });
});

describe('existing strict status and identity boundary', () => {
  it.each([null, undefined, {}, [], 'status', 1].map(input => ({ input })))(
    'rejects malformed status %#', ({ input }) => expectNull(input),
  );
  it.each([null, undefined, 'H0', '../secret', 'h1', {}, new String('H1')])('rejects unknown candidate %#', id => expectNull(status(), id));

  it('rejects missing, duplicate or mismatched records and invalid envelope fields', () => {
    expectNull(status([]));
    expectNull(status([completed('G1')]));
    expectNull(status([completed(), completed()]));
    const mismatch = completed();
    mismatch.risk.address = address('G1');
    expectNull(status([mismatch]));
    const wrongId = completed();
    wrongId.candidateId = 'G1';
    expectNull(status([wrongId]));
    for (const patch of [
      { contractRevision: 'wrong' }, { mode: 'execute' }, { paymentEnabled: true },
      { ready: 'true' }, { usedRequests: 0 }, { maxRequests: 1001 }, { [SECRET]: SECRET },
    ]) expectNull({ ...status(), ...patch });
    // Invalid unselected evidence invalidates the status; selecting H1 cannot hide it.
    const other = completed('G1');
    other.risk.address = address('H1');
    expectNull(status([completed(), other]));
  });

  it.each([
    { traitLabels: [SECRET], traitsCount: 1 }, { diagnosticCode: SECRET },
    { requestedNetwork: 'eip155:84532' }, { toxicScore: Infinity },
    { unknownTraitsCount: -1 }, { additionalFieldsCount: 16385 }, { [SECRET]: SECRET },
    { schemaDiagnostic: { ...diagnostics(), topLevelKeys: [SECRET] } },
    { schemaDiagnostic: { ...diagnostics(), toxicScoreType: SECRET } },
  ])('does not reflect arbitrary provider names/values or invalid evidence %#', patch => {
    const record = completed();
    Object.assign(record.risk.scan, patch);
    expectNull(status([record]));
  });
});

describe('one bounded data-only snapshot', () => {
  it('accepts ordinary null-prototype data objects', () => {
    const record = completed();
    const input = status([record]);
    for (const object of [input, record, record.risk, record.risk.scan]) Object.setPrototypeOf(object, null);
    expectSnapshot(input);
  });

  it('reads source data descriptors once and never passes live objects to either canonical builder', () => {
    const plain = status([completed('H1', ['mixer_transfers'], 50)]);
    const expected = {
      policy: evaluateLivePaymentPolicy(plain.records[0], '0.005'),
      originalScanReceipt: buildRiskReceipt(plain, 'H1'),
    };
    let reads = 0;
    let recordsDescriptors = 0;
    let scoreDescriptors = 0;
    const record = completed('H1', ['mixer_transfers'], 50);
    record.risk.scan = new Proxy(record.risk.scan, {
      get() { reads++; throw new Error('ordinary source reads are forbidden'); },
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (key === 'toxicScore') {
          scoreDescriptors++;
          return { ...descriptor!, value: scoreDescriptors === 1 ? 50 : 99 };
        }
        return descriptor;
      },
    });
    const input = new Proxy(status([record]), {
      get() { reads++; throw new Error('status must be detached before validation'); },
      getOwnPropertyDescriptor(target, key) {
        if (key === 'records') recordsDescriptors++;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const result = buildPaymentDecisionReceipt(input, 'H1', '0.005', EXPORTED_AT);
    expect(result).not.toBeNull();
    expect(result?.policy).toStrictEqual(expected.policy);
    expect(result?.originalScanReceipt).toStrictEqual(expected.originalScanReceipt);
    expect(reads).toBe(0);
    expect(recordsDescriptors).toBe(1);
    expect(scoreDescriptors).toBe(1);
  });

  it.each(['status', 'record', 'risk', 'scan', 'array', 'hidden'] as const)(
    'rejects throwing and stateful accessors at %s without invoking them', location => {
      for (const throwing of [false, true]) {
        const record = completed('H1', ['mixer_transfers']);
        const input = status([record]);
        const targets = {
          status: [input, 'records'], record: [record, 'risk'], risk: [record.risk, 'scan'],
          scan: [record.risk.scan, 'unknownTraitsCount'], array: [record.risk.scan.traitLabels!, '0'],
          hidden: [record.risk.scan, 'hidden'],
        } as const;
        const [target, key] = targets[location];
        let calls = 0;
        Object.defineProperty(target, key, {
          enumerable: location !== 'hidden', configurable: true,
          get() { calls++; if (throwing) throw new Error(SECRET); return calls === 1 ? 0 : 1; },
        });
        expectNull(input);
        expect(calls).toBe(0);
      }
    },
  );

  it('rejects setter-only properties and toJSON without calling user code', () => {
    let calls = 0;
    const input = status();
    Object.defineProperty(input, 'message', { enumerable: true, set() { calls++; } });
    expectNull(input);
    for (const nested of [false, true]) {
      const record = completed();
      const value = status([record]);
      Object.defineProperty(nested ? record.risk.scan : value, 'toJSON', {
        enumerable: false, value() { calls++; throw new Error(SECRET); },
      });
      expectNull(value);
    }
    expect(calls).toBe(0);
  });

  it('never coerces candidate, amount or clock objects', () => {
    let calls = 0;
    const coercible = { toString() { calls++; return '0.005'; }, valueOf() { calls++; return 1; } };
    expectNull(status(), coercible);
    expectNull(status(), 'H1', coercible);
    expectNull(status(), 'H1', '0.005', coercible);
    expect(calls).toBe(0);
  });

  it.each([
    { name: 'undefined', value: undefined }, { name: 'symbol', value: Symbol('synthetic') },
    { name: 'function', value: () => 0 }, { name: 'bigint', value: 1n },
    { name: 'NaN', value: NaN }, { name: 'infinity', value: Infinity },
    { name: 'Date', value: new Date(EXPORTED_AT) }, { name: 'Map', value: new Map() },
    { name: 'Set', value: new Set() }, { name: 'typed array', value: new Uint8Array(1) },
    { name: 'boxed primitive', value: new String('number') },
  ])('rejects non-JSON/exotic $name even in a normally omitted field', ({ value }) => {
    // The existing boundary ignores non-enumerable scan extras. The new data-only
    // boundary must inspect own descriptors, not just Object.keys or JSON.stringify.
    const record = completed();
    Object.defineProperty(record.risk.scan, 'hidden', { value });
    expectNull(status([record]));
  });

  it('rejects symbol keys, custom prototypes and inherited-only evidence', () => {
    const symbolInput = status();
    Object.defineProperty(symbolInput, Symbol('synthetic'), { value: 1 });
    expectNull(symbolInput);
    const inherited = completed();
    delete inherited.risk.scan.unknownTraitsCount;
    Object.setPrototypeOf(inherited.risk.scan, { unknownTraitsCount: 0 });
    expectNull(status([inherited]));
    const custom = status();
    Object.setPrototypeOf(custom, { extra: true });
    expectNull(custom);
    const array = status();
    Object.setPrototypeOf(array.records, Object.create(Array.prototype));
    expectNull(array);
  });

  it('rejects sparse arrays including diagnostics the existing guard would skip', () => {
    const input = status();
    input.records = Array<PrivateScanRecord>(1);
    expectNull(input);
    const record = completed();
    record.risk.scan.schemaDiagnostic = { ...diagnostics(), topLevelKeys: Array<string>(1) };
    expectNull(status([record]));
    record.risk.scan.schemaDiagnostic = diagnostics();
    record.risk.scan.traitLabels = Array<string>(1);
    record.risk.scan.traitsCount = 1;
    expectNull(status([record]));
  });

  it.each(['ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf'] as const)(
    'contains %s reflection failures at the root and nested scan', trap => {
      const handler: ProxyHandler<object> = { [trap]() { throw new Error(SECRET); } };
      expectNull(new Proxy(status(), handler));
      const record = completed();
      record.risk.scan = new Proxy<typeof record.risk.scan>(record.risk.scan, handler);
      expectNull(status([record]));
    },
  );

  it('contains revoked proxies and cycles, including cycles through omitted fields', () => {
    const revoked = Proxy.revocable(status(), {});
    revoked.revoke();
    expectNull(revoked.proxy);
    const input = status();
    Object.defineProperty(input.records[0].risk!.scan!, 'cycle', { value: input });
    expectNull(input);
    const array = status();
    Object.defineProperty(array.records, 'cycle', { value: array.records });
    expectNull(array);
  });

  it('rejects a branch beyond depth 16 (root depth 0) without inspecting its deeper sentinel', () => {
    let inspected = 0;
    const sentinel = new Proxy({}, { ownKeys() { inspected++; return []; } });
    let branch: object = sentinel;
    for (let depth = 0; depth < 17; depth++) branch = { next: branch };
    const input = status();
    Object.defineProperty(input.records[0].risk!.scan!, 'deep', { value: branch });
    expectNull(input);
    expect(inspected).toBe(0);
  });

  it('rejects more than 4096 visited values including primitives before a later sentinel', () => {
    let inspected = 0;
    const sentinel = new Proxy({}, { ownKeys() { inspected++; return []; } });
    const input = status();
    Object.defineProperty(input.records[0].risk!.scan!, 'wide', {
      value: [...Array<number>(4096).fill(0), sentinel],
    });
    expectNull(input);
    expect(inspected).toBe(0);
  });

  it('preserves the full current-catalog valid status with maximum bounded diagnostic shapes', () => {
    const records = PRIVATE_RISK_CANDIDATES.map(candidate => {
      const record = completed(candidate.id, Array<string>(20).fill('mixer_transfers'));
      record.risk.reasons = Array<string>(10).fill('x'.repeat(600));
      record.risk.scan.schemaDiagnostic = {
        ...diagnostics(), topLevelKeys: Array<string>(20).fill('metadata'),
      };
      record.risk.scan.additionalFieldsCount = 16384;
      return record;
    });
    const input = status(records);
    input.message = 'x'.repeat(600);
    expect(records).toHaveLength(PRIVATE_RISK_CANDIDATES.length);
    expect(isPrivateScanStatus(input)).toBe(true);
    for (const candidate of PRIVATE_RISK_CANDIDATES) {
      const result = expectSnapshot(input, candidate.id, '0.001000');
      expect(result.policy).toMatchObject({ decision: 'ALLOW_WITH_LIMIT', amountWithinLimit: true });
      expect(result.originalScanReceipt.schemaDiagnostic).toStrictEqual(records[0].risk.scan.schemaDiagnostic);
      expect(result.originalScanReceipt.traitLabels).toHaveLength(20);
      expect(result.originalScanReceipt.usedRequests).toBe(PRIVATE_RISK_CANDIDATES.length);
    }
  });
});

describe('privacy, immutability and detached outputs', () => {
  it('exports only canonical fields and bounded sanitized diagnostics', () => {
    const record = completed('H1', ['mixer_transfers'], 0);
    record.risk.scan.schemaDiagnostic = diagnostics();
    const result = expectSnapshot(status([record]));
    expect(result.originalScanReceipt.schemaDiagnostic).toStrictEqual(diagnostics());
    expect(result.originalScanReceipt).toMatchObject({ rawToxicScore: 0, additionalFieldsCount: 7 });
    const json = JSON.stringify(result);
    for (const forbidden of [SECRET, 'reasons', 'message', 'operationId', 'evidenceId', 'signature', 'hash', 'apiKey']) {
      expect(json).not.toContain(forbidden);
    }
    expect(JSON.parse(json)).toStrictEqual(result);
  });

  it('succeeds with deeply frozen input and returns fresh deterministic nested objects', () => {
    const record = completed('H1', ['mixer_transfers']);
    record.risk.scan.schemaDiagnostic = diagnostics();
    const input = status([record]);
    const before = JSON.stringify(input);
    freezeTree(input);
    const first = expectSnapshot(input);
    const second = expectSnapshot(input);
    expect(first).toStrictEqual(second);
    expect(first).not.toBe(second);
    expect(first.intent).not.toBe(second.intent);
    expect(first.policy).not.toBe(second.policy);
    expect(first.originalScanReceipt).not.toBe(second.originalScanReceipt);
    expect(first.originalScanReceipt.traitLabels).not.toBe(record.risk.scan.traitLabels);
    expect(first.originalScanReceipt.schemaDiagnostic?.topLevelKeys).not.toBe(record.risk.scan.schemaDiagnostic.topLevelKeys);
    expect(first.originalScanReceipt.schemaDiagnostic?.traitDiagnostic).not.toBe(record.risk.scan.schemaDiagnostic.traitDiagnostic);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('source mutations cannot rewrite already exported labels, diagnostics or intent', () => {
    const record = completed('H1', ['mixer_transfers']);
    record.risk.scan.schemaDiagnostic = diagnostics();
    const input = status([record]);
    const first = expectSnapshot(input);
    const saved = JSON.stringify(first);
    record.risk.scan.traitLabels![0] = 'blacklist';
    record.risk.scan.schemaDiagnostic.topLevelKeys[0] = 'metadata';
    record.risk.scan.schemaDiagnostic.traitDiagnostic!.missingRiskCount = 0;
    const second = expectSnapshot(input, 'H1', '0.001');
    expect(second.policy.decision).toBe('DENY');
    expect(JSON.stringify(first)).toBe(saved);
    expect(first.intent.amountUsdc).toBe('0.005');
  });

  it('mutating exported arrays/diagnostics cannot affect input, another export or a later export', () => {
    const record = completed('H1', ['mixer_transfers']);
    record.risk.scan.schemaDiagnostic = diagnostics();
    const input = status([record]);
    const before = JSON.stringify(input);
    const first = expectSnapshot(input);
    const second = expectSnapshot(input);
    // A future implementation may freeze output too. Rejected writes still prove
    // isolation, so check source and independent artifacts after either outcome.
    for (const mutate of [
      () => { first.originalScanReceipt.traitLabels[0] = 'blacklist'; },
      () => { first.originalScanReceipt.schemaDiagnostic!.topLevelKeys[0] = 'metadata'; },
      () => { first.originalScanReceipt.schemaDiagnostic!.traitDiagnostic!.missingRiskCount = 0; },
      () => { first.originalScanReceipt.schemaDiagnostic!.otherKeysCount = 0; },
    ]) {
      try { mutate(); } catch (error) { expect(error).toBeInstanceOf(TypeError); }
    }
    expect(JSON.stringify(input)).toBe(before);
    expect(expectSnapshot(input)).toStrictEqual(second);
    expect(second.originalScanReceipt.traitLabels).toEqual(['mixer_transfers']);
    expect(second.originalScanReceipt.schemaDiagnostic).toStrictEqual(diagnostics());
  });
});
