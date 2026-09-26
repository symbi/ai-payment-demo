import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC, type PurchaseResult } from '../../../shared/contracts.ts';
import type { BuyerHealth } from '../../buyer/src/service.ts';
import { api, displayAmount, isHealth, isPurchase } from './api.ts';
import { ScenarioDemo } from './ScenarioDemo.tsx';
import { SamplePreview } from './SamplePreview.tsx';
import './style.css';

const labels: Record<PurchaseResult['status'], string> = { quoted: 'Quote received', denied: 'Declined', held: 'Review required', paid: 'Payment reported', settlement_unknown: 'Status unknown', error: 'Request error' };
function App() {
  const [view, setView] = useState<'services' | 'detail' | 'request' | 'scenario'>('services');
  const [health, setHealth] = useState<BuyerHealth | null>(null);
  const [healthError, setHealthError] = useState('');
  const [healthBusy, setHealthBusy] = useState(false);
  const healthLock = useRef(false);
  const [requestId, setRequestId] = useState('');
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState('');
  const [rechecked, setRechecked] = useState(false);
  const [recheckAttempted, setRecheckAttempted] = useState(false);
  const actionLock = useRef(false);
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
  async function action(kind: 'inspect' | 'pay' | 'get') {
    if (actionLock.current || (kind === 'inspect' && (!serviceReady || uncertain || result?.status === 'settlement_unknown'))) return;
    actionLock.current = true; setBusy(kind); setError('');
    let id = requestId;
    try {
      if (kind === 'inspect') { id = crypto.randomUUID(); setRequestId(id); setResult(null); setRechecked(false); setRecheckAttempted(false); navigate('request'); }
      if (kind === 'pay') setRecheckAttempted(true);
      const next = await api(kind === 'get' ? `/api/requests/${encodeURIComponent(id)}` : `/api/${kind}`, isPurchase, kind === 'get' ? undefined : kind === 'inspect' ? { requestId: id, prompt: 'Contract Insights' } : { requestId: id });
      if (next.requestId !== id) throw new Error('Request identity mismatch. Query this request to confirm.');
      setResult(next); setUncertain(next.status === 'settlement_unknown');
      if (kind === 'pay') setRechecked(true);
      void refreshHealth();
    } catch (err) { setError(err instanceof Error ? err.message : 'Result unavailable.'); setUncertain(true); }
    finally { actionLock.current = false; setBusy(''); }
  }
  const terms = result?.terms;
  const expectedAsset = terms?.asset.toLowerCase() === TEST_USDC.toLowerCase();
  const blocked = uncertain || result?.status === 'settlement_unknown';
  const canCheck = !!terms && result?.status === 'held' && !blocked && !recheckAttempted;
  const scan = result?.risk?.scan;
  const title = busy ? 'Checking…' : blocked ? 'Status unknown' : scan?.transport === 'received' ? 'Scan received' : recheckAttempted ? 'Review required' : result?.status === 'held' && terms ? 'Ready to check' : result ? labels[result.status] : 'Waiting for quote';
  const explanation = blocked ? 'Query this request before starting another.' : scan?.transport === 'received' ? 'Risk meaning and network coverage are unverified.' : recheckAttempted ? 'Check details for the latest result.' : 'Check the payment recipient before continuing.';
  const quoteButton = <button className="primary" disabled={!!busy || blocked || !serviceReady} onClick={() => void action('inspect')}>Get quote <span aria-hidden="true">↗</span></button>;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar"><div className="brand"><span className="brand-mark" aria-hidden="true"><i/><i/><i/></span>Gate</div><nav aria-label="Main navigation"><button aria-current={view === 'scenario' ? 'page' : undefined} onClick={() => navigate('scenario')}>Scenario demo</button><button aria-current={view === 'services' || view === 'detail' ? 'page' : undefined} onClick={() => navigate('services')}>Services</button><button aria-current={view === 'request' ? 'page' : undefined} onClick={() => navigate('request')}>Request {requestId && <span className="nav-count">1</span>}</button></nav><div className="sidebar-foot"><span className="small-dot"/>{view === 'scenario' ? 'Demo credits' : 'Testnet'}</div></aside>
    <main id="main-content"><header className="topbar"><span>Workspace <span className="slash">/</span> {view === 'scenario' ? 'Scenario demo' : view === 'request' ? 'Request' : 'Services'}</span><button className="technical-entry" onClick={() => details.current?.showModal()}>Details ↗</button></header>
      <div className="page-heading report-page-heading"><h1 ref={heading} tabIndex={-1}>{view === 'scenario' ? 'From brief to draft' : view === 'services' ? 'Reports' : view === 'detail' ? 'Sample Report' : 'Review your request'}</h1></div>
      {view === 'scenario' ? <ScenarioDemo/> : view === 'services' ? <><section className="service-card report-offer" aria-labelledby="service-title"><div className="service-copy"><h2 id="service-title">Contract Report</h2><div className="budget product-price"><span>Budget</span><strong>0.001 <small>test USDC</small></strong></div><div className="product-actions">{quoteButton}<button onClick={() => navigate('detail')}>Preview report</button></div>{!serviceReady && <p className="detail-note">{healthBusy ? 'Connecting…' : 'Service updating'}</p>}</div><div className="report-cover-wrap"><div className="report-cover" aria-label="Sample contract report cover"><div className="report-cover-top"><span>GATE / REPORTS</span><span className="cover-sample">SAMPLE</span></div><div className="report-cover-title">Contract<br/>Report<span className="cover-rule"/></div><div className="report-cover-lines" aria-hidden="true"><i/><i/><i/></div><div className="report-cover-foot"><span>Solidity structure</span><span>01</span></div></div></div></section>{blocked && <div className="pending-note"><p>One request needs confirmation.</p><button className="text-button" onClick={() => navigate('request')}>View request →</button></div>}</> : view === 'detail' ? <section className="service-detail report-document" aria-label="Sample report preview"><div className="report-toolbar"><button className="text-button" onClick={() => navigate('services')}>← View offer</button><span className="preview-watermark">Sample · Not purchased</span></div><SamplePreview/>{requestId && <div className="preview-actions"><button onClick={() => navigate('request')}>View request</button></div>}</section> : !requestId ? <section className="empty-state"><h2>No request yet</h2><p>Choose a service to get a quote.</p><button className="primary" onClick={() => navigate('services')}>Browse services →</button></section> : <section className="request-card" aria-label="Current request" aria-busy={!!busy}>
        <div className="request-card-head"><div className="service-mini"><div><h2>Contract Report</h2><p>Testnet</p></div></div><span className="state-pill">{blocked ? 'Status unknown' : result ? labels[result.status] : 'Waiting'}</span></div>
        <section className="fee-confirmation"><div className="fee-grid"><dl><Row label="Delivery">Structure report · JSON</Row><Row label="Network">{terms ? terms.network === TEST_NETWORK ? 'Base Sepolia' : terms.network : 'Pending'}</Row><Row label="Payment">Unavailable</Row></dl><div className="fee-total"><p>{blocked || recheckAttempted ? 'Last quote' : 'Quote'}</p><strong className="quote-price">{terms ? expectedAsset ? displayAmount(terms.amount) : terms.amount : '—'}</strong><span>{terms ? expectedAsset ? 'test USDC' : 'atomic units · unsupported asset' : 'Awaiting quote'}</span></div></div><div className="confirm-actions"><button className="primary" disabled={!!busy || !canCheck} onClick={() => void action('pay')}>{rechecked ? 'Checked' : recheckAttempted ? 'Check attempted' : 'Check'}</button><button disabled>Buy</button></div><p className="detail-note">Check does not pay.</p></section>
        <div className="request-body"><div className="request-story"><h3 aria-live="polite">{title}</h3><p>{explanation}</p>{error && <p role="alert" className="error-message">Latest result unconfirmed. See details.</p>}<div className="request-actions"><button disabled={!!busy} onClick={() => void action('get')}>Query request</button></div><button className="text-button" onClick={() => details.current?.showModal()}>View details →</button></div><aside className="quote-summary"><h3>Delivery</h3><p className="detail-note">No purchased report displayed.</p><hr/><button className="text-button" onClick={() => navigate('detail')}>Sample preview →</button></aside></div>
      </section>}<footer>{view === 'scenario' ? 'Local examples · Demo credits only' : 'Local demo · Test tokens only'}</footer>
    </main>
    <dialog ref={details} className="details-drawer" aria-labelledby="details-title" onClick={e => { if (e.target === e.currentTarget) details.current?.close(); }}><div className="drawer-inner"><div className="drawer-head"><h2 id="details-title">Details</h2><button aria-label="Close details" onClick={() => details.current?.close()}>×</button></div><section><div className="section-heading"><h3>Connection</h3><button className="text-button" disabled={healthBusy} onClick={() => void refreshHealth()}>Refresh</button></div><dl><Row label="Buyer">{health?.buyer.connected ? 'Connected' : 'Unconfirmed'}</Row><Row label="Service">{serviceReady ? 'Contract Insights' : 'Updating / unconfirmed'}</Row><Row label="Seller">{health?.seller.connected ? health.seller.ready ? 'Ready' : 'Not ready' : 'Unconfirmed'}</Row><Row label="Scan key">{health ? health.configuration.interceptaKeyConfigured ? 'Configured' : 'Unavailable' : 'Unconfirmed'}</Row><Row label="Payment">Disabled</Row></dl>{healthError && <p role="alert" className="error-message">{healthError}</p>}</section><section><h3>Request</h3>{!requestId ? <p className="detail-note">No request. The service card shows a budget.</p> : <><dl><Row label="ID"><code>{requestId}</code></Row><Row label="Status">{blocked ? 'Unknown — query to confirm' : result ? labels[result.status] : 'Pending'}</Row><Row label="Decision">{result?.decision ?? 'Pending'}</Row></dl>{error && <p role="alert" className="error-message">{error}</p>}{blocked && <p className="detail-note">No automatic retry. Records below are the last response; memory records may be lost after a restart.</p>}{result && <><ul className="reason-list">{result.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>{terms && <dl><Row label="Amount">{terms.amount} atomic</Row><Row label="Scheme">{terms.scheme}</Row><Row label="Network">{terms.network}</Row><Row label="Recipient"><code>{terms.payTo}</code></Row><Row label="Asset"><code>{terms.asset}</code></Row></dl>}<dl><Row label="Risk source">{result.risk?.source ?? 'Unavailable'}</Row><Row label="Scan transport">{scan?.transport ?? 'Not recorded'}</Row>{scan && <><Row label="Coverage">{scan.coverage}</Row><Row label="Meaning">{scan.semantics}</Row><Row label="Requested network">{scan.requestedNetwork}</Row></>}{scan?.toxicScore !== undefined && <Row label="Raw score">{scan.toxicScore} · uninterpreted</Row>}{scan?.traitsCount !== undefined && <Row label="Traits count">{scan.traitsCount}</Row>}{result.risk && <><Row label="Scan address"><code>{result.risk.address}</code></Row><Row label="Checked at">{result.risk.checkedAt}</Row></>}<Row label="Sign calls">{result.counters.sign}</Row><Row label="Settle calls">{result.counters.settle}</Row></dl><p className="detail-note">Server counters are not chain confirmation. Scan receipt does not establish safety.</p><details className="events"><summary>Events · {result.events.length}</summary><ol>{result.events.map((e, i) => <li key={i}><time>{e.at}</time>{e.step} · {e.message}</li>)}</ol></details></>}</>}</section></div></dialog>
  </div>;
}
function Row({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }
createRoot(document.getElementById('root')!).render(<App/>);
