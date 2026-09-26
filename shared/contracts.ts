/** Version 1: only the coordinator changes this file. USDC amounts are atomic integers. */
export const CONTRACT_VERSION = '1';
export const TEST_NETWORK = 'eip155:84532' as const;
export const TEST_CHAIN_ID = 84532;
export const TEST_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
export const PRICE_ATOMIC = '1000';
export const RESOURCE_PATH = '/api/contract-insights';
export const DEFAULT_SELLER_URL = 'http://127.0.0.1:4032';
export type Decision = 'allow' | 'deny' | 'hold';
export type EvidenceSource = 'live' | 'fixture' | 'unavailable';
export interface PaymentTerms {
  scheme: 'exact'; network: string; asset: string; amount: string; payTo: string;
}
export interface RiskResult {
  decision: Decision; source: EvidenceSource; reasons: string[];
  address: string; checkedAt: string; provider: 'intercepta' | 'test';
  /** Transport facts only; receipt or a zero score does not establish safety or chain coverage. */
  scan?: {
    transport: 'received' | 'unavailable';
    toxicScore?: number;
    /** Bounded observed count (0..100); not a safety decision. */
    traitsCount?: number;
    /** Up to 20 allowlisted labels, at most 120 characters each. */
    traitLabels?: string[];
    requestedNetwork: string;
    coverage: 'unverified';
    semantics: 'unverified';
  };
}
export interface FlowEvent { at: string; step: string; message: string }
/** Public execution facts only. These types do not authorize or execute a payment. */
export interface PaymentEvidenceSummary {
  source: EvidenceSource;
  evidenceId: string | null;
  address: string | null;
  checkedAt: string | null;
  requestedPaymentNetwork: string;
  providerEvidenceNetwork: string | null;
  /** Same address on two networks is not proof of coverage. */
  coverage: 'verified' | 'unverified' | 'mismatch';
  semantics: 'verified' | 'unverified';
}
export interface PaymentExecutionFacts {
  operationId: string;
  /** A policy decision, not proof of signing, settlement, or delivery. */
  decision: Decision;
  reasonCodes: string[];
  reasons: string[];
  evidence: PaymentEvidenceSummary;
  checkedQuoteHash: string | null;
  /** Digest only; never expose executable signatures or wallet secrets. */
  signingInputHash: string | null;
  signing: 'not_signed' | 'signed' | 'unknown';
  submission: 'not_submitted' | 'submitted' | 'unknown';
  /** Failure must be established; a timeout or HTTP 402 alone means unknown. */
  settlement: 'not_settled' | 'settled' | 'failed' | 'unknown';
  /** This slice never automatically creates a new payment authorization on retry. */
  retryAllowed: false;
}
/** Completion also requires validated delivery; settled alone is insufficient. */
export type IdentifiedPaymentOutcome = PaymentExecutionFacts & (
  | { taskComplete: false }
  | { taskComplete: true; settlement: 'settled' }
);
/** No trusted operation identity: expose the stop reason without asserting unsigned/unpaid.
 * This branch never permits retry and must not be repaired by inventing an ID.
 */
export interface UnidentifiedPaymentOutcome {
  identity: 'unavailable';
  operationId: null;
  decision: 'hold';
  reasonCodes: string[];
  reasons: string[];
  evidence: {
    source: 'unavailable'; evidenceId: null; address: null; checkedAt: null;
    requestedPaymentNetwork: string; providerEvidenceNetwork: null;
    coverage: 'unverified'; semantics: 'unverified';
  };
  checkedQuoteHash: null;
  signingInputHash: null;
  signing: 'unknown'; submission: 'unknown'; settlement: 'unknown';
  retryAllowed: false;
  taskComplete: false;
}
export type ProtectedPaymentOutcome = IdentifiedPaymentOutcome | UnidentifiedPaymentOutcome;
export type PurchaseStatus = 'quoted' | 'denied' | 'held' | 'paid' | 'settlement_unknown' | 'error';
export interface PurchaseResult {
  requestId: string; status: PurchaseStatus; decision: Decision; reasons: string[];
  terms?: PaymentTerms; risk?: RiskResult; data?: unknown; transaction?: string;
  events: FlowEvent[]; counters: { sign: number; settle: number };
  paymentEnabled: boolean; aiMode: 'not_configured' | 'live';
  /** Absent on legacy responses: execution is unreported, NOT proven unsigned/unpaid. */
  execution?: ProtectedPaymentOutcome;
}
export interface WeatherData {
  source: 'demo-fixture'; city: 'Tokyo'; weather: string; temperatureC: number;
  notice: string;
}
