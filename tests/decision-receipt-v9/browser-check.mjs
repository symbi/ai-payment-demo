// Offline fixture acceptance: all requests intercepted, no provider or payment.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PRIVATE_RISK_CANDIDATES, PRIVATE_SCAN_REVISION, isPrivateScanStatus } from '../../shared/private-risk.ts';
import { buildRiskReceipt } from '../../shared/risk-receipt.ts';
import { evaluateLivePaymentPolicy } from '../../shared/live-payment-policy.ts';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../shared/contracts.ts';
const root = new URL('../../', import.meta.url), output = new URL('test-results/decision-receipt-v9/', root);
const origin = 'http://127.0.0.1:47919', unexpected = [], downloads = [], checks = [];
let browser, statusReads = 0, scanPosts = 0, holdStatus = false, releaseStatus;
const candidate = id => PRIVATE_RISK_CANDIDATES.find(item => item.id === id);
const record = (id, labels, state = 'completed') => ({
  candidateId: id, state, attemptedAt: '2026-09-26T10:00:00.000Z',
  risk: state === 'completed' ? {
    address: candidate(id).address, checkedAt: '2026-09-26T10:01:00.000Z', provider: 'intercepta', source: 'live', decision: 'hold',
    reasons: ['FIXTURE_PRIVATE_REASON'], scan: { transport: 'received', requestedNetwork: 'eip155:1', coverage: 'unverified', semantics: 'unverified', httpStatus: 200,
      toxicScore: labels.length ? 50 : 0, traitsCount: labels.length, traitLabels: labels, unknownTraitsCount: 0, additionalFieldsCount: 0 },
  } : null,
});
const records = [record('H1', []), record('H2', ['mixer_transfers']), record('G1', ['sanction_address']), record('G2', [], 'unavailable'), record('L1', [], 'pending'), record('L2', [])];
const status = { contractRevision: PRIVATE_SCAN_REVISION, mode: 'private-scan-only', paymentEnabled: false, ready: true,
  message: 'FIXTURE_PRIVATE_STATUS', maxRequests: 20, usedRequests: records.length, records };
assert.ok(isPrivateScanStatus(status));
const initialStatus = JSON.stringify(status);
const grantStatus = { contractRevision: 'task-grant-v1', context: {taskId:'fixture-task',taskName:'Fixture',agentId:'fixture-agent',agentName:'Fixture',account:null,payTo:null,network:TEST_NETWORK,asset:TEST_USDC,resource:RESOURCE_PATH},
  grant:null,canSave:false,paymentEnabled:false,executionConnected:false,accounting:{state:'not_connected',spentAtomic:null,reservedAtomic:null,availableAtomic:null,walletBalanceAtomic:null} };
await mkdir(output, { recursive: true });
const html = await readFile(new URL('docs/private-risk.html', root), 'utf8');
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
  await page.addInitScript(() => {
    window.__downloadMime = [];
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { window.__downloadMime.push(blob.type); return original(blob); };
  });
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) { unexpected.push(req.url()); await route.abort(); return; }
    if (url.pathname === '/' && req.method() === 'GET') {
      await route.fulfill({ contentType: 'text/html', body: html.replace('<div id="root"></div>', '<div id="root" data-evidence-presentation="offline-fixture"></div>').replace('<body>', '<body><p style="margin:0;padding:8px;background:#fff0b0;color:#111;text-align:center">OFFLINE FIXTURE — saved simulated evidence; no live scan or payment.</p>') }); return;
    }
    if (url.pathname === '/api/private-risk/status' && req.method() === 'GET') {
      statusReads++;
      if (holdStatus) await new Promise(resolve => { releaseStatus = resolve; });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(status) }); return;
    }
    if (url.pathname === '/api/task-grant' && req.method() === 'GET') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(grantStatus) }); return;
    }
    if (url.pathname === '/api/private-risk/scan' && req.method() === 'POST') scanPosts++;
    if (url.pathname !== '/favicon.ico') unexpected.push(req.method() + ' ' + url.pathname);
    await route.abort();
  });
  async function assertFixturePresentation() {
  const evidence=page.locator('.private-risk-evidence');
  await expect(evidence.getByRole('heading',{name:'Synthetic provider evidence',exact:true})).toBeVisible();
  await expect(evidence).toContainText('Not a live Intercepta response');
  await expect(evidence.locator('.private-risk-evidence-head dl')).toContainText('SIMULATED');
  await expect(page.locator('.private-risk-badges')).toContainText('SIMULATED');
  await expect(page.locator('.private-risk-badge.is-live')).toHaveCount(0);
  await expect(page.getByText('LIVE',{exact:true})).toHaveCount(0);
  await expect(page.locator('.private-risk-policy')).not.toContainText('Intercepta reported');
  await expect(page.locator('.private-risk-policy')).not.toContainText('complete live response');
 }
 await page.goto(origin);
 await assertFixturePresentation();
  const audit = page.locator('details').filter({ has: page.locator(':scope > summary', { hasText: /^Technical \/ audit details$/ }) });
  await expect(audit).toHaveCount(1);
  assert.equal(await audit.evaluate(el => el.open), false);
  await audit.locator(':scope > summary').click();
  const snapshotButton = audit.getByRole('button', { name: 'Download project decision snapshot', exact: true });
  const originalButton = audit.getByRole('button', { name: '下载本次评估摘要', exact: true });
  const amount = page.getByLabel('Amount', { exact: true }), recipient = page.getByRole('combobox').first();
  await expect(snapshotButton).toBeEnabled();
  await recipient.selectOption('L2');
  await expect(page.locator('.private-risk-saved-assessment')).toContainText('Using saved simulated assessment');
  await expect(page.locator('.private-risk-saved-assessment')).toContainText('No rescan required');
  await expect(page.locator('.private-risk-primary')).toHaveCount(0);
  await amount.fill('0.001');assert.equal(scanPosts,0);
  await page.screenshot({path:new URL('saved-L2-desktop.png',output).pathname,fullPage:true});
  async function download(button, name) {
    const event = page.waitForEvent('download'); await button.click(); const file = await event;
    assert.equal(await file.failure(), null); assert.equal(file.suggestedFilename(), name);
    const bytes = await readFile(await file.path(), 'utf8');
    assert.ok(!bytes.includes('FIXTURE_PRIVATE_'));
    assert.equal(await page.evaluate(() => window.__downloadMime.at(-1)), 'application/json');
    const value = JSON.parse(bytes); downloads.push({ name, value }); return value;
  }
  async function project(id, value) {
    await recipient.selectOption(id); await amount.fill(value); await expect(snapshotButton).toBeEnabled();
    await assertFixturePresentation();
    const before = Date.now(), result = await download(snapshotButton, `project-decision-${id}.json`);
    assert.deepEqual(Object.keys(result).sort(), ['schemaVersion','exportedAt','intent','policy','originalScanReceipt','execution'].sort());
    assert.equal(result.schemaVersion, 'project-payment-decision-receipt-v1');
    assert.deepEqual(result.intent, { candidateId: id, address: candidate(id).address, network: 'eip155:1', amountUsdc: value });
    assert.deepEqual(result.policy, evaluateLivePaymentPolicy(records.find(item => item.candidateId === id), value));
    assert.deepEqual(result.originalScanReceipt, buildRiskReceipt(status, id));
    assert.equal(new Date(result.exportedAt).toISOString(), result.exportedAt);
    assert.ok(Date.parse(result.exportedAt) >= before && Date.parse(result.exportedAt) <= Date.now());
    assert.notEqual(result.exportedAt, result.originalScanReceipt.localReceivedAt);
    assert.equal(result.execution, 'NOT_CONNECTED'); assert.equal(scanPosts, 0);
    return result;
  }
  const allow = await project('H1','0.005'); assert.equal(allow.policy.decision,'ALLOW');
  const over = await project('H2','0.005'); assert.equal(over.policy.decision,'ALLOW_WITH_LIMIT'); assert.equal(over.policy.amountWithinLimit,false);
  await page.screenshot({ path: new URL('snapshot-desktop.png',output).pathname, fullPage:true });
  const within = await project('H2','0.001'); assert.equal(within.policy.amountWithinLimit,true);
  assert.deepEqual(over.originalScanReceipt, within.originalScanReceipt);
  checks.push('current amount changes policy snapshot but never changes original evidence or triggers a scan');
  const denied = await project('G1','0.005'); assert.equal(denied.policy.decision,'DENY');
  assert.ok(!JSON.stringify(denied).includes(candidate('H2').address));
  const original = await download(originalButton,'risk-receipt-G1.json');
  assert.deepEqual(original, buildRiskReceipt(status,'G1')); assert.equal(original.decision,'hold'); assert.equal(original.policy,undefined); assert.equal(original.amountUsdc,undefined);
  assert.equal((await project('G2','0.005')).policy.decision,'HOLD');
  assert.equal((await project('L1','0.005')).policy.decision,'HOLD');
  await expect(page.locator('.private-risk-saved-assessment')).toContainText('Assessment pending');
  await expect(page.locator('.private-risk-primary')).toHaveCount(0);
  checks.push('candidate switch exports its own decision; pending/unavailable HOLD and original v2 stay distinct');
  await recipient.selectOption('P1'); await expect(snapshotButton).toBeDisabled();
  await recipient.selectOption('H1'); await amount.fill(''); await expect(snapshotButton).toBeDisabled();
  await amount.fill('0.005'); await expect(snapshotButton).toBeEnabled();
  const technical = page.locator('summary').filter({hasText:/^Technical details$/}); await technical.click();
  holdStatus=true; await page.getByRole('button',{name:'Refresh saved records',exact:true}).click();
  await expect(snapshotButton).toBeDisabled(); assert.equal(scanPosts,0);
  await expect(page.locator('.private-risk-saved-assessment')).toContainText('Loading saved assessment');
  await expect(page.locator('.private-risk-primary')).toHaveCount(0);
  assert.equal(typeof releaseStatus,'function'); holdStatus=false; releaseStatus();
  await expect(snapshotButton).toBeEnabled(); await technical.click();
  checks.push('missing/invalid current intent and in-flight refresh cannot download a stale decision');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await project('H2','0.001000');
  await page.screenshot({path:new URL('snapshot-mobile.png',output).pathname,fullPage:true});
  await page.reload(); await audit.locator(':scope > summary').click();
  await expect(snapshotButton).toBeEnabled(); assert.equal(scanPosts,0);
  await assertFixturePresentation();
  assert.equal(JSON.stringify(status),initialStatus); assert.deepEqual(unexpected,[]);
  checks.push('mobile download and reload reuse saved evidence; status/provider timestamps and quota unchanged');
  const receipt={result:'PASS',candidate:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),htmlSha256:createHash('sha256').update(html).digest('hex'),checks,downloads:downloads.length,statusReads,scanPosts,unexpectedNetwork:0,liveScans:0,payments:0,execution:'NOT_CONNECTED'};
  await writeFile(new URL('downloads.json',output),JSON.stringify(downloads,null,2)+'\n');
  await writeFile(new URL('receipt.json',output),JSON.stringify(receipt,null,2)+'\n'); console.log(JSON.stringify(receipt));
} finally { if (releaseStatus) releaseStatus(); if (browser) await browser.close(); }
