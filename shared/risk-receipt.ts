import type { InterceptaTraitName } from '../apps/buyer/src/intercepta-response.ts';
import {
  CANDIDATE_NETWORK,
  isPrivateScanRecord,
  isPrivateScanStatus,
  privateCandidate,
  type PrivateCandidateId,
} from './private-risk.ts';

export const RISK_RECEIPT_SCHEMA_VERSION = 'risk-receipt-v1' as const;
export const RISK_RECEIPT_PROVENANCE_NOTE = 'candidate/address/attemptedAt/localReceivedAt/request totals are local; rawToxicScore is supplier-returned; traitsCount is locally derived; traitLabels are allowlisted supplier labels.' as const;

export type RiskReceipt = {
  schemaVersion: typeof RISK_RECEIPT_SCHEMA_VERSION;
  candidateId: PrivateCandidateId;
  address: string;
  state: 'pending' | 'completed' | 'unavailable';
  attemptedAt: string;
  localReceivedAt: string | null;
  supplierUpdatedAt: null;
  requestedNetwork: typeof CANDIDATE_NETWORK;
  rawToxicScore: number | null;
  traitsCount: number | null;
  traitLabels: InterceptaTraitName[];
  source: 'live' | 'unavailable' | 'pending';
  coverage: 'unverified';
  semantics: 'unverified';
  decision: 'hold';
  paymentEnabled: false;
  usedRequests: number;
  maxRequests: number;
  provenanceNote: typeof RISK_RECEIPT_PROVENANCE_NOTE;
};

export function buildRiskReceipt(status: unknown, candidateId: unknown): RiskReceipt | null {
  if (!isPrivateScanStatus(status)) return null;
  const candidate = privateCandidate(candidateId);
  if (!candidate) return null;

  const record = status.records.find(item => item.candidateId === candidate.id);
  if (!record || !isPrivateScanRecord(record)) return null;

  const completedRisk = record.state === 'completed' ? record.risk : null;
  const scan = completedRisk?.scan;
  if (record.state === 'completed' && (!completedRisk || !scan)) return null;

  return {
    schemaVersion: RISK_RECEIPT_SCHEMA_VERSION,
    candidateId: candidate.id,
    address: candidate.address,
    state: record.state,
    attemptedAt: new Date(record.attemptedAt).toISOString(),
    localReceivedAt: completedRisk ? new Date(completedRisk.checkedAt).toISOString() : null,
    supplierUpdatedAt: null,
    requestedNetwork: CANDIDATE_NETWORK,
    rawToxicScore: scan?.toxicScore ?? null,
    traitsCount: scan?.traitsCount ?? null,
    traitLabels: scan?.traitLabels ? [...scan.traitLabels] as InterceptaTraitName[] : [],
    source: record.state === 'pending' ? 'pending' : completedRisk ? 'live' : 'unavailable',
    coverage: 'unverified',
    semantics: 'unverified',
    decision: 'hold',
    paymentEnabled: false,
    usedRequests: status.usedRequests,
    maxRequests: status.maxRequests,
    provenanceNote: RISK_RECEIPT_PROVENANCE_NOTE,
  };
}
