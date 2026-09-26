import { INTERCEPTA_TRAIT_NAMES } from '../apps/buyer/src/intercepta-response.ts';
// Never copy arbitrary provider keys: even a key name can contain a secret.
const SAFE_KEYS = ['toxicScore', 'traits', 'status', 'version', 'network', 'timestamp', 'metadata'];
const TYPES = ['missing', 'null', 'array', 'object', 'string', 'number', 'boolean'];
export const SCAN_DIAGNOSTIC_CODES = ['http-error', 'schema-unsupported', 'body-invalid', 'timeout', 'transport-error', 'configuration', 'observed'] as const;
export type ScanDiagnosticCode = typeof SCAN_DIAGNOSTIC_CODES[number];
export const TRAIT_COUNT_KEYS = ['totalItems', 'inspectedItems', 'objectItems', 'malformedItems', 'knownTraitItems', 'unknownTraitItems', 'missingRiskCount', 'invalidRiskTypeCount', 'missingTxsCount', 'invalidTxsCountTypeCount', 'missingDescriptionCount', 'invalidDescriptionTypeCount'] as const;
export type TraitDiagnostic = Record<typeof TRAIT_COUNT_KEYS[number], number>;
export type SchemaDiagnostic = {
  topLevelKeys: string[];
  otherKeysCount: number;
  toxicScoreType: string;
  traitsType: string;
  traitsCount?: number;
  traitDiagnostic?: TraitDiagnostic;
};
function describeTraits(items: unknown[]): TraitDiagnostic {
  const d = Object.fromEntries(TRAIT_COUNT_KEYS.map(key => [key, 0])) as TraitDiagnostic;
  d.totalItems = Math.min(items.length, 16384);
  d.inspectedItems = Math.min(items.length, 100);
  for (const item of items.slice(0, 100)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { d.malformedItems++; continue; }
    d.objectItems++;
    const t = item as Record<string, unknown>;
    if (Object.keys(t).length > 20 || typeof t.name !== 'string' || !t.name.trim() || t.name.length > 120) { d.malformedItems++; continue; }
    const known = (INTERCEPTA_TRAIT_NAMES as readonly string[]).includes(t.name);
    if (!known) { d.unknownTraitItems++; continue; }
    d.knownTraitItems++;
    let malformed = false;
    for (const [key, missing, invalid] of [
      ['risk', 'missingRiskCount', 'invalidRiskTypeCount'],
      ['txsCount', 'missingTxsCount', 'invalidTxsCountTypeCount'],
      ['description', 'missingDescriptionCount', 'invalidDescriptionTypeCount'],
    ] as const) {
      if (!Object.hasOwn(t, key)) { d[missing]++; if (key !== 'txsCount') malformed = true; }
      else if (key === 'description' ? typeof t[key] !== 'string' : typeof t[key] !== 'number' || !Number.isFinite(t[key])) { d[invalid]++; malformed = true; }
    }
    if (malformed) d.malformedItems++;
  }
  return d;
}
export function isTraitDiagnostic(value: unknown): value is TraitDiagnostic {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  return Object.keys(d).length === TRAIT_COUNT_KEYS.length && TRAIT_COUNT_KEYS.every(key => Object.hasOwn(d, key) && Number.isInteger(d[key]) && Number(d[key]) >= 0 && Number(d[key]) <= (key === 'totalItems' ? 16384 : 100)) &&
    Number(d.inspectedItems) <= Number(d.totalItems) && TRAIT_COUNT_KEYS.filter(k => !['totalItems','inspectedItems'].includes(k)).every(k => Number(d[k]) <= Number(d.inspectedItems));
}
const type = (v: unknown) => v === undefined ? 'missing' : v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
export function describeScanSchema(value: unknown): SchemaDiagnostic {
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const keys = Object.keys(object);
  return {
    topLevelKeys: keys.filter(key => SAFE_KEYS.includes(key)).slice(0, 20),
    otherKeysCount: keys.filter(key => !SAFE_KEYS.includes(key)).length,
    toxicScoreType: type(object.toxicScore), traitsType: type(object.traits),
    ...(Array.isArray(object.traits) ? { traitsCount: object.traits.length, traitDiagnostic: describeTraits(object.traits) } : {}),
  };
}
export function isSchemaDiagnostic(value: unknown): value is SchemaDiagnostic {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  return Object.keys(d).every(k => ['topLevelKeys', 'otherKeysCount', 'toxicScoreType', 'traitsType', 'traitsCount', 'traitDiagnostic'].includes(k)) &&
    Array.isArray(d.topLevelKeys) && d.topLevelKeys.length <= 20 && d.topLevelKeys.every(k => typeof k === 'string' && SAFE_KEYS.includes(k)) &&
    Number.isInteger(d.otherKeysCount) && Number(d.otherKeysCount) >= 0 && Number(d.otherKeysCount) <= 16384 &&
    (d.traitDiagnostic === undefined || isTraitDiagnostic(d.traitDiagnostic)) &&
    TYPES.includes(String(d.toxicScoreType)) && TYPES.includes(String(d.traitsType)) &&
    (d.traitsCount === undefined || (Number.isInteger(d.traitsCount) && Number(d.traitsCount) >= 0 && Number(d.traitsCount) <= 16384));
}
