import { INTERCEPTA_TRAIT_NAMES, MAX_INTERCEPTA_TRAIT_LABELS } from '../../buyer/src/intercepta-response.ts';
import { evaluatePaymentPolicy } from '../../../shared/payment-policy.ts';
import { normalizeInterceptaEvidence } from '../../../shared/risk-evidence-adapters.ts';
import type { PrivateScanRecord } from '../../../shared/private-risk.ts';

// Display-only rule reference, derived from the parser vocabulary and actual engine.
// These isolated single-label examples never become recipient evidence or saved records.
export const TRAIT_RULE_REFERENCE = INTERCEPTA_TRAIT_NAMES.map(label => {
  const result = evaluatePaymentPolicy({ origin: 'SYNTHETIC', provider: 'synthetic', available: true,
    toxicScore: 0, traits: [label], traitsCount: 1, unknownTraitsCount: 0, complete: true }, { amountUsdc: '0.0005' });
  return { label, reason: result.reasonCode };
});
export const EVIDENCE_GROUPS = [
  { reason: 'hard_deny_trait', title: 'Hard deny' },
  { reason: 'moderate_trait', title: 'Limit' },
  { reason: 'unmapped_trait', title: 'Recognized, unmapped → HOLD' },
] as const;
const knownLabels: ReadonlySet<string> = new Set(INTERCEPTA_TRAIT_NAMES);
const count = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

/** Presentation facts only: quality comes from the unchanged adapter, not a new policy. */
export function describeSavedEvidence(record: PrivateScanRecord | undefined) {
  const normalized = normalizeInterceptaEvidence(record);
  const scan = record?.risk?.scan;
  const storedLabels = scan && Object.hasOwn(scan, 'traitLabels') && Array.isArray(scan.traitLabels) ? scan.traitLabels : null;
  const labels = storedLabels?.slice(0, MAX_INTERCEPTA_TRAIT_LABELS).filter(label => knownLabels.has(label)) ?? null;
  const uniqueLabels = labels === null ? null : [...new Set(labels)];
  const unknownCount = scan && Object.hasOwn(scan, 'unknownTraitsCount') ? count(scan.unknownTraitsCount) : null;
  return {
    available: normalized.available,
    completeness: !normalized.available || unknownCount === null ? 'Unknown' : normalized.complete ? 'Complete saved evidence' : 'Incomplete',
    unknownCount,
    reportedEntries: scan && Object.hasOwn(scan, 'traitsCount') ? count(scan.traitsCount) : null,
    labels, uniqueLabels,
  };
}
