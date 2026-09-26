import { describe, expect, it, vi } from 'vitest';
import { TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';
import { createGuardedSigner, type SigningRequest } from './guarded-signer.ts';
const payTo = `0x${'1'.repeat(40)}`;
const request = (): SigningRequest => ({ requestId: 'offline-1', intent: 'Tokyo weather',
  terms: { scheme: 'exact', network: TEST_NETWORK, asset: TEST_USDC, amount: '1000', payTo } });
// SYNTHETIC TEST FIXTURE modelling verified adapter output. NO live scan occurred.
// The live source tag here models the adapter contract, never a real risk result.
const syntheticEvidence = (r: SigningRequest) => ({ request: structuredClone(r), authorization: 'approved',
  risk: { decision: 'allow', source: 'live', provider: 'intercepta', address: payTo,
    checkedAt: new Date().toISOString(), reasons: ['Synthetic fixture; not a real scan'] } });
function setup(check: (r: SigningRequest) => Promise<unknown> = async r => syntheticEvidence(r)) {
  const fakeSign = vi.fn(async (_r: SigningRequest): Promise<unknown> => 'FAKE-NOT-A-SIGNATURE');
  return { fakeSign, guard: createGuardedSigner({ authorizedPayTo: payTo, check, sign: fakeSign }) };
}
describe('offline guarded signer, fake signer and synthetic evidence ONLY', () => {
  it('shares concurrent and repeated results with one signer invocation', async () => {
    const { guard, fakeSign } = setup(); const first = guard.sign(request());
    expect(guard.sign(request())).toBe(first);
    expect(await first).toEqual({ status: 'signed', signature: 'FAKE-NOT-A-SIGNATURE' });
    expect(guard.sign(request())).toBe(first); expect(fakeSign).toHaveBeenCalledTimes(1);
  });
  it.each(['requestId', 'intent', 'scheme', 'network', 'asset', 'amount', 'payTo'])('binds checked %s exactly', async field => {
    const { guard, fakeSign } = setup(async r => {
      const e = syntheticEvidence(r);
      if (field === 'intent' || field === 'requestId') e.request = { ...r, [field]: 'different' };
      else (e.request.terms as unknown as Record<string, string>)[field] = field === 'amount' ? '999' : 'different';
      return e;
    });
    expect((await guard.sign(request())).status).toBe('held'); expect(fakeSign).not.toHaveBeenCalled();
  });
  it.each(['intent', 'network', 'asset', 'amount', 'payTo'])('conflicts on identity reuse changing %s', async field => {
    const { guard, fakeSign } = setup(); const first = guard.sign(request());
    const other = structuredClone(request());
    if (field === 'intent') (other as { intent: string }).intent = 'different';
    else (other.terms as unknown as Record<string, string>)[field] = 'different';
    expect((await guard.sign(other)).status).toBe('conflict'); await first;
    expect(fakeSign).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, null, {}, { authorization: 'approved' }, 'allow'])('refuses malformed evidence %j', async value => {
    const { guard, fakeSign } = setup(async () => value);
    expect((await guard.sign(request())).status).toBe('held'); expect(fakeSign).not.toHaveBeenCalled();
  });
  it.each([
    ['source', 'fixture'], ['source', 'unavailable'], ['source', 'unknown'], ['decision', 'deny'],
    ['decision', 'hold'], ['decision', undefined], ['provider', 'test'], ['address', `0x${'2'.repeat(40)}`],
    ['checkedAt', 'invalid'], ['checkedAt', '2000-01-01'], ['checkedAt', '2999-01-01'], ['reasons', []], ['reasons', [1]],
  ])('refuses risk %s=%j', async (field, value) => {
    const { guard, fakeSign } = setup(async r => {
      const e = syntheticEvidence(r); (e.risk as Record<string, unknown>)[field] = value; return e;
    });
    expect((await guard.sign(request())).status).toBe('held'); expect(fakeSign).not.toHaveBeenCalled();
  });
  it('refuses missing authorization and checker failure', async () => {
    for (const check of [async (r: SigningRequest) => ({ ...syntheticEvidence(r), authorization: undefined }),
      async () => { throw new Error('timeout'); }]) {
      const { guard, fakeSign } = setup(check);
      expect((await guard.sign(request())).status).toBe('held'); expect(fakeSign).not.toHaveBeenCalled();
    }
  });
  it.each([undefined, null, {}, { ...request(), terms: null }, { ...request(), allow: true },
    { ...request(), terms: { ...request().terms, extra: {} } },
    ...['amount', 'network', 'asset', 'payTo', 'scheme'].map(field => ({ ...request(), terms: { ...request().terms, [field]: undefined } })),
    ...['0', '-1', '1.0', '1e3', '1001', '9'.repeat(79)].map(amount => ({ ...request(), terms: { ...request().terms, amount } })),
  ])('holds malformed or disallowed runtime request %#', async value => {
    const { guard, fakeSign } = setup();
    expect((await guard.sign(value)).status).toBe('held'); expect(fakeSign).not.toHaveBeenCalled();
  });
  it('checks configured recipient before calling the trusted checker', async () => {
    for (const authorizedPayTo of [undefined, 'bad', `0x${'2'.repeat(40)}`]) {
      const check = vi.fn(); const sign = vi.fn();
      const guard = createGuardedSigner({ authorizedPayTo, check, sign });
      expect((await guard.sign(request())).status).toBe('held'); expect(check).not.toHaveBeenCalled(); expect(sign).not.toHaveBeenCalled();
    }
  });
  it.each(['throw', 'empty', 'unknown'])('never retries signer outcome %s', async outcome => {
    const sign = vi.fn(async () => { if (outcome === 'throw') throw new Error('unknown'); return outcome === 'empty' ? '' : undefined; });
    const guard = createGuardedSigner({ authorizedPayTo: payTo, check: async r => syntheticEvidence(r), sign });
    const result = guard.sign(request()); expect((await result).status).toBe('signing_unknown');
    expect(guard.sign(request())).toBe(result); expect(sign).toHaveBeenCalledTimes(1);
  });
  it('snapshots caller inputs and freezes callback inputs across async checks', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const { guard, fakeSign } = setup(async r => {
      expect(Object.isFrozen(r)).toBe(true); expect(Object.isFrozen(r.terms)).toBe(true);
      await gate; return syntheticEvidence(r);
    });
    const input = structuredClone(request()); const result = guard.sign(input);
    (input.terms as { amount: string }).amount = '999'; release(); await result;
    expect(fakeSign.mock.calls[0]?.[0].terms.amount).toBe('1000'); expect(Object.isFrozen(await result)).toBe(true);
  });
  it('fails closed at capacity without evicting previous identities', async () => {
    const { guard, fakeSign } = setup(); const first = guard.sign(request()); await first;
    for (let i = 1; i < 1000; i++) await guard.sign({ ...request(), requestId: `offline-${i + 1}` });
    expect((await guard.sign({ ...request(), requestId: 'overflow' })).status).toBe('held');
    expect(guard.sign(request())).toBe(first); expect(fakeSign).toHaveBeenCalledTimes(1000);
  });
});
