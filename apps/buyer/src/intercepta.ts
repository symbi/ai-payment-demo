import { describeScanSchema } from '../../../shared/scan-diagnostic.ts';
import type { RiskResult } from '../../../shared/contracts.ts';
import { isAddress } from './policy.ts';
import { MAX_INTERCEPTA_TRAIT_LABELS, parseInterceptaResponse, type InterceptaResponse } from './intercepta-response.ts';

export type ScanFacts = NonNullable<RiskResult['scan']>;
export type ObservedRisk = RiskResult & { observation?: InterceptaResponse };
export type RiskScanner = (address: string, network: string) => Promise<ObservedRisk>;
const ENDPOINT = 'https://api.web3antivirus.io/api/public/v2/extension/account/';
const MAX_BYTES = 16_384;
export function scanUnavailable(address: string, network: string, reason: string, received = false, diagnostic: Partial<ScanFacts> = {}): ObservedRisk {
  return { address, checkedAt: new Date().toISOString(), provider: 'intercepta', source: 'unavailable', decision: 'hold', reasons: [reason], scan: { transport: received ? 'received' : 'unavailable', requestedNetwork: network, coverage: 'unverified', semantics: 'unverified', ...diagnostic } };
}
/** Bounded observed facts only. No score threshold or chain coverage is inferred. */
export function parseQuickScan(value: unknown): Pick<ScanFacts, 'toxicScore' | 'traitsCount' | 'traitLabels'> | undefined {
  const parsed = parseInterceptaResponse(value);
  if (parsed.kind !== 'observed') return;
  return {
    toxicScore: parsed.toxicScore,
    traitsCount: parsed.traits.length + (parsed.unknownTraitsCount ?? 0),
    traitLabels: parsed.traits.slice(0, MAX_INTERCEPTA_TRAIT_LABELS).map(trait => trait.name),
  };
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
    if (!key || /[\r\n]/.test(key)) return scanUnavailable(address, network, 'API key unavailable.', false, { diagnosticCode: 'configuration' });
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let received = false; let httpStatus: number | undefined;
    try {
      const work = async (): Promise<ObservedRisk> => {
        const response = await transport(ENDPOINT + encodeURIComponent(address) + '/quick-scan', { method: 'GET', headers: { Accept: 'application/json', 'X-API-KEY': key }, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        httpStatus = response.status;
        if (response.status !== 200) { void response.body?.cancel().catch(() => {}); return scanUnavailable(address, network, 'Scan service unavailable.', false, { httpStatus, diagnosticCode: 'http-error' }); }
        received = true;
        const body = await boundedJson(response, controller.signal);
        const parsed = parseInterceptaResponse(body);
        if (parsed.kind !== 'observed') return scanUnavailable(address, network, 'Unsupported scan response. Review required.', true, { httpStatus, diagnosticCode: 'schema-unsupported', schemaDiagnostic: describeScanSchema(body) });
        const facts = {
          toxicScore: parsed.toxicScore,
          traitsCount: parsed.traits.length + (parsed.unknownTraitsCount ?? 0),
          traitLabels: parsed.traits.slice(0, MAX_INTERCEPTA_TRAIT_LABELS).map(trait => trait.name),
        };
        const labelNotice = parsed.traits.length > MAX_INTERCEPTA_TRAIT_LABELS
          ? ` Only ${MAX_INTERCEPTA_TRAIT_LABELS} allowlisted labels are displayed; this is not the full trait list.` : '';
        return { address, checkedAt: new Date().toISOString(), provider: 'intercepta', source: 'live', decision: 'hold',
          reasons: [`Scan received with ${facts.traitsCount} observed traits.${labelNotice} Risk meaning and network coverage are unverified. Payment unavailable.`],
          // Preserve the internal observation shape without forwarding provider free text.
          observation: { ...parsed, traits: parsed.traits.map(trait => ({ ...trait, description: '' })) },
          scan: { transport: 'received', ...facts, httpStatus, diagnosticCode: 'observed',
            unknownTraitsCount: parsed.unknownTraitsCount ?? 0, additionalFieldsCount: parsed.additionalFieldsCount ?? 0,
            requestedNetwork: network, coverage: 'unverified', semantics: 'unverified' } };
      };
      return await Promise.race([work(), new Promise<ObservedRisk>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Timeout')); }, timeoutMs); })]);
    } catch { return scanUnavailable(address, network, controller.signal.aborted ? 'Scan timed out. No automatic retry.' : 'Scan unavailable. Review required.', received, { ...(httpStatus === undefined ? {} : { httpStatus }), diagnosticCode: controller.signal.aborted ? 'timeout' : received ? 'body-invalid' : 'transport-error' }); }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  };
}
