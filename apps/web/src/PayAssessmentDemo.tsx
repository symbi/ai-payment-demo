import { useMemo, useRef, useState } from 'react';
import {
  assessDemoPayment, ASSESSMENT_LABELS, DEFAULT_WEIGHTS, DEMO_FIXTURES,
  type DemoAssessmentInput, type DemoAssessmentResult, type DemoWeights,
} from '../../../shared/demo-assessment.ts';
import './pay-assessment.css';

export function isAssessmentResponse(value: unknown): value is DemoAssessmentResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as DemoAssessmentResult;
  return v.policy === 'weighted-demo-v1' && v.simulation === true && v.paymentEnabled === false
    && ['allow', 'hold', 'deny', 'invalid'].includes(v.decision)
    && (v.score === null || (Number.isFinite(v.score) && v.score >= 0 && v.score <= 100))
    && typeof v.reason === 'string' && typeof v.nextStep === 'string'
    && Array.isArray(v.errors) && v.errors.every(item => typeof item === 'string')
    && Array.isArray(v.contributions)
    && (v.decision === 'invalid' ? v.contributions.length === 0 : v.contributions.length === ASSESSMENT_LABELS.length)
    && v.contributions.every((item, index) => item && item.label === ASSESSMENT_LABELS[index]
      && typeof item.note === 'string' && Number.isFinite(item.weight) && [null, 0, 0.5, 1].includes(item.level)
      && (item.points === null || Number.isFinite(item.points)))
    && !!v.execution && ['signed', 'submitted', 'paid', 'reportPurchased'].every(key => v.execution[key as keyof typeof v.execution] === false);
}

type ResultState = DemoAssessmentResult | null;

export function staleInputMessage(hadDecision: boolean): string {
  return hadDecision ? '输入已变，请重新评估。旧决定已清除。' : '输入已变，请重新评估。';
}

const categoryOrder = [
  ['known-risk', '已知风险（模拟）'],
  ['controlled', '受控测试样例'],
  ['gray', '灰色／证据不明'],
] as const;

function decisionText(decision: DemoAssessmentResult['decision']) {
  return { allow: '演示允许', hold: '暂缓', deny: '拒绝', invalid: '输入无效' }[decision];
}

export function PayAssessmentDemo() {
  const [fixtureId, setFixtureId] = useState('controlled-a');
  const [amount, setAmount] = useState('0.001000');
  const [taskLimit, setTaskLimit] = useState('0.005000');
  const [weightInputs, setWeightInputs] = useState<string[]>(DEFAULT_WEIGHTS.map(String));
  const [contentChanged, setContentChanged] = useState(false);
  const [assessment, setAssessment] = useState<ResultState>(null);
  const [notice, setNotice] = useState('等待评估。');
  const [requesting, setRequesting] = useState(false);
  const inputRevision = useRef(0);
  const selected = useMemo(() => DEMO_FIXTURES.find(item => item.id === fixtureId) ?? DEMO_FIXTURES[0], [fixtureId]);

  function invalidate(change: () => void) {
    inputRevision.current += 1;
    const hadDecision = assessment !== null;
    change();
    setAssessment(null);
    setNotice(staleInputMessage(hadDecision));
  }

  const weights = weightInputs.map(value => value.trim() === '' ? Number.NaN : Number(value)) as DemoWeights;
  const input: DemoAssessmentInput = { fixtureId, amount, taskLimit, weights, contentChanged };
  async function assess() {
    setRequesting(true);
    const revision = inputRevision.current;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      if (window.location.protocol === 'file:') {
        const value = assessDemoPayment(input);
        setAssessment(value);
        setNotice(value.decision === 'invalid' ? '输入无效，未执行任何动作。' : '本地演示评估完成。');
        return;
      }
      const response = await fetch('/api/demo/assess', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal,
      });
      const value: unknown = await response.json();
      if (revision !== inputRevision.current) return;
      if (!isAssessmentResponse(value)) throw new Error('Invalid demo response');
      setAssessment(value);
      setNotice(response.ok ? '同源演示评估完成。' : '演示接口拒绝了无效输入。');
    } catch {
      if (revision !== inputRevision.current) return;
      setAssessment(null);
      setNotice('演示接口调用失败，未回退为“允许”；未签名、未付款。');
    } finally {
      window.clearTimeout(timeout);
      setRequesting(false);
    }
  }

  return <main className="demo-shell">
    <header className="hero">
      <div><p className="kicker">PAY / ASSESS</p><h1>付款前，先把“为什么”说清楚。</h1>
        <p className="lead">选一个收款方样例，填写金额，看看这笔付款为什么允许、暂缓或拒绝。</p></div>
      <span className="simulation-badge">纯演示·无真实付款</span>
    </header>

    <div className="dashboard">
      <div className="left-column">
        <section className="panel" aria-labelledby="wallet-title">
          <div className="step-heading"><span>01</span><div><p>模拟资金</p><h2 id="wallet-title">钱包与额度</h2></div></div>
          <div className="wallet-status"><strong>模拟钱包 · 未连接 Trust</strong><span>真实余额未读取</span></div>
          <dl className="facts">
            <div><dt>模拟余额</dt><dd>0.010000 USDC</dd></div>
            <div><dt>模拟 ETH</dt><dd>未读取，演示不消耗 Gas</dd></div>
          </dl>
          <p className="explain">余额是钱包中的模拟总量；任务额度是这次最多可用多少。两者不是一回事。</p>
          <div className="field-grid">
            <label>任务可用额度 <span>模拟 USDC</span>
              <input value={taskLimit} inputMode="decimal" onChange={event => invalidate(() => setTaskLimit(event.target.value))} aria-describedby="amount-help" /></label>
            <label>本次金额 <span>模拟 USDC</span>
              <input value={amount} inputMode="decimal" onChange={event => invalidate(() => setAmount(event.target.value))} aria-describedby="amount-help" /></label>
          </div>
          <p id="amount-help" className="helper">请输入正数，最多 6 位小数；不接受科学计数法。所有值均为模拟。</p>
        </section>

        <section className="panel" aria-labelledby="order-title">
          <div className="step-heading"><span>02</span><div><p>付款对象</p><h2 id="order-title">订单与收款方</h2></div></div>
          <div className="order-name"><span>示例商品</span><strong>示例结构报告</strong><small>静态教学内容，不是安全审计</small></div>
          <label>选择预置合成收款方
            <select value={fixtureId} onChange={event => invalidate(() => setFixtureId(event.target.value))}>
              {categoryOrder.map(([category, label]) => <optgroup key={category} label={label}>
                {DEMO_FIXTURES.filter(item => item.category === category).map(item => <option key={item.id} value={item.id}>{item.name} · {item.address}</option>)}
              </optgroup>)}
            </select>
          </label>
          <article className="recipient" aria-live="polite">
            <div><span>{selected.categoryLabel}</span><strong>{selected.name}</strong></div>
            <code>{selected.address}</code>
            <dl className="evidence">
              <div><dt>样例编号</dt><dd>{selected.id}</dd></div>
              <div><dt>证据来源</dt><dd>{selected.evidenceSource}</dd></div>
              <div><dt>更新时间</dt><dd>{selected.evidenceUpdatedAt ?? '未知／过期'}</dd></div>
              <div><dt>覆盖与说明</dt><dd>{selected.coverage}</dd></div>
            </dl>
            <p>{selected.evidenceSummary}</p>
          </article>
          <p className="boundary-note">全部是预置合成地址和合成证据。分组名称或地址字符串本身不能证明真实地址安全或有风险。</p>
          <label className="toggle"><input type="checkbox" checked={contentChanged} onChange={event => invalidate(() => setContentChanged(event.target.checked))} />
            <span><strong>模拟付款内容发生变化</strong><small>打开后触发硬拒绝，旧决定不可继续使用。</small></span></label>
        </section>
      </div>

      <section className="panel decision-panel" aria-labelledby="decision-title">
        <div className="step-heading"><span>03</span><div><p>评估结果</p><h2 id="decision-title">决定与原因</h2></div></div>
        <p className="decision-intro">分数越高，表示这组模拟证据的风险越高。分数不是诈骗概率；明确禁止或证据不足时另行拦截。</p>
        <button className="pay-button" type="button" onClick={assess} disabled={requesting}>{requesting ? '正在评估…' : 'Pay · 评估这笔付款'}</button>
        <p className="no-payment">只评估，不转账。可多次调整样例、金额和额度后对比结果。</p>
        <p className={notice.includes('失败') || notice.includes('无效') ? 'notice error' : 'notice'} role="status">{notice}</p>

        {assessment ? <div className={`result ${assessment.decision}`} aria-live="polite">
          <p className="result-label">本次演示决定</p><h3>{decisionText(assessment.decision)}</h3>
          <p className="score-summary">风险评分 <strong>{assessment.score === null ? '未知' : `${assessment.score} / 100`}</strong></p>
          <p className="plain-reason">{assessment.reason}</p>
          <div className="next-step"><strong>下一步</strong><p>{assessment.nextStep}</p></div>
          {assessment.errors.length > 0 && <ul className="errors">{assessment.errors.map(error => <li key={error}>{error}</li>)}</ul>}
          <div className="execution-state"><strong>执行状态</strong><span>签名：未执行</span><span>提交：未执行</span><span>付款：未执行</span><span>报告：未购买</span></div>
          {assessment.decision === 'allow' && <p className="allow-boundary">“演示允许”只表示这组模拟输入通过当前评估，不代表已付款或已买到报告。</p>}
        </div> : <div className="empty-result"><span>—</span><p>还没有当前决定。输入变化后，旧决定会立即清除。</p></div>}

        <details className="advanced">
          <summary>查看评分权重与各项原因</summary>
          <p>五项权重必须合计 100，不会自动归一化。档位为 0 / 0.5 / 1；未知为空值，即使权重为 0 也不当作无风险。</p>
          <div className="weight-list">
            {ASSESSMENT_LABELS.map((label, index) => <label key={label}>{label}<input type="number" min="0" max="100" step="1" value={weightInputs[index]}
              onChange={event => invalidate(() => setWeightInputs(current => current.map((item, position) => position === index ? event.target.value : item)))} /></label>)}
          </div>
          <div className="weight-actions"><button type="button" onClick={() => invalidate(() => setWeightInputs(DEFAULT_WEIGHTS.map(String)))}>恢复默认权重</button><strong>当前合计：{weights.every(Number.isFinite) ? `${weights.reduce((sum, value) => sum + value, 0)}%` : '无效'}</strong></div>
          <p className="formula">贡献分 = 权重 × 风险档位。低于 25 演示允许；25 至低于 60 暂缓；60 及以上拒绝。已知风险、超余额／额度、内容变化优先硬拒绝。</p>
          {assessment?.contributions.length ? <div className="contributions">
            {assessment.contributions.map(item => <div key={item.label}><span>{item.label}<small>{item.note}</small></span><strong>{item.level === null ? '档位未知' : `${item.weight} × ${item.level} = ${item.points}`}</strong></div>)}
            <div className="total"><span>总风险分</span><strong>{assessment.score === null ? '未知' : `${assessment.score} / 100`}</strong></div>
          </div> : <p className="helper">重新评估后显示五项贡献。</p>}
        </details>
      </section>
    </div>
    <footer>本页使用模拟余额、地址与证据；未读取你的真实钱包，也未执行真实付款。</footer>
  </main>;
}
