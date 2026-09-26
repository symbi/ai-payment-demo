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

function Evidence({ record, live }: { record: PrivateScanRecord | undefined; live: boolean }) {
  const scan = record?.risk?.scan;
  const labels = scan?.traitLabels ?? [];
  return <>
    <div className="private-risk-evidence-head">
      <div><span className="private-risk-label">Toxic Score</span><strong>{scan?.toxicScore ?? 'Missing'}</strong></div>
      <dl>
        <div><dt>Evidence</dt><dd>{scan?.traitsCount ?? 'Missing'}</dd></div>
        <div><dt>Source</dt><dd>{live ? 'LIVE' : 'Unavailable'}</dd></div>
      </dl>
    </div>
    <div className="private-risk-traits" aria-label="Observed risk traits">
      <span className="private-risk-label">Traits</span>
      <div>{labels.length
        ? labels.map(label => <span className="private-risk-chip" key={label}>{label}</span>)
        : <span className="private-risk-muted">{scan?.traitsCount === 0 ? 'No labels returned; zero is not a safety grade.' : 'Missing'}</span>}</div>
    </div>
    {!live && <p className="private-risk-muted">Evidence unavailable</p>}
  </>;
}

const hardTraits = new Set(['sanction_address', 'blacklist', 'known_scammer']);
const moderateTraits = new Set([
  'mixer_transfers', 'non_kyc_transfers', 'sanction_address_communication',
  'fake_phishing_transfer', 'fake_phishing_contract_communication', 'rug_pull_trader',
]);

function observedTrait(record: PrivateScanRecord | undefined, allowed: ReadonlySet<string>) {
  return record?.risk?.scan?.traitLabels?.find(label => allowed.has(label));
}

function decisionCopy(result: LivePaymentPolicyResult, record: PrivateScanRecord | undefined) {
  switch (result.reasonCode) {
    case 'invalid_amount': return {
      why: 'Enter a positive USDC amount with no more than six decimal places.',
      next: 'Correct the payment intent before requesting evidence.',
    };
    case 'evidence_unavailable': return {
      why: 'Usable live risk evidence is not available for this payment intent.',
      next: 'Await evidence or keep the payment paused before signing.',
    };
    case 'unknown_traits': return {
      why: 'Some provider evidence is not yet understood.',
      next: 'Human review is required before any signing or execution.',
    };
    case 'hard_deny_trait': {
      const trait = observedTrait(record, hardTraits) ?? 'a hard-deny trait';
      return {
        why: `Intercepta reported ${trait}. The project policy applies its deny rule.`,
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
        why: `Intercepta reported ${trait}. The project policy caps demo exposure at 0.001 USDC.`,
        next: result.amountWithinLimit
          ? 'The intent is within the 0.001 USDC demo cap; execution remains disconnected.'
          : 'Reduce the amount to 0.001 USDC or do not proceed at the current amount.',
      };
    }
    case 'no_traits': return {
      why: 'The complete live response contains no observed traits. Toxic Score remains raw evidence only.',
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

export function PrivateRiskPanel({ selectedId, status, loading, message, onSelect, onScan, onRefresh }: PrivateRiskPanelProps) {
  const [amountUsdc, setAmountUsdc] = useState('0.005');
  const candidate = privateCandidate(selectedId);
  const record = selectedRecord(status, selectedId);
  const recordForPolicy = loading || !status ? undefined : record;
  const policy = evaluateLivePaymentPolicy(recordForPolicy, amountUsdc);
  const copy = decisionCopy(policy, recordForPolicy);
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

  if (!candidate) return <main className="private-risk-panel"><p className="private-risk-message" role="alert">The selected recipient was not found.</p></main>;
  return <main className="private-risk-panel" aria-labelledby="private-risk-title">
    <header className="private-risk-hero">
      <div>
        <p className="private-risk-kicker">AUTONOMOUS PAYMENT CONTROL</p>
        <h1 id="private-risk-title">Agent Payment Guard</h1>
        <p>Screen recipients before autonomous payments.</p>
      </div>
      <div className="private-risk-badges" aria-label="Demo status">
        <span className={liveEvidence ? 'private-risk-badge is-live' : 'private-risk-badge'}>Intercepta {liveEvidence ? 'Live' : record ? 'Unavailable' : 'Awaiting'}</span>
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
        <code className="private-risk-address">{candidate.address}</code>
        <div className="private-risk-intent-grid">
          <label htmlFor="private-risk-amount">Amount<input id="private-risk-amount" inputMode="decimal" value={amountUsdc} disabled={loading} onChange={event => setAmountUsdc(event.target.value)} /></label>
          <div><span className="private-risk-label">Asset</span><strong>USDC</strong></div>
          <div><span className="private-risk-label">Network</span><strong>Ethereum Mainnet for screening</strong><small>eip155:1 · Coverage: unverified</small></div>
        </div>
        <button className="private-risk-primary" type="button" disabled={scanDisabled} onClick={onScan}>Assess Payment</button>
        <p className="private-risk-note">Screened before any signing or execution.</p>
        <p className="private-risk-status-copy">{loading ? 'Assessment in progress…' : scanDisabledReason || 'Manual one-address assessment. One attempt; no automatic retry.'}</p>
        {message && <p className="private-risk-message" role="status">Address assessment state changed. Review the saved status and technical details.</p>}
      </section>

      <section className="private-risk-card private-risk-evidence" aria-labelledby="private-risk-evidence-title">
        <div className="private-risk-step"><span>02</span><div><p>STEP 02</p><h2 id="private-risk-evidence-title">Intercepta evidence</h2></div></div>
        <Evidence record={recordForPolicy} live={liveEvidence} />
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
          <div><dt>Reason code</dt><dd>{policy.reasonCode}</dd></div>
        </dl>
        <div className="private-risk-why"><span className="private-risk-label">Why</span><p>{copy.why}</p></div>
        <p className="private-risk-policy-boundary">Project-defined demo rules use Intercepta observations. This is not an Intercepta verdict or execution permission.</p>
      </section>

      <section className="private-risk-card private-risk-execution" aria-labelledby="private-risk-execution-title">
        <div className="private-risk-step"><span>04</span><div><p>STEP 04</p><h2 id="private-risk-execution-title">Execution gating</h2></div></div>
        <div className="private-risk-gate">
          <div><span className="private-risk-label">Execution</span><strong>Execution: NOT CONNECTED</strong></div>
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
  </main>;
}
