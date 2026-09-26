import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PRIVATE_SCAN_REVISION, PRIVATE_RISK_CANDIDATES, type PrivateScanStatus } from '../../../shared/private-risk.ts';
import { PrivateRiskPanel } from './PrivateRiskPanel.tsx';

// Keep live-record assertions independent of the separately tested synthetic section.
function renderLivePanel(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  const html = renderToStaticMarkup(element);
  const sandboxStart = html.indexOf('<section class="policy-sandbox"');
  expect(sandboxStart).toBeGreaterThan(0);
  return html.slice(0, sandboxStart);
}

const baseStatus = (overrides: Partial<PrivateScanStatus> = {}): PrivateScanStatus => ({
  contractRevision: PRIVATE_SCAN_REVISION, mode: 'private-scan-only', paymentEnabled: false, ready: true,
  message: '', maxRequests: 3, usedRequests: 0, records: [], ...overrides,
});
const props = (status: PrivateScanStatus | null, selectedId: 'H1' | 'G1' = 'H1') => ({
  selectedId, status, loading: false, message: '', onSelect: () => {}, onScan: () => {}, onRefresh: () => {},
});
const completed = (candidateId: 'H1' | 'G1', toxicScore: number) => ({ candidateId, state: 'completed' as const, attemptedAt: '2026-09-27T01:00:00.000Z', risk: {
  address: PRIVATE_RISK_CANDIDATES.find(item => item.id === candidateId)!.address, checkedAt: '2026-09-27T01:02:03.000Z', provider: 'intercepta' as const, source: 'live' as const, decision: 'hold' as const,
  reasons: ['本地检查产生的说明'], scan: { transport: 'received' as const, requestedNetwork: 'eip155:1', coverage: 'unverified' as const, semantics: 'unverified' as const, toxicScore, traitsCount: 1, traitLabels: ['rug_pull'] },
} });

it('renders an unassessed live region without synthetic results', () => {
  const html = renderLivePanel(createElement(PrivateRiskPanel, props(null)));
  expect(html).toContain('Agent Payment Guard'); expect(html).toContain('Intercepta Awaiting'); expect(html).toContain('Missing'); expect(html).toContain('disabled');
});

it('disables scanning when status is not ready, exhausted, or pending', () => {
  const notReady = renderLivePanel(createElement(PrivateRiskPanel, props(baseStatus({ ready: false, message: '需私人电脑启动' }))));
  const exhausted = renderLivePanel(createElement(PrivateRiskPanel, props(baseStatus({ usedRequests: 3 }))));
  const pending = renderLivePanel(createElement(PrivateRiskPanel, props(baseStatus({ usedRequests: 1, records: [{ candidateId: 'G1', state: 'pending', attemptedAt: '2026-09-27T01:00:00.000Z', risk: null }] }))));
  for (const html of [notReady, exhausted, pending]) expect(html).toContain('Assess Payment');
  expect(notReady).toContain('not ready on this device'); expect(notReady).not.toContain('需私人电脑启动'); expect(exhausted).toContain('3/3'); expect(pending).toContain('A scan is pending');
});

it('shows a legacy zero raw score without turning it into a safety grade', () => {
  const html = renderLivePanel(createElement(PrivateRiskPanel, props(baseStatus({ usedRequests: 1, records: [completed('H1', 0)] }))));
  expect(html).toContain('Toxic Score'); expect(html).toContain('>0<'); expect(html).not.toContain('Address is safe'); expect(html).toContain('HOLD');
  expect(html).toContain('evidence_unavailable'); expect(html).not.toContain('>ALLOW<');
  expect(html).not.toContain('/100'); expect(html).not.toContain('本地检查产生的说明'); expect(html).toContain('Technical details');
});

it('renders unavailable records as failed evidence and keeps selected records separate', () => {
  const unavailable = { candidateId: 'H1' as const, state: 'unavailable' as const, attemptedAt: '2026-09-27T01:00:00.000Z', risk: null };
  const failedHtml = renderLivePanel(createElement(PrivateRiskPanel, props(baseStatus({ usedRequests: 1, records: [unavailable] }))));
  const otherHtml = renderLivePanel(createElement(PrivateRiskPanel, props(baseStatus({ usedRequests: 2, records: [unavailable, completed('G1', 7)] }), 'G1')));
  expect(failedHtml).toContain('Evidence unavailable'); expect(failedHtml).toContain('HOLD');
  expect(otherHtml).toContain('>7<'); expect(otherHtml).not.toContain('本地检查产生的说明'); expect(otherHtml).not.toContain('>0<');
});

it('renders pending as unconfirmed and does not claim that it was never requested', () => {
  const html = renderLivePanel(createElement(PrivateRiskPanel, props(baseStatus({ usedRequests: 1, records: [{ candidateId: 'H1', state: 'pending', attemptedAt: '2026-09-27T01:00:00.000Z', risk: null }] }))));
  expect(html).toContain('A scan is pending'); expect(html).toContain('HOLD'); expect(html).toContain('Execution: NOT CONNECTED');
});
