// Never copy arbitrary provider keys: even a key name can contain a secret.
const SAFE_KEYS = ['toxicScore', 'traits', 'status', 'version', 'network', 'timestamp', 'metadata'];
const TYPES = ['missing', 'null', 'array', 'object', 'string', 'number', 'boolean'];
export const SCAN_DIAGNOSTIC_CODES = ['http-error', 'schema-unsupported', 'body-invalid', 'timeout', 'transport-error', 'configuration', 'observed'] as const;
export type ScanDiagnosticCode = typeof SCAN_DIAGNOSTIC_CODES[number];
export type SchemaDiagnostic = {
  topLevelKeys: string[];
  otherKeysCount: number;
  toxicScoreType: string;
  traitsType: string;
  traitsCount?: number;
};
const type = (v: unknown) => v === undefined ? 'missing' : v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
export function describeScanSchema(value: unknown): SchemaDiagnostic {
  const object = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const keys = Object.keys(object);
  return {
    topLevelKeys: keys.filter(key => SAFE_KEYS.includes(key)).slice(0, 20),
    otherKeysCount: keys.filter(key => !SAFE_KEYS.includes(key)).length,
    toxicScoreType: type(object.toxicScore), traitsType: type(object.traits),
    ...(Array.isArray(object.traits) ? { traitsCount: object.traits.length } : {}),
  };
}
export function isSchemaDiagnostic(value: unknown): value is SchemaDiagnostic {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  return Object.keys(d).every(k => ['topLevelKeys', 'otherKeysCount', 'toxicScoreType', 'traitsType', 'traitsCount'].includes(k)) &&
    Array.isArray(d.topLevelKeys) && d.topLevelKeys.length <= 20 && d.topLevelKeys.every(k => typeof k === 'string' && SAFE_KEYS.includes(k)) &&
    Number.isInteger(d.otherKeysCount) && Number(d.otherKeysCount) >= 0 && Number(d.otherKeysCount) <= 16384 &&
    TYPES.includes(String(d.toxicScoreType)) && TYPES.includes(String(d.traitsType)) &&
    (d.traitsCount === undefined || (Number.isInteger(d.traitsCount) && Number(d.traitsCount) >= 0 && Number(d.traitsCount) <= 16384));
}
