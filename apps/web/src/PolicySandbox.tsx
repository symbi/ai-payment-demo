import { evaluateSyntheticPaymentPolicy } from '../../../shared/live-payment-policy.ts';
import { POLICY_SCENARIOS } from '../../../shared/policy-scenarios.ts';
import './policy-sandbox.css';

/** Independent display-only comparison; no live state or execution connection. */
export function PolicySandbox() {
  return <section className="policy-sandbox" aria-label="Policy Sandbox — Synthetic Scenarios">
    <header className="policy-sandbox-header">
      <strong className="policy-sandbox-marker">SIMULATED</strong>
      <h2>Policy Sandbox — Synthetic Scenarios</h2>
      <p>Synthetic policy scenario</p>
      <p className="policy-sandbox-warning">Not a live Intercepta response</p>
      <strong className="policy-sandbox-execution">Execution NOT CONNECTED</strong>
    </header>
    <p className="policy-sandbox-explanation">Same score and amount; different trait evidence drives the shared policy rules.</p>
    <div className="policy-sandbox-grid">
      {POLICY_SCENARIOS.map(scenario => {
        const policy = evaluateSyntheticPaymentPolicy(scenario.input, scenario.amountUsdc);
        return <article className="policy-sandbox-card" key={scenario.id}>
          <h3>{scenario.title}</h3>
          <dl className="policy-sandbox-facts">
            <div><dt>Raw toxic score</dt><dd>{scenario.input.toxicScore}</dd></div>
            <div><dt>Amount</dt><dd>{scenario.amountUsdc} USDC</dd></div>
            <div><dt>Traits count</dt><dd>{scenario.input.traitsCount}</dd></div>
            <div><dt>Trait labels</dt><dd>{scenario.input.traitLabels.join(', ') || 'None'}</dd></div>
            <div><dt>Unknown traits count</dt><dd>{scenario.input.unknownTraitsCount}</dd></div>
          </dl>
          <div className="policy-sandbox-result" data-decision={policy.decision}>
            <span>Policy decision</span>
            <strong>{policy.decision}</strong>
          </div>
          <dl className="policy-sandbox-facts">
            <div><dt>Reason</dt><dd>{policy.reasonCode}</dd></div>
            <div><dt>Cap</dt><dd>{policy.capUsdc === null ? 'None' : `${policy.capUsdc} USDC`}</dd></div>
            <div><dt>Amount within limit</dt><dd>{String(policy.amountWithinLimit)}</dd></div>
          </dl>
          <p className="policy-sandbox-identity">{policy.policyName}<br />{policy.policyRevision}</p>
        </article>;
      })}
    </div>
  </section>;
}
