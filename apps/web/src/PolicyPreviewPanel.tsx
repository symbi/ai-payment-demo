import type { PolicyAction, PolicyPreviewCaseSummary, PolicyPreviewResult } from '../../../shared/policy-preview.ts';
import type { PolicyPreviewPanelProps } from '../../../shared/policy-preview-view.ts';
import './policy-preview-panel.css';

export type { PolicyPreviewPanelProps } from '../../../shared/policy-preview-view.ts';

const actionLabels: Record<PolicyAction, string> = {
  allow: '规则允许',
  allow_with_limit: '附限额允许',
  hold: '暂缓',
  deny: '拒绝',
};

const scenarioDescriptions: Record<PolicyPreviewCaseSummary['scenario'], string> = {
  allowed: '合成低风险信号，展示规则允许的路径。',
  'explicit-denial': '合成场景包含明确拒绝信号，展示拒绝路径。',
  'insufficient-evidence': '合成证据不完整，展示需要暂缓的路径。',
  'content-changed': '合成内容在检查前后改变，展示拒绝路径。',
  'budget-insufficient': '合成规则允许，但当前任务预算低于原报价。',
  'duplicate-pending': '合成状态重复或仍待复核，展示暂缓路径。',
  'limit-within': '规则设置了限额，原报价在限额内。',
  'limit-exceeded': '规则设置了限额，但原报价超过限额，不能继续。',
};

const reasonLabels: Record<string, string> = {
  FIXTURE_POLICY_ALLOW: '合成策略允许。',
  FIXTURE_POLICY_LIMIT: '合成策略设置了单笔限额。',
  FIXTURE_EXPLICIT_REFUSAL: '合成证据包含明确拒绝。',
  FIXTURE_EVIDENCE_INCOMPLETE: '合成证据不足，不能继续。',
  FIXTURE_CONTENT_CHANGED: '合成内容已改变，不能继续。',
  FIXTURE_DUPLICATE_OR_PENDING: '合成状态重复或仍待处理。',
  POLICY_HOLD: '策略结果是暂缓。',
  POLICY_DENY: '策略结果是拒绝。',
  QUOTE_EXCEEDS_CAP: '原报价超过策略限额；原价未改，不能继续。',
  PER_TRANSACTION_LIMIT_EXCEEDED: '原报价超过单笔交易限额；原价未改，不能继续。',
  TASK_BUDGET_INSUFFICIENT: '任务预算不足以覆盖原报价；原价未改，不能继续。',
  SYNTHETIC_RULES_PASSED: '仅合成规则通过，不代表可以真实付款。',
  SIMULATION_ONLY: '当前仅做合成评估，实际付款功能关闭。',
};

function formatUsdcAtomic(value: string): string {
  const normalized = value.replace(/^0+(?=\d)/, '');
  if (normalized.length <= 6) return `0.${normalized.padStart(6, '0')}`.replace(/0+$/, '').replace(/\.$/, '') || '0';
  const whole = normalized.slice(0, -6) || '0';
  const fraction = normalized.slice(-6).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

function reasonText(code: string): string {
  return reasonLabels[code] ?? '该原因来自冻结的合成评估结果。';
}

function StatusMessage({ phase, message }: { phase: PolicyPreviewPanelProps['state']['phase']; message: string }) {
  if (phase === 'loading') return <p className="policy-preview-status" role="status">正在评估合成规则，请稍候。</p>;
  if (phase === 'error') return <p className="policy-preview-status policy-preview-error" role="alert">{message || '评估失败；结果未确认。'}</p>;
  if (phase === 'idle') return <p className="policy-preview-status" role="status">{message || '选择案例和任务额度后，点击评估。'}</p>;
  return <p className="policy-preview-status" role="status">{message || '评估完成。'}</p>;
}

function Evidence({ result }: { result: PolicyPreviewResult }) {
  const { evidence } = result;
  const unknownLabels: Record<string, string> = { 'provider-semantics': '真实标签含义未验证', 'provider-coverage': '真实网络覆盖未验证', 'provider-score-scale': '分数范围未确认', 'live-state': '真实请求状态未验证', 'real-final-gate': '实际付款检查尚未接通' };
  return <dl className="policy-preview-evidence-grid">
    <div><dt>来源</dt><dd>合成证据，未经真实服务验证</dd></div>
    <div><dt>证据 ID</dt><dd>{evidence.evidenceId ?? '未提供'}</dd></div>
    <div><dt>原始 Toxic Score</dt><dd>{evidence.toxicScore === null ? '未提供' : evidence.toxicScore}</dd></div>
    <div><dt>量表</dt><dd>未提供；不代表安全等级</dd></div>
    <div><dt>标签</dt><dd>{evidence.labels.length ? evidence.labels.join('、') : '未提供'}</dd></div>
    <div><dt>缺失/未知数据</dt><dd>{evidence.unknownItems.map(item => unknownLabels[item] ?? item).join('；')}</dd></div>
  </dl>;
}

function ResultState({ result }: { result: PolicyPreviewResult | null }) {
  if (!result) return <div className="policy-preview-empty" role="status">还没有当前决定。修改案例或额度后，需要重新评估。</div>;
  const policy = result.policy;
  const reasonCodes = [...policy.reasonCodes, ...result.previewEligibility.reasonCodes];
  const uniqueReasons = [...new Set(reasonCodes)];
  return <>
    <div className="policy-preview-decision" data-action={policy.action}>
      <span className="policy-preview-kicker">规则决定</span>
      <strong>{actionLabels[policy.action]}</strong>
      <span>{result.previewEligibility.status === 'eligible' ? '合成条件通过，仍不执行付款' : '本次条件未通过，原因见下方'}</span>
    </div>
    <dl className="policy-preview-facts">
      <div><dt>本次条件检查</dt><dd>{result.previewEligibility.status === 'eligible' ? '通过（仅合成规则）' : '未通过'}</dd></div>
      <div><dt>检查原因</dt><dd>{result.previewEligibility.reasonCodes.map(reasonText).join(' ')}</dd></div>
      <div><dt>实际付款功能</dt><dd>关闭（仅演示）</dd></div>
      <div><dt>签名 / 提交 / 付款 / 报告</dt><dd>均未执行</dd></div>
    </dl>
    <ul className="policy-preview-reasons" aria-label="评估原因">
      {uniqueReasons.map(code => <li key={code}>{reasonText(code)}</li>)}
    </ul>
    <p className="policy-preview-warning">离线合成演示／仅评估，不付款。规则允许不代表已获真实付款授权，也不代表已经付款。</p>
  </>;
}

export function PolicyPreviewPanel({ cases, state, onCaseChange, onBudgetChange, onAssess }: PolicyPreviewPanelProps) {
  const selectedCase = cases.find(item => item.caseId === state.caseId);
  const result = state.result;
  const quote = result?.quote ?? selectedCase?.quote;
  const cap = result?.policy.action === 'allow_with_limit' ? result.policy.capAtomic : null;
  const hasCapExceeded = result?.previewEligibility.reasonCodes.includes('QUOTE_EXCEEDS_CAP') ?? false;

  return <section className="policy-preview-panel" aria-label="四动作策略评估面板">
    <header className="policy-preview-hero"><p>付款前评估</p><h1>先看清决定，再考虑付款。</h1><p>选择一个合成案例，看看风险证据、任务额度和限额如何影响结果。</p></header>
    <div className="policy-preview-banner" role="note"><strong>离线合成演示／仅评估，不付款</strong><span>未连接真实钱包，未读取真实余额。</span></div>

    <section className="policy-preview-card" aria-labelledby="policy-preview-budget-title">
      <h2 id="policy-preview-budget-title">任务额度与报价</h2>
      <div className="policy-preview-controls">
        <div>
          <label htmlFor="policy-preview-case">选择合成案例</label>
          <select id="policy-preview-case" value={state.caseId} onChange={event => onCaseChange(event.currentTarget.value)}>
            {cases.map(item => <option key={item.caseId} value={item.caseId}>{item.caseId} · {item.title}</option>)}
          </select>
          <p className="policy-preview-help">{selectedCase ? scenarioDescriptions[selectedCase.scenario] : '未选择合成场景。'}真实标签和地址未知，不能凭颜色或名字认证安全。</p>
        </div>
        <div>
          <label htmlFor="policy-preview-budget">任务额度（模拟 USDC）</label>
          <input id="policy-preview-budget" inputMode="decimal" type="text" value={state.budgetText} onChange={event => onBudgetChange(event.currentTarget.value)} placeholder="例如 0.002000" aria-describedby="policy-budget-help" />
          <p id="policy-budget-help" className="policy-preview-help">这次任务最多可用多少，不代表钱包余额。请输入正数，最多 6 位小数。</p>
        </div>
      </div>
      <div className="policy-preview-quote-grid">
        <div><span>任务额度</span><strong>{state.budgetText ? `${state.budgetText} USDC` : '—'}</strong><small>本次输入，仅用于模拟</small></div>
        <div><span>原报价（只读）</span><strong>{quote ? `${formatUsdcAtomic(quote.amount)} USDC` : '—'}</strong><small>固定报价，不会为满足限额而改价</small></div>
        <div><span>策略限额（只读）</span><strong>{cap ? `${formatUsdcAtomic(cap)} USDC` : result ? '未设置额外限额' : '评估后显示'}</strong><small>任务额度与单笔上限仍然适用</small></div>
      </div>
      {hasCapExceeded && <p className="policy-preview-block-note">原报价超过限额：原价未改，不能继续。</p>}
      <button className="policy-preview-assess" type="button" disabled={state.phase === 'loading'} onClick={onAssess}>{state.phase === 'loading' ? '评估中…' : '评估合成规则'}</button>
    </section>

    <section className="policy-preview-card" aria-labelledby="policy-preview-evidence-title">
      <h2 id="policy-preview-evidence-title">风险证据</h2>
      {result ? <Evidence result={result} /> : <p className="policy-preview-empty">评估后显示合成证据。目前没有真实风险数据。</p>}
    </section>

    <section className="policy-preview-card" aria-labelledby="policy-preview-result-title" aria-busy={state.phase === 'loading'}>
      <h2 id="policy-preview-result-title">决定与执行状态</h2>
      <StatusMessage phase={state.phase} message={state.message} />
      <ResultState result={result} />
      <p className="policy-preview-final-gate">实际付款功能：关闭。签名、提交、付款、报告均未执行。</p>
    </section>
  </section>;
}
