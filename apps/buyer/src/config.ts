import { DEFAULT_SELLER_URL } from '../../../shared/contracts.ts';

export interface BuyerConfig { sellerUrl: string; payTo?: string; riskKeyConfigured: boolean; paymentRequested: boolean; }
/** Only explicit local seller origins are permitted. No client input controls this target. */
export function sellerOrigin(raw = DEFAULT_SELLER_URL): string {
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('SELLER_URL 必须为本机 HTTP 服务地址');
  return url.origin;
}
export function readConfig(env: NodeJS.ProcessEnv): BuyerConfig {
  return { sellerUrl: sellerOrigin(env.SELLER_URL), payTo: env.SELLER_PAY_TO, riskKeyConfigured: Boolean(env.INTERCEPTA_API_KEY?.trim()), paymentRequested: env.ENABLE_TESTNET_PAYMENTS === 'true' };
}
