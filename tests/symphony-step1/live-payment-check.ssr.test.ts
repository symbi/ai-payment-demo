import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { PurchaseResult, ProtectedPaymentOutcome } from '../../shared/contracts.ts';
import { LivePaymentCheck } from '../../apps/web/src/LivePaymentCheck.tsx';

const evidence = {
  source: 'unavailable' as const, evidenceId: null, address: null, checkedAt: null,
  requestedPaymentNetwork: 'eip155:84532', providerEvidenceNetwork: null,
  coverage: 'unverified' as const, semantics: 'unverified' as const,
};
const unidentified: ProtectedPaymentOutcome = {
  identity: 'unavailable', operationId: null, decision: 'hold', reasonCodes: ['IDENTITY_UNAVAILABLE'],
  reasons: ['Backend stopped: no trusted operation identity was available.'], evidence,
  checkedQuoteHash: null, signingInputHash: null, signing: 'unknown', submission: 'unknown', settlement: 'unknown',
  retryAllowed: false, taskComplete: false,
};
const identified: ProtectedPaymentOutcome = {
  operationId: 'op-known-001', decision: 'hold', reasonCodes: ['POLICY_HOLD'],
  reasons: ['Backend policy paused this known operation.'], evidence,
  checkedQuoteHash: null, signingInputHash: null, signing: 'not_signed', submission: 'not_submitted', settlement: 'not_settled',
  retryAllowed: false, taskComplete: false,
};
const result = (execution: ProtectedPaymentOutcome): PurchaseResult => ({
  requestId: 'request-simulated-001', status: 'held', decision: 'hold', reasons: execution.reasons,
  events: [], counters: { sign: 0, settle: 0 }, paymentEnabled: false, aiMode: 'not_configured', execution,
});
const render = (execution: ProtectedPaymentOutcome) => renderToStaticMarkup(createElement(LivePaymentCheck, {
  result: result(execution), uncertain: false, requestId: 'request-simulated-001', busy: '', error: '',
  serviceReady: true, canCheck: true, checked: true, paymentDisabled: true,
  onQuote() {}, onCheck() {}, onQuery() {}, onRequest() {}, onServices() {}, onScenario() {}, onDetails() {},
}));
const saveExample = (name: string, title: string, markup: string) => {
  const path = resolve('tests/symphony-step1', name); mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><aside><strong>SIMULATED INPUT</strong> · Offline SSR evidence only · No real wallet, payment, provider, or network call · contractRevision step1-identity-v1</aside>${markup}</body></html>\n`);
};

it('renders an unidentified hold as unknown with its stop reason and no retry implication', () => {
  const html = render(unidentified);
  expect(html).toContain('Status unknown');
  expect(html).toContain('Backend stopped: no trusted operation identity was available.');
  expect(html).toContain('Operation number was not established.');
  expect(html).toContain('Not established · No trusted operation identity');
  expect(html).toMatch(/<button class="primary" disabled=""/);
  expect(html).toContain('Signature: <strong>Unknown</strong>');
  expect(html).not.toContain('Not signed');
  expect(html).not.toContain('Not paid');
  expect(html).not.toContain('&quot;operationId&quot;: null');
  saveExample('unidentified-hold.ssr.html', 'Simulated unidentified hold', html);
});

it('keeps a known operation hold distinct and visible', () => {
  const html = render(identified);
  expect(html).toContain('Paused by backend policy');
  expect(html).toContain('Backend policy paused this known operation.');
  expect(html).toContain('op-known-001');
  expect(html).toContain('Not signed');
  expect(html).not.toContain('Operation number was not established.');
  saveExample('identified-hold.ssr.html', 'Simulated identified hold', html);
});

it('keeps a backend reason visible for an existing identified unknown state', () => {
  const html = render({ ...identified, reasons: ['Backend retained this operation because settlement is unknown.'], signing: 'unknown', submission: 'unknown', settlement: 'unknown' });
  expect(html).toContain('Status unknown');
  expect(html).toContain('Backend retained this operation because settlement is unknown.');
  expect(html).toContain('op-known-001');
});
