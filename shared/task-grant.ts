import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from './contracts.ts';

/** Application permission only. This DTO never enables or authorizes a signer. */
export const TASK_GRANT_REVISION = 'task-grant-v1' as const;
export type TaskGrantContext = {
  taskId: string; taskName: string; agentId: string; agentName: string;
  account: string | null; payTo: string | null;
  network: typeof TEST_NETWORK; asset: typeof TEST_USDC; resource: typeof RESOURCE_PATH;
};
export type TaskGrantInput = {
  totalBudgetAtomic: string; perTransactionAtomic: string; validForMinutes: number; confirmed: true;
};
export type TaskGrant = TaskGrantInput & {
  grantId: string; version: 1; taskId: string; agentId: string;
  account: string; payTo: string; network: typeof TEST_NETWORK;
  asset: typeof TEST_USDC; resource: typeof RESOURCE_PATH; createdAt: string; expiresAt: string;
};
export type TaskGrantStatus = {
  contractRevision: typeof TASK_GRANT_REVISION;
  context: TaskGrantContext; grant: TaskGrant | null; canSave: boolean;
  paymentEnabled: false; executionConnected: false;
  accounting: { state: 'not_connected'; spentAtomic: null; reservedAtomic: null; availableAtomic: null; walletBalanceAtomic: null };
};
export type TaskGrantPanelProps = {
  status: TaskGrantStatus | null; loading: boolean; message: string;
  onSave(input: TaskGrantInput): Promise<void> | void; onRefresh(): Promise<void> | void;
};
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const exact = (x: Record<string,unknown>, names: string[]) => Object.keys(x).length === names.length && names.every(k => Object.hasOwn(x,k));
export const isGrantAddress = (x: unknown): x is string => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x) && !/^0x0{40}$/i.test(x);
export const isGrantAtomic = (x: unknown): x is string => typeof x === 'string' && /^[1-9][0-9]{0,29}$/.test(x);
const label = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length <= 160;
const id = (x: unknown) => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(x) && !['__proto__','constructor','prototype'].includes(x);
export function isTaskGrantInput(x: unknown): x is TaskGrantInput {
  return object(x) && exact(x,['totalBudgetAtomic','perTransactionAtomic','validForMinutes','confirmed']) &&
    isGrantAtomic(x.totalBudgetAtomic) && isGrantAtomic(x.perTransactionAtomic) && BigInt(x.perTransactionAtomic) <= BigInt(x.totalBudgetAtomic) &&
    Number.isSafeInteger(x.validForMinutes) && Number(x.validForMinutes) >= 1 && Number(x.validForMinutes) <= 1440 && x.confirmed === true;
}
export function isTaskGrantContext(x: unknown): x is TaskGrantContext {
  return object(x) && exact(x,['taskId','taskName','agentId','agentName','account','payTo','network','asset','resource']) &&
    id(x.taskId) && id(x.agentId) && label(x.taskName) && label(x.agentName) &&
    (x.account === null || isGrantAddress(x.account)) && (x.payTo === null || isGrantAddress(x.payTo)) &&
    x.network === TEST_NETWORK && x.asset === TEST_USDC && x.resource === RESOURCE_PATH;
}
export function isTaskGrant(x: unknown): x is TaskGrant {
  if (!object(x) || !exact(x,['totalBudgetAtomic','perTransactionAtomic','validForMinutes','confirmed','grantId','version','taskId','agentId','account','payTo','network','asset','resource','createdAt','expiresAt'])) return false;
  const input = {totalBudgetAtomic:x.totalBudgetAtomic,perTransactionAtomic:x.perTransactionAtomic,validForMinutes:x.validForMinutes,confirmed:x.confirmed};
  if (!isTaskGrantInput(input) || !id(x.grantId) || x.version !== 1 || !id(x.taskId) || !id(x.agentId) || !isGrantAddress(x.account) || !isGrantAddress(x.payTo) || x.network !== TEST_NETWORK || x.asset !== TEST_USDC || x.resource !== RESOURCE_PATH || typeof x.createdAt !== 'string' || typeof x.expiresAt !== 'string') return false;
  const created=Date.parse(x.createdAt), expires=Date.parse(x.expiresAt);
  return Number.isFinite(created) && Number.isFinite(expires) && expires-created === input.validForMinutes*60_000;
}
export function isTaskGrantStatus(x: unknown): x is TaskGrantStatus {
  if (!object(x) || !exact(x,['contractRevision','context','grant','canSave','paymentEnabled','executionConnected','accounting']) || x.contractRevision !== TASK_GRANT_REVISION || !isTaskGrantContext(x.context) || typeof x.canSave !== 'boolean' || x.paymentEnabled !== false || x.executionConnected !== false || !object(x.accounting) || !exact(x.accounting,['state','spentAtomic','reservedAtomic','availableAtomic','walletBalanceAtomic'])) return false;
  const accounting = x.accounting;
  if(accounting.state !== 'not_connected' || ['spentAtomic','reservedAtomic','availableAtomic','walletBalanceAtomic'].some(k=>accounting[k]!==null)) return false;
  if(x.grant === null) return x.canSave === (isGrantAddress(x.context.account) && isGrantAddress(x.context.payTo));
  if(!isTaskGrant(x.grant) || x.canSave !== false) return false;
  return ['taskId','agentId','account','payTo','network','asset','resource'].every(k => (x.grant as unknown as Record<string,unknown>)[k] === (x.context as unknown as Record<string,unknown>)[k]);
}
