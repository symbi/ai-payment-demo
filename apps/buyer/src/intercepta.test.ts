import { expect, it, vi } from 'vitest';
import { createInterceptaScanner, parseQuickScan } from './intercepta.ts';
const address = '0x1111111111111111111111111111111111111111';
const network = 'eip155:84532';
// Offline fixtures only. These are not live provider results.
it('sends one fixed-host authenticated address request and keeps zero score held', async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({ toxicScore: 0, traits: [] }));
  const scan = createInterceptaScanner('FAKE-TEST-KEY', transport);
  expect(transport).not.toHaveBeenCalled();
  const result = await scan(address, network);
  expect(result).toMatchObject({ address, source: 'live', decision: 'hold', scan: { transport: 'received', toxicScore: 0, traitsCount: 0, requestedNetwork: network, coverage: 'unverified', semantics: 'unverified' } });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0][0]).toBe(`https://api.web3antivirus.io/api/public/v2/extension/account/${address}/quick-scan`);
  expect(transport.mock.calls[0][1]).toMatchObject({ redirect: 'error', credentials: 'omit', headers: { 'X-API-KEY': 'FAKE-TEST-KEY' } });
  expect(JSON.stringify(result)).not.toContain('FAKE-TEST-KEY');
});
it.each([null, {}, { toxicScore: '0', traits: [] }, { toxicScore: NaN, traits: [] }, { toxicScore: Infinity, traits: [] }, { toxicScore: 0, traits: ['unknown'] }, { toxicScore: 0, traits: [{}] }, { toxicScore: 0, traits: {} }, { toxicScore: 0, traits: [], allow: true }])('rejects unobserved schema %#', payload => { expect(parseQuickScan(payload)).toBeUndefined(); });
it('records finite score as a fact without inventing a safe threshold', async () => {
  const result = await createInterceptaScanner('FAKE', async () => Response.json({ toxicScore: -123.5, traits: [] }))(address, network);
  expect(result.decision).toBe('hold'); expect(result.scan?.toxicScore).toBe(-123.5);
});
it('carries parsed nonempty provider traits as facts while holding network and meaning', async () => {
  const trait = { risk: 81.5, name: 'known_scammer', txsCount: 3, description: 'Observed provider description' };
  const result = await createInterceptaScanner('FAKE', async () => Response.json({ toxicScore: 0, traits: [trait] }))(address, network);
  expect(result).toMatchObject({ source: 'live', decision: 'hold', observation: { kind: 'observed', toxicScore: 0, traits: [{ ...trait, description: '' }] },
    scan: { transport: 'received', traitsCount: 1, traitLabels: ['known_scammer'], requestedNetwork: network, coverage: 'unverified', semantics: 'unverified' } });
});
it('bounds displayed labels at 20, reports the full count, and rejects more than 100 traits', async () => {
  const trait = { risk: 1, name: 'rug_pull', txsCount: 1, description: 'Synthetic fixture' };
  const twentyFive = await createInterceptaScanner('FAKE', async () => Response.json({ toxicScore: 9, traits: Array.from({ length: 25 }, () => trait) }))(address, network);
  expect(twentyFive).toMatchObject({ decision: 'hold', scan: { traitsCount: 25 } });
  expect(twentyFive.scan?.traitLabels).toHaveLength(20);
  expect(twentyFive.reasons[0]).toContain('not the full trait list');
  const tooMany = await createInterceptaScanner('FAKE', async () => Response.json({ toxicScore: 9, traits: Array.from({ length: 101 }, () => trait) }))(address, network);
  expect(tooMany).toMatchObject({ source: 'unavailable', decision: 'hold', scan: { transport: 'received' } });
});
it.each([undefined, '', 'bad\nkey'])('does not call provider with unusable key %#', async key => {
  const transport = vi.fn(); expect((await createInterceptaScanner(key, transport)(address, network)).source).toBe('unavailable'); expect(transport).not.toHaveBeenCalled();
});
it('refuses injected URLs as addresses before sending credentials', async () => {
  const transport = vi.fn(); await createInterceptaScanner('FAKE', transport)('https://evil.invalid', network); expect(transport).not.toHaveBeenCalled();
});
it.each([302, 401, 429, 500])('does not retry or leak a status %i body', async status => {
  const transport = vi.fn<typeof fetch>(async () => new Response('secret-body', { status }));
  const result = await createInterceptaScanner('FAKE', transport)(address, network); expect(result.source).toBe('unavailable'); expect(transport).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).not.toContain('secret-body');
});
it.each([
  () => new Response('secret-body', { headers: { 'content-type': 'text/plain' } }),
  () => new Response('x'.repeat(17000), { headers: { 'content-type': 'application/json' } }),
  () => new Response('{', { headers: { 'content-type': 'application/json' } }),
  () => Response.json({ toxicScore: 0, traits: [{ private: 'secret-body' }] }),
])('fails closed for unsupported body %#', async response => {
  const result = await createInterceptaScanner('FAKE', async () => response())(address, network); expect(result).toMatchObject({ source: 'unavailable', decision: 'hold', scan: { transport: 'received' } }); expect(JSON.stringify(result)).not.toContain('secret-body');
});
it('bounds fetch that ignores cancellation', async () => {
  const transport = vi.fn<typeof fetch>(() => new Promise(() => {}));
  const result = await createInterceptaScanner('FAKE', transport, 10)(address, network); expect(result.decision).toBe('hold'); expect(result.reasons[0]).toContain('timed out'); expect(transport).toHaveBeenCalledTimes(1);
});
it('bounds a stalled streamed body', async () => {
  const result = await createInterceptaScanner('FAKE', async () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } }), 10)(address, network); expect(result.decision).toBe('hold'); expect(result.source).toBe('unavailable');
});

it('does not forward free text or echoed secrets even in the internal observation field', async () => {
  const key = 'FAKE-ECHOED-API-KEY';
  const payload = { toxicScore: 30, traits: [{ name:'known_scammer',risk:10,txsCount:1,description:`provider arbitrary text ${key}`,extra:'UNTRUSTED-EXTRA' }] };
  const risk = await createInterceptaScanner(key, async () => Response.json(payload))(address,network);
  expect(risk.decision).toBe('hold');
  expect(risk.scan?.traitLabels).toEqual(['known_scammer']);
  expect(risk.observation).toMatchObject({kind:'observed',traits:[{description:''}]});
  expect(JSON.stringify(risk)).not.toContain(key);
  expect(JSON.stringify(risk)).not.toContain('provider arbitrary text');
  expect(JSON.stringify(risk)).not.toContain('UNTRUSTED-EXTRA');
});
