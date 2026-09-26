import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPrivateRiskApp } from './app.ts';
import { createInterceptaScanner } from '../../buyer/src/intercepta.ts';
import { TaskGrantStore } from '../../buyer/src/task-grant-store.ts';
import { isGrantAddress } from '../../../shared/task-grant.ts';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';

// This distinct entry is never imported by the company demo server or its browser bundle.
if (process.env.PRIVATE_RISK_MACHINE !== 'personal') throw new Error('Private computer only: PRIVATE_RISK_MACHINE=personal is required. Do not start this entry on the company computer.');
const budgetText = process.env.PRIVATE_RISK_MAX_REQUESTS ?? '3';
if (!/^[1-9][0-9]{0,3}$/.test(budgetText) || Number(budgetText) > 1000) throw new Error('PRIVATE_RISK_MAX_REQUESTS must be an integer from 1 to 1000');
const maxRequests = Number(budgetText);
const key = process.env.INTERCEPTA_API_KEY?.trim();
// The request budget is shared with GH-9/CLI, not renewed by this new UI.
// Only a verified unused round can start a fresh journal in this entry.
const ready = process.env.PRIVATE_RISK_FREE_QUOTA_CONFIRMED === 'true'
  && process.env.PRIVATE_RISK_PRIOR_REQUESTS === '0' && !!key && !/[\r\n]/.test(key);
const directory = fileURLToPath(new URL('../../../.runtime/private-risk/', import.meta.url));
mkdirSync(directory, { recursive: true, mode: 0o700 });
const app = createPrivateRiskApp({
  maxRequests,
  journalPath: directory + 'scan-journal.json',
  scanner: createInterceptaScanner(key),
  ready,
  message: ready ? `扫描入口已就绪（不代表扫描成功）。每地址一次，本轮累计最多${maxRequests}次；失败也计入次数。` : '尚未就绪：请在私人电脑配置本地API key，核实免费额度和本轮此前调用次数；未确认前不会扫描。',
  html: readFileSync(new URL('../../../docs/private-risk.html', import.meta.url), 'utf8'),
  taskGrantStore: new TaskGrantStore({path: directory + 'task-grant.json', context: {
    taskId: 'report-purchase-task', taskName: '购买结构报告',
    agentId: 'report-buyer-01', agentName: '报告购买任务执行器（待接通）',
    account: isGrantAddress(process.env.BUYER_ADDRESS) ? process.env.BUYER_ADDRESS : null,
    payTo: isGrantAddress(process.env.SELLER_PAY_TO) ? process.env.SELLER_PAY_TO : null,
    network: TEST_NETWORK, asset: TEST_USDC, resource: RESOURCE_PATH,
  }}),
});
app.listen(47915, '127.0.0.1', () => console.log('Payment Demo: http://127.0.0.1:47915 (address assessment and task permission; no signing or payments)'));
