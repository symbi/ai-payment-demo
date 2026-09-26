/** Isolated scenario UI; API fixtures never reach shared services or providers. */
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
const vite = await createServer({ configFile: 'apps/web/vite.config.ts', server: { host: '127.0.0.1', port: 0 } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await vite.listen(); const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const calls: string[] = [], errors: string[] = []; let requestId = '';
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()); if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    calls.push(url.pathname);
    if (url.pathname === '/api/health') return route.fulfill({ json: { resourcePath: '/api/contract-insights', buyer: { connected: true }, seller: { connected: true, ready: false, message: 'Fixture' }, configuration: { payToConfigured: true, interceptaKeyConfigured: false }, paymentEnabled: false } });
    if (url.pathname === '/api/inspect') { requestId = route.request().postDataJSON().requestId; return route.fulfill({ json: { requestId, status: 'held', decision: 'hold', reasons: ['Offline fixture'], counters: { sign: 0, settle: 0 }, events: [], paymentEnabled: false, aiMode: 'not_configured' } }); }
    throw new Error(`Unexpected API ${url.pathname}`);
  });
  await page.goto(origin);
  await page.getByRole('button', { name: 'Get quote' }).click();
  await expect(page.getByRole('heading', { name: 'Contract Report', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation');
  await nav.getByRole('button', { name: 'Scenario demo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Build an event landing page' })).toBeVisible();
  await expect(page.locator('.seller-option')).toHaveCount(3);
  const before = calls.length;
  await page.getByRole('button', { name: 'Review selection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Conditions match', exact: true })).toBeVisible();
  await expect(page.getByText('Not connected', { exact: true })).toBeVisible();
  await expect(page.getByText('Not completed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview draft', exact: true }).click();
  await expect(page.getByText('Bundled sample · Not purchased', { exact: true })).toBeVisible();
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); scrollTo(0, 0); });
  await page.screenshot({ path: '/private/tmp/scenario-desktop.png', fullPage: true });
  await page.getByLabel('Style', { exact: true }).selectOption('solid');
  await page.getByLabel('Budget', { exact: true }).selectOption('0');
  await expect(page.getByRole('heading', { name: 'Not reviewed', exact: true })).toBeVisible();
  await expect(page.locator('.seller-option').filter({ hasText: 'Open Shapes' }).getByText('Rule match', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select Open Shapes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your page, with solid icons' })).toBeVisible();
  await page.getByRole('button', { name: 'Review selection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Conditions match', exact: true })).toBeVisible();
  await page.getByLabel('Style', { exact: true }).selectOption('duotone');
  await page.getByLabel('Budget', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: 'Select Prism Works', exact: true }).click();
  await page.getByRole('button', { name: 'Review selection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Needs a different option', exact: true })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'SVG not listed' })).toBeVisible();
  await page.getByLabel('Editable SVG', { exact: true }).uncheck();
  await expect(page.getByRole('heading', { name: 'Not reviewed', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Review selection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Conditions match', exact: true })).toBeVisible();
  assert.equal(calls.length, before, 'scenario interactions must not call APIs');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.locator('html').evaluate(e => e.scrollWidth <= innerWidth), true);
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); scrollTo(0, 0); });
    await page.screenshot({ path: `/private/tmp/scenario-${width}.png`, fullPage: true });
  }
  await nav.getByRole('button', { name: /Request/ }).click();
  await page.getByRole('button', { name: 'Details ↗', exact: true }).click();
  await expect(page.getByText(requestId, { exact: true })).toBeVisible();
  await expect(page.getByText('Offline fixture', { exact: true })).toBeVisible();
  assert.equal(calls.filter(p => p === '/api/inspect').length, 1); assert.equal(calls.filter(p => p === '/api/pay').length, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', checks: ['3 explicitly example sellers', 'review status local only', 'free seller can fully match', 'style/format/budget update', 'review reset on changes', 'draft icons follow selection', 'bundled not purchased label', 'scenario zero API calls', '390/320 no overflow', 'original request retained', 'zero scan/payment calls', 'no page errors'], evidence: 'offline fixtures, not seller integration or purchase' }));
} finally { await browser?.close(); await vite.close(); }
