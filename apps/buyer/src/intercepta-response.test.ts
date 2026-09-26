import { expect, it } from 'vitest';
import { INTERCEPTA_TRAIT_NAMES, parseInterceptaResponse } from './intercepta-response.ts';

const validTrait = {
  risk: 12.5,
  name: 'known_scammer',
  txsCount: 3,
  description: 'Documented trait observation',
};
const unknown = { kind: 'unknown', reason: 'invalid-response' };

it('preserves zero score and empty traits as observations without a decision', () => {
  expect(parseInterceptaResponse({ toxicScore: 0, traits: [] })).toEqual({
    kind: 'observed', toxicScore: 0, traits: [],
  });
});

it('preserves a nonempty trait and documented numeric facts', () => {
  expect(parseInterceptaResponse({ toxicScore: -23.75, traits: [validTrait] })).toEqual({
    kind: 'observed', toxicScore: -23.75, traits: [validTrait],
  });
});

it.each(INTERCEPTA_TRAIT_NAMES)('accepts documented trait name %s', name => {
  expect(parseInterceptaResponse({ toxicScore: 0, traits: [{ ...validTrait, name }] })).toMatchObject({
    kind: 'observed', traits: [{ name }],
  });
});

it.each(['risk', 'name', 'txsCount', 'description'] as const)('rejects a trait missing %s', field => {
  const trait: Record<string, unknown> = { ...validTrait };
  delete trait[field];
  expect(parseInterceptaResponse({ toxicScore: 0, traits: [trait] })).toEqual(unknown);
});

it.each([
  { risk: '12' }, { risk: NaN }, { risk: Infinity },
  { name: 'unlisted_trait' }, { name: null },
  { txsCount: '3' }, { txsCount: -Infinity },
  { description: null }, { description: 3 },
])('rejects a trait with invalid field types or unknown name %#', change => {
  expect(parseInterceptaResponse({ toxicScore: 0, traits: [{ ...validTrait, ...change }] })).toEqual(unknown);
});

it.each([
  null, undefined, [], 'invalid json', 1, {},
  { toxicScore: 0 }, { traits: [] },
  { toxicScore: '0', traits: [] }, { toxicScore: NaN, traits: [] },
  { toxicScore: Infinity, traits: [] }, { toxicScore: -Infinity, traits: [] },
  { toxicScore: 0, traits: null }, { toxicScore: 0, traits: {} },
  { toxicScore: 0, traits: [null] }, { toxicScore: 0, traits: [[]] },
  { toxicScore: 0, traits: [validTrait, { ...validTrait, name: 'unlisted_trait' }] },
])('returns explicit unknown for malformed or incomplete response %#', value => {
  expect(parseInterceptaResponse(value)).toEqual(unknown);
});

it('returns unknown if a malformed object throws while being read', () => {
  const value = { get toxicScore(): never { throw new Error('bad input'); }, traits: [] };
  expect(parseInterceptaResponse(value)).toEqual(unknown);
});
