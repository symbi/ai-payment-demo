import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { INTERCEPTA_TRAIT_NAMES } from '../../buyer/src/intercepta-response.ts';
import { PRIVATE_RISK_CANDIDATES, PRIVATE_SCAN_REVISION, type PrivateScanRecord } from '../../../shared/private-risk.ts';
import { evaluateLivePaymentPolicy } from '../../../shared/live-payment-policy.ts';
import { describeSavedEvidence, TRAIT_RULE_REFERENCE } from './risk-evidence-display.ts';
import { PrivateRiskPanel } from './PrivateRiskPanel.tsx';

const saved = (labels: string[], count = labels.length, unknown: number | undefined = 0): PrivateScanRecord => ({
  candidateId: 'H1', state: 'completed', attemptedAt: '2026-09-27T00:00:00Z',
  risk: { address: PRIVATE_RISK_CANDIDATES[0].address, checkedAt: '2026-09-27T00:00:00Z', provider: 'intercepta', source: 'live', decision: 'hold', reasons: [],
    scan: { transport: 'received', httpStatus: 200, requestedNetwork: 'eip155:1', coverage: 'unverified', semantics: 'unverified', toxicScore: 50,
      traitsCount: count, traitLabels: labels, ...(unknown === undefined ? {} : { unknownTraitsCount: unknown }) } },
});
function render(record: PrivateScanRecord | undefined) {
  const html = renderToStaticMarkup(createElement(PrivateRiskPanel, { selectedId: 'H1', status: { contractRevision: PRIVATE_SCAN_REVISION,
    mode: 'private-scan-only', paymentEnabled: false, ready: true, maxRequests: 200, usedRequests: record ? 1 : 0, records: record ? [record] : [], message: '' },
    loading: false, message: '', onSelect() {}, onScan() {}, onRefresh() {} }));
  return html.slice(0, html.indexOf('<section class="policy-sandbox"'));
}
it('derives the whole vocabulary and 3/6/6 rule reference without changing recipient decisions', () => {
  expect(TRAIT_RULE_REFERENCE.map(item => item.label)).toEqual([...INTERCEPTA_TRAIT_NAMES]);
  expect(TRAIT_RULE_REFERENCE.filter(item => item.reason === 'hard_deny_trait')).toHaveLength(3);
  expect(TRAIT_RULE_REFERENCE.filter(item => item.reason === 'moderate_trait')).toHaveLength(6);
  expect(TRAIT_RULE_REFERENCE.filter(item => item.reason === 'unmapped_trait')).toHaveLength(6);
  for (const item of TRAIT_RULE_REFERENCE) expect(item.reason).toBe(evaluateLivePaymentPolicy(saved([item.label]), '0.0005').reasonCode);
});
it('does not turn repeated entries or total count into distinct recognized types', () => {
  const view = describeSavedEvidence(saved(['mixer_transfers', 'mixer_transfers'], 3));
  expect(view.labels).toHaveLength(2); expect(view.uniqueLabels).toEqual(['mixer_transfers']);
  expect(view.reportedEntries).toBe(3); expect(view.completeness).toBe('Incomplete');
  expect(render(saved(['mixer_transfers', 'mixer_transfers'], 3))).toContain('2 displayed saved label entries · 1 distinct recognized types');
});
it('keeps saved recognized labels visible even when unknown evidence short-circuits policy evaluation', () => {
  const record = saved(['sanction_address'], 2, 1), before = JSON.stringify(record);
  const view = describeSavedEvidence(record);
  expect(view.uniqueLabels).toEqual(['sanction_address']); expect(view.unknownCount).toBe(1); expect(view.completeness).toBe('Incomplete');
  expect(evaluateLivePaymentPolicy(record, '0.005').reasonCode).toBe('unknown_traits');
  expect(render(record)).toContain('>HOLD<'); expect(JSON.stringify(record)).toBe(before);
});
it('missing unknown count is Unknown, never synthetic zero or complete', () => {
  const record = saved([]); delete record.risk!.scan!.unknownTraitsCount;
  expect(describeSavedEvidence(record)).toMatchObject({ unknownCount: null, completeness: 'Unknown' });
  expect(render(record)).toContain('Unknown trait entries</dt><dd>Unknown');
  expect(render(record)).toContain('>HOLD<');
});
it('missing labels and unavailable records do not produce zero saved label counts', () => {
  const record = saved([]); delete record.risk!.scan!.traitLabels;
  expect(describeSavedEvidence(record)).toMatchObject({ labels: null, uniqueLabels: null, available: false, completeness: 'Unknown' });
  expect(render(record)).toContain('Unknown displayed saved label entries · Unknown distinct recognized types');
  expect(describeSavedEvidence(undefined)).toMatchObject({ reportedEntries: null, unknownCount: null });
});
it('explicit zero is a saved observation, not proof that unobserved risks are absent', () => {
  const html = render(saved([]));
  expect(html).toContain('Complete saved evidence'); expect(html).toContain('Not observed in saved evidence');
  expect(html).toContain('not a checklist of passed checks'); expect(html).toContain('This does not establish absence of risk');
  expect(html).toContain('Raw provider signal — not used as a threshold by this policy');
  expect(html).not.toMatch(/(?:safe|pass) badge|risk.free|all checks passed/i);
});
it.each([['mixer_transfers', 'ALLOW WITH LIMIT'], ['sanction_address', 'DENY'], ['rug_pull', 'HOLD']] as const)('same raw score retains %s evidence and %s outcome', (label, outcome) => {
  const html = render(saved([label]));
  expect(html).toContain('>50<'); expect(html).toContain(`>${outcome}<`); expect(html).toContain(label);
  if (label === 'mixer_transfers') expect(html).toContain('Exceeds policy cap — amount unchanged');
});
