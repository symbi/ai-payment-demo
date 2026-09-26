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
  for (const html of [notReady, exhausted, pending]) expect(html).toContain('Run live assessment');
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
  expect(html).toContain('Assessment pending'); expect(html).toContain('HOLD'); expect(html).toContain('Execution: NOT CONNECTED');
});

it.each([
  { labels: [] as string[], decision: 'ALLOW' },
  { labels: ['mixer_transfers'], decision: 'ALLOW WITH LIMIT' },
  { labels: ['sanction_address'], decision: 'DENY' },
])('labels fixture evidence explicitly without changing $decision or its input', ({ labels, decision }) => {
  const record = completed('H1', labels.length ? 50 : 0);
  Object.assign(record.risk.scan, { httpStatus: 200, unknownTraitsCount: 0, traitsCount: labels.length, traitLabels: labels });
  const status = baseStatus({ usedRequests: 1, records: [record] });
  const before = JSON.stringify(status);
  const normal = renderLivePanel(createElement(PrivateRiskPanel, props(status)));
  const fixture = renderLivePanel(createElement(PrivateRiskPanel, { ...props(status), offlineFixture: true }));
  expect(normal).toContain('Intercepta Live'); expect(normal).toContain('>LIVE<');
  expect(normal).not.toContain('Synthetic provider evidence'); expect(normal).not.toContain('SIMULATED');
  expect(fixture).toContain('Synthetic provider evidence'); expect(fixture).toContain('Not a live Intercepta response');
  expect(fixture).toContain('>SIMULATED<'); expect(fixture).not.toContain('>LIVE<');
  expect(fixture).not.toContain('is-live'); expect(fixture).not.toContain('Intercepta reported');
  expect(fixture).not.toContain('complete live response');
  for (const html of [normal, fixture]) expect(html).toContain(`>${decision}<`);
  const facts = (html: string) => html.match(/<dl class="private-risk-policy-facts">.*?<\/dl>/)?.[0];
  expect(facts(fixture)).toEqual(facts(normal));
  expect(JSON.stringify(status)).toBe(before);
});

it('keeps fixture provenance explicit through loading and missing evidence', () => {
  for (const status of [null, baseStatus()]) {
    const html = renderLivePanel(createElement(PrivateRiskPanel, { ...props(status), loading: true, offlineFixture: true }));
    expect(html).toContain('Synthetic provider evidence'); expect(html).toContain('Not a live Intercepta response');
    expect(html).toContain('>SIMULATED<'); expect(html).not.toContain('Intercepta Live');
    expect(html).toContain('HOLD');
  }
});

it.each([false, true])('shows saved L2 evidence as a non-button status (fixture=%s)', offlineFixture => {
  const record = { ...completed('H1', 0), candidateId: 'L2' as const };
  record.risk.address = PRIVATE_RISK_CANDIDATES.find(item => item.id === 'L2')!.address;
  Object.assign(record.risk.scan, { httpStatus: 200, unknownTraitsCount: 0, traitsCount: 0, traitLabels: [] });
  const status = baseStatus({ maxRequests: 200, usedRequests: 1, records: [record] });
  const html = renderLivePanel(createElement(PrivateRiskPanel, { ...props(status), selectedId: 'L2', offlineFixture }));
  expect(html).toContain(offlineFixture ? 'Using saved simulated assessment' : 'Using saved live assessment');
  expect(html).toContain('No rescan required'); expect(html).toContain('does not refresh provider evidence');
  expect(html).not.toContain('private-risk-primary'); expect(html).not.toContain('Assess Payment');
  expect(html).toMatch(/<button[^>]*>Refresh saved records<\/button>/);
});

it.each(['unavailable', 'pending', 'loading', 'legacy'] as const)('does not present %s records as a successful live assessment', state => {
  const record = state === 'unavailable' || state === 'pending'
    ? { candidateId: 'H1' as const, state, attemptedAt: '2026-09-27T00:00:00Z', risk: null }
    : completed('H1', 0);
  const html = renderLivePanel(createElement(PrivateRiskPanel, { ...props(baseStatus({ records: [record] })), loading: state === 'loading' }));
  expect(html).not.toContain('private-risk-primary'); expect(html).not.toContain('Using saved live assessment');
  expect(html).toContain({ unavailable: 'Saved assessment unavailable', pending: 'Assessment pending', loading: 'Loading saved assessment', legacy: 'Using saved assessment · Evidence unavailable' }[state]);
  if (state === 'pending') expect(html).toContain('Do not submit another assessment');
});

it.each([false, true])('only offers a first assessment with the correct provenance label (fixture=%s)', offlineFixture => {
  const html = renderLivePanel(createElement(PrivateRiskPanel, { ...props(baseStatus()), offlineFixture }));
  expect(html).toMatch(new RegExp(`<button class="private-risk-primary" type="button">Run ${offlineFixture ? 'simulated' : 'live'} assessment</button>`));
  expect(html).not.toContain('private-risk-saved-assessment');
});

it('preserves disabled first-assessment guards for loading, missing status, not-ready, quota and pending', () => {
  const cases = [
    { ...props(baseStatus()), loading: true }, props(null), props(baseStatus({ ready: false })),
    props(baseStatus({ usedRequests: 3 })),
    props(baseStatus({ records: [{ candidateId: 'G1', state: 'pending', attemptedAt: '2026-09-27T00:00:00Z', risk: null }] })),
  ];
  for (const item of cases) {
    const html = renderLivePanel(createElement(PrivateRiskPanel, item));
    expect(html).toMatch(/<button class="private-risk-primary" type="button" disabled="">Run live assessment<\/button>/);
  }
});
