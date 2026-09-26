import { describeSavedEvidence, EVIDENCE_GROUPS, TRAIT_RULE_REFERENCE } from './risk-evidence-display.ts';
import { PolicySandbox } from './PolicySandbox.tsx';
import { useState } from 'react';
import type { PrivateRiskPanelProps, PrivateScanRecord, PrivateScanStatus } from '../../../shared/private-risk.ts';
import { PRIVATE_RISK_CANDIDATES, privateCandidate } from '../../../shared/private-risk.ts';
import type { RiskResult } from '../../../shared/contracts.ts';
import { isSchemaDiagnostic } from '../../../shared/scan-diagnostic.ts';
import {
  evaluateLivePaymentPolicy,
  LIVE_PAYMENT_POLICY_NAME,
  LIVE_PAYMENT_POLICY_REVISION,
  type LivePaymentPolicyResult,
} from '../../../shared/live-payment-policy.ts';
import { PaymentDecisionReceiptDownload } from './PaymentDecisionReceiptDownload.tsx';
import { RiskReceiptDownload } from './RiskReceiptDownload.tsx';
import './private-risk.css';

function selectedRecord(status: PrivateScanStatus | null, candidateId: PrivateRiskPanelProps['selectedId']): PrivateScanRecord | undefined {
  return status?.records.find(record => record.candidateId === candidateId);
}

const diagnosticReasons = {
  'http-error': 'The scan service returned a non-success HTTP status. No usable evidence was saved.',
  'schema-unsupported': 'A response arrived, but its core schema is unsupported.',
  'body-invalid': 'The response body could not be read as supported JSON. Raw content is not shown.',
  timeout: 'The scan request timed out. No automatic retry was made.',
  'transport-error': 'The request transport failed. No usable evidence was saved.',
  configuration: 'Local scan configuration or address validation failed.',
  observed: 'Supported raw fields were extracted. Score meaning and network coverage remain unverified.',
};
const legacyReasons = new Map([
  ['Invalid scan address.', diagnosticReasons.configuration],
  ['API key unavailable.', diagnosticReasons.configuration],
  ['Scan service unavailable.', 'The saved record says the scan service was unavailable; no HTTP status was recorded.'],
  ['Unsupported scan response. Review required.', diagnosticReasons['schema-unsupported']],
  ['Scan timed out. No automatic retry.', diagnosticReasons.timeout],
  ['Scan unavailable. Review required.', 'The saved record says the scan was unavailable; no more specific category was recorded.'],
]);

function ScanDiagnostics({ risk }: { risk: RiskResult }) {
  const scan = risk.scan;
  const reason = scan?.diagnosticCode && Object.hasOwn(diagnosticReasons, scan.diagnosticCode)
    ? diagnosticReasons[scan.diagnosticCode]
    : risk.reasons.map(item => legacyReasons.get(item)).find(Boolean)
      ?? (risk.source === 'live' ? diagnosticReasons.observed : 'The legacy record contains no bounded diagnostic category.');
  const schema = isSchemaDiagnostic(scan?.schemaDiagnostic) ? scan.schemaDiagnostic : undefined;
  return <div className="private-risk-scan-diagnostics">
    <p><strong>Diagnostic</strong>: {reason}</p>
    <p className="private-risk-muted">txsCount is optional. Missing values remain missing; invalid values are not accepted.</p>
    <dl>
      <div><dt>HTTP status</dt><dd>{scan?.httpStatus ?? 'Not recorded'}</dd></div>
      <div><dt>Total observed traits</dt><dd>{scan?.traitsCount ?? 'Not recorded'}</dd></div>
      <div><dt>Unknown trait count</dt><dd>{scan?.unknownTraitsCount ?? 'Not recorded'}</dd></div>
      <div><dt>Ignored additional fields</dt><dd>{scan?.additionalFieldsCount ?? 'Not recorded'}</dd></div>
      <div><dt>Displayed known labels</dt><dd>{scan?.traitLabels?.length ?? 'Not recorded'}</dd></div>
      {schema && <>
        <div><dt>Known top-level fields</dt><dd>{schema.topLevelKeys.join(', ') || 'None observed'}</dd></div>
        <div><dt>Other top-level field count</dt><dd>{schema.otherKeysCount}</dd></div>
        <div><dt>toxicScore field type</dt><dd>{schema.toxicScoreType}</dd></div>
        <div><dt>traits field type</dt><dd>{schema.traitsType}</dd></div>
        {schema.traitsCount !== undefined && <div><dt>Response traits length</dt><dd>{schema.traitsCount}</dd></div>}
        {schema.traitDiagnostic && <>
          <div><dt>Inspected / total items</dt><dd>{schema.traitDiagnostic.inspectedItems} / {schema.traitDiagnostic.totalItems}</dd></div>
          <div><dt>Malformed items</dt><dd>{schema.traitDiagnostic.malformedItems}</dd></div>
          <div><dt>Known / unknown label items</dt><dd>{schema.traitDiagnostic.knownTraitItems} / {schema.traitDiagnostic.unknownTraitItems}</dd></div>
          <div><dt>Known items with missing / invalid risk</dt><dd>{schema.traitDiagnostic.missingRiskCount} / {schema.traitDiagnostic.invalidRiskTypeCount}</dd></div>
          <div><dt>Optional txsCount missing / invalid</dt><dd>{schema.traitDiagnostic.missingTxsCount} / {schema.traitDiagnostic.invalidTxsCountTypeCount}</dd></div>
          <div><dt>Description missing / invalid</dt><dd>{schema.traitDiagnostic.missingDescriptionCount} / {schema.traitDiagnostic.invalidDescriptionTypeCount}</dd></div>
        </>}
      </>}
    </dl>
    {schema && <p className="private-risk-muted">The schema summary contains bounded field types and counts only. Unknown names, free text and raw responses are not shown.</p>}
  </div>;
}

function usableLiveEvidence(record: PrivateScanRecord | undefined, loading: boolean) {
  const scan = record?.risk?.scan;
  return !loading && record?.state === 'completed' && record.risk?.source === 'live' &&
    scan?.transport === 'received' && scan.httpStatus === 200 &&
    typeof scan.toxicScore === 'number' && Number.isFinite(scan.toxicScore) &&
    typeof scan.traitsCount === 'number' && Array.isArray(scan.traitLabels) &&
    Object.hasOwn(scan, 'unknownTraitsCount');
}

function Evidence({ record, live, offlineFixture }: { record: PrivateScanRecord | undefined; live: boolean; offlineFixture: boolean }) {
  const scan = record?.risk?.scan;
  const evidence = describeSavedEvidence(record);
  return <>
    <div className="private-risk-evidence-head">
      <dl><div><dt>Source</dt><dd>{offlineFixture ? 'SIMULATED' : live ? 'LIVE' : 'Unavailable'}</dd></div></dl>
    </div>
    <section className="private-risk-factors" aria-label="Decision Factors">
      <h3>Decision Factors</h3>
      <p className="private-risk-factor-summary">{evidence.labels === null ? 'Unknown' : evidence.labels.length} displayed saved label entries · {evidence.uniqueLabels === null ? 'Unknown' : evidence.uniqueLabels.length} distinct recognized types</p>
      <div className="private-risk-traits" aria-label="Observed risk traits">
        {EVIDENCE_GROUPS.map(group => {
          const vocabulary = TRAIT_RULE_REFERENCE.filter(item => item.reason === group.reason);
          const observed = vocabulary.filter(item => evidence.uniqueLabels?.includes(item.label));
          return <div className="private-risk-factor-group" key={group.reason}>
            <h4>{group.title} <small>{vocabulary.length} types</small></h4>
            <div>{observed.length
              ? observed.map(item => <span className="private-risk-chip" key={item.label}>{item.label}</span>)
              : <p className="private-risk-muted">Not observed in saved evidence</p>}</div>
          </div>;
        })}
      </div>
      <p className="private-risk-factor-caveat">Not observed does not mean absent. These are rule categories; the actual decision also depends on evidence quality and amount.</p>
      <p className="private-risk-vocabulary">The parser recognizes {TRAIT_RULE_REFERENCE.length} label types. This is vocabulary size, not a checklist of passed checks.</p>
    </section>
    <section className="private-risk-quality" aria-label="Evidence Quality">
      <h3>Evidence Quality</h3>
      <dl>
        <div><dt>Availability</dt><dd>{evidence.available ? 'Available saved evidence' : 'Evidence unavailable'}</dd></div>
        <div><dt>Unknown trait entries</dt><dd>{evidence.unknownCount ?? 'Unknown'}</dd></div>
        <div><dt>Completeness</dt><dd>{evidence.completeness}</dd></div>
        <div><dt>Reported trait entries</dt><dd>{evidence.reportedEntries ?? 'Unknown'}</dd></div>
      </dl>
      <p className="private-risk-factor-caveat">Counts describe saved entries, not unique risk factors. Missing fields stay Unknown; unknown or truncated evidence is not a complete assessment.</p>
    </section>
    <div className="private-risk-raw-signal">
      <p>Raw provider signal — not used as a threshold by this policy</p>
      <span>Toxic Score <strong>{scan?.toxicScore ?? 'Missing'}</strong></span>
    </div>
  </>;
}

const hardTraits: ReadonlySet<string> = new Set(TRAIT_RULE_REFERENCE.filter(item => item.reason === 'hard_deny_trait').map(item => item.label));
const moderateTraits: ReadonlySet<string> = new Set(TRAIT_RULE_REFERENCE.filter(item => item.reason === 'moderate_trait').map(item => item.label));

function observedTrait(record: PrivateScanRecord | undefined, allowed: ReadonlySet<string>) {
  return record?.risk?.scan?.traitLabels?.find(label => allowed.has(label));
}

function decisionCopy(result: LivePaymentPolicyResult, record: PrivateScanRecord | undefined, offlineFixture: boolean) {
  const reporter = offlineFixture ? 'Synthetic provider evidence contains' : 'Intercepta reported';
  switch (result.reasonCode) {
    case 'invalid_amount': return {
      why: 'Enter a positive USDC amount with no more than six decimal places.',
      next: 'Correct the payment intent before requesting evidence.',
    };
    case 'evidence_unavailable': return {
      why: offlineFixture ? 'Usable synthetic provider evidence is not available for this payment intent.' : 'Usable live risk evidence is not available for this payment intent.',
      next: 'Await evidence or keep the payment paused before signing.',
    };
    case 'unknown_traits': return {
      why: 'Some provider evidence is not yet understood.',
      next: 'Human review is required before any signing or execution.',
    };
    case 'hard_deny_trait': {
      const trait = observedTrait(record, hardTraits) ?? 'a hard-deny trait';
      return {
        why: `${reporter} ${trait}. The project policy applies its deny rule.`,
        next: 'Payment is blocked before signing.',
      };
    }
    case 'incomplete_traits': return {
      why: 'The visible trait list is incomplete, so the project rule cannot permit payment.',
      next: 'Human review is required before any signing or execution.',
    };
    case 'moderate_trait': {
      const trait = observedTrait(record, moderateTraits) ?? 'restricted evidence';
      return {
        why: `${reporter} ${trait}. The project policy caps demo exposure at 0.001 USDC.`,
        next: result.amountWithinLimit
          ? 'The intent is within the 0.001 USDC demo cap; execution remains disconnected.'
          : 'Reduce the amount to 0.001 USDC or do not proceed at the current amount.',
      };
    }
    case 'no_traits': return {
      why: 'The complete saved evidence has zero reported trait entries, so the project no-traits rule applies. This does not establish absence of risk. The raw score is not a policy threshold.',
      next: 'Eligible under project demo rules; execution remains disconnected.',
    };
    case 'unmapped_trait': return {
      why: 'Observed evidence has no permitting rule in this project policy.',
      next: 'Human review is required before any signing or execution.',
    };
    default: return {
      why: 'The project policy did not produce a supported permitting reason.',
      next: 'Keep the payment paused before signing or execution.',
    };
  }
}

function displayDecision(decision: LivePaymentPolicyResult['decision']) {
  return decision === 'ALLOW_WITH_LIMIT' ? 'ALLOW WITH LIMIT' : decision;
}

export function PrivateRiskPanel({ selectedId, status, loading, message, onSelect, onScan, onRefresh, offlineFixture = false }: PrivateRiskPanelProps & { offlineFixture?: boolean }) {
  const [amountUsdc, setAmountUsdc] = useState('0.005');
  const candidate = privateCandidate(selectedId);
  const record = selectedRecord(status, selectedId);
  const recordForPolicy = loading || !status ? undefined : record;
  const policy = evaluateLivePaymentPolicy(recordForPolicy, amountUsdc);
  const copy = decisionCopy(policy, recordForPolicy, offlineFixture);
  const liveEvidence = usableLiveEvidence(recordForPolicy, loading);
  const hasPending = !!status?.records.some(item => item.state === 'pending');
  const exhausted = status ? status.usedRequests >= status.maxRequests : false;
  const invalidAmount = policy.reasonCode === 'invalid_amount';
  const scanDisabled = loading || !status || !status.ready || !!record || exhausted || hasPending || invalidAmount;
  const scanDisabledReason = invalidAmount ? 'Enter a valid amount before assessment.'
    : !status ? 'Address assessment status is not available.'
      : !status.ready ? 'Address assessment is not ready on this device.'
        : hasPending ? 'A scan is pending. Refresh the saved result before another request.'
          : exhausted ? `Attempt allowance used (${status.usedRequests}/${status.maxRequests}).`
            : record ? 'A saved record exists for this address; it is assessed locally without rescanning.' : '';

  const savedAssessment = loading ? 'Loading saved assessment…'
    : record?.state === 'pending' ? 'Assessment pending'
      : record?.state === 'unavailable' ? 'Saved assessment unavailable'
        : liveEvidence ? (offlineFixture ? 'Saved simulated assessment' : 'Saved live assessment')
          : 'Using saved assessment · Evidence unavailable';
  const savedAssessmentNote = record?.state === 'pending'
    ? 'Refresh saved records to check the existing attempt. Do not submit another assessment.'
    : record?.state === 'unavailable'
      ? 'The saved attempt did not provide usable evidence. No automatic rescan. Refresh saved records to query its saved status.'
      : 'Using existing evidence — no rescan. No rescan required. Amount changes re-evaluate saved evidence locally. Refresh saved records does not refresh provider evidence or establish current safety.';

  if (!candidate) return <main className="private-risk-panel"><p className="private-risk-message" role="alert">The selected recipient was not found.</p></main>;
  return <main className="private-risk-panel" aria-labelledby="private-risk-title">
    <header className="private-risk-hero">
      <div>
        <p className="private-risk-kicker">AUTONOMOUS PAYMENT CONTROL</p>
        <h1 id="private-risk-title">Agent Payment Guard</h1>
        <p>Screen recipients before autonomous payments.</p>
      </div>
      <div className="private-risk-badges" aria-label="Demo status">
        <span className={liveEvidence && !offlineFixture ? 'private-risk-badge is-live' : 'private-risk-badge'}>{offlineFixture ? 'SIMULATED' : `Intercepta ${liveEvidence ? 'Live' : record ? 'Unavailable' : 'Awaiting'}`}</span>
        <span className="private-risk-badge">Policy v1</span>
      </div>
    </header>

    <div className="private-risk-flow">
      <section className="private-risk-card private-risk-intent" aria-labelledby="private-risk-intent-title">
        <div className="private-risk-step"><span>01</span><div><p>STEP 01</p><h2 id="private-risk-intent-title">Payment intent</h2></div></div>
        <div className="private-risk-agent"><span>Agent</span><strong>Report Buyer 01</strong></div>
        <label htmlFor="private-risk-candidate">Recipient</label>
        <select id="private-risk-candidate" value={selectedId} disabled={loading} onChange={event => onSelect(event.target.value as PrivateRiskPanelProps['selectedId'])}>
          {PRIVATE_RISK_CANDIDATES.map(item => <option key={item.id} value={item.id}>Case {item.id}</option>)}
        </select>
        <p className="private-risk-note">Selecting a recipient only looks up saved records; it does not run a risk check.</p>
        <code className="private-risk-address">{candidate.address}</code>
        <div className="private-risk-intent-grid">
          <label htmlFor="private-risk-amount">Amount<input id="private-risk-amount" inputMode="decimal" value={amountUsdc} disabled={loading} onChange={event => setAmountUsdc(event.target.value)} /></label>
          <div><span className="private-risk-label">Asset</span><strong>USDC</strong></div>
          <div><span className="private-risk-label">Network</span><strong>Ethereum Mainnet for screening</strong><small>eip155:1 · Coverage: unverified</small></div>
        </div>
        <p className="private-risk-note">Amount is the intended payment amount. Editing it only recalculates local policy; it does not contact the provider or send a payment.</p>
        {record
          ? <div className="private-risk-saved-assessment" role="status"><strong>{savedAssessment}</strong><p className="private-risk-note">{savedAssessmentNote}</p></div>
          : <button className="private-risk-primary" type="button" disabled={scanDisabled} onClick={onScan}>{offlineFixture ? 'Run Simulated Risk Check' : 'Run Live Risk Check'}</button>}
        <p className="private-risk-note">Screened before any signing or execution.</p>
        {!record && <p className="private-risk-status-copy">{loading ? 'Assessment in progress…' : scanDisabledReason || 'Manual one-address assessment. One attempt; no automatic retry.'}</p>}
        {message && <p className="private-risk-message" role="status">Address assessment state changed. Review the saved status and technical details.</p>}
      </section>

      <section className="private-risk-card private-risk-evidence" aria-labelledby="private-risk-evidence-title">
        <div className="private-risk-step"><span>02</span><div><p>STEP 02</p><h2 id="private-risk-evidence-title">{offlineFixture ? 'Synthetic provider evidence' : 'Intercepta evidence'}</h2></div></div>
        {offlineFixture && <p className="private-risk-note">SIMULATED · Not a live Intercepta response</p>}
        <Evidence record={recordForPolicy} live={liveEvidence} offlineFixture={offlineFixture} />
        <details className="private-risk-details">
          <summary>Technical details</summary>
          {recordForPolicy?.risk ? <ScanDiagnostics risk={recordForPolicy.risk} /> : <p>No bounded diagnostics are available for this recipient.</p>}
          <p>Attempts used: {status ? `${status.usedRequests} / ${status.maxRequests}` : 'Not available'}. Failed attempts count; there is no automatic retry.</p>
          <button type="button" disabled={loading} onClick={onRefresh}>Refresh saved records</button>
        </details>
      </section>

      <section className={`private-risk-card private-risk-policy decision-${policy.decision.toLowerCase()}`} aria-labelledby="private-risk-policy-title">
        <div className="private-risk-step"><span>03</span><div><p>STEP 03</p><h2 id="private-risk-policy-title">Project policy</h2></div></div>
        <p className="private-risk-policy-name">{LIVE_PAYMENT_POLICY_NAME}</p>
        <p className="private-risk-revision">{LIVE_PAYMENT_POLICY_REVISION}</p>
        <strong className="private-risk-decision">{displayDecision(policy.decision)}</strong>
        <dl className="private-risk-policy-facts">
          <div><dt>Requested</dt><dd>{amountUsdc || 'Missing'} USDC</dd></div>
          <div><dt>Policy cap</dt><dd>{policy.capUsdc ? `${policy.capUsdc} USDC` : 'Not applicable'}</dd></div>
          <div><dt>Within limit</dt><dd>{policy.amountWithinLimit ? 'Yes' : 'No'}</dd></div>
          {policy.capUsdc && <div><dt>Amount context</dt><dd>{policy.amountWithinLimit ? 'Within policy cap' : 'Exceeds policy cap — amount unchanged'}</dd></div>}
          <div><dt>Reason code</dt><dd>{policy.reasonCode}</dd></div>
        </dl>
        <p className="private-risk-factor-caveat">Policy uses traits, evidence quality and the intended amount. Raw provider score is displayed only, not used as a decision threshold.</p>
        <div className="private-risk-why"><span className="private-risk-label">Why</span><p>{copy.why}</p></div>
        <p className="private-risk-policy-boundary">{offlineFixture ? 'Project-defined demo rules use synthetic provider evidence. This is not a live Intercepta response or execution permission.' : 'Project-defined demo rules use Intercepta observations. This is not an Intercepta verdict or execution permission.'}</p>
      </section>

      <section className="private-risk-card private-risk-execution" aria-labelledby="private-risk-execution-title">
        <div className="private-risk-step"><span>04</span><div><p>STEP 04</p><h2 id="private-risk-execution-title">Execution gating</h2></div></div>
        <div className="private-risk-gate">
          <div><span className="private-risk-label">Execution</span><strong>Payment execution — NOT CONNECTED</strong></div>
          <div><span className="private-risk-label">Next action</span><p>{copy.next}</p></div>
        </div>
        <details className="private-risk-details private-risk-audit">
          <summary>Technical / audit details</summary>
          {record?.risk
            ? <p><strong>Original scan receipt</strong> · v2 · HOLD</p>
            : <p><strong>Original scan receipt</strong> · Not available</p>}
          <p>The original receipt preserves the raw scan assessment when available. It is separate from the project policy above and never grants execution.</p>
          <p><strong>Source clues (unverified)</strong>: {candidate.context}</p>
          <RiskReceiptDownload status={status} candidateId={selectedId} />
          <PaymentDecisionReceiptDownload
            status={status}
            candidateId={selectedId}
            amountUsdc={amountUsdc}
            loading={loading}
          />
        </details>
      </section>
    </div>
    <PolicySandbox />
  </main>;
}
