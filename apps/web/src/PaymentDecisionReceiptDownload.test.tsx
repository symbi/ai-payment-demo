import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RiskResult } from '../../../shared/contracts.ts';
import {
  PRIVATE_RISK_CANDIDATES,
  PRIVATE_SCAN_REVISION,
  type PrivateCandidateId,
  type PrivateScanRecord,
  type PrivateScanStatus,
} from '../../../shared/private-risk.ts';
import { PaymentDecisionReceiptDownload } from './PaymentDecisionReceiptDownload.tsx';
import { PrivateRiskPanel } from './PrivateRiskPanel.tsx';

type Scan = NonNullable<RiskResult['scan']>;

const candidate = (id: PrivateCandidateId) =>
  PRIVATE_RISK_CANDIDATES.find(item => item.id === id)!;

const liveRecord = (
  candidateId: PrivateCandidateId,
  traitLabels: string[],
  overrides: Partial<Scan> = {},
): PrivateScanRecord => ({
  candidateId,
  state: 'completed',
  attemptedAt: '2026-09-27T01:00:00.000Z',
  risk: {
    address: candidate(candidateId).address,
    checkedAt: '2026-09-27T01:02:03.000Z',
    provider: 'intercepta',
    source: 'live',
    decision: 'hold',
    reasons: ['ARBITRARY_PROVIDER_REASON_MUST_NOT_RENDER'],
    scan: {
      transport: 'received',
      httpStatus: 200,
      requestedNetwork: 'eip155:1',
      coverage: 'unverified',
      semantics: 'unverified',
      toxicScore: 50,
      traitsCount: traitLabels.length,
      traitLabels,
      unknownTraitsCount: 0,
      ...overrides,
    },
  },
});

const pendingRecord = (candidateId: PrivateCandidateId): PrivateScanRecord => ({
  candidateId,
  state: 'pending',
  attemptedAt: '2026-09-27T01:00:00.000Z',
  risk: null,
});

const unavailableRecord = (candidateId: PrivateCandidateId): PrivateScanRecord => ({
  candidateId,
  state: 'unavailable',
  attemptedAt: '2026-09-27T01:00:00.000Z',
  risk: null,
});

const legacyRecord = (candidateId: PrivateCandidateId): PrivateScanRecord => {
  const record = liveRecord(candidateId, ['rug_pull']);
  delete record.risk!.scan!.httpStatus;
  delete record.risk!.scan!.unknownTraitsCount;
  return record;
};

const status = (records: PrivateScanRecord[]): PrivateScanStatus => ({
  contractRevision: PRIVATE_SCAN_REVISION,
  mode: 'private-scan-only',
  paymentEnabled: false,
  ready: true,
  message: 'ARBITRARY_STATUS_MESSAGE_MUST_NOT_RENDER',
  maxRequests: 20,
  usedRequests: records.length,
  records,
});

const renderControl = ({
  currentStatus = status([liveRecord('H1', [])]),
  candidateId = 'H1',
  amountUsdc = '0.005',
  loading = false,
}: {
  currentStatus?: unknown;
  candidateId?: unknown;
  amountUsdc?: string;
  loading?: boolean;
} = {}) => renderToStaticMarkup(createElement(PaymentDecisionReceiptDownload, {
  status: currentStatus,
  candidateId,
  amountUsdc,
  loading,
}));

const decisionButton = (html: string) => html.match(
  /<button\b[^>]*>Download project decision snapshot<\/button>/,
)?.[0] ?? '';

const expectEnabled = (html: string) => {
  const button = decisionButton(html);
  expect(button).not.toBe('');
  expect(button).not.toMatch(/\bdisabled(?:=|\s|>)/);
};

const expectDisabled = (html: string) => {
  const button = decisionButton(html);
  expect(button).not.toBe('');
  expect(button).toMatch(/\bdisabled(?:=|\s|>)/);
};

describe('project decision snapshot audit placement', () => {
  it('keeps the new and original exports together inside the closed audit disclosure', () => {
    const currentStatus = status([liveRecord('H1', [])]);
    const html = renderToStaticMarkup(createElement(PrivateRiskPanel, {
      selectedId: 'H1',
      status: currentStatus,
      loading: false,
      message: '',
      onSelect() {},
      onScan() {},
      onRefresh() {},
    }));
    const summary = '<summary>Technical / audit details</summary>';
    const summaryIndex = html.indexOf(summary);
    const detailsStart = html.lastIndexOf('<details', summaryIndex);
    const detailsEnd = html.indexOf('</details>', summaryIndex);
    const disclosure = html.slice(detailsStart, detailsEnd + '</details>'.length);

    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(disclosure.match(/^<details[^>]*>/)?.[0]).not.toMatch(/\bopen(?:=|\s|>)/);
    expect(disclosure).toContain('下载本次评估摘要');
    expect(disclosure).toContain('Download project decision snapshot');
    expect(disclosure).toContain('Original scan receipt (v2)');
    expect(disclosure).toContain('current project rules and amount');
    expect(disclosure).toContain('Execution NOT CONNECTED');
    expect(html.slice(0, detailsStart)).not.toContain('Download project decision snapshot');
  });
});

describe('project decision snapshot availability follows current input', () => {
  it('disables loading exports even when an older ALLOW record remains', () => {
    expectDisabled(renderControl({ loading: true }));
  });

  it.each([
    ['null status', null, 'H1', '0.005'],
    ['invalid status', { status: 'invalid' }, 'H1', '0.005'],
    ['empty amount', status([liveRecord('H1', [])]), 'H1', ''],
    ['zero amount', status([liveRecord('H1', [])]), 'H1', '0'],
    ['whitespace amount', status([liveRecord('H1', [])]), 'H1', ' 0.001'],
    ['newline amount', status([liveRecord('H1', [])]), 'H1', '0.001\n'],
    ['over-six-decimal amount', status([liveRecord('H1', [])]), 'H1', '0.0000001'],
    ['invalid candidate', status([liveRecord('H1', [])]), '../H1', '0.005'],
    ['missing selected record', status([]), 'H1', '0.005'],
    ['record belongs to another candidate', status([liveRecord('G1', [])]), 'H1', '0.005'],
  ] as const)('disables %s', (_name, currentStatus, candidateId, amountUsdc) => {
    expectDisabled(renderControl({ currentStatus, candidateId, amountUsdc }));
  });

  it.each([
    ['ALLOW', liveRecord('H1', []), '0.005'],
    ['ALLOW_WITH_LIMIT within cap', liveRecord('H1', ['mixer_transfers']), '0.001'],
    ['ALLOW_WITH_LIMIT over cap', liveRecord('H1', ['mixer_transfers']), '0.005'],
    ['DENY', liveRecord('H1', ['sanction_address']), '0.005'],
    ['HOLD', liveRecord('H1', ['rug_pull']), '0.005'],
    ['pending HOLD', pendingRecord('H1'), '0.005'],
    ['unavailable HOLD', unavailableRecord('H1'), '0.005'],
    ['legacy valid HOLD', legacyRecord('H1'), '0.005'],
  ] as const)('enables a valid selected %s snapshot', (_name, record, amountUsdc) => {
    expectEnabled(renderControl({ currentStatus: status([record]), amountUsdc }));
  });
});

describe('project decision snapshot presentation boundary', () => {
  it('renders only bounded fixed copy and no source, address, or execution controls', () => {
    const currentStatus = status([liveRecord('H1', [])]);
    const html = renderControl({ currentStatus });
    const buttonLabels = Array.from(html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g), match => match[1]);

    expect(html).toContain('Download project decision snapshot');
    expect(html).toContain('Original scan receipt (v2)');
    expect(html).toContain('current project rules and amount');
    expect(html).toContain('Execution NOT CONNECTED');
    expect(html).not.toContain('ARBITRARY_STATUS_MESSAGE_MUST_NOT_RENDER');
    expect(html).not.toContain('ARBITRARY_PROVIDER_REASON_MUST_NOT_RENDER');
    expect(html).not.toContain(candidate('H1').address);
    expect(buttonLabels).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/\b(?:Pay|Sign|Connect wallet|Execute|Payment success)\b/i),
    ]));
  });
});
