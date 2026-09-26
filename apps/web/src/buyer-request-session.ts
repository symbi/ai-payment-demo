export const BUYER_REQUEST_SESSION_KEY = 'buyer-request-session-v1';

export interface BuyerRequestSession {
  version: 1;
  requestId: string;
  checkAttempted: boolean;
}

type SessionRead = { state: 'empty' } | { state: 'saved'; session: BuyerRequestSession } | { state: 'unavailable' };

function isSession(value: unknown): value is BuyerRequestSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(candidate);
  return keys.length === 3 && ['version', 'requestId', 'checkAttempted'].every(key => keys.includes(key))
    && candidate.version === 1 && typeof candidate.requestId === 'string'
    && candidate.requestId.length >= 8 && candidate.requestId.length <= 80
    && !/[^A-Za-z0-9_-]/.test(candidate.requestId) && typeof candidate.checkAttempted === 'boolean';
}

export function readBuyerRequestSession(storage: Pick<Storage, 'getItem'>): SessionRead {
  try {
    const raw = storage.getItem(BUYER_REQUEST_SESSION_KEY);
    if (raw === null) return { state: 'empty' };
    if (typeof raw !== 'string' || raw.length > 512 || new TextEncoder().encode(raw).byteLength > 512) return { state: 'unavailable' };
    const value: unknown = JSON.parse(raw);
    return isSession(value) ? { state: 'saved', session: value } : { state: 'unavailable' };
  } catch { return { state: 'unavailable' }; }
}

export function saveBuyerRequestSession(storage: Pick<Storage, 'getItem' | 'setItem'>, session: BuyerRequestSession): boolean {
  try {
    if (!isSession(session)) return false;
    // Copy only identity, never response/permission/risk/payment facts or toJSON hooks.
    const saved: BuyerRequestSession = { version: 1, requestId: session.requestId, checkAttempted: session.checkAttempted };
    const before = readBuyerRequestSession(storage);
    if (before.state === 'unavailable') return false;
    if (before.state === 'saved' && before.session.requestId === saved.requestId && before.session.checkAttempted && !saved.checkAttempted) return false;
    // The caller checks the prior identity before an explicit new request. This is not a cross-tab lock.
    storage.setItem(BUYER_REQUEST_SESSION_KEY, JSON.stringify(saved));
    const after = readBuyerRequestSession(storage);
    return after.state === 'saved' && after.session.requestId === saved.requestId && after.session.checkAttempted === saved.checkAttempted;
  } catch { return false; }
}
