import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assessDemoPayment, DEFAULT_WEIGHTS } from '../../../shared/demo-assessment.ts';
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

it('keeps input invalidation and late-response guards before every result write', () => {
  const source = readFileSync('apps/web/src/PayAssessmentDemo.tsx', 'utf8');
  const revisionCapture = source.indexOf('const revision = inputRevision.current;');
  const responseAwait = source.indexOf('const value: unknown = await response.json();');
  const staleGuard = source.indexOf('if (revision !== inputRevision.current) return;', responseAwait);
  const resultWrite = source.indexOf('setAssessment(value);', responseAwait);
  const catchGuard = source.indexOf('if (revision !== inputRevision.current) return;', resultWrite);
  const catchWrite = source.indexOf('setAssessment(null);', catchGuard);
  expect(revisionCapture).toBeGreaterThan(-1);
  expect(responseAwait).toBeGreaterThan(revisionCapture);
  expect(staleGuard).toBeGreaterThan(responseAwait);
  expect(resultWrite).toBeGreaterThan(staleGuard);
  expect(catchGuard).toBeGreaterThan(resultWrite);
  expect(catchWrite).toBeGreaterThan(catchGuard);
  expect(source).toContain('inputRevision.current += 1;');
  expect(source).toContain('setAssessment(null);');
  expect(source).toContain('window.setTimeout(() => controller.abort(), 10000)');
  expect(source).toContain('signal: controller.signal');
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
