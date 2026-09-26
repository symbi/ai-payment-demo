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
    /** Only an empty traits array has a verified response shape so far. */
    traitsCount?: 0;
    requestedNetwork: string;
    coverage: 'unverified';
    semantics: 'unverified';
  };
}
export interface FlowEvent { at: string; step: string; message: string }
export type PurchaseStatus = 'quoted' | 'denied' | 'held' | 'paid' | 'settlement_unknown' | 'error';
export interface PurchaseResult {
  requestId: string; status: PurchaseStatus; decision: Decision; reasons: string[];
  terms?: PaymentTerms; risk?: RiskResult; data?: unknown; transaction?: string;
  events: FlowEvent[]; counters: { sign: number; settle: number };
  paymentEnabled: boolean; aiMode: 'not_configured' | 'live';
}
export interface WeatherData {
  source: 'demo-fixture'; city: 'Tokyo'; weather: string; temperatureC: number;
  notice: string;
}
