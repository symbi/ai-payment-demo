import { describe, expect, it } from 'vitest';
import { TEST_NETWORK, TEST_USDC } from './contracts.ts';
import {
  evaluatePolicyPreview, FIXTURE_POLICY_VERSION, isPolicyDecision, isPolicyPreviewInput,
  isPolicyPreviewResult, POLICY_PREVIEW_CASES, POLICY_PREVIEW_CONTRACT_REVISION,
} from './policy-preview.ts';

function preview(caseId = 'case-01', taskBudgetAtomic = '2000') {
  const value = evaluatePolicyPreview({ caseId, taskBudgetAtomic });
  if (!value) throw new Error('expected fixture preview');
  return value;
}

function changed(value: unknown, mutate: (copy: any) => void): unknown {
  const copy = structuredClone(value);
  mutate(copy);
  return copy;
}

describe('policy-preview-v1 pure synthetic contract', () => {
  it('publishes the eight fixture-defined scenarios without provider verification claims', () => {
    expect(POLICY_PREVIEW_CASES.map(item => item.scenario)).toEqual([
      'allowed', 'explicit-denial', 'insufficient-evidence', 'content-changed',
      'budget-insufficient', 'duplicate-pending', 'limit-within', 'limit-exceeded',
    ]);
    expect(POLICY_PREVIEW_CASES.every(item => item.source === 'fixture-defined'
      && item.verificationStatus === 'fixture-defined-not-provider-verified')).toBe(true);
  });

  it.each([
    ['case-01', '2000', 'allow', 'eligible', ['SYNTHETIC_RULES_PASSED']],
    ['case-02', '2000', 'deny', 'blocked', ['POLICY_DENY']],
    ['case-03', '2000', 'hold', 'blocked', ['POLICY_HOLD']],
    ['case-04', '2000', 'deny', 'blocked', ['POLICY_DENY']],
    ['case-05', '1000', 'allow', 'blocked', ['PER_TRANSACTION_LIMIT_EXCEEDED', 'TASK_BUDGET_INSUFFICIENT']],
    ['case-06', '2000', 'hold', 'blocked', ['POLICY_HOLD']],
    ['case-07', '2000', 'allow_with_limit', 'eligible', ['SYNTHETIC_RULES_PASSED']],
    ['case-08', '2000', 'allow_with_limit', 'blocked', ['QUOTE_EXCEEDS_CAP']],
  ] as const)('evaluates %s independently', (caseId, budget, action, status, reasons) => {
    const result = preview(caseId, budget);
    expect(result).toMatchObject({ contractRevision: POLICY_PREVIEW_CONTRACT_REVISION, policyVersion: FIXTURE_POLICY_VERSION,
      simulation: true, paymentEnabled: false, policy: { action }, previewEligibility: { status, reasonCodes: reasons },
      finalGate: { executable: false, reasonCodes: ['SIMULATION_ONLY'], checkedQuoteHash: null, signingInputHash: null },
      execution: { signing: 'not_signed', submission: 'not_submitted', payment: 'not_executed', report: 'not_delivered' } });
    expect(isPolicyPreviewResult(result)).toBe(true);
  });

  it('keeps an over-cap exact quote unchanged and does not split it', () => {
    const result = preview('case-08');
    expect(result.quote).toEqual({ scheme: 'exact', network: TEST_NETWORK, asset: TEST_USDC, amount: '1000', payTo: 'fixture-recipient-not-a-wallet' });
    expect(result.policy).toMatchObject({ action: 'allow_with_limit', capAtomic: '500' });
    expect(result.previewEligibility).toMatchObject({ status: 'blocked', reasonCodes: ['QUOTE_EXCEEDS_CAP'] });
  });

  it('uses a null evidence id for missing evidence and never treats a raw toxic score as /100', () => {
    const missing = preview('case-03');
    expect(missing.evidence).toMatchObject({ evidenceId: null, toxicScore: null, toxicScoreScale: null, labels: [],
      unknownItems: expect.arrayContaining(['provider-semantics', 'provider-score-scale']) });
    expect(missing.policy).toMatchObject({ action: 'hold', evidenceId: null });
    expect(preview('case-02').evidence).toMatchObject({ toxicScore: 91, toxicScoreScale: null });
  });

  it('keeps an exact quote above the single-payment ceiling blocked even with ample task budget', () => {
    const result = preview('case-05', '5000');
    expect(result.quote.amount).toBe('2000');
    expect(result.previewEligibility).toEqual({ status: 'blocked', reasonCodes: ['PER_TRANSACTION_LIMIT_EXCEEDED'], meaning: 'synthetic-rules-only' });
    expect(isPolicyPreviewResult(result)).toBe(true);
    expect(isPolicyPreviewResult(changed(result, value => {
      value.previewEligibility = { status: 'eligible', reasonCodes: ['SYNTHETIC_RULES_PASSED'], meaning: 'synthetic-rules-only' };
    }))).toBe(false);
  });

  it.each([
    null, {}, { caseId: 'case-01' }, { caseId: 'case-01', taskBudgetAtomic: '0' },
    { caseId: 'case-01', taskBudgetAtomic: '-1' }, { caseId: 'case-01', taskBudgetAtomic: '1.0' },
    { caseId: 'case-01', taskBudgetAtomic: '1e3' }, { caseId: 'case-01', taskBudgetAtomic: '01' },
    { caseId: 'case-01', taskBudgetAtomic: '1', capAtomic: '999' },
    { caseId: 'case-01', taskBudgetAtomic: '1', evidence: {} },
    { caseId: 'case-01', taskBudgetAtomic: '1', action: 'allow' },
    { caseId: 'case-01', taskBudgetAtomic: '1', paymentEnabled: true },
    { caseId: 'case-01', taskBudgetAtomic: '1', address: '0xcaller' },
  ])('rejects untrusted request input %#', input => {
    expect(isPolicyPreviewInput(input)).toBe(false);
    expect(evaluatePolicyPreview(input as never)).toBe(null);
  });

  it('rejects an unknown or overlong case and re-evaluates changed budgets without cached state', () => {
    expect(evaluatePolicyPreview({ caseId: 'case-99', taskBudgetAtomic: '2000' })).toBe(null);
    expect(isPolicyPreviewInput({ caseId: 'x'.repeat(65), taskBudgetAtomic: '1' })).toBe(false);
    expect(isPolicyPreviewInput({ caseId: 'case-01', taskBudgetAtomic: '1'.repeat(79) })).toBe(false);
    expect(preview('case-01', '2000').previewEligibility.status).toBe('eligible');
    expect(preview('case-01', '500').previewEligibility).toMatchObject({ status: 'blocked', reasonCodes: ['TASK_BUDGET_INSUFFICIENT'] });
    expect(preview('case-01', '2000').previewEligibility.status).toBe('eligible');
  });

  it('validates the discriminated action union and positive cap strictly', () => {
    expect(isPolicyDecision(preview('case-07').policy)).toBe(true);
    expect(isPolicyDecision(changed(preview('case-07').policy, value => { value.capAtomic = '0'; }))).toBe(false);
    expect(isPolicyDecision(changed(preview('case-07').policy, value => { delete value.capAtomic; }))).toBe(false);
    expect(isPolicyDecision(changed(preview('case-01').policy, value => { value.capAtomic = '1000'; }))).toBe(false);
    expect(isPolicyDecision(changed(preview('case-01').policy, value => { value.evidenceId = ''; }))).toBe(false);
  });

  it.each([
    (value: any) => { value.simulation = false; },
    (value: any) => { value.paymentEnabled = true; },
    (value: any) => { value.quote.network = 'eip155:1'; },
    (value: any) => { value.quote.asset = 'caller-asset'; },
    (value: any) => { value.quote.amount = '0'; },
    (value: any) => { value.quote.amount = '400'; },
    (value: any) => { value.policy.network = 'eip155:1'; },
    (value: any) => { value.policy.capAtomic = '0'; },
    (value: any) => { value.policy.reasonCodes = ['INVENTED']; },
    (value: any) => { value.policy.decidedAt = 'not-a-time'; },
    (value: any) => { value.evidence.evidenceId = ''; },
    (value: any) => { value.evidence.toxicScore = 0; },
    (value: any) => { value.evidence.unknownItems = []; },
    (value: any) => { value.evidence.labels = ['provider-verified']; },
    (value: any) => { value.finalGate.executable = true; },
    (value: any) => { value.finalGate.signingInputHash = 'invented'; },
    (value: any) => { value.execution.payment = 'executed'; },
    (value: any) => { value.previewEligibility.reasonCodes = ['SYNTHETIC_RULES_PASSED']; },
    (value: any) => { value.case.scenario = 'allowed'; },
    (value: any) => { value.extra = true; },
  ])('rejects malformed or boundary-crossing response %#', mutate => {
    expect(isPolicyPreviewResult(changed(preview('case-08'), mutate))).toBe(false);
  });
});
