/** Real-order UI wiring with intercepted transport only; never accesses the running buyer/provider. */
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { TEST_USDC } from '../../../shared/contracts.ts';
const vite = await createServer({ configFile: 'apps/web/vite.config.ts', server: { host: '127.0.0.1', port: 0 } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
 await vite.listen(); const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
 browser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
 const calls: string[] = []; const errors: string[] = []; let id = ''; let mode = 'legacy'; let healthEnabled = false; let resultEnabled = false; let failQuery = false; let invalidQuote = false;
 const terms = () => ({ scheme: 'exact', network: 'eip155:84532', asset: TEST_USDC, amount: '1000', payTo: invalidQuote ? 'invalid-recipient-'.padEnd(128, 'x') : '0x2222222222222222222222222222222222222222' });
 const result = () => ({ requestId: id, status: 'held', decision: 'hold', reasons: ['Risk coverage is unverified.'], terms: terms(), events: [], counters: { sign: 0, settle: 0 }, paymentEnabled: resultEnabled, aiMode: 'not_configured', risk: { decision: 'hold', source: 'live', reasons: ['Coverage unverified'], address: terms().payTo, checkedAt: '2026-09-26T00:00:00Z', provider: 'intercepta', scan: { transport: 'received', toxicScore: 0, traitsCount: 0, requestedNetwork: 'eip155:84532', coverage: 'unverified', semantics: 'unverified' } } });
 const execution = () => ({ operationId: 'op-1', decision: 'hold', reasons: ['Coverage unverified'], reasonCodes: ['COVERAGE_UNVERIFIED'], evidence: { source: 'live', evidenceId: 'scan-1', address: terms().payTo, checkedAt: '2026-09-26T00:00:00Z', requestedPaymentNetwork: 'eip155:84532', providerEvidenceNetwork: null, coverage: 'unverified', semantics: 'unverified' }, checkedQuoteHash: null, signingInputHash: null, signing: 'not_signed', submission: 'not_submitted', settlement: 'not_settled', retryAllowed: false, taskComplete: false });
 page.on('pageerror', error => errors.push(error.message));
 await page.route('**/*', async route => {
   const url = new URL(route.request().url()); if (url.origin !== origin) return route.abort(); if (!url.pathname.startsWith('/api/')) return route.continue(); calls.push(url.pathname);
   if (url.pathname === '/api/health') return route.fulfill({ json: { resourcePath: '/api/contract-insights', buyer: { connected: true }, seller: { connected: true, ready: false, message: 'Fixture' }, configuration: { payToConfigured: true, interceptaKeyConfigured: true }, paymentEnabled: healthEnabled } });
   if (url.pathname === '/api/inspect') { id = route.request().postDataJSON().requestId; assert.equal(route.request().postDataJSON().prompt, 'Contract Insights'); return route.fulfill({ json: { ...result(), risk: undefined } }); }
   if (url.pathname === '/api/pay' || url.pathname === `/api/requests/${id}`) {
     if (url.pathname === '/api/pay') assert.equal(route.request().postDataJSON().requestId, id);
     if (mode === 'timeout' || failQuery && url.pathname.startsWith('/api/requests/')) return route.abort('connectionreset');
     const e = execution(); const value: any = { ...result(), execution: mode === 'legacy' ? undefined : e };
     if (mode === 'legacy-no-scan') { delete value.execution; delete value.risk; }
     if (['signing', 'submission', 'settlement'].includes(mode)) value.execution[mode] = 'unknown';
     if (mode === 'digests') { value.execution.checkedQuoteHash = 'same-digest'; value.execution.signingInputHash = 'same-digest'; }
     if (mode === 'fixture-verified') Object.assign(value.execution.evidence, {source: 'fixture', coverage: 'verified', semantics: 'verified'});
     if (mode === 'malformed') value.execution.evidence.coverage = ['verified'];
     if (mode === 'wrong-id') value.requestId = 'different-id';
     if (mode === 'settled') { Object.assign(value.execution, { decision: 'allow', signing: 'signed', submission: 'submitted', settlement: 'settled', taskComplete: true }); value.status = 'paid'; value.data = { kind: 'public-sample' }; }
     for (const object of [value, value.terms, value.risk, value.risk?.scan, value.execution, value.execution?.evidence]) if (object) object.unexpectedPrivateField = 'CANARY_NOT_PUBLIC';
     return route.fulfill({ json: value });
   }
   throw new Error(`Forbidden API ${url.pathname}`);
 });
 const card = page.locator('.live-payment-check > .single-payment-card');
 const countPay = () => calls.filter(path => path === '/api/pay').length;
 const quote = async () => { await page.goto(origin); await page.getByRole('button', { name: 'Get quote', exact: true }).click(); await expect(card.getByRole('button', { name: 'Check risk' })).toBeVisible(); };
 await page.goto(origin); await expect(page.getByRole('button', { name: 'Get quote', exact: true })).toBeEnabled(); assert.equal(countPay(), 0); assert.equal(calls.filter(p => p === '/api/inspect').length, 0);
 await expect(page).toHaveTitle('Agent 受控付款'); await expect(page.getByRole('heading', {name:'Agent 受控付款',exact:true})).toBeVisible();
 await expect(page.getByLabel('Evidence view')).not.toBeVisible();
 await expect(card).toContainText('Risk: Unknown. No usable evidence.');
 await expect(card).toContainText('Payment is disabled.');
 await expect(card).toContainText('Not a contract audit.');
 await expect(card.locator('.flow-section-title')).toHaveText(['2 · Payment decision','3 · Execution','4 · Result & evidence']);
 await quote(); await expect(card).toContainText('0x2222222222222222222222222222222222222222'); await expect(card).toContainText('eip155:84532'); await expect(card.locator('.payment-status')).toContainText('Signature: Unknown · Not reported'); assert.equal(countPay(), 0);
 await card.getByRole('button', { name: 'Check risk' }).dblclick(); await expect(card.getByRole('heading', { name: 'Check received · Payment status unknown' })).toBeVisible(); assert.equal(countPay(), 1); await expect(card.getByRole('button', { name: 'Check risk' })).toBeDisabled(); await expect(card).toContainText('Raw score 0 (uninterpreted)');
 await expect(card.locator('.decision-basis')).toContainText('Meaning unknown'); await expect(card.locator('.decision-basis')).toContainText('Unknown · Budget check not reported');
 const beforeQuery = countPay(); await card.getByRole('button', { name: 'Refresh status' }).click(); await expect(card.getByRole('button', { name: 'Refresh status' })).toBeEnabled(); assert.equal(countPay(), beforeQuery);
 const details = page.locator('.live-payment-check > .payment-details'); await details.locator(':scope > summary').click(); await details.locator('.offline-examples > summary').click(); const demo = details.locator('.offline-examples'); await demo.getByRole('button', { name: 'Preview check' }).click(); await expect(demo.getByRole('heading', { name: 'Block', exact: true })).toBeVisible(); assert.equal(countPay(), beforeQuery);
 for (const state of ['signing', 'submission', 'settlement', 'malformed', 'wrong-id', 'timeout']) {
   mode = state; await quote(); await card.getByRole('button', { name: 'Check risk' }).click(); await expect(card.getByRole('heading', { name: 'Status unknown' })).toBeVisible(); await expect(card.locator('.payment-status')).toContainText('Signature: Unknown'); await expect(card.locator('.payment-status')).toContainText('Settlement: Unknown'); await expect(card.getByRole('button', { name: 'Check risk' })).toBeDisabled();
 }
 for (const state of ['digests', 'fixture-verified']) { mode = state; await quote(); await card.getByRole('button', {name:'Check risk'}).click(); await expect(card.getByRole('heading', {name:'Paused by backend policy'})).toBeVisible(); await expect(card.locator('.decision-basis')).toContainText('Unknown · Match not reported'); await expect(card.locator('.decision-basis')).toContainText('Unknown · Budget check not reported'); if (state === 'digests') await expect(card.locator('.decision-basis')).toContainText('No explicit content-match result'); else await expect(card.locator('.decision-basis')).toContainText('Unknown · Fixture only'); }
 mode = 'settlement'; await quote(); await card.getByRole('button', { name: 'Check risk' }).click(); await expect(card.getByRole('heading', { name: 'Status unknown' })).toBeVisible();
 mode = 'legacy-no-scan'; await card.getByRole('button', { name: 'Refresh status' }).click(); await expect(card.getByRole('heading', { name: 'Status unknown' })).toBeVisible();
 mode = 'timeout'; await quote(); await card.getByRole('button', { name: 'Check risk' }).click(); await expect(card.getByRole('heading', { name: 'Status unknown' })).toBeVisible();
 mode = 'legacy-no-scan'; await card.getByRole('button', { name: 'Refresh status' }).click(); await expect(card.getByRole('heading', { name: 'Quote received' })).toBeVisible(); await expect(card.getByRole('button', { name: 'Check risk' })).toBeDisabled();
 mode = 'settled'; await quote(); await card.getByRole('button', { name: 'Check risk' }).click(); await expect(card).toContainText('Policy permits · Not proof of payment'); await expect(card).toContainText('Completion is unconfirmed');
 failQuery = true; await card.getByRole('button', { name: 'Refresh status' }).click(); await expect(card.getByRole('heading', { name: 'Status unknown' })).toBeVisible(); await expect(card.locator('.payment-status')).not.toContainText('settled'); failQuery = false;
 mode = 'hold';
 for (const gate of ['health', 'result', 'quote']) { healthEnabled = gate === 'health'; resultEnabled = gate === 'result'; invalidQuote = gate === 'quote'; const before = countPay(); await quote(); await expect(card.getByRole('button', { name: 'Check risk' })).toBeDisabled(); assert.equal(countPay(), before); }
 healthEnabled = false; resultEnabled = false; invalidQuote = false; await quote(); await card.getByRole('button', { name: 'Check risk' }).click(); await expect(card.getByRole('heading', { name: 'Paused by backend policy' })).toBeVisible(); await expect(card.locator('.payment-limitations')).toContainText('Risk meaning is unconfirmed. Network coverage is unconfirmed.');
 await details.locator(':scope > summary').click(); await details.locator('.response-facts > summary').click(); await expect(details.locator('.response-facts pre')).toContainText('op-1'); await expect(details.locator('.response-facts pre')).not.toContainText('CANARY_NOT_PUBLIC'); await details.locator(':scope > summary').click();
 for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: 950 }); assert.equal(await page.locator('html').evaluate(e => e.scrollWidth <= innerWidth), true); await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); scrollTo(0, 0); }); await page.screenshot({ path: `/private/tmp/agent-payment-basis-${width}.png`, fullPage: true }); }
 assert.deepEqual(errors, []);
 console.log(JSON.stringify({ result: 'PASS', checks: ['real-order default/no automatic inspect or scan', 'quote identity/recipient/network', 'explicit check only/duplicate lock', 'legacy execution unreported/zero uninterpreted', 'query no scan', 'offline samples isolated in Details', 'each execution unknown/missing execution cannot clear prior unknown','lost check plus legacy query never claims check receipt', 'malformed execution and mismatched ID', 'lost response remains unknown/no retry', 'settled/public sample not completion', 'query failure clears success display', 'health/result/payment quote gates', '1440/390/320 without overflow', 'no runtime errors'], evidence: 'intercepted fixtures only; no buyer/provider/payment calls' }));
} finally { await browser?.close(); await vite.close(); }
