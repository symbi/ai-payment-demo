import type { PrivateRiskPanelProps, PrivateScanRecord, PrivateScanStatus } from '../../../shared/private-risk.ts';
import { PRIVATE_RISK_CANDIDATES, privateCandidate } from '../../../shared/private-risk.ts';
import type { RiskResult } from '../../../shared/contracts.ts';
import { isSchemaDiagnostic } from '../../../shared/scan-diagnostic.ts';
import { RiskReceiptDownload } from './RiskReceiptDownload.tsx';
import './private-risk.css';

const judgmentReason = '仍需确认返回字段的含义和适用网络，暂不能据此许可付款。这表示依据不足，不表示地址已认定危险。我们不另算综合分。';

function selectedRecord(status: PrivateScanStatus | null, candidateId: PrivateRiskPanelProps['selectedId']): PrivateScanRecord | undefined {
  return status?.records.find(record => record.candidateId === candidateId);
}

const diagnosticReasons = {
  'http-error': '扫描服务返回非成功 HTTP 状态；尚无可用扫描证据。',
  'schema-unsupported': '已收到响应，但核心字段结构尚不受支持，不能提取有效扫描证据。',
  'body-invalid': '响应正文无法按受支持的 JSON 格式读取；未展示原始正文。',
  timeout: '扫描请求超时；没有自动重试。',
  'transport-error': '请求传输失败；尚无可用扫描证据。',
  configuration: '本地扫描配置或地址检查未通过。',
  observed: '已提取支持的原始字段；风险含义和网络覆盖仍待确认。',
};
const legacyReasons = new Map([
  ['Invalid scan address.', diagnosticReasons.configuration],
  ['API key unavailable.', diagnosticReasons.configuration],
  ['Scan service unavailable.', '旧记录显示扫描服务不可用；未记录 HTTP 状态。'],
  ['Unsupported scan response. Review required.', diagnosticReasons['schema-unsupported']],
  ['Scan timed out. No automatic retry.', diagnosticReasons.timeout],
  ['Scan unavailable. Review required.', '旧记录显示扫描不可用；未记录更详细的失败类别。'],
]);

function ScanDiagnostics({ risk }: { risk: RiskResult }) {
  const scan = risk.scan;
  const reason = scan?.diagnosticCode && Object.hasOwn(diagnosticReasons, scan.diagnosticCode)
    ? diagnosticReasons[scan.diagnosticCode]
    : risk.reasons.map(item => legacyReasons.get(item)).find(Boolean)
      ?? (risk.source === 'live' ? diagnosticReasons.observed : '旧记录未保存详细诊断；不推断失败原因。');
  const schema = isSchemaDiagnostic(scan?.schemaDiagnostic) ? scan.schemaDiagnostic : undefined;
  return <div className="private-risk-scan-diagnostics">
    <p><strong>扫描诊断</strong>：{reason}</p>
    <p className="private-risk-muted">txsCount 为可选字段；服务方未提供时不补零，提供但类型错误时仍无法接受。</p>
    <dl>
      <div><dt>HTTP 状态</dt><dd>{scan?.httpStatus ?? '未记录'}</dd></div>
      {schema && <>
        <div><dt>顶层已知字段名</dt><dd>{schema.topLevelKeys.join('、') || '未观察到支持字段'}</dd></div>
        <div><dt>其他顶层字段数量</dt><dd>{schema.otherKeysCount}</dd></div>
        <div><dt>toxicScore 字段类型</dt><dd>{schema.toxicScoreType}</dd></div>
        <div><dt>traits 字段类型</dt><dd>{schema.traitsType}</dd></div>
        {schema.traitsCount !== undefined && <div><dt>响应 traits 数组长度</dt><dd>{schema.traitsCount}</dd></div>}
        {schema.traitDiagnostic && <>
          <div><dt>检查的条目 / 总数</dt><dd>{schema.traitDiagnostic.inspectedItems} / {schema.traitDiagnostic.totalItems}</dd></div>
          <div><dt>结构不符合要求的条目</dt><dd>{schema.traitDiagnostic.malformedItems}</dd></div>
          <div><dt>已知 / 未知标签条目</dt><dd>{schema.traitDiagnostic.knownTraitItems} / {schema.traitDiagnostic.unknownTraitItems}</dd></div>
          <div><dt>已知条目 risk 缺失 / 类型错误</dt><dd>{schema.traitDiagnostic.missingRiskCount} / {schema.traitDiagnostic.invalidRiskTypeCount}</dd></div>
          <div><dt>已知条目 txsCount 未提供（可选字段） / 类型错误</dt><dd>{schema.traitDiagnostic.missingTxsCount} / {schema.traitDiagnostic.invalidTxsCountTypeCount}</dd></div>
          <div><dt>已知条目 description 缺失 / 类型错误</dt><dd>{schema.traitDiagnostic.missingDescriptionCount} / {schema.traitDiagnostic.invalidDescriptionTypeCount}</dd></div>
        </>}
      </>}
    </dl>
    {schema && <p className="private-risk-muted">结构摘要仅包含字段类型和数量；不显示未知字段名、自由文本或原始响应。</p>}
  </div>;
}

function renderScan(risk: RiskResult) {
  const scan = risk.scan;
  if (!scan || risk.source !== 'live' || scan.transport === 'unavailable') return <p className="private-risk-muted">未取得有效扫描证据。</p>;
  const score = scan.toxicScore === undefined ? '未确认' : String(scan.toxicScore);
  const count = scan.traitsCount === undefined ? '未确认' : String(scan.traitsCount);
  const labels = scan.traitLabels ?? [];
  return <div className="private-risk-scan-facts">
    <dl>
      <div><dt>Intercepta 原始 toxicScore</dt><dd>{score}</dd></div>
      <div><dt>返回的风险条目总数</dt><dd>{count}</dd></div>
      <div><dt>展示的已知标签</dt><dd>{labels.length ? labels.join('、') : scan.traitsCount === 0 ? '未返回标签，不代表安全' : '没有可展示的已知标签'}</dd></div>
      <div><dt>未知标签条目数量</dt><dd>{scan.unknownTraitsCount ?? '旧记录未记录'}</dd></div>
      <div><dt>忽略的新增字段数量</dt><dd>{scan.additionalFieldsCount ?? '旧记录未记录'}</dd></div>
      <div><dt>本地请求网络</dt><dd>{scan.requestedNetwork}（不代表供应商已确认覆盖）</dd></div>
    </dl>
    <p className="private-risk-muted">分数量纲待确认，不换算为百分制或风险等级；0 不等于安全。总数包含未知标签条目；仅展示已知的允许标签。</p>
    {scan.traitsCount !== undefined && labels.length < scan.traitsCount
      ? <p className="private-risk-muted">当前展示 {labels.length} 个已知标签；未知标签或展示数量上限可能导致省略，不代表全量。</p> : null}
  </div>;
}

function Result({ record }: { record: PrivateScanRecord }) {
  if (record.state === 'pending') return <div className="private-risk-state private-risk-pending"><strong>尚未确认</strong><p>原记录处于 pending，结果尚未确认；不宣称未请求，也不自动重试。</p><p>暂缓（HOLD）：依据不足</p></div>;
  if (!record.risk) return <div className="private-risk-state private-risk-unavailable"><strong>未取得有效证据</strong><p>这次记录没有可用的真实扫描证据，不能据此判断地址安全或危险。</p><p>旧记录未保存详细诊断；不推断失败原因。</p><p>暂缓（HOLD）：依据不足</p></div>;
  const risk = record.risk;
  return <div className="private-risk-result" aria-live="polite">
    <section aria-labelledby="private-risk-intercepta-title">
      <h3 id="private-risk-intercepta-title">Intercepta 原始结果</h3>
      <p className="private-risk-source">来源：{risk.source === 'live' ? '真实API返回（本机保存的上次结果）' : '未取得有效证据'}</p>
      <ScanDiagnostics risk={risk} />
      {renderScan(risk)}
      <p className="private-risk-time"><strong>本地接收时间</strong>：{risk.checkedAt}（不是供应商更新时间；供应商更新时间/覆盖未知）</p>
    </section>
    <section aria-labelledby="private-risk-judgment-title">
      <h3 id="private-risk-judgment-title">我们的判断</h3>
      <p className="private-risk-hold">暂缓（HOLD）：依据不足</p>
      <p>{judgmentReason}</p>
      <details><summary>查看本地检查说明</summary><p>只展示受支持的诊断类别和结构事实；已有记录不会触发重新扫描。</p></details>
    </section>
  </div>;
}

export function PrivateRiskPanel({ selectedId, status, loading, message, onSelect, onScan, onRefresh }: PrivateRiskPanelProps) {
  const candidate = privateCandidate(selectedId);
  const record = selectedRecord(status, selectedId);
  const hasPending = !!status?.records.some(item => item.state === 'pending');
  const exhausted = status ? status.usedRequests >= status.maxRequests : false;
  const scanDisabled = loading || !status || !status.ready || !!record || exhausted || hasPending;
  const scanDisabledReason = !status ? '尚未取得地址评估状态。'
    : !status.ready ? status.message || '地址评估尚未就绪。'
      : hasPending ? '已有扫描处于 pending，先查询已有结果。'
        : exhausted ? `扫描次数已用尽（${status.usedRequests}/${status.maxRequests}）。`
          : record ? '该地址已有记录，不再重复扫描。' : '';

  if (!candidate) return <main className="private-risk-panel"><p className="private-risk-message" role="alert">未找到选中的候选地址。</p></main>;
  return <main className="private-risk-panel" aria-labelledby="private-risk-title">
    <header className="private-risk-hero">
      <p className="private-risk-kicker">地址风险评估</p>
      <h1 id="private-risk-title">评估收款方地址</h1>
      <p>收款方地址风险查询可由人或 Agent 使用；候选只是待扫描线索，不是获准收款地址。</p>
    </header>

    <div className="private-risk-flow">
      <section className="private-risk-card" aria-labelledby="private-risk-select-title">
        <div className="private-risk-step"><span>01</span><div><p>收款方</p><h2 id="private-risk-select-title">选择真实候选地址</h2></div></div>
        <label htmlFor="private-risk-candidate">真实候选地址</label>
        <select id="private-risk-candidate" value={selectedId} disabled={loading} onChange={event => onSelect(event.target.value as PrivateRiskPanelProps['selectedId'])}>
          {PRIVATE_RISK_CANDIDATES.map(item => <option key={item.id} value={item.id}>{item.id} · {item.context}</option>)}
        </select>
        <div className="private-risk-address"><strong>{candidate.id}</strong><code>{candidate.address}</code><p>{candidate.context}</p></div>
        <p className="private-risk-note">候选来自已有文档，仅作为待扫描线索；页面不填写 API key，不要求钱包连接、身份认证、Agent 预算或限额。</p>
      </section>

      <section className="private-risk-card" aria-labelledby="private-risk-result-title">
        <div className="private-risk-step"><span>02</span><div><p>评估</p><h2 id="private-risk-result-title">扫描与查询</h2></div></div>
        <div className="private-risk-actions">
          <button className="private-risk-primary" type="button" disabled={scanDisabled} onClick={onScan}>扫描这个真实地址（消耗1次）</button>
          <button type="button" disabled={loading} onClick={onRefresh}>查询已有结果（不重新扫描）</button>
        </div>
        <p className="private-risk-note">{loading ? '正在处理，请等待结果…' : scanDisabledReason || '每个地址只扫描一次，不自动重试。'}</p>
        <p className="private-risk-note">本轮扫描用量：{status ? `已用 ${status.usedRequests} / 最多 ${status.maxRequests} 次（失败也计入）` : '尚未取得'}</p>
        <p className="private-risk-note">只能在私人电脑独立启动这个入口；始终只扫描，不签名、不付款。金额/Agent 限额不在此次地址扫描中。</p>
        {message && <p className="private-risk-message" role="alert">{message}</p>}
      </section>

      <section className="private-risk-card" aria-labelledby="private-risk-current-title">
        <div className="private-risk-step"><span>03</span><div><p>结果和原因</p><h2 id="private-risk-current-title">当前记录</h2></div></div>
        {!record ? <div className="private-risk-empty"><strong>{status ? '本机暂无该地址记录' : '尚未取得扫描记录'}</strong><p>{status ? '此记录库中没有该地址的结果。' : '先查询私人电脑的已有记录，不能据此断定此前没有扫描。'}不填充 0，也不生成合成结果。</p></div> : <Result record={record} />}
        <div className="private-risk-actions"><RiskReceiptDownload status={status} candidateId={selectedId} /></div>
        <p className="private-risk-note">摘要来自已有记录，下载不会重新扫描。</p>
      </section>
    </div>
  </main>;
}
