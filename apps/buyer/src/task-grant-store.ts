import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  TASK_GRANT_REVISION,
  isTaskGrant,
  isTaskGrantContext,
  isTaskGrantInput,
  type TaskGrant,
  type TaskGrantContext,
  type TaskGrantInput,
  type TaskGrantStatus,
} from '../../../shared/task-grant.ts';

export type TaskGrantErrorCode =
  | 'invalid_task_grant'
  | 'task_grant_conflict'
  | 'task_grant_unavailable';

const PUBLIC_ERRORS: Record<TaskGrantErrorCode, string> = {
  invalid_task_grant: '任务许可输入无效。',
  task_grant_conflict: '任务许可已存在；账本尚未接通，不能覆盖历史预算。',
  task_grant_unavailable: '任务许可结果未确认，请查询已有许可；不会自动重试。',
};

export class TaskGrantError extends Error {
  constructor(
    readonly status: 400 | 409 | 413 | 503,
    readonly code: TaskGrantErrorCode,
  ) {
    super(PUBLIC_ERRORS[code]);
    this.name = 'TaskGrantError';
  }
}

type Journal = { version: 1; grant: TaskGrant | null };
type StoreOptions = { path: string; context: TaskGrantContext; now?: () => Date };

const accounting = Object.freeze({
  state: 'not_connected' as const,
  spentAtomic: null,
  reservedAtomic: null,
  availableAtomic: null,
  walletBalanceAtomic: null,
});

function unavailable(): TaskGrantError {
  return new TaskGrantError(503, 'task_grant_unavailable');
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function parseJournal(raw: string): Journal {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw unavailable();
  }
  if (!exactObject(value, ['version', 'grant']) || value.version !== 1 || (value.grant !== null && !isTaskGrant(value.grant))) {
    throw unavailable();
  }
  return value as Journal;
}

function sameInput(grant: TaskGrant, input: TaskGrantInput): boolean {
  return grant.totalBudgetAtomic === input.totalBudgetAtomic
    && grant.perTransactionAtomic === input.perTransactionAtomic
    && grant.validForMinutes === input.validForMinutes
    && grant.confirmed === input.confirmed;
}

export class TaskGrantStore {
  readonly context: TaskGrantContext;
  readonly #path: string;
  readonly #now: () => Date;

  constructor(options: StoreOptions) {
    if (!options || typeof options.path !== 'string' || options.path.length === 0 || !isTaskGrantContext(options.context)) {
      throw unavailable();
    }
    this.#path = options.path;
    this.#now = options.now ?? (() => new Date());
    this.context = Object.freeze({ ...options.context });
  }

  async status(): Promise<TaskGrantStatus> {
    const journal = await this.#readJournal(true);
    return this.#status(journal?.grant ?? null);
  }

  async save(candidate: unknown): Promise<TaskGrantStatus> {
    if (!isTaskGrantInput(candidate)) throw new TaskGrantError(400, 'invalid_task_grant');
    const input: TaskGrantInput = { ...candidate };
    if (this.context.account === null || this.context.payTo === null) throw unavailable();

    const observed = await this.#readJournal(true);
    if (observed?.grant) return this.#resolveExisting(observed.grant, input);

    const lockPath = `${this.#path}.lock`;
    let lock: Awaited<ReturnType<typeof open>> | undefined;
    try {
      lock = await open(lockPath, 'wx', 0o600);
      await lock.writeFile(randomUUID(), 'utf8');
      await lock.sync();
    } catch {
      if (lock) await this.#releaseOwnLock(lock, lockPath);
      throw unavailable();
    }
    if (!lock) throw unavailable();

    try {
      const current = await this.#readJournal(true);
      if (current?.grant) return this.#resolveExisting(current.grant, input);

      const createdAt = this.#serverNow();
      const grant: TaskGrant = {
        ...input,
        grantId: randomUUID(),
        version: 1,
        taskId: this.context.taskId,
        agentId: this.context.agentId,
        account: this.context.account,
        payTo: this.context.payTo,
        network: this.context.network,
        asset: this.context.asset,
        resource: this.context.resource,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + input.validForMinutes * 60_000).toISOString(),
      };
      await this.#writeJournal({ version: 1, grant });
      return this.#status(grant);
    } finally {
      await this.#releaseOwnLock(lock, lockPath);
    }
  }

  #serverNow(): Date {
    let value: Date;
    try {
      value = this.#now();
    } catch {
      throw unavailable();
    }
    const copy = value instanceof Date ? new Date(value.getTime()) : new Date(Number.NaN);
    if (!Number.isFinite(copy.getTime())) throw unavailable();
    return copy;
  }

  #status(grant: TaskGrant | null): TaskGrantStatus {
    if (grant) this.#assertBound(grant);
    return {
      contractRevision: TASK_GRANT_REVISION,
      context: this.context,
      grant,
      canSave: grant === null && this.context.account !== null && this.context.payTo !== null,
      paymentEnabled: false,
      executionConnected: false,
      accounting,
    };
  }

  #resolveExisting(grant: TaskGrant, input: TaskGrantInput): TaskGrantStatus {
    this.#assertBound(grant);
    if (!sameInput(grant, input)) throw new TaskGrantError(409, 'task_grant_conflict');
    return this.#status(grant);
  }

  #assertBound(grant: TaskGrant): void {
    const context = this.context;
    if (grant.taskId !== context.taskId || grant.agentId !== context.agentId
      || grant.account !== context.account || grant.payTo !== context.payTo
      || grant.network !== context.network || grant.asset !== context.asset || grant.resource !== context.resource) {
      throw unavailable();
    }
  }

  async #readJournal(allowMissing: boolean): Promise<Journal | null> {
    try {
      return parseJournal(await readFile(this.#path, 'utf8'));
    } catch (error) {
      if (allowMissing && isMissing(error)) return null;
      if (error instanceof TaskGrantError) throw error;
      throw unavailable();
    }
  }

  async #writeJournal(journal: Journal): Promise<void> {
    const temporary = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify(journal)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.#path);
      const directory = await open(dirname(this.#path), 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch {
      if (handle) await handle.close().catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      throw unavailable();
    }
  }

  async #releaseOwnLock(lock: Awaited<ReturnType<typeof open>>, lockPath: string): Promise<void> {
    try {
      const [owned, current] = await Promise.all([lock.stat(), lstat(lockPath)]);
      if (owned.dev === current.dev && owned.ino === current.ino) await unlink(lockPath);
    } catch {
      // A missing or replaced lock is not ours to remove. The journal outcome remains authoritative.
    } finally {
      await lock.close().catch(() => undefined);
    }
  }
}
