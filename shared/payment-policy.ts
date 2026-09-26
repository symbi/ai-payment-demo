import type { NormalizedRiskEvidence } from './normalized-risk-evidence.ts';

/** Project-defined demo policy identity; never a provider verdict or execution grant. */
export const LIVE_PAYMENT_POLICY_REVISION = 'project-intercepta-payment-policy-v1' as const;
export const LIVE_PAYMENT_POLICY_NAME = 'Project/Intercepta Payment Policy v1' as const;

export type LivePaymentPolicyResult = {
  readonly policyRevision: typeof LIVE_PAYMENT_POLICY_REVISION;
  readonly policyName: typeof LIVE_PAYMENT_POLICY_NAME;
  readonly decision: 'ALLOW' | 'ALLOW_WITH_LIMIT' | 'DENY' | 'HOLD';
  readonly reasonCode:
    | 'evidence_unavailable'
    | 'invalid_amount'
    | 'unknown_traits'
    | 'hard_deny_trait'
    | 'incomplete_traits'
    | 'moderate_trait'
    | 'no_traits'
    | 'unmapped_trait';
  readonly capUsdc: null | '0.001';
  readonly amountWithinLimit: boolean;
  readonly execution: 'NOT_CONNECTED';
};

// Existing project-policy vocabulary, not universal provider trait semantics.
const HARD_DENY_TRAITS: ReadonlySet<string> = new Set([
  'sanction_address', 'blacklist', 'known_scammer',
]);
const MODERATE_TRAITS: ReadonlySet<string> = new Set([
  'mixer_transfers', 'non_kyc_transfers', 'sanction_address_communication',
  'fake_phishing_transfer', 'fake_phishing_contract_communication', 'rug_pull_trader',
]);
const DEMO_CAP_ATOMIC = 1_000n; // 0.001 USDC, a project-defined demo cap.

function parseAmount(value: unknown): bigint | null {
  // The final assertion requires the actual end, unlike $ which accepts a final newline.
  if (typeof value !== 'string' || value.length < 1 || value.length > 78 ||
      !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?(?![\s\S])/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const atomic = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  return atomic > 0n ? atomic : null;
}

/** Compatibility wrappers use the same parser before inspecting any evidence. */
export function isPaymentPolicyAmountValid(amountUsdc: unknown): boolean {
  return parseAmount(amountUsdc) !== null;
}

function result(
  decision: LivePaymentPolicyResult['decision'],
  reasonCode: LivePaymentPolicyResult['reasonCode'],
  withinCap = false,
): LivePaymentPolicyResult {
  return {
    policyRevision: LIVE_PAYMENT_POLICY_REVISION,
    policyName: LIVE_PAYMENT_POLICY_NAME,
    decision,
    reasonCode,
    capUsdc: decision === 'ALLOW_WITH_LIMIT' ? '0.001' : null,
    amountWithinLimit: decision === 'ALLOW' || (decision === 'ALLOW_WITH_LIMIT' && withinCap),
    execution: 'NOT_CONNECTED',
  };
}

/** Pure, ordered project rules over normalized evidence; never executes payment. */
export function evaluatePaymentPolicy(
  evidence: NormalizedRiskEvidence,
  context: Readonly<{ amountUsdc: string }>,
): LivePaymentPolicyResult {
  const amountAtomic = parseAmount(context.amountUsdc);
  if (amountAtomic === null) return result('HOLD', 'invalid_amount');

  try {
    if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence)) {
      return result('HOLD', 'evidence_unavailable');
    }
    const { origin, provider, available } = evidence;
    if (!((origin === 'LIVE' && provider === 'intercepta') ||
          (origin === 'SYNTHETIC' && provider === 'synthetic')) || available !== true) {
      return result('HOLD', 'evidence_unavailable');
    }
    const { toxicScore, traitsCount, unknownTraitsCount, complete, traits } = evidence;
    if (typeof toxicScore !== 'number' || !Number.isFinite(toxicScore) ||
        typeof traitsCount !== 'number' || !Number.isInteger(traitsCount) || traitsCount < 0 || traitsCount > 100 ||
        (unknownTraitsCount !== null && (typeof unknownTraitsCount !== 'number' ||
          !Number.isInteger(unknownTraitsCount) || unknownTraitsCount < 0 || unknownTraitsCount > traitsCount)) ||
        typeof complete !== 'boolean' || !Array.isArray(traits)) {
      return result('HOLD', 'evidence_unavailable');
    }
    const length = traits.length;
    if (!Number.isInteger(length) || length < 0 || length > 20 || length > traitsCount) {
      return result('HOLD', 'evidence_unavailable');
    }
    // Snapshot bounded dense labels so rules use only the values just validated.
    const labels: string[] = [];
    for (let index = 0; index < length; index += 1) {
      if (!Object.hasOwn(traits, index)) return result('HOLD', 'evidence_unavailable');
      const label: unknown = traits[index];
      if (typeof label !== 'string' || label.length > 120) return result('HOLD', 'evidence_unavailable');
      labels.push(label);
    }

    if (unknownTraitsCount !== 0) return result('HOLD', 'unknown_traits');
    if (labels.some(label => HARD_DENY_TRAITS.has(label))) {
      return result('DENY', 'hard_deny_trait');
    }
    // Completeness is necessary but cannot conceal truncated observations.
    if (!complete || labels.length !== traitsCount) return result('HOLD', 'incomplete_traits');
    if (labels.some(label => MODERATE_TRAITS.has(label))) {
      return result('ALLOW_WITH_LIMIT', 'moderate_trait', amountAtomic <= DEMO_CAP_ATOMIC);
    }
    if (traitsCount === 0) return result('ALLOW', 'no_traits');
    return result('HOLD', 'unmapped_trait');
  } catch {
    return result('HOLD', 'evidence_unavailable');
  }
}
