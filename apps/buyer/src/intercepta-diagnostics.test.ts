import { expect, it, vi } from 'vitest';
import { createInterceptaScanner } from './intercepta.ts';
import { isPrivateScanRecord, PRIVATE_RISK_CANDIDATES } from '../../../shared/private-risk.ts';
// All responses below are synthetic injected-fetch fixtures; no network.
const address = PRIVATE_RISK_CANDIDATES[0].address;
const trait = { name: 'known_scammer', risk: 1, txsCount: 2, description: 'PRIVATE-TEXT' };
async function run(body: unknown, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(body, { status }));
  const result = await createInterceptaScanner('FAKE-SECRET', fetch)(address, 'eip155:1');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.decision).toBe('hold');
  expect(JSON.stringify(result)).not.toMatch(/FAKE-SECRET|PRIVATE-TEXT/);
  expect(isPrivateScanRecord({ candidateId: 'H1', state: result.source === 'live' ? 'completed' : 'unavailable', attemptedAt: result.checkedAt,
    risk: { address: result.address, checkedAt: result.checkedAt, provider: result.provider, source: result.source, decision: result.decision, reasons: result.reasons, scan: result.scan } })).toBe(true);
  return result;
}
it('accepts old schema without inventing a score scale', async () => {
  expect(await run({ toxicScore: -200, traits: [trait] })).toMatchObject({ source: 'live', scan: { httpStatus: 200, toxicScore: -200, traitsCount: 1 } });
});
it('ignores extra values and records additional field count', async () => {
  expect(await run({ toxicScore: 50, traits: [], version: 'PRIVATE-TEXT', metadata: { key: 'FAKE-SECRET' } })).toMatchObject({ source: 'live', scan: { additionalFieldsCount: 2 } });
});
it('retains known labels and total count while counting unknown traits', async () => {
  const result = await run({ toxicScore: 0, traits: [trait, { ...trait, name: 'new_trait' }] });
  expect(result).toMatchObject({ source: 'live', scan: { toxicScore: 0, traitsCount: 2, unknownTraitsCount: 1, traitLabels: ['known_scammer'], semantics: 'unverified' } });
  expect(JSON.stringify(result)).not.toContain('new_trait');
});
it.each([{ traits: [] }, { toxicScore: 'bad', traits: [] }, { toxicScore: 1 }, { toxicScore: 1, traits: [null] }])('keeps malformed schema held with shape diagnostics %#', async body => {
  expect(await run(body)).toMatchObject({ source: 'unavailable', scan: { httpStatus: 200, diagnosticCode: 'schema-unsupported', schemaDiagnostic: { topLevelKeys: Object.keys(body), otherKeysCount: 0 } } });
});
it.each([403, 429, 500])('preserves HTTP %i without saving its body or retrying', async status => {
  expect(await run({ error: 'FAKE-SECRET PRIVATE-TEXT' }, status)).toMatchObject({ source: 'unavailable', scan: { httpStatus: status, diagnosticCode: 'http-error' } });
});
it('does not expose arbitrary field names, descriptions or nested objects', async () => {
  const result = await run({ traits: {}, ['FAKE-SECRET']: 'PRIVATE-TEXT', metadata: { secret: 'PRIVATE-TEXT' } });
  expect(result.scan?.schemaDiagnostic).toEqual({ topLevelKeys: ['traits', 'metadata'], otherKeysCount: 1, toxicScoreType: 'missing', traitsType: 'object' });
});
it('distinguishes invalid JSON from schema rejection', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{', { headers: { 'content-type': 'application/json' } }));
  expect(await createInterceptaScanner('FAKE', fetch)(address, 'eip155:1')).toMatchObject({ source: 'unavailable', decision: 'hold', scan: { httpStatus: 200, diagnosticCode: 'body-invalid' } });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('timeouts once without inventing a response status', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => {}));
  const result = await createInterceptaScanner('FAKE', fetch, 5)(address, 'eip155:1');
  expect(result.scan).toMatchObject({ diagnosticCode: 'timeout' });
  expect(result.scan?.httpStatus).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
});
