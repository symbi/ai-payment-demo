import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskGrantStore } from '../../apps/buyer/src/task-grant-store.ts';
import { TaskBudgetLedger } from '../../apps/buyer/src/task-budget-ledger.ts';
import { checkTaskGrantIntent } from '../../apps/buyer/src/task-grant-intent.ts';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../shared/contracts.ts';

// All accounts, intent and settlement hashes here are synthetic test fixtures.
// No live entry, signer, provider or settlement verifier is constructed.
const folders: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(folders.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
const context = {
  taskId: 'test-task-budget', taskName: 'Offline test report',
  agentId: 'test-executor', agentName: 'Offline test executor',
  account: `0x${'1'.repeat(40)}`, payTo: `0x${'2'.repeat(40)}`,
  network: TEST_NETWORK, asset: TEST_USDC, resource: RESOURCE_PATH,
} as const;

async function setup() {
  const folder = await mkdtemp(join(tmpdir(), 'grant-ledger-integration-'));
  folders.push(folder);
  let clock = new Date('2026-09-27T00:00:00.000Z');
  const grantStore = new TaskGrantStore({path: join(folder, 'grant.json'), context, now: () => clock});
  const grant = (await grantStore.save({totalBudgetAtomic:'5000',perTransactionAtomic:'4000',validForMinutes:30,confirmed:true})).grant!;
  const path = join(folder, 'ledger.json');
  const make = () => new TaskBudgetLedger({path, grant, now: () => clock});
  return {grantStore, grant, path, make, expire: () => { clock = new Date('2026-09-27T01:00:00.000Z'); }};
}

describe('saved application grant to independent offline budget ledger', () => {
  it('composes the saved grant, exact intent binding and shared allowance without enabling payment', async () => {
    const {grant,make} = await setup();
    const ledger = make();
    await ledger.initialize();
    const intent = {taskId:grant.taskId,agentId:grant.agentId,account:grant.account,payTo:grant.payTo,network:grant.network,asset:grant.asset,resource:grant.resource,amountAtomic:'3000'};
    const clock = new Date('2026-09-27T00:01:00.000Z');
    const bound = checkTaskGrantIntent(grant,intent,clock);
    expect(bound).toMatchObject({passed:true,grantId:grant.grantId,paymentEnabled:false});
    expect(bound.intentHash).toMatch(/^[0-9a-f]{64}$/);
    const rejected = checkTaskGrantIntent(grant,{...intent,payTo:`0x${'3'.repeat(40)}`},clock);
    expect(rejected).toMatchObject({passed:false,intentHash:null,paymentEnabled:false});
    const original = await ledger.reserve({operationId:'bound-operation',intentHash:bound.intentHash!,amountAtomic:intent.amountAtomic});
    expect(original).toMatchObject({reservedAtomic:'3000',availableAtomic:'2000',executionConnected:false});
    const changed = checkTaskGrantIntent(grant,{...intent,amountAtomic:'2500'},clock);
    expect(changed.passed).toBe(true);
    expect(changed.intentHash).not.toBe(bound.intentHash);
    await expect(ledger.reserve({operationId:'bound-operation',intentHash:changed.intentHash!,amountAtomic:'2500'})).rejects.toThrow();
    // Passing the static Grant check does not imply remaining budget is enough.
    await expect(ledger.reserve({operationId:'second-operation',intentHash:changed.intentHash!,amountAtomic:'2500'})).rejects.toThrow();
    expect(await ledger.status()).toEqual(original);
  });

  it('keeps unknown funds reserved, resolves a fixture settlement, and recovers without granting execution', async () => {
    const network = vi.fn(() => { throw new Error('External network forbidden'); });
    vi.stubGlobal('fetch', network);
    const {make, grantStore, expire} = await setup();
    const ledger = make();
    await ledger.initialize();
    const operation = {operationId:'operation-first',intentHash:'a'.repeat(64),amountAtomic:'3000'};
    const identity = {operationId:operation.operationId,intentHash:operation.intentHash};
    await ledger.reserve(operation);
    await ledger.markUnknown(identity);
    await expect(ledger.releaseBeforeSubmission(identity)).rejects.toThrow();
    expect(await ledger.status()).toMatchObject({spentAtomic:'0',reservedAtomic:'3000',availableAtomic:'2000',executionConnected:false});
    expire();
    await expect(ledger.reserve({operationId:'operation-second',intentHash:'b'.repeat(64),amountAtomic:'1000'})).rejects.toThrow();
    const proof = {operationId:operation.operationId,intentHash:operation.intentHash,transactionHash:`0x${'c'.repeat(64)}`};
    const settled = await ledger.recordVerifiedSettlement(proof);
    expect(settled).toMatchObject({spentAtomic:'3000',reservedAtomic:'0',availableAtomic:'2000',executionConnected:false});
    expect(await make().status()).toEqual(settled);
    expect(await make().recordVerifiedSettlement(proof)).toEqual(settled);
    expect(await grantStore.status()).toMatchObject({paymentEnabled:false,executionConnected:false,accounting:{state:'not_connected',spentAtomic:null,reservedAtomic:null,availableAtomic:null,walletBalanceAtomic:null}});
    expect(network).not.toHaveBeenCalled();
  });

  it('does not spend a copied allowance twice through concurrent independent instances', async () => {
    const {make} = await setup();
    await make().initialize();
    const results = await Promise.allSettled([
      make().reserve({operationId:'operation-alpha',intentHash:'a'.repeat(64),amountAtomic:'3000'}),
      make().reserve({operationId:'operation-bravo',intentHash:'b'.repeat(64),amountAtomic:'3000'}),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await make().status()).toMatchObject({spentAtomic:'0',reservedAtomic:'3000',availableAtomic:'2000'});
  });
});
