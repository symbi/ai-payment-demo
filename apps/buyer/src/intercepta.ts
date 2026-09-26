import type { RiskResult } from '../../../shared/contracts.ts';
import { isAddress, isRecord } from './policy.ts';

export type ScanFacts = NonNullable<RiskResult['scan']>;
export type ObservedRisk = RiskResult;
export type RiskScanner = (address: string, network: string) => Promise<ObservedRisk>;
const ENDPOINT = 'https://api.web3antivirus.io/api/public/v2/extension/account/';
const MAX_BYTES = 16_384;
export function scanUnavailable(address: string, network: string, reason: string, received = false): ObservedRisk {
  return { address, checkedAt: new Date().toISOString(), provider: 'intercepta', source: 'unavailable', decision: 'hold', reasons: [reason], scan: { transport: received ? 'received' : 'unavailable', requestedNetwork: network, coverage: 'unverified', semantics: 'unverified' } };
}
/** Observed empty-traits schema only. No score threshold or chain coverage is inferred. */
export function parseQuickScan(value: unknown): { toxicScore: number; traitsCount: 0 } | undefined {
  if (!isRecord(value) || Object.keys(value).length !== 2 || typeof value.toxicScore !== 'number' || !Number.isFinite(value.toxicScore) || !Array.isArray(value.traits) || value.traits.length !== 0) return;
  return { toxicScore: value.toxicScore, traitsCount: 0 };
}
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '') || Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) throw new Error('Unsupported body');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      if (signal.aborted) throw new Error('Canceled');
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) { cancel(); throw new Error('Body too large'); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}
/** Constructed only on server startup; construction does not call the provider.
 * Secret stays inside this closure. Caller supplies a validated server quote address,
 * never a URL. No redirects/retries; even valid facts always result in HOLD.
 */
export function createInterceptaScanner(apiKey: string | undefined, transport: typeof fetch = fetch, timeoutMs = 5_000): RiskScanner {
  const key = apiKey?.trim();
  return async (address, network) => {
    if (!isAddress(address)) return scanUnavailable(address, network, 'Invalid scan address.');
    if (!key || /[\r\n]/.test(key)) return scanUnavailable(address, network, 'API key unavailable.');
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let received = false;
    try {
      const work = async (): Promise<ObservedRisk> => {
        const response = await transport(ENDPOINT + encodeURIComponent(address) + '/quick-scan', { method: 'GET', headers: { Accept: 'application/json', 'X-API-KEY': key }, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        if (response.status !== 200) { void response.body?.cancel().catch(() => {}); return scanUnavailable(address, network, 'Scan service unavailable.'); }
        received = true;
        const facts = parseQuickScan(await boundedJson(response, controller.signal));
        if (!facts) return scanUnavailable(address, network, 'Unsupported scan response. Review required.', true);
        return { address, checkedAt: new Date().toISOString(), provider: 'intercepta', source: 'live', decision: 'hold', reasons: ['Scan received. Risk meaning and network coverage are unverified. Payment unavailable.'], scan: { transport: 'received', ...facts, requestedNetwork: network, coverage: 'unverified', semantics: 'unverified' } };
      };
      return await Promise.race([work(), new Promise<ObservedRisk>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Timeout')); }, timeoutMs); })]);
    } catch { return scanUnavailable(address, network, controller.signal.aborted ? 'Scan timed out. No automatic retry.' : 'Scan unavailable. Review required.', received); }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  };
}
