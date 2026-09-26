import { useState } from 'react';
import type { PurchaseResult } from '../../../shared/contracts.ts';
import { paymentCheckModel, type EvidenceView } from './payment-check.ts';
import './payment-check.css';
export function PaymentCheck({ result, uncertain, onRequest, onServices, onScenario, onDetails }: { result: PurchaseResult | null; uncertain: boolean; onRequest: () => void; onServices: () => void; onScenario: () => void; onDetails: () => void }) {
  const [view, setView] = useState<EvidenceView>('block');
  const [reviewed, setReviewed] = useState<{ view: EvidenceView; result: PurchaseResult | null; uncertain: boolean } | null>(null);
  const checked = reviewed?.view === view && reviewed.result === result && reviewed.uncertain === uncertain;
  const model = paymentCheckModel(view, result, uncertain);
  const recipient = model.payTo.startsWith('0x') ? `${model.payTo.slice(0, 6)}…${model.payTo.slice(-4)}` : model.payTo;
  return <section className="payment-check" aria-label="Intercepta payment check">
    <p className="payment-purpose">Check risk before paying.</p>
    <div className="check-source"><span>{model.source}</span><select aria-label="Evidence view" value={view} onChange={e => { setView(e.target.value as EvidenceView); setReviewed(null); }}><option value="block">Example: risk hit</option><option value="pause">Example: unavailable</option><option value="continue">Example: continue</option><option value="current">Existing request</option></select></div>
    <div className="single-payment-card">
      <div className="order-heading"><div><span className="order-kind">{model.offline ? 'EXAMPLE ORDER' : 'EXISTING ORDER'}</span><h2>Contract Report</h2></div><strong className="order-price">{model.amount}</strong></div>
      <div className="recipient-line"><span>{model.offline ? 'Example recipient' : 'Quoted recipient'}</span><code title={model.payTo}>{recipient}</code></div>
      <div className="check-action"><button className="primary" disabled={!model.offline && !result} onClick={() => setReviewed({ view, result, uncertain })}>Check risk <span aria-hidden="true">→</span></button><p>{model.offline ? 'Offline example · No API call' : 'Existing response only · No new scan'}</p></div>
      <div className={`check-result ${checked ? `result-${model.decision.toLowerCase()}` : 'result-pending'}`} aria-live="polite"><span className="result-label">{checked ? 'DECISION' : 'READY TO CHECK'}</span><h3>{checked ? model.decision : 'Not checked'}</h3><p>{checked ? model.reason : !model.offline && !result ? 'No existing order in this session.' : 'Review risk evidence before the proposed payment.'}</p>{checked && <span className="decision-only">{model.offline ? 'Decision only · No payment' : 'Display only · Payment disabled'}</span>}</div>
      <div className="payment-status"><span>Signature: <strong>{model.signature}</strong></span><span>Payment: <strong>{model.payment}</strong></span></div>
    </div>
    <details className="payment-details"><summary>Details</summary><p className="payment-scope">Agent flow illustration · No application LLM. The proposed action is to sign and submit one payment; this view does neither.</p><dl><div><dt>Full recipient</dt><dd><code>{model.payTo}</code></dd></div><div><dt>Intercepta target</dt><dd><code>{model.scanAddress}</code></dd></div><div><dt>Call status</dt><dd>{model.call}</dd></div><div><dt>Source</dt><dd>{model.source}</dd></div><div><dt>Evidence</dt><dd>{model.signal}</dd></div><div><dt>toxicScore</dt><dd>{model.score}</dd></div><div><dt>Traits count</dt><dd>{model.traits}</dd></div><div><dt>Network / coverage</dt><dd>{model.network} / {model.coverage}</dd></div></dl><div className="archived-views"><button className="text-button" onClick={onRequest}>Saved request</button><button className="text-button" onClick={onServices}>Report offer</button><button className="text-button" onClick={onScenario}>Archived example</button><button className="text-button" onClick={onDetails}>Technical details</button></div></details>
    <p className="payment-footnote">Illustration only · No application LLM · No payment action</p>
  </section>;
}
