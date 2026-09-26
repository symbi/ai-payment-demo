export const DEMO_POLICY = 'weighted-demo-v1' as const;
export const DEFAULT_WEIGHTS = [40, 25, 15, 10, 10] as const;
export const WALLET_BALANCE_ATOMIC = 10_000n;

export const ASSESSMENT_LABELS = [
  '收款方风险', '付款授权内容', '商家与资源关联', '交易历史', '额度压力',
] as const;

export type DemoCategory = 'known-risk' | 'controlled' | 'gray';
export type DemoDecision = 'allow' | 'hold' | 'deny' | 'invalid';
export type RiskLevel = 0 | 0.5 | 1 | null;
export type DemoWeights = [number, number, number, number, number];

export interface DemoFixture {
  id: string;
  name: string;
  address: string;
  category: DemoCategory;
  categoryLabel: string;
  evidenceSource: string;
  evidenceUpdatedAt: string | null;
  evidenceSummary: string;
  coverage: string;
  levels: [RiskLevel, RiskLevel, RiskLevel, RiskLevel];
  notes: [string, string, string, string];
  hardDeny: boolean;
}

export const DEMO_FIXTURES: readonly DemoFixture[] = [
  {
    id: 'known-risk-a', name: '已知风险样例 A', address: '0xD0000000000000000000000000000000000000A1',
    category: 'known-risk', categoryLabel: '已知风险（模拟）', evidenceSource: '预置合成禁付标记', evidenceUpdatedAt: '2026-09-20T00:00:00Z',
    evidenceSummary: '合成证据明确标记为禁付。这不是对任何真实地址的认定。', coverage: '收款方标记、资源关联和模拟历史齐全。',
    levels: [1, 0, 0.5, 0], notes: ['合成禁付标记', '模拟付款内容一致', '关联信息需关注', '合成历史已覆盖'], hardDeny: true,
  },
  {
    id: 'known-risk-b', name: '已知风险样例 B', address: '0xD0000000000000000000000000000000000000B2',
    category: 'known-risk', categoryLabel: '已知风险（模拟）', evidenceSource: '预置合成拒绝清单', evidenceUpdatedAt: '2026-09-21T00:00:00Z',
    evidenceSummary: '合成拒绝清单命中，仅用于展示硬拒绝。', coverage: '标记与内置商品证据已覆盖。',
    levels: [1, 0, 1, 0.5], notes: ['合成拒绝清单命中', '模拟付款内容一致', '合成资源关联异常', '合成历史需关注'], hardDeny: true,
  },
  {
    id: 'controlled-a', name: '受控低风险样例 A', address: '0xC0000000000000000000000000000000000000A1',
    category: 'controlled', categoryLabel: '受控测试样例', evidenceSource: '预置合成完整证据', evidenceUpdatedAt: '2026-09-22T00:00:00Z',
    evidenceSummary: '低风险测试路径：证据完整且未设置硬拒绝。', coverage: '五项评估所需的模拟证据均有覆盖。',
    levels: [0, 0, 0, 0], notes: ['合成检查未命中风险', '模拟付款内容一致', '模拟商品与报价匹配', '内置合成历史完整'], hardDeny: false,
  },
  {
    id: 'controlled-b', name: '受控低风险样例 B', address: '0xC0000000000000000000000000000000000000B2',
    category: 'controlled', categoryLabel: '受控测试样例', evidenceSource: '预置合成完整证据', evidenceUpdatedAt: '2026-09-23T00:00:00Z',
    evidenceSummary: '另一个完整的低风险测试样例，用于对比地址分组。', coverage: '收款方、内容、资源关联和历史均为预置合成证据。',
    levels: [0, 0, 0, 0], notes: ['合成检查未命中风险', '模拟付款内容一致', '模拟商品与报价匹配', '内置合成历史完整'], hardDeny: false,
  },
  {
    id: 'gray-complete', name: '灰色提示·证据完整', address: '0xA0000000000000000000000000000000000000A1',
    category: 'gray', categoryLabel: '灰色／证据不明', evidenceSource: '预置合成风险提示', evidenceUpdatedAt: '2026-09-24T00:00:00Z',
    evidenceSummary: '有一般风险提示，但证据项完整；按权重进入暂缓。', coverage: '证据完整，但风险不为零，需人工复核。',
    levels: [0.5, 0, 0, 0.5], notes: ['合成一般风险提示', '模拟付款内容一致', '模拟商品与报价匹配', '合成历史需复核'], hardDeny: false,
  },
  {
    id: 'gray-stale', name: '灰色样例·证据缺失或过期', address: '0xA0000000000000000000000000000000000000B2',
    category: 'gray', categoryLabel: '灰色／证据不明', evidenceSource: '预置合成不完整证据', evidenceUpdatedAt: null,
    evidenceSummary: '更新时间未知，关键历史证据缺失；不把未知当成零风险。', coverage: '历史与时效性不足，总分保持未知并暂缓。',
    levels: [0.5, 0, 0, null], notes: ['合成一般风险提示', '模拟付款内容一致', '模拟商品与报价匹配', '历史证据缺失或过期'], hardDeny: false,
  },
] as const;

export interface DemoAssessmentInput {
  fixtureId: string;
  amount: string;
  taskLimit: string;
  weights: DemoWeights;
  contentChanged: boolean;
}

export interface DemoContribution { label: string; weight: number; level: RiskLevel; points: number | null; note: string }
export interface DemoAssessmentResult {
  policy: typeof DEMO_POLICY;
  simulation: true;
  paymentEnabled: false;
  decision: DemoDecision;
  score: number | null;
  reason: string;
  nextStep: string;
  contributions: DemoContribution[];
  errors: string[];
  execution: { signed: false; submitted: false; paid: false; reportPurchased: false };
}

export function parseUsdcAtomic(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const atomic = BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6));
  return atomic > 0n ? atomic : null;
}

export function decisionForKnownScore(score: number): Exclude<DemoDecision, 'invalid'> {
  return score >= 60 ? 'deny' : score >= 25 ? 'hold' : 'allow';
}

function validWeights(value: unknown): value is DemoWeights {
  return Array.isArray(value) && value.length === 5
    && value.every(item => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 100)
    && value.reduce((sum, item) => sum + item, 0) === 100;
}

export function result(decision: DemoDecision, score: number | null, reason: string, nextStep: string,
  contributions: DemoContribution[], errors: string[] = []): DemoAssessmentResult {
  return { policy: DEMO_POLICY, simulation: true, paymentEnabled: false, decision, score, reason, nextStep,
    contributions, errors, execution: { signed: false, submitted: false, paid: false, reportPurchased: false } };
}

export function assessDemoPayment(input: DemoAssessmentInput): DemoAssessmentResult {
  const fixture = DEMO_FIXTURES.find(item => item.id === input.fixtureId);
  const amount = parseUsdcAtomic(input.amount);
  const limit = parseUsdcAtomic(input.taskLimit);
  const errors: string[] = [];
  if (!fixture) errors.push('请选择目录中的预置合成收款方。');
  if (amount === null) errors.push('本次金额必须是正数 USDC，最多 6 位小数，不接受空值或科学计数法。');
  if (limit === null) errors.push('任务可用额度必须是正数 USDC，最多 6 位小数。');
  if (!validWeights(input.weights)) errors.push('五项权重必须是 0–100 的有限数，且合计恰好 100；系统不会自动归一化。');
  if (typeof input.contentChanged !== 'boolean') errors.push('付款内容变化值无效。');
  if (errors.length || !fixture || amount === null || limit === null || !validWeights(input.weights)) {
    return result('invalid', null, '输入无效，演示已按失败关闭。', '修正标记的输入后重新评估。', [], errors);
  }

  const budgetLevel: RiskLevel = amount * 2n <= limit ? 0 : amount * 5n <= limit * 4n ? 0.5 : 1;
  const levels: [RiskLevel, RiskLevel, RiskLevel, RiskLevel, RiskLevel] = [
    fixture.levels[0], input.contentChanged ? 1 : fixture.levels[1], fixture.levels[2], fixture.levels[3], budgetLevel,
  ];
  const notes = [fixture.notes[0], input.contentChanged ? '模拟付款内容已改变' : fixture.notes[1], fixture.notes[2], fixture.notes[3], budgetLevel === 0 ? '金额不超过任务额度的 50%'
    : budgetLevel === 0.5 ? '金额超过 50% 且不超过 80%'
      : '金额超过任务额度的 80%'] as const;
  const contributions = ASSESSMENT_LABELS.map((label, index) => ({
    label, weight: input.weights[index], level: levels[index],
    points: levels[index] === null ? null : input.weights[index] * levels[index], note: notes[index],
  }));
  const score = contributions.some(item => item.points === null) ? null
    : contributions.reduce((sum, item) => sum + (item.points ?? 0), 0);

  if (fixture.hardDeny) return result('deny', score, '预置合成证据命中已知风险硬拒绝；即使对应权重为 0 也不允许。', '停止本次模拟，改用经核对的预置测试样例后重新评估。', contributions);
  if (input.contentChanged) return result('deny', score, '模拟付款内容已变，旧决定不能继续使用。', '恢复已核对的内容，再从头评估。', contributions);
  if (amount > WALLET_BALANCE_ATOMIC) return result('deny', score, '本次金额超过 0.010000 USDC 模拟余额。', '降低金额后重新评估；真实余额仍未读取。', contributions);
  if (amount > limit) return result('deny', score, '本次金额超过当前任务可用额度。', '降低金额或明确调整模拟任务额度后重新评估。', contributions);
  if (score === null) return result('hold', null, '关键模拟证据缺失或过期；未知不按 0 分处理。', '补足或更新证据，然后重新评估。', contributions);
  if (decisionForKnownScore(score) === 'deny') return result('deny', score, '演示风险分达到 60 分或以上的拒绝区间。', '复核高贡献项，更新输入后重新评估。', contributions);
  if (decisionForKnownScore(score) === 'hold') return result('hold', score, '演示风险分在 25 至低于 60 的暂缓区间。', '先复核风险证据和额度，再重新评估。', contributions);
  return result('allow', score, '模拟证据完整，风险分低于 25，且没有硬拒绝。', '可查看演示结果；这不代表已签名、已付款或已买到报告。', contributions);
}

export function isDemoAssessmentInput(value: unknown): value is DemoAssessmentInput {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DemoAssessmentInput>;
  return typeof candidate.fixtureId === 'string' && typeof candidate.amount === 'string'
    && typeof candidate.taskLimit === 'string' && validWeights(candidate.weights)
    && typeof candidate.contentChanged === 'boolean'
    && Object.keys(candidate).every(key => ['fixtureId', 'amount', 'taskLimit', 'weights', 'contentChanged'].includes(key));
}
