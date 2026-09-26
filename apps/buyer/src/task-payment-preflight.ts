import { fileURLToPath } from 'node:url';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';
import { isGrantAddress, isTaskGrantStatus, type TaskGrantContext } from '../../../shared/task-grant.ts';
import { TASK_PREFLIGHT_REVISION, type TaskPaymentPreflight, type TaskPreflightCode } from '../../../shared/task-payment-preflight.ts';
import { checkTaskGrantIntent } from './task-grant-intent.ts';
import { TaskGrantStore } from './task-grant-store.ts';
import { sellerOrigin } from './config.ts';
import type { Quote } from './seller.ts';

export type TaskPaymentPreflightChecker = (quote: Quote) => Promise<TaskPaymentPreflight>;
const failed = (code: TaskPreflightCode): TaskPaymentPreflight => Object.freeze({
  contractRevision: TASK_PREFLIGHT_REVISION, passed: false, code, grantId: null, intentHash: null,
  amountAtomic: null, paymentEnabled: false, executionConnected: false,
});

/** The runtime receives only this reader; it cannot save a Grant or touch either budget journal. */
export function createTaskPaymentPreflight(
  reader: Pick<TaskGrantStore, 'status' | 'context'>,
  origin: string,
  now: () => Date = () => new Date(),
): TaskPaymentPreflightChecker {
  const expectedUrl = `${sellerOrigin(origin)}${RESOURCE_PATH}`;
  const context = Object.freeze({ ...reader.context });
  return async (quote) => {
    // Snapshot the server-held quote before the filesystem await; never use client Grant/amount fields.
    const intent = { taskId: context.taskId, agentId: context.agentId, account: context.account,
      payTo: quote.terms.payTo, network: quote.terms.network, asset: quote.terms.asset,
      resource: RESOURCE_PATH, amountAtomic: quote.terms.amount };
    if (quote.method !== 'GET' || quote.url !== expectedUrl || quote.terms.scheme !== 'exact') return failed('invalid_quote');
    if (!isGrantAddress(context.account) || !isGrantAddress(context.payTo)) return failed('not_configured');
    try {
      // status() rereads the journal each time; no cache, directory creation, lock or save.
      const status = await reader.status();
      if (!isTaskGrantStatus(status) || Object.keys(context).some(key =>
        status.context[key as keyof TaskGrantContext] !== context[key as keyof TaskGrantContext])) return failed('grant_unavailable');
      if (!status.grant) return failed('grant_missing');
      let time: Date;
      try { time = now(); } catch { return failed('invalid_clock'); }
      const checked = checkTaskGrantIntent(status.grant, intent, time);
      if (!checked.passed) return failed(checked.code);
      return Object.freeze({ contractRevision: TASK_PREFLIGHT_REVISION, passed: true, code: 'passed',
        grantId: checked.grantId, intentHash: checked.intentHash, amountAtomic: intent.amountAtomic,
        paymentEnabled: false, executionConnected: false });
    } catch {
      return failed('grant_unavailable');
    }
  };
}

/** Same repository-relative journal and server identity as private-risk/index.ts.
 * That entry remains the sole writer. A different checkout has a different journal and must HOLD.
 * No runtime-supplied path, client scope, ledger or payment dependency is accepted here.
 */
export function createRuntimeTaskPaymentPreflight(
  env: { BUYER_ADDRESS?: string; SELLER_PAY_TO?: string },
  origin: string,
): TaskPaymentPreflightChecker {
  const context: TaskGrantContext = {
    taskId: 'report-purchase-task', taskName: '购买结构报告',
    agentId: 'report-buyer-01', agentName: '报告购买任务执行器（待接通）',
    account: isGrantAddress(env.BUYER_ADDRESS) ? env.BUYER_ADDRESS : null,
    payTo: isGrantAddress(env.SELLER_PAY_TO) ? env.SELLER_PAY_TO : null,
    network: TEST_NETWORK, asset: TEST_USDC, resource: RESOURCE_PATH,
  };
  const store = new TaskGrantStore({ path: fileURLToPath(new URL('../../../.runtime/private-risk/task-grant.json', import.meta.url)), context });
  return createTaskPaymentPreflight({ context: store.context, status: () => store.status() }, origin);
}
