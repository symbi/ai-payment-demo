/** Visual-only offline check: no purchase or scan requests. */
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
const vite = await createServer({ configFile: 'apps/web/vite.config.ts', server: { host: '127.0.0.1', port: 0 } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await vite.listen(); const origin = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage(); const errors: string[] = []; const requests: string[] = [];
  // The archived service starts behind the new payment-check entry.
  const openOffer = async () => {
    await page.locator('.live-payment-check > .payment-details > summary').click();
    await page.getByRole('button', { name: 'Report offer', exact: true }).click();
    await page.locator('nav details>summary').click();
  };
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const u = new URL(route.request().url()); if (u.origin !== origin) return route.abort();
    if (!u.pathname.startsWith('/api/')) return route.continue();
    requests.push(u.pathname); assert.equal(u.pathname, '/api/health');
    return route.fulfill({ json: { resourcePath: '/api/contract-insights', buyer: { connected: true }, seller: { connected: true, ready: false, message: 'Fixture' }, configuration: { payToConfigured: true, interceptaKeyConfigured: false }, paymentEnabled: false } });
  });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(origin); await openOffer();
    await expect(page.getByRole('heading', { name: 'Contract Report', exact: true })).toBeVisible();
    await expect(page.getByRole('img')).toHaveCount(0);
    await page.screenshot({ path: `/private/tmp/contract-report-offer-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Preview report', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Sample Report', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Get quote' })).toHaveCount(0);
    await expect(page.getByText('Sample · Not purchased', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Functions: 4, Events: 2, Modifiers: 1. Unit: count.' })).toBeVisible();
    await page.locator('.metric-bar').first().evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)));
    assert.equal(await page.locator('html').evaluate(e => e.scrollWidth <= innerWidth), true);
    assert.deepEqual(await page.locator('.axis-ticks span').allTextContents(), ['0', '1', '2', '3', '4']);
    const ratios = await page.locator('.metric-track').evaluateAll(els => els.map(e => e.querySelector('.metric-bar')!.getBoundingClientRect().width / e.getBoundingClientRect().width));
    [1, .5, .25].forEach((r,i) => assert.ok(Math.abs(ratios[i]-r)<.01));
    await page.locator('.insight-panel').screenshot({ path: `/private/tmp/contract-hitech-${width}.png` });
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); scrollTo(0, 0); });
    await page.screenshot({ path: `/private/tmp/contract-report-preview-${width}.png`, fullPage: true });
    assert.equal(await page.locator('html').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(8, 14, 26)');
    await page.getByText('Source & method', { exact: false }).click();
    await expect(page.getByText('Not a security audit.', { exact: false })).toBeVisible();
    assert.equal(await page.locator('html').evaluate(e => e.scrollWidth <= innerWidth), true);
  }
  await page.getByRole('button', { name: 'Details ↗', exact: true }).click();
  assert.equal(await page.getByRole('dialog').evaluate(e => e.scrollWidth <= e.clientWidth), true);
  await page.screenshot({ path: '/private/tmp/contract-midnight-details-320.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.reload(); await openOffer();
  await page.getByRole('button', { name: 'Preview report', exact: true }).click();
  assert.equal(await page.locator('.metric-bar').first().evaluate(e => getComputedStyle(e).animationName), 'none');
  await page.getByText('Source & method', { exact: false }).focus();
  await page.keyboard.press('Enter'); await expect(page.locator('.insight-panel details')).toHaveAttribute('open', '');
  assert.deepEqual(errors, []); assert.ok(requests.every(p => p === '/api/health'));
  console.log(JSON.stringify({ result: 'PASS', checks: ['1440/390/320 no overflow', 'count axis0-4', 'bar ratios1/.5/.25', 'source+scope details', 'keyboard details', 'reduced-motion disables animation', 'no purchase/scan calls', 'report offer excludes chart', 'sample report contains chart with no quote button', 'preview makes no purchase requests', 'midnight page and details', 'no page errors'], evidence: 'offline visual fixtures only' }));
} finally { await browser?.close(); await vite.close(); }
