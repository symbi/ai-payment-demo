import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PRICE_ATOMIC, RESOURCE_PATH, TEST_CHAIN_ID, TEST_NETWORK, TEST_USDC, type ProtectedPaymentOutcome, type UnidentifiedPaymentOutcome } from '../../../shared/contracts.ts';
import { isAddress, isAtomic, isRecord } from './policy.ts';
import type { Quote } from './seller.ts';

const fields = [
  { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
] as const;
const idPattern = /^(?!__proto__$)(?!constructor$)(?!prototype$)[A-Za-z0-9_-]{8,128}$/;
const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v, k));
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const number = (value: unknown): bigint | undefined => {
  if (typeof value === 'bigint' && value >= 0n) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value)) return BigInt(value);
};
function canonical(value: unknown): string {
  if (typeof value === 'bigint') return `{"bigint":"${value}"}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

/** A capability available only by explicit server construction, never from HTTP input. */
export interface TestPaymentDependencies {
  testFixtureOnly: true;
  journalPath: string;
  /** Bounded backend callback wait. A timeout never means the side effect did not happen. */
  timeoutMs?: number;
  authorize: (request: Readonly<{ requestId: string; prompt: string; quoteHash: string; url: string; method: 'GET' }>) => Promise<unknown>;
  assess: (quote: Readonly<Quote>) => Promise<unknown>;
  createSigningInput: (approved: unknown) => Promise<unknown>;
  /** Test-only fault injection after the durable signing-input write. */
  afterSigningInputPersisted?: () => Promise<void>;
  signTypedData: (input: unknown) => Promise<unknown>;
  submit: (quote: Readonly<Quote>, signature: string, operationId: string) => Promise<unknown>;
  validateReport: (value: unknown) => boolean;
}
interface Authorization {
  requestId: string; prompt: string; taskId: string; operationId: string; authorizationId: string;
  quoteHash: string; url: string; method: 'GET'; wallet: string;
  expiresAt: string; taskBudgetAtomic: string; typedData: unknown;
}
interface StoredOperation {
  taskId: string; authorizationId: string; requestId: string; promptHash: string;
  quoteHash: string; amount: string; evidenceId: string; evidenceAddress: string; evidenceCheckedAt: string;
  signingInputHash: string | null;
  signing: ProtectedPaymentOutcome['signing'];
  submission: ProtectedPaymentOutcome['submission'];
  settlement: ProtectedPaymentOutcome['settlement'];
  taskComplete: boolean; reasonCode: string;
}
interface Journal { version: 1; taskLimits: Record<string, string>; operations: Record<string, StoredOperation> }
function validJournal(value: unknown): value is Journal {
  if (!isRecord(value) || !keys(value, ['version', 'taskLimits', 'operations']) || value.version !== 1 || !isRecord(value.taskLimits) || !isRecord(value.operations)) return false;
  if (Object.values(value.taskLimits).some(v => !isAtomic(v))) return false;
  for (const [id, v] of Object.entries(value.operations)) {
    if (!idPattern.test(id) || !isRecord(v) || !keys(v, ['taskId', 'authorizationId', 'requestId', 'promptHash', 'quoteHash', 'amount', 'evidenceId', 'evidenceAddress', 'evidenceCheckedAt', 'signingInputHash', 'signing', 'submission', 'settlement', 'taskComplete', 'reasonCode']) ||
      typeof v.taskId !== 'string' || !idPattern.test(v.taskId) || typeof v.authorizationId !== 'string' || !idPattern.test(v.authorizationId) ||
      typeof v.requestId !== 'string' || !idPattern.test(v.requestId) || !isAtomic(v.amount) ||
      !['not_signed', 'signed', 'unknown'].includes(String(v.signing)) || !['not_submitted', 'submitted', 'unknown'].includes(String(v.submission)) ||
      !['not_settled', 'settled', 'failed', 'unknown'].includes(String(v.settlement)) || typeof v.taskComplete !== 'boolean' ||
      !['string'].every(t => typeof v.promptHash === t && typeof v.quoteHash === t && typeof v.evidenceId === t && typeof v.evidenceAddress === t && typeof v.evidenceCheckedAt === t && typeof v.reasonCode === t) ||
      !(v.signingInputHash === null || typeof v.signingInputHash === 'string')) return false;
    if (!Object.hasOwn(value.taskLimits, v.taskId) || (v.taskComplete && v.settlement !== 'settled') ||
      (v.submission !== 'not_submitted' && v.signing !== 'signed') ||
      (v.settlement === 'settled' && v.submission !== 'submitted')) return false;
  }
  const operations = value.operations as Record<string, StoredOperation>;
  const taskLimits = value.taskLimits as Record<string, string>;
  const seenAuth = new Set<string>();
  for (const op of Object.values(operations)) {
    if (seenAuth.has(op.authorizationId)) return false;
    seenAuth.add(op.authorizationId);
  }
  for (const [taskId, limit] of Object.entries(taskLimits)) {
    if (!idPattern.test(taskId) || Object.values(operations).filter(op => op.taskId === taskId).reduce((sum, op) => sum + BigInt(op.amount), 0n) > BigInt(limit)) return false;
  }
  return true;
}
export async function createEmptyPaymentJournal(path: string): Promise<void> {
  // Explicit bootstrap only. A missing or damaged journal never silently resets.
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify({ version: 1, taskLimits: {}, operations: {} })); await file.sync(); }
  finally { await file.close(); }
}
async function lockedFile<T>(path: string, edit: (journal: Journal) => Promise<T>): Promise<T> {
  const lock = await open(`${path}.lock`, 'wx', 0o600); // stale lock fails closed
  try {
    const raw = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!validJournal(parsed)) throw new Error('Payment journal invalid');
    const journal = parsed;
    const before = JSON.stringify(journal);
    const answer = await edit(journal);
    if (JSON.stringify(journal) !== before) {
      const tmp = `${path}.${randomUUID()}.tmp`;
      const file = await open(tmp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(journal)); await file.sync(); }
      finally { await file.close(); }
      await rename(tmp, path);
      const dir = await open(dirname(path), 'r');
      try { await dir.sync(); } finally { await dir.close(); }
    }
    return answer;
  } finally { await lock.close(); await unlink(`${path}.lock`); }
}
const localQueues = new Map<string, Promise<void>>();
async function locked<T>(path: string, edit: (journal: Journal) => Promise<T>): Promise<T> {
  const previous = localQueues.get(path) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  const queued = previous.then(() => next);
  localQueues.set(path, queued);
  await previous;
  try { return await lockedFile(path, edit); }
  finally { release(); if (localQueues.get(path) === queued) localQueues.delete(path); }
}
function quoteHash(quote: Quote, expectedUrl: string): string | undefined {
  if (quote.method !== 'GET' || quote.url !== expectedUrl || !isRecord(quote.full) || !keys(quote.full, ['x402Version', 'accepts', 'resource']) ||
    quote.full.x402Version !== 2 || !Array.isArray(quote.full.accepts) || quote.full.accepts.length !== 1 || !isRecord(quote.full.accepts[0]) ||
    !isRecord(quote.full.resource) || quote.full.resource.url !== expectedUrl) return;
  const requirement = quote.full.accepts[0];
  if (!keys(requirement, ['scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds', 'extra']) ||
    requirement.scheme !== 'exact' || requirement.network !== TEST_NETWORK || typeof requirement.asset !== 'string' || requirement.asset.toLowerCase() !== TEST_USDC.toLowerCase() ||
    !isAtomic(requirement.amount) || BigInt(requirement.amount) > BigInt(PRICE_ATOMIC) || !isAddress(requirement.payTo) ||
    typeof requirement.maxTimeoutSeconds !== 'number' || !Number.isSafeInteger(requirement.maxTimeoutSeconds) || requirement.maxTimeoutSeconds <= 0 || !isRecord(requirement.extra) ||
    !keys(requirement.extra, ['name', 'version']) || requirement.extra.name !== 'USDC' || requirement.extra.version !== '2') return;
  return digest(canonical(quote.full) + '|GET|' + expectedUrl);
}
function validTyped(value: unknown, auth: Authorization, quote: Quote): boolean {
  if (!isRecord(value) || !keys(value, ['domain', 'types', 'primaryType', 'message']) || value.primaryType !== 'TransferWithAuthorization' ||
    !isRecord(value.domain) || !keys(value.domain, ['name', 'version', 'chainId', 'verifyingContract']) ||
    value.domain.name !== 'USDC' || value.domain.version !== '2' || number(value.domain.chainId) !== BigInt(TEST_CHAIN_ID) ||
    typeof value.domain.verifyingContract !== 'string' || value.domain.verifyingContract.toLowerCase() !== TEST_USDC.toLowerCase() ||
    !isRecord(value.types) || !keys(value.types, ['TransferWithAuthorization']) ||
    canonical(value.types.TransferWithAuthorization) !== canonical(fields) ||
    !isRecord(value.message) || !keys(value.message, ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'])) return false;
  const m = value.message;
  const after = number(m.validAfter), before = number(m.validBefore);
  return typeof m.from === 'string' && m.from.toLowerCase() === auth.wallet.toLowerCase() &&
    typeof m.to === 'string' && m.to.toLowerCase() === quote.terms.payTo.toLowerCase() &&
    number(m.value) === BigInt(quote.terms.amount) && after !== undefined && before !== undefined &&
    before > after && after <= BigInt(Math.floor(Date.now() / 1000)) && before > BigInt(Math.floor(Date.now() / 1000)) &&
    typeof m.nonce === 'string' && /^0x[0-9a-fA-F]{64}$/.test(m.nonce);
}
function authorized(value: unknown, requestId: string, prompt: string, hash: string, url: string): value is Authorization {
  if (!isRecord(value) || !keys(value, ['requestId', 'prompt', 'taskId', 'operationId', 'authorizationId', 'quoteHash', 'url', 'method', 'wallet', 'expiresAt', 'taskBudgetAtomic', 'typedData'])) return false;
  const expiry = Date.parse(String(value.expiresAt));
  return value.requestId === requestId && value.prompt === prompt && value.quoteHash === hash && value.url === url && value.method === 'GET' &&
    [value.taskId, value.operationId, value.authorizationId].every(v => typeof v === 'string' && idPattern.test(v)) &&
    isAddress(value.wallet) && isAtomic(value.taskBudgetAtomic) && Number.isFinite(expiry) && expiry > Date.now();
}
function outcome(id: string, op: StoredOperation, source: 'fixture' | 'unavailable' = 'fixture'): ProtectedPaymentOutcome {
  const result = { operationId: id, decision: op.reasonCode === 'REPORT_VALIDATED' || op.reasonCode === 'SIGNATURE_CREATED' ? 'allow' as const : 'hold' as const,
    reasonCodes: [op.reasonCode], reasons: [op.reasonCode],
    evidence: { source, evidenceId: op.evidenceId || null, address: op.evidenceAddress, checkedAt: op.evidenceCheckedAt,
      requestedPaymentNetwork: TEST_NETWORK, providerEvidenceNetwork: source === 'fixture' ? TEST_NETWORK : null, coverage: source === 'fixture' ? 'verified' as const : 'unverified' as const, semantics: source === 'fixture' ? 'verified' as const : 'unverified' as const },
    checkedQuoteHash: op.quoteHash, signingInputHash: op.signingInputHash, signing: op.signing, submission: op.submission,
    settlement: op.settlement, retryAllowed: false as const };
  return op.taskComplete && op.settlement === 'settled' ? { ...result, settlement: 'settled', taskComplete: true } : { ...result, taskComplete: false };
}
function held(reason: string, operationId?: string): ProtectedPaymentOutcome {
  const common = { decision: 'hold' as const, reasonCodes: [reason], reasons: [reason],
    evidence: { source: 'unavailable' as const, evidenceId: null, address: null, checkedAt: null,
      requestedPaymentNetwork: TEST_NETWORK, providerEvidenceNetwork: null, coverage: 'unverified' as const, semantics: 'unverified' as const },
    checkedQuoteHash: null, signingInputHash: null, taskComplete: false as const, retryAllowed: false as const };
  if (operationId) return { ...common, operationId, signing: 'not_signed', submission: 'not_submitted', settlement: 'not_settled' };
  const unidentified: UnidentifiedPaymentOutcome = { ...common, identity: 'unavailable', operationId: null,
    signing: 'unknown', submission: 'unknown', settlement: 'unknown' };
  return unidentified;
}
/** An authorized ID may identify a stopped check only after checking the durable journal for
 * a competing or already-executed operation. No ID is fabricated for pre-authorization holds.
 */
async function authorizedHold(path: string, auth: Authorization, prompt: string, hash: string, amount: string, reason: string): Promise<ProtectedPaymentOutcome> {
  try {
    return await locked(path, async journal => {
      const existing = journal.operations[auth.operationId];
      const competing = Object.entries(journal.operations).some(([id, op]) =>
        id !== auth.operationId && (op.requestId === auth.requestId || op.authorizationId === auth.authorizationId));
      if (competing) return held('OPERATION_CONFLICT');
      if (existing) {
        if (existing.taskId !== auth.taskId || existing.authorizationId !== auth.authorizationId || existing.requestId !== auth.requestId ||
          existing.promptHash !== digest(prompt) || existing.quoteHash !== hash || existing.amount !== amount) return held('OPERATION_CONFLICT');
        return outcome(auth.operationId, existing);
      }
      return held(reason, auth.operationId);
    });
  } catch { return held('JOURNAL_UNAVAILABLE'); }
}
async function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('Callback timeout')), ms); })]);
  } finally { if (timer) clearTimeout(timer); }
}
class PreSignRejected extends Error { constructor(readonly reasonCode: string) { super(reasonCode); } }
function fresh(checkedAt: string): boolean {
  const timestamp = Date.parse(checkedAt);
  const age = Date.now() - timestamp;
  return Number.isFinite(timestamp) && age >= 0 && age <= 60_000;
}

export class ProtectedPayment {
  constructor(private readonly sellerUrl: string, private readonly deps: TestPaymentDependencies) {}
  async execute(requestId: string, prompt: string, offeredQuote: Quote): Promise<{ execution: ProtectedPaymentOutcome; data?: unknown }> {
    if (this.deps.testFixtureOnly !== true) return { execution: held('PAYMENT_DISABLED') };
    let quote: Quote;
    try { quote = frozen(structuredClone(offeredQuote)); }
    catch { return { execution: held('QUOTE_UNSUPPORTED') }; }
    const url = `${this.sellerUrl}${RESOURCE_PATH}`;
    const hash = quoteHash(quote, url);
    if (!hash) return { execution: held('QUOTE_UNSUPPORTED') };
    try {
      const prior = await locked(this.deps.journalPath, async j => Object.entries(j.operations).find(([, op]) => op.requestId === requestId));
      if (prior) {
        const [id, op] = prior;
        return { execution: op.promptHash === digest(prompt) && op.quoteHash === hash ? outcome(id, op) : held('OPERATION_CONFLICT') };
      }
    } catch { return { execution: held('JOURNAL_UNAVAILABLE') }; }
    let authValue: unknown;
    try { authValue = frozen(structuredClone(await this.deps.authorize(frozen({ requestId, prompt, quoteHash: hash, url, method: 'GET' })))); }
    catch { return { execution: held('AUTHORIZATION_UNAVAILABLE') }; }
    if (!authorized(authValue, requestId, prompt, hash, url)) return { execution: held('AUTHORIZATION_INVALID') };
    const auth = authValue;
    if (!validTyped(auth.typedData, auth, quote)) return { execution: held('APPROVED_SIGNING_INPUT_INVALID') };
    let risk: unknown;
    try { risk = frozen(structuredClone(await this.deps.assess(quote))); }
    catch { return { execution: held('RISK_UNAVAILABLE') }; }
    // No live allow policy is installed. Fixture release requires this explicit backend-only capability.
    if (!isRecord(risk) || !keys(risk, ['source', 'decision', 'evidenceId', 'address', 'checkedAt', 'requestedNetwork', 'coverage', 'semantics']) ||
      risk.source !== 'fixture' || risk.decision !== 'allow' || typeof risk.evidenceId !== 'string' || !idPattern.test(risk.evidenceId) ||
      typeof risk.address !== 'string' || risk.address.toLowerCase() !== quote.terms.payTo.toLowerCase() ||
      risk.requestedNetwork !== TEST_NETWORK || risk.coverage !== 'verified' || risk.semantics !== 'verified' ||
      typeof risk.checkedAt !== 'string' || !fresh(risk.checkedAt)) return { execution: await authorizedHold(this.deps.journalPath, auth, prompt, hash, quote.terms.amount, 'RISK_UNVERIFIED') };
    const amount = quote.terms.amount;
    let existing: StoredOperation | undefined;
    let reservedOp: StoredOperation | undefined;
    try {
      existing = await locked(this.deps.journalPath, async j => {
        const prior = j.operations[auth.operationId];
        if (prior) {
          if (prior.taskId !== auth.taskId || prior.authorizationId !== auth.authorizationId || prior.requestId !== requestId || prior.promptHash !== digest(prompt) || prior.quoteHash !== hash || prior.amount !== amount) throw new Error('OPERATION_CONFLICT');
          return prior;
        }
        if (Object.values(j.operations).some(op => op.authorizationId === auth.authorizationId)) throw new Error('AUTHORIZATION_REUSED');
        if (Object.values(j.operations).some(op => op.requestId === requestId)) throw new Error('REQUEST_REUSED');
        const limit = j.taskLimits[auth.taskId];
        if (limit && limit !== auth.taskBudgetAtomic) throw new Error('TASK_LIMIT_CONFLICT');
        const reserved = Object.values(j.operations).filter(op => op.taskId === auth.taskId).reduce((sum, op) => sum + BigInt(op.amount), 0n);
        if (reserved + BigInt(amount) > BigInt(auth.taskBudgetAtomic)) throw new Error('TASK_BUDGET_EXCEEDED');
        j.taskLimits[auth.taskId] = auth.taskBudgetAtomic;
        const next: StoredOperation = { taskId: auth.taskId, authorizationId: auth.authorizationId, requestId,
          promptHash: digest(prompt), quoteHash: hash, amount, evidenceId: risk.evidenceId as string,
          evidenceAddress: risk.address as string, evidenceCheckedAt: risk.checkedAt as string,
          signingInputHash: null, signing: 'unknown', submission: 'not_submitted', settlement: 'not_settled', taskComplete: false, reasonCode: 'SIGNING_OUTCOME_UNKNOWN' };
        j.operations[auth.operationId] = next; reservedOp = structuredClone(next); return undefined;
      });
    } catch (error) {
      const reason = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'JOURNAL_UNAVAILABLE';
      return { execution: reason === 'TASK_BUDGET_EXCEEDED'
        ? await authorizedHold(this.deps.journalPath, auth, prompt, hash, amount, reason) : held(reason) };
    }
    if (existing) return { execution: outcome(auth.operationId, existing) };
    if (!reservedOp) return { execution: held('JOURNAL_UNAVAILABLE') };
    const uncertain = (reasonCode: string) => outcome(auth.operationId, { ...reservedOp!, reasonCode, signing: 'unknown' });
    const update = async (change: Partial<StoredOperation>) => locked(this.deps.journalPath, async j => {
      const op = j.operations[auth.operationId];
      if (!op) throw new Error('Journal operation missing');
      Object.assign(op, change);
      return structuredClone(op);
    });
    let snapshot: unknown;
    try { snapshot = frozen(structuredClone(await this.deps.createSigningInput(frozen(structuredClone(auth.typedData))))); }
    catch { return { execution: uncertain('SIGNING_OUTCOME_UNKNOWN') }; }
    if (!validTyped(snapshot, auth, quote) || canonical(snapshot) !== canonical(auth.typedData)) {
      const op = await update({ signing: 'not_signed', reasonCode: 'SIGNING_INPUT_MISMATCH' });
      return { execution: outcome(auth.operationId, op) };
    }
    const signingInputHash = digest(canonical(snapshot));
    try { await update({ signingInputHash }); reservedOp = { ...reservedOp, signingInputHash }; }
    catch { return { execution: held('JOURNAL_UNAVAILABLE') }; }
    try { await this.deps.afterSigningInputPersisted?.(); }
    catch { return { execution: uncertain('SIGNING_OUTCOME_UNKNOWN') }; }
    let signature: unknown;
    const timeoutMs = Number.isSafeInteger(this.deps.timeoutMs) && this.deps.timeoutMs! >= 10 && this.deps.timeoutMs! <= 10_000 ? this.deps.timeoutMs! : 1000;
    try { signature = await bounded(Promise.resolve().then(() => {
      // Final gate runs synchronously with the actual signer invocation, after every awaited write.
      if (!fresh(risk.checkedAt as string)) throw new PreSignRejected('RISK_EXPIRED');
      if (Date.parse(auth.expiresAt) <= Date.now()) throw new PreSignRejected('AUTHORIZATION_EXPIRED');
      if (!validTyped(snapshot, auth, quote) || canonical(snapshot) !== canonical(auth.typedData) || quoteHash(quote, url) !== hash) throw new PreSignRejected('SIGNING_INPUT_MISMATCH');
      return this.deps.signTypedData(snapshot);
    }), timeoutMs); }
    catch (error) {
      if (error instanceof PreSignRejected) {
        try { return { execution: outcome(auth.operationId, await update({ signing: 'not_signed', reasonCode: error.reasonCode })) }; }
        catch { return { execution: uncertain('JOURNAL_UNAVAILABLE') }; }
      }
      return { execution: uncertain('SIGNING_OUTCOME_UNKNOWN') };
    }
    if (typeof signature !== 'string' || !signature) return { execution: uncertain('SIGNING_OUTCOME_UNKNOWN') };
    let op: StoredOperation;
    try { op = await update({ signing: 'signed', reasonCode: 'SIGNATURE_CREATED' }); }
    catch { return { execution: uncertain('SIGNING_PERSISTENCE_UNKNOWN') }; }
    try { op = await update({ submission: 'unknown', settlement: 'unknown', reasonCode: 'SUBMISSION_OUTCOME_UNKNOWN' }); }
    catch { return { execution: outcome(auth.operationId, op) }; }
    let response: unknown;
    try { response = await bounded(Promise.resolve().then(() => this.deps.submit(frozen(structuredClone(quote)), signature, auth.operationId)), timeoutMs); }
    catch { return { execution: outcome(auth.operationId, op) }; }
    if (!isRecord(response) || response.settlement !== 'settled' || !isRecord(response.receipt) ||
      !keys(response.receipt, ['success', 'operationId', 'network', 'asset', 'payTo', 'amount']) ||
      response.receipt.success !== true || response.receipt.operationId !== auth.operationId ||
      response.receipt.network !== TEST_NETWORK || typeof response.receipt.asset !== 'string' || response.receipt.asset.toLowerCase() !== TEST_USDC.toLowerCase() ||
      typeof response.receipt.payTo !== 'string' || response.receipt.payTo.toLowerCase() !== quote.terms.payTo.toLowerCase() ||
      response.receipt.amount !== quote.terms.amount) return { execution: outcome(auth.operationId, op) };
    let valid = false;
    try { valid = this.deps.validateReport(response.report); } catch { /* Delivery remains incomplete. */ }
    try { op = await update({ submission: 'submitted', settlement: 'settled', taskComplete: valid, reasonCode: valid ? 'REPORT_VALIDATED' : 'REPORT_INVALID' }); }
    catch { return { execution: outcome(auth.operationId, op) }; }
    return { execution: outcome(auth.operationId, op), data: valid ? response.report : undefined };
  }
}
