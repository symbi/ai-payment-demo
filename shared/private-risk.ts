import { isSchemaDiagnostic, SCAN_DIAGNOSTIC_CODES } from './scan-diagnostic.ts';
import type { RiskResult } from './contracts.ts';
import { INTERCEPTA_TRAIT_NAMES } from '../apps/buyer/src/intercepta-response.ts';

/** Imported from the existing candidate document; contextual groups are not provider verdicts. */
export const PRIVATE_RISK_CANDIDATES = [
  { id: 'H1', address: '0x1d19b52b54e7ef5ea1a4b40b616165e798eac9f8', context: '制裁资料候选 A（文档线索待核验）' },
  { id: 'H2', address: '0x2C7DcD774b33e10367F7d6385479e04F97d179dc', context: '制裁资料候选 B（文档线索待核验）' },
  { id: 'G1', address: '0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc', context: '历史关联候选 A（当前风险待扫描）' },
  { id: 'G2', address: '0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936', context: '历史关联候选 B（当前风险待扫描）' },
  { id: 'L1', address: '0x05ff6964D21e5dAE3b1010D5AE0465b3c450F381', context: '机构标签候选 A（不代表安全）' },
  { id: 'L2', address: '0xf30ba13e4b04Ce5dC4D254Ae5FA95477800F0EB0', context: '机构标签候选 B（不代表安全）' },
  { id: 'L3', address: '0xaA8ba7D4611437141192e7ceCed531Bc0A133efb', context: '机构标签候选 C（不代表安全）' },
] as const;
export type PrivateCandidateId = typeof PRIVATE_RISK_CANDIDATES[number]['id'];
export const PRIVATE_SCAN_REVISION = 'private-risk-scan-v1' as const;
export const PRIVATE_SCAN_MAX_REQUESTS = 3 as const; // Default retained for existing installations.
export const PRIVATE_SCAN_REQUEST_CEILING = 1000 as const;
export const CANDIDATE_NETWORK = 'eip155:1' as const;
export type PrivateScanRecord = {
  candidateId: PrivateCandidateId;
  state: 'pending' | 'completed' | 'unavailable';
  attemptedAt: string;
  risk: RiskResult | null;
};
export type PrivateScanStatus = {
  contractRevision: typeof PRIVATE_SCAN_REVISION;
  mode: 'private-scan-only';
  paymentEnabled: false;
  ready: boolean;
  message: string;
  maxRequests: number;
  usedRequests: number;
  records: PrivateScanRecord[];
};

export type PrivateRiskPanelProps = {
  selectedId: PrivateCandidateId;
  status: PrivateScanStatus | null;
  loading: boolean;
  message: string;
  onSelect(id: PrivateCandidateId): void;
  onScan(): void;
  onRefresh(): void;
};

export function privateCandidate(id: unknown) {
  return PRIVATE_RISK_CANDIDATES.find(candidate => candidate.id === id);
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const textList = (value: unknown, max: number, length: number): value is string[] => Array.isArray(value) && value.length <= max && Array.from(value).every(item => typeof item === 'string' && item.length <= length);
const labels: ReadonlySet<string> = new Set(INTERCEPTA_TRAIT_NAMES);

export function isPrivateScanRecord(value: unknown): value is PrivateScanRecord {
  if (!object(value) || !keys(value, ['candidateId', 'state', 'attemptedAt', 'risk'])) return false;
  const candidate = privateCandidate(value.candidateId);
  if (!candidate || typeof value.attemptedAt !== 'string' || !Number.isFinite(Date.parse(value.attemptedAt))) return false;
  if (value.state === 'pending') return value.risk === null;
  if (!['completed', 'unavailable'].includes(String(value.state))) return false;
  if (value.risk === null) return value.state === 'unavailable';
  const risk = value.risk;
  if (!object(risk) || !keys(risk, ['address', 'checkedAt', 'provider', 'source', 'decision', 'reasons', 'scan']) ||
      risk.address !== candidate.address || risk.provider !== 'intercepta' || risk.decision !== 'hold' ||
      typeof risk.checkedAt !== 'string' || !Number.isFinite(Date.parse(risk.checkedAt)) || !textList(risk.reasons, 10, 600)) return false;
  if ((value.state === 'completed' && risk.source !== 'live') || (value.state === 'unavailable' && risk.source !== 'unavailable')) return false;
  const scan = risk.scan;
  if (!object(scan) || Object.keys(scan).some(key => !['transport', 'requestedNetwork', 'coverage', 'semantics', 'toxicScore', 'traitsCount', 'traitLabels', 'httpStatus', 'diagnosticCode', 'schemaDiagnostic', 'unknownTraitsCount', 'additionalFieldsCount'].includes(key)) ||
      scan.requestedNetwork !== CANDIDATE_NETWORK || scan.coverage !== 'unverified' || scan.semantics !== 'unverified' || !['received', 'unavailable'].includes(String(scan.transport))) return false;
  if (scan.httpStatus !== undefined && (!Number.isInteger(scan.httpStatus) || Number(scan.httpStatus) < 100 || Number(scan.httpStatus) > 599)) return false;
  if (scan.diagnosticCode !== undefined && !(SCAN_DIAGNOSTIC_CODES as readonly unknown[]).includes(scan.diagnosticCode)) return false;
  if (scan.schemaDiagnostic !== undefined && !isSchemaDiagnostic(scan.schemaDiagnostic)) return false;
  if (scan.unknownTraitsCount !== undefined && (!Number.isInteger(scan.unknownTraitsCount) || Number(scan.unknownTraitsCount) < 0 || scan.traitsCount === undefined || Number(scan.unknownTraitsCount) > Number(scan.traitsCount))) return false;
  if (scan.additionalFieldsCount !== undefined && (!Number.isInteger(scan.additionalFieldsCount) || Number(scan.additionalFieldsCount) < 0 || Number(scan.additionalFieldsCount) > 16384)) return false;
  if (risk.source === 'live' && (scan.transport !== 'received' || scan.toxicScore === undefined || scan.traitsCount === undefined || scan.traitLabels === undefined)) return false;
  if (scan.toxicScore !== undefined && (typeof scan.toxicScore !== 'number' || !Number.isFinite(scan.toxicScore))) return false;
  if (scan.traitsCount !== undefined && (!Number.isInteger(scan.traitsCount) || Number(scan.traitsCount) < 0 || Number(scan.traitsCount) > 100)) return false;
  if (scan.traitLabels !== undefined && (!textList(scan.traitLabels, 20, 120) || !scan.traitLabels.every(label => labels.has(label)) || scan.traitsCount === undefined || scan.traitLabels.length > Number(scan.traitsCount))) return false;
  return true;
}
export function isPrivateScanStatus(value: unknown): value is PrivateScanStatus {
  if (!object(value) || !keys(value, ['contractRevision', 'mode', 'paymentEnabled', 'ready', 'message', 'maxRequests', 'usedRequests', 'records']) ||
      value.contractRevision !== PRIVATE_SCAN_REVISION || value.mode !== 'private-scan-only' || value.paymentEnabled !== false || typeof value.ready !== 'boolean' ||
      typeof value.message !== 'string' || value.message.length > 600 || (!Number.isInteger(value.maxRequests) || Number(value.maxRequests) < 1 || Number(value.maxRequests) > PRIVATE_SCAN_REQUEST_CEILING) || !Number.isInteger(value.usedRequests) ||
      Number(value.usedRequests) < 0 || Number(value.usedRequests) > PRIVATE_SCAN_REQUEST_CEILING || !Array.isArray(value.records) || value.records.length !== value.usedRequests) return false;
  return Array.from(value.records).every(isPrivateScanRecord) && new Set(value.records.map(record => record.candidateId)).size === value.records.length;
}
