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
// Project only declared public fields, including every nested object.
const publicFields = (value: object | undefined, keys: string[]) => value ? Object.fromEntries(keys.map(key => [key, (value as Record<string, unknown>)[key]])) : undefined;
const responseFacts = (result: PurchaseResult) => ({
  ...publicFields(result, ['requestId', 'status', 'decision', 'reasons']),
  terms: publicFields(result.terms, ['scheme', 'network', 'asset', 'amount', 'payTo']),
  risk: result.risk ? { ...publicFields(result.risk, ['decision', 'source', 'reasons', 'address', 'checkedAt', 'provider']), scan: publicFields(result.risk.scan, ['transport', 'toxicScore', 'traitsCount', 'requestedNetwork', 'coverage', 'semantics']) } : undefined,
  execution: result.execution ? { ...publicFields(result.execution, ['operationId', 'decision', 'reasonCodes', 'reasons', 'checkedQuoteHash', 'signingInputHash', 'signing', 'submission', 'settlement', 'retryAllowed', 'taskComplete']), evidence: publicFields(result.execution.evidence, ['source', 'evidenceId', 'address', 'checkedAt', 'requestedPaymentNetwork', 'providerEvidenceNetwork', 'coverage', 'semantics']) } : undefined,
});
const executionLabel = (value?: string) => ({ not_signed: 'Not signed', signed: 'Signed', not_submitted: 'Not submitted', submitted: 'Submitted', not_settled: 'Not settled', settled: 'Settled', failed: 'Failed', unknown: 'Unknown' }[value ?? ''] ?? 'Unknown · Not reported');
const sourceLabel = (source?: string) => source === 'live' ? 'Live provider evidence' : source === 'fixture' ? 'Fixture evidence · Not live' : 'Unknown · No risk evidence';
export function LivePaymentCheck(props: Props) {
  const { result, uncertain, requestId, busy, error, serviceReady, canCheck, checked, paymentDisabled, onQuote, onCheck, onQuery } = props;
  const terms = result?.terms; const risk = result?.risk; const execution = result?.execution;
  const unknown = uncertain || executionUnknown(result);
  const evidence = execution?.evidence;
  const source = evidence?.source ?? risk?.source;
  const amount = terms ? terms.asset.toLowerCase() === TEST_USDC.toLowerCase() ? `${displayAmount(terms.amount)} test USDC` : `${terms.amount} atomic · Unsupported asset` : 'Awaiting quote';
  const recipient = terms?.payTo;
  const shortRecipient = recipient;
  const decision = execution?.decision ?? result?.decision;
  const title = unknown ? 'Status unknown' : busy ? 'Checking…' : !result ? 'Get a quote first' : decision === 'deny' ? 'Stopped by backend policy' : execution ? decision === 'allow' ? 'Policy permits · Not proof of payment' : 'Paused by backend policy' : checked || risk?.scan ? 'Check received · Payment status unknown' : 'Quote received';
  const reasons = execution?.reasons ?? result?.reasons ?? [];
  return <section className="payment-check live-payment-check" aria-label="Current order payment check" aria-busy={!!busy}>
    <p className="payment-purpose">Buy a structure report of the bundled sample contract.</p>
    <div className="check-source"><span>{unknown ? 'Last response · Current status unconfirmed' : 'Current order'} · {sourceLabel(source)}</span></div>
    <div className="single-payment-card">
      <div className="order-heading"><div><span className="order-kind">1 · TASK</span><h2>Sample contract structure report</h2></div><strong className="order-price">{amount}</strong></div>
      <div className="recipient-line"><span>Recipient</span><code title={recipient}>{shortRecipient ?? 'Awaiting quote'}</code></div>
      <p className="payment-scope">Network: {terms?.network ?? 'Awaiting quote'}. Risk check: recipient. Not a contract audit.</p>
      <h2 className="flow-section-title">2 · Payment decision</h2>
      <div className="check-action">
        {!requestId ? <button className="primary" disabled={!!busy || !serviceReady || unknown} onClick={onQuote}>Get quote <span aria-hidden="true">→</span></button> : <button className="primary" disabled={!!busy || !canCheck} onClick={onCheck}>{busy === 'pay' ? 'Checking…' : 'Check risk'} <span aria-hidden="true">→</span></button>}
        <p>{paymentDisabled ? 'Explicit check · May contact Intercepta once.' : 'Check unavailable · Runtime mode unconfirmed.'}</p>
      </div>
      {!serviceReady && <p className="payment-scope">Service not ready. See Details.</p>}
      <div className={`check-result ${unknown ? 'result-pause' : decision === 'deny' ? 'result-block' : 'result-pending'}`} aria-live="polite">
        <span className="result-label">{unknown ? 'UNCONFIRMED' : 'BACKEND RESULT'}</span><h3>{title}</h3>
        {unknown ? <p>Refresh this order to confirm. Do not start another payment.</p> : reasons.length ? <ul className="reason-list">{reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul> : <p>Review the quote, then check the recipient.</p>}
        {error && <p role="alert">{error}</p>}
        {!unknown && execution?.decision === 'allow' && <p>Permission is not payment confirmation.</p>}
      </div>
      <div className="payment-limitations"><p>{paymentDisabled ? 'Payment is disabled.' : 'Payment mode is unconfirmed. Checking is unavailable.'}</p><p>{!source || source === 'unavailable' ? 'Risk: Unknown. No usable evidence.' : `${source === 'fixture' ? 'Fixture evidence only. ' : ''}${evidence?.semantics === 'verified' ? '' : 'Risk meaning is unconfirmed. '}${evidence?.coverage === 'verified' ? '' : 'Network coverage is unconfirmed.'}`}</p></div>
      <h2 className="flow-section-title">3 · Execution</h2>
      <div className="payment-status">
        <span>Signature: <strong>{unknown ? 'Unknown' : executionLabel(execution?.signing)}</strong></span>
        <span>Submission: <strong>{unknown ? 'Unknown' : executionLabel(execution?.submission)}</strong></span>
        <span>Settlement: <strong>{unknown ? 'Unknown' : executionLabel(execution?.settlement)}</strong></span>
      </div>
      {requestId && <button className="text-button refresh-order" disabled={!!busy} onClick={onQuery}>Refresh status</button>}
      <h2 className="flow-section-title">4 · Result &amp; evidence</h2>
      <p className="delivery-result">{unknown ? 'Delivery unknown.' : result?.data !== undefined ? 'Data received · Delivery not verified. Completion is unconfirmed.' : 'No verified report delivered.'}</p>
      <dl className="live-evidence">
        <div><dt>Evidence source</dt><dd>{sourceLabel(source)}</dd></div>
        <div><dt>Checked address</dt><dd><code>{evidence ? evidence.address ?? 'Not reported' : risk?.address ?? 'Not reported'}</code></dd></div>
        <div><dt>Checked at</dt><dd>{evidence ? evidence.checkedAt ?? 'Not reported' : risk?.checkedAt ?? 'Not reported'}</dd></div>
        <div><dt>Requested network</dt><dd>{evidence?.requestedPaymentNetwork ?? risk?.scan?.requestedNetwork ?? 'Not reported'}</dd></div>
        <div><dt>Provider evidence network</dt><dd>{evidence?.providerEvidenceNetwork ?? 'Not reported · No cross-network coverage assumed'}</dd></div>
        <div><dt>Coverage / meaning</dt><dd>{evidence ? `${evidence.coverage} / ${evidence.semantics}` : 'Unverified / Unverified'}</dd></div>
        {risk?.scan && <div><dt>Scan receipt</dt><dd>{risk.scan.transport} {risk.scan.toxicScore !== undefined && `· Raw score ${risk.scan.toxicScore} (uninterpreted)`}</dd></div>}
      </dl>
    </div>
    <details className="payment-details"><summary>Details</summary>
      <p className="payment-scope">Risk check targets the payment recipient; the report describes a separate bundled Solidity sample. Signing counters and transaction strings do not prove settlement. Report delivery validation is not connected. No automatic payment retry.</p>
      <p className="payment-scope">Request: <code>{requestId || 'Not created'}</code></p>
      {execution && <dl><div><dt>Operation</dt><dd><code>{execution.operationId}</code></dd></div><div><dt>Checked quote digest</dt><dd><code>{execution.checkedQuoteHash ?? 'Not reported'}</code></dd></div><div><dt>Signing input digest</dt><dd><code>{execution.signingInputHash ?? 'Not reported'}</code></dd></div></dl>}
      {execution && <p className="payment-scope">Backend completion claim: {unknown ? 'Unknown' : String(execution.taskComplete)} · Not validated delivery.</p>}
      {result && <details className="response-facts"><summary>Response facts</summary><pre>{JSON.stringify(responseFacts(result), null, 2)}</pre></details>}
      <div className="archived-views"><button className="text-button" onClick={props.onRequest}>Saved request</button><button className="text-button" onClick={props.onServices}>Report offer</button><button className="text-button" onClick={props.onDetails}>Technical details</button></div>
      <details className="offline-examples"><summary>Offline examples · No API calls</summary><PaymentCheck result={null} uncertain={false} onRequest={props.onRequest} onServices={props.onServices} onScenario={props.onScenario} onDetails={props.onDetails}/></details>
    </details>
    <p className="payment-footnote">Manual check · No autonomous agent or payment enabled</p>
  </section>;
}
