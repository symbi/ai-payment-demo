import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { createInterceptaScanner } from '../../../apps/buyer/src/intercepta.ts';
import { isPurchase } from '../../../apps/web/src/api.ts';
import { RiskScanEvidence } from '../../../apps/web/src/DemoRiskEvidence.tsx';

it('flows synthetic nonempty traits from fake fetch through RiskResult, web validation, and SSR', async () => {
  const transport = vi.fn<typeof fetch>(async () => Response.json({ toxicScore: 63.5, traits: [
    { risk: 80, name: 'known_scammer', txsCount: 2, description: 'Synthetic test fixture only' },
    { risk: 45, name: 'mixer_transfers', txsCount: 1, description: 'Synthetic test fixture only' },
  ] }));
  const risk = await createInterceptaScanner('FAKE-TEST-KEY', transport)('0x1111111111111111111111111111111111111111', 'eip155:84532');
  const purchase = { requestId: 'step3-offline', status: 'held', decision: 'hold', reasons: risk.reasons, risk,
    events: [], counters: { sign: 0, settle: 0 }, paymentEnabled: false, aiMode: 'not_configured' };
  expect(isPurchase(purchase)).toBe(true);
  const html = renderToStaticMarkup(createElement(RiskScanEvidence, { scan: risk.scan! }));
  expect(html).toContain('原始 toxicScore：63.5');
  expect(html).toContain('known_scammer');
  expect(html).toContain('mixer_transfers');
  expect(html).toContain('hold');
  expect(transport).toHaveBeenCalledTimes(1);
  expect(JSON.stringify({ purchase, html })).not.toContain('FAKE-TEST-KEY');
});
