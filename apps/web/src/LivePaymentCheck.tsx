import type { PurchaseResult } from '../../../shared/contracts.ts';
import { TEST_USDC } from '../../../shared/contracts.ts';
import { displayAmount, executionUnknown } from './api.ts';
import { PaymentCheck } from './PaymentCheck.tsx';
import './payment-check.css';
interface Props {
  result: PurchaseResult | null; uncertain: boolean; requestId: string; busy: string; error: string;
  serviceReady: boolean; canCheck: boolean; checked: boolean; paymentDisabled: boolean;
  onQuote: () => void; onCheck: () => void; onQuery: () => void;
  onRequest: () => void; onServices: () => void; onScenario: () => void; onDetails: () => void;
}
const sourceLabel = (source?: string) => source === 'live' ? 'Live provider evidence' : source === 'fixture' ? 'Fixture evidence · Not live' : 'Evidence unavailable';
export function LivePaymentCheck(props: Props) {
  const { result, uncertain, requestId, busy, error, serviceReady, canCheck, checked, paymentDisabled, onQuote, onCheck, onQuery } = props;
  const terms = result?.terms; const risk = result?.risk; const execution = result?.execution;
  const unknown = uncertain || executionUnknown(result);
  const evidence = execution?.evidence;
  const source = evidence?.source ?? risk?.source;
  const amount = terms ? terms.asset.toLowerCase() === TEST_USDC.toLowerCase() ? `${displayAmount(terms.amount)} test USDC` : `${terms.amount} atomic · Unsupported asset` : 'Awaiting quote';
  const recipient = terms?.payTo;
  const shortRecipient = recipient?.startsWith('0x') ? `${recipient.slice(0, 6)}…${recipient.slice(-4)}` : recipient;
  const decision = execution?.decision ?? result?.decision;
  const title = unknown ? 'Status unknown' : busy ? 'Checking…' : !result ? 'Get a quote first' : decision === 'deny' ? 'Stopped by backend policy' : execution ? decision === 'allow' ? 'Policy permits · Not proof of payment' : 'Paused by backend policy' : checked || risk?.scan ? 'Check returned · Execution unreported' : 'Quote received';
  const reasons = execution?.reasons ?? result?.reasons ?? [];
  return <section className="payment-check live-payment-check" aria-label="Current order payment check" aria-busy={!!busy}>
    <p className="payment-purpose">Check the payment recipient before paying for a Contract Report.</p>
    <div className="check-source"><span>{unknown ? 'Last response · Current status unconfirmed' : 'Current order'} · {sourceLabel(source)}</span></div>
    <div className="single-payment-card">
      <div className="order-heading"><div><span className="order-kind">CONTRACT INSIGHTS · STRUCTURE REPORT</span><h2>Contract Report</h2></div><strong className="order-price">{amount}</strong></div>
      <div className="recipient-line"><span>Recipient</span><code title={recipient}>{shortRecipient ?? 'Awaiting quote'}</code></div>
      <p className="payment-scope">Payment network: {terms?.network ?? 'Awaiting quote'}. Check risk targets this quoted recipient; the report analyzes a separate bundled Solidity sample.</p>
      <div className="check-action">
        {!requestId ? <button className="primary" disabled={!!busy || !serviceReady || unknown} onClick={onQuote}>Get quote <span aria-hidden="true">→</span></button> : <button className="primary" disabled={!!busy || !canCheck} onClick={onCheck}>{busy === 'pay' ? 'Checking…' : 'Check risk'} <span aria-hidden="true">→</span></button>}
        <p>{paymentDisabled ? 'Payment disabled · Check risk may contact the risk provider once.' : 'Check unavailable · Payment-disabled runtime is not confirmed.'}</p>
      </div>
      {!serviceReady && <p className="payment-scope">Contract Insights service not ready. Open Details to check the connection.</p>}
      {requestId && <div className="request-actions"><button disabled={!!busy} onClick={onQuery}>Query request</button></div>}
      <div className={`check-result ${unknown ? 'result-pause' : decision === 'deny' ? 'result-block' : 'result-pending'}`} aria-live="polite">
        <span className="result-label">{unknown ? 'UNCONFIRMED' : 'BACKEND RESULT'}</span><h3>{title}</h3>
        {unknown ? <p>The latest state is unconfirmed. Query this same request; do not start another payment.</p> : reasons.length ? <ul className="reason-list">{reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul> : <p>Get a quote, review its recipient and network, then explicitly check risk. No check runs on page load.</p>}
        {error && <p role="alert">{error}</p>}
        {!unknown && execution?.decision === 'allow' && <p>A policy decision does not prove signing, settlement or delivery.</p>}
      </div>
      <dl className="live-evidence">
        <div><dt>Evidence source</dt><dd>{sourceLabel(source)}</dd></div>
        <div><dt>Checked address</dt><dd><code>{evidence ? evidence.address ?? 'Not reported' : risk?.address ?? 'Not reported'}</code></dd></div>
        <div><dt>Checked at</dt><dd>{evidence ? evidence.checkedAt ?? 'Not reported' : risk?.checkedAt ?? 'Not reported'}</dd></div>
        <div><dt>Requested network</dt><dd>{evidence?.requestedPaymentNetwork ?? risk?.scan?.requestedNetwork ?? 'Not reported'}</dd></div>
        <div><dt>Provider evidence network</dt><dd>{evidence?.providerEvidenceNetwork ?? 'Not reported · No cross-network coverage assumed'}</dd></div>
        <div><dt>Coverage / meaning</dt><dd>{evidence ? `${evidence.coverage} / ${evidence.semantics}` : 'Unverified / Unverified'}</dd></div>
        {risk?.scan && <div><dt>Scan receipt</dt><dd>{risk.scan.transport} {risk.scan.toxicScore !== undefined && `· Raw score ${risk.scan.toxicScore} (uninterpreted)`}</dd></div>}
      </dl>
      <div className="payment-status">
        <span>Signature: <strong>{unknown ? 'Unknown' : execution?.signing ?? 'Unreported'}</strong></span>
        <span>Submission: <strong>{unknown ? 'Unknown' : execution?.submission ?? 'Unreported'}</strong></span>
        <span>Settlement: <strong>{unknown ? 'Unknown' : execution?.settlement ?? 'Unreported'}</strong></span>
      </div>
      <p className="payment-scope">{unknown ? 'Delivery unconfirmed.' : result?.data !== undefined ? 'Response data received; report delivery validation is not connected. Completion is unconfirmed.' : 'No validated purchased report received.'} Signing counters and a transaction string are not settlement proof.</p>
      {execution && <p className="payment-scope">Backend completion claim: {unknown ? 'Unconfirmed' : execution.taskComplete ? 'Reported; delivery still requires validation' : 'Not complete'}. Automatic payment retry is disabled.</p>}
    </div>
    <details className="payment-details"><summary>Details</summary>
      <p className="payment-scope">Request: <code>{requestId || 'Not created'}</code></p>
      {execution && <dl><div><dt>Operation</dt><dd><code>{execution.operationId}</code></dd></div><div><dt>Checked quote digest</dt><dd><code>{execution.checkedQuoteHash ?? 'Not reported'}</code></dd></div><div><dt>Signing input digest</dt><dd><code>{execution.signingInputHash ?? 'Not reported'}</code></dd></div></dl>}
      <div className="archived-views"><button className="text-button" onClick={props.onRequest}>Saved request</button><button className="text-button" onClick={props.onServices}>Report offer</button><button className="text-button" onClick={props.onDetails}>Technical details</button></div>
      <details className="offline-examples"><summary>Offline examples · No API calls</summary><PaymentCheck result={null} uncertain={false} onRequest={props.onRequest} onServices={props.onServices} onScenario={props.onScenario} onDetails={props.onDetails}/></details>
    </details>
    <p className="payment-footnote">Manual request · No application LLM · No payment action enabled</p>
  </section>;
}
