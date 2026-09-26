import { expect, it } from 'vitest';
import { unavailableRisk, inspectUnverifiedScan } from './risk.ts';
const address = '0x1111111111111111111111111111111111111111';
it('holds without a key or with an unverified key; no network is invoked', () => {
  for (const key of [false, true]) expect(unavailableRisk(address, key)).toMatchObject({ address, decision: 'hold', source: 'unavailable' });
});
it.each([null, {}, { allow: true }, { score: 0 }, { status: 'safe' }])('never trusts unverified response %j', async payload => {
  expect(await inspectUnverifiedScan(address, async () => payload)).toMatchObject({ address, decision: 'hold', source: 'unavailable' });
});
it('holds on errors without leaking error bodies', async () => {
  const result = await inspectUnverifiedScan(address, async () => { throw new Error('secret-value'); });
  expect(result.decision).toBe('hold'); expect(JSON.stringify(result)).not.toContain('secret-value');
});
it('bounds a stalled scan even if transport ignores abort', async () => {
  const result = await inspectUnverifiedScan(address, () => new Promise(() => {}), 10);
  expect(result.decision).toBe('hold'); expect(result.reasons.join()).toContain('超时');
});
