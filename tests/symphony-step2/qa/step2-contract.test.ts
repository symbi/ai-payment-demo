import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assessDemoPayment, DEFAULT_WEIGHTS } from '../../../shared/demo-assessment.ts';
import { advanceRequest, createRequest, type DemoRequest, type DemoRequestInput } from '../../../shared/demo-requests.ts';
import { DemoRequestClient } from '../../../apps/web/src/demo-request-client.ts';
import { isAssessmentResponse } from '../../../apps/web/src/PayAssessmentDemo.tsx';

const input = {
  fixtureId: 'controlled-a', amount: '0.001000', taskLimit: '0.005000',
  weights: [...DEFAULT_WEIGHTS], contentChanged: false,
} as const;

const valid = assessDemoPayment({ ...input, weights: [...input.weights] });

it('accepts the complete pure-function result', () => {
  expect(valid.decision).toBe('allow');
  expect(isAssessmentResponse(valid)).toBe(true);
});

it.each([
  ['missing execution', { ...valid, execution: undefined }],
  ['missing one of five contributions', { ...valid, contributions: valid.contributions.slice(0, 4) }],
  ['missing reason', { ...valid, reason: undefined }],
  ['payment enabled', { ...valid, paymentEnabled: true }],
])('rejects partial successful response: %s', (_name, candidate) => {
  expect(isAssessmentResponse(candidate)).toBe(false);
});

it('keeps a late allow invalid after input change and cannot reattach it after explicit end', async () => {
  const requestInput: DemoRequestInput = {
    ...input, weights: [...input.weights], scenario: 'normal',
  };
  let resolveFirst!: (record: DemoRequest) => void;
  const firstResponse = new Promise<DemoRequest>(resolve => { resolveFirst = resolve; });
  let stored: string | null = null;
  const storage = { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } };
  const client = new DemoRequestClient({
    mode: 'http', storage, id: () => 'late-input-change', now: () => 0,
    transport: { post: () => firstResponse, get: async () => null },
  });
  const work = client.submit(requestInput);
  client.invalidate();
  resolveFirst(advanceRequest(createRequest('late-input-change', requestInput, 0), 300));
  await work;
  const afterChange = client.snapshot();
  expect(afterChange).toMatchObject({ invalidated: true, record: { status: 'completed', result: { decision: 'allow' } } });
  expect(!afterChange.invalidated && afterChange.record?.status === 'completed').toBe(false);

  let resolveSecond!: (record: DemoRequest) => void;
  const secondResponse = new Promise<DemoRequest>(resolve => { resolveSecond = resolve; });
  const ended = new DemoRequestClient({
    mode: 'http', storage, id: () => 'ended-request', now: () => 0,
    transport: { post: () => secondResponse, get: async () => null },
  });
  const oldWork = ended.submit(requestInput);
  ended.end();
  resolveSecond(advanceRequest(createRequest('ended-request', requestInput, 0), 300));
  await oldWork;
  expect(ended.snapshot()).toMatchObject({ record: null, busy: false, invalidated: false });
});

it('keeps the generated offline page self-contained and clearly simulated', () => {
  const html = readFileSync('docs/offline-pay.html', 'utf8');
  expect(html).toContain('纯演示·无真实付款');
  expect(html).toContain("connect-src 'self'");
  expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=/i);
  expect(html).not.toContain('/api/pay');
  expect(html).toContain('模拟钱包');
  expect(html).toContain('已知风险（模拟）');
  expect(html).toContain('受控测试样例');
  expect(html).toContain('灰色／证据不明');
});
