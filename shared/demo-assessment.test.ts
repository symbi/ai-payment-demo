import { describe, expect, it } from 'vitest';
import { assessDemoPayment, decisionForKnownScore, DEFAULT_WEIGHTS, DEMO_FIXTURES, parseUsdcAtomic, type DemoWeights } from './demo-assessment.ts';

const base = (fixtureId = 'controlled-a', weights: DemoWeights = [...DEFAULT_WEIGHTS]) =>
  ({ fixtureId, amount: '0.001000', taskLimit: '0.005000', weights, contentChanged: false });

describe('weighted-demo-v1 pure assessment', () => {
  it('has three synthetic groups and at least two visible fixtures per group', () => {
    expect(DEMO_FIXTURES).toHaveLength(6);
    for (const category of ['known-risk', 'controlled', 'gray']) {
      expect(DEMO_FIXTURES.filter(item => item.category === category)).toHaveLength(2);
    }
    expect(new Set(DEMO_FIXTURES.map(item => item.address)).size).toBe(6);
  });

  it.each([
    ['controlled-a', 'allow'], ['controlled-b', 'allow'], ['known-risk-a', 'deny'],
    ['known-risk-b', 'deny'], ['gray-complete', 'hold'], ['gray-stale', 'hold'],
  ])('%s produces %s', (fixtureId, decision) => {
    expect(assessDemoPayment(base(fixtureId)).decision).toBe(decision);
  });

  it('keeps the exact 25 and 60 boundaries', () => {
    expect(decisionForKnownScore(24.999)).toBe('allow');
    expect(decisionForKnownScore(25)).toBe('hold');
    expect(decisionForKnownScore(59.999)).toBe('hold');
    expect(decisionForKnownScore(60)).toBe('deny');
  });

  it('hard-denies known risk and holds unknown even when their weight is zero', () => {
    expect(assessDemoPayment(base('known-risk-a', [0, 40, 30, 20, 10])).decision).toBe('deny');
    expect(assessDemoPayment(base('gray-stale', [40, 25, 25, 0, 10]))).toMatchObject({ decision: 'hold', score: null });
  });

  it.each(['', '-1', 'NaN', 'Infinity', '1e-3', '0.0000001', '0'])('rejects invalid USDC value %j', value => {
    expect(parseUsdcAtomic(value)).toBeNull();
    expect(assessDemoPayment({ ...base(), amount: value }).decision).toBe('invalid');
  });

  it('uses atomic integers at precision and budget-pressure boundaries', () => {
    expect(parseUsdcAtomic('0.123456')).toBe(123456n);
    expect(assessDemoPayment({ ...base(), amount: '0.002500' }).contributions[4].level).toBe(0);
    expect(assessDemoPayment({ ...base(), amount: '0.004000' }).contributions[4].level).toBe(0.5);
    expect(assessDemoPayment({ ...base(), amount: '0.004001' }).contributions[4].level).toBe(1);
    expect(assessDemoPayment({ ...base(), amount: '0.005001' }).decision).toBe('deny');
    expect(assessDemoPayment({ ...base(), amount: '0.010001', taskLimit: '0.020000' }).decision).toBe('deny');
  });

  it('rejects changed content before a low score can be reused', () => {
    expect(assessDemoPayment({ ...base(), contentChanged: true })).toMatchObject({ decision: 'deny', paymentEnabled: false });
  });

  it('does not normalize invalid weights', () => {
    expect(assessDemoPayment(base('controlled-a', [40, 25, 15, 10, 9])).decision).toBe('invalid');
  });
});
