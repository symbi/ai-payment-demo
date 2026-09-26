import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_WEIGHTS } from '../../../shared/demo-assessment.ts';
import { advanceRequest, createRequest, type DemoRequest, type DemoRequestInput } from '../../../shared/demo-requests.ts';
import { DemoRequestClient, fileTransport, httpTransport, STORAGE_KEY, type ClientState, type RequestTransport } from '../../../apps/web/src/demo-request-client.ts';

const input: DemoRequestInput = { fixtureId: 'controlled-a', amount: '0.001000', taskLimit: '0.005000', weights: [...DEFAULT_WEIGHTS], contentChanged: false, scenario: 'normal' };
function memory(raw: string | null = null) { return { getItem: (_key: string) => raw, setItem: (_key: string, value: string) => { raw = value; } }; }
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function harness(scenario = input.scenario) {
  let now = 0, counter = 0;
  const storage = memory(); const states: ClientState[] = [];
  const original = fileTransport(() => now);
  const transport = { ...original, post: vi.fn(original.post), get: vi.fn(original.get) };
  const client = new DemoRequestClient({ mode: 'file', storage, transport, now: () => now, id: () => `test-${++counter}`,
    wait: async ms => { now += ms; }, onChange: state => states.push(state) });
  return { client, transport, storage, states, input: { ...input, scenario }, now: () => now };
}

describe('client concurrency and recovery with no network or real wait', () => {
  it('reserves synchronously, blocks the same-loop double click, and visibly progresses checking to result', async () => {
    const h = harness();
    const first = h.client.submit(input); const duplicate = h.client.submit(input);
    expect(h.transport.post).toHaveBeenCalledTimes(1);
    expect(h.client.snapshot().record?.status).toBe('checking');
    await Promise.all([first, duplicate]);
    expect(h.states[0]).toMatchObject({ busy: true, record: { status: 'checking', result: null } });
    expect(h.client.snapshot().record).toMatchObject({ status: 'completed', assessmentRuns: 1, result: { decision: 'allow' } });
    await h.client.submit(input);
    expect(h.transport.post).toHaveBeenCalledTimes(1);
    expect(h.transport.get).toHaveBeenCalledTimes(1);
  });
  it('uses a deterministic bounded delay', async () => {
    const h = harness('delayed'); await h.client.submit(h.input);
    expect(h.now()).toBe(1000); expect(h.client.snapshot().record?.status).toBe('completed');
  });
  it('keeps unresolved locked across input changes and manual queries, until explicit end', async () => {
    const h = harness('unresolved'); await h.client.submit(h.input);
    h.client.invalidate(); await h.client.submit(input); await h.client.query();
    expect(h.transport.post).toHaveBeenCalledTimes(1);
    expect(h.client.snapshot()).toMatchObject({ invalidated: true, record: { status: 'unresolved', result: null } });
    h.client.end(); await h.client.submit(input);
    expect(h.transport.post).toHaveBeenCalledTimes(2);
    expect(h.client.snapshot().record?.id).toBe('test-2');
  });
  it('invalidates a completed decision immediately and preserves that invalidation on refresh', async () => {
    const h = harness(); await h.client.submit(input); h.client.invalidate();
    expect(h.client.snapshot().invalidated).toBe(true);
    const resumed = new DemoRequestClient({ mode: 'file', storage: h.storage, transport: fileTransport(h.now), now: h.now });
    await resumed.recover(); expect(resumed.snapshot().invalidated).toBe(true);
  });
  it('a late response after input changes cannot restore an old decision', async () => {
    const pending = deferred<DemoRequest>();
    const client = new DemoRequestClient({ mode: 'http', storage: memory(), id: () => 'late', now: () => 0,
      transport: { post: () => pending.promise, get: async () => null } });
    const work = client.submit(input); client.invalidate();
    pending.resolve(advanceRequest(createRequest('late', input, 0), 300)); await work;
    expect(client.snapshot()).toMatchObject({ invalidated: true, record: { status: 'completed' } });
  });
  it('an old post finishing after end cannot replace the new request or its busy state', async () => {
    const pending = deferred<DemoRequest>(); let calls = 0;
    const transport: RequestTransport = { post: async (id, value) => ++calls === 1 ? pending.promise : advanceRequest(createRequest(id, value, 0), 300), get: async () => null };
    let id = 0;
    const client = new DemoRequestClient({ mode: 'http', storage: memory(), transport, id: () => `generation-${++id}`, now: () => 0 });
    const old = client.submit(input); client.end(); await client.submit({ ...input, amount: '0.002000' });
    pending.resolve(advanceRequest(createRequest('generation-1', input, 0), 300)); await old;
    expect(client.snapshot()).toMatchObject({ busy: false, record: { id: 'generation-2', input: { amount: '0.002000' } } });
  });
  it('late manual query responses cannot restore an invalidated decision', async () => {
    const h = harness(); await h.client.submit(input);
    const pending = deferred<DemoRequest>(); h.transport.get.mockImplementationOnce(() => pending.promise);
    const query = h.client.query(); h.client.invalidate(); pending.resolve(h.client.snapshot().record!); await query;
    expect(h.client.snapshot().invalidated).toBe(true);
  });
  it('restores a file record using the shared rules and never resubmits it', async () => {
    const h = harness(); await h.client.submit(input);
    const transport = fileTransport(h.now); const post = vi.fn(transport.post);
    const resumed = new DemoRequestClient({ mode: 'file', storage: h.storage, transport: { ...transport, post } });
    expect(await resumed.recover()).toEqual(input);
    expect(resumed.snapshot().record).toEqual(h.client.snapshot().record);
    expect(post).not.toHaveBeenCalled();
  });
  it('recovers a checking file request and an unresolved file request without new POST', async () => {
    for (const scenario of ['delayed', 'unresolved'] as const) {
      const record = createRequest('saved', { ...input, scenario }, 0);
      const storage = memory(JSON.stringify({ version: 1, mode: 'file', record, invalidated: false, recoveryBlocked: false }));
      const resumed = new DemoRequestClient({ mode: 'file', storage, transport: fileTransport(() => 1000) });
      await resumed.recover();
      expect(resumed.snapshot().record?.status).toBe(scenario === 'delayed' ? 'completed' : 'unresolved');
    }
  });
  it('queries HTTP after refresh; server restart remains unresolved, with no POST or cached allow', async () => {
    const cached = advanceRequest(createRequest('saved', input, 0), 300);
    const storage = memory(JSON.stringify({ version: 1, mode: 'http', record: cached, invalidated: false, recoveryBlocked: false }));
    const states: ClientState[] = []; const post = vi.fn(); const get = vi.fn(async () => null);
    const client = new DemoRequestClient({ mode: 'http', storage, transport: { post, get }, onChange: s => states.push(s) });
    await client.recover(); await client.submit(input);
    expect(get).toHaveBeenCalledWith('saved'); expect(post).not.toHaveBeenCalled();
    expect(states.every(s => s.record?.result === null)).toBe(true);
    expect(client.snapshot().record?.status).toBe('unresolved');
    // A second refresh also keeps the uncertainty; it does not POST a missing id.
    const second = new DemoRequestClient({ mode: 'http', storage, transport: { post, get } });
    await second.recover(); expect(second.blocked).toBe(true); expect(post).not.toHaveBeenCalled();
  });
  it.each(['{bad', 'null', '{}', JSON.stringify({ version: 1, mode: 'other', record: null, invalidated: false, recoveryBlocked: false })])('blocks malformed or other-mode storage until explicit end: %s', async raw => {
    const h = harness(); const client = new DemoRequestClient({ mode: 'file', storage: memory(raw), transport: h.transport });
    await client.recover(); await client.submit(input);
    expect(client.snapshot().recoveryBlocked).toBe(true); expect(h.transport.post).not.toHaveBeenCalled();
    client.end(); expect(client.blocked).toBe(false);
  });
  it('handles inaccessible storage and only writes its own namespaced key', async () => {
    const storage = { getItem: () => { throw new Error('denied'); }, setItem: vi.fn(() => { throw new Error('denied'); }) };
    const h = harness(); const client = new DemoRequestClient({ mode: 'file', storage, transport: h.transport, id: () => 'storage', now: () => 0, wait: async () => {} });
    await client.recover(); expect(client.blocked).toBe(true); client.end(); await client.submit(input);
    expect(client.snapshot().storageWarning).toContain('不可用');
    expect(storage.setItem.mock.calls.every(call => (call as unknown[])[0] === STORAGE_KEY)).toBe(true);
  });
  it('rejects forged allow records, transport errors, and mismatched response ids without retries', async () => {
    for (const outcome of ['error', 'forged', 'mismatch']) {
      const post = vi.fn(async () => {
        if (outcome === 'error') throw new Error('lost');
        const good = advanceRequest(createRequest(outcome === 'mismatch' ? 'wrong' : 'failure', input, 0), 300);
        return outcome === 'forged' ? { ...good, execution: { ...good.execution, paid: true } } as unknown as DemoRequest : good;
      });
      const get = vi.fn(); const client = new DemoRequestClient({ mode: 'http', storage: memory(), transport: { post, get }, id: () => 'failure', now: () => 0 });
      await client.submit(input); await client.submit(input);
      expect(client.snapshot().record).toMatchObject({ status: 'unresolved', result: null });
      expect(post).toHaveBeenCalledTimes(1); expect(get).not.toHaveBeenCalled();
    }
  });
  it('HTTP transport aborts after ten seconds and never retries (injected fetch and fake clock)', async () => {
    vi.useFakeTimers();
    try {
      const fakeFetch = vi.fn((_path, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('timeout')));
      })) as unknown as typeof fetch;
      const transport = httpTransport(fakeFetch);
      const work = transport.post('timeout', input);
      const assertion = expect(work).rejects.toThrow('timeout');
      await vi.advanceTimersByTimeAsync(10000); await assertion;
      expect(fakeFetch).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});

it('HTTP refresh recovers a verified current result through GET only', async () => {
  const saved = createRequest('recover-http', input, 0);
  const completed = advanceRequest(saved, 300);
  const storage = memory(JSON.stringify({ version: 1, mode: 'http', record: saved, invalidated: false, recoveryBlocked: false }));
  const post = vi.fn(); const get = vi.fn(async () => completed);
  const client = new DemoRequestClient({ mode: 'http', storage, transport: { post, get } });
  await client.recover();
  expect(client.snapshot().record).toEqual(completed);
  expect(get).toHaveBeenCalledTimes(1); expect(post).not.toHaveBeenCalled();
});

it('file refresh before the delayed deadline remains checking until an explicit query', async () => {
  const saved = createRequest('early-refresh', { ...input, scenario: 'delayed' }, 0);
  const storage = memory(JSON.stringify({ version: 1, mode: 'file', record: saved, invalidated: false, recoveryBlocked: false }));
  let now = 500;
  const local = fileTransport(() => now); const post = vi.fn(local.post);
  const client = new DemoRequestClient({ mode: 'file', storage, transport: { ...local, post } });
  await client.recover(); expect(client.snapshot().record?.status).toBe('checking');
  now = 1000; await client.query(); expect(client.snapshot().record?.status).toBe('completed');
  expect(post).not.toHaveBeenCalled();
});

it('a stale query after explicit end cannot reattach the prior request', async () => {
  const h = harness(); await h.client.submit(input);
  const pending = deferred<DemoRequest>(); const original = h.client.snapshot().record!;
  h.transport.get.mockImplementationOnce(() => pending.promise);
  const query = h.client.query(); h.client.end(); pending.resolve(original); await query;
  expect(h.client.snapshot()).toMatchObject({ record: null, busy: false });
});

it('rejects an unsafe unresolved persisted envelope without treating it as a safe identity', async () => {
  const unsafe = { ...createRequest('unsafe', input, 0), status: 'unresolved', execution: { signed: true, submitted: false, paid: false, reportPurchased: false } };
  const storage = memory(JSON.stringify({ version: 1, mode: 'http', record: unsafe, invalidated: false, recoveryBlocked: false }));
  const get = vi.fn(); const post = vi.fn();
  const client = new DemoRequestClient({ mode: 'http', storage, transport: { get, post } });
  await client.recover(); expect(client.snapshot().recoveryBlocked).toBe(true);
  expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});
