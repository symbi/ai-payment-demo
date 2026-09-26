import { sampleReport } from './sample-report.ts';
export function SamplePreview() {
  if (!sampleReport) return <div className="sample-empty"><h3>Sample pending</h3><p>Verified counts will appear here.</p></div>;
  const rows = [['Functions', sampleReport.metrics.functions], ['Events', sampleReport.metrics.events], ['Modifiers', sampleReport.metrics.modifiers]] as const;
  const max = Math.max(1, ...rows.map(([, value]) => value));
  const ticks = Array.from({ length: max + 1 }, (_, i) => i);
  return <div className="sample-preview insight-panel">
    <div className="insight-heading"><div><p className="sample-kicker">Sample · Structure only</p><h3>{sampleReport.source.filename}</h3></div><span className="source-badge">.sol</span></div>
    <div className="metric-chart" role="img" aria-label={rows.map(([label, value]) => `${label}: ${value}`).join(', ') + '. Unit: count.'}>
      <div className="chart-axis" aria-hidden="true"><span>DECLARATIONS</span><div className="axis-ticks">{ticks.map(value => <span key={value} style={{ left: `${value / max * 100}%` }}>{value}</span>)}</div><span>count</span></div>
      {rows.map(([label, value], index) => <div className="metric-row" key={label}><span>{label}</span><div className="metric-track"><div className={`metric-bar metric-tone-${index}`} style={{ width: `${value / max * 100}%` }}/>{ticks.map(tick => <i className="metric-gridline" key={tick} style={{ left: `${tick / max * 100}%` }}/>)}</div><strong>{value}</strong></div>)}
    </div>
    <details><summary>Source & method <span aria-hidden="true">↗</span></summary><p>{sampleReport.method}</p><p>Not a security audit. This sample is not deployed and is not the payment recipient.</p><code>{sampleReport.source.sha256}</code></details>
  </div>;
}
