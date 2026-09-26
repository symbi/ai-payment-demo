import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { evaluatePolicyPreview, POLICY_PREVIEW_CASES, type PolicyPreviewResult } from '../../../shared/policy-preview.ts';
import { PolicyPreviewPanel, type PolicyPreviewPanelProps } from './PolicyPreviewPanel.tsx';

function render(overrides: Partial<PolicyPreviewPanelProps['state']> = {}) {
  const state: PolicyPreviewPanelProps['state'] = { caseId: 'case-01', budgetText: '0.002000', phase: 'idle', result: null, message: '', ...overrides };
  return renderToStaticMarkup(createElement(PolicyPreviewPanel, { cases: POLICY_PREVIEW_CASES, state, onCaseChange: () => {}, onBudgetChange: () => {}, onAssess: () => {} }));
}

function result(caseId: string, budget = '2000'): PolicyPreviewResult {
  const value = evaluatePolicyPreview({ caseId, taskBudgetAtomic: budget });
  if (!value) throw new Error(`missing fixture ${caseId}`);
  return value;
}

it('renders all eight frozen cases as four action labels without payment claims', () => {
  const expectedActions = ['规则允许', '拒绝', '暂缓', '拒绝', '规则允许', '暂缓', '附限额允许', '附限额允许'];
  for (const [index, caseId] of POLICY_PREVIEW_CASES.map(item => item.caseId).entries()) {
    const html = render({ caseId, phase: 'ready', result: result(caseId), message: '完成' });
    expect(html).toContain(expectedActions[index]);
    expect(html).toContain('离线合成演示／仅评估，不付款');
    expect(html).toContain('实际付款功能：关闭');
    expect(html).toContain('签名、提交、付款、报告均未执行');
    expect(html).not.toContain('/100');
  }
});

it('shows cap, exact quote, and all budget/cap blocking explanations without changing the quote', () => {
  const html = render({ caseId: 'case-08', phase: 'ready', result: result('case-08', '2000') });
  expect(html).toContain('0.001 USDC');
  expect(html).toContain('0.0005 USDC');
  expect(html).toContain('本次条件未通过');
  expect(html).toContain('原报价超过限额：原价未改，不能继续');
  expect(html).toContain('规则允许不代表已获真实付款授权');
  expect(render({ caseId: 'case-05', phase: 'ready', result: result('case-05', '1') })).toContain('任务预算不足以覆盖原报价');
});

it('renders idle, loading, and error states with a disabled loading button', () => {
  expect(render()).toContain('目前没有真实风险数据');
  expect(render({ phase: 'loading', message: 'ignored' })).toContain('disabled=""');
  expect(render({ phase: 'error', message: '父控制器错误' })).toContain('父控制器错误');
});

it('keeps missing evidence explicit and does not invent risk data', () => {
  const html = render({ caseId: 'case-03', phase: 'ready', result: result('case-03') });
  expect(html).toContain('原始 Toxic Score</dt><dd>未提供');
  expect(html).toContain('证据 ID</dt><dd>未提供');
  expect(html).toContain('真实标签含义未验证');
  expect(html).toContain('规则允许不代表已获真实付款授权');
});

it('shows decimal task allowance as USDC instead of atomic units', () => {
  const html = render({ budgetText: '0.002000' });
  expect(html).toContain('0.002000 USDC');
  expect(html).not.toContain('0.002000 atomic');
  expect(html).toContain('inputMode="decimal"');
  expect(html).toContain('不代表钱包余额');
});
