import type { RiskResult } from '../../../shared/contracts.ts';
import { DEMO_RISK_FIXTURES } from '../../../shared/demo-risk-evidence.ts';

export function RiskScanEvidence({scan}: {scan: NonNullable<RiskResult['scan']>}) {
  const score = scan.toxicScore === undefined ? '未确认' : String(scan.toxicScore);
  const count = scan.traitsCount === undefined ? '未确认' : String(scan.traitsCount);
  const labels = scan.traitLabels ?? [];
  return <section aria-label="风险扫描证据">
    <p>原始 toxicScore：{score}（原始值，不是加权评分；0 不等于安全）</p>
    <p>风险标签计数：{count}</p>
    <p>有界风险标签：{labels.length ? labels.join('、') : scan.traitsCount === 0 ? '无已展示标签' : '未确认'}</p>
    {scan.traitLabels !== undefined && scan.traitsCount !== undefined && scan.traitsCount > labels.length
      ? <p>仅展示前 {labels.length} 条允许标签；截断不代表全量。</p> : null}
    <p>请求网络：{scan.requestedNetwork}；覆盖与语义均未核验。</p>
    <p>真实付款状态：暂停（hold）；不得据此执行资金动作。</p>
  </section>;
}

export function DemoRiskEvidence({fixtureId}: {fixtureId:string}) {
  const fixture = DEMO_RISK_FIXTURES[fixtureId];
  if (!fixture) return <p>接口格式模拟样例（synthetic）：未知 fixture；证据未确认，保持 hold。</p>;
  return <details>
    <summary>查看接口格式样例（模拟证据）</summary>
    <p>来源：{fixture.sourceLabel}；不代表正式黑名单、安全地址或真实实测。</p>
    <RiskScanEvidence scan={fixture.scan} />
  </details>;
}
