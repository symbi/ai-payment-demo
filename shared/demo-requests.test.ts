import { describe, expect, it } from 'vitest';
import { assessDemoPayment, DEFAULT_WEIGHTS } from './demo-assessment.ts';
import { advanceRequest, canonicalInput, createRequest, DemoRequestStore, isDemoRequest, isDemoRequestInput, RequestError, type DemoRequestInput } from './demo-requests.ts';

const input: DemoRequestInput = { fixtureId: 'controlled-a', amount: '0.001000', taskLimit: '0.005000', weights: [...DEFAULT_WEIGHTS], contentChanged: false, scenario: 'normal' };

describe('pure simulation request state', () => {
  it('exposes checking before the bounded transition and all execution flags stay false', () => {
    const checking = createRequest('request-1', input, 100);
    expect(checking).toMatchObject({ status: 'checking', result: null, assessmentRuns: 0 });
    expect(advanceRequest(checking, 399)).toEqual(checking);
    const completed = advanceRequest(checking, 400);
    expect(completed).toMatchObject({ status: 'completed', assessmentRuns: 1, result: assessDemoPayment(input),
      execution: { signed: false, submitted: false, paid: false, reportPurchased: false } });
    expect(advanceRequest(completed, 99999)).toEqual(completed);
  });
  it('delays exactly one second using injected time', () => {
    const record = createRequest('delayed', { ...input, scenario: 'delayed' }, 0);
    expect(advanceRequest(record, 999).status).toBe('checking');
    expect(advanceRequest(record, 1000).status).toBe('completed');
  });
  it('unconfirmed stays unresolved without an allow result at any later time', () => {
    let record = createRequest('unknown', { ...input, scenario: 'unresolved' }, 0);
    record = advanceRequest(record, 1000);
    expect(record).toMatchObject({ status: 'unresolved', result: null, assessmentRuns: 0 });
    expect(advanceRequest(record, 1e12)).toEqual(record);
  });
  it('canonicalizes field order while binding every required field', () => {
    const reordered = { scenario: input.scenario, contentChanged: input.contentChanged, weights: input.weights,
      taskLimit: input.taskLimit, amount: input.amount, fixtureId: input.fixtureId };
    expect(canonicalInput(reordered)).toBe(canonicalInput(input));
    const changes = [{ fixtureId: 'controlled-b' }, { amount: '0.002000' }, { taskLimit: '0.006000' },
      { weights: [25, 40, 15, 10, 10] }, { contentChanged: true }, { scenario: 'delayed' }];
    for (const change of changes) expect(canonicalInput({ ...input, ...change } as DemoRequestInput)).not.toBe(canonicalInput(input));
  });
  it('deduplicates concurrent submissions and later replays without another evaluation', async () => {
    let now = 0;
    const store = new DemoRequestStore(() => now);
    const records = await Promise.all(Array.from({ length: 10 }, async () => store.post('same', input)));
    expect(records.every(r => r.status === 'checking')).toBe(true);
    now = 1000;
    expect(store.get('same')?.assessmentRuns).toBe(1);
    for (let i = 0; i < 10; i++) expect(store.post('same', input).assessmentRuns).toBe(1);
  });
  it.each([
    { fixtureId: 'controlled-b' }, { amount: '0.002000' }, { taskLimit: '0.006000' },
    { weights: [25, 40, 15, 10, 10] }, { contentChanged: true }, { scenario: 'unresolved' },
  ])('rejects same-id content conflicts: %j', change => {
    const store = new DemoRequestStore(() => 0);
    store.post('same', input);
    expect(() => store.post('same', { ...input, ...change } as DemoRequestInput)).toThrow(/不同内容/);
    expect(store.get('same')?.input).toEqual(input);
  });
  it('does not evict pending or completed ids when capacity fills or time passes', () => {
    let now = 0;
    const store = new DemoRequestStore(() => now, 2);
    store.post('pending', { ...input, scenario: 'unresolved' }); store.post('done', input);
    now = 1e12;
    expect(() => store.post('new', input)).toThrow(RequestError);
    expect(store.get('pending')?.status).toBe('unresolved');
    expect(store.post('done', input).assessmentRuns).toBe(1);
    expect(() => store.post('pending', input)).toThrow(/不同内容/);
  });
  it('copies returned records so callers cannot alter deduplication or results', () => {
    const store = new DemoRequestStore(() => 0);
    const record = store.post('owned', input); record.input.weights[0] = 99; record.status = 'completed';
    expect(store.get('owned')).toMatchObject({ status: 'checking', input: { weights: DEFAULT_WEIGHTS } });
  });
  it('restores a validated original record and never fabricates a missing server record', () => {
    const record = advanceRequest(createRequest('saved', input, 0), 300);
    const store = new DemoRequestStore(() => 2000);
    store.restore(record);
    expect(store.post('saved', input)).toEqual(record);
    expect(new DemoRequestStore().get('saved')).toBeNull();
  });
  it('rejects malformed inputs and forged stored results', () => {
    expect(isDemoRequestInput({ ...input, address: 'invented' })).toBe(false);
    expect(isDemoRequestInput({ ...input, weights: [40, 25, 15, 10, 9] })).toBe(false);
    expect(isDemoRequestInput({ ...input, scenario: 'live' })).toBe(false);
    const record = advanceRequest(createRequest('valid', input, 0), 300);
    expect(isDemoRequest(record)).toBe(true);
    expect(isDemoRequest({ ...record, execution: { ...record.execution, paid: true } })).toBe(false);
    expect(isDemoRequest({ ...record, status: 'unresolved' })).toBe(false);
    expect(isDemoRequest({ ...record, result: { ...record.result, score: 99 } })).toBe(false);
    expect(isDemoRequest({ ...record, result: { ...record.result, contributions: record.result!.contributions.slice(0, 4) } })).toBe(false);
  });
});
