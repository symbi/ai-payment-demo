import { createHash } from 'node:crypto';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';
import { isGrantAddress, isGrantAtomic, isTaskGrant, TASK_GRANT_REVISION } from '../../../shared/task-grant.ts';

export type TaskPaymentIntent = {
  taskId: string; agentId: string; account: string; payTo: string;
  network: string; asset: string; resource: string; amountAtomic: string;
};

export type TaskGrantIntentCode = 'passed' | 'invalid_grant' | 'invalid_intent'
  | 'invalid_clock' | 'grant_not_started' | 'grant_expired' | 'scope_mismatch' | 'amount_exceeds_limit';
export type TaskGrantIntentResult = {
  passed: boolean; code: TaskGrantIntentCode; grantId: string | null;
  intentHash: string | null; paymentEnabled: false;
};

const grantKeys = ['totalBudgetAtomic', 'perTransactionAtomic', 'validForMinutes', 'confirmed',
  'grantId', 'version', 'taskId', 'agentId', 'account', 'payTo', 'network', 'asset', 'resource', 'createdAt', 'expiresAt'];
const intentKeys = ['taskId', 'agentId', 'account', 'payTo', 'network', 'asset', 'resource', 'amountAtomic'];

// Snapshot data properties once: reject hidden extras, symbols and accessors too.
function snapshot(value: unknown, keys: string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || !keys.every(key => own.includes(key))) return null;
    const copy: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) return null;
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return null;
  }
}

const identifier = (value: unknown): value is string => typeof value === 'string'
  && /^[a-zA-Z0-9_-]{1,128}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);

/** Local application-scope check only; no risk, balance, wallet or payment authorization. */
export function checkTaskGrantIntent(grant: unknown, intent: unknown, now: Date = new Date()): TaskGrantIntentResult {
  const fail = (code: TaskGrantIntentCode, grantId: string | null = null): TaskGrantIntentResult =>
    ({ passed: false, code, grantId, intentHash: null, paymentEnabled: false });
  const saved = snapshot(grant, grantKeys);
  // The shared validator requires the constant's spelling; address casing is semantic here.
  if (saved && isGrantAddress(saved.asset) && saved.asset.toLowerCase() === TEST_USDC.toLowerCase()) saved.asset = TEST_USDC;
  if (!isTaskGrant(saved)) return fail('invalid_grant');
  const bound = snapshot(intent, intentKeys);
  if (!bound || !identifier(bound.taskId) || !identifier(bound.agentId)
    || !isGrantAddress(bound.account) || !isGrantAddress(bound.payTo) || !isGrantAddress(bound.asset)
    || typeof bound.network !== 'string' || typeof bound.resource !== 'string'
    || !isGrantAtomic(bound.amountAtomic)) return fail('invalid_intent', saved.grantId);

  let time: number;
  try { time = Date.prototype.getTime.call(now); } catch { return fail('invalid_clock', saved.grantId); }
  if (!Number.isFinite(time)) return fail('invalid_clock', saved.grantId);
  const created = Date.parse(saved.createdAt), expires = Date.parse(saved.expiresAt);
  if (time < created) return fail('grant_not_started', saved.grantId);
  if (time >= expires) return fail('grant_expired', saved.grantId);
  if (bound.taskId !== saved.taskId || bound.agentId !== saved.agentId
    || bound.account.toLowerCase() !== saved.account.toLowerCase()
    || bound.payTo.toLowerCase() !== saved.payTo.toLowerCase()
    || bound.network !== TEST_NETWORK || bound.asset.toLowerCase() !== TEST_USDC.toLowerCase()
    || bound.resource !== RESOURCE_PATH) return fail('scope_mismatch', saved.grantId);
  // Decimal strings are bounded by the shared validator; BigInt never rounds atomic units.
  if (BigInt(bound.amountAtomic) > BigInt(saved.perTransactionAtomic)) return fail('amount_exceeds_limit', saved.grantId);

  // Fixed-position JSON tuple, UTF-8, domain separated. Scope equality above means the
  // normalized grant scope also fully represents the intent scope. Dates bind instants.
  const canonical = JSON.stringify([
    'task-grant-intent-v1', TASK_GRANT_REVISION, saved.grantId, saved.version,
    saved.taskId, saved.agentId, saved.account.toLowerCase(), saved.payTo.toLowerCase(),
    saved.network, saved.asset.toLowerCase(), saved.resource,
    saved.totalBudgetAtomic, saved.perTransactionAtomic, saved.validForMinutes,
    saved.confirmed, created, expires, bound.amountAtomic,
  ]);
  return { passed: true, code: 'passed', grantId: saved.grantId,
    intentHash: createHash('sha256').update(canonical, 'utf8').digest('hex'), paymentEnabled: false };
}
