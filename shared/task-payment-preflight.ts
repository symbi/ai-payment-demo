import { isGrantAtomic } from './task-grant.ts';

/** Local Grant scope check only: no balance check, reservation, scan or execution. */
export const TASK_PREFLIGHT_REVISION = 'task-preflight-v1' as const;
export const TASK_PREFLIGHT_CODES = ['passed', 'not_configured', 'grant_missing', 'grant_unavailable', 'invalid_quote',
  'invalid_grant', 'invalid_intent', 'invalid_clock', 'grant_not_started', 'grant_expired', 'scope_mismatch', 'amount_exceeds_limit'] as const;
export type TaskPreflightCode = typeof TASK_PREFLIGHT_CODES[number];
export type TaskPaymentPreflight = Readonly<{
  contractRevision: typeof TASK_PREFLIGHT_REVISION;
  passed: boolean; code: TaskPreflightCode;
  grantId: string | null; intentHash: string | null; amountAtomic: string | null;
  paymentEnabled: false; executionConnected: false;
}>;
export function isTaskPaymentPreflight(value: unknown): value is TaskPaymentPreflight {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = ['contractRevision', 'passed', 'code', 'grantId', 'intentHash', 'amountAtomic', 'paymentEnabled', 'executionConnected'];
  if (Object.keys(v).length !== keys.length || !keys.every(key => Object.hasOwn(v, key))
    || v.contractRevision !== TASK_PREFLIGHT_REVISION || typeof v.passed !== 'boolean'
    || !(TASK_PREFLIGHT_CODES as readonly unknown[]).includes(v.code)
    || v.paymentEnabled !== false || v.executionConnected !== false) return false;
  if (!v.passed) return v.code !== 'passed' && v.grantId === null && v.intentHash === null && v.amountAtomic === null;
  return v.code === 'passed' && typeof v.grantId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v.grantId)
    && !['__proto__', 'constructor', 'prototype'].includes(v.grantId)
    && typeof v.intentHash === 'string' && /^[0-9a-f]{64}$/.test(v.intentHash) && isGrantAtomic(v.amountAtomic);
}
