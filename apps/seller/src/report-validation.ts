/** Pure JSON-shape/version validation. No payment, order, or source-authenticity proof. */
export type ReportCategory = 'functions' | 'events' | 'modifiers';
export interface ValidatedPaidStructureReport {
  kind: 'paid-structure-report';
  schemaVersion: 'contract-insights/v1';
  sampleName: 'ExampleVault';
  source: { filename: 'ExampleVault.sol'; path: string; sha256: string; language: 'Solidity'; origin: 'bundled-demo' };
  metrics: { key: ReportCategory; label: string; value: number }[];
  declarations: Record<ReportCategory, { name: string; line: number }[]>;
  method: string;
  limitations: string[];
}
export type ReportValidationResult =
  | { ok: true; report: ValidatedPaidStructureReport }
  | { ok: false; reason: string };

const categories: ReportCategory[] = ['functions', 'events', 'modifiers'];
const hashPattern = /^[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const fail = (reason: string): ReportValidationResult => ({ ok: false, reason });

/**
 * expectedSourceSha256 must come from the caller's previously pinned trusted order context,
 * never from the response being checked. Equality binds the declared source version only;
 * this function cannot verify the declarations against source bytes or prove settlement.
 * The caller owns HTTP/receipt checks, resource/order binding and ambiguous-payment recovery.
 */
export function validatePaidStructureReport(value: unknown, expectedSourceSha256: string): ReportValidationResult {
  if (typeof expectedSourceSha256 !== 'string' || !hashPattern.test(expectedSourceSha256)) return fail('invalid_expected_source_hash');
  if (!object(value) || value.kind !== 'paid-structure-report' || value.schemaVersion !== 'contract-insights/v1'
    || value.sampleName !== 'ExampleVault') return fail('invalid_report_identity');
  const source = value.source;
  if (!object(source) || source.filename !== 'ExampleVault.sol' || source.path !== 'apps/seller/samples/ExampleVault.sol'
    || source.language !== 'Solidity' || source.origin !== 'bundled-demo'
    || typeof source.sha256 !== 'string' || !hashPattern.test(source.sha256)) return fail('invalid_source');
  if (source.sha256 !== expectedSourceSha256) return fail('source_hash_mismatch');
  if (!text(value.method) || !Array.isArray(value.limitations) || value.limitations.length === 0
    || ![...value.limitations].every(text)) return fail('invalid_method_or_limitations');
  if (!object(value.declarations)) return fail('invalid_declarations');
  const declarations: ValidatedPaidStructureReport['declarations'] = { functions: [], events: [], modifiers: [] };
  for (const key of categories) {
    const entries = value.declarations[key];
    if (!Array.isArray(entries)) return fail('invalid_declarations');
    for (const entry of entries) {
      if (!object(entry) || typeof entry.name !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(entry.name)
        || typeof entry.line !== 'number' || !Number.isSafeInteger(entry.line) || entry.line < 1) return fail('invalid_declaration');
      declarations[key].push({ name: entry.name, line: entry.line });
    }
  }
  if (!Array.isArray(value.metrics) || value.metrics.length !== categories.length) return fail('invalid_metrics');
  const metrics: ValidatedPaidStructureReport['metrics'] = [];
  const seen = new Set<ReportCategory>();
  for (const metric of value.metrics) {
    if (!object(metric)) return fail('invalid_metrics');
    const key = categories.find(category => category === metric.key);
    if (!key || seen.has(key) || !text(metric.label) || typeof metric.value !== 'number'
      || !Number.isSafeInteger(metric.value) || metric.value < 0) return fail('invalid_metrics');
    if (metric.value !== declarations[key].length) return fail('metric_count_mismatch');
    seen.add(key);
    metrics.push({ key, label: metric.label, value: metric.value });
  }
  // Return only validated fields; unrecognized response fields are not trusted downstream.
  return { ok: true, report: {
    kind: 'paid-structure-report', schemaVersion: 'contract-insights/v1', sampleName: 'ExampleVault',
    source: { filename: 'ExampleVault.sol', path: source.path, sha256: source.sha256, language: 'Solidity', origin: 'bundled-demo' },
    metrics, declarations, method: value.method, limitations: [...value.limitations],
  } };
}
