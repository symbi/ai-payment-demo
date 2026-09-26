import { describe, expect, it } from 'vitest';
import { PRICE_ATOMIC, TEST_NETWORK, TEST_USDC, type PaymentTerms } from '../../../shared/contracts.ts';
import { checkPolicy, formatUsdc } from './policy.ts';
const payTo = '0x1111111111111111111111111111111111111111';
const terms: PaymentTerms = { scheme: 'exact', network: TEST_NETWORK, asset: TEST_USDC, amount: PRICE_ATOMIC, payTo };
describe('strict local authorization', () => {
  it('accepts local conditions but does not authorize payment', () => expect(checkPolicy(terms, payTo).decision).toBe('allow'));
  it.each([{ network: 'eip155:8453' }, { asset: payTo }, { payTo: '0x2222222222222222222222222222222222222222' }, ...['1001', '0', '-1', '1.5', '1e3', '01000', ' 1000', '9'.repeat(79)].map(amount => ({ amount }))])('denies invalid or unauthorized terms %j', change => {
    expect(checkPolicy({ ...terms, ...change }, payTo).decision).toBe('deny');
  });
  it('holds when recipient authorization is missing', () => expect(checkPolicy(terms, undefined).decision).toBe('hold'));
  it('formats exact atomic units', () => {
    expect(formatUsdc('1000')).toBe('0.001'); expect(formatUsdc('1')).toBe('0.000001'); expect(formatUsdc('1000000')).toBe('1');
  });
});
