/** Real local seller + buyer HTTP acceptance. No test doubles or payment credentials.
 * Run from repository root: node --import tsx apps/buyer/scripts/verify-local.ts
 * Only free facilitator capability discovery can leave this process; no payment is sent.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSellerApp } from '../../seller/src/app.ts';
import { createBuyerApp } from '../src/app.ts';
import { isAddress } from '../src/policy.ts';
import { PRICE_ATOMIC, TEST_NETWORK, TEST_USDC } from '../../../shared/contracts.ts';

// Read the project config file, extract only the public merchant field for app configuration.
// The file can contain secrets: never print its contents or load other fields via dotenv.
const payTo = /^SELLER_PAY_TO=([^\r\n]*)/m.exec(readFileSync(new URL('../../../.env', import.meta.url), 'utf8'))?.[1]?.trim();
assert.ok(isAddress(payTo), 'Local public merchant address is missing or invalid');
const servers: Server[] = [];
const observations: Record<string, unknown>[] = [];
const sellerRequests: { status: number; paymentHeader: boolean }[] = [];
async function listen(server: Server) {
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function json(url: string, body?: unknown) {
  const start = performance.now();
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  return { status: response.status, body: await response.json(), elapsedMs: Math.round(performance.now() - start) };
}
try {
  const sellerApp = createSellerApp({ payTo }); // real HTTPFacilitatorClient, no injection
  const sellerUrl = await listen(createServer((req, res) => {
    if (req.url === '/api/weather') res.on('finish', () => sellerRequests.push({ status: res.statusCode, paymentHeader: !!(req.headers['payment-signature'] || req.headers['x-payment']) }));
    sellerApp(req, res);
  }));
  const buyerUrl = await listen(createServer(createBuyerApp({ sellerUrl, payTo, riskKeyConfigured: false, paymentRequested: false })));
  const sellerBefore = await json(`${sellerUrl}/health`);
  const health = await json(`${buyerUrl}/api/health`);
  observations.push({ step: 'health-before', seller: sellerBefore.body, buyer: health.body });
  assert.equal(sellerBefore.status, 200); assert.equal(health.status, 200);
  assert.equal(sellerBefore.body.configured, true); assert.equal(sellerBefore.body.ready, false);
  assert.equal(health.body.seller.connected, true); assert.equal(health.body.seller.ready, sellerBefore.body.ready);
  assert.equal(health.body.paymentEnabled, false); assert.equal(health.body.configuration.interceptaKeyConfigured, false);

  const intent = { requestId: 'local-integration-0001', prompt: '查看东京天气' };
  const inspected = await json(`${buyerUrl}/api/inspect`, intent);
  observations.push({ step: 'inspect-cold', status: inspected.status, elapsedMs: inspected.elapsedMs, state: inspected.body.status, reasons: inspected.body.reasons, amount: inspected.body.terms?.amount, network: inspected.body.terms?.network, payToMatches: inspected.body.terms?.payTo === payTo, events: inspected.body.events, counters: inspected.body.counters });
  assert.equal(inspected.status, 200); assert.equal(inspected.body.status, 'held');
  assert.equal(inspected.body.terms?.amount, PRICE_ATOMIC, 'Cold inspect must obtain the real seller 402 terms before holding');
  assert.equal(inspected.body.terms.network, TEST_NETWORK); assert.equal(inspected.body.terms.asset.toLowerCase(), TEST_USDC.toLowerCase());
  assert.equal(inspected.body.terms.payTo, payTo); assert.equal(inspected.body.risk.source, 'unavailable');
  assert.match(inspected.body.reasons.join(' '), /API Key/);
  assert.deepEqual(inspected.body.counters, { sign: 0, settle: 0 });
  assert.equal(sellerRequests.length, 1); assert.equal(sellerRequests[0].status, 402);

  const duplicate = await json(`${buyerUrl}/api/inspect`, intent);
  assert.deepEqual(duplicate.body, inspected.body); assert.equal(sellerRequests.length, 1);
  const changed = await json(`${buyerUrl}/api/inspect`, { ...intent, prompt: '不同任务' });
  assert.equal(changed.status, 409); assert.equal(sellerRequests.length, 1);
  observations.push({ step: 'duplicate-and-conflict', duplicateStatus: duplicate.status, changedIntentStatus: changed.status, sellerRequests: sellerRequests.length });
  const paid = await json(`${buyerUrl}/api/pay`, { requestId: intent.requestId });
  assert.equal(paid.status, 200); assert.equal(paid.body.status, 'held'); assert.equal(paid.body.paymentEnabled, false);
  assert.deepEqual(paid.body.counters, { sign: 0, settle: 0 }); assert.equal(sellerRequests.length, 2);
  const repeatedPay = await json(`${buyerUrl}/api/pay`, { requestId: intent.requestId });
  assert.deepEqual(repeatedPay.body, paid.body); assert.equal(sellerRequests.length, 2);
  const saved = await json(`${buyerUrl}/api/requests/${intent.requestId}`);
  assert.deepEqual(saved.body, paid.body);
  observations.push({ step: 'pay-and-get', state: paid.body.status, reasons: paid.body.reasons, counters: paid.body.counters, repeatedPayStatus: repeatedPay.status, getStatus: saved.status });
  const sellerAfter = await json(`${sellerUrl}/health`);
  const buyerAfter = await json(`${buyerUrl}/api/health`);
  assert.equal(buyerAfter.body.seller.ready, sellerAfter.body.ready);
  assert.equal(sellerRequests.every(r => r.status === 402 && !r.paymentHeader), true);
  observations.push({ step: 'health-after', seller: sellerAfter.body, buyer: buyerAfter.body, sellerRequests });
  // A truthful fallback quote + not-ready health is valid for this fail-closed slice.
  // PASS certifies the local HTTP flow, not facilitator/payment readiness.
  const facilitatorMode = sellerAfter.body.facilitatorInitialized && sellerAfter.body.ready ? 'sdk-initialized' : 'configured-quote-fallback';
  console.log(JSON.stringify({ outcome: 'pass', mode: 'real-local-apps-no-fixtures', facilitatorMode, observations }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ outcome: 'fail', mode: 'real-local-apps-no-fixtures', reason: error instanceof Error ? error.message : 'Unknown failure', observations, sellerRequests }, null, 2));
  process.exitCode = 1;
} finally {
  for (const server of servers.reverse()) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
