import { describe, expect, it, vi } from 'vitest';
import { evaluatePolicyPreview, type PolicyPreviewInput } from '../../../shared/policy-preview.ts';
import type { PolicyPreviewViewState } from '../../../shared/policy-preview-view.ts';
import {
  filePolicyPreviewTransport,
  httpPolicyPreviewTransport,
  PolicyPreviewClient,
  type PolicyPreviewTransport,
} from './policy-preview-client.ts';

function preview(caseId = 'case-01', taskBudgetAtomic = '2000') {
  const result = evaluatePolicyPreview({ caseId, taskBudgetAtomic });
  if (!result) throw new Error('expected policy preview fixture');
  return result;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function clientWith(transport: PolicyPreviewTransport) {
  const changes: PolicyPreviewViewState[] = [];
  const client = new PolicyPreviewClient({ mode: 'http', transport, onChange: state => changes.push(structuredClone(state)) });
  return { client, changes };
}

describe('PolicyPreviewClient', () => {
  it('starts from case-01 and formats each selected fixture budget as USDC', () => {
    const { client } = clientWith({ assess: vi.fn() });
    expect(client.state).toMatchObject({ caseId: 'case-01', budgetText: '0.002000', phase: 'idle', result: null });
    client.setCaseId('case-05');
    expect(client.state).toMatchObject({ caseId: 'case-05', budgetText: '0.001000', phase: 'idle', result: null });
  });

  it.each(['', '0', '-1', '1e3', '0.000000', '0.0000001', `${'1'.repeat(73)}.0`])('rejects invalid budget %j without requesting', async budgetText => {
    const assess = vi.fn();
    const { client } = clientWith({ assess });
    client.setBudgetText(budgetText);
    await client.assess();
    expect(assess).not.toHaveBeenCalled();
    expect(client.state).toMatchObject({ phase: 'error', result: null });
  });

  it('rejects an unknown case without requesting', async () => {
    const assess = vi.fn();
    const { client } = clientWith({ assess });
    client.setCaseId('case-99');
    await client.assess();
    expect(assess).not.toHaveBeenCalled();
    expect(client.state).toMatchObject({ caseId: 'case-99', phase: 'error', result: null });
  });

  it('reserves one pending request synchronously and blocks a double click', async () => {
    const pending = deferred<unknown>();
    const assess = vi.fn(() => pending.promise);
    const { client } = clientWith({ assess });
    const first = client.assess();
    const second = client.assess();
    expect(assess).toHaveBeenCalledTimes(1);
    expect(assess).toHaveBeenCalledWith({ caseId: 'case-01', taskBudgetAtomic: '2000' });
    expect(client.state.phase).toBe('loading');
    pending.resolve(preview());
    await Promise.all([first, second]);
    expect(client.state).toMatchObject({ phase: 'ready', result: { taskBudgetAtomic: '2000' } });
  });

  it('clears the result immediately, keeps loading, and discards a response after input changes', async () => {
    const pending = deferred<unknown>();
    const { client } = clientWith({ assess: () => pending.promise });
    const request = client.assess();
    client.setCaseId('case-02');
    expect(client.state).toMatchObject({ caseId: 'case-02', budgetText: '0.002000', phase: 'loading', result: null });
    pending.resolve(preview('case-01'));
    await request;
    expect(client.state).toMatchObject({ caseId: 'case-02', phase: 'idle', result: null });
  });

  it('clears results and does not automatically retry after transport failure', async () => {
    const assess = vi.fn(async () => { throw new Error('offline'); });
    const { client } = clientWith({ assess });
    await client.assess();
    expect(assess).toHaveBeenCalledTimes(1);
    expect(client.state).toMatchObject({ phase: 'error', result: null });
  });

  it.each([
    ['bad payload', { allowed: true }],
    ['validator-rejected boundary', (() => {
      const value = structuredClone(preview());
      (value.finalGate as { executable: boolean }).executable = true;
      return value;
    })()],
    ['another case', preview('case-02')],
    ['another budget', preview('case-01', '1000')],
  ])('rejects %s even when the transport resolves', async (_label, response) => {
    const { client } = clientWith({ assess: async () => response });
    await client.assess();
    expect(client.state).toMatchObject({ phase: 'error', result: null });
  });

  it('does not publish a pending return after dispose', async () => {
    const pending = deferred<unknown>();
    const { client, changes } = clientWith({ assess: () => pending.promise });
    const request = client.assess();
    expect(changes).toHaveLength(1);
    client.dispose();
    pending.resolve(preview());
    await request;
    expect(changes).toHaveLength(1);
  });

  it('uses the pure file evaluator path with an injected file transport', async () => {
    const changes: unknown[] = [];
    const client = new PolicyPreviewClient({ mode: 'file', transport: filePolicyPreviewTransport(), onChange: state => changes.push(state) });
    await client.assess();
    expect(client.state).toMatchObject({ phase: 'ready', result: { case: { caseId: 'case-01' }, finalGate: { executable: false } } });
    expect(changes).toHaveLength(2);
  });

  it('HTTP transport makes one same-origin POST with only the frozen input', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify(preview()), {
      status: 200, headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
    const transport = httpPolicyPreviewTransport(fetcher);
    const input: PolicyPreviewInput = { caseId: 'case-01', taskBudgetAtomic: '2000' };
    await expect(transport.assess(input)).resolves.toEqual(preview());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/api/demo/policy-preview', expect.objectContaining({
      method: 'POST', credentials: 'same-origin', body: JSON.stringify(input),
    }));
  });

  it('HTTP transport rejects non-2xx and malformed JSON without retrying', async () => {
    const non2xx = vi.fn(async () => new Response('no', { status: 503 })) as unknown as typeof fetch;
    await expect(httpPolicyPreviewTransport(non2xx).assess({ caseId: 'case-01', taskBudgetAtomic: '2000' })).rejects.toThrow();
    expect(non2xx).toHaveBeenCalledTimes(1);

    const malformed = vi.fn(async () => new Response('{', { status: 200 })) as unknown as typeof fetch;
    await expect(httpPolicyPreviewTransport(malformed).assess({ caseId: 'case-01', taskBudgetAtomic: '2000' })).rejects.toThrow();
    expect(malformed).toHaveBeenCalledTimes(1);
  });
});
