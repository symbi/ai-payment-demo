import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FacilitatorClient } from '@x402/core/server';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { createSellerApp } from './app.ts';
import { PRICE_ATOMIC, TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';

// Public synthetic addresses and unsigned payloads are confined to this test file.
const payTo = '0x1111111111111111111111111111111111111111';
const payer = '0x2222222222222222222222222222222222222222';
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise<void>((resolve, reject) => {
  if (!s.listening) return resolve();
  s.close(e => e ? reject(e) : resolve());
}))); });
async function serve(options: Parameters<typeof createSellerApp>[0]) {
  const server = createSellerApp(options).listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
function fakeFacilitator() {
  return {
    getSupported: vi.fn<FacilitatorClient['getSupported']>().mockResolvedValue({
      kinds: [{ x402Version: 2, scheme: 'exact', network: TEST_NETWORK }], extensions: [], signers: {},
    }),
    verify: vi.fn<FacilitatorClient['verify']>().mockResolvedValue({ isValid: true, payer }),
    settle: vi.fn<FacilitatorClient['settle']>().mockResolvedValue({ success: true, transaction: '0x' + 'a'.repeat(64), network: TEST_NETWORK, payer }),
  };
}
async function paymentHeader(base: string, path = '/api/weather') {
  const response = await fetch(base + path);
  const required = decodePaymentRequiredHeader(response.headers.get('payment-required')!);
  return encodePaymentSignatureHeader({ x402Version: 2, accepted: required.accepts[0], resource: required.resource,
    payload: { signature: '0x', authorization: { from: payer, to: payTo, value: PRICE_ATOMIC,
      validAfter: '0', validBefore: '9999999999', nonce: '0x' + '0'.repeat(64) } } });
}
describe('seller SDK HTTP integration (fake facilitator; no real settlement)', () => {
  it.each([undefined, 'bad-address', '0x0000000000000000000000000000000000000000'])('fails closed for payTo %s', async payTo => {
    const facilitator = fakeFacilitator();
    const base = await serve({ payTo, facilitator });
    expect((await (await fetch(base + '/health')).json()).configured).toBe(false);
    expect((await fetch(base + '/api/weather')).status).toBe(503);
    expect(facilitator.getSupported).not.toHaveBeenCalled();
  });
  it('returns actual SDK v2 requirements without releasing the fixture', async () => {
    const facilitator = fakeFacilitator();
    const base = await serve({ payTo, facilitator });
    expect((await (await fetch(base + '/health')).json()).ready).toBe(false);
    const response = await fetch(base + '/api/weather');
    expect(response.status).toBe(402);
    const required = decodePaymentRequiredHeader(response.headers.get('payment-required')!);
    expect(required.x402Version).toBe(2);
    expect(required.accepts).toHaveLength(1);
    expect(required.accepts[0]).toMatchObject({ scheme: 'exact', network: TEST_NETWORK, asset: TEST_USDC, amount: '1000', payTo });
    expect(await response.text()).not.toContain('temperatureC');
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(facilitator.settle).not.toHaveBeenCalled();
  });
  it('preserves a labelled quote but blocks paid requests when facilitator is unavailable', async () => {
    const facilitator = fakeFacilitator();
    facilitator.getSupported.mockRejectedValue(new Error('offline'));
    const base = await serve({ payTo, facilitator });
    const quote = await fetch(base + '/api/weather');
    expect(quote.status).toBe(402);
    expect((await quote.json()).facilitatorStatus).toBe('unavailable');
    expect((await fetch(base + '/api/weather', { headers: { 'payment-signature': 'invalid' } })).status).toBe(503);
    expect((await (await fetch(base + '/health')).json()).facilitatorStatus).toBe('unavailable');
  });
  it('rejects a malformed payment header without invoking settlement', async () => {
    const facilitator = fakeFacilitator();
    const base = await serve({ payTo, facilitator });
    const response = await fetch(base + '/api/weather', { headers: { 'payment-signature': 'not-base64-json' } });
    expect(response.status).toBe(402);
    expect(await response.text()).not.toContain('temperatureC');
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(facilitator.settle).not.toHaveBeenCalled();
  });
  it.each(['/api/weather/', '/API/WEATHER'])('initializes before the first request to %s', async path => {
    const facilitator = fakeFacilitator();
    const base = await serve({ payTo, facilitator });
    const response = await fetch(base + path);
    expect(response.status).toBe(402);
    expect(decodePaymentRequiredHeader(response.headers.get('payment-required')!).accepts[0])
      .toMatchObject({ payTo, amount: PRICE_ATOMIC, asset: TEST_USDC, network: TEST_NETWORK });
    expect(await response.text()).not.toContain('temperatureC');
    expect(facilitator.getSupported).toHaveBeenCalledOnce();
    expect(facilitator.settle).not.toHaveBeenCalled();
  });
  it.each(['verify', 'settle'] as const)('reports %s outage after initialization and recovers only on a real call', async operation => {
    const facilitator = fakeFacilitator();
    const base = await serve({ payTo, facilitator });
    const signature = await paymentHeader(base);
    const health = async () => (await fetch(base + '/health')).json();
    expect(await health()).toMatchObject({ ready: true, facilitatorInitialized: true });
    facilitator[operation].mockRejectedValueOnce(new Error('offline'));
    const response = await fetch(base + '/api/weather', { headers: { 'payment-signature': signature } });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain('temperatureC');
    expect(await health()).toMatchObject({ ready: false, facilitatorInitialized: true, facilitatorStatus: 'unavailable' });
    // A quote only reuses cached capabilities: it cannot prove an outage ended.
    expect((await fetch(base + '/api/weather')).status).toBe(402);
    expect(await health()).toMatchObject({ ready: false, facilitatorStatus: 'unavailable' });
    expect(facilitator.getSupported).toHaveBeenCalledOnce();
    const recovered = await fetch(base + '/api/weather', { headers: { 'payment-signature': signature } });
    expect(recovered.status).toBe(200);
    expect(await health()).toMatchObject({ ready: true, facilitatorStatus: 'ready' });
  });
  it.each(['invalid', 'verify-throws', 'settle-fails', 'settle-throws', 'success'] as const)('%s respects verify/settle boundary', async mode => {
    const facilitator = fakeFacilitator();
    if (mode === 'invalid') facilitator.verify.mockResolvedValue({ isValid: false, invalidReason: 'invalid_signature' });
    if (mode === 'verify-throws') facilitator.verify.mockRejectedValue(new Error('verify offline'));
    if (mode === 'settle-fails') facilitator.settle.mockResolvedValue({ success: false, errorReason: 'failed', transaction: '', network: TEST_NETWORK });
    if (mode === 'settle-throws') facilitator.settle.mockRejectedValue(new Error('settlement unknown'));
    const base = await serve({ payTo, facilitator });
    const response = await fetch(base + '/api/weather', { headers: { 'payment-signature': await paymentHeader(base) } });
    const body = await response.text();
    if (mode === 'success') {
      expect(response.status).toBe(200);
      expect(JSON.parse(body)).toMatchObject({ source: 'demo-fixture', city: 'Tokyo', temperatureC: 24 });
      expect(response.headers.get('payment-response')).toBeTruthy();
      expect(facilitator.verify).toHaveBeenCalledOnce();
      expect(facilitator.settle).toHaveBeenCalledOnce();
      expect(facilitator.verify.mock.invocationCallOrder[0]).toBeLessThan(facilitator.settle.mock.invocationCallOrder[0]);
    } else {
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(body).not.toContain('temperatureC');
      const receipt = response.headers.get('payment-response');
      if (receipt) expect(decodePaymentResponseHeader(receipt).success).toBe(false);
      if (mode === 'invalid' || mode === 'verify-throws') expect(facilitator.settle).not.toHaveBeenCalled();
    }
  });
});


describe('Contract Insights gated report', () => {
  const path = '/api/contract-insights';
  it('exposes only an explicitly public sample and health identity without payment configuration', async () => {
    const facilitator = fakeFacilitator();
    const base = await serve({ facilitator });
    const response = await fetch(base + path + '/sample');
    expect(response.status).toBe(200);
    const sample = await response.json();
    expect(sample).toMatchObject({ kind: 'public-sample', metrics: { functions: 4, events: 2, modifiers: 1 } });
    expect(sample).not.toHaveProperty('declarations');
    expect(await (await fetch(base + '/health')).json()).toMatchObject({ resourcePath: path, sourceSha256: sample.source.sha256 });
    expect((await fetch(base + path)).status).toBe(503);
    expect(facilitator.getSupported).not.toHaveBeenCalled();
  });
  it.each([path, path + '/', path.toUpperCase()])('quotes the new resource without leaking report: %s', async route => {
    const facilitator = fakeFacilitator();
    const base = await serve({ payTo, facilitator });
    const response = await fetch(base + route);
    expect(response.status).toBe(402);
    const quote = decodePaymentRequiredHeader(response.headers.get('payment-required')!);
    expect(quote.resource?.url).toBe(base + route);
    expect(quote.accepts[0]).toMatchObject({ payTo, network: TEST_NETWORK, asset: TEST_USDC, amount: PRICE_ATOMIC });
    expect(await response.text()).not.toContain('declarations');
  });
  it('preserves resource in fallback quote and withholds full report', async () => {
    const facilitator = fakeFacilitator(); facilitator.getSupported.mockRejectedValue(new Error('offline'));
    const base = await serve({ payTo, facilitator });
    const response = await fetch(base + path);
    const quote = decodePaymentRequiredHeader(response.headers.get('payment-required')!);
    expect(response.status).toBe(402); expect(quote.resource?.url).toBe(base + path);
    expect(await response.text()).not.toContain('declarations');
  });
  it.each(['verify-reject', 'settle-reject', 'success'])('gates full report on %s', async mode => {
    const facilitator = fakeFacilitator();
    if (mode === 'verify-reject') facilitator.verify.mockResolvedValue({ isValid: false, invalidReason: 'invalid' });
    if (mode === 'settle-reject') facilitator.settle.mockResolvedValue({ success: false, errorReason: 'failed', transaction: '', network: TEST_NETWORK });
    const base = await serve({ payTo, facilitator });
    const response = await fetch(base + path, { headers: { 'payment-signature': await paymentHeader(base, path) } });
    const text = await response.text();
    if (mode === 'success') {
      expect(response.status).toBe(200);
      const report = JSON.parse(text);
      expect(report.kind).toBe('paid-structure-report');
      expect(report.declarations.functions).toHaveLength(4);
      expect(report.source.sha256).toBe((await (await fetch(base + path + '/sample')).json()).source.sha256);
    } else { expect(response.status).toBeGreaterThanOrEqual(400); expect(text).not.toContain('declarations'); }
  });
});


describe('deferred settlement never releases paid report early', () => {
  it.each(['success', 'rejected', 'exception'] as const)('buffers the HTTP response until settle %s', async outcome => {
    const path = '/api/contract-insights';
    const facilitator = fakeFacilitator();
    type Settlement = Awaited<ReturnType<FacilitatorClient['settle']>>;
    let resolveSettlement!: (value: Settlement) => void;
    let rejectSettlement!: (reason: Error) => void;
    const pendingSettlement = new Promise<Settlement>((resolve, reject) => {
      resolveSettlement = resolve; rejectSettlement = reject;
    });
    facilitator.settle.mockImplementation(() => pendingSettlement);
    const base = await serve({ payTo, facilitator });
    const signature = await paymentHeader(base, path);
    let headersReceived = false;
    const chunks: Buffer[] = [];
    let client!: ReturnType<typeof request>;
    const completed = new Promise<{ status: number; body: string }>((resolve, reject) => {
      client = request(base + path, { headers: { 'payment-signature': signature } }, response => {
        headersReceived = true;
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString('utf8') }));
      });
      client.on('error', reject);
      client.setTimeout(2000, () => client.destroy(new Error('Local response timed out')));
      client.end();
    });
    // Observe failure promptly without an unhandled rejection during cleanup.
    void completed.catch(() => {});
    try {
      await vi.waitFor(() => expect(facilitator.settle).toHaveBeenCalledOnce(), { timeout: 1000, interval: 5 });
      expect(facilitator.verify).toHaveBeenCalledOnce();
      // Give queued socket writes time to reach the client while settlement stays unresolved.
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(headersReceived).toBe(false);
      expect(Buffer.concat(chunks).byteLength).toBe(0);
      if (outcome === 'exception') rejectSettlement(new Error('Synthetic settlement transport failure'));
      else resolveSettlement({ success: outcome === 'success', transaction: outcome === 'success' ? '0x' + 'a'.repeat(64) : '',
        network: TEST_NETWORK, ...(outcome === 'rejected' ? { errorReason: 'rejected' } : {}) });
      const result = await completed;
      if (outcome === 'success') {
        expect(result.status).toBe(200);
        expect(JSON.parse(result.body)).toMatchObject({ kind: 'paid-structure-report' });
        expect(JSON.parse(result.body).declarations.functions).toHaveLength(4);
      } else {
        expect(result.status).toBeGreaterThanOrEqual(400);
        expect(result.body).not.toContain('declarations');
        expect(result.body).not.toContain('paid-structure-report');
        expect(result.body).not.toContain('transferOwnership');
      }
    } finally {
      resolveSettlement({ success: false, errorReason: 'test_cleanup', transaction: '', network: TEST_NETWORK });
      client.destroy();
      await completed.catch(() => {});
    }
  });
});
