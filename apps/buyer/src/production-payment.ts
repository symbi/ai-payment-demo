import { ExactEvmScheme } from '@x402/evm/exact/client';
import { decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentRequirements, ResourceInfo } from '@x402/core/types';
import { PRICE_ATOMIC, RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';
import { validatePaidStructureReport } from '../../seller/src/report-validation.ts';
import { sellerOrigin } from './config.ts';
import { isAddress, isAtomic, isRecord } from './policy.ts';
import type { Quote } from './seller.ts';

/** Trusted version pinned before an order exists; never read from a paid response. */
export const EXPECTED_SOURCE_SHA256 = '1f9fb6a40a10aed8b91c0370e527b2e35e54ad8e0c56e2f448c2277a2fedd810';
export interface PinnedOrder {
  orderId: string;
  sellerOrigin: string;
  resourceUrl: string;
  resource: { url: string; description: string; mimeType: 'application/json' };
  expectedSourceSha256: string;
  wallet: string;
  requirements: {
    scheme: 'exact'; network: typeof TEST_NETWORK; asset: typeof TEST_USDC;
    amount: string; payTo: string; maxTimeoutSeconds: number;
    extra: { name: 'USDC'; version: '2' };
  };
}
export interface PreparedPayment {
  readonly operationId: string;
  readonly order: Readonly<PinnedOrder>;
  readonly quote: Readonly<Quote>;
  readonly typedData: unknown;
  readonly authorization: Readonly<{ from: string; to: string; value: string; validAfter: string; validBefore: string; nonce: string }>;
}
export interface SettlementProof {
  verified: true; orderId: string; operationId: string; transaction: string; network: string;
  asset: string; payTo: string; amount: string;
  /** Decoded from the verified transaction, never copied from the expectation. */
  observedAuthorization: PreparedPayment['authorization'];
  /** Reconstructed from the verified transaction's EIP-3009 signature fields. */
  observedSignature: string;
}
export interface SettlementExpectation {
  readonly orderId: string; readonly operationId: string; readonly network: string; readonly asset: string;
  readonly authorization: PreparedPayment['authorization']; readonly signature: string;
}
export interface ProductionPaymentOptions {
  /** This is the real signer boundary. Call only through ProtectedPayment's final gate. */
  signer: { address: `0x${string}`; signTypedData: (input: unknown) => Promise<`0x${string}`> };
  /** No default transport. Supplying one alone does not establish payment readiness. */
  fetcher?: typeof fetch;
  /** Independently verify transaction inclusion/success on the expected chain and token,
   * then decode its EIP-3009 calldata (payer, recipient, amount, validity window, nonce,
   * and signature) and matching transfer evidence. Returned observed fields must come
   * from that transaction, never echo expected input or the seller's receipt.
   * Absent verification means unknown, even for a successful seller receipt.
   */
  verifySettlement?: (receipt: unknown, order: Readonly<PinnedOrder>, expectation: Readonly<SettlementExpectation>) => Promise<unknown>;
}
const exactKeys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const operationIdPattern = /^(?!__proto__$)(?!constructor$)(?!prototype$)[A-Za-z0-9_-]{8,128}$/;
function canonical(value: unknown): string {
  if (typeof value === 'bigint') return `{"bigint":"${value}"}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function decimal(value: unknown): string | undefined {
  if (typeof value === 'bigint' && value >= 0n) return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value)) return value;
}
function orderValid(order: PinnedOrder, signerAddress: string): boolean {
  try {
    const origin = sellerOrigin(order.sellerOrigin);
    const t = order.requirements;
    return /^[A-Za-z0-9_-]{8,128}$/.test(order.orderId) && origin === order.sellerOrigin &&
      order.resourceUrl === `${origin}${RESOURCE_PATH}` && isRecord(order.resource) &&
      exactKeys(order.resource, ['url', 'description', 'mimeType']) && order.resource.url === order.resourceUrl &&
      typeof order.resource.description === 'string' && !!order.resource.description.trim() &&
      order.resource.mimeType === 'application/json' && order.expectedSourceSha256 === EXPECTED_SOURCE_SHA256 &&
      isAddress(order.wallet) && order.wallet.toLowerCase() === signerAddress.toLowerCase() &&
      isRecord(t) && exactKeys(t, ['scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds', 'extra']) &&
      t.scheme === 'exact' && t.network === TEST_NETWORK && t.asset.toLowerCase() === TEST_USDC.toLowerCase() &&
      isAtomic(t.amount) && BigInt(t.amount) <= BigInt(PRICE_ATOMIC) && isAddress(t.payTo) &&
      Number.isSafeInteger(t.maxTimeoutSeconds) && t.maxTimeoutSeconds > 0 && t.maxTimeoutSeconds <= 600 &&
      isRecord(t.extra) && exactKeys(t.extra, ['name', 'version']) && t.extra.name === 'USDC' && t.extra.version === '2';
  } catch { return false; }
}
function boundQuote(order: PinnedOrder, quote: Quote): boolean {
  return quote.method === 'GET' && quote.url === order.resourceUrl && isRecord(quote.full) &&
    exactKeys(quote.full, ['x402Version', 'accepts', 'resource']) && quote.full.x402Version === 2 &&
    Array.isArray(quote.full.accepts) && quote.full.accepts.length === 1 &&
    canonical(quote.full.accepts[0]) === canonical(order.requirements) &&
    isRecord(quote.full.resource) && canonical(quote.full.resource) === canonical(order.resource);
}
async function boundedJson(response: Response): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body ||
    Number(response.headers.get('content-length')) > 65_536) throw new Error('Unsupported response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 65_536) throw new Error('Response too large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

/** Not wired into index.ts. A live risk allow policy and independent settlement verifier are absent. */
export function createProductionPaymentAdapter(inputOrder: PinnedOrder, options: ProductionPaymentOptions) {
  if (!orderValid(inputOrder, options.signer.address)) throw new Error('Pinned order invalid');
  const order = freeze(structuredClone(inputOrder));
  return Object.freeze({
    async prepare(quoteInput: Quote, operationId: string): Promise<PreparedPayment> {
      if (!operationIdPattern.test(operationId)) throw new Error('Operation identity invalid');
      const quote = freeze(structuredClone(quoteInput));
      if (!boundQuote(order, quote)) throw new Error('Quote differs from pinned order');
      let typedData: unknown;
      const stop = new Error('Captured SDK signing input');
      // SDK 2.27.0 generates one nonce/window and calls this exact signer seam. Throw before
      // any signature exists; no dummy signature or second SDK payload is retained.
      const captureSigner = {
        address: order.wallet as `0x${string}`,
        signTypedData: async (input: unknown): Promise<`0x${string}`> => {
          typedData = freeze(structuredClone(input));
          throw stop;
        },
      };
      try { await new ExactEvmScheme(captureSigner).createPaymentPayload(2, order.requirements as PaymentRequirements); }
      catch (error) { if (error !== stop) throw new Error('SDK EIP-3009 preparation unavailable'); }
      if (!isRecord(typedData) || !isRecord(typedData.message) || !isRecord(typedData.domain) ||
        !isRecord(typedData.types) || !exactKeys(typedData.types, ['TransferWithAuthorization']) ||
        typedData.primaryType !== 'TransferWithAuthorization') throw new Error('SDK signing input unsupported');
      const message = typedData.message;
      if (!isAddress(message.from) || message.from.toLowerCase() !== order.wallet.toLowerCase() ||
        !isAddress(message.to) || message.to.toLowerCase() !== order.requirements.payTo.toLowerCase() ||
        decimal(message.value) !== order.requirements.amount || !/^0x[0-9a-fA-F]{64}$/.test(String(message.nonce))) throw new Error('SDK signing input changed order');
      const authorization = freeze({ from: message.from, to: message.to, value: decimal(message.value)!,
        validAfter: decimal(message.validAfter) ?? '', validBefore: decimal(message.validBefore) ?? '', nonce: message.nonce as string });
      if (!authorization.validAfter || !authorization.validBefore) throw new Error('SDK signing window invalid');
      return freeze({ operationId, order, quote, typedData, authorization });
    },
    /** To be supplied to ProtectedPayment.signTypedData only after its durable reservation and final gate. */
    signPrepared(prepared: PreparedPayment, actual: unknown): Promise<`0x${string}`> {
      if (prepared.order !== order || canonical(actual) !== canonical(prepared.typedData)) throw new Error('Final signing input differs from prepared SDK snapshot');
      return options.signer.signTypedData(actual);
    },
    validateReport(value: unknown): boolean {
      return validatePaidStructureReport(value, order.expectedSourceSha256).ok;
    },
    async submit(prepared: PreparedPayment, signature: string, operationId: string): Promise<unknown> {
      if (prepared.order !== order || prepared.operationId !== operationId || !boundQuote(order, prepared.quote) || !options.fetcher || !options.verifySettlement ||
        !operationIdPattern.test(operationId) || !/^0x[0-9a-fA-F]{130}$/.test(signature)) return { settlement: 'unknown' };
      const payload = { x402Version: 2, payload: { authorization: prepared.authorization, signature },
        resource: (prepared.quote.full as { resource: ResourceInfo }).resource,
        accepted: order.requirements };
      let response: Response;
      try {
        response = await options.fetcher(order.resourceUrl, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store',
          headers: { Accept: 'application/json', 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload) }, signal: AbortSignal.timeout(10_000) });
      } catch { return { settlement: 'unknown' }; }
      if (response.status !== 200) { await response.body?.cancel().catch(() => {}); return { settlement: 'unknown' }; }
      const header = response.headers.get('payment-response');
      if (!header || header.length > 16_384) { await response.body?.cancel().catch(() => {}); return { settlement: 'unknown' }; }
      let receipt: unknown;
      try { receipt = decodePaymentResponseHeader(header); }
      catch { await response.body?.cancel().catch(() => {}); return { settlement: 'unknown' }; }
      if (!isRecord(receipt) || receipt.success !== true || receipt.network !== TEST_NETWORK ||
        typeof receipt.transaction !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(receipt.transaction) ||
        (Object.hasOwn(receipt, 'payer') && (typeof receipt.payer !== 'string' || receipt.payer.toLowerCase() !== prepared.authorization.from.toLowerCase())) ||
        (Object.hasOwn(receipt, 'amount') && receipt.amount !== order.requirements.amount)) {
        await response.body?.cancel().catch(() => {}); return { settlement: 'unknown' };
      }
      const expectation = freeze({ orderId: order.orderId, operationId, network: TEST_NETWORK, asset: TEST_USDC,
        authorization: prepared.authorization, signature });
      let proof: unknown;
      try { proof = await options.verifySettlement(receipt, order, expectation); }
      catch { return { settlement: 'unknown' }; }
      if (!isRecord(proof) || !exactKeys(proof, ['verified', 'orderId', 'operationId', 'transaction', 'network', 'asset', 'payTo', 'amount', 'observedAuthorization', 'observedSignature']) ||
        proof.verified !== true || proof.orderId !== order.orderId || proof.operationId !== operationId || proof.transaction !== receipt.transaction ||
        proof.network !== TEST_NETWORK || typeof proof.asset !== 'string' || proof.asset.toLowerCase() !== TEST_USDC.toLowerCase() ||
        typeof proof.payTo !== 'string' || proof.payTo.toLowerCase() !== order.requirements.payTo.toLowerCase() ||
        proof.amount !== order.requirements.amount || !isRecord(proof.observedAuthorization) ||
        !exactKeys(proof.observedAuthorization, ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce']) ||
        canonical(proof.observedAuthorization) !== canonical(prepared.authorization) ||
        typeof proof.observedSignature !== 'string' || proof.observedSignature.toLowerCase() !== signature.toLowerCase()) return { settlement: 'unknown' };
      let report: unknown;
      try { report = await boundedJson(response); }
      catch { report = undefined; }
      const validated = validatePaidStructureReport(report, order.expectedSourceSha256);
      return { settlement: 'settled', receipt: { success: true, operationId, network: TEST_NETWORK,
        asset: TEST_USDC, payTo: order.requirements.payTo, amount: order.requirements.amount },
        report: validated.ok ? validated.report : undefined };
    },
  });
}
