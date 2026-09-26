import type { PurchaseResult } from '../../../shared/contracts.ts';

export function initialResult(requestId: string): PurchaseResult {
  return { requestId, status: 'held', decision: 'hold', reasons: [], events: [], counters: { sign: 0, settle: 0 }, paymentEnabled: false, aiMode: 'not_configured' };
}
export function event(result: PurchaseResult, step: string, message: string) {
  result.events.push({ at: new Date().toISOString(), step, message });
}
export function hold(result: PurchaseResult, message: string) {
  result.status = 'held'; result.decision = 'hold'; result.reasons = [message]; event(result, 'hold', message);
  return result;
}
