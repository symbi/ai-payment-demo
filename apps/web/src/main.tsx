import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC, type PurchaseResult } from '../../../shared/contracts.ts';
import type { BuyerHealth } from '../../buyer/src/service.ts';
import { api, displayAmount, isHealth, isPurchase, executionUnknown } from './api.ts';
import { LivePaymentCheck } from './LivePaymentCheck.tsx';
import { ScenarioDemo } from './ScenarioDemo.tsx';
import { SamplePreview } from './SamplePreview.tsx';
import { readBuyerRequestSession, saveBuyerRequestSession } from './buyer-request-session.ts';
import './style.css';

// Access to the localStorage property itself can throw. Keep it inside the helper's try/catch.
const requestStorage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};
const labels: Record<PurchaseResult['status'], string> = { quoted: 'Quote received', denied: 'Declined', held: 'Review required', paid: 'Payment reported', settlement_unknown: 'Status unknown', error: 'Request error' };
function App() {
  const [initialSession] = useState(() => readBuyerRequestSession(requestStorage));
  const [view, setView] = useState<'services' | 'detail' | 'request' | 'scenario' | 'payment'>('payment');
  const [health, setHealth] = useState<BuyerHealth | null>(null);
  const [healthError, setHealthError] = useState('');
  const [healthBusy, setHealthBusy] = useState(false);
  const healthLock = useRef(false);
  const [requestId, setRequestId] = useState(initialSession.state === 'saved' ? initialSession.session.requestId : '');
  const currentRequest = useRef(requestId);
  const recoveryStarted = useRef(false);
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const [error, setError] = useState(initialSession.state === 'unavailable' ? 'Saved request identity is unavailable. Status unknown; new requests are blocked.' : '');
  const [uncertain, setUncertain] = useState(initialSession.state !== 'empty');
  const [busy, setBusy] = useState('');
  const [rechecked, setRechecked] = useState(false);
  const [recheckAttempted, setRecheckAttempted] = useState(initialSession.state === 'saved' && initialSession.session.checkAttempted);
  const checkAttempted = useRef(recheckAttempted);
  const actionLock = useRef(false);
  const executionSeen = useRef(false);
  const details = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const serviceReady = health?.resourcePath === '/api/contract-insights' && RESOURCE_PATH === '/api/contract-insights';
  function navigate(next: typeof view) { setView(next); requestAnimationFrame(() => heading.current?.focus()); }
  async function refreshHealth() {
    if (healthLock.current) return;
    healthLock.current = true; setHealthBusy(true);
    try { setHealth(await api('/api/health', isHealth)); setHealthError(''); }
    catch (err) { setHealth(null); setHealthError(err instanceof Error ? err.message : 'Connection unavailable.'); }
    finally { healthLock.current = false; setHealthBusy(false); }
  }
  useEffect(() => { void refreshHealth(); }, []);
  function confirmStoredIdentity(id: string) {
    const stored = readBuyerRequestSession(requestStorage);
    if (!id && stored.state === 'empty') return;
    if (stored.state !== 'saved' || stored.session.requestId !== id) {
      throw new Error('Saved request identity is unavailable or changed. Status unknown; new requests are blocked.');
    }
    if (stored.session.checkAttempted) { checkAttempted.current = true; setRecheckAttempted(true); }
  }
  async function action(kind: 'inspect' | 'pay' | 'get') {
    if (actionLock.current || (kind === 'inspect' && (!serviceReady || uncertain || executionUnknown(result)))) return;
    if (kind === 'inspect' && requestId && result?.requestId !== requestId) return;
    if (kind === 'pay' && (!canCheck || checkAttempted.current || health?.paymentEnabled !== false || result?.paymentEnabled !== false)) return;
    if (kind === 'get' && !requestId) return;
    actionLock.current = true; setBusy(kind); setError('');
    let id = requestId;
    try {
      // Never overwrite another tab's session, or a missing/corrupt current identity.
      confirmStoredIdentity(id);
      if (kind === 'inspect') {
        id = crypto.randomUUID();
        const saved = saveBuyerRequestSession(requestStorage, { version: 1, requestId: id, checkAttempted: false });
        currentRequest.current = id; setRequestId(id); setResult(null); setUncertain(true);
        executionSeen.current = false; setRechecked(false); checkAttempted.current = false; setRecheckAttempted(false);
        if (view !== 'payment') navigate('request');
        if (!saved) throw new Error('Request identity could not be saved and verified. No quote was sent. Status unknown.');
      }
      if (kind === 'pay') {
        if (checkAttempted.current) throw new Error('A check was already attempted for this request. Refresh status; do not repeat the check.');
        checkAttempted.current = true; setRecheckAttempted(true);
        if (!saveBuyerRequestSession(requestStorage, { version: 1, requestId: id, checkAttempted: true })) {
          throw new Error('Check attempt could not be saved and verified. No check was sent. Status unknown.');
        }
      }
      const next = await api(kind === 'get' ? `/api/requests/${encodeURIComponent(id)}` : `/api/${kind}`, isPurchase, kind === 'get' ? undefined : kind === 'inspect' ? { requestId: id, prompt: 'Contract Insights' } : { requestId: id });
      if (currentRequest.current !== id) return;
      if (next.requestId !== id) throw new Error('Request identity mismatch. Query this request to confirm.');
      confirmStoredIdentity(id);
      // A legacy response cannot resolve previously reported execution facts.
      const executionMissing = executionSeen.current && !next.execution;
      if (next.execution) executionSeen.current = true;
      setResult(next); setUncertain(executionUnknown(next) || executionMissing);
      if (kind === 'pay') setRechecked(true);
      void refreshHealth();
    } catch (err) { if (currentRequest.current === id) { setError(err instanceof Error ? err.message : 'Result unavailable.'); setUncertain(true); } }
    finally { actionLock.current = false; setBusy(''); }
  }
  useEffect(() => {
    if (recoveryStarted.current) return;
    recoveryStarted.current = true;
    // StrictMode effect replay must never quote/check again. Recovery is one GET only.
    if (initialSession.state === 'saved') void action('get');
  }, []);
  const terms = result?.terms;
  const expectedAsset = terms?.asset.toLowerCase() === TEST_USDC.toLowerCase();
  const blocked = uncertain || executionUnknown(result);
  const canCheck = serviceReady && !!requestId && result?.requestId === requestId && terms?.scheme === 'exact' && terms.network === TEST_NETWORK && terms.asset.toLowerCase() === TEST_USDC.toLowerCase() && terms.amount === '1000' && /^0x[0-9a-fA-F]{40}$/.test(terms.payTo) && result?.status === 'held' && !blocked && !recheckAttempted && !result.execution && health?.paymentEnabled === false && result.paymentEnabled === false;
  const scan = result?.risk?.scan;
  const title = busy ? 'Checking…' : blocked ? 'Status unknown' : scan?.transport === 'received' ? 'Scan received' : recheckAttempted ? 'Review required' : result?.status === 'held' && terms ? 'Ready to check' : result ? labels[result.status] : 'Waiting for quote';
  const explanation = blocked ? 'Query this request before starting another.' : scan?.transport === 'received' ? 'Risk meaning and network coverage are unverified.' : recheckAttempted ? 'Check details for the latest result.' : 'Check the payment recipient before continuing.';
  const quoteButton = <button className="primary" disabled={!!busy || blocked || !serviceReady} onClick={() => void action('inspect')}>Get quote <span aria-hidden="true">↗</span></button>;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    {view !== 'payment' && <aside className="sidebar legacy-sidebar"><div className="brand"><span className="brand-mark" aria-hidden="true"><i/><i/><i/></span>Gate</div><nav aria-label="Main navigation"><button onClick={() => navigate('payment')}>Agent 受控付款</button><button aria-current={view === 'request' ? 'page' : undefined} onClick={() => navigate('request')}>Request {requestId && <span className="nav-count">1</span>}</button><details className="secondary-navigation"><summary>More</summary><button aria-current={view === 'services' || view === 'detail' ? 'page' : undefined} onClick={() => navigate('services')}>Services</button><button aria-current={view === 'scenario' ? 'page' : undefined} onClick={() => navigate('scenario')}>Scenario demo</button></details></nav><div className="sidebar-foot"><span className="small-dot"/>{view === 'scenario' ? 'Demo credits' : 'Testnet'}</div></aside>}
    <main id="main-content" className={view === 'payment' ? 'payment-main' : undefined}><header className="topbar"><span>{view === 'payment' ? 'Agent 受控付款' : 'Workspace'} <span className="slash">/</span> {view === 'payment' ? 'Payment check' : view === 'scenario' ? 'Scenario demo' : view === 'request' ? 'Request' : 'Services'}</span>{view !== 'payment' && <button className="technical-entry" onClick={() => details.current?.showModal()}>Details ↗</button>}</header>
      <div className="page-heading report-page-heading"><h1 ref={heading} tabIndex={-1}>{view === 'payment' ? 'Agent 受控付款' : view === 'scenario' ? 'From brief to draft' : view === 'services' ? 'Reports' : view === 'detail' ? 'Sample Report' : 'Review your request'}</h1></div>
      {view === 'payment' ? <LivePaymentCheck result={result} uncertain={uncertain} requestId={requestId} busy={busy} error={error} serviceReady={serviceReady} canCheck={canCheck} checked={rechecked} paymentDisabled={health?.paymentEnabled === false && (!result || result.paymentEnabled === false)} onQuote={() => void action('inspect')} onCheck={() => void action('pay')} onQuery={() => void action('get')} onRequest={() => navigate('request')} onServices={() => navigate('services')} onScenario={() => navigate('scenario')} onDetails={() => details.current?.showModal()}/> : view === 'scenario' ? <ScenarioDemo/> : view === 'services' ? <><section className="service-card report-offer" aria-labelledby="service-title"><div className="service-copy"><h2 id="service-title">Contract Report</h2><div className="budget product-price"><span>Budget</span><strong>0.001 <small>test USDC</small></strong></div><div className="product-actions">{quoteButton}<button onClick={() => navigate('detail')}>Preview report</button></div>{!serviceReady && <p className="detail-note">{healthBusy ? 'Connecting…' : 'Service updating'}</p>}</div><div className="report-cover-wrap"><div className="report-cover" aria-label="Sample contract report cover"><div className="report-cover-top"><span>GATE / REPORTS</span><span className="cover-sample">SAMPLE</span></div><div className="report-cover-title">Contract<br/>Report<span className="cover-rule"/></div><div className="report-cover-lines" aria-hidden="true"><i/><i/><i/></div><div className="report-cover-foot"><span>Solidity structure</span><span>01</span></div></div></div></section>{blocked && <div className="pending-note"><p>One request needs confirmation.</p><button className="text-button" onClick={() => navigate('request')}>View request →</button></div>}</> : view === 'detail' ? <section className="service-detail report-document" aria-label="Sample report preview"><div className="report-toolbar"><button className="text-button" onClick={() => navigate('services')}>← View offer</button><span className="preview-watermark">Sample · Not purchased</span></div><SamplePreview/>{requestId && <div className="preview-actions"><button onClick={() => navigate('request')}>View request</button></div>}</section> : !requestId ? <section className="empty-state"><h2>{blocked ? 'Status unknown' : 'No request yet'}</h2><p>{blocked ? 'Saved request identity is unavailable. New requests are blocked.' : 'Choose a service to get a quote.'}</p><button className="primary" onClick={() => navigate('services')}>Browse services →</button></section> : <section className="request-card" aria-label="Current request" aria-busy={!!busy}>
        <div className="request-card-head"><div className="service-mini"><div><h2>Contract Report</h2><p>Testnet</p></div></div><span className="state-pill">{blocked ? 'Status unknown' : result ? labels[result.status] : 'Waiting'}</span></div>
        <section className="fee-confirmation"><div className="fee-grid"><dl><Row label="Delivery">Structure report · JSON</Row><Row label="Network">{terms ? terms.network === TEST_NETWORK ? 'Base Sepolia' : terms.network : 'Pending'}</Row><Row label="Payment">Unavailable</Row></dl><div className="fee-total"><p>{blocked || recheckAttempted ? 'Last quote' : 'Quote'}</p><strong className="quote-price">{terms ? expectedAsset ? displayAmount(terms.amount) : terms.amount : '—'}</strong><span>{terms ? expectedAsset ? 'test USDC' : 'atomic units · unsupported asset' : 'Awaiting quote'}</span></div></div><div className="confirm-actions"><button className="primary" disabled={!!busy || !canCheck} onClick={() => void action('pay')}>{rechecked ? 'Checked' : recheckAttempted ? 'Check attempted' : 'Check'}</button><button disabled>Buy</button></div><p className="detail-note">Check does not pay.</p></section>
        <div className="request-body"><div className="request-story"><h3 aria-live="polite">{title}</h3><p>{explanation}</p>{error && <p role="alert" className="error-message">Latest result unconfirmed. See details.</p>}<div className="request-actions"><button disabled={!!busy} onClick={() => void action('get')}>Query request</button></div><button className="text-button" onClick={() => details.current?.showModal()}>View details →</button></div><aside className="quote-summary"><h3>Delivery</h3><p className="detail-note">No purchased report displayed.</p><hr/><button className="text-button" onClick={() => navigate('detail')}>Sample preview →</button></aside></div>
      </section>}<footer>{view === 'scenario' ? 'Local examples · Demo credits only' : 'Local demo · Test tokens only'}</footer>
    </main>
    <dialog ref={details} className="details-drawer" aria-labelledby="details-title" onClick={e => { if (e.target === e.currentTarget) details.current?.close(); }}><div className="drawer-inner"><div className="drawer-head"><h2 id="details-title">Details</h2><button aria-label="Close details" onClick={() => details.current?.close()}>×</button></div><section><div className="section-heading"><h3>Connection</h3><button className="text-button" disabled={healthBusy} onClick={() => void refreshHealth()}>Refresh</button></div><dl><Row label="Buyer">{health?.buyer.connected ? 'Connected' : 'Unconfirmed'}</Row><Row label="Service">{serviceReady ? 'Contract Insights' : 'Updating / unconfirmed'}</Row><Row label="Seller">{health?.seller.connected ? health.seller.ready ? 'Ready' : 'Not ready' : 'Unconfirmed'}</Row><Row label="Scan key">{health ? health.configuration.interceptaKeyConfigured ? 'Configured' : 'Unavailable' : 'Unconfirmed'}</Row><Row label="Payment">Disabled</Row></dl>{healthError && <p role="alert" className="error-message">{healthError}</p>}</section><section><h3>Request</h3>{!requestId ? <p className="detail-note">{blocked ? 'Saved request identity is unavailable. Status unknown; new requests are blocked.' : 'No request. The service card shows a budget.'}</p> : <><dl><Row label="ID"><code>{requestId}</code></Row><Row label="Status">{blocked ? 'Unknown — query to confirm' : result ? labels[result.status] : 'Pending'}</Row><Row label="Decision">{result?.decision ?? 'Pending'}</Row></dl>{error && <p role="alert" className="error-message">{error}</p>}{blocked && <p className="detail-note">No automatic retry. Records below are the last response; memory records may be lost after a restart.</p>}{result && <><ul className="reason-list">{result.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>{terms && <dl><Row label="Amount">{terms.amount} atomic</Row><Row label="Scheme">{terms.scheme}</Row><Row label="Network">{terms.network}</Row><Row label="Recipient"><code>{terms.payTo}</code></Row><Row label="Asset"><code>{terms.asset}</code></Row></dl>}<dl><Row label="Risk source">{result.risk?.source ?? 'Unavailable'}</Row><Row label="Scan transport">{scan?.transport ?? 'Not recorded'}</Row>{scan && <><Row label="Coverage">{scan.coverage}</Row><Row label="Meaning">{scan.semantics}</Row><Row label="Requested network">{scan.requestedNetwork}</Row></>}{scan?.toxicScore !== undefined && <Row label="Raw score">{scan.toxicScore} · uninterpreted</Row>}{scan?.traitsCount !== undefined && <Row label="Traits count">{scan.traitsCount}</Row>}{result.risk && <><Row label="Scan address"><code>{result.risk.address}</code></Row><Row label="Checked at">{result.risk.checkedAt}</Row></>}<Row label="Sign calls">{result.counters.sign}</Row><Row label="Settle calls">{result.counters.settle}</Row></dl><p className="detail-note">Server counters are not chain confirmation. Scan receipt does not establish safety.</p><details className="events"><summary>Events · {result.events.length}</summary><ol>{result.events.map((e, i) => <li key={i}><time>{e.at}</time>{e.step} · {e.message}</li>)}</ol></details></>}</>}</section></div></dialog>
  </div>;
}
function Row({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
createRoot(document.getElementById('root')!).render(<App/>);
