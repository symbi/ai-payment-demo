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
  txsCount: number;
  description: string;
};

export type InterceptaResponse =
  | { kind: 'observed'; toxicScore: number; traits: InterceptaTrait[] }
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
    if (!isRecord(value) || Object.keys(value).length !== 2 ||
        !Object.hasOwn(value, 'toxicScore') || !Object.hasOwn(value, 'traits') ||
        !isFiniteNumber(value.toxicScore) || !Array.isArray(value.traits) ||
        value.traits.length > MAX_INTERCEPTA_TRAITS) {
      return { kind: 'unknown', reason: 'invalid-response' };
    }

    const traits: InterceptaTrait[] = [];
    for (const trait of value.traits) {
      if (!isRecord(trait) || !isFiniteNumber(trait.risk) || typeof trait.name !== 'string' ||
          !traitNames.has(trait.name) || !isFiniteNumber(trait.txsCount) ||
          typeof trait.description !== 'string') {
        return { kind: 'unknown', reason: 'invalid-response' };
      }
      traits.push({
        risk: trait.risk,
        name: trait.name as InterceptaTraitName,
        txsCount: trait.txsCount,
        description: trait.description,
      });
    }

    return { kind: 'observed', toxicScore: value.toxicScore, traits };
  } catch {
    return { kind: 'unknown', reason: 'invalid-response' };
  }
}
