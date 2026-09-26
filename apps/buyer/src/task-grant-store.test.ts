import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';
import type { TaskGrantContext, TaskGrantInput } from '../../../shared/task-grant.ts';
import { TaskGrantError, TaskGrantStore } from './task-grant-store.ts';

const folders: string[] = [];
const account = `0x${'1'.repeat(40)}`;
const payTo = `0x${'2'.repeat(40)}`;
const context: TaskGrantContext = {
  taskId: 'GH-15', taskName: 'grant persistence', agentId: 'symphony', agentName: 'Symphony',
  account, payTo, network: TEST_NETWORK, asset: TEST_USDC, resource: RESOURCE_PATH,
};
const input: TaskGrantInput = { totalBudgetAtomic: '10000', perTransactionAtomic: '1000', validForMinutes: 30, confirmed: true };

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function location(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'task-grant-'));
  folders.push(folder);
  return join(folder, 'journal.json');
}

function expectGrantError(status: 400 | 409 | 503, code: string) {
  return expect.objectContaining({ name: 'TaskGrantError', status, code });
}

describe('TaskGrantStore', () => {
  it('persists the first grant and reads the identical server-bound record after restart', async () => {
    const path = await location();
    const now = new Date('2026-09-27T00:00:00.000Z');
    const saved = await new TaskGrantStore({ path, context, now: () => now }).save(input);
    const restarted = await new TaskGrantStore({ path, context, now: () => new Date('2030-01-01') }).status();

    expect(restarted).toEqual(saved);
    expect(saved.grant).toMatchObject({ ...input, version: 1, taskId: context.taskId, agentId: context.agentId,
      account, payTo, createdAt: now.toISOString(), expiresAt: '2026-09-27T00:30:00.000Z' });
    expect(saved).toMatchObject({ canSave: false, paymentEnabled: false, executionConnected: false,
      accounting: { state: 'not_connected', spentAtomic: null, reservedAtomic: null, availableAtomic: null, walletBalanceAtomic: null } });
    expect((await readFile(path, 'utf8'))).not.toMatch(/credential|signature|provider/i);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('returns the original record for identical saves without extending its lifetime', async () => {
    const path = await location();
    let clock = new Date('2026-09-27T01:00:00.000Z');
    const store = new TaskGrantStore({ path, context, now: () => clock });
    const first = await store.save(input);
    clock = new Date('2026-09-27T12:00:00.000Z');
    const duplicate = await store.save({ ...input });
    expect(duplicate).toEqual(first);
    expect(duplicate.grant?.grantId).toBe(first.grant?.grantId);
    expect(duplicate.grant?.expiresAt).toBe('2026-09-27T01:30:00.000Z');
  });

  it('persists the validated input even if the caller changes its object during I/O', async () => {
    const store = new TaskGrantStore({ path: await location(), context });
    const candidate = { ...input };
    const saving = store.save(candidate);
    candidate.totalBudgetAtomic = '999999';
    candidate.validForMinutes = 1440;
    const saved = await saving;
    expect(saved.grant).toMatchObject(input);
    expect((await store.status()).grant).toEqual(saved.grant);
  });

  it('never overwrites an existing or expired grant with changed terms', async () => {
    const path = await location();
    let clock = new Date('2026-09-27T01:00:00.000Z');
    const store = new TaskGrantStore({ path, context, now: () => clock });
    const first = await store.save(input);
    clock = new Date('2026-09-28T01:00:00.000Z');
    await expect(store.save({ ...input, totalBudgetAtomic: '20000' })).rejects.toEqual(expectGrantError(409, 'task_grant_conflict'));
    expect(await store.status()).toEqual(first);
    expect((await store.save(input)).grant?.expiresAt).toBe(first.grant?.expiresAt);
  });

  it('rejects a journal bound to a different trusted context', async () => {
    const path = await location();
    await new TaskGrantStore({ path, context }).save(input);
    const changed = { ...context, account: `0x${'3'.repeat(40)}` };
    await expect(new TaskGrantStore({ path, context: changed }).status()).rejects.toEqual(expectGrantError(503, 'task_grant_unavailable'));
  });

  it.each([
    { ...input, confirmed: false },
    { ...input, totalBudgetAtomic: '0' },
    { ...input, totalBudgetAtomic: '-1' },
    { ...input, totalBudgetAtomic: '1.5' },
    { ...input, totalBudgetAtomic: '1'.repeat(31) },
    { ...input, totalBudgetAtomic: '999', perTransactionAtomic: '1000' },
    { ...input, perTransactionAtomic: '0' },
    { ...input, validForMinutes: 0 },
    { ...input, validForMinutes: -1 },
    { ...input, validForMinutes: 1.5 },
    { ...input, forgedBalance: '999999' },
  ])('rejects malformed, unsafe, or forged input: %j', async bad => {
    await expect(new TaskGrantStore({ path: await location(), context }).save(bad)).rejects.toEqual(expectGrantError(400, 'invalid_task_grant'));
  });

  it('reports an unconfigured trusted account without inventing a usable grant', async () => {
    const store = new TaskGrantStore({ path: await location(), context: { ...context, account: null } });
    expect(await store.status()).toMatchObject({ grant: null, canSave: false, paymentEnabled: false });
    await expect(store.save(input)).rejects.toEqual(expectGrantError(503, 'task_grant_unavailable'));
  });

  it('preserves corrupt files and fails closed for an existing lock', async () => {
    const corruptPath = await location();
    await writeFile(corruptPath, '{broken', { mode: 0o600 });
    const corrupt = new TaskGrantStore({ path: corruptPath, context });
    await expect(corrupt.status()).rejects.toEqual(expectGrantError(503, 'task_grant_unavailable'));
    expect(await readFile(corruptPath, 'utf8')).toBe('{broken');

    const lockedPath = await location();
    await writeFile(`${lockedPath}.lock`, 'another-owner', { mode: 0o600 });
    await expect(new TaskGrantStore({ path: lockedPath, context }).save(input)).rejects.toEqual(expectGrantError(503, 'task_grant_unavailable'));
    expect(await readFile(`${lockedPath}.lock`, 'utf8')).toBe('another-owner');
  });

  it('allows only one first write across two instances', async () => {
    const path = await location();
    const stores = [new TaskGrantStore({ path, context }), new TaskGrantStore({ path, context })];
    const attempts = await Promise.allSettled(stores.map(store => store.save(input)));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    const persisted = await stores[0].status();
    expect((await stores[1].save(input)).grant?.grantId).toBe(persisted.grant?.grantId);
  });

  it('does not create a missing parent directory', async () => {
    const path = join(await location(), 'missing', 'journal.json');
    await expect(new TaskGrantStore({ path, context }).save(input)).rejects.toBeInstanceOf(TaskGrantError);
  });
});
