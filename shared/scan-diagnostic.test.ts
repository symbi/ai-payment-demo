import { expect, it } from 'vitest';
import { describeScanSchema, isSchemaDiagnostic, isTraitDiagnostic } from './scan-diagnostic.ts';
it('counts malformed known fields and unknown shapes without exposing any values', () => {
  const result = describeScanSchema({ toxicScore: 2, traits: [null, { name: 'known_scammer', risk: 'SECRET' }, { name: 'UNKNOWN-SECRET', value: 'RAW-SECRET' }, { name: 'rug_pull', risk: 1, txsCount: 'bad', description: false }] });
  expect(result.traitDiagnostic).toMatchObject({ totalItems: 4, inspectedItems: 4, objectItems: 3, malformedItems: 3, knownTraitItems: 2, unknownTraitItems: 1, missingRiskCount: 0, invalidRiskTypeCount: 1, missingTxsCount: 1, invalidTxsCountTypeCount: 1, missingDescriptionCount: 1, invalidDescriptionTypeCount: 1 });
  expect(JSON.stringify(result)).not.toMatch(/SECRET|known_scammer|rug_pull|bad/);
  expect(isSchemaDiagnostic(result)).toBe(true);
});
it('bounds inspection to 100 items and reports actual total separately', () => {
  const result = describeScanSchema({ toxicScore: 0, traits: Array.from({length:150},()=>({ name:'unknown' })) });
  expect(result.traitDiagnostic).toMatchObject({totalItems:150, inspectedItems:100, unknownTraitItems:100});
  expect(isSchemaDiagnostic(result)).toBe(true);
});
it('accepts legacy shape but rejects secret or out-of-range diagnostic fields', () => {
  const d = describeScanSchema({ traits: [] });
  expect(isSchemaDiagnostic({ topLevelKeys: [], otherKeysCount:0, toxicScoreType:'missing', traitsType:'missing' })).toBe(true);
  expect(isSchemaDiagnostic({ ...d, traitDiagnostic:{ ...d.traitDiagnostic, secret:'SECRET' } })).toBe(false);
  expect(isTraitDiagnostic({ ...d.traitDiagnostic, missingRiskCount:101 })).toBe(false);
});
