import { describe, expect, it, vi } from 'vitest';
import { BUYER_REQUEST_SESSION_KEY, readBuyerRequestSession, saveBuyerRequestSession, type BuyerRequestSession } from './buyer-request-session.ts';

const session = (checkAttempted = false, requestId = 'request_123-456'): BuyerRequestSession => ({ version: 1, requestId, checkAttempted });
function storage(raw: string | null = null) {
  let value = raw;
  return {
    getItem: vi.fn((_key: string) => value),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
  };
}
const fail = (): never => { throw new Error('Storage unavailable'); };

describe('bounded buyer request identity', () => {
  it('distinguishes genuinely empty storage from unreadable storage', () => {
    const empty = storage();
    expect(readBuyerRequestSession(empty)).toEqual({ state: 'empty' });
    expect(empty.getItem).toHaveBeenCalledWith(BUYER_REQUEST_SESSION_KEY);
    expect(readBuyerRequestSession({ getItem: fail })).toEqual({ state: 'unavailable' });
    expect(readBuyerRequestSession({ get getItem(): Storage['getItem'] { return fail(); } })).toEqual({ state: 'unavailable' });
  });

  it.each([false, true])('round trips checkAttempted=%s with only the exact identity fields', attempted => {
    const target = storage();
    const identity = session(attempted);
    expect(saveBuyerRequestSession(target, identity)).toBe(true);
    expect(target.setItem).toHaveBeenCalledExactlyOnceWith('buyer-request-session-v1', JSON.stringify(identity));
    expect(readBuyerRequestSession(target)).toEqual({ state: 'saved', session: identity });
  });

  it.each(['a'.repeat(8), 'Z'.repeat(80), 'ab_CD-09'])('accepts bounded ASCII request ID %s', requestId => {
    expect(readBuyerRequestSession(storage(JSON.stringify(session(false, requestId))))).toEqual({ state: 'saved', session: session(false, requestId) });
  });

  it.each(['', 'a'.repeat(7), 'a'.repeat(81), 'request/id', 'request.id', 'request id', 'request_123\n', 'request_123\r', '请求_request', 'request_😀'])('rejects invalid request ID %j without writing', requestId => {
    const identity = session(false, requestId);
    const target = storage();
    expect(readBuyerRequestSession(storage(JSON.stringify(identity)))).toEqual({ state: 'unavailable' });
    expect(saveBuyerRequestSession(target, identity)).toBe(false);
    expect(target.setItem).not.toHaveBeenCalled();
  });

  it.each([
    '', '{', 'null', '[]', 'true', '{}',
    JSON.stringify({ ...session(), version: 2 }),
    JSON.stringify({ version: 1, requestId: 'request_123' }),
    JSON.stringify({ ...session(), requestId: 12345678 }),
    JSON.stringify({ ...session(), checkAttempted: 'false' }),
    JSON.stringify({ ...session(), checkAttempted: null }),
    ...['grant', 'risk', 'quote', 'payment', 'secret'].map(key => JSON.stringify({ ...session(), [key]: {} })),
  ])('treats malformed or extended JSON as unavailable: %s', raw => {
    const target = storage(raw);
    expect(readBuyerRequestSession(target)).toEqual({ state: 'unavailable' });
    expect(saveBuyerRequestSession(target, session())).toBe(false);
    expect(target.setItem).not.toHaveBeenCalled();
    expect(target.getItem(BUYER_REQUEST_SESSION_KEY)).toBe(raw);
  });

  it('enforces the 512-byte stored input boundary without clearing it', () => {
    const raw = JSON.stringify(session());
    expect(readBuyerRequestSession(storage(raw.padEnd(512, ' '))).state).toBe('saved');
    const oversized = storage(raw.padEnd(513, ' '));
    expect(readBuyerRequestSession(oversized)).toEqual({ state: 'unavailable' });
    expect(saveBuyerRequestSession(oversized, session())).toBe(false);
    expect(oversized.setItem).not.toHaveBeenCalled();
  });

  it('rejects extra fields on save instead of persisting response facts', () => {
    const target = storage();
    expect(saveBuyerRequestSession(target, { ...session(), risk: { decision: 'allow' } } as BuyerRequestSession)).toBe(false);
    expect(target.setItem).not.toHaveBeenCalled();
  });

  it('cannot downgrade an attempted check for the same request', () => {
    const target = storage(JSON.stringify(session(true)));
    expect(saveBuyerRequestSession(target, session(false))).toBe(false);
    expect(target.setItem).not.toHaveBeenCalled();
    expect(readBuyerRequestSession(target)).toEqual({ state: 'saved', session: session(true) });
    expect(saveBuyerRequestSession(target, session(true))).toBe(true);
  });

  it('allows the caller to save an explicit new identity after checking its prior confirmed request', () => {
    const target = storage(JSON.stringify(session(true)));
    const next = session(false, 'new_request_123');
    expect(saveBuyerRequestSession(target, next)).toBe(true);
    expect(readBuyerRequestSession(target)).toEqual({ state: 'saved', session: next });
  });

  it('fails closed when property access, reads or writes throw', () => {
    const host = { get localStorage(): Storage { return fail(); } };
    const adapter = { getItem: (key: string) => host.localStorage.getItem(key), setItem: (key: string, value: string) => host.localStorage.setItem(key, value) };
    expect(readBuyerRequestSession(adapter)).toEqual({ state: 'unavailable' });
    expect(saveBuyerRequestSession(adapter, session())).toBe(false);
    expect(saveBuyerRequestSession({ getItem: fail, setItem: vi.fn() }, session())).toBe(false);
    expect(saveBuyerRequestSession({ getItem: () => null, setItem: fail }, session())).toBe(false);
    expect(saveBuyerRequestSession({ getItem: () => null, get setItem(): Storage['setItem'] { return fail(); } }, session())).toBe(false);
  });

  it.each([null, '{', JSON.stringify(session(false)), JSON.stringify(session(true, 'different_request'))])('rejects unsuccessful write readback %s', readback => {
    const target = { getItem: vi.fn().mockReturnValueOnce(null).mockReturnValue(readback), setItem: vi.fn() };
    expect(saveBuyerRequestSession(target, session(true))).toBe(false);
    expect(target.setItem).toHaveBeenCalledTimes(1);
  });

  it('rejects a readback exception even when setItem returns normally', () => {
    const target = { getItem: vi.fn().mockReturnValueOnce(null).mockImplementation(fail), setItem: vi.fn() };
    expect(saveBuyerRequestSession(target, session())).toBe(false);
    expect(target.setItem).toHaveBeenCalledTimes(1);
  });
});
