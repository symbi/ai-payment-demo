import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { TASK_GRANT_REVISION, type TaskGrantStatus } from '../../../shared/task-grant.ts';
import { TaskAuthorizationPanel } from './TaskAuthorizationPanel.tsx';

const status = (overrides: Partial<TaskGrantStatus> = {}): TaskGrantStatus => ({
  contractRevision: TASK_GRANT_REVISION,
  context: { taskId: 'task-16', taskName: '同一付款 Demo', agentId: 'agent-7', agentName: '受控执行器', account: '0x1111111111111111111111111111111111111111', payTo: '0x2222222222222222222222222222222222222222', network: 'eip155:84532', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', resource: '/api/contract-insights' },
  grant: null, canSave: true, paymentEnabled: false, executionConnected: false,
  accounting: { state: 'not_connected', spentAtomic: null, reservedAtomic: null, availableAtomic: null, walletBalanceAtomic: null }, ...overrides,
});
const props = (current: TaskGrantStatus | null, overrides: Partial<Parameters<typeof TaskAuthorizationPanel>[0]> = {}) => ({ status: current, loading: false, message: '', onSave: vi.fn(), onRefresh: vi.fn(), ...overrides });

it('renders unloaded state without a save path or fake accounting values', () => {
  const html = renderToStaticMarkup(createElement(TaskAuthorizationPanel, props(null)));
  expect(html).toContain('任务许可与预算'); expect(html).toContain('尚未加载许可状态'); expect(html).toContain('钱包余额'); expect(html).toContain('未接入');
  expect(html).not.toContain('>0 USDC<'); expect(html).not.toContain('href=');
});

it('renders missing configuration as unavailable rather than assuming a wallet', () => {
  const html = renderToStaticMarkup(createElement(TaskAuthorizationPanel, props(status({ canSave: false, context: { ...status().context, account: null, payTo: null } }))));
  expect(html).toContain('付款账户'); expect(html).toContain('受控卖方'); expect(html).toContain('未配置'); expect(html).toContain('当前不能保存');
});

it('renders a ready form with blank budget inputs and confirmation', () => {
  const html = renderToStaticMarkup(createElement(TaskAuthorizationPanel, props(status())));
  expect(html).toContain('保存任务许可'); expect(html).toContain('placeholder="例如 10.50"'); expect(html).toContain('value="30"'); expect(html).toContain('保存不代表付款或任务已开始');
});

it('renders saved grant details as read-only and keeps accounting unconnected', () => {
  const grant = { totalBudgetAtomic: '10500000', perTransactionAtomic: '2000000', validForMinutes: 30, confirmed: true as const, grantId: 'grant-16', version: 1 as const, taskId: 'task-16', agentId: 'agent-7', account: status().context.account!, payTo: status().context.payTo!, network: status().context.network, asset: status().context.asset, resource: status().context.resource, createdAt: '2026-09-27T00:00:00.000Z', expiresAt: '2026-09-27T00:30:00.000Z' };
  const html = renderToStaticMarkup(createElement(TaskAuthorizationPanel, props(status({ grant, canSave: false }))));
  expect(html).toContain('grant-16 · v1'); expect(html).toContain('10.5 USDC'); expect(html).toContain('2 USDC'); expect(html).toContain('已保存，尚未接通付款'); expect(html).toContain('不能在此页面随意改账'); expect(html).not.toContain('钱包余额</dt><dd>0');
});

it('renders parent message and capability boundaries without a risk total', () => {
  const html = renderToStaticMarkup(createElement(TaskAuthorizationPanel, props(status(), { message: '许可查询失败，请稍后重试。' })));
  expect(html).toContain('许可查询失败，请稍后重试'); expect(html).toContain('付款、签名、钱包连接和链上结算尚未接通'); expect(html).toContain('混合风险总分不在本面板中'); expect(html).not.toContain('综合评分');
});
