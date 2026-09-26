import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import type { NormalizedRiskEvidence } from './normalized-risk-evidence.ts';
import {
  evaluatePaymentPolicy, isPaymentPolicyAmountValid,
  LIVE_PAYMENT_POLICY_NAME, LIVE_PAYMENT_POLICY_REVISION, type LivePaymentPolicyResult,
} from './payment-policy.ts';

// Direct-engine tests deliberately import no adapter, candidate catalog or record fixture.
const normalized = (traits: readonly string[] = ['mixer_transfers'], patch: object = {}): NormalizedRiskEvidence => ({
  origin: 'SYNTHETIC', provider: 'synthetic', available: true, toxicScore: 50,
  traits, traitsCount: traits.length, unknownTraitsCount: 0, complete: true, ...patch,
});
const unavailable: NormalizedRiskEvidence = {
  origin: 'SYNTHETIC', provider: 'synthetic', available: false,
  traits: [], traitsCount: null, unknownTraitsCount: null, complete: false,
};
// Literal canonical outputs, independent of implementation constants and adapters.
const expected = (
  decision: LivePaymentPolicyResult['decision'], reasonCode: LivePaymentPolicyResult['reasonCode'],
  amountWithinLimit = false, capUsdc: LivePaymentPolicyResult['capUsdc'] = null,
): LivePaymentPolicyResult => ({
  policyRevision: 'project-intercepta-payment-policy-v1', policyName: 'Project/Intercepta Payment Policy v1',
  decision, reasonCode, capUsdc, amountWithinLimit, execution: 'NOT_CONNECTED',
});
const limited = expected('ALLOW_WITH_LIMIT', 'moderate_trait', true, '0.001');
const over = expected('ALLOW_WITH_LIMIT', 'moderate_trait', false, '0.001');
const deny = expected('DENY', 'hard_deny_trait');
const unknown = expected('HOLD', 'unknown_traits');
const incomplete = expected('HOLD', 'incomplete_traits');
const unmapped = expected('HOLD', 'unmapped_trait');
const allow = expected('ALLOW', 'no_traits', true);
const missing = expected('HOLD', 'evidence_unavailable');
const invalid = expected('HOLD', 'invalid_amount');
const evaluate = (evidence: unknown, amountUsdc = '0.0005') =>
  evaluatePaymentPolicy(evidence as NormalizedRiskEvidence, { amountUsdc });

describe('exported pure policy: normalized evidence without a provider record', () => {
  it.each([
    { name: 'score50 mixer', input: normalized(), oracle: limited },
    { name: 'score50 sanction', input: normalized(['sanction_address']), oracle: deny },
    { name: 'score50 explicit unknown', input: normalized([], { traitsCount: 1, unknownTraitsCount: 1, complete: false }), oracle: unknown },
    { name: 'plain LIVE zero traits', input: normalized([], { origin: 'LIVE', provider: 'intercepta' }), oracle: allow },
  ])('$name has the full literal disconnected result', ({ input, oracle }) => {
    expect(evaluate(input)).toStrictEqual(oracle);
  });

  it('retains the exact exported project identity', () => {
    expect(LIVE_PAYMENT_POLICY_REVISION).toBe('project-intercepta-payment-policy-v1');
    expect(LIVE_PAYMENT_POLICY_NAME).toBe('Project/Intercepta Payment Policy v1');
  });

  it.each([
    { name: 'unknown before hard', input: normalized(['sanction_address'], { traitsCount: 2, unknownTraitsCount: 1, complete: false }), oracle: unknown },
    { name: 'missing knowledge before hard', input: normalized(['sanction_address'], { unknownTraitsCount: null, complete: false }), oracle: unknown },
    { name: 'unknown with over-accounted labels', input: normalized(['sanction_address'], { unknownTraitsCount: 1, complete: false }), oracle: unknown },
    { name: 'unknown despite forged completeness', input: normalized(['sanction_address'], { unknownTraitsCount: 1 }), oracle: unknown },
    { name: 'hard before moderate', input: normalized(['mixer_transfers', 'sanction_address']), oracle: deny },
    { name: 'hard before truncation', input: normalized(['sanction_address'], { traitsCount: 2, complete: false }), oracle: deny },
    { name: 'hard despite false completeness on full labels', input: normalized(['sanction_address'], { complete: false }), oracle: deny },
    { name: 'hard despite forged true on short labels', input: normalized(['sanction_address'], { traitsCount: 2 }), oracle: deny },
    { name: 'truncation before moderate', input: normalized(['mixer_transfers'], { traitsCount: 2, complete: false }), oracle: incomplete },
    { name: 'forged true cannot hide moderate truncation', input: normalized(['mixer_transfers'], { traitsCount: 2 }), oracle: incomplete },
    { name: 'false completeness prevents moderate', input: normalized(['mixer_transfers'], { complete: false }), oracle: incomplete },
    { name: 'false completeness prevents empty ALLOW', input: normalized([], { complete: false }), oracle: incomplete },
    { name: 'moderate before unmapped', input: normalized(['rug_pull', 'mixer_transfers']), oracle: limited },
    { name: 'unmapped', input: normalized(['rug_pull']), oracle: unmapped },
    { name: 'empty short labels', input: normalized([], { traitsCount: 1 }), oracle: incomplete },
    { name: 'zero labels with missing knowledge', input: normalized([], { unknownTraitsCount: null, complete: false }), oracle: unknown },
    { name: 'unavailable null counts', input: unavailable, oracle: missing },
    { name: '20 complete duplicate observations', input: normalized(Array<string>(20).fill('mixer_transfers')), oracle: limited },
    { name: '20 of 21 duplicate observations', input: normalized(Array<string>(20).fill('mixer_transfers'), { traitsCount: 21 }), oracle: incomplete },
    { name: 'bounded maximum unknown count', input: normalized([], { traitsCount: 100, unknownTraitsCount: 100, complete: false }), oracle: unknown },
  ])('preserves priority: $name', ({ input, oracle }) => expect(evaluate(input)).toStrictEqual(oracle));

  it.each([-7, 0, 50, 1_000_000])('finite score %s never selects a rule or grants execution', toxicScore => {
    for (const [traits, oracle] of [[[], allow], [['mixer_transfers'], limited], [['sanction_address'], deny], [['rug_pull'], unmapped]] as const) {
      for (const provenance of [{ origin: 'LIVE', provider: 'intercepta' }, { origin: 'SYNTHETIC', provider: 'synthetic' }]) {
        expect(evaluate(normalized(traits, { toxicScore, ...provenance }))).toStrictEqual(oracle);
      }
    }
  });

  it('is deterministic, returns fresh results and does not mutate frozen evidence/context', () => {
    const input = Object.freeze(normalized(Object.freeze(['mixer_transfers', 'mixer_transfers'])));
    const context = Object.freeze({ amountUsdc: '0.0005' });
    const before = JSON.stringify(input);
    const first = evaluatePaymentPolicy(input, context);
    const second = evaluatePaymentPolicy(input, context);
    expect(first).toStrictEqual(limited);
    expect(second).toStrictEqual(limited);
    expect(first).not.toBe(second);
    expect(JSON.stringify(input)).toBe(before);
    expect(context).toStrictEqual({ amountUsdc: '0.0005' });
  });
});

describe('normalized runtime validation precedes policy rules', () => {
  it.each([null, undefined, false, 50, 'ARBITRARY_UNTRUSTED_TEXT', [], {}].map(input => ({ input })))('contains invalid envelope %#', ({ input }) => {
    expect(evaluate(input)).toStrictEqual(missing);
  });

  it.each([
    { origin: 'OTHER' }, { provider: 'other' }, { origin: 'LIVE', provider: 'synthetic' },
    { origin: 'SYNTHETIC', provider: 'intercepta' }, { available: 'true' },
    { toxicScore: undefined }, { toxicScore: NaN }, { toxicScore: Infinity }, { toxicScore: -Infinity }, { toxicScore: '50' },
    { traitsCount: null }, { traitsCount: -1 }, { traitsCount: 101 }, { traitsCount: 0.5 }, { traitsCount: '1' },
    { unknownTraitsCount: undefined }, { unknownTraitsCount: -1 }, { unknownTraitsCount: 2 },
    { unknownTraitsCount: 0.5 }, { unknownTraitsCount: NaN }, { unknownTraitsCount: '0' },
    { complete: undefined }, { complete: 'true' },
    { traits: null }, { traits: 'sanction_address' }, { traits: [123] },
    { traits: Array<string>(1) }, { traits: ['x'.repeat(121)] },
    { traits: Array<string>(21).fill('sanction_address'), traitsCount: 21 }, { traitsCount: 0 },
  ])('malformed normalized field %# yields only canonical unavailable, even with hard evidence', patch => {
    expect(evaluate({ ...normalized(['sanction_address']), ...patch })).toStrictEqual(missing);
  });

  it('catches hostile normalized property/proxy failures without reflecting error text', () => {
    const input = normalized();
    Object.defineProperty(input, 'available', { get() { throw new Error('ARBITRARY_UNTRUSTED_TEXT'); } });
    expect(evaluate(input)).toStrictEqual(missing);
    const { proxy, revoke } = Proxy.revocable(normalized(), {});
    revoke();
    expect(evaluate(proxy)).toStrictEqual(missing);
  });
});

describe('one exported amount predicate and direct-engine amount boundary', () => {
  it.each([
    ['0.000001', limited], ['0.000999', limited], ['0.001', limited], ['0.001000', limited],
    ['0.001001', over], ['0.005', over], ['1', over], ['1.123456', over], ['9'.repeat(78), over],
  ] as const)('accepts exact positive amount %s and preserves cap', (amount, oracle) => {
    expect(isPaymentPolicyAmountValid(amount)).toBe(true);
    expect(evaluate(normalized(), amount)).toStrictEqual(oracle);
  });

  it.each([
    '', '0', '0.000000', '-1', '+1', ' 0.001', '0.001 ', '0.001\n', '0.001\r\n',
    '1e-3', 'NaN', 'Infinity', '00.001', '.001', '1.', '0.0000001', '１', '9'.repeat(79),
    null, undefined, 0.001, {}, ['0.001'], new String('0.001'),
  ].map(amount => ({ amount })))('rejects amount %# before any evidence inspection or coercion', ({ amount }) => {
    const touched = vi.fn(() => { throw new Error('must not inspect'); });
    const hostile = new Proxy({}, { get: touched, ownKeys: touched, getPrototypeOf: touched, getOwnPropertyDescriptor: touched });
    expect(isPaymentPolicyAmountValid(amount)).toBe(false);
    expect(evaluatePaymentPolicy(hostile as NormalizedRiskEvidence, { amountUsdc: amount as string })).toStrictEqual(invalid);
    expect(touched).not.toHaveBeenCalled();
  });

  it('does not coerce a hostile amount object', () => {
    const touched = vi.fn(() => { throw new Error('must not coerce'); });
    const amount = { toString: touched, valueOf: touched, [Symbol.toPrimitive]: touched };
    expect(isPaymentPolicyAmountValid(amount)).toBe(false);
    expect(evaluate(normalized(), amount as unknown as string)).toStrictEqual(invalid);
    expect(touched).not.toHaveBeenCalled();
  });
});

describe('resolved runtime architecture (in-memory tooling only; executed by coordinator)', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const enginePath = resolve(root, 'shared/payment-policy.ts');

  it('has no local runtime closure beyond the engine and no external imports/re-exports', async () => {
    // verbatimModuleSyntax retains unused VALUE edges; true import/export type edges vanish.
    // Disabling tree shaking prevents an unused forbidden dependency from disappearing.
    // Bundling resolves transitive local imports/re-exports; packages remain visible external edges.
    const built = await build({
      absWorkingDir: root, entryPoints: [enginePath], bundle: true, write: false,
      metafile: true, treeShaking: false, packages: 'external', platform: 'neutral', format: 'esm',
      logLevel: 'silent', legalComments: 'none',
      tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
      define: {
        fetch: '__POLICY_NETWORK_API__', 'globalThis.fetch': '__POLICY_NETWORK_API__',
        'window.fetch': '__POLICY_NETWORK_API__', XMLHttpRequest: '__POLICY_NETWORK_API__',
        WebSocket: '__POLICY_NETWORK_API__', EventSource: '__POLICY_NETWORK_API__',
        'navigator.sendBeacon': '__POLICY_NETWORK_API__',
      },
    });
    expect(built.warnings).toStrictEqual([]);
    const inputs = Object.entries(built.metafile!.inputs);
    expect(inputs.map(([path]) => resolve(root, path)).sort()).toStrictEqual([enginePath]);
    expect(inputs.flatMap(([, input]) => input.imports)).toStrictEqual([]);
    expect(Object.values(built.metafile!.outputs).flatMap(output => output.imports)).toStrictEqual([]);
    expect(built.outputFiles).toHaveLength(1);
    // Supplement the resolved graph with parser-driven replacement of direct network globals.
    expect(built.outputFiles![0].text).not.toContain('__POLICY_NETWORK_API__');
  });

  it('erases the normalized DTO completely: no runtime imports, re-exports or values', async () => {
    const source = await readFile(resolve(root, 'shared/normalized-risk-evidence.ts'), 'utf8');
    const erased = await transform(source, {
      loader: 'ts', format: 'esm', legalComments: 'none',
      tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
    });
    expect(erased.warnings).toStrictEqual([]);
    expect(erased.code.trim()).toBe('');
  });
});
