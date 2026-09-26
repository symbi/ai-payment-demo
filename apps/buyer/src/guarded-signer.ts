import type { PaymentTerms, RiskResult } from '../../../shared/contracts.ts';
import { checkPolicy, isAddress, isRecord } from './policy.ts';

export interface SigningRequest {
  readonly requestId: string;
  readonly intent: string;
  readonly terms: Readonly<PaymentTerms>;
}
/** Trusted backend adapter output, NEVER browser or LLM supplied.
 * The adapter must independently resolve authorization and verify real provider
 * response semantics and freshness. A source/live string is not proof of a scan.
 * No real adapter is provided here. Covers shared v1 PaymentTerms only, not all
 * native x402 resource/extra/signature fields; such integration needs more review.
 */
export interface CheckedSigningEvidence {
  request: SigningRequest;
  authorization: 'approved';
  risk: RiskResult;
}
export type GuardedSigningResult = Readonly<
  | { status: 'signed'; signature: string }
  | { status: 'held' | 'conflict' | 'signing_unknown'; reason: string }
>;
export interface GuardedSignerDependencies {
  authorizedPayTo: string | undefined;
  /** Server-owned capability, not a UI-controlled allow flag. */
  check: (request: SigningRequest) => Promise<unknown>;
  sign: (request: SigningRequest) => Promise<unknown>;
}
const MAX_REQUESTS = 1000;
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function snapshot(value: unknown): SigningRequest | undefined {
  try {
    const copy: unknown = structuredClone(value);
    if (!isRecord(copy) || !exactKeys(copy, ['requestId', 'intent', 'terms']) ||
      typeof copy.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(copy.requestId) ||
      typeof copy.intent !== 'string' || !copy.intent.trim() || copy.intent.length > 4000 || !isRecord(copy.terms)) return;
    const t = copy.terms;
    if (!exactKeys(t, ['scheme', 'network', 'asset', 'amount', 'payTo']) ||
      t.scheme !== 'exact' || typeof t.network !== 'string' || typeof t.asset !== 'string' ||
      typeof t.amount !== 'string' || typeof t.payTo !== 'string') return;
    return Object.freeze({ requestId: copy.requestId, intent: copy.intent,
      terms: Object.freeze({ scheme: 'exact', network: t.network, asset: t.asset, amount: t.amount, payTo: t.payTo }) });
  } catch { return; }
}
function fingerprint(r: SigningRequest): string {
  return JSON.stringify([r.requestId, r.intent, r.terms.scheme, r.terms.network, r.terms.asset, r.terms.amount, r.terms.payTo]);
}
function checkedFor(value: unknown, request: SigningRequest): boolean {
  try {
    const e: unknown = structuredClone(value);
    if (!isRecord(e) || e.authorization !== 'approved') return false;
    const bound = snapshot(e.request);
    if (!bound || fingerprint(bound) !== fingerprint(request) || !isRecord(e.risk)) return false;
    const r = e.risk;
    if (r.decision !== 'allow' || r.source !== 'live' || r.provider !== 'intercepta' ||
      typeof r.address !== 'string' || r.address.toLowerCase() !== request.terms.payTo.toLowerCase() ||
      typeof r.checkedAt !== 'string' || !Array.isArray(r.reasons) || !r.reasons.length ||
      !r.reasons.every(reason => typeof reason === 'string' && reason.trim().length > 0)) return false;
    const checkedAt = Date.parse(r.checkedAt);
    const age = Date.now() - checkedAt;
    return Number.isFinite(checkedAt) && age >= 0 && age <= 60_000;
  } catch { return false; }
}
const held = (reason: string): GuardedSigningResult => Object.freeze({ status: 'held', reason });
/** OFFLINE seam: no keys, network, payment route, or settlement operation.
 * At-most-once applies ONLY to this instance. Restart/new instance loses it.
 * Fixed capacity fails closed, never evicts identities. Not a production journal.
 * A returned signature is a callback outcome, never proof of settlement.
 */
export function createGuardedSigner(dependencies: GuardedSignerDependencies): {
  sign: (value: unknown) => Promise<GuardedSigningResult>;
} {
  const { authorizedPayTo, check, sign } = dependencies;
  const requests = new Map<string, { fingerprint: string; result: Promise<GuardedSigningResult> }>();
  return Object.freeze({
    sign(value: unknown): Promise<GuardedSigningResult> {
      const request = snapshot(value);
      if (!request) return Promise.resolve(held('Malformed or incomplete signing request'));
      const key = fingerprint(request);
      const previous = requests.get(request.requestId);
      if (previous) return previous.fingerprint === key ? previous.result : Promise.resolve(Object.freeze({
        status: 'conflict', reason: 'Request identity already reserved for different intent or terms',
      }));
      if (requests.size >= MAX_REQUESTS) return Promise.resolve(held('In-memory request capacity reached'));
      // Reserve the identity before either injected callback can run/re-enter.
      const result = Promise.resolve().then(async (): Promise<GuardedSigningResult> => {
        if (!isAddress(authorizedPayTo) || checkPolicy(request.terms, authorizedPayTo).decision !== 'allow') {
          return held('Local policy or configured recipient does not authorize these terms');
        }
        let evidence: unknown;
        try { evidence = await check(request); }
        catch { return held('Checked authorization or risk is unavailable'); }
        if (!checkedFor(evidence, request)) return held('Fresh verified risk and exact authorized terms are required');
        try {
          const signature: unknown = await sign(request);
          if (typeof signature === 'string' && signature.trim()) return Object.freeze({ status: 'signed', signature });
        } catch { /* It may have signed already; never automatically retry. */ }
        return Object.freeze({ status: 'signing_unknown', reason: 'Unknown signer outcome; this request will not be signed again' });
      });
      requests.set(request.requestId, { fingerprint: key, result });
      return result;
    },
  });
}
