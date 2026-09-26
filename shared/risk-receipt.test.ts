import { describeScanSchema } from './scan-diagnostic.ts';
import { expect, it } from 'vitest';
import { INTERCEPTA_TRAIT_NAMES } from '../apps/buyer/src/intercepta-response.ts';
import type { RiskResult } from './contracts.ts';
import {
  PRIVATE_RISK_CANDIDATES,
  PRIVATE_SCAN_REVISION,
  type PrivateCandidateId,
  type PrivateScanRecord,
  type PrivateScanStatus,
} from './private-risk.ts';
import { buildRiskReceipt, RISK_RECEIPT_PROVENANCE_NOTE } from './risk-receipt.ts';

const address = (candidateId: PrivateCandidateId) => PRIVATE_RISK_CANDIDATES.find(item => item.id === candidateId)!.address;
const completed = (candidateId: PrivateCandidateId, toxicScore = 0, traitLabels: string[] = ['rug_pull']): PrivateScanRecord => ({
  candidateId,
  state: 'completed',
  attemptedAt: '2026-09-27T01:00:00.000Z',
  risk: {
    address: address(candidateId),
    checkedAt: '2026-09-27T01:02:03.000Z',
    provider: 'intercepta',
    source: 'live',
    decision: 'hold',
    reasons: ['private supplier text must never be exported'],
    scan: {
      transport: 'received',
      requestedNetwork: 'eip155:1',
      coverage: 'unverified',
      semantics: 'unverified',
      toxicScore,
      traitsCount: traitLabels.length,
      traitLabels,
    },
  },
});
const unavailable = (candidateId: PrivateCandidateId, scan?: NonNullable<RiskResult['scan']>): PrivateScanRecord => ({
  candidateId,
  state: 'unavailable',
  attemptedAt: '2026-09-27T01:03:00.000Z',
  risk: scan ? {
    address: address(candidateId),
    checkedAt: '2026-09-27T01:04:05.000Z',
    provider: 'intercepta',
    source: 'unavailable',
    decision: 'hold',
    reasons: ['private failure text must never be exported'],
    scan,
  } : null,
});
const status = (records: PrivateScanRecord[]): PrivateScanStatus => ({
  contractRevision: PRIVATE_SCAN_REVISION,
  mode: 'private-scan-only',
  paymentEnabled: false,
  ready: true,
  message: 'local status text must never be exported',
  maxRequests: 3,
  usedRequests: records.length,
  records,
});

it('exports only the explicit receipt shape and preserves a raw zero score', () => {
  const receipt = buildRiskReceipt(status([completed('H1', 0)]), 'H1');
  expect(receipt).not.toBeNull();
  expect(Object.keys(receipt!)).toEqual([
    'schemaVersion', 'candidateId', 'address', 'state', 'attemptedAt', 'localReceivedAt',
    'supplierUpdatedAt', 'requestedNetwork', 'rawToxicScore', 'traitsCount', 'traitLabels',
    'httpStatus', 'diagnosticCode', 'schemaDiagnostic', 'unknownTraitsCount',
    'additionalFieldsCount',
    'source', 'coverage', 'semantics', 'decision', 'paymentEnabled', 'usedRequests',
    'maxRequests', 'provenanceNote',
  ]);
  expect(receipt).toMatchObject({
    schemaVersion: 'risk-receipt-v2', candidateId: 'H1', address: address('H1'), state: 'completed',
    attemptedAt: '2026-09-27T01:00:00.000Z', localReceivedAt: '2026-09-27T01:02:03.000Z',
    supplierUpdatedAt: null, requestedNetwork: 'eip155:1', rawToxicScore: 0, traitsCount: 1,
    traitLabels: ['rug_pull'], httpStatus: null, diagnosticCode: null, schemaDiagnostic: null,
    unknownTraitsCount: null, additionalFieldsCount: null,
    source: 'live', coverage: 'unverified', semantics: 'unverified',
    decision: 'hold', paymentEnabled: false, usedRequests: 1, maxRequests: 3,
    provenanceNote: RISK_RECEIPT_PROVENANCE_NOTE,
  });
  const json = JSON.stringify(receipt);
  expect(json).not.toContain('private supplier text');
  expect(json).not.toContain('local status text');
  expect(json).not.toContain('/100');
  expect(json).not.toContain('verified payment');
});

it('binds the receipt to the selected catalog candidate', () => {
  const receipt = buildRiskReceipt(status([completed('H1', 4), completed('G1', 9)]), 'H1');
  expect(receipt?.candidateId).toBe('H1');
  expect(receipt?.address).toBe(address('H1'));
  expect(receipt?.rawToxicScore).toBe(4);
  expect(JSON.stringify(receipt)).not.toContain(address('G1'));
  expect(buildRiskReceipt(status([completed('G1')]), 'H1')).toBeNull();
  expect(buildRiskReceipt(status([completed('H1')]), '../secret')).toBeNull();
});

it('keeps pending and unavailable supplier facts explicitly unknown', () => {
  const pending: PrivateScanRecord = { candidateId: 'H1', state: 'pending', attemptedAt: '2026-09-27T01:00:00.000Z', risk: null };
  for (const [candidateId, receipt, source] of [
    ['H1', buildRiskReceipt(status([pending]), 'H1'), 'pending'],
    ['G1', buildRiskReceipt(status([unavailable('G1')]), 'G1'), 'unavailable'],
  ] as const) {
    expect(receipt).toMatchObject({ candidateId, source, localReceivedAt: null, supplierUpdatedAt: null,
      rawToxicScore: null, traitsCount: null, traitLabels: [], httpStatus: null,
      diagnosticCode: null, schemaDiagnostic: null, unknownTraitsCount: null,
      additionalFieldsCount: null, decision: 'hold', paymentEnabled: false });
  }
});

it('exports a numeric HTTP status and fixed category for a failed response without failure text', () => {
  const receipt = buildRiskReceipt(status([unavailable('H1', {
    transport: 'unavailable', requestedNetwork: 'eip155:1', coverage: 'unverified', semantics: 'unverified',
    httpStatus: 503, diagnosticCode: 'http-error',
  })]), 'H1');
  expect(receipt).toMatchObject({ state: 'unavailable', localReceivedAt: '2026-09-27T01:04:05.000Z',
    rawToxicScore: null, httpStatus: 503, diagnosticCode: 'http-error', schemaDiagnostic: null,
    unknownTraitsCount: null, additionalFieldsCount: null, decision: 'hold', paymentEnabled: false });
  expect(JSON.stringify(receipt)).not.toContain('private failure text');
});

it('exports a freshly constructed bounded schema summary for an HTTP 200 schema rejection', () => {
  const schemaDiagnostic = {
    topLevelKeys: ['toxicScore', 'traits', 'metadata'], otherKeysCount: 2,
    toxicScoreType: 'string', traitsType: 'array', traitsCount: 3,
  } as const;
  const record = unavailable('H1', {
    transport: 'received', requestedNetwork: 'eip155:1', coverage: 'unverified', semantics: 'unverified',
    httpStatus: 200, diagnosticCode: 'schema-unsupported', schemaDiagnostic: {
      ...schemaDiagnostic, topLevelKeys: [...schemaDiagnostic.topLevelKeys],
    },
  });
  const receipt = buildRiskReceipt(status([record]), 'H1');
  expect(receipt?.schemaDiagnostic).toEqual(schemaDiagnostic);
  record.risk!.scan!.schemaDiagnostic!.topLevelKeys[0] = 'metadata';
  record.risk!.scan!.schemaDiagnostic!.otherKeysCount = 9;
  expect(receipt?.schemaDiagnostic).toEqual(schemaDiagnostic);
  expect(receipt).toMatchObject({ httpStatus: 200, diagnosticCode: 'schema-unsupported',
    rawToxicScore: null, decision: 'hold', paymentEnabled: false });
});

it('keeps successful partial-recognition totals distinct from displayed allowlisted labels', () => {
  const record = completed('H1', 0, ['rug_pull', 'blacklist']);
  Object.assign(record.risk!.scan!, {
    httpStatus: 200, diagnosticCode: 'observed', traitsCount: 4,
    unknownTraitsCount: 2, additionalFieldsCount: 3,
  });
  expect(buildRiskReceipt(status([record]), 'H1')).toMatchObject({
    rawToxicScore: 0, traitsCount: 4, traitLabels: ['rug_pull', 'blacklist'],
    httpStatus: 200, diagnosticCode: 'observed', schemaDiagnostic: null,
    unknownTraitsCount: 2, additionalFieldsCount: 3,
    decision: 'hold', paymentEnabled: false,
  });
});

it.each(INTERCEPTA_TRAIT_NAMES)('exports the existing allowlisted label %s', label => {
  expect(buildRiskReceipt(status([completed('H1', 2, [label])]), 'H1')?.traitLabels).toEqual([label]);
});

it('rejects missing, malformed, extra-field, and non-allowlisted inputs', () => {
  expect(buildRiskReceipt(null, 'H1')).toBeNull();
  expect(buildRiskReceipt(status([]), 'H1')).toBeNull();
  const extra = { ...status([completed('H1')]), apiKey: 'do-not-export' };
  expect(buildRiskReceipt(extra, 'H1')).toBeNull();
  const badLabel = status([completed('H1', 1, ['<script>steal()</script>'])]);
  expect(buildRiskReceipt(badLabel, 'H1')).toBeNull();
});

it('never exports mutated secrets or accepts invalid diagnostic values', () => {
  const safe = completed('H1');
  safe.risk!.reasons = ['SECRET_FREE_TEXT'];
  Object.assign(safe.risk!.scan!, {
    httpStatus: 200, diagnosticCode: 'observed', unknownTraitsCount: 0, additionalFieldsCount: 7,
  });
  const receipt = buildRiskReceipt(status([safe]), 'H1');
  const json = JSON.stringify(receipt);
  expect(json).not.toContain('SECRET_FREE_TEXT');
  expect(json).not.toContain('apiKey');

  const invalidCode = status([completed('H1')]);
  const invalidCodeInput = { ...invalidCode, records: invalidCode.records.map(record => ({ ...record,
    risk: { ...record.risk!, scan: { ...record.risk!.scan!, diagnosticCode: 'SECRET_DIAGNOSTIC' } },
  })) };
  const validSchemaRecord = unavailable('H1', {
    transport: 'received', requestedNetwork: 'eip155:1', coverage: 'unverified', semantics: 'unverified',
    diagnosticCode: 'schema-unsupported', schemaDiagnostic: {
      topLevelKeys: ['toxicScore'], otherKeysCount: 0, toxicScoreType: 'string', traitsType: 'array',
    },
  });
  const invalidSchema = status([validSchemaRecord]);
  const invalidSchemaInput = { ...invalidSchema, records: invalidSchema.records.map(record => ({ ...record,
    risk: { ...record.risk!, scan: { ...record.risk!.scan!, schemaDiagnostic: {
      ...record.risk!.scan!.schemaDiagnostic!, toxicScoreType: 'SECRET_TYPE',
    } } },
  })) };
  const extraScanField = status([completed('H1')]);
  const extraScanFieldInput = { ...extraScanField, records: extraScanField.records.map(record => ({ ...record,
    risk: { ...record.risk!, scan: { ...record.risk!.scan!, apiKey: 'SECRET_API_KEY' } },
  })) };
  expect(buildRiskReceipt(invalidCodeInput, 'H1')).toBeNull();
  expect(buildRiskReceipt(invalidSchemaInput, 'H1')).toBeNull();
  expect(buildRiskReceipt(extraScanFieldInput, 'H1')).toBeNull();
});

it('normalizes parseable timestamps so date comments cannot leak into the summary', () => {
  const record = completed('H1');
  record.attemptedAt = 'Sun, 27 Sep 2026 01:00:00 GMT (private-comment)';
  record.risk!.checkedAt = 'Sun, 27 Sep 2026 01:02:03 GMT (private-comment)';
  const receipt = buildRiskReceipt(status([record]), 'H1');
  expect(receipt).toMatchObject({attemptedAt:'2026-09-27T01:00:00.000Z',localReceivedAt:'2026-09-27T01:02:03.000Z'});
  expect(JSON.stringify(receipt)).not.toContain('private-comment');
});

it('exports a fresh trait-shape count summary without provider values', () => {
  const schemaDiagnostic = describeScanSchema({ toxicScore: 1, traits: [{ name:'known_scammer', description:'SECRET' }, {name:'SECRET-UNKNOWN'}] });
  const record = unavailable('H1', {transport:'received', requestedNetwork:'eip155:1', coverage:'unverified', semantics:'unverified', httpStatus:200, diagnosticCode:'schema-unsupported', schemaDiagnostic});
  const receipt = buildRiskReceipt(status([record]), 'H1');
  expect(receipt?.schemaDiagnostic?.traitDiagnostic).toMatchObject({missingRiskCount:1, missingTxsCount:1, unknownTraitItems:1});
  expect(receipt?.schemaDiagnostic?.traitDiagnostic).not.toBe(schemaDiagnostic.traitDiagnostic);
  expect(JSON.stringify(receipt)).not.toContain('SECRET');
});
