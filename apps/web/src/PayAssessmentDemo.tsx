import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ASSESSMENT_LABELS, DEFAULT_WEIGHTS, DEMO_FIXTURES,
  type DemoAssessmentResult, type DemoWeights,
} from '../../../shared/demo-assessment.ts';
import { DemoRiskEvidence } from './DemoRiskEvidence.tsx';
import { DemoRequestClient, fileTransport, httpTransport, type ClientState } from './demo-request-client.ts';
import { type DemoRequestInput, type DemoScenario } from '../../../shared/demo-requests.ts';
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
  const [scenario, setScenario] = useState<DemoScenario>('normal');
  const [initializing, setInitializing] = useState(true);
  const [view, setView] = useState<ClientState>({ record: null, busy: false, invalidated: false, recoveryBlocked: false, notice: '等待评估。', storageWarning: '' });
  const client = useRef<DemoRequestClient | null>(null);
  const selected = useMemo(() => DEMO_FIXTURES.find(item => item.id === fixtureId) ?? DEMO_FIXTURES[0], [fixtureId]);
  const assessment = !initializing && !view.invalidated && view.record?.status === 'completed' && isAssessmentResponse(view.record.result) ? view.record.result : null;
  const notice = view.notice;
  const requesting = view.busy;
  const pending = view.recoveryBlocked || (!!view.record && view.record.status !== 'completed');

  useEffect(() => {
    let alive = true;
    const mode = window.location.protocol === 'file:' ? 'file' : 'http';
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* recovery explains inaccessible storage */ }
    const session = new DemoRequestClient({ mode, storage, transport: mode === 'file' ? fileTransport() : httpTransport(),
      onChange: state => { if (alive) setView(state); } });
    client.current = session;
    void session.recover().then(restored => {
      if (!alive) return;
      if (restored) {
        setFixtureId(restored.fixtureId); setAmount(restored.amount); setTaskLimit(restored.taskLimit);
        setWeightInputs(restored.weights.map(String)); setContentChanged(restored.contentChanged); setScenario(restored.scenario);
      }
      setInitializing(false);
    }).catch(() => { if (alive) { setView(current => ({ ...current, recoveryBlocked: true, notice: '刷新恢复失败，结果未确认；请显式结束此模拟。' })); setInitializing(false); } });
    return () => { alive = false; };
  }, []);

  function invalidate(change: () => void) {
    if (initializing) return;
    client.current?.invalidate();
    change();
  }
  const weights = weightInputs.map(value => value.trim() === '' ? Number.NaN : Number(value)) as DemoWeights;
  const input: DemoRequestInput = { fixtureId, amount, taskLimit, weights, contentChanged, scenario };
  function assess() { if (!initializing) void client.current?.submit(input); }

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
              <input disabled={initializing} value={taskLimit} inputMode="decimal" onChange={event => invalidate(() => setTaskLimit(event.target.value))} aria-describedby="amount-help" /></label>
            <label>本次金额 <span>模拟 USDC</span>
              <input disabled={initializing} value={amount} inputMode="decimal" onChange={event => invalidate(() => setAmount(event.target.value))} aria-describedby="amount-help" /></label>
          </div>
          <p id="amount-help" className="helper">请输入正数，最多 6 位小数；不接受科学计数法。所有值均为模拟。</p>
        </section>

        <section className="panel" aria-labelledby="order-title">
          <div className="step-heading"><span>02</span><div><p>付款对象</p><h2 id="order-title">订单与收款方</h2></div></div>
          <div className="order-name"><span>示例商品</span><strong>示例结构报告</strong><small>静态教学内容，不是安全审计</small></div>
          <label>选择预置合成收款方
            <select disabled={initializing} value={fixtureId} onChange={event => invalidate(() => setFixtureId(event.target.value))}>
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
          <DemoRiskEvidence fixtureId={fixtureId} />
          <p className="boundary-note">全部是预置合成地址和合成证据。分组名称或地址字符串本身不能证明真实地址安全或有风险。</p>
          <label className="toggle"><input type="checkbox" disabled={initializing} checked={contentChanged} onChange={event => invalidate(() => setContentChanged(event.target.checked))} />
            <span><strong>模拟付款内容发生变化</strong><small>打开后触发硬拒绝，旧决定不可继续使用。</small></span></label>
        </section>
      </div>

      <section className="panel decision-panel" aria-labelledby="decision-title">
        <div className="step-heading"><span>03</span><div><p>评估结果</p><h2 id="decision-title">决定与原因</h2></div></div>
        <p className="decision-intro">分数越高，表示这组模拟证据的风险越高。分数不是诈骗概率；明确禁止或证据不足时另行拦截。</p>
        <button className="pay-button" type="button" onClick={assess} disabled={initializing || requesting || pending}>{requesting ? '检查中…' : 'Pay · 评估这笔付款'}</button>
        <p className="no-payment">只评估，不转账。未决时查询原请求，或显式结束此模拟后再评估。</p>
        <p className={notice.includes('失败') || notice.includes('无效') ? 'notice error' : 'notice'} role="status">{notice}</p>

        {(view.record || view.recoveryBlocked) && <div className="request-status" aria-live="polite">
          <strong>当前阶段：{view.record?.status === 'checking' ? '检查中' : view.record?.status === 'completed' ? '已完成' : '结果未确认'}</strong>
          {view.record && <p>模拟请求编号：<code>{view.record.id}</code></p>}
          <p>{pending ? '原请求尚未确认，修改输入也不会解除拦截。没有签名或转账。' : '仅为演示评估结果，所有真实执行标志仍为 false。'}</p>
          <div className="request-actions">
            <button type="button" disabled={initializing || requesting || !view.record} onClick={() => void client.current?.query()}>查询原请求</button>
            <button type="button" disabled={initializing} onClick={() => client.current?.end()}>结束此模拟并开始新评估</button>
          </div>
        </div>}
        {view.storageWarning && <p className="notice error" role="alert">{view.storageWarning}</p>}
        <details className="advanced">
          <summary>模拟请求情景</summary>
          <label>仅模拟返回过程<select disabled={initializing} value={scenario} onChange={event => invalidate(() => setScenario(event.target.value as DemoScenario))}>
            <option value="normal">正常</option><option value="delayed">延迟返回（约 1 秒）</option><option value="unresolved">结果未确认</option>
          </select></label>
          <p>正常也会短暂显示检查中。未确认情景不会给出允许结果；查询不会重新发起评估。</p>
          <p>file 模式只恢复当前浏览器保存的最后一笔模拟记录；禁用或清除存储会失去恢复能力。HTTP 模式刷新只查询原编号，服务器重启丢失记录时保持未确认。</p>
          <p>HTTP 内存最多保留 128 笔，保留到进程结束，不自动淘汰；容量满拒绝新请求。本地记录与去重仅用于此演示，不是实际付款幂等保证。结束模拟不会取消任何真实交易，因为没有真实交易。</p>
        </details>

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
            {ASSESSMENT_LABELS.map((label, index) => <label key={label}>{label}<input type="number" disabled={initializing} min="0" max="100" step="1" value={weightInputs[index]}
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
