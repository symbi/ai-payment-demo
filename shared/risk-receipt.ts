import { TRAIT_COUNT_KEYS, type TraitDiagnostic } from './scan-diagnostic.ts';
import type { InterceptaTraitName } from '../apps/buyer/src/intercepta-response.ts';
import type { ScanDiagnosticCode, SchemaDiagnostic } from './scan-diagnostic.ts';
import {
  CANDIDATE_NETWORK,
  isPrivateScanRecord,
  isPrivateScanStatus,
  privateCandidate,
  type PrivateCandidateId,
} from './private-risk.ts';

export const RISK_RECEIPT_SCHEMA_VERSION = 'risk-receipt-v2' as const;
export const RISK_RECEIPT_PROVENANCE_NOTE = 'candidate/address/attemptedAt/localReceivedAt/request totals are local; rawToxicScore is supplier-returned; traitsCount and diagnostic counts are locally derived; traitLabels and schema field names are allowlisted; no supplier timestamp or evidence ID is asserted.' as const;

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
  httpStatus: number | null;
  diagnosticCode: ScanDiagnosticCode | null;
  schemaDiagnostic: SchemaDiagnostic | null;
  unknownTraitsCount: number | null;
  additionalFieldsCount: number | null;
  source: 'live' | 'unavailable' | 'pending';
  coverage: 'unverified';
  semantics: 'unverified';
  decision: 'hold';
  paymentEnabled: false;
  usedRequests: number;
  maxRequests: number;
  provenanceNote: typeof RISK_RECEIPT_PROVENANCE_NOTE;
};

function copySchemaDiagnostic(diagnostic: SchemaDiagnostic | undefined): SchemaDiagnostic | null {
  if (!diagnostic) return null;
  return {
    ...(diagnostic.traitDiagnostic === undefined ? {} : { traitDiagnostic: Object.fromEntries(TRAIT_COUNT_KEYS.map(key => [key, diagnostic.traitDiagnostic![key]])) as TraitDiagnostic }),
    topLevelKeys: [...diagnostic.topLevelKeys],
    otherKeysCount: diagnostic.otherKeysCount,
    toxicScoreType: diagnostic.toxicScoreType,
    traitsType: diagnostic.traitsType,
    ...(diagnostic.traitsCount === undefined ? {} : { traitsCount: diagnostic.traitsCount }),
  };
}

export function buildRiskReceipt(status: unknown, candidateId: unknown): RiskReceipt | null {
  if (!isPrivateScanStatus(status)) return null;
  const candidate = privateCandidate(candidateId);
  if (!candidate) return null;

  const record = status.records.find(item => item.candidateId === candidate.id);
  if (!record || !isPrivateScanRecord(record)) return null;

  const risk = record.state === 'pending' ? null : record.risk;
  const completedRisk = record.state === 'completed' ? risk : null;
  const scan = completedRisk?.scan;
  if (record.state === 'completed' && (!completedRisk || !scan)) return null;
  const diagnosticScan = risk?.scan;

  return {
    schemaVersion: RISK_RECEIPT_SCHEMA_VERSION,
    candidateId: candidate.id,
    address: candidate.address,
    state: record.state,
    attemptedAt: new Date(record.attemptedAt).toISOString(),
    localReceivedAt: risk ? new Date(risk.checkedAt).toISOString() : null,
    supplierUpdatedAt: null,
    requestedNetwork: CANDIDATE_NETWORK,
    rawToxicScore: scan?.toxicScore ?? null,
    traitsCount: scan?.traitsCount ?? null,
    traitLabels: scan?.traitLabels ? [...scan.traitLabels] as InterceptaTraitName[] : [],
    httpStatus: diagnosticScan?.httpStatus ?? null,
    diagnosticCode: diagnosticScan?.diagnosticCode ?? null,
    schemaDiagnostic: copySchemaDiagnostic(diagnosticScan?.schemaDiagnostic),
    unknownTraitsCount: diagnosticScan?.unknownTraitsCount ?? null,
    additionalFieldsCount: diagnosticScan?.additionalFieldsCount ?? null,
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
