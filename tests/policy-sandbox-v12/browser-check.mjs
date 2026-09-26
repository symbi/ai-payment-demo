// Explicitly intercepted fixtures; no provider, wallet or payment execution.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PRIVATE_RISK_CANDIDATES, PRIVATE_SCAN_REVISION } from '../../shared/private-risk.ts';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../shared/contracts.ts';
import { evaluateSyntheticPaymentPolicy, evaluateLivePaymentPolicy } from '../../shared/live-payment-policy.ts';
import { POLICY_SCENARIOS } from '../../shared/policy-scenarios.ts';
const root=new URL('../../',import.meta.url), output=new URL('test-results/policy-sandbox-v12/',root);
const origin='http://127.0.0.1:47920', unexpected=[], requests=[];
const candidate=PRIVATE_RISK_CANDIDATES.find(c=>c.id==='H1');
const record={candidateId:'H1',state:'completed',attemptedAt:'2026-09-26T10:00:00.000Z',risk:{address:candidate.address,checkedAt:'2026-09-26T10:01:00.000Z',provider:'intercepta',source:'live',decision:'hold',reasons:[],scan:{transport:'received',httpStatus:200,toxicScore:0,traitsCount:0,traitLabels:[],unknownTraitsCount:0,additionalFieldsCount:0,requestedNetwork:'eip155:1',coverage:'unverified',semantics:'unverified'}}};
const status={contractRevision:PRIVATE_SCAN_REVISION,mode:'private-scan-only',paymentEnabled:false,ready:true,message:'Offline fixture',maxRequests:20,usedRequests:1,records:[record]};
const statusBefore=JSON.stringify(status);
const grant={contractRevision:'task-grant-v1',context:{taskId:'fixture',taskName:'Fixture',agentId:'fixture',agentName:'Fixture',account:null,payTo:null,network:TEST_NETWORK,asset:TEST_USDC,resource:RESOURCE_PATH},grant:null,canSave:false,paymentEnabled:false,executionConnected:false,accounting:{state:'not_connected',spentAtomic:null,reservedAtomic:null,availableAtomic:null,walletBalanceAtomic:null}};
await mkdir(output,{recursive:true}); const html=await readFile(new URL('docs/private-risk.html',root),'utf8');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:true});
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());requests.push({method:req.method(),path:url.pathname});
  if(url.origin===origin && req.method()==='GET') {
   if(url.pathname==='/') return route.fulfill({contentType:'text/html',body:html.replace('<body>','<body><p style="padding:8px;background:#fff0b0;color:#111">OFFLINE BROWSER FIXTURE — no live provider or payment.</p>')});
   if(url.pathname==='/api/private-risk/status') return route.fulfill({json:status});
   if(url.pathname==='/api/task-grant') return route.fulfill({json:grant});
   if(url.pathname==='/favicon.ico') return route.abort();
  }
  unexpected.push(req.method()+' '+req.url());await route.abort();
 });
 await page.goto(origin);
 const heading=page.getByRole('heading',{name:'Policy Sandbox — Synthetic Scenarios',exact:true});
 await expect(heading).toBeVisible(); const sandbox=heading.locator('xpath=ancestor::section[1]');
 await expect(sandbox).toContainText('SIMULATED');await expect(sandbox).toContainText('Synthetic policy scenario');
 await expect(sandbox).toContainText('Not a live Intercepta response');await expect(sandbox).toContainText('NOT CONNECTED');
 for(const decision of ['ALLOW_WITH_LIMIT','DENY','HOLD']) await expect(sandbox).toContainText(decision);
 assert.equal(await sandbox.locator('input,select,button,a').count(),0);
 assert.equal(await sandbox.locator('.policy-sandbox-grid').evaluate(el=>getComputedStyle(el).display),'grid');
 const desktopBoxes=await sandbox.locator('.policy-sandbox-card').evaluateAll(els=>els.map(el=>({top:el.getBoundingClientRect().top,left:el.getBoundingClientRect().left})));
 assert.equal(desktopBoxes.length,3);assert.equal(desktopBoxes[0].top,desktopBoxes[1].top);assert.equal(desktopBoxes[1].top,desktopBoxes[2].top);assert.ok(desktopBoxes[0].left<desktopBoxes[1].left && desktopBoxes[1].left<desktopBoxes[2].left);
 const text=await sandbox.innerText();assert.ok(!/0x[0-9a-f]{40}/i.test(text));assert.ok(!/HTTP\s*200|source\s*:\s*live/i.test(text));
 assert.equal(POLICY_SCENARIOS.length,3);
 assert.deepEqual(POLICY_SCENARIOS.map(s=>evaluateSyntheticPaymentPolicy(s.input,s.amountUsdc).decision),['ALLOW_WITH_LIMIT','DENY','HOLD']);
 for(const s of POLICY_SCENARIOS) assert.equal(evaluateLivePaymentPolicy(s.input,s.amountUsdc).reasonCode,'evidence_unavailable');
 const amount=page.getByLabel('Amount',{exact:true}),recipient=page.getByRole('combobox').first();
 await expect(recipient).toHaveValue('H1');await expect(amount).toHaveValue('0.005');
 const requestCount=requests.length;await amount.fill('0.002');assert.equal(await sandbox.innerText(),text);
 assert.equal(requests.length,requestCount);await expect(recipient).toHaveValue('H1');
 const audit=page.locator('details').filter({has:page.locator(':scope > summary',{hasText:/^Technical \/ audit details$/})});
 await audit.locator(':scope > summary').click();
 const downloadEvent=page.waitForEvent('download');await audit.getByRole('button',{name:'Download project decision snapshot',exact:true}).click();
 const download=await downloadEvent,bytes=await readFile(await download.path(),'utf8'),receipt=JSON.parse(bytes);
 assert.equal(receipt.intent.candidateId,'H1');assert.equal(receipt.intent.amountUsdc,'0.002');assert.equal(receipt.policy.decision,'ALLOW');
 assert.ok(!/synthetic-mixer-50|synthetic-sanction-50|synthetic-unknown-50|SIMULATED/.test(bytes));
 await page.screenshot({path:new URL('desktop.png',output).pathname,fullPage:true});
 await sandbox.screenshot({path:new URL('sandbox-desktop.png',output).pathname});
 await page.setViewportSize({width:390,height:844});await expect(heading).toBeVisible();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 const mobileBoxes=await sandbox.locator('.policy-sandbox-card').evaluateAll(els=>els.map(el=>({top:el.getBoundingClientRect().top,left:el.getBoundingClientRect().left})));
 assert.ok(mobileBoxes[0].top<mobileBoxes[1].top && mobileBoxes[1].top<mobileBoxes[2].top);assert.equal(mobileBoxes[0].left,mobileBoxes[2].left);
 await page.screenshot({path:new URL('mobile.png',output).pathname,fullPage:true});
 await sandbox.screenshot({path:new URL('sandbox-mobile.png',output).pathname});
 assert.equal(JSON.stringify(status),statusBefore);assert.equal(unexpected.length,0);assert.equal(requests.filter(r=>r.method!=='GET').length,0);
 const result={result:'PASS',candidate:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),htmlSha256:createHash('sha256').update(html).digest('hex'),scenarios:3,checks:['same score with different traits yields limited/deny/hold through shared engine','explicit synthetic section separated from live intent and receipt','desktop/mobile no overflow and no scenario controls','render and amount editing produce zero API additions, POSTs or external requests'],unexpectedNetwork:0,scanPosts:0,liveScans:0,payments:0,execution:'NOT_CONNECTED'};
 await writeFile(new URL('receipt.json',output),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
} finally {await browser.close();}
