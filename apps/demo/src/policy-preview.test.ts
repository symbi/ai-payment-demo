import { Duplex } from 'node:stream';
import { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { createDemoApp } from './app.ts';
import { evaluatePolicyPreview, isPolicyPreviewResult, POLICY_PREVIEW_CASES } from '../../../shared/policy-preview.ts';

async function inject(app: Express, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const chunks: Buffer[] = [];
  const socket = new Duplex({ read() {}, write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  const request = new IncomingMessage(socket as never);
  request.method = method; request.url = url;
  const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
  request.headers = { host: '127.0.0.1', ...(encoded ? { 'content-type': 'application/json', 'content-length': String(encoded.length) } : {}), ...headers };
  const response = new ServerResponse(request); response.assignSocket(socket as never);
  const finished = new Promise<void>((resolve, reject) => { response.once('finish', resolve); response.once('error', reject); });
  app(request, response); if (encoded) request.push(encoded); request.push(null); await finished;
  const raw = Buffer.concat(chunks).toString('utf8'); const [head, payload = ''] = raw.split('\r\n\r\n');
  return { status: Number(/^HTTP\/1\.1 (\d+)/m.exec(head)?.[1]), json: JSON.parse(payload), headers: head };
}

describe('in-memory policy preview API', () => {
  it('evaluates every synthetic case without invoking an external fetch', async () => {
    const externalFetch = vi.fn(() => { throw new Error('External requests are forbidden in the company demo'); });
    vi.stubGlobal('fetch', externalFetch);
    try {
      const app = createDemoApp();
      for (const sample of POLICY_PREVIEW_CASES) {
        const response = await inject(app, 'POST', '/api/demo/policy-preview', {
          caseId: sample.caseId, taskBudgetAtomic: sample.exampleTaskBudgetAtomic,
        });
        expect(response.status).toBe(200);
        expect(isPolicyPreviewResult(response.json)).toBe(true);
      }
      expect(externalFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns the same public synthetic case catalog without listening', async () => {
    const response = await inject(createDemoApp(), 'GET', '/api/demo/policy-preview/cases');
    expect(response.status).toBe(200);
    expect(response.json).toEqual({ simulation: true, paymentEnabled: false, cases: POLICY_PREVIEW_CASES });
    expect(response.headers).toContain('Cache-Control: no-store');
  });

  it('returns the pure evaluation result and preserves simulation boundaries', async () => {
    const input = { caseId: 'case-08', taskBudgetAtomic: '2000' };
    const response = await inject(createDemoApp(), 'POST', '/api/demo/policy-preview', input);
    expect(response.status).toBe(200);
    expect(response.json).toEqual(evaluatePolicyPreview(input));
    expect(isPolicyPreviewResult(response.json)).toBe(true);
    expect(response.json).toMatchObject({ simulation: true, paymentEnabled: false,
      policy: { action: 'allow_with_limit', capAtomic: '500' },
      previewEligibility: { status: 'blocked', reasonCodes: ['QUOTE_EXCEEDS_CAP'] },
      finalGate: { executable: false, reasonCodes: ['SIMULATION_ONLY'] } });
  });

  it.each([
    { caseId: 'case-99', taskBudgetAtomic: '2000' },
    { caseId: 'case-01', taskBudgetAtomic: '0' },
    { caseId: 'case-01', taskBudgetAtomic: '1e3' },
    { caseId: 'case-01', taskBudgetAtomic: '2000', capAtomic: '1' },
    { caseId: 'case-01', taskBudgetAtomic: '2000', evidence: { verified: true } },
    { caseId: 'case-01', taskBudgetAtomic: '2000', semantics: 'verified' },
    { caseId: 'case-01', taskBudgetAtomic: '2000', address: '0xcaller' },
    { caseId: 'case-01', taskBudgetAtomic: '2000', action: 'allow' },
    { caseId: 'case-01', taskBudgetAtomic: '2000', paymentEnabled: true },
    { caseId: 'case-01', taskBudgetAtomic: '2000', quoteAmountAtomic: '1' },
  ])('returns 400 for unknown cases or caller-controlled policy fields %#', async body => {
    const response = await inject(createDemoApp(), 'POST', '/api/demo/policy-preview', body);
    expect(response.status).toBe(400);
    expect(response.json).toMatchObject({ simulation: true, paymentEnabled: false, code: expect.any(String) });
  });

  it('preserves the global 16kb and same-origin restrictions', async () => {
    const app = createDemoApp();
    expect((await inject(app, 'POST', '/api/demo/policy-preview', { caseId: 'case-01', taskBudgetAtomic: '1', extra: 'x'.repeat(17000) })).status).toBe(400);
    expect((await inject(app, 'GET', '/api/demo/policy-preview/cases', undefined, { origin: 'http://elsewhere.invalid' })).status).toBe(403);
    expect((await inject(app, 'POST', '/api/demo/policy-preview', { caseId: 'case-01', taskBudgetAtomic: '2000' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });
});
