import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSampleReports, SAMPLE_FILE } from './contract-insights.ts';
import { validatePaidStructureReport } from './report-validation.ts';

// Pin independently from the response under test, as a buyer must do before purchase.
const expectedHash = createHash('sha256').update(readFileSync(SAMPLE_FILE)).digest('hex');
const report = () => createSampleReports().report;

describe('pure paid report validation', () => {
  it('accepts the actual JSON report and returns only validated fields without mutating input', () => {
    const input = { ...JSON.parse(JSON.stringify(report())), orderId: 'untrusted-response-order' };
    const before = JSON.stringify(input);
    const result = validatePaidStructureReport(input, expectedHash);
    expect(result).toEqual({ ok: true, report: report() });
    expect(JSON.stringify(input)).toBe(before);
    if (result.ok) {
      result.report.declarations.functions[0]!.name = 'changed';
      result.report.limitations.push('changed');
      expect(JSON.stringify(input)).toBe(before);
    }
  });
  it.each([null, [], 0, 'report', {}, createSampleReports().preview])('rejects non-report input %j', input => {
    expect(validatePaidStructureReport(input, expectedHash).ok).toBe(false);
  });
  it.each(['', 'not-a-hash', 'a'.repeat(63)])('requires a valid trusted expected hash %s', hash => {
    expect(validatePaidStructureReport(report(), hash)).toEqual({ ok: false, reason: 'invalid_expected_source_hash' });
  });
  it('rejects a well-formed response hash that differs from the pinned order version', () => {
    const input = report(); input.source.sha256 = 'a'.repeat(64);
    expect(validatePaidStructureReport(input, expectedHash)).toEqual({ ok: false, reason: 'source_hash_mismatch' });
  });
  const corruptions: [string, (r: any) => void][] = [
    ['preview kind', r => { r.kind = 'public-sample'; }],
    ['wrong schema', r => { r.schemaVersion = 'contract-insights/v2'; }],
    ['wrong sample', r => { r.sampleName = 'Other'; }],
    ['missing source', r => { delete r.source; }],
    ['wrong filename', r => { r.source.filename = 'Other.sol'; }],
    ['wrong source origin', r => { r.source.origin = 'deployed'; }],
    ['wrong source language', r => { r.source.language = 'Other'; }],
    ['source path as URL', r => { r.source.path = 'https://untrusted.invalid/'; }],
    ['malformed hash', r => { r.source.sha256 = 'broken'; }],
    ['missing declarations', r => { delete r.declarations; }],
    ['missing events', r => { delete r.declarations.events; }],
    ['null declaration', r => { r.declarations.functions[0] = null; }],
    ['invalid name', r => { r.declarations.functions[0].name = '<script>'; }],
    ['zero line', r => { r.declarations.functions[0].line = 0; }],
    ['fractional line', r => { r.declarations.functions[0].line = 1.5; }],
    ['string line', r => { r.declarations.functions[0].line = '21'; }],
    ['unsafe line', r => { r.declarations.functions[0].line = Number.MAX_SAFE_INTEGER + 1; }],
    ['missing metrics', r => { delete r.metrics; }],
    ['missing category', r => { r.metrics.pop(); }],
    ['unknown metric key', r => { r.metrics[0].key = 'risk'; }],
    ['duplicate metric key', r => { r.metrics[1].key = 'functions'; }],
    ['count mismatch', r => { r.metrics[0].value++; }],
    ['negative count', r => { r.metrics[0].value = -1; }],
    ['fractional count', r => { r.metrics[0].value = 4.5; }],
    ['blank label', r => { r.metrics[0].label = ' '; }],
    ['missing method', r => { delete r.method; }],
    ['empty limitations', r => { r.limitations = []; }],
    ['sparse limitations', r => { r.limitations = Array(1); }],
    ['invalid limitation', r => { r.limitations[0] = 2; }],
  ];
  it.each(corruptions)('rejects %s', (_, corrupt) => {
    const input = report(); corrupt(input);
    expect(validatePaidStructureReport(input, expectedHash).ok).toBe(false);
  });
});
