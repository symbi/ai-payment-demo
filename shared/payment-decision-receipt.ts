import { evaluateLivePaymentPolicy, type LivePaymentPolicyResult } from './live-payment-policy.ts';
import {
  CANDIDATE_NETWORK, isPrivateScanStatus, privateCandidate, type PrivateCandidateId,
} from './private-risk.ts';
import { buildRiskReceipt, type RiskReceipt } from './risk-receipt.ts';

export const PAYMENT_DECISION_RECEIPT_SCHEMA_VERSION = 'project-payment-decision-receipt-v1' as const;

export type PaymentDecisionReceipt = {
  readonly schemaVersion: typeof PAYMENT_DECISION_RECEIPT_SCHEMA_VERSION;
  readonly exportedAt: string;
  readonly intent: {
    readonly candidateId: PrivateCandidateId;
    readonly address: string;
    readonly network: 'eip155:1';
    readonly amountUsdc: string;
  };
  readonly policy: LivePaymentPolicyResult;
  readonly originalScanReceipt: RiskReceipt;
  readonly execution: 'NOT_CONNECTED';
};

/**
 * Local current-intent evidence only; neither policy nor export grants execution.
 * Both canonical builders consume the same detached, data-only status snapshot.
 */
export function buildPaymentDecisionReceipt(
  status: unknown,
  candidateId: unknown,
  amountUsdc: string,
  exportedAt: string,
): PaymentDecisionReceipt | null {
  try {
    const candidate = privateCandidate(candidateId);
    if (!candidate || typeof exportedAt !== 'string' ||
        new Date(exportedAt).toISOString() !== exportedAt) return null;

    let visited = 0;
    const ancestors = new Set<object>();
    // Inspect every own descriptor, including hidden fields, without source reads.
    // Array length is structural metadata; elements are the visited array values.
    function detach(value: unknown, depth: number): unknown {
      if (depth > 16 || ++visited > 4096) throw new TypeError('Snapshot bound exceeded');
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('Invalid snapshot value');

      const array = Array.isArray(value);
      const prototype = Object.getPrototypeOf(value);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('Invalid snapshot prototype');
      }
      const keys = Reflect.ownKeys(value);
      if (keys.length - (array ? 1 : 0) > 4096 - visited) throw new TypeError('Snapshot bound exceeded');
      let length = 0;
      if (array) {
        const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
        if (!descriptor || !Object.hasOwn(descriptor, 'value') ||
            typeof descriptor.value !== 'number' || !Number.isInteger(descriptor.value) ||
            descriptor.value < 0 || descriptor.value > 4096 - visited ||
            keys.length !== descriptor.value + 1) throw new TypeError('Invalid snapshot array');
        length = descriptor.value;
      }

      ancestors.add(value);
      const copy: object = array ? [] : Object.create(prototype);
      for (const key of keys) {
        if (typeof key !== 'string') throw new TypeError('Invalid snapshot key');
        if (array && key === 'length') continue;
        if (array) {
          const index = Number(key);
          if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) {
            throw new TypeError('Invalid snapshot array index');
          }
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Invalid snapshot property');
        Object.defineProperty(copy, key, {
          value: detach(descriptor.value, depth + 1),
          enumerable: descriptor.enumerable, writable: true, configurable: true,
        });
      }
      ancestors.delete(value);
      return copy;
    }

    const snapshot = detach(status, 0);
    if (!isPrivateScanStatus(snapshot)) return null;
    const record = snapshot.records.find(item => item.candidateId === candidate.id);
    if (!record) return null;
    const originalScanReceipt = buildRiskReceipt(snapshot, candidate.id);
    if (!originalScanReceipt) return null;
    const policy = evaluateLivePaymentPolicy(record, amountUsdc);
    if (policy.reasonCode === 'invalid_amount') return null;

    return {
      schemaVersion: PAYMENT_DECISION_RECEIPT_SCHEMA_VERSION,
      exportedAt,
      intent: {
        candidateId: candidate.id,
        address: candidate.address,
        network: CANDIDATE_NETWORK,
        amountUsdc,
      },
      policy,
      originalScanReceipt,
      execution: 'NOT_CONNECTED',
    };
  } catch {
    // Includes reflection failures, revoked proxies and invalid date conversion.
    return null;
  }
}
