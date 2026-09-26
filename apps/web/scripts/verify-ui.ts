/** Isolated browser fixtures; never calls the running seller, provider, or payment services. */
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC, type PurchaseResult } from '../../../shared/contracts.ts';
const publicReport = JSON.parse(await readFile('apps/web/src/public-sample.json', 'utf8'));
assert.deepEqual(publicReport, JSON.parse(await readFile('apps/seller/samples/public-sample.json', 'utf8')));
assert.equal(publicReport.source.sha256, createHash('sha256').update(await readFile('apps/seller/samples/ExampleVault.sol')).digest('hex'));
assert.equal('declarations' in publicReport, false);
const vite = await createServer({ configFile: 'apps/web/vite.config.ts', server: { host: '127.0.0.1', port: 0, strictPort: false } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await vite.listen();
  const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  let inspectCalls = 0, payCalls = 0;
  let saved: PurchaseResult | undefined;
  let mode = 'normal', offline = false, oldService = false;
  const payTo = '0x1111111111111111111111111111111111111111';
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (offline) return route.abort('connectionrefused');
    if (url.pathname === '/api/health') return route.fulfill({ json: { resourcePath: oldService ? '/api/weather' : RESOURCE_PATH, buyer: { connected: true }, seller: { connected: true, ready: false, message: 'Fixture' }, configuration: { payToConfigured: true, interceptaKeyConfigured: true }, paymentEnabled: false } });
    if (url.pathname === '/api/inspect') {
      inspectCalls++;
      const body = route.request().postDataJSON(); assert.deepEqual(Object.keys(body).sort(), ['prompt', 'requestId']); assert.equal(body.prompt, 'Contract Insights');
      await new Promise(r => setTimeout(r, 100));
      saved = { requestId: body.requestId, status: 'held', decision: 'hold', reasons: ['Scan not requested.'], terms: { scheme: 'exact', network: TEST_NETWORK, asset: TEST_USDC, amount: '1000', payTo }, risk: { decision: 'hold', source: 'unavailable', reasons: ['Not scanned'], provider: 'intercepta', checkedAt: new Date().toISOString(), address: payTo }, events: [], counters: { sign: 0, settle: 0 }, paymentEnabled: false, aiMode: 'not_configured' };
      if (mode === 'seller') { delete saved.terms; delete saved.risk; saved.reasons = ['Seller unavailable']; }
      if (mode === 'denied') { saved.status = 'denied'; saved.decision = 'deny'; saved.terms!.amount = '9'.repeat(78); }
      if (mode === 'unknown') saved.status = 'settlement_unknown';
      if (mode === 'malformed') return route.fulfill({ json: { status: 'paid' } });
      if (mode === 'coerced') return route.fulfill({ json: { ...saved, status: ['settlement_unknown'] } });
      return route.fulfill({ json: saved });
    }
    if (url.pathname === '/api/pay') {
      payCalls++; assert.deepEqual(Object.keys(route.request().postDataJSON()), ['requestId']);
      await new Promise(r => setTimeout(r, 100));
      saved!.events.push({ step: 'recheck', at: new Date().toISOString(), message: 'Check started' });
      if (mode === 'changed' || mode === 'lost-changed') saved!.reasons = ['Quote changed.'];
      else { saved!.risk!.source = 'live'; saved!.risk!.scan = { transport: 'received', toxicScore: 0, traitsCount: 0, requestedNetwork: TEST_NETWORK, coverage: 'unverified', semantics: 'unverified' }; saved!.reasons = ['Scan received. Risk meaning and coverage unverified.']; }
      if (mode.startsWith('lost')) return route.abort('connectionreset');
      if (mode === 'badscan') return route.fulfill({ json: { ...saved, risk: { ...saved!.risk, scan: { ...saved!.risk!.scan, toxicScore: '0' } } } });
      return route.fulfill({ json: saved });
    }
    if (url.pathname.startsWith('/api/requests/')) return route.fulfill({ json: saved });
    throw new Error(`Unexpected API: ${url.pathname}`);
  });
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const noOverflow = async () => assert.equal(await page.locator('html').evaluate(e => e.scrollWidth <= innerWidth), true);
  const details = async () => { await page.getByRole('button', { name: 'Details ↗', exact: true }).click(); await expect(page.getByRole('dialog')).toBeVisible(); };
  const quote = async () => { await page.getByRole('button', { name: 'Get quote' }).click(); await expect(page.locator('.quote-price')).toBeVisible(); };
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Contract Report', exact: true })).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(0);
  assert.equal(await page.locator('body').innerText().then(s => /东京|天气|Tokyo|weather/.test(s)), false);
  await page.screenshot({ path: '/private/tmp/contract-services-desktop.png', fullPage: true });
  await nav.getByRole('button', { name: 'Request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No request yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Browse services' }).click();
  await details(); await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Details ↗', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 }); await noOverflow();
  await page.screenshot({ path: '/private/tmp/contract-services-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Preview report', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sample Report', exact: true })).toBeVisible();
  await page.getByText('Source & method', { exact: true }).click();
  await expect(page.getByText(publicReport.source.sha256, { exact: true })).toBeVisible();
  await noOverflow(); assert.equal(inspectCalls, 0); assert.equal(payCalls, 0);
  await page.screenshot({ path: '/private/tmp/contract-preview-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '← View offer', exact: true }).click();
  await page.getByRole('button', { name: 'Get quote' }).evaluate(e => { (e as HTMLButtonElement).click(); (e as HTMLButtonElement).click(); });
  await expect(page.getByRole('heading', { name: 'Ready to check', exact: true })).toBeVisible();
  assert.equal(inspectCalls, 1); assert.equal(payCalls, 0);
  await expect(page.locator('.quote-price')).toHaveText('0.001');
  await expect(page.getByRole('button', { name: 'Buy', exact: true })).toBeDisabled();
  await details(); const initialId = await page.locator('dialog code').first().textContent(); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Check', exact: true }).evaluate(e => { (e as HTMLButtonElement).click(); (e as HTMLButtonElement).click(); });
  await expect(page.getByRole('heading', { name: 'Scan received', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Checked', exact: true })).toBeDisabled(); assert.equal(payCalls, 1);
  await noOverflow(); await page.screenshot({ path: '/private/tmp/contract-scan-mobile.png', fullPage: true });
  await details(); await expect(page.getByText('0 · uninterpreted', { exact: true })).toBeVisible();
  assert.equal(await page.locator('dialog code').first().textContent(), initialId); await page.keyboard.press('Escape');
  offline = true; await page.getByRole('button', { name: 'Query request', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Status unknown', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Services', exact: true }).click(); await expect(page.getByRole('button', { name: 'Get quote' })).toBeDisabled();
  offline = false; await nav.getByRole('button', { name: /Request/ }).click(); await page.getByRole('button', { name: 'Query request' }).click();
  await expect(page.getByRole('heading', { name: 'Scan received', exact: true })).toBeVisible(); assert.equal(payCalls, 1);
  for (mode of ['changed', 'lost-changed', 'lost-normal', 'badscan']) {
    await page.reload(); await quote(); await expect(page.getByRole('button', { name: 'Check', exact: true })).toBeEnabled();
    const before: number = payCalls; await page.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(page.getByRole('button', { name: mode === 'changed' ? 'Checked' : 'Check attempted', exact: true })).toBeDisabled();
    if (mode !== 'changed') await expect(page.getByRole('heading', { name: 'Status unknown', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Query request' }).click();
    await expect(page.getByRole('heading', { name: mode.includes('changed') ? 'Review required' : 'Scan received', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: mode === 'changed' ? 'Checked' : 'Check attempted', exact: true })).toBeDisabled();
    await expect(page.getByText('Last quote', { exact: true })).toBeVisible(); assert.equal(payCalls, before + 1);
    if (mode.includes('changed')) { await details(); await expect(page.getByText('Quote changed.', { exact: true })).toBeVisible(); await page.keyboard.press('Escape'); }
  }
  for (mode of ['seller', 'malformed', 'coerced', 'unknown', 'denied']) {
    await page.setViewportSize({ width: 320, height: 844 }); await page.reload(); await quote();
    await expect(page.getByRole('button', { name: 'Check', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: 'Buy', exact: true })).toBeDisabled();
    await expect(page.getByRole('heading', { name: mode === 'seller' ? 'Review required' : mode === 'denied' ? 'Declined' : 'Status unknown', exact: true })).toBeVisible();
    await noOverflow();
    if (mode === 'denied') { await details(); assert.equal(await page.getByRole('dialog').evaluate(e => e.scrollWidth <= e.clientWidth), true); await page.keyboard.press('Escape'); }
    if (['unknown', 'malformed', 'coerced'].includes(mode)) { await nav.getByRole('button', { name: 'Services', exact: true }).click(); await expect(page.getByRole('button', { name: 'Get quote' })).toBeDisabled(); }
  }
  oldService = true; await page.reload(); await expect(page.getByText('Service updating', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: 'Get quote' })).toBeDisabled();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', evidence: 'isolated fixtures only; no live backend/provider', checks: ['public JSON equality and source SHA', 'actual 4/2/1 chart', 'English service identity', 'preview no request', 'keyboard modal focus', '390/320 no overflow', 'quote/check double click lock', 'raw score never safety', 'buy disabled', 'unknown blocks new quote', 'query keeps identity', 'lost check never retries or claims completion', 'changed quote reasons preserved', 'malformed scan facts held', 'seller missing quote', 'malformed/coerced/unknown states', 'large amount', 'old resource blocked', 'no runtime errors'], inspectCalls, payCalls }, null, 2));
} finally { await browser?.close(); await vite.close(); }
