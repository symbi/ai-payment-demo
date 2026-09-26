import { isPrivateScanRecord } from './private-risk.ts';

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

const HARD_DENY_TRAITS: ReadonlySet<string> = new Set([
  'sanction_address', 'blacklist', 'known_scammer',
]);
const MODERATE_TRAITS: ReadonlySet<string> = new Set([
  'mixer_transfers', 'non_kyc_transfers', 'sanction_address_communication',
  'fake_phishing_transfer', 'fake_phishing_contract_communication', 'rug_pull_trader',
]);
const REQUIRED_SCAN_FIELDS = ['transport', 'httpStatus', 'toxicScore', 'traitsCount', 'traitLabels'] as const;
const DEMO_CAP_ATOMIC = 1_000n; // 0.001 USDC, a project-defined demo cap.

function parseAmount(value: string): bigint | null {
  // The final assertion requires the actual end, unlike $ which accepts a final newline.
  if (typeof value !== 'string' || value.length < 1 || value.length > 78 ||
      !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?(?![\s\S])/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const atomic = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  return atomic > 0n ? atomic : null;
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

/**
 * Pure project policy over saved evidence, with no score thresholds or mutation.
 * ALLOW/LIMIT describe this demo only; no result authorizes or executes payment.
 */
export function evaluateLivePaymentPolicy(
  record: unknown,
  amountUsdc: string,
): LivePaymentPolicyResult {
  // Invalid amounts must short-circuit even a record whose getters throw.
  const amountAtomic = parseAmount(amountUsdc);
  if (amountAtomic === null) return result('HOLD', 'invalid_amount');

  try {
    if (!isPrivateScanRecord(record) || record.state !== 'completed' || record.risk?.source !== 'live') {
      return result('HOLD', 'evidence_unavailable');
    }
    const scan = record.risk.scan;
    if (!scan || !REQUIRED_SCAN_FIELDS.every(field => Object.hasOwn(scan, field))) {
      return result('HOLD', 'evidence_unavailable');
    }
    const { transport, httpStatus, toxicScore, traitsCount, traitLabels } = scan;
    if (transport !== 'received' || httpStatus !== 200 ||
        typeof toxicScore !== 'number' || !Number.isFinite(toxicScore) ||
        typeof traitsCount !== 'number' || !Number.isInteger(traitsCount) || !Array.isArray(traitLabels)) {
      return result('HOLD', 'evidence_unavailable');
    }

    // A missing own count is unknown, even when the prototype supplies zero.
    if (!Object.hasOwn(scan, 'unknownTraitsCount') || scan.unknownTraitsCount !== 0) {
      return result('HOLD', 'unknown_traits');
    }
    if (traitLabels.some(label => HARD_DENY_TRAITS.has(label))) {
      return result('DENY', 'hard_deny_trait');
    }
    // Saved labels can be truncated. Preserve duplicate observations in this count.
    if (traitLabels.length !== traitsCount) return result('HOLD', 'incomplete_traits');
    if (traitLabels.some(label => MODERATE_TRAITS.has(label))) {
      return result('ALLOW_WITH_LIMIT', 'moderate_trait', amountAtomic <= DEMO_CAP_ATOMIC);
    }
    if (traitsCount === 0) return result('ALLOW', 'no_traits');
    return result('HOLD', 'unmapped_trait');
  } catch {
    return result('HOLD', 'evidence_unavailable');
  }
}
