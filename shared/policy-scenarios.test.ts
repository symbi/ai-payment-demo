import { describe, expect, it } from 'vitest';
import { POLICY_SCENARIOS } from './policy-scenarios.ts';
import { evaluateSyntheticPaymentPolicy } from './live-payment-policy.ts';

describe('fixed input-only synthetic catalog', () => {
  it('contains exactly the three frozen input shapes, without saved policy outputs', () => {
    expect(POLICY_SCENARIOS).toStrictEqual([
      {
        id: 'synthetic-mixer-50', title: 'Mixer transfer', amountUsdc: '0.0005',
        input: { synthetic: true, toxicScore: 50, traitsCount: 1, traitLabels: ['mixer_transfers'], unknownTraitsCount: 0 },
      },
      {
        id: 'synthetic-sanction-50', title: 'Sanction address', amountUsdc: '0.0005',
        input: { synthetic: true, toxicScore: 50, traitsCount: 1, traitLabels: ['sanction_address'], unknownTraitsCount: 0 },
      },
      {
        id: 'synthetic-unknown-50', title: 'Unknown trait', amountUsdc: '0.0005',
        input: { synthetic: true, toxicScore: 50, traitsCount: 1, traitLabels: [], unknownTraitsCount: 1 },
      },
    ]);
    for (const scenario of POLICY_SCENARIOS) {
      expect(Reflect.ownKeys(scenario).sort()).toEqual(['amountUsdc', 'id', 'input', 'title']);
      expect(Reflect.ownKeys(scenario.input).sort()).toEqual([
        'synthetic', 'toxicScore', 'traitLabels', 'traitsCount', 'unknownTraitsCount',
      ]);
      for (const object of [scenario, scenario.input, scenario.input.traitLabels]) {
        for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(object))) {
          expect(Object.hasOwn(descriptor, 'value')).toBe(true);
        }
      }
    }
  });

  it('freezes every nested input and remains unchanged through repeated evaluation', () => {
    expect(POLICY_SCENARIOS).toHaveLength(3); // An empty catalog cannot pass vacuously.
    expect(Object.isFrozen(POLICY_SCENARIOS)).toBe(true);
    const before = JSON.stringify(POLICY_SCENARIOS);
    expect(Reflect.set(POLICY_SCENARIOS, 'length', 0)).toBe(false);
    for (const scenario of POLICY_SCENARIOS) {
      expect(Object.isFrozen(scenario)).toBe(true);
      expect(Object.isFrozen(scenario.input)).toBe(true);
      expect(Object.isFrozen(scenario.input.traitLabels)).toBe(true);
      expect(Reflect.set(scenario, 'amountUsdc', '1')).toBe(false);
      expect(Reflect.set(scenario.input, 'toxicScore', 0)).toBe(false);
      expect(Reflect.set(scenario.input.traitLabels, '0', 'blacklist')).toBe(false);
      const first = evaluateSyntheticPaymentPolicy(scenario.input, scenario.amountUsdc);
      expect(evaluateSyntheticPaymentPolicy(scenario.input, scenario.amountUsdc)).toStrictEqual(first);
    }
    expect(JSON.stringify(POLICY_SCENARIOS)).toBe(before);
  });
});
