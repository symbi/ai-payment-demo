import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { PRIVATE_SCAN_REVISION, PRIVATE_RISK_CANDIDATES, type PrivateScanStatus } from '../../../shared/private-risk.ts';
import { PrivateRiskPanel } from './PrivateRiskPanel.tsx';

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

it('renders an empty private panel without synthetic results', () => {
  const html = renderToStaticMarkup(createElement(PrivateRiskPanel, props(null)));
  expect(html).toContain('评估收款方地址'); expect(html).toContain('尚未取得扫描记录'); expect(html).toContain('不填充 0'); expect(html).toContain('disabled');
});

it('disables scanning when status is not ready, exhausted, or pending', () => {
  const notReady = renderToStaticMarkup(createElement(PrivateRiskPanel, props(baseStatus({ ready: false, message: '需私人电脑启动' }))));
  const exhausted = renderToStaticMarkup(createElement(PrivateRiskPanel, props(baseStatus({ usedRequests: 3 }))));
  const pending = renderToStaticMarkup(createElement(PrivateRiskPanel, props(baseStatus({ usedRequests: 1, records: [{ candidateId: 'G1', state: 'pending', attemptedAt: '2026-09-27T01:00:00.000Z', risk: null }] }))));
  for (const html of [notReady, exhausted, pending]) expect(html).toContain('扫描这个真实地址（消耗1次）');
  expect(notReady).toContain('需私人电脑启动'); expect(exhausted).toContain('3/3'); expect(pending).toContain('已有扫描处于 pending');
});

it('shows a live zero raw score without turning it into a safety grade', () => {
  const html = renderToStaticMarkup(createElement(PrivateRiskPanel, props(baseStatus({ usedRequests: 1, records: [completed('H1', 0)] }))));
  expect(html).toContain('Intercepta 原始 toxicScore'); expect(html).toContain('>0<'); expect(html).toContain('0 不等于安全'); expect(html).toContain('真实API返回（本机保存的上次结果）'); expect(html).toContain('暂缓（HOLD）：依据不足');
  expect(html).not.toContain('/100'); expect(html).not.toContain('原始返回原因'); expect(html).toContain('查看本地检查说明');
});

it('renders unavailable records as failed evidence and keeps selected records separate', () => {
  const unavailable = { candidateId: 'H1' as const, state: 'unavailable' as const, attemptedAt: '2026-09-27T01:00:00.000Z', risk: null };
  const failedHtml = renderToStaticMarkup(createElement(PrivateRiskPanel, props(baseStatus({ usedRequests: 1, records: [unavailable] }))));
  const otherHtml = renderToStaticMarkup(createElement(PrivateRiskPanel, props(baseStatus({ usedRequests: 2, records: [unavailable, completed('G1', 7)] }), 'G1')));
  expect(failedHtml).toContain('未取得有效证据'); expect(failedHtml).not.toContain('暂缓（HOLD）：依据不足');
  expect(otherHtml).toContain('>7<'); expect(otherHtml).toContain('本地检查产生的说明'); expect(otherHtml).not.toContain('>0<');
});

it('renders pending as unconfirmed and does not claim that it was never requested', () => {
  const html = renderToStaticMarkup(createElement(PrivateRiskPanel, props(baseStatus({ usedRequests: 1, records: [{ candidateId: 'H1', state: 'pending', attemptedAt: '2026-09-27T01:00:00.000Z', risk: null }] }))));
  expect(html).toContain('尚未确认'); expect(html).toContain('不宣称未请求');
});
