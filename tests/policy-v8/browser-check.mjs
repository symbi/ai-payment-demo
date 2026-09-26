// Offline fixture-only UI acceptance. Every browser request is intercepted.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../shared/contracts.ts';
import { isTaskGrantStatus } from '../../shared/task-grant.ts';
import { PRIVATE_RISK_CANDIDATES, PRIVATE_SCAN_REVISION } from '../../shared/private-risk.ts';
const root=new URL('../../',import.meta.url), output=new URL('test-results/policy-v8/',root);
const origin='http://127.0.0.1:47919';
await mkdir(output,{recursive:true});
const records=[], attempted=[], unexpected=[], checks=[];
let browser, statusReads=0, grantReads=0, showSavedGrant=false;
const context={taskId:'fixture-task',taskName:'Offline fixture',agentId:'fixture-agent',agentName:'Fixture agent',account:'0x1111111111111111111111111111111111111111',payTo:'0x2222222222222222222222222222222222222222',network:TEST_NETWORK,asset:TEST_USDC,resource:RESOURCE_PATH};
const now=Date.now();
const savedGrant={totalBudgetAtomic:'25000',perTransactionAtomic:'3000',validForMinutes:30,confirmed:true,grantId:'fixture-grant',version:1,taskId:context.taskId,agentId:context.agentId,account:context.account,payTo:context.payTo,network:context.network,asset:context.asset,resource:context.resource,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+1800000).toISOString()};
const grantStatus=()=>({contractRevision:'task-grant-v1',context,grant:showSavedGrant?savedGrant:null,canSave:!showSavedGrant,paymentEnabled:false,executionConnected:false,accounting:{state:'not_connected',spentAtomic:null,reservedAtomic:null,availableAtomic:null,walletBalanceAtomic:null}});
assert.ok(isTaskGrantStatus(grantStatus()));
const fixtures={H1:{score:0,labels:[]},H2:{score:50,labels:['mixer_transfers']},G1:{score:50,labels:['sanction_address']},G2:{unavailable:true},L1:{score:0,labels:[],unknown:1}};
function record(id){
 const f=fixtures[id],address=PRIVATE_RISK_CANDIDATES.find(c=>c.id===id).address;
 const scan={transport:f.unavailable?'unavailable':'received',requestedNetwork:'eip155:1',coverage:'unverified',semantics:'unverified',httpStatus:f.unavailable?404:200,diagnosticCode:f.unavailable?'http-error':'observed',...(f.unavailable?{}:{toxicScore:f.score,traitsCount:f.labels.length+(f.unknown??0),traitLabels:f.labels,unknownTraitsCount:f.unknown??0,additionalFieldsCount:0})};
 return {candidateId:id,state:f.unavailable?'unavailable':'completed',attemptedAt:'2026-09-27T00:00:00Z',risk:{address,checkedAt:'2026-09-27T00:00:00Z',provider:'intercepta',source:f.unavailable?'unavailable':'live',decision:'hold',reasons:[],scan}};
}
const status=()=>({contractRevision:PRIVATE_SCAN_REVISION,mode:'private-scan-only',paymentEnabled:false,ready:true,message:'',maxRequests:20,usedRequests:records.length,records});
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==origin){unexpected.push(req.url());await route.abort();return;}
  if(url.pathname==='/'){
   const html=(await readFile(new URL('docs/private-risk.html',root),'utf8')).replace('<body>','<body><p style="margin:0;padding:8px;background:#fff0b0;color:#111;text-align:center">OFFLINE FIXTURE — simulated provider evidence. No live scan or payment.</p>');
   await route.fulfill({contentType:'text/html',body:html});return;
  }
  if(url.pathname==='/api/private-risk/status' && req.method()==='GET'){statusReads++;await route.fulfill({contentType:'application/json',body:JSON.stringify(status())});return;}
  if(url.pathname==='/api/private-risk/scan' && req.method()==='POST'){
   const body=req.postDataJSON();assert.deepEqual(Object.keys(body),['candidateId']);assert.ok(fixtures[body.candidateId]);assert.ok(!attempted.includes(body.candidateId));
   attempted.push(body.candidateId);records.push(record(body.candidateId));await route.fulfill({contentType:'application/json',body:JSON.stringify(status())});return;
  }
  if(url.pathname==='/api/task-grant' && req.method()==='GET'){
   grantReads++;assert.ok(isTaskGrantStatus(grantStatus()));await route.fulfill({contentType:'application/json',body:JSON.stringify(grantStatus())});return;
  }
  if(url.pathname!=='/favicon.ico')unexpected.push(req.method()+' '+url.pathname);
  await route.abort();
 });
 await page.goto(origin);
 await expect(page.getByRole('heading',{name:'Agent Payment Guard',exact:true})).toBeVisible();
 const assess=page.getByRole('button',{name:'Assess Payment',exact:true});
 const amount=page.getByLabel(/Amount/).first();
 const recipient=page.getByRole('combobox').first();
 await expect(amount).toHaveValue('0.005');
 await expect(assess).toBeEnabled();assert.equal(attempted.length,0);
 const technical=page.locator('details').filter({has:page.locator(':scope > summary', {hasText:/Technical/})}).first();
 const advanced=page.locator('details').filter({has:page.locator(':scope > summary', {hasText:/Advanced spending policy/})}).first();
 await expect(technical).toHaveCount(1);await expect(advanced).toHaveCount(1);
 assert.equal(await technical.evaluate(el=>el.open),false);assert.equal(await advanced.evaluate(el=>el.open),false);
 assert.equal(await advanced.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(14, 29, 23)','private theme must override legacy disclosure styling');
 const focusOutlines=[];
 async function keyboardFocus(summary){
  for(let step=0;step<30;step++){
   await page.keyboard.press('Tab');
   if(await summary.evaluate(el=>el===document.activeElement))return;
  }
  assert.fail('keyboard navigation did not reach '+await summary.innerText());
 }
 async function visibleOutline(summary){
  await expect(summary).toBeFocused();
  const style=await summary.evaluate(el=>{const s=getComputedStyle(el);return {name:el.textContent,style:s.outlineStyle,width:s.outlineWidth,color:s.outlineColor};});
  focusOutlines.push(style);
 }
 const focusScanCount=attempted.length, advancedSummary=advanced.locator(':scope > summary');
 await keyboardFocus(advancedSummary);await visibleOutline(advancedSummary);
 await page.keyboard.press('Enter');
 const manageSummary=page.locator('summary').filter({hasText:/^Manage policy$/});
 await keyboardFocus(manageSummary);await visibleOutline(manageSummary);
 assert.equal(attempted.length,focusScanCount,'keyboard disclosures must not scan');
 await writeFile(new URL('focus-receipt.json',output),JSON.stringify(focusOutlines,null,2)+'\n');
 for(const outline of focusOutlines){
  assert.notEqual(outline.style,'none',outline.name+' focus outline missing');
  assert.ok(parseFloat(outline.width)>0,outline.name+' focus outline has no width');
  assert.ok(outline.color!=='transparent'&&!/rgba\([^)]*,\s*0\)$/.test(outline.color),outline.name+' focus outline is transparent');
 }
 await keyboardFocus(advancedSummary);await page.keyboard.press('Enter');
 checks.push('keyboard focus visible for Advanced and Manage disclosures; no scan');
 await expect(page.getByText('LIVE',{exact:true})).toHaveCount(0);
 checks.push('English hero, intent default, truthful unassessed state; disclosures collapsed');
 async function outcome(id,decision){
  await recipient.selectOption(id);const count=attempted.length;
  await expect(page.locator('.private-risk-policy').getByText('HOLD',{exact:true}).first()).toBeVisible();
  assert.equal(attempted.length,count,'selection must not scan');
  await assess.click();await expect(page.locator('.private-risk-policy').getByText(decision,{exact:true}).first()).toBeVisible();
  await expect(page.getByText(/NOT.CONNECTED|Not connected/).first()).toBeVisible();
  assert.equal(attempted.length,count+1);await expect(assess).toBeDisabled();
 }
 await outcome('H1','ALLOW');
 await amount.fill('');await expect(page.locator('.private-risk-policy').getByText('HOLD',{exact:true}).first()).toBeVisible();
 await amount.fill('0.005');await expect(page.locator('.private-risk-policy').getByText('ALLOW',{exact:true}).first()).toBeVisible();assert.equal(attempted.length,1);
 checks.push('empty live evidence allows in policy only; invalid amount removes allow without POST');
 await outcome('H2','ALLOW WITH LIMIT');
 await expect(page.getByText(/0\.001/).first()).toBeVisible();
 await page.screenshot({path:new URL('limited-desktop.png',output).pathname,fullPage:true});
 await amount.fill('0.001');await expect(page.locator('.private-risk-policy').getByText('ALLOW WITH LIMIT',{exact:true}).first()).toBeVisible();assert.equal(attempted.length,2);
 await outcome('G1','DENY');
 await expect(page.getByText('sanction_address',{exact:true}).first()).toBeVisible();
 checks.push('same score50 mixer limits and sanction denies; cap changes never execute');
 await page.screenshot({path:new URL('denied-desktop.png',output).pathname,fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile horizontal overflow');
 await page.screenshot({path:new URL('denied-mobile.png',output).pathname,fullPage:true});
 await outcome('G2','HOLD');await outcome('L1','HOLD');
 checks.push('404 and unknown evidence hold; desktop/mobile no overflow');
 await page.reload();await expect(page.getByRole('heading',{name:'Agent Payment Guard',exact:true})).toBeVisible();
 await expect(page.locator('.private-risk-policy').getByText('ALLOW',{exact:true}).first()).toBeVisible();assert.equal(attempted.length,5);
 checks.push('refresh reads saved evidence without repeat assessment');
 showSavedGrant=true;await page.reload();
 await advanced.locator(':scope > summary').click();
 await expect(page.getByText(/0\.025 USDC/).first()).toBeVisible();
 await expect(page.getByText(/0\.003 USDC/).first()).toBeVisible();
 assert.equal(attempted.length,5);
 checks.push('saved grant shows actual fixture amounts; opening advanced never saves or scans');
 assert.deepEqual(unexpected,[]);
 const receipt={result:'PASS',checks,manualFixtureAssessments:attempted.length,attempted,statusReads,grantReads,unexpectedNetwork:0,liveScans:0,payments:0,execution:'NOT_CONNECTED'};
 await writeFile(new URL('receipt.json',output),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{if(browser)await browser.close();}
