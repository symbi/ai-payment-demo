import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createInterceptaScanner } from '../../../apps/buyer/src/intercepta.ts';
import { DemoRequestClient, STORAGE_KEY } from '../../../apps/web/src/demo-request-client.ts';
import { RiskScanEvidence } from '../../../apps/web/src/DemoRiskEvidence.tsx';
import { isPurchase } from '../../../apps/web/src/api.ts';
import { DEFAULT_WEIGHTS } from '../../../shared/demo-assessment.ts';
import {
  advanceRequest, createRequest, DemoRequestStore, type DemoRequestInput,
} from '../../../shared/demo-requests.ts';

const input: DemoRequestInput = {
  fixtureId: 'controlled-a', amount: '0.001000', taskLimit: '0.005000',
  weights: [...DEFAULT_WEIGHTS], contentChanged: false, scenario: 'normal',
};

describe('Step 3 independent acceptance', () => {
  it('queries a recovered HTTP id, stays unresolved when the server lost it, and never posts a replacement', async () => {
    const completed = advanceRequest(createRequest('recover-me', input, 0), 300);
    let raw: string | null = JSON.stringify({
      version: 1, mode: 'http', record: completed, invalidated: false, recoveryBlocked: false,
    });
    const storage = {
      getItem: (key: string) => key === STORAGE_KEY ? raw : null,
      setItem: (_key: string, value: string) => { raw = value; },
    };
    const get = vi.fn(async () => null);
    const post = vi.fn();
    const client = new DemoRequestClient({ mode: 'http', storage, transport: { get, post } });

    await client.recover();
    expect(get).toHaveBeenCalledOnce();
    expect(post).not.toHaveBeenCalled();
    expect(client.snapshot()).toMatchObject({
      busy: false,
      record: { id: 'recover-me', status: 'unresolved', result: null },
    });
    expect(client.blocked).toBe(true);
    await client.submit(input);
    expect(post).not.toHaveBeenCalled();
  });

  it('deduplicates the same id and rejects changed content without any execution flag becoming true', () => {
    let now = 0;
    const store = new DemoRequestStore(() => now);
    const first = store.post('same-id', input);
    const duplicate = store.post('same-id', { ...input, weights: [...input.weights] });
    expect(duplicate).toEqual(first);
    now = 300;
    const completed = store.post('same-id', input);
    expect(completed).toMatchObject({
      status: 'completed', assessmentRuns: 1,
      execution: { signed: false, submitted: false, paid: false, reportPurchased: false },
    });
    expect(() => store.post('same-id', { ...input, amount: '0.002000' })).toThrow(/不同内容/);
  });

  it('keeps a nonempty provider-shaped fixture bounded, unverified, held, and free of provider descriptions', async () => {
    const traits = Array.from({ length: 25 }, (_, index) => ({
      risk: index, name: 'rug_pull', txsCount: index + 1, description: `UNTRUSTED-${index}`,
    }));
    const transport = vi.fn<typeof fetch>(async () => Response.json({ toxicScore: 4, traits }));
    const risk = await createInterceptaScanner('FAKE-TEST-KEY', transport)(
      '0x1111111111111111111111111111111111111111', 'eip155:84532',
    );
    expect(risk).toMatchObject({
      source: 'live', decision: 'hold',
      scan: { transport: 'received', toxicScore: 4, traitsCount: 25, coverage: 'unverified', semantics: 'unverified' },
    });
    expect(risk.scan?.traitLabels).toHaveLength(20);
    expect(risk.observation?.kind).toBe('observed');
    if (risk.observation?.kind === 'observed') {
      expect(risk.observation.traits.every(trait => trait.description === '')).toBe(true);
    }
    expect(JSON.stringify(risk)).not.toContain('UNTRUSTED-');
    expect(JSON.stringify(risk)).not.toContain('FAKE-TEST-KEY');

    const purchase = {
      requestId: 'qa-risk', status: 'held', decision: 'hold', reasons: risk.reasons, risk,
      events: [], counters: { sign: 0, settle: 0 }, paymentEnabled: false, aiMode: 'not_configured',
    } as const;
    expect(isPurchase(purchase)).toBe(true);
    const html = renderToStaticMarkup(createElement(RiskScanEvidence, { scan: risk.scan! }));
    expect(html).toContain('仅展示前 20 条允许标签');
    expect(html).toContain('真实付款状态：暂停（hold）');
  });

  it('fails closed on an oversized provider response while recording only received/unverified transport facts', async () => {
    const trait = { risk: 1, name: 'blacklist', txsCount: 1, description: 'untrusted' };
    const transport = vi.fn<typeof fetch>(async () => Response.json({
      toxicScore: 0, traits: Array.from({ length: 101 }, () => trait),
    }));
    const risk = await createInterceptaScanner('FAKE-TEST-KEY', transport)(
      '0x1111111111111111111111111111111111111111', 'eip155:84532',
    );
    expect(risk).toMatchObject({
      source: 'unavailable', decision: 'hold',
      scan: { transport: 'received', coverage: 'unverified', semantics: 'unverified' },
    });
    expect(risk.scan?.toxicScore).toBeUndefined();
    expect(risk.scan?.traitLabels).toBeUndefined();
    expect(risk.observation).toBeUndefined();
  });
});
