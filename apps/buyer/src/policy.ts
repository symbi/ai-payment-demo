import { PRICE_ATOMIC, TEST_NETWORK, TEST_USDC, type Decision, type PaymentTerms } from '../../../shared/contracts.ts';

export const isAddress = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/.test(value);
export const isAtomic = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value);
export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Display only: authorization uses BigInt, never a floating point dollar value. */
export function formatUsdc(atomic: string): string {
  if (!isAtomic(atomic)) throw new Error('金额必须为正原子整数');
  const digits = atomic.padStart(7, '0');
  return `${digits.slice(0, -6)}.${digits.slice(-6)}`.replace(/\.?0+$/, '');
}

export function checkPolicy(terms: PaymentTerms, authorizedPayTo: string | undefined): { decision: Decision; reasons: string[] } {
  const reasons: string[] = [];
  if (terms.scheme !== 'exact') reasons.push('付款模式不受支持');
  if (terms.network !== TEST_NETWORK) reasons.push('网络必须为 Base Sepolia 测试网');
  if (terms.asset.toLowerCase() !== TEST_USDC.toLowerCase()) reasons.push('仅允许指定的测试 USDC');
  if (!isAtomic(terms.amount)) reasons.push('金额必须为正原子整数');
  else if (BigInt(terms.amount) > BigInt(PRICE_ATOMIC)) reasons.push('金额超过单次预算 1000 原子单位（0.001 测试 USDC）');
  if (!isAddress(terms.payTo)) reasons.push('收款地址无效');
  else if (isAddress(authorizedPayTo) && terms.payTo.toLowerCase() !== authorizedPayTo.toLowerCase()) reasons.push('收款方不在后台授权范围内');
  if (reasons.length) return { decision: 'deny', reasons };
  if (!isAddress(authorizedPayTo)) return { decision: 'hold', reasons: ['后台尚未配置有效的 SELLER_PAY_TO，不能确认收款方'] };
  return { decision: 'allow', reasons: ['本地网络、币种、预算和收款方符合；这不代表风险扫描通过或付款授权'] };
}
