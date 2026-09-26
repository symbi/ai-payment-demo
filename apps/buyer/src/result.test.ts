import { expect, it } from 'vitest';
import { event, hold, initialResult } from './result.ts';
it('starts without signatures, settlements or AI claims and records explicit hold evidence', () => {
  const result = initialResult('test-request');
  event(result, 'request', '手动工具请求'); hold(result, '尚未验证真实 scan');
  expect(result).toMatchObject({ status: 'held', decision: 'hold', counters: { sign: 0, settle: 0 }, paymentEnabled: false, aiMode: 'not_configured' });
  expect(result.events.map(e => e.step)).toEqual(['request', 'hold']);
  expect(result.events.every(e => !Number.isNaN(Date.parse(e.at)))).toBe(true);
});
