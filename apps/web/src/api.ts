import type { PurchaseResult, ProtectedPaymentOutcome } from '../../../shared/contracts.ts';
import type { BuyerHealth } from '../../buyer/src/service.ts';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const oneOf = (v: unknown, allowed: string[]): v is string => typeof v === 'string' && allowed.includes(v);
export class ApiError extends Error { constructor(message: string, public status?: number) { super(message); } }
export async function api<T>(path: string, validate: (value: unknown) => value is T, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  } catch { throw new ApiError('Connection failed or timed out.'); }
  let value: unknown;
  try { value = await response.json(); } catch { throw new ApiError('Response is not readable.', response.status); }
  if (!response.ok) throw new ApiError(record(value) && typeof value.error === 'string' ? value.error : 'Request unavailable.', response.status);
  if (!validate(value)) throw new ApiError('Unsupported response. Status unconfirmed.');
  return value;
}
export function isHealth(v: unknown): v is BuyerHealth {
  return record(v) && typeof v.resourcePath === 'string' && record(v.buyer) && typeof v.buyer.connected === 'boolean' && record(v.seller) && typeof v.seller.connected === 'boolean' && typeof v.seller.ready === 'boolean' && typeof v.seller.message === 'string' && record(v.configuration) && typeof v.configuration.payToConfigured === 'boolean' && typeof v.configuration.interceptaKeyConfigured === 'boolean' && typeof v.paymentEnabled === 'boolean';
}
export function isPurchase(v: unknown): v is PurchaseResult {
  if (!record(v) || typeof v.requestId !== 'string' || !oneOf(v.status, ['quoted', 'denied', 'held', 'paid', 'settlement_unknown', 'error']) || !oneOf(v.decision, ['allow', 'deny', 'hold']) || !strings(v.reasons) || typeof v.paymentEnabled !== 'boolean' || !oneOf(v.aiMode, ['not_configured', 'live'])) return false;
  if (!record(v.counters) || ![v.counters.sign, v.counters.settle].every(x => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0)) return false;
  if (!Array.isArray(v.events) || !v.events.every(e => record(e) && ['at', 'step', 'message'].every(key => typeof e[key] === 'string'))) return false;
  if (v.terms !== undefined && (!record(v.terms) || !['scheme', 'network', 'asset', 'amount', 'payTo'].every(key => typeof (v.terms as Record<string, unknown>)[key] === 'string'))) return false;
  if (v.risk !== undefined && (!record(v.risk) || !oneOf(v.risk.decision, ['allow', 'deny', 'hold']) || !oneOf(v.risk.source, ['live', 'fixture', 'unavailable']) || !strings(v.risk.reasons))) return false;
  if (record(v.risk) && (typeof v.risk.address !== 'string' || typeof v.risk.checkedAt !== 'string' || !oneOf(v.risk.provider, ['intercepta', 'test']))) return false;
  if (record(v.risk) && v.risk.scan !== undefined) {
    const scan = v.risk.scan;
    if (!record(scan) || !oneOf(scan.transport, ['received', 'unavailable']) || scan.coverage !== 'unverified' || scan.semantics !== 'unverified' || typeof scan.requestedNetwork !== 'string') return false;
    if (scan.toxicScore !== undefined && (typeof scan.toxicScore !== 'number' || !Number.isFinite(scan.toxicScore))) return false;
    if (scan.traitsCount !== undefined && scan.traitsCount !== 0) return false;
  }
  if (v.execution !== undefined && !isExecution(v.execution)) return false;
  return true;
}
export function displayAmount(atomic: string): string {
  if (!/^[1-9][0-9]{0,77}$/.test(atomic)) return 'Invalid amount';
  const digits = atomic.padStart(7, '0');
  return `${digits.slice(0, -6)}.${digits.slice(-6)}`.replace(/\.?0+$/, '');
}

const nullableString = (value: unknown) => value === null || typeof value === 'string';
/** Validate every public execution field; missing legacy execution stays unreported. */
export function isExecution(v: unknown): v is ProtectedPaymentOutcome {
  if (!record(v) || typeof v.operationId !== 'string' || !v.operationId.trim() || !oneOf(v.decision, ['allow', 'deny', 'hold']) || !strings(v.reasonCodes) || !strings(v.reasons)) return false;
  if (!nullableString(v.checkedQuoteHash) || !nullableString(v.signingInputHash) || !oneOf(v.signing, ['not_signed', 'signed', 'unknown']) || !oneOf(v.submission, ['not_submitted', 'submitted', 'unknown']) || !oneOf(v.settlement, ['not_settled', 'settled', 'failed', 'unknown']) || v.retryAllowed !== false || typeof v.taskComplete !== 'boolean') return false;
  if (v.taskComplete && (v.settlement !== 'settled' || v.signing !== 'signed' || v.submission !== 'submitted')) return false;
  if (v.submission === 'submitted' && v.signing === 'not_signed') return false;
  if (v.settlement === 'settled' && (v.signing === 'not_signed' || v.submission === 'not_submitted')) return false;
  const e = v.evidence;
  return record(e) && oneOf(e.source, ['live', 'fixture', 'unavailable']) && ['evidenceId', 'address', 'checkedAt', 'providerEvidenceNetwork'].every(key => nullableString(e[key])) && typeof e.requestedPaymentNetwork === 'string' && oneOf(e.coverage, ['verified', 'unverified', 'mismatch']) && oneOf(e.semantics, ['verified', 'unverified']);
}
export function executionUnknown(result: PurchaseResult | null): boolean {
  const e = result?.execution;
  return result?.status === 'settlement_unknown' || !!e && [e.signing, e.submission, e.settlement].includes('unknown');
}
