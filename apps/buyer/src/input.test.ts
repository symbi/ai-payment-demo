import { expect, it } from 'vitest';
import { inspectInput, payInput } from './input.ts';
import { readConfig, sellerOrigin } from './config.ts';
it.each([{}, null, [], { requestId: 'good-id-1', prompt: '' }, { requestId: 'short', prompt: '天气' }, { requestId: 'good-id-1', prompt: 'x'.repeat(501) }, { requestId: 'good-id-1', prompt: '天气', allow: true }, { requestId: 'good-id-1', prompt: '天气', url: 'https://example.com' }])('rejects invalid tool input %j', value => expect(() => inspectInput(value)).toThrow());
it('keeps exact intent for request identity and rejects pay overrides', () => {
  expect(inspectInput({ requestId: 'good-id-1', prompt: ' 天气 ' }).prompt).toBe(' 天气 ');
  expect(() => payInput({ requestId: 'good-id-1', amount: '1' })).toThrow();
  expect(payInput({ requestId: 'good-id-1' })).toBe('good-id-1');
});
it.each(['https://example.com', 'http://user:pass@localhost:4032', 'http://localhost:4032/path', 'http://localhost:4032?target=other', 'http://127.0.0.1.evil.test'])('rejects proxy destinations %s', value => expect(() => sellerOrigin(value)).toThrow());
it('only reads configuration booleans and defaults payments off', () => {
  expect(readConfig({})).toMatchObject({ sellerUrl: 'http://127.0.0.1:4032', riskKeyConfigured: false, paymentRequested: false });
  expect(JSON.stringify(readConfig({ INTERCEPTA_API_KEY: 'secret' }))).not.toContain('secret');
});
