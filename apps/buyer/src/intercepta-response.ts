/** Documented Quick Scan Address trait names (ToxicScoreTraitV2). */
export const INTERCEPTA_TRAIT_NAMES = [
  'known_scammer',
  'initiator_scam_transactions',
  'sanction_address_communication',
  'suspicious_dex_pair_deployer',
  'suspicious_deployer',
  'attack_money_target',
  'zero_address_risk',
  'sanction_address',
  'fake_phishing_transfer',
  'non_kyc_transfers',
  'mixer_transfers',
  'fake_phishing_contract_communication',
  'rug_pull',
  'rug_pull_trader',
  'blacklist',
] as const;

export type InterceptaTraitName = typeof INTERCEPTA_TRAIT_NAMES[number];

export type InterceptaTrait = {
  risk: number;
  name: InterceptaTraitName;
  txsCount?: number;
  description: string;
};

export type InterceptaResponse =
  | { kind: 'observed'; toxicScore: number; traits: InterceptaTrait[]; unknownTraitsCount?: number; additionalFieldsCount?: number }
  | { kind: 'unknown'; reason: 'invalid-response' };

const traitNames: ReadonlySet<string> = new Set(INTERCEPTA_TRAIT_NAMES);
export const MAX_INTERCEPTA_TRAITS = 100;
export const MAX_INTERCEPTA_TRAIT_LABELS = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Validate documented facts only. This function assigns no risk decision or score threshold. */
export function parseInterceptaResponse(value: unknown): InterceptaResponse {
  try {
    if (!isRecord(value) ||
        !Object.hasOwn(value, 'toxicScore') || !Object.hasOwn(value, 'traits') ||
        !isFiniteNumber(value.toxicScore) || !Array.isArray(value.traits) ||
        value.traits.length > MAX_INTERCEPTA_TRAITS) {
      return { kind: 'unknown', reason: 'invalid-response' };
    }

    const traits: InterceptaTrait[] = [];
    let unknownTraitsCount = 0;
    for (const trait of value.traits) {
      // Unknown variants have no established risk/count/description contract.
      // Inspect only a bounded object and its bounded name; never consume its values.
      if (!isRecord(trait) || Object.keys(trait).length > 20 || !Object.hasOwn(trait, 'name') ||
          typeof trait.name !== 'string' || trait.name.trim().length === 0 || trait.name.length > 120) {
        return { kind: 'unknown', reason: 'invalid-response' };
      }
      if (!traitNames.has(trait.name)) { unknownTraitsCount++; continue; }
      if (!Object.hasOwn(trait, 'risk') || !Object.hasOwn(trait, 'description') ||
          !isFiniteNumber(trait.risk) || (Object.hasOwn(trait, 'txsCount') && !isFiniteNumber(trait.txsCount)) || typeof trait.description !== 'string') {
        return { kind: 'unknown', reason: 'invalid-response' };
      }
      traits.push({
        risk: trait.risk,
        name: trait.name as InterceptaTraitName,
        // Omission is a provider fact, never a synthetic zero. Ignore inherited fields.
        ...(Object.hasOwn(trait, 'txsCount') ? { txsCount: trait.txsCount as number } : {}),
        description: trait.description,
      });
    }

    return { kind: 'observed', toxicScore: value.toxicScore, traits,
      ...(unknownTraitsCount ? { unknownTraitsCount } : {}),
      ...(Object.keys(value).length > 2 ? { additionalFieldsCount: Object.keys(value).length - 2 } : {}),
    };
  } catch {
    return { kind: 'unknown', reason: 'invalid-response' };
  }
}
