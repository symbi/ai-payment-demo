import type { PurchaseResult } from '../../../shared/contracts.ts';
import { TEST_USDC } from '../../../shared/contracts.ts';
import { displayAmount } from './api.ts';
export type EvidenceView = 'current' | 'continue' | 'block' | 'pause';
export interface PaymentCheckModel {
  source: string; offline: boolean; orderNote: string; amount: string; payTo: string; scanAddress: string;
  call: string; signal: string; score: string; traits: string; network: string; coverage: string;
  decision: 'Continue' | 'Block' | 'Pause'; reason: string; signature: string; payment: string;
}
/** Display-only examples: these never become PurchaseResult or payment input. */
export function paymentCheckModel(view: EvidenceView, result: PurchaseResult | null, uncertain: boolean): PaymentCheckModel {
  if (view !== 'current') return {
    source: 'Offline example · Synthetic evidence', offline: true, orderNote: 'Example order · One fixed seller',
    amount: '0.001 test USDC', payTo: '0x1111111111111111111111111111111111111111', scanAddress: '0x1111111111111111111111111111111111111111',
    call: 'Not called', signal: view === 'continue' ? 'Example policy conditions satisfied' : view === 'block' ? 'Example risk signal matched' : 'Example evidence unavailable',
    score: 'Not simulated', traits: 'Not simulated', network: 'Example: Base Sepolia', coverage: 'Not asserted',
    decision: view === 'continue' ? 'Continue' : view === 'block' ? 'Block' : 'Pause',
    reason: view === 'continue' ? 'Illustrates a permitted next step. No real authorization.' : view === 'block' ? 'A matched risk rule stops the proposed payment.' : 'Missing evidence pauses the proposed payment.',
    signature: 'Not signed', payment: 'Not paid',
  };
  const terms = result?.terms; const risk = result?.risk; const scan = risk?.scan;
  const unknown = uncertain || result?.status === 'settlement_unknown';
  return {
    source: !result ? 'Current request · No data' : risk?.source === 'live' ? 'Current request · Live provider response' : risk?.source === 'fixture' ? 'Current request · Fixture evidence' : 'Current request · Evidence unavailable',
    offline: false, orderNote: !result ? 'No order in this session' : unknown ? 'Last response · Current status unknown' : 'Current order · One fixed seller',
    amount: !terms ? 'Not available' : terms.asset.toLowerCase() === TEST_USDC.toLowerCase() ? `${displayAmount(terms.amount)} test USDC` : `${terms.amount} atomic · unsupported asset`,
    payTo: terms?.payTo ?? 'Not available', scanAddress: risk?.address ?? 'Not recorded',
    call: !scan ? 'No scan recorded' : scan.transport === 'received' ? 'Response received' : 'Unavailable',
    signal: risk?.source === 'live' ? 'Receipt is not a safety verdict' : risk?.source === 'fixture' ? 'Fixture, not a live scan' : 'No verified risk evidence',
    score: scan?.toxicScore === undefined ? 'Not available' : `${scan.toxicScore} · uninterpreted`,
    traits: scan?.traitsCount === undefined ? 'Not available' : String(scan.traitsCount),
    network: scan?.requestedNetwork ?? terms?.network ?? 'Not available', coverage: scan?.coverage ?? 'Unverified',
    // This UI cannot authorize payment. Current provider semantics remain unverified.
    decision: !unknown && result?.decision === 'deny' ? 'Block' : 'Pause',
    reason: unknown ? 'Latest state unknown. Confirm the existing request.' : !result ? 'Load an existing request or view a labeled example.' : result.decision === 'deny' ? (result.reasons[0] || 'Backend policy declined this request.') : 'Risk meaning and network coverage are unverified. No payment.',
    signature: unknown ? 'Unconfirmed' : result ? `${result.counters.sign} sign calls reported` : 'No record',
    payment: unknown ? 'Unconfirmed' : result?.status === 'paid' ? 'Backend reports paid · not chain verification' : result ? `${result.counters.settle} settle calls reported` : 'No record',
  };
}
