import { decodePaymentRequiredHeader } from '@x402/core/http';
import { RESOURCE_PATH, type PaymentTerms } from '../../../shared/contracts.ts';
import { isRecord } from './policy.ts';

export interface Quote { terms: PaymentTerms; fingerprint: string; full: unknown; url: string; method: 'GET' }
export class SellerError extends Error {}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function parseQuote(payload: unknown): Quote {
  if (!isRecord(payload) || payload.x402Version !== 2 || !Array.isArray(payload.accepts) || payload.accepts.length !== 1) throw new SellerError('402 条件缺失、版本不支持或存在多项歧义；暂停');
  const item: unknown = payload.accepts[0];
  if (!isRecord(item) || item.scheme !== 'exact' || !['network', 'asset', 'amount', 'payTo'].every(key => typeof item[key] === 'string' && (item[key] as string).length <= 128) || !Number.isSafeInteger(item.maxTimeoutSeconds) || (item.maxTimeoutSeconds as number) <= 0) throw new SellerError('付款条件结构不完整或不受支持；暂停');
  return { terms: { scheme: 'exact', network: item.network as string, asset: item.asset as string, amount: item.amount as string, payTo: item.payTo as string }, fingerprint: canonical(payload), full: structuredClone(payload), url: isRecord(payload.resource) && typeof payload.resource.url === 'string' ? payload.resource.url : '', method: 'GET' };
}

/** Bound body consumption as well as connection time. Never reflect a seller's raw errors. */
async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new SellerError('卖方响应为空');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 32_768) throw new SellerError('卖方响应过大；暂停');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}
export class SellerClient {
  constructor(private origin: string, private fetcher: typeof fetch = fetch, private timeoutMs = 4000) {}
  async quote(): Promise<Quote> {
    try {
      const response = await this.fetcher(`${this.origin}${RESOURCE_PATH}`, { redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs), headers: { Accept: 'application/json' } });
      if (response.status !== 402) { await response.body?.cancel(); throw new SellerError(`卖方返回 HTTP ${response.status}，未取得 402 付款条件；暂停`); }
      const header = response.headers.get('payment-required');
      if (!header || header.length > 32_768 || !/^[A-Za-z0-9+/]+={0,2}$/.test(header)) { await response.body?.cancel(); throw new SellerError('缺少或无法识别 PAYMENT-REQUIRED 响应头；暂停'); }
      // SDK decodes base64 only; explicit validation below is mandatory.
      await response.body?.cancel();
      return parseQuote(decodePaymentRequiredHeader(header));
    } catch (error) {
      if (error instanceof SellerError) throw error;
      throw new SellerError('卖方连接失败、超时或响应格式未知；暂停');
    }
  }
  async health(): Promise<{ connected: boolean; ready: boolean; message: string }> {
    try {
      const response = await this.fetcher(`${this.origin}/health`, { redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) { await response.body?.cancel(); return { connected: true, ready: false, message: `卖方健康接口返回 HTTP ${response.status}` }; }
      const body = await boundedJson(response);
      // Connection alone is never payment/facilitator readiness.
      return { connected: true, ready: isRecord(body) && body.ready === true, message: '已连接卖方健康接口；实际报价以请求结果为准' };
    } catch { return { connected: false, ready: false, message: '卖方连接失败、超时或健康响应无法解析' }; }
  }
}
