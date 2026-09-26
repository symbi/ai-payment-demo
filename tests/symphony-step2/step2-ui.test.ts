import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assessDemoPayment, DEFAULT_WEIGHTS } from '../../shared/demo-assessment.ts';
import { staleInputMessage, isAssessmentResponse } from '../../apps/web/src/PayAssessmentDemo.tsx';

describe('Step 2 page contract', () => {
  it('clears the meaning of an old decision after any changed input', () => {
    expect(staleInputMessage(true)).toContain('旧决定已清除');
    expect(staleInputMessage(false)).toContain('请重新评估');
  });

  it('builds a single-file Chinese page with no external resources and same-origin-only connect CSP', () => {
    const html = readFileSync('docs/offline-pay.html', 'utf8');
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain("connect-src 'self'");
    expect(html).not.toMatch(/<(?:link|img)\b/i);
    expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=/i);
    expect(html).toContain('模拟钱包');
    expect(html).toContain('付款前');
  });

  it('keeps the formal app entry and payment modules out of the demo bundle', () => {
    const html = readFileSync('docs/offline-pay.html', 'utf8');
    expect(html).not.toContain('/api/pay');
    expect(html).not.toContain('BuyerService');
    expect(html).not.toContain('LivePaymentCheck');
    expect(html).not.toContain('allowance');
  });
});

it('rejects partial or payment-enabled server responses without rendering them as an assessment', () => {
  expect(isAssessmentResponse({simulation:true,paymentEnabled:false,decision:'invalid',error:'bad weights'})).toBe(false);
  expect(isAssessmentResponse({simulation:true,paymentEnabled:true,decision:'allow'})).toBe(false);
  expect(isAssessmentResponse(null)).toBe(false);
});

it('requires all five contributions in canonical order', () => {
  const valid = assessDemoPayment({fixtureId:'controlled-a',amount:'0.001000',taskLimit:'0.005000',weights:[...DEFAULT_WEIGHTS],contentChanged:false});
  expect(isAssessmentResponse(valid)).toBe(true);
  expect(isAssessmentResponse({...valid, contributions:valid.contributions.slice(0,4)})).toBe(false);
  expect(isAssessmentResponse({...valid, contributions:[...valid.contributions].reverse()})).toBe(false);
  expect(isAssessmentResponse({...valid, contributions:valid.contributions.map(item=>({...item,label:'收款方风险'}))})).toBe(false);
});
