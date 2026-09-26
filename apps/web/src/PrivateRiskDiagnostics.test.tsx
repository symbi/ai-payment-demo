import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { RiskResult } from '../../../shared/contracts.ts';
import { PRIVATE_SCAN_REVISION, PRIVATE_RISK_CANDIDATES, type PrivateScanStatus } from '../../../shared/private-risk.ts';
import { PrivateRiskPanel } from './PrivateRiskPanel.tsx';

type Scan = NonNullable<RiskResult['scan']>;
function render(scan: Partial<Scan> = {}, source: 'live' | 'unavailable' = 'unavailable', reasons = ['SECRET_PROVIDER_TEXT']) {
  const status: PrivateScanStatus = {
    contractRevision: PRIVATE_SCAN_REVISION, mode: 'private-scan-only', paymentEnabled: false, ready: true,
    message: '', maxRequests: 3, usedRequests: 1,
    records: [{ candidateId: 'H1', state: source === 'live' ? 'completed' : 'unavailable', attemptedAt: '2026-09-27T01:00:00.000Z', risk: {
      address: PRIVATE_RISK_CANDIDATES[0].address, checkedAt: '2026-09-27T01:00:00.000Z', provider: 'intercepta', source, decision: 'hold', reasons,
      scan: { transport: 'unavailable', requestedNetwork: 'eip155:1', coverage: 'unverified', semantics: 'unverified', ...scan },
    } }],
  };
  return renderToStaticMarkup(createElement(PrivateRiskPanel, {
    selectedId: 'H1', status, loading: false, message: '', onSelect() {}, onScan() {}, onRefresh() {},
  }));
}

it('shows schema failure with HTTP 200 without discarding unavailable diagnostics', () => {
  const html = render({ transport: 'received', httpStatus: 200, diagnosticCode: 'schema-unsupported', schemaDiagnostic: {
    topLevelKeys: ['toxicScore', 'traits', 'metadata'], otherKeysCount: 2, toxicScoreType: 'string', traitsType: 'array', traitsCount: 3,
  } });
  expect(html).toContain('核心字段结构尚不受支持');
  expect(html).toContain('>200<');
  expect(html).toContain('toxicScore、traits、metadata');
  expect(html).toContain('响应 traits 数组长度');
  expect(html).toContain('>3<');
  expect(html).toContain('暂缓（HOLD）');
  expect(html).not.toContain('SECRET_PROVIDER_TEXT');
});

it.each([
  ['http-error', '非成功 HTTP 状态'], ['body-invalid', '正文无法'], ['timeout', '请求超时'],
  ['transport-error', '请求传输失败'], ['configuration', '本地扫描配置'],
] as const)('renders safe %s explanation even for unavailable records', (diagnosticCode, expected) => {
  const html = render({ diagnosticCode, ...(diagnosticCode === 'http-error' ? { httpStatus: 429 } : {}) });
  expect(html).toContain(expected);
  expect(html).toContain('暂缓（HOLD）');
  expect(html).not.toContain('SECRET_PROVIDER_TEXT');
  if (diagnosticCode === 'http-error') expect(html).toContain('>429<');
});

it('keeps totals, unknown traits, extra fields and displayed known labels distinct', () => {
  const html = render({ transport: 'received', httpStatus: 200, diagnosticCode: 'observed', toxicScore: 0,
    traitsCount: 4, unknownTraitsCount: 2, additionalFieldsCount: 3, traitLabels: ['rug_pull', 'blacklist'],
  }, 'live');
  expect(html).toContain('返回的风险条目总数</dt><dd>4');
  expect(html).toContain('未知标签条目数量</dt><dd>2');
  expect(html).toContain('忽略的新增字段数量</dt><dd>3');
  expect(html).toContain('rug_pull、blacklist');
  expect(html).toContain('当前展示 2 个已知标签');
  expect(html).toContain('0 不等于安全');
  expect(html).toContain('暂缓（HOLD）');
  expect(html).not.toContain('SECRET_PROVIDER_TEXT');
});

it('maps only exact known legacy reasons and never exposes arbitrary reason text', () => {
  expect(render({}, 'unavailable', ['Unsupported scan response. Review required.'])).toContain('核心字段结构尚不受支持');
  const unknown = render({}, 'unavailable', ['Scan service unavailable. SECRET_PROVIDER_TEXT']);
  expect(unknown).toContain('旧记录未保存详细诊断');
  expect(unknown).not.toContain('SECRET_PROVIDER_TEXT');
  expect(unknown).toContain('HTTP 状态</dt><dd>未记录');
});

it('does not render unvalidated schema names or type text', () => {
  const html = render({ schemaDiagnostic: { topLevelKeys: ['SECRET_KEY_NAME'], otherKeysCount: 0,
    toxicScoreType: 'SECRET_TYPE', traitsType: 'array' } });
  expect(html).not.toContain('SECRET_KEY_NAME');
  expect(html).not.toContain('SECRET_TYPE');
});
