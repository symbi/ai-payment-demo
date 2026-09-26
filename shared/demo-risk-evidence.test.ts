import { expect, it } from 'vitest';
import { DEMO_RISK_FIXTURES } from './demo-risk-evidence.ts';

it('provides one explicitly synthetic bounded scan shape for each Step 2 fixture', () => {
  expect(Object.keys(DEMO_RISK_FIXTURES).sort()).toEqual([
    'controlled-a', 'controlled-b', 'gray-complete', 'gray-stale', 'known-risk-a', 'known-risk-b',
  ]);
  for (const fixture of Object.values(DEMO_RISK_FIXTURES)) {
    expect(fixture.sourceLabel).toContain('synthetic');
    expect(fixture.scan.coverage).toBe('unverified');
    expect(fixture.scan.semantics).toBe('unverified');
    expect(fixture.scan.traitLabels?.length ?? 0).toBeLessThanOrEqual(20);
  }
});
