import { unlinkSync, writeFileSync } from 'node:fs';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';
import type { TaskGrant } from '../../../shared/task-grant.ts';
import { TaskGrantStore } from './task-grant-store.ts';
import { TaskBudgetError, TaskBudgetLedger, type BudgetSnapshot } from './task-budget-ledger.ts';

// SYNTHETIC OFFLINE FIXTURES ONLY: none of these addresses, intents or hashes are verified payments.
const started = '2026-09-27T00:00:00.000Z';
const expires = '2026-09-27T00:30:00.000Z';
const fixtureGrant: TaskGrant = {
  grantId: 'synthetic-gh18', version: 1, taskId: 'GH-18', agentId: 'offline-fixture',
  account: `0x${'1'.repeat(40)}`, payTo: `0x${'2'.repeat(40)}`,
  network: TEST_NETWORK, asset: TEST_USDC, resource: RESOURCE_PATH,
  totalBudgetAtomic: '1000', perTransactionAtomic: '600', validForMinutes: 30, confirmed: true,
  createdAt: started, expiresAt: expires,
};
const fixtureIntent = 'a'.repeat(64);
const fixtureProof = `0x${'b'.repeat(64)}`;
const fixtureOtherProof = `0x${'c'.repeat(64)}`;
const reservation = (operationId = 'op-1', amountAtomic = '600') => ({ operationId, intentHash: fixtureIntent, amountAtomic });
const identity = (operationId = 'op-1') => ({ operationId, intentHash: fixtureIntent });
const settlement = (operationId = 'op-1', transactionHash = fixtureProof) => ({ ...identity(operationId), transactionHash });
const error = (code: string) => expect.objectContaining({ name: 'TaskBudgetError', code });
const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function location(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'offline-task-budget-'));
  folders.push(folder);
  return join(folder, 'ledger.json');
}
function ledger(path: string, grant = fixtureGrant, now: () => Date = () => new Date(started)) {
  return new TaskBudgetLedger({ path, grant, now });
}
async function initialized() {
  const path = await location();
  const store = ledger(path);
  await store.initialize();
  return { path, store };
}
function accounting(snapshot: BudgetSnapshot, spent: string, reserved: string, available: string) {
  expect(snapshot).toMatchObject({ spentAtomic: spent, reservedAtomic: reserved, availableAtomic: available,
    source: 'local-ledger', executionConnected: false });
  expect(BigInt(snapshot.totalBudgetAtomic)).toBe(BigInt(spent) + BigInt(reserved) + BigInt(available));
}

describe('TaskBudgetLedger (synthetic offline accounting, execution disconnected)', () => {
  it('reuses a saved TaskGrant without changing its disconnected status; survives restart', async () => {
    const path = await location();
    const grantStore = new TaskGrantStore({ path: join(path, '..', 'grant.json'), now: () => new Date(started),
      context: { taskId: 'GH-18', taskName: 'offline fixture', agentId: 'offline-fixture', agentName: 'Fixture',
        account: fixtureGrant.account, payTo: fixtureGrant.payTo, network: TEST_NETWORK, asset: TEST_USDC, resource: RESOURCE_PATH } });
    const saved = await grantStore.save({ totalBudgetAtomic: '1000', perTransactionAtomic: '600', validForMinutes: 30, confirmed: true });
    if (!saved.grant) throw new Error('Synthetic fixture grant missing');
    const store = ledger(path, saved.grant);
    accounting(await store.initialize(), '0', '0', '1000');
    const first = await store.reserve(reservation());
    accounting(first, '0', '600', '400');
    const restarted = ledger(path, saved.grant);
    expect(await restarted.status()).toEqual(first);
    const bytes = await readFile(path, 'utf8');
    expect(await restarted.initialize()).toEqual(first);
    expect(await readFile(path, 'utf8')).toBe(bytes);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await grantStore.status()).toEqual(saved);
    expect(saved.accounting).toEqual({ state: 'not_connected', spentAtomic: null, reservedAtomic: null,
      availableAtomic: null, walletBalanceAtomic: null });
    expect(first).not.toHaveProperty('walletBalanceAtomic');
  });

  it('requires explicit initialization and preserves missing or corrupt records', async () => {
    const path = await location();
    const store = ledger(path);
    await expect(store.status()).rejects.toEqual(error('task_budget_unavailable'));
    await expect(store.reserve(reservation())).rejects.toEqual(error('task_budget_unavailable'));
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(path, '{broken', { mode: 0o600 });
    await expect(store.initialize()).rejects.toEqual(error('task_budget_unavailable'));
    await expect(store.status()).rejects.toEqual(error('task_budget_unavailable'));
    await expect(store.reserve(reservation())).rejects.toEqual(error('task_budget_unavailable'));
    expect(await readFile(path, 'utf8')).toBe('{broken');
  });

  it('replays exact content without writing or extending validity; rejects changed identity content', async () => {
    const { path, store } = await initialized();
    const first = await store.reserve(reservation());
    const bytes = await readFile(path, 'utf8');
    expect(await store.reserve(reservation())).toEqual(first);
    expect(await readFile(path, 'utf8')).toBe(bytes);
    await expect(store.reserve(reservation('op-1', '1'))).rejects.toEqual(error('task_budget_conflict'));
    await expect(store.reserve({ ...reservation(), intentHash: 'd'.repeat(64) })).rejects.toEqual(error('task_budget_conflict'));
    expect(await ledger(path, fixtureGrant, () => new Date(expires)).reserve(reservation())).toEqual(first);
  });

  it.each(['0', '-1', '1.2', '01', '1e2', '1'.repeat(31), '', 1, null])('rejects invalid amount %j', async amount => {
    const { store } = await initialized();
    await expect(store.reserve({ ...reservation(), amountAtomic: amount as string })).rejects.toEqual(error('invalid_budget_input'));
    accounting(await store.status(), '0', '0', '1000');
  });

  it.each([
    { ...reservation(), operationId: '' }, { ...reservation(), operationId: '__proto__' },
    { ...reservation(), operationId: 'a/b' }, { ...reservation(), operationId: 'a'.repeat(129) },
    { ...reservation(), intentHash: 'a'.repeat(63) }, { ...reservation(), intentHash: 'g'.repeat(64) },
    { ...reservation(), intentHash: `0x${fixtureIntent}` }, { ...reservation(), executionConnected: true },
  ])('rejects malformed operation identity and extra fields: %j', async candidate => {
    const { store } = await initialized();
    await expect(store.reserve(candidate)).rejects.toEqual(error('invalid_budget_input'));
  });

  it('enforces single and aggregate limits, including already spent funds', async () => {
    const { store } = await initialized();
    await expect(store.reserve(reservation('too-large', '601'))).rejects.toEqual(error('task_budget_exceeded'));
    await store.reserve(reservation());
    await store.recordVerifiedSettlement(settlement()); // Synthetic trusted-callback input, not verification.
    await expect(store.reserve(reservation('too-much', '401'))).rejects.toEqual(error('task_budget_exceeded'));
    accounting(await store.reserve(reservation('exact', '400')), '600', '400', '0');
    await expect(store.reserve(reservation('overflow', '1'))).rejects.toEqual(error('task_budget_exceeded'));
  });

  it('keeps precision above Number.MAX_SAFE_INTEGER', async () => {
    const amount = '999999999999999999999999999999';
    const store = ledger(await location(), { ...fixtureGrant, totalBudgetAtomic: amount, perTransactionAtomic: amount });
    await store.initialize();
    accounting(await store.reserve(reservation('large', amount)), '0', amount, '0');
    accounting(await store.recordVerifiedSettlement(settlement('large')), amount, '0', '0');
  });

  it.each(['2026-09-26T23:59:59.999Z', expires, '2027-01-01T00:00:00.000Z'])('forbids new reservations outside validity at %s', async time => {
    const store = ledger(await location(), fixtureGrant, () => new Date(time));
    await store.initialize();
    await expect(store.reserve(reservation())).rejects.toEqual(error('task_budget_inactive'));
    accounting(await store.status(), '0', '0', '1000');
  });

  it.each([() => new Date(NaN), () => { throw new Error('Synthetic clock failure'); }])('fails closed on invalid server time', async now => {
    const store = ledger(await location(), fixtureGrant, now);
    await store.initialize();
    await expect(store.reserve(reservation())).rejects.toEqual(error('task_budget_unavailable'));
  });

  it('keeps unknown outcomes reserved across restart/expiry and resolves only by trusted outcome', async () => {
    const { path, store } = await initialized();
    await store.reserve(reservation());
    const unknown = await store.markUnknown(identity());
    accounting(unknown, '0', '600', '400');
    expect(unknown.operations[0].state).toBe('unknown');
    expect(await store.markUnknown(identity())).toEqual(unknown);
    const restarted = ledger(path, fixtureGrant, () => new Date('2027-01-01T00:00:00.000Z'));
    expect(await restarted.status()).toEqual(unknown);
    await expect(restarted.releaseBeforeSubmission(identity())).rejects.toEqual(error('task_budget_conflict'));
    await expect(restarted.reserve(reservation('new', '1'))).rejects.toEqual(error('task_budget_inactive'));
    const settled = await restarted.recordVerifiedSettlement(settlement());
    accounting(settled, '600', '0', '400');
    expect(await ledger(path).status()).toEqual(settled);
    expect(await restarted.recordVerifiedSettlement(settlement())).toEqual(settled);
    expect(await restarted.reserve(reservation())).toEqual(settled);
  });

  it('never automatically releases a reserved operation on expiry', async () => {
    const { path, store } = await initialized();
    await store.reserve(reservation());
    const expired = ledger(path, fixtureGrant, () => new Date(expires));
    accounting(await expired.status(), '0', '600', '400');
    accounting(await expired.markUnknown(identity()), '0', '600', '400');
  });

  it('counts unknown outcomes against remaining budget while the grant is active', async () => {
    const { store } = await initialized();
    await store.reserve(reservation());
    await store.markUnknown(identity());
    await expect(store.reserve(reservation('too-much', '401'))).rejects.toEqual(error('task_budget_exceeded'));
    await expect(store.releaseBeforeSubmission(identity())).rejects.toEqual(error('task_budget_conflict'));
    accounting(await store.reserve(reservation('remainder', '400')), '0', '1000', '0');
  });

  it('releases only a still-reserved operation and never resurrects terminal IDs', async () => {
    const { store } = await initialized();
    await store.reserve(reservation());
    const released = await store.releaseBeforeSubmission(identity());
    accounting(released, '0', '0', '1000');
    expect(released.operations[0].state).toBe('released');
    expect(await store.reserve(reservation())).toEqual(released);
    await expect(store.releaseBeforeSubmission(identity())).rejects.toEqual(error('task_budget_conflict'));
    await expect(store.markUnknown(identity())).rejects.toEqual(error('task_budget_conflict'));
    await expect(store.recordVerifiedSettlement(settlement())).rejects.toEqual(error('task_budget_conflict'));
    accounting(await store.reserve(reservation('new')), '0', '600', '400');
  });

  it('requires matching operation/intent and unique settlement proofs, with idempotent same proof', async () => {
    const { store } = await initialized();
    await store.reserve(reservation());
    await store.reserve(reservation('op-2', '400'));
    for (const candidate of [identity('missing'), { ...identity(), intentHash: 'd'.repeat(64) }]) {
      await expect(store.markUnknown(candidate)).rejects.toEqual(error('task_budget_conflict'));
      await expect(store.releaseBeforeSubmission(candidate)).rejects.toEqual(error('task_budget_conflict'));
      await expect(store.recordVerifiedSettlement({ ...candidate, transactionHash: fixtureProof })).rejects.toEqual(error('task_budget_conflict'));
    }
    const first = await store.recordVerifiedSettlement(settlement());
    expect(await store.recordVerifiedSettlement(settlement('op-1', `0x${'B'.repeat(64)}`))).toEqual(first);
    await expect(store.recordVerifiedSettlement(settlement('op-1', fixtureOtherProof))).rejects.toEqual(error('task_budget_conflict'));
    await expect(store.recordVerifiedSettlement(settlement('op-2', `0x${'B'.repeat(64)}`))).rejects.toEqual(error('task_budget_conflict'));
    await expect(store.markUnknown(identity())).rejects.toEqual(error('task_budget_conflict'));
    await expect(store.releaseBeforeSubmission(identity())).rejects.toEqual(error('task_budget_conflict'));
    accounting(await store.recordVerifiedSettlement(settlement('op-2', fixtureOtherProof)), '1000', '0', '0');
  });

  it.each(['', '0x12', 'b'.repeat(64), `0x${'z'.repeat(64)}`, null])('rejects malformed synthetic proof %j', async proof => {
    const { store } = await initialized();
    await store.reserve(reservation());
    await expect(store.recordVerifiedSettlement(settlement('op-1', proof as string))).rejects.toEqual(error('invalid_budget_input'));
    accounting(await store.status(), '0', '600', '400');
  });

  it('snapshots grant, reservation and callback inputs before asynchronous work', async () => {
    const path = await location();
    const grant = { ...fixtureGrant };
    const store = ledger(path, grant);
    grant.totalBudgetAtomic = '9999';
    grant.account = `0x${'3'.repeat(40)}`;
    await store.initialize();
    const input = reservation();
    const saving = store.reserve(input);
    input.amountAtomic = '1'; input.intentHash = 'd'.repeat(64); input.operationId = 'changed';
    const reserved = await saving;
    accounting(reserved, '0', '600', '400');
    expect(reserved.operations[0]).toMatchObject(reservation());
    const pending = identity();
    const marking = store.markUnknown(pending);
    pending.operationId = 'changed';
    await marking;
    const proof = settlement();
    const recording = store.recordVerifiedSettlement(proof);
    proof.transactionHash = fixtureOtherProof; proof.intentHash = 'd'.repeat(64);
    expect((await recording).operations[0].transactionHash).toBe(fixtureProof);
    expect(await ledger(path).status()).toEqual(await store.status());
  });

  it('returns frozen independent snapshots', async () => {
    const { store } = await initialized();
    const first = await store.reserve(reservation());
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.operations)).toBe(true);
    expect(Object.isFrozen(first.operations[0])).toBe(true);
    expect(Reflect.set(first.operations[0], 'amountAtomic', '1')).toBe(false);
    await store.markUnknown(identity());
    expect(first.operations[0].state).toBe('reserved');
    expect((await store.status()).operations[0].state).toBe('unknown');
  });

  it('snapshots the trusted release assertion before asynchronous work', async () => {
    const { store } = await initialized();
    await store.reserve(reservation());
    const input = identity();
    const releasing = store.releaseBeforeSubmission(input);
    input.operationId = 'changed'; input.intentHash = 'd'.repeat(64);
    accounting(await releasing, '0', '0', '1000');
  });

  it('rejects malformed callback identities and extra callback fields', async () => {
    const { store } = await initialized();
    await store.reserve(reservation());
    await expect(store.markUnknown({ ...identity(), intentHash: 'wrong' })).rejects.toEqual(error('invalid_budget_input'));
    await expect(store.releaseBeforeSubmission({ ...identity(), operationId: '' })).rejects.toEqual(error('invalid_budget_input'));
    const extra = { ...identity(), verified: true };
    await expect(store.markUnknown(extra)).rejects.toEqual(error('invalid_budget_input'));
    await expect(store.releaseBeforeSubmission(extra)).rejects.toEqual(error('invalid_budget_input'));
    await expect(store.recordVerifiedSettlement({ ...extra, transactionHash: fixtureProof })).rejects.toEqual(error('invalid_budget_input'));
    accounting(await store.status(), '0', '600', '400');
  });

  it.each([
    { grantId: 'changed' }, { taskId: 'changed' }, { agentId: 'changed' },
    { account: `0x${'3'.repeat(40)}` }, { payTo: `0x${'3'.repeat(40)}` },
    { totalBudgetAtomic: '1001' }, { perTransactionAtomic: '601' },
    { validForMinutes: 31, expiresAt: '2026-09-27T00:31:00.000Z' },
    { createdAt: '2026-09-27T01:00:00.000Z', expiresAt: '2026-09-27T01:30:00.000Z' },
  ])('binds the full immutable grant: %j', async change => {
    const { path, store } = await initialized();
    await store.reserve(reservation());
    const bytes = await readFile(path, 'utf8');
    const changed = ledger(path, { ...fixtureGrant, ...change });
    await expect(changed.status()).rejects.toEqual(error('task_budget_conflict'));
    await expect(changed.initialize()).rejects.toEqual(error('task_budget_conflict'));
    await expect(changed.reserve(reservation())).rejects.toEqual(error('task_budget_conflict'));
    expect(await readFile(path, 'utf8')).toBe(bytes);
  });

  it('validates the entire grant synchronously, including frozen network/resource terms', async () => {
    const path = await location();
    for (const change of [{ version: 2 }, { network: 'wrong' }, { asset: 'wrong' }, { resource: '/wrong' },
      { confirmed: false }, { totalBudgetAtomic: '0' }, { account: null }, { added: true }]) {
      expect(() => ledger(path, { ...fixtureGrant, ...change } as TaskGrant)).toThrow(TaskBudgetError);
    }
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('prevents overspending across concurrent instances with no automatic retry', async () => {
    const { path, store } = await initialized();
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
      ledger(path).reserve(reservation(`concurrent-${index}`, '600'))));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of attempts) if (result.status === 'rejected') {
      expect(['task_budget_unavailable', 'task_budget_exceeded']).toContain(result.reason.code);
    }
    accounting(await store.status(), '0', '600', '400');
  });

  it('concurrent initialization cannot reset reservations', async () => {
    const path = await location();
    const attempts = await Promise.allSettled([ledger(path).initialize(), ledger(path).initialize()]);
    expect(attempts.some(result => result.status === 'fulfilled')).toBe(true);
    const first = await ledger(path).reserve(reservation());
    const duplicates = await Promise.allSettled([ledger(path).initialize(), ledger(path).initialize()]);
    for (const result of duplicates) if (result.status === 'fulfilled') expect(result.value).toEqual(first);
    expect(await ledger(path).status()).toEqual(first);
  });

  it('concurrent identical operation IDs consume budget at most once', async () => {
    const { path } = await initialized();
    const attempts = await Promise.allSettled([ledger(path).reserve(reservation()), ledger(path).reserve(reservation())]);
    expect(attempts.some(result => result.status === 'fulfilled')).toBe(true);
    for (const result of attempts) if (result.status === 'rejected') expect(result.reason).toEqual(error('task_budget_unavailable'));
    const persisted = await ledger(path).status();
    accounting(persisted, '0', '600', '400');
    expect(persisted.operations).toHaveLength(1);
  });

  it('preserves another writer lock, including an abandoned lock after restart', async () => {
    const { path, store } = await initialized();
    await store.reserve(reservation());
    const bytes = await readFile(path, 'utf8');
    await writeFile(`${path}.lock`, 'synthetic-other-owner', { mode: 0o600 });
    for (const action of [() => store.initialize(), () => ledger(path).status(), () => store.reserve(reservation()),
      () => store.markUnknown(identity()), () => store.releaseBeforeSubmission(identity()),
      () => store.recordVerifiedSettlement(settlement())]) {
      await expect(action()).rejects.toEqual(error('task_budget_unavailable'));
      expect(await readFile(`${path}.lock`, 'utf8')).toBe('synthetic-other-owner');
    }
    expect(await readFile(path, 'utf8')).toBe(bytes);
  });

  it('never unlinks a replacement lock and refuses a write after ownership loss', async () => {
    const { path } = await initialized();
    const bytes = await readFile(path, 'utf8');
    const store = ledger(path, fixtureGrant, () => {
      // Synthetic local filesystem fault, while the first lock descriptor is still open.
      unlinkSync(`${path}.lock`);
      writeFileSync(`${path}.lock`, 'synthetic-replacement-owner', { mode: 0o600 });
      return new Date(started);
    });
    await expect(store.reserve(reservation())).rejects.toEqual(error('task_budget_unavailable'));
    expect(await readFile(`${path}.lock`, 'utf8')).toBe('synthetic-replacement-owner');
    expect(await readFile(path, 'utf8')).toBe(bytes);
  });

  it.each(['extra', 'version', 'invalid-grant', 'duplicate-id', 'over-budget', 'over-single', 'zero', 'bad-state', 'array-state', 'bad-intent',
    'reserved-proof', 'settled-no-proof', 'reused-proof'])('fails closed on structurally corrupt journal: %s', async variant => {
    const { path, store } = await initialized();
    const op = { ...reservation(), state: 'reserved', transactionHash: null };
    const journal: Record<string, unknown> = { version: 1, grant: fixtureGrant, operations: [op] };
    if (variant === 'extra') journal.extra = true;
    if (variant === 'version') journal.version = 2;
    if (variant === 'invalid-grant') journal.grant = { ...fixtureGrant, confirmed: false };
    if (variant === 'duplicate-id') journal.operations = [op, op];
    if (variant === 'over-budget') journal.operations = [op, { ...op, operationId: 'op-2' }];
    if (variant === 'over-single') journal.operations = [{ ...op, amountAtomic: '601' }];
    if (variant === 'zero') journal.operations = [{ ...op, amountAtomic: '0' }];
    if (variant === 'bad-state') journal.operations = [{ ...op, state: 'failed' }];
    if (variant === 'array-state') journal.operations = [{ ...op, state: ['reserved'] }];
    if (variant === 'bad-intent') journal.operations = [{ ...op, intentHash: 'wrong' }];
    if (variant === 'reserved-proof') journal.operations = [{ ...op, transactionHash: fixtureProof }];
    if (variant === 'settled-no-proof') journal.operations = [{ ...op, state: 'settled' }];
    if (variant === 'reused-proof') journal.operations = [
      { ...op, state: 'settled', transactionHash: fixtureProof },
      { ...op, operationId: 'op-2', amountAtomic: '400', state: 'settled', transactionHash: fixtureProof },
    ];
    const raw = JSON.stringify(journal);
    await writeFile(path, raw, { mode: 0o600 });
    await expect(store.status()).rejects.toEqual(error('task_budget_unavailable'));
    await expect(store.initialize()).rejects.toEqual(error('task_budget_unavailable'));
    expect(await readFile(path, 'utf8')).toBe(raw);
  });

  it('rejects public and symlink journals, and does not create missing parent directories', async () => {
    const { path, store } = await initialized();
    await chmod(path, 0o644);
    await expect(store.status()).rejects.toEqual(error('task_budget_unavailable'));
    await expect(store.reserve(reservation())).rejects.toEqual(error('task_budget_unavailable'));
    const link = await location();
    await symlink(path, link);
    await expect(ledger(link).initialize()).rejects.toEqual(error('task_budget_unavailable'));
    await expect(ledger(join(await location(), 'missing', 'ledger.json')).initialize()).rejects.toEqual(error('task_budget_unavailable'));
  });
});
