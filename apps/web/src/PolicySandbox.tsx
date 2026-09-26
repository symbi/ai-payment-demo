import { evaluateSyntheticPaymentPolicy } from '../../../shared/live-payment-policy.ts';
import { POLICY_SCENARIOS } from '../../../shared/policy-scenarios.ts';
import './policy-sandbox.css';

// Display identity only: never passed into the policy input or live records.
const SYNTHETIC_RECIPIENT_IDS: Readonly<Record<string, string>> = Object.freeze({
  'synthetic-mixer-50': 'SIM-001',
  'synthetic-sanction-50': 'SIM-002',
  'synthetic-unknown-50': 'SIM-003',
});

/** Independent display-only comparison; no live state or execution connection. */
export function PolicySandbox() {
  return <section className="policy-sandbox" aria-label="Decision Lab · SIMULATED">
    <header className="policy-sandbox-header">
      <strong className="policy-sandbox-marker">SIMULATED</strong>
      <h2>Decision Lab · SIMULATED</h2>
      <p>Synthetic policy scenario</p>
      <p className="policy-sandbox-warning">Not a live Intercepta response</p>
      <strong className="policy-sandbox-execution">Payment execution — NOT CONNECTED</strong>
    </header>
    <p className="policy-sandbox-explanation">Same score. Different evidence. Different action.</p>
    <p className="policy-sandbox-context">All three scenarios use the same proposed amount. The shared policy evaluates traits, evidence quality and amount; the raw score is display-only.</p>
    <div className="policy-sandbox-grid">
      {POLICY_SCENARIOS.map(scenario => {
        const policy = evaluateSyntheticPaymentPolicy(scenario.input, scenario.amountUsdc);
        return <article className="policy-sandbox-card" key={scenario.id}>
          <h3>{scenario.title}</h3>
          <p className="policy-sandbox-recipient">Synthetic Recipient ID: <strong>{SYNTHETIC_RECIPIENT_IDS[scenario.id]}</strong></p>
          <div className="policy-sandbox-evidence">
            <h4>Decision Factors</h4>
            {scenario.input.traitLabels.length > 0
              ? <ul className="policy-sandbox-traits">{scenario.input.traitLabels.map(label => <li key={label}>{label}</li>)}</ul>
              : <p>No displayable labels supplied; an unknown trait is reported.</p>}
            <h4>Evidence Quality</h4>
            <p>{scenario.input.unknownTraitsCount > 0
              ? 'Unknown — reported trait is not identified'
              : 'Complete synthetic labels supplied'}</p>
            <dl className="policy-sandbox-facts">
              <div><dt>Displayed labels</dt><dd>{scenario.input.traitLabels.length}</dd></div>
              <div><dt>Unknown traits count</dt><dd>{scenario.input.unknownTraitsCount}</dd></div>
            </dl>
          </div>
          <div className="policy-sandbox-result" data-decision={policy.decision}>
            <span>Policy decision</span>
            <strong>{policy.decision}</strong>
          </div>
          <dl className="policy-sandbox-facts">
            <div><dt>Proposed amount</dt><dd>{scenario.amountUsdc} USDC</dd></div>
            <div><dt>Reason</dt><dd>{policy.reasonCode}</dd></div>
            <div><dt>Cap</dt><dd>{policy.capUsdc === null ? 'None' : `${policy.capUsdc} USDC`}</dd></div>
            <div><dt>Amount within limit</dt><dd>{String(policy.amountWithinLimit)}</dd></div>
          </dl>
          <p className="policy-sandbox-score"><span>Raw provider signal — not used as a threshold by this policy</span><br />Score: {scenario.input.toxicScore}</p>
          <p className="policy-sandbox-identity">{policy.policyName}<br />{policy.policyRevision}</p>
        </article>;
      })}
    </div>
  </section>;
}
