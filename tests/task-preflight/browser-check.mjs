// Fully intercepted offline browser check. Real BuyerService + temporary Grant journal,
// synthetic seller transport. No live entry, .env, service listener, or external network.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskGrantStore } from '../../apps/buyer/src/task-grant-store.ts';
import { createTaskPaymentPreflight } from '../../apps/buyer/src/task-payment-preflight.ts';
import { BuyerService } from '../../apps/buyer/src/service.ts';
import { SellerClient } from '../../apps/buyer/src/seller.ts';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../shared/contracts.ts';

const root = new URL('../../', import.meta.url);
const output = new URL('test-results/task-preflight/', root);
await mkdir(output, {recursive:true});
const directory = await mkdtemp(join(tmpdir(), 'preflight-browser-'));
const origin = 'http://127.0.0.1:47918';
const sellerOrigin = 'http://127.0.0.1:4032';
const context = {taskId:'report-purchase-task',taskName:'Synthetic offline report',agentId:'report-buyer-01',agentName:'Synthetic agent',account:'0x1111111111111111111111111111111111111111',payTo:'0x2222222222222222222222222222222222222222',network:TEST_NETWORK,asset:TEST_USDC,resource:RESOURCE_PATH};
let time = new Date('2026-09-27T01:00:00Z');
const path = join(directory, 'grant.json');
const writer = new TaskGrantStore({path,context,now:()=>time});
const reader = new TaskGrantStore({path,context});
let scans=0, checks=0, quotes=0;
const seller = new SellerClient(sellerOrigin, async url => {
  if(url===sellerOrigin+'/health') return Response.json({ready:true});
  assert.equal(url,sellerOrigin+RESOURCE_PATH); quotes++;
  return new Response(null,{status:402,headers:{'PAYMENT-REQUIRED':Buffer.from(JSON.stringify({x402Version:2,resource:{url:sellerOrigin+RESOURCE_PATH},accepts:[{scheme:'exact',network:TEST_NETWORK,asset:TEST_USDC,amount:'1000',payTo:context.payTo,maxTimeoutSeconds:300}]})).toString('base64')}});
});
const checker=createTaskPaymentPreflight(reader,sellerOrigin,()=>time);
const service=new BuyerService({sellerUrl:sellerOrigin,payTo:context.payTo,riskKeyConfigured:false,paymentRequested:false},seller,async()=>{scans++;throw Error('Scan forbidden');},undefined,async quote=>{checks++;return checker(quote);});
const results=[],unexpected=[];
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==origin) {unexpected.push(request.url());await route.abort();return;}
    if(url.pathname.startsWith('/api/')) {
      const body=request.method()==='POST'?request.postDataJSON():undefined;
      let result;
      if(url.pathname==='/api/health') result=await service.health();
      else if(url.pathname==='/api/inspect') result=await service.inspect(body.requestId,body.prompt);
      else if(url.pathname==='/api/pay') {result=await service.pay(body.requestId);results.push(result);}
      else if(url.pathname.startsWith('/api/requests/')) result=service.get(decodeURIComponent(url.pathname.split('/').at(-1)));
      else {unexpected.push(url.pathname);await route.abort();return;}
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});return;
    }
    if(url.pathname==='/') {
      const html=(await readFile(new URL('dist/web/index.html',root),'utf8')).replace('<body>','<body><p style="background:#fff2bb;color:#111;padding:12px">离线验收：模拟报价及测试许可，无真实扫描、钱包或付款。</p>');
      await route.fulfill({status:200,contentType:'text/html',body:html});return;
    }
    if(/^\/assets\/[\w.-]+\.(js|css)$/.test(url.pathname)) {
      const data=await readFile(new URL('dist/web'+url.pathname,root));
      await route.fulfill({status:200,contentType:url.pathname.endsWith('.js')?'text/javascript':'text/css',body:data});return;
    }
    if(url.pathname!=='/favicon.ico')unexpected.push(url.pathname);
    await route.abort();
  });
  async function runCheck(){
    await page.goto(origin);
    // Reload now restores the previous request. Request a new quote explicitly
    // through the existing offer view after the recovered result is confirmed.
    await page.locator('details.payment-details > summary').first().click();
    await page.getByRole('button',{name:'Report offer',exact:true}).click();
    await page.getByRole('button',{name:'Get quote',exact:false}).click();
    await page.getByRole('button',{name:'Agent 受控付款',exact:true}).click();
    await page.getByRole('button',{name:'Check request',exact:false}).click();
  }
  await runCheck();
  await expect(page.getByText('Reason code: grant_missing', {exact:false})).toBeVisible();
  await page.screenshot({path:new URL('missing.png',output).pathname,fullPage:true});
  assert.equal(checks,1);assert.equal(scans,0);
  await writer.save({totalBudgetAtomic:'10000',perTransactionAtomic:'1000',validForMinutes:30,confirmed:true});
  const before=await readFile(path,'utf8');
  await runCheck();
  await expect(page.getByText('Passed · Scope only',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Check request',exact:false})).toBeDisabled();
  await page.getByRole('button',{name:'Refresh status',exact:true}).click();
  await expect(page.getByText('Passed · Scope only',{exact:true})).toBeVisible();
  assert.equal(checks,2);
  await page.getByRole('heading',{name:'Agent 受控付款',exact:true}).click();
  await page.screenshot({path:new URL('passed-desktop.png',output).pathname,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile overflow');
  await page.screenshot({path:new URL('passed-mobile.png',output).pathname,fullPage:true});
  time=new Date('2026-09-27T01:30:00Z');
  await runCheck();
  await expect(page.getByText('Reason code: grant_expired',{exact:false})).toBeVisible();
  assert.equal(checks,3);assert.equal(scans,0);assert.equal(quotes,6);assert.deepEqual(unexpected,[]);
  assert.equal(await readFile(path,'utf8'),before);
  for(const result of results) {assert.equal(result.decision,'hold');assert.equal(result.paymentEnabled,false);assert.deepEqual(result.counters,{sign:0,settle:0});assert.equal(result.execution,undefined);}
  await writeFile(new URL('responses.json',output),JSON.stringify(results,null,2)+'\n');
  const receipt={result:'PASS',scope:'offline browser + actual BuyerService/Grant store; intercepted transport',checks:['missing grant paused','saved grant passed scope only','query does not recheck','button prevents retry','mobile no overflow','expired grant paused','Grant journal unchanged'],permissionChecks:checks,quoteReads:quotes,scans,unexpectedNetwork:unexpected.length,livePayment:false};
  await writeFile(new URL('receipt.json',output),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
} finally {if(browser)await browser.close();await rm(directory,{recursive:true,force:true});}
