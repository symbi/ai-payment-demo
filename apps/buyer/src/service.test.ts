import { expect, it, vi } from 'vitest';
import { TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';
import { BuyerService } from './service.ts';
import { SellerClient } from './seller.ts';
import { createInterceptaScanner } from './intercepta.ts';

// Test-only seller transport. No production route can select these responses.
const payTo = '0x1111111111111111111111111111111111111111';
function response(amount = '1000') {
  return new Response(null, { status: 402, headers: { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{ scheme: 'exact', network: TEST_NETWORK, asset: TEST_USDC, amount, payTo, maxTimeoutSeconds: 300 }] })).toString('base64') } });
}
function setup(fetcher = vi.fn<typeof fetch>(async () => response())) {
  return { fetcher, service: new BuyerService({ sellerUrl: 'http://127.0.0.1:4032', payTo, riskKeyConfigured: false, paymentRequested: false }, new SellerClient('http://127.0.0.1:4032', fetcher)) };
}
it('reads 402, holds without real scan, keeps counters zero and never sends payment credentials', async () => {
  const { service, fetcher } = setup();
  const result = await service.inspect('request-0001', '东京天气');
  expect(result).toMatchObject({ status: 'held', terms: { amount: '1000' }, risk: { address: payTo, source: 'unavailable' }, counters: { sign: 0, settle: 0 } });
  expect(result.events.map(e => e.step)).toContain('quote');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:4032/api/contract-insights');
  expect(fetcher.mock.calls[0][1]?.headers).toEqual({ Accept: 'application/json' });
  expect((await service.pay('request-0001')).status).toBe('held');
  await service.pay('request-0001'); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('reserves duplicate identity before async work and rejects changed intent', async () => {
  const { service, fetcher } = setup();
  await Promise.all([service.inspect('request-0002', '天气'), service.inspect('request-0002', '天气')]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(service.inspect('request-0002', '另一个意图')).rejects.toMatchObject({ status: 409 });
});
it('holds if live quote changes and does not silently retry', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response()).mockResolvedValueOnce(response('999'));
  const { service } = setup(fetcher);
  await service.inspect('request-0003', '天气');
  const result = await service.pay('request-0003');
  expect(result.status).toBe('held'); expect(result.reasons.join()).toContain('已变化');
  expect(result.counters).toEqual({ sign: 0, settle: 0 });
  await service.pay('request-0003'); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('denies excess budget before scanning and does not retry payment', async () => {
  const { service, fetcher } = setup(vi.fn<typeof fetch>(async () => response('1001')));
  expect((await service.inspect('request-0004', '天气')).status).toBe('denied');
  await service.pay('request-0004'); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('holds malformed responses and sanitizes transport errors', async () => {
  for (const fetcher of [vi.fn<typeof fetch>(async () => new Response(null, { status: 402 })), vi.fn<typeof fetch>(async () => { throw new Error('secret-token'); })]) {
    const { service } = setup(fetcher);
    const result = await service.inspect('request-0005', '天气');
    expect(result.status).toBe('held'); expect(JSON.stringify(result)).not.toContain('secret-token');
  }
});
it('requires server-held identity and isolates returned snapshots', async () => {
  const { service } = setup();
  await expect(service.pay('request-missing')).rejects.toMatchObject({ status: 404 });
  const result = await service.inspect('request-0006', '天气'); result.status = 'paid';
  expect(service.get('request-0006').status).toBe('held');
});
it('scans only once on explicit Check, with actual quote identity; not on health/inspect/GET', async () => {
  const provider = vi.fn<typeof fetch>(async () => Response.json({ toxicScore: 0, traits: [] }));
  const seller = new SellerClient('http://127.0.0.1:4032', vi.fn<typeof fetch>(async () => response()));
  const service = new BuyerService({ sellerUrl: 'http://127.0.0.1:4032', payTo, riskKeyConfigured: true, paymentRequested: true }, seller, createInterceptaScanner('FAKE-TEST-KEY', provider));
  await service.health(); await service.inspect('request-scan1', 'weather'); service.get('request-scan1');
  expect(provider).not.toHaveBeenCalled();
  const results = await Promise.all([service.pay('request-scan1'), service.pay('request-scan1')]);
  await service.pay('request-scan1'); service.get('request-scan1'); await service.health();
  expect(provider).toHaveBeenCalledTimes(1);
  expect(provider.mock.calls[0][0]).toContain(`/${payTo}/quick-scan`);
  for (const result of results) expect(result).toMatchObject({ status: 'held', decision: 'hold', paymentEnabled: false, risk: { source: 'live', decision: 'hold', address: payTo, scan: { toxicScore: 0, traitsCount: 0 } }, counters: { sign: 0, settle: 0 } });
  expect(JSON.stringify(results)).not.toContain('FAKE-TEST-KEY');
});
it('does not scan changed quotes or retry a failed provider', async () => {
  for (const changed of [true, false]) {
    let count = 0; const provider = vi.fn<typeof fetch>(async () => { throw new Error('SECRET'); });
    const seller = new SellerClient('http://127.0.0.1:4032', vi.fn<typeof fetch>(async () => response(++count > 1 && changed ? '999' : '1000')));
    const service = new BuyerService({ sellerUrl: 'http://127.0.0.1:4032', payTo, riskKeyConfigured: true, paymentRequested: false }, seller, createInterceptaScanner('FAKE', provider));
    await service.inspect('request-scan2', 'weather'); const result = await service.pay('request-scan2'); await service.pay('request-scan2');
    expect(provider).toHaveBeenCalledTimes(changed ? 0 : 1); expect(result.status).toBe('held'); expect(JSON.stringify(result)).not.toContain('SECRET');
  }
});
