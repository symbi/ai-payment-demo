import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isGrantAtomic, isTaskGrant, type TaskGrant } from '../../../shared/task-grant.ts';

export type BudgetOperation = Readonly<{
  operationId: string;
  intentHash: string;
  amountAtomic: string;
  state: 'reserved' | 'unknown' | 'released' | 'settled';
  transactionHash: string | null;
}>;
export type BudgetSnapshot = Readonly<{
  grantId: string;
  grantVersion: 1;
  totalBudgetAtomic: string;
  spentAtomic: string;
  reservedAtomic: string;
  availableAtomic: string;
  operations: readonly BudgetOperation[];
  source: 'local-ledger';
  executionConnected: false;
}>;
export type BudgetIdentity = { operationId: string; intentHash: string };
export type BudgetReservation = BudgetIdentity & { amountAtomic: string };
export type BudgetSettlement = BudgetIdentity & { transactionHash: string };
export type TaskBudgetLedgerOptions = { path: string; grant: TaskGrant; now?: () => Date };
export type TaskBudgetErrorCode = 'invalid_budget_input' | 'task_budget_conflict'
  | 'task_budget_exceeded' | 'task_budget_inactive' | 'task_budget_unavailable';

const messages: Record<TaskBudgetErrorCode, string> = {
  invalid_budget_input: '预算记录输入无效。',
  task_budget_conflict: '预算记录身份、许可或结果冲突。',
  task_budget_exceeded: '超过单笔上限或剩余任务预算。',
  task_budget_inactive: '任务许可尚未生效或已过期。',
  task_budget_unavailable: '预算记录结果未确认，请查询持久记录；不会自动重试或释放额度。',
};
export class TaskBudgetError extends Error {
  readonly status: 400 | 409 | 503;
  constructor(readonly code: TaskBudgetErrorCode) {
    super(messages[code]);
    this.name = 'TaskBudgetError';
    this.status = code === 'invalid_budget_input' ? 400 : code === 'task_budget_unavailable' ? 503 : 409;
  }
}

type Journal = { version: 1; grant: TaskGrant; operations: BudgetOperation[] };
type Handle = Awaited<ReturnType<typeof open>>;
const unavailable = () => new TaskBudgetError('task_budget_unavailable');
const conflict = () => new TaskBudgetError('task_budget_conflict');
const missing = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function identity(value: Record<string, unknown>): boolean {
  return typeof value.operationId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.operationId)
    && !['__proto__', 'constructor', 'prototype'].includes(value.operationId)
    && typeof value.intentHash === 'string' && /^[0-9a-fA-F]{64}$/.test(value.intentHash);
}
const transactionHash = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);

/** Local accounting only. This class neither verifies a transaction nor enables execution. */
export class TaskBudgetLedger {
  readonly #path: string;
  readonly #grant: Readonly<TaskGrant>;
  readonly #now: () => Date;

  constructor(options: TaskBudgetLedgerOptions) {
    if (!options || typeof options.path !== 'string' || !options.path.length
      || (options.now !== undefined && typeof options.now !== 'function')) throw unavailable();
    // Copy and validate synchronously; subsequent caller mutation cannot change the binding.
    const grant = { ...options.grant };
    if (!isTaskGrant(grant)) throw new TaskBudgetError('invalid_budget_input');
    this.#grant = Object.freeze(grant);
    this.#path = resolve(options.path);
    this.#now = options.now ?? (() => new Date());
  }

  async initialize(): Promise<BudgetSnapshot> {
    return this.#locked(async assertOwned => {
      const existing = await this.#read(true);
      if (existing) return this.#snapshot(existing);
      const journal: Journal = { version: 1, grant: { ...this.#grant }, operations: [] };
      await this.#write(journal, assertOwned);
      return this.#snapshot(journal);
    });
  }

  async status(): Promise<BudgetSnapshot> {
    return this.#locked(async () => this.#snapshot(await this.#required()));
  }

  async reserve(candidate: BudgetReservation): Promise<BudgetSnapshot> {
    if (!exact(candidate, ['operationId', 'intentHash', 'amountAtomic'])) throw new TaskBudgetError('invalid_budget_input');
    const input = { ...candidate };
    if (!identity(input) || !isGrantAtomic(input.amountAtomic)) throw new TaskBudgetError('invalid_budget_input');
    return this.#locked(async assertOwned => {
      const journal = await this.#required();
      const existing = journal.operations.find(op => op.operationId === input.operationId);
      if (existing) {
        if (existing.intentHash !== input.intentHash || existing.amountAtomic !== input.amountAtomic) throw conflict();
        // A replay observes the existing state, including terminal/expired operations; it never re-reserves.
        return this.#snapshot(journal);
      }
      this.#assertActive();
      if (BigInt(input.amountAtomic) > BigInt(this.#grant.perTransactionAtomic)
        || BigInt(input.amountAtomic) > BigInt(this.#snapshot(journal).availableAtomic)) {
        throw new TaskBudgetError('task_budget_exceeded');
      }
      journal.operations.push({ ...input, state: 'reserved', transactionHash: null });
      await this.#write(journal, assertOwned);
      return this.#snapshot(journal);
    });
  }

  async markUnknown(candidate: BudgetIdentity): Promise<BudgetSnapshot> {
    const input = this.#identityInput(candidate);
    return this.#change(input, op => {
      if (op.state === 'unknown') return op;
      if (op.state !== 'reserved') throw conflict();
      return { ...op, state: 'unknown' };
    });
  }

  /** Trusted backend assertion that no external effect began. Unknown outcomes cannot be released. */
  async releaseBeforeSubmission(candidate: BudgetIdentity): Promise<BudgetSnapshot> {
    const input = this.#identityInput(candidate);
    return this.#change(input, op => {
      if (op.state !== 'reserved') throw conflict();
      return { ...op, state: 'released' };
    });
  }

  /** Future trusted verifier callback, NOT transaction verification; callers must verify externally. */
  async recordVerifiedSettlement(candidate: BudgetSettlement): Promise<BudgetSnapshot> {
    if (!exact(candidate, ['operationId', 'intentHash', 'transactionHash'])) throw new TaskBudgetError('invalid_budget_input');
    const input = { ...candidate };
    if (!identity(input) || !transactionHash(input.transactionHash)) throw new TaskBudgetError('invalid_budget_input');
    const proof = input.transactionHash.toLowerCase();
    return this.#change(input, (op, journal) => {
      if (op.state === 'settled') {
        if (op.transactionHash !== proof) throw conflict();
        return op;
      }
      if (op.state === 'released' || journal.operations.some(other => other.transactionHash === proof)) throw conflict();
      return { ...op, state: 'settled', transactionHash: proof };
    });
  }

  #identityInput(candidate: BudgetIdentity): BudgetIdentity {
    if (!exact(candidate, ['operationId', 'intentHash'])) throw new TaskBudgetError('invalid_budget_input');
    const input = { ...candidate };
    if (!identity(input)) throw new TaskBudgetError('invalid_budget_input');
    return input;
  }

  async #change(input: BudgetIdentity, update: (op: BudgetOperation, journal: Journal) => BudgetOperation): Promise<BudgetSnapshot> {
    return this.#locked(async assertOwned => {
      const journal = await this.#required();
      const index = journal.operations.findIndex(op => op.operationId === input.operationId);
      const op = journal.operations[index];
      if (!op || op.intentHash !== input.intentHash) throw conflict();
      const changed = update(op, journal);
      if (changed !== op) {
        journal.operations[index] = changed;
        await this.#write(journal, assertOwned);
      }
      return this.#snapshot(journal);
    });
  }

  #assertActive(): void {
    let value: Date;
    try { value = this.#now(); } catch { throw unavailable(); }
    const time = value instanceof Date ? value.getTime() : NaN;
    if (!Number.isFinite(time)) throw unavailable();
    if (time < Date.parse(this.#grant.createdAt) || time >= Date.parse(this.#grant.expiresAt)) {
      throw new TaskBudgetError('task_budget_inactive');
    }
  }

  #snapshot(journal: Journal): BudgetSnapshot {
    let spent = 0n, reserved = 0n;
    for (const op of journal.operations) {
      if (op.state === 'settled') spent += BigInt(op.amountAtomic);
      if (op.state === 'reserved' || op.state === 'unknown') reserved += BigInt(op.amountAtomic);
    }
    const available = BigInt(this.#grant.totalBudgetAtomic) - spent - reserved;
    if (available < 0n) throw unavailable();
    return Object.freeze({
      grantId: this.#grant.grantId, grantVersion: this.#grant.version,
      totalBudgetAtomic: this.#grant.totalBudgetAtomic,
      spentAtomic: spent.toString(), reservedAtomic: reserved.toString(), availableAtomic: available.toString(),
      operations: Object.freeze(journal.operations.map(op => Object.freeze({ ...op }))),
      source: 'local-ledger', executionConnected: false,
    });
  }

  #parse(raw: string): Journal {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw unavailable(); }
    if (!exact(value, ['version', 'grant', 'operations']) || value.version !== 1
      || !isTaskGrant(value.grant) || !Array.isArray(value.operations)) throw unavailable();
    const grant = value.grant;
    if (!(Object.keys(this.#grant) as (keyof TaskGrant)[]).every(key => grant[key] === this.#grant[key])) throw conflict();
    const ids = new Set<string>(), proofs = new Set<string>();
    for (const op of value.operations) {
      if (!exact(op, ['operationId', 'intentHash', 'amountAtomic', 'state', 'transactionHash'])
        || !identity(op) || !isGrantAtomic(op.amountAtomic)
        || BigInt(op.amountAtomic) > BigInt(grant.perTransactionAtomic)
        || typeof op.state !== 'string' || !['reserved', 'unknown', 'released', 'settled'].includes(op.state)) throw unavailable();
      if (ids.has(op.operationId as string)) throw unavailable();
      ids.add(op.operationId as string);
      if (op.state === 'settled') {
        if (!transactionHash(op.transactionHash) || op.transactionHash !== op.transactionHash.toLowerCase()
          || proofs.has(op.transactionHash)) throw unavailable();
        proofs.add(op.transactionHash);
      } else if (op.transactionHash !== null) throw unavailable();
    }
    const journal = value as Journal;
    this.#snapshot(journal); // Reject corrupt accounting before returning any record.
    return journal;
  }

  async #required(): Promise<Journal> {
    const journal = await this.#read(false);
    if (!journal) throw unavailable();
    return journal;
  }

  async #read(allowMissing: boolean): Promise<Journal | null> {
    let handle: Handle;
    try { handle = await open(this.#path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error) {
      if (allowMissing && missing(error)) return null;
      throw unavailable();
    }
    try {
      const info = await handle.stat();
      if (!info.isFile() || (info.mode & 0o077) !== 0 || info.nlink !== 1) throw unavailable();
      return this.#parse(await handle.readFile('utf8'));
    } catch (error) {
      if (error instanceof TaskBudgetError) throw error;
      throw unavailable();
    } finally { await handle.close(); }
  }

  async #locked<T>(action: (assertOwned: () => Promise<void>) => Promise<T>): Promise<T> {
    const lockPath = `${this.#path}.lock`;
    let lock: Handle;
    try { lock = await open(lockPath, 'wx', 0o600); } catch { throw unavailable(); }
    const assertOwned = async () => {
      const owned = await lock.stat();
      const current = await lstat(lockPath);
      if (owned.dev !== current.dev || owned.ino !== current.ino) throw unavailable();
    };
    try {
      await lock.writeFile(randomUUID(), 'utf8');
      await lock.sync();
      const result = await action(assertOwned);
      await assertOwned();
      return result;
    } catch (error) {
      if (error instanceof TaskBudgetError) throw error;
      throw unavailable();
    } finally {
      try { await assertOwned(); await unlink(lockPath); }
      catch { /* Never remove another owner's lock or reclaim a stale lock automatically. */ }
      await lock.close().catch(() => undefined);
    }
  }

  async #write(journal: Journal, assertOwned: () => Promise<void>): Promise<void> {
    const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    let handle: Handle | undefined;
    let ownTemporary = false;
    try {
      handle = await open(temporary, 'wx', 0o600);
      ownTemporary = true;
      await handle.writeFile(`${JSON.stringify(journal)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await assertOwned();
      await rename(temporary, this.#path);
      ownTemporary = false;
      const directory = await open(dirname(this.#path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } catch { throw unavailable(); }
    finally {
      if (handle) await handle.close().catch(() => undefined);
      if (ownTemporary) await unlink(temporary).catch(() => undefined);
    }
  }
}
