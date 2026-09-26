import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RiskResult } from '../../../shared/contracts.ts';
import {
  PRIVATE_RISK_CANDIDATES,
  PRIVATE_SCAN_REVISION,
  type PrivateCandidateId,
  type PrivateRiskPanelProps,
  type PrivateScanRecord,
  type PrivateScanStatus,
} from '../../../shared/private-risk.ts';
import { PrivateRiskDemo } from './PrivateRiskDemo.tsx';
import { PrivateRiskPanel } from './PrivateRiskPanel.tsx';

type Scan = NonNullable<RiskResult['scan']>;

const candidate = (id: PrivateCandidateId) => PRIVATE_RISK_CANDIDATES.find(item => item.id === id)!;

const scan = (overrides: Partial<Scan> = {}): Scan => ({
  transport: 'received',
  requestedNetwork: 'eip155:1',
  coverage: 'unverified',
  semantics: 'unverified',
  httpStatus: 200,
  toxicScore: 0,
  traitsCount: 0,
  traitLabels: [],
  unknownTraitsCount: 0,
  ...overrides,
});

const record = (
  candidateId: PrivateCandidateId,
  source: 'live' | 'unavailable',
  observedScan: Scan,
): PrivateScanRecord => ({
  candidateId,
  state: source === 'live' ? 'completed' : 'unavailable',
  attemptedAt: '2026-09-27T01:00:00.000Z',
  risk: {
    address: candidate(candidateId).address,
    checkedAt: '2026-09-27T01:02:03.000Z',
    provider: 'intercepta',
    source,
    decision: 'hold',
    reasons: ['bounded fixture reason'],
    scan: observedScan,
  },
});

const liveEmpty = record('H1', 'live', scan());
const liveMixer50 = record('G1', 'live', scan({
  toxicScore: 50,
  traitsCount: 1,
  traitLabels: ['mixer_transfers'],
}));
const liveSanction50 = record('L1', 'live', scan({
  toxicScore: 50,
  traitsCount: 1,
  traitLabels: ['sanction_address'],
}));
const unavailable = record('G2', 'unavailable', scan({
  transport: 'unavailable',
  httpStatus: 404,
  diagnosticCode: 'http-error',
  toxicScore: undefined,
  traitsCount: undefined,
  traitLabels: undefined,
  unknownTraitsCount: undefined,
}));

const status = (records: PrivateScanRecord[] = []): PrivateScanStatus => ({
  contractRevision: PRIVATE_SCAN_REVISION,
  mode: 'private-scan-only',
  paymentEnabled: false,
  ready: true,
  message: '',
  maxRequests: 20,
  usedRequests: records.length,
  records,
});

const renderLivePanel = (
  selectedId: PrivateCandidateId,
  records: PrivateScanRecord[] = [],
  overrides: Partial<PrivateRiskPanelProps> = {},
) => {
  const html = renderToStaticMarkup(createElement(PrivateRiskPanel, {
  selectedId,
  status: status(records),
  loading: false,
  message: '',
  onSelect() {},
  onScan() {},
  onRefresh() {},
  ...overrides,
  }));
  // The standalone synthetic section is not evidence for the selected live intent.
  const sandboxStart = html.indexOf('<section class="policy-sandbox"');
  expect(sandboxStart).toBeGreaterThan(0);
  return html.slice(0, sandboxStart);
};

const visibleText = (html: string) => html
  .replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&#x27;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

function expectCollapsedDetails(html: string, summary: string, contents: readonly string[]) {
  const summaryMarkup = `<summary>${summary}</summary>`;
  const summaryIndex = html.indexOf(summaryMarkup);
  expect(summaryIndex, `missing disclosure summary: ${summary}`).toBeGreaterThanOrEqual(0);
  const start = html.lastIndexOf('<details', summaryIndex);
  const end = html.indexOf('</details>', summaryIndex);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(summaryIndex);
  const disclosure = html.slice(start, end + '</details>'.length);
  expect(disclosure.match(/^<details[^>]*>/)?.[0]).not.toMatch(/\bopen(?:=|\s|>)/);
  for (const content of contents) expect(disclosure).toContain(content);
}

function enabledInteractiveControlLabels(html: string): string[] {
  const controls = html.match(
    /<button\b[^>]*>[\s\S]*?<\/button>|<a\b[^>]*>[\s\S]*?<\/a>|<input\b[^>]*>/g,
  ) ?? [];

  return controls
    .filter(control => !/\bdisabled(?:=|\s|>)|aria-disabled="true"/i.test(control))
    .map(control => {
      const accessibleLabel = control.match(/aria-label="([^"]*)"/i)?.[1] ?? '';
      const value = control.match(/value="([^"]*)"/i)?.[1] ?? '';
      return `${visibleText(control)} ${accessibleLabel} ${value}`.trim();
    });
}

describe('four-step payment decision demo contract', () => {
  it('renders the English four-step flow with the default payment intent', () => {
    const html = renderLivePanel('H1');
    const text = visibleText(html);

    expect(text).toContain('Agent Payment Guard');
    expect(text).toContain('Screen recipients before autonomous payments.');
    expect(text).toMatch(/STEP\s*01\s+Payment intent/);
    expect(text).toMatch(/STEP\s*02\s+Intercepta evidence/);
    expect(text).toMatch(/STEP\s*03\s+Project policy/);
    expect(text).toMatch(/STEP\s*04\s+Execution gating/);
    expect(text).toContain('Report Buyer 01');
    expect(html).toMatch(/<input[^>]+value="0\.005"[^>]*>/);
    expect(text).toContain('USDC');
    expect(text).toContain('Ethereum Mainnet for screening');
    expect(text).toMatch(/Coverage:? unverified/i);
    expect(text).toContain('Run live assessment');
    expect(text).toContain('Screened before any signing or execution.');
    expect(html).toMatch(/<option[^>]*>Case H1<\/option>/);
    expect(text).toContain(candidate('H1').address);
  });

  it.each([
    ['clean live evidence', 'H1', liveEmpty, 'ALLOW'],
    ['moderate evidence', 'G1', liveMixer50, 'ALLOW WITH LIMIT'],
    ['hard-deny evidence', 'L1', liveSanction50, 'DENY'],
    ['unavailable evidence', 'G2', unavailable, 'HOLD'],
  ] as const)('shows %s as a named project-policy decision with disconnected execution', (_caseName, selectedId, selectedRecord, decision) => {
    const html = renderLivePanel(selectedId, [selectedRecord]);
    const text = visibleText(html);

    expect(text).toContain('Project/Intercepta Payment Policy v1');
    expect(text).toContain('project-intercepta-payment-policy-v1');
    expect(text).toMatch(/project-defined demo rules? use Intercepta observations/i);
    expect(text).toMatch(/not an Intercepta verdict/i);
    expect(text).toContain(decision);
    expect(text).toContain('Execution: NOT CONNECTED');
    expect(text).not.toContain('Payment completed');
    expect(text).not.toContain('Payment sent');
    expect(enabledInteractiveControlLabels(html)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/\b(?:Pay|Sign|Connect wallet|Execute payment)\b/i)]),
    );
  });

  it('keeps identical provider scores as raw evidence while traits drive different actions', () => {
    const records = [liveMixer50, liveSanction50];
    const mixer = visibleText(renderLivePanel('G1', records));
    const sanction = visibleText(renderLivePanel('L1', records));

    for (const text of [mixer, sanction]) {
      expect(text).toContain('Toxic Score');
      expect(text).toContain('50');
      expect(text).not.toContain('50%');
      expect(text).toContain('Execution: NOT CONNECTED');
    }
    expect(mixer).toContain('mixer_transfers');
    expect(mixer).toContain('ALLOW WITH LIMIT');
    expect(mixer).toContain('0.001 USDC');
    expect(mixer).toContain('0.005 USDC');
    expect(mixer).toMatch(/reduce (?:the )?amount.{0,80}0\.001 USDC/i);
    expect(sanction).toContain('sanction_address');
    expect(sanction).toContain('DENY');
    expect(sanction).toMatch(/Why(?:(?!Next action).){0,300}sanction_address/i);
  });

  it('uses only the selected saved record and does not show a stale decision from another candidate', () => {
    const records = [liveEmpty, liveSanction50];
    const clean = visibleText(renderLivePanel('H1', records));
    const denied = visibleText(renderLivePanel('L1', records));

    expect(clean).toContain('ALLOW');
    expect(clean).not.toContain('sanction_address');
    expect(clean).not.toContain('DENY');
    expect(denied).toContain('DENY');
    expect(denied).toContain('sanction_address');
  });

  it('shows observed evidence and makes source validity explicit', () => {
    const live = visibleText(renderLivePanel('G1', [liveMixer50]));
    const missing = visibleText(renderLivePanel('G2', [unavailable]));

    expect(live).toMatch(/Source:? LIVE/);
    expect(live).toMatch(/Evidence:? 1/);
    expect(live).toContain('mixer_transfers');
    expect(live).toContain('Intercepta Live');
    expect(missing).toMatch(/Awaiting live evidence|Evidence unavailable/);
    expect(missing).toMatch(/Intercepta (?:Awaiting|Unavailable)/);
    expect(missing).not.toContain('Intercepta Live');
    expect(missing).not.toContain('Source LIVE');
  });

  it('keeps bounded diagnostics collapsed instead of placing them in the main flow', () => {
    const html = renderLivePanel('G2', [unavailable]);

    expectCollapsedDetails(html, 'Technical details', ['HTTP status', '404']);
  });

  it('labels the preserved v2 receipt as the original scan receipt and keeps export collapsed', () => {
    const html = renderLivePanel('H1', [liveEmpty]);

    expectCollapsedDetails(html, 'Technical / audit details', [
      'Original scan receipt',
      'v2',
      'HOLD',
      'Source clues (unverified)',
      '制裁资料候选 A',
    ]);
    expect(visibleText(html)).not.toContain('Policy receipt');
    expect(html).not.toContain('bounded fixture reason');
  });

  it('keeps spending controls in a collapsed advanced disclosure without inventing a budget', () => {
    const html = renderToStaticMarkup(createElement(PrivateRiskDemo));
    const text = visibleText(html);

    expectCollapsedDetails(html, 'Advanced spending policy', ['Agent Spending Policy']);
    expect(text).toContain('Task budget: Not configured');
    expect(text).not.toContain('Task budget: 0.010 USDC');
    expect(text).not.toContain('Per-payment limit: 0.005 USDC');
    expect(text).not.toContain('Valid for: 30 min');
  });

  it('holds while loading instead of exposing a stale allow decision', () => {
    const text = visibleText(renderLivePanel('H1', [liveEmpty], { loading: true }));

    expect(text).toContain('HOLD');
    expect(text).toContain('Execution: NOT CONNECTED');
    expect(text).not.toContain('ALLOW');
  });
});
