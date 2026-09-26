import { expect, it } from 'vitest';
import { INTERCEPTA_TRAIT_NAMES } from '../apps/buyer/src/intercepta-response.ts';
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
    'source', 'coverage', 'semantics', 'decision', 'paymentEnabled', 'usedRequests',
    'maxRequests', 'provenanceNote',
  ]);
  expect(receipt).toMatchObject({
    schemaVersion: 'risk-receipt-v1', candidateId: 'H1', address: address('H1'), state: 'completed',
    attemptedAt: '2026-09-27T01:00:00.000Z', localReceivedAt: '2026-09-27T01:02:03.000Z',
    supplierUpdatedAt: null, requestedNetwork: 'eip155:1', rawToxicScore: 0, traitsCount: 1,
    traitLabels: ['rug_pull'], source: 'live', coverage: 'unverified', semantics: 'unverified',
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
  const unavailable: PrivateScanRecord = { candidateId: 'G1', state: 'unavailable', attemptedAt: '2026-09-27T01:03:00.000Z', risk: null };
  for (const [candidateId, receipt, source] of [
    ['H1', buildRiskReceipt(status([pending]), 'H1'), 'pending'],
    ['G1', buildRiskReceipt(status([unavailable]), 'G1'), 'unavailable'],
  ] as const) {
    expect(receipt).toMatchObject({ candidateId, source, localReceivedAt: null, supplierUpdatedAt: null, rawToxicScore: null, traitsCount: null, traitLabels: [], decision: 'hold', paymentEnabled: false });
  }
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

it('normalizes parseable timestamps so date comments cannot leak into the summary', () => {
  const record = completed('H1');
  record.attemptedAt = 'Sun, 27 Sep 2026 01:00:00 GMT (private-comment)';
  record.risk!.checkedAt = 'Sun, 27 Sep 2026 01:02:03 GMT (private-comment)';
  const receipt = buildRiskReceipt(status([record]), 'H1');
  expect(receipt).toMatchObject({attemptedAt:'2026-09-27T01:00:00.000Z',localReceivedAt:'2026-09-27T01:02:03.000Z'});
  expect(JSON.stringify(receipt)).not.toContain('private-comment');
});
