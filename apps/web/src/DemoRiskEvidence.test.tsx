import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DemoRiskEvidence, RiskScanEvidence } from './DemoRiskEvidence.tsx';

it('renders explicit synthetic, raw-score, label, unverified, and hold caveats as text', () => {
  const html = renderToStaticMarkup(createElement(DemoRiskEvidence, { fixtureId: 'known-risk-a' }));
  for (const text of ['synthetic', '原始 toxicScore：87', 'known_scammer', '不是加权评分', '0 不等于安全', '均未核验', 'hold', '不得据此执行资金动作']) expect(html).toContain(text);
});

it('renders unknown fixture and unavailable scan facts as unconfirmed hold evidence', () => {
  expect(renderToStaticMarkup(createElement(DemoRiskEvidence, { fixtureId: 'missing' }))).toContain('证据未确认，保持 hold');
  const html = renderToStaticMarkup(createElement(DemoRiskEvidence, { fixtureId: 'gray-stale' }));
  expect(html).toContain('原始 toxicScore：未确认');
  expect(html).toContain('风险标签计数：未确认');
});

it('states that a bounded label display is not the full list', () => {
  const html = renderToStaticMarkup(createElement(RiskScanEvidence, { scan: {
    transport: 'received', toxicScore: 4, traitsCount: 25, traitLabels: Array.from({ length: 20 }, () => 'rug_pull'),
    requestedNetwork: 'eip155:84532', coverage: 'unverified', semantics: 'unverified',
  } }));
  expect(html).toContain('仅展示前 20 条允许标签；截断不代表全量');
});
