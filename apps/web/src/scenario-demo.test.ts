import { describe, expect, it } from 'vitest';
import { assessSeller, defaultBrief, exampleSellers, recommendSeller } from './scenario-demo.ts';
describe('local scenario matching', () => {
  it('matches all conditions rather than picking a paid seller by default', () => {
    expect(recommendSeller(defaultBrief)?.id).toBe('lucent');
    expect(recommendSeller({ ...defaultBrief, style: 'solid', budget: 0 })?.id).toBe('open');
  });
  it('does not recommend a partial match when budget is insufficient', () => {
    expect(recommendSeller({ ...defaultBrief, budget: 0 })).toBeUndefined();
    expect(assessSeller(exampleSellers[0], { ...defaultBrief, budget: 0 }).checks.find(c => c.label === 'Budget')?.matches).toBe(false);
  });
  it('requires SVG only when requested', () => {
    const brief = { ...defaultBrief, style: 'duotone' as const, budget: 1 };
    expect(recommendSeller(brief)).toBeUndefined();
    expect(recommendSeller({ ...brief, editable: false })?.id).toBe('prism');
  });
  it('distinguishes missing commercial claim, without treating any claim as verified', () => {
    const seller = { ...exampleSellers[0], commercialClaim: false };
    expect(assessSeller(seller, defaultBrief).allMatch).toBe(false);
    expect(assessSeller(seller, { ...defaultBrief, commercial: false }).allMatch).toBe(true);
    expect(assessSeller(exampleSellers[0], defaultBrief).checks.find(c => c.label === 'License claim')?.detail).toContain('unverified');
  });
  it('does not mutate the local catalog or brief', () => {
    const before = JSON.stringify({ exampleSellers, defaultBrief });
    recommendSeller(defaultBrief); assessSeller(exampleSellers[0], defaultBrief);
    expect(JSON.stringify({ exampleSellers, defaultBrief })).toBe(before);
  });
});
