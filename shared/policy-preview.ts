import { PRICE_ATOMIC, TEST_NETWORK, TEST_USDC, type PaymentTerms } from './contracts.ts';

export const POLICY_PREVIEW_CONTRACT_REVISION = 'policy-preview-v1' as const;
export const FIXTURE_POLICY_VERSION = 'fixture-policy-v1' as const;
export const FIXTURE_VERIFICATION_STATUS = 'fixture-defined-not-provider-verified' as const;

export type PolicyAction = 'allow' | 'allow_with_limit' | 'hold' | 'deny';

interface PolicyDecisionBase {
  reasonCodes: string[];
  policyVersion: typeof FIXTURE_POLICY_VERSION;
  asset: typeof TEST_USDC;
  network: typeof TEST_NETWORK;
  decidedAt: string;
}

export type PolicyDecision = PolicyDecisionBase & (
  | { action: 'allow'; evidenceId: string; capAtomic?: never }
  | { action: 'allow_with_limit'; evidenceId: string; capAtomic: string }
  | { action: 'hold'; evidenceId: string | null; capAtomic?: never }
  | { action: 'deny'; evidenceId: string | null; capAtomic?: never }
);

export interface PolicyPreviewInput {
  caseId: string;
  /** Per-task allowance for this evaluation, not a wallet balance. */
  taskBudgetAtomic: string;
}

const LABELS = ['fixture-low-signal', 'fixture-explicit-refusal', 'fixture-content-changed', 'fixture-review-pending'] as const;
const UNKNOWNS = ['provider-semantics', 'provider-coverage', 'provider-score-scale', 'live-state', 'real-final-gate'] as const;
type FixtureLabel = typeof LABELS[number];
type FixtureUnknown = typeof UNKNOWNS[number];

interface FixtureEvidence {
  evidenceId: string | null;
  toxicScore: number | null;
  labels: FixtureLabel[];
  unknownItems: FixtureUnknown[];
}

interface PolicyPreviewFixture {
  id: string;
  title: string;
  scenario: 'allowed' | 'explicit-denial' | 'insufficient-evidence' | 'content-changed' | 'budget-insufficient' | 'duplicate-pending' | 'limit-within' | 'limit-exceeded';
  quoteAmountAtomic: string;
  exampleTaskBudgetAtomic: string;
  action: PolicyAction;
  reasonCodes: string[];
  capAtomic?: string;
  evidence: FixtureEvidence;
}

const FIXTURE_TIME = '2026-09-27T00:00:00.000Z';

const FIXTURES: readonly PolicyPreviewFixture[] = [
  { id: 'case-01', title: '合成允许', scenario: 'allowed', quoteAmountAtomic: PRICE_ATOMIC, exampleTaskBudgetAtomic: '2000', action: 'allow',
    reasonCodes: ['FIXTURE_POLICY_ALLOW'], evidence: { evidenceId: 'fixture-evidence-01', toxicScore: 7, labels: ['fixture-low-signal'], unknownItems: ['provider-score-scale', 'real-final-gate'] } },
  { id: 'case-02', title: '合成明确拒绝', scenario: 'explicit-denial', quoteAmountAtomic: PRICE_ATOMIC, exampleTaskBudgetAtomic: '2000', action: 'deny',
    reasonCodes: ['FIXTURE_EXPLICIT_REFUSAL'], evidence: { evidenceId: 'fixture-evidence-02', toxicScore: 91, labels: ['fixture-explicit-refusal'], unknownItems: ['provider-score-scale', 'real-final-gate'] } },
  { id: 'case-03', title: '合成证据不足', scenario: 'insufficient-evidence', quoteAmountAtomic: PRICE_ATOMIC, exampleTaskBudgetAtomic: '2000', action: 'hold',
    reasonCodes: ['FIXTURE_EVIDENCE_INCOMPLETE'], evidence: { evidenceId: null, toxicScore: null, labels: [], unknownItems: ['provider-semantics', 'provider-coverage', 'provider-score-scale', 'real-final-gate'] } },
  { id: 'case-04', title: '合成内容改变', scenario: 'content-changed', quoteAmountAtomic: PRICE_ATOMIC, exampleTaskBudgetAtomic: '2000', action: 'deny',
    reasonCodes: ['FIXTURE_CONTENT_CHANGED'], evidence: { evidenceId: 'fixture-evidence-04', toxicScore: 12, labels: ['fixture-content-changed'], unknownItems: ['provider-score-scale', 'real-final-gate'] } },
  { id: 'case-05', title: '合成预算不足', scenario: 'budget-insufficient', quoteAmountAtomic: '2000', exampleTaskBudgetAtomic: '1000', action: 'allow',
    reasonCodes: ['FIXTURE_POLICY_ALLOW'], evidence: { evidenceId: 'fixture-evidence-05', toxicScore: 5, labels: ['fixture-low-signal'], unknownItems: ['provider-score-scale', 'real-final-gate'] } },
  { id: 'case-06', title: '合成重复或未决', scenario: 'duplicate-pending', quoteAmountAtomic: PRICE_ATOMIC, exampleTaskBudgetAtomic: '2000', action: 'hold',
    reasonCodes: ['FIXTURE_DUPLICATE_OR_PENDING'], evidence: { evidenceId: 'fixture-evidence-06', toxicScore: null, labels: ['fixture-review-pending'], unknownItems: ['live-state', 'provider-score-scale', 'real-final-gate'] } },
  { id: 'case-07', title: '合成限额内', scenario: 'limit-within', quoteAmountAtomic: PRICE_ATOMIC, exampleTaskBudgetAtomic: '2000', action: 'allow_with_limit', capAtomic: '1500',
    reasonCodes: ['FIXTURE_POLICY_LIMIT'], evidence: { evidenceId: 'fixture-evidence-07', toxicScore: 16, labels: ['fixture-low-signal'], unknownItems: ['provider-score-scale', 'real-final-gate'] } },
  { id: 'case-08', title: '合成报价超过限额', scenario: 'limit-exceeded', quoteAmountAtomic: PRICE_ATOMIC, exampleTaskBudgetAtomic: '2000', action: 'allow_with_limit', capAtomic: '500',
    reasonCodes: ['FIXTURE_POLICY_LIMIT'], evidence: { evidenceId: 'fixture-evidence-08', toxicScore: 16, labels: ['fixture-low-signal'], unknownItems: ['provider-score-scale', 'real-final-gate'] } },
] as const;

export interface PolicyPreviewCaseSummary {
  caseId: string;
  title: string;
  scenario: PolicyPreviewFixture['scenario'];
  source: 'fixture-defined';
  verificationStatus: typeof FIXTURE_VERIFICATION_STATUS;
  quote: PaymentTerms;
  exampleTaskBudgetAtomic: string;
}

export interface PolicyPreviewResult {
  contractRevision: typeof POLICY_PREVIEW_CONTRACT_REVISION;
  policyVersion: typeof FIXTURE_POLICY_VERSION;
  simulation: true;
  paymentEnabled: false;
  case: { caseId: string; title: string; scenario: PolicyPreviewFixture['scenario']; source: 'fixture-defined'; verificationStatus: typeof FIXTURE_VERIFICATION_STATUS };
  quote: PaymentTerms;
  taskBudgetAtomic: string;
  evidence: FixtureEvidence & { source: 'fixture-defined'; verificationStatus: typeof FIXTURE_VERIFICATION_STATUS; toxicScoreScale: null };
  policy: PolicyDecision;
  previewEligibility: { status: 'eligible' | 'blocked'; reasonCodes: string[]; meaning: 'synthetic-rules-only' };
  finalGate: { executable: false; reasonCodes: ['SIMULATION_ONLY']; operationId: null; checkedQuoteHash: null; signingInputHash: null };
  execution: { signing: 'not_signed'; submission: 'not_submitted'; payment: 'not_executed'; report: 'not_delivered' };
  limitations: string[];
}

function exactQuote(amount: string): PaymentTerms {
  return { scheme: 'exact', network: TEST_NETWORK, asset: TEST_USDC, amount, payTo: 'fixture-recipient-not-a-wallet' };
}

export const POLICY_PREVIEW_CASES: readonly PolicyPreviewCaseSummary[] = FIXTURES.map(fixture => ({
  caseId: fixture.id, title: fixture.title, scenario: fixture.scenario, source: 'fixture-defined',
  verificationStatus: FIXTURE_VERIFICATION_STATUS, quote: exactQuote(fixture.quoteAmountAtomic),
  exampleTaskBudgetAtomic: fixture.exampleTaskBudgetAtomic,
}));

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && [...keys].sort().every((key, index) => key === actual[index]);
}

function isPositiveAtomic(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,77}$/.test(value);
}

function isNonemptyString(value: unknown, max = 160): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isIsoTimestamp(value: unknown): value is string {
  return isNonemptyString(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isStringList(value: unknown, allowed?: readonly string[]): value is string[] {
  return Array.isArray(value) && value.length <= 20 && value.every(item => isNonemptyString(item, 120) && (!allowed || allowed.includes(item)));
}

export function isPolicyPreviewInput(value: unknown): value is PolicyPreviewInput {
  return isRecord(value) && hasExactKeys(value, ['caseId', 'taskBudgetAtomic'])
    && isNonemptyString(value.caseId, 64) && isPositiveAtomic(value.taskBudgetAtomic);
}

export function isPolicyDecision(value: unknown): value is PolicyDecision {
  if (!isRecord(value) || !['allow', 'allow_with_limit', 'hold', 'deny'].includes(String(value.action))) return false;
  const baseKeys = ['action', 'evidenceId', 'reasonCodes', 'policyVersion', 'asset', 'network', 'decidedAt'];
  const keys = value.action === 'allow_with_limit' ? [...baseKeys, 'capAtomic'] : baseKeys;
  if (!hasExactKeys(value, keys) || value.policyVersion !== FIXTURE_POLICY_VERSION || value.asset !== TEST_USDC || value.network !== TEST_NETWORK
    || !isIsoTimestamp(value.decidedAt) || !isStringList(value.reasonCodes) || value.reasonCodes.length === 0) return false;
  if (value.action === 'allow' || value.action === 'allow_with_limit') {
    if (!isNonemptyString(value.evidenceId)) return false;
  } else if (value.evidenceId !== null && !isNonemptyString(value.evidenceId)) return false;
  return value.action === 'allow_with_limit' ? isPositiveAtomic(value.capAtomic) : !('capAtomic' in value);
}

function policyFor(fixture: PolicyPreviewFixture): PolicyDecision {
  const base = { reasonCodes: [...fixture.reasonCodes], policyVersion: FIXTURE_POLICY_VERSION, asset: TEST_USDC, network: TEST_NETWORK, decidedAt: FIXTURE_TIME };
  if (fixture.action === 'allow_with_limit') return { ...base, action: fixture.action, evidenceId: fixture.evidence.evidenceId!, capAtomic: fixture.capAtomic! };
  if (fixture.action === 'allow') return { ...base, action: fixture.action, evidenceId: fixture.evidence.evidenceId! };
  return { ...base, action: fixture.action, evidenceId: fixture.evidence.evidenceId };
}

function eligibilityReasons(policy: PolicyDecision, quoteAmountAtomic: string, taskBudgetAtomic: string): string[] {
  const reasons: string[] = [];
  if (policy.action === 'hold') reasons.push('POLICY_HOLD');
  if (policy.action === 'deny') reasons.push('POLICY_DENY');
  if (BigInt(quoteAmountAtomic) > BigInt(PRICE_ATOMIC)) reasons.push('PER_TRANSACTION_LIMIT_EXCEEDED');
  if (policy.action === 'allow_with_limit' && BigInt(quoteAmountAtomic) > BigInt(policy.capAtomic)) reasons.push('QUOTE_EXCEEDS_CAP');
  if (BigInt(quoteAmountAtomic) > BigInt(taskBudgetAtomic)) reasons.push('TASK_BUDGET_INSUFFICIENT');
  return reasons.length ? reasons : ['SYNTHETIC_RULES_PASSED'];
}

function sameList(actual: readonly unknown[], expected: readonly unknown[]): boolean {
  return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
}

export function evaluatePolicyPreview(input: PolicyPreviewInput): PolicyPreviewResult | null {
  if (!isPolicyPreviewInput(input)) return null;
  const fixture = FIXTURES.find(candidate => candidate.id === input.caseId);
  if (!fixture) return null;
  const policy = policyFor(fixture);
  const quote = exactQuote(fixture.quoteAmountAtomic);
  const eligibility = eligibilityReasons(policy, quote.amount, input.taskBudgetAtomic);
  return {
    contractRevision: POLICY_PREVIEW_CONTRACT_REVISION, policyVersion: FIXTURE_POLICY_VERSION, simulation: true, paymentEnabled: false,
    case: { caseId: fixture.id, title: fixture.title, scenario: fixture.scenario, source: 'fixture-defined', verificationStatus: FIXTURE_VERIFICATION_STATUS },
    quote, taskBudgetAtomic: input.taskBudgetAtomic,
    evidence: { ...fixture.evidence, labels: [...fixture.evidence.labels], unknownItems: [...fixture.evidence.unknownItems], source: 'fixture-defined', verificationStatus: FIXTURE_VERIFICATION_STATUS, toxicScoreScale: null },
    policy,
    previewEligibility: { status: eligibility[0] === 'SYNTHETIC_RULES_PASSED' ? 'eligible' : 'blocked', reasonCodes: eligibility, meaning: 'synthetic-rules-only' },
    finalGate: { executable: false, reasonCodes: ['SIMULATION_ONLY'], operationId: null, checkedQuoteHash: null, signingInputHash: null },
    execution: { signing: 'not_signed', submission: 'not_submitted', payment: 'not_executed', report: 'not_delivered' },
    limitations: ['SIMULATION_ONLY', 'No live scanner, signing, submission, payment, report delivery, or state write occurred.', 'Stateless preview is not a payment idempotency guarantee.'],
  };
}

export function isPolicyPreviewResult(value: unknown): value is PolicyPreviewResult {
  if (!isRecord(value) || !hasExactKeys(value, ['contractRevision', 'policyVersion', 'simulation', 'paymentEnabled', 'case', 'quote', 'taskBudgetAtomic', 'evidence', 'policy', 'previewEligibility', 'finalGate', 'execution', 'limitations'])) return false;
  if (value.contractRevision !== POLICY_PREVIEW_CONTRACT_REVISION || value.policyVersion !== FIXTURE_POLICY_VERSION || value.simulation !== true || value.paymentEnabled !== false || !isPositiveAtomic(value.taskBudgetAtomic)) return false;
  const previewCase = value.case;
  if (!isRecord(previewCase) || !hasExactKeys(previewCase, ['caseId', 'title', 'scenario', 'source', 'verificationStatus']) || !isNonemptyString(previewCase.caseId, 64) || !isNonemptyString(previewCase.title)
    || !FIXTURES.some(f => f.scenario === previewCase.scenario) || previewCase.source !== 'fixture-defined' || previewCase.verificationStatus !== FIXTURE_VERIFICATION_STATUS) return false;
  const expectedFixture = FIXTURES.find(fixture => fixture.id === previewCase.caseId);
  if (!expectedFixture || previewCase.title !== expectedFixture.title || previewCase.scenario !== expectedFixture.scenario) return false;
  if (!isRecord(value.quote) || !hasExactKeys(value.quote, ['scheme', 'network', 'asset', 'amount', 'payTo']) || value.quote.scheme !== 'exact' || value.quote.network !== TEST_NETWORK || value.quote.asset !== TEST_USDC || !isPositiveAtomic(value.quote.amount) || value.quote.payTo !== 'fixture-recipient-not-a-wallet') return false;
  if (!isRecord(value.evidence) || !hasExactKeys(value.evidence, ['evidenceId', 'toxicScore', 'labels', 'unknownItems', 'source', 'verificationStatus', 'toxicScoreScale'])
    || (value.evidence.evidenceId !== null && !isNonemptyString(value.evidence.evidenceId)) || (value.evidence.toxicScore !== null && (typeof value.evidence.toxicScore !== 'number' || !Number.isFinite(value.evidence.toxicScore)))
    || !isStringList(value.evidence.labels, LABELS) || !isStringList(value.evidence.unknownItems, UNKNOWNS) || value.evidence.unknownItems.length === 0
    || value.evidence.source !== 'fixture-defined' || value.evidence.verificationStatus !== FIXTURE_VERIFICATION_STATUS || value.evidence.toxicScoreScale !== null) return false;
  if (!isPolicyDecision(value.policy) || value.policy.asset !== value.quote.asset || value.policy.network !== value.quote.network || value.policy.evidenceId !== value.evidence.evidenceId) return false;
  if (value.quote.amount !== expectedFixture.quoteAmountAtomic || value.policy.action !== expectedFixture.action
    || value.policy.decidedAt !== FIXTURE_TIME || !sameList(value.policy.reasonCodes, expectedFixture.reasonCodes)
    || (value.policy.action === 'allow_with_limit' && value.policy.capAtomic !== expectedFixture.capAtomic)) return false;
  if (value.evidence.toxicScore !== expectedFixture.evidence.toxicScore || !sameList(value.evidence.labels, expectedFixture.evidence.labels)
    || !sameList(value.evidence.unknownItems, expectedFixture.evidence.unknownItems)) return false;
  if (!isRecord(value.previewEligibility) || !hasExactKeys(value.previewEligibility, ['status', 'reasonCodes', 'meaning']) || !['eligible', 'blocked'].includes(String(value.previewEligibility.status))
    || !isStringList(value.previewEligibility.reasonCodes) || value.previewEligibility.reasonCodes.length === 0 || value.previewEligibility.meaning !== 'synthetic-rules-only') return false;
  const expectedReasons = eligibilityReasons(value.policy, value.quote.amount, value.taskBudgetAtomic);
  if (!sameList(value.previewEligibility.reasonCodes, expectedReasons)
    || value.previewEligibility.status !== (expectedReasons[0] === 'SYNTHETIC_RULES_PASSED' ? 'eligible' : 'blocked')) return false;
  if (!isRecord(value.finalGate) || !hasExactKeys(value.finalGate, ['executable', 'reasonCodes', 'operationId', 'checkedQuoteHash', 'signingInputHash']) || value.finalGate.executable !== false
    || !Array.isArray(value.finalGate.reasonCodes) || value.finalGate.reasonCodes.length !== 1 || value.finalGate.reasonCodes[0] !== 'SIMULATION_ONLY'
    || value.finalGate.operationId !== null || value.finalGate.checkedQuoteHash !== null || value.finalGate.signingInputHash !== null) return false;
  if (!isRecord(value.execution) || !hasExactKeys(value.execution, ['signing', 'submission', 'payment', 'report']) || value.execution.signing !== 'not_signed' || value.execution.submission !== 'not_submitted' || value.execution.payment !== 'not_executed' || value.execution.report !== 'not_delivered') return false;
  return isStringList(value.limitations) && value.limitations.includes('SIMULATION_ONLY');
}
