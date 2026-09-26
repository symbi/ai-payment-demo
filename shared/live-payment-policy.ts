import {
  evaluatePaymentPolicy, isPaymentPolicyAmountValid, type LivePaymentPolicyResult,
} from './payment-policy.ts';
import { normalizeInterceptaEvidence, normalizeSyntheticEvidence } from './risk-evidence-adapters.ts';
import type { NormalizedRiskEvidence } from './normalized-risk-evidence.ts';

export {
  LIVE_PAYMENT_POLICY_NAME, LIVE_PAYMENT_POLICY_REVISION, type LivePaymentPolicyResult,
} from './payment-policy.ts';

// Local sentinel for amount-first results; no caller evidence is inspected.
const UNAVAILABLE: NormalizedRiskEvidence = {
  origin: 'LIVE', provider: 'intercepta', available: false,
  traits: [], traitsCount: null, unknownTraitsCount: null, complete: false,
};

/** Compatibility entry point over accepted saved live-source evidence. */
export function evaluateLivePaymentPolicy(record: unknown, amountUsdc: string): LivePaymentPolicyResult {
  if (!isPaymentPolicyAmountValid(amountUsdc)) {
    return evaluatePaymentPolicy(UNAVAILABLE, { amountUsdc });
  }
  return evaluatePaymentPolicy(normalizeInterceptaEvidence(record), { amountUsdc });
}

/** Compatibility entry point for strict synthetic data; never a live record. */
export function evaluateSyntheticPaymentPolicy(input: unknown, amountUsdc: string): LivePaymentPolicyResult {
  if (!isPaymentPolicyAmountValid(amountUsdc)) {
    return evaluatePaymentPolicy(UNAVAILABLE, { amountUsdc });
  }
  return evaluatePaymentPolicy(normalizeSyntheticEvidence(input), { amountUsdc });
}
