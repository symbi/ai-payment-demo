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
const output = new URL('test-results/request-recovery/', root);
await mkdir(output, {recursive:true});
const directory = await mkdtemp(join(tmpdir(), 'recovery-browser-'));
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
const unexpected=[], evidence=[];
const key='buyer-request-session-v1';
let inspectPosts=0, payPosts=0, reads=0, lostPay=false, restarted=false;
let browser;
try {
  browser=await chromium.launch({channel:'chrome',headless:true});
  async function newPage(fault) {
    const ctx=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
    if(fault) await ctx.addInitScript(({key,fault})=>{
      if(fault==='corrupt') localStorage.setItem(key,'{"version":1,"requestId":"bad"}');
      if(fault==='read') Object.defineProperty(Storage.prototype,'getItem',{value(){throw Error('storage unavailable');}});
      if(fault==='write') Object.defineProperty(Storage.prototype,'setItem',{value(){throw Error('storage unavailable');}});
      if(fault==='getter') Object.defineProperty(window,'localStorage',{get(){throw Error('storage unavailable');}});
    },{key,fault});
    const page=await ctx.newPage();
    await page.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin){unexpected.push(req.url());await route.abort();return;}
      if(url.pathname.startsWith('/api/')) {
        const body=req.method()==='POST'?req.postDataJSON():undefined;
        let result;
        if(url.pathname==='/api/health') result=await service.health();
        else if(url.pathname==='/api/inspect'){inspectPosts++;result=await service.inspect(body.requestId,body.prompt);}
        else if(url.pathname==='/api/pay'){
          payPosts++;result=await service.pay(body.requestId);
          if(lostPay){lostPay=false;await route.abort();return;}
        }
        else if(url.pathname.startsWith('/api/requests/')){
          reads++;
          if(restarted){await route.fulfill({status:404,contentType:'application/json',body:'{"error":"Not found"}'});return;}
          result=service.get(decodeURIComponent(url.pathname.split('/').at(-1)));
        }else{unexpected.push(url.pathname);await route.abort();return;}
        await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});return;
      }
      if(url.pathname==='/'){
        const html=(await readFile(new URL('dist/web/index.html',root),'utf8')).replace('<body>','<body><p style="background:#fff2bb;color:#111;padding:12px">离线恢复验收：模拟报价、测试许可；无真实扫描或付款。</p>');
        await route.fulfill({status:200,contentType:'text/html',body:html});return;
      }
      if(/^\/assets\/[\w.-]+\.(js|css)$/.test(url.pathname)){
        await route.fulfill({status:200,contentType:url.pathname.endsWith('.js')?'text/javascript':'text/css',body:await readFile(new URL('dist/web'+url.pathname,root))});return;
      }
      if(url.pathname!=='/favicon.ico')unexpected.push(url.pathname);
      await route.abort();
    });
    return page;
  }
  const quote=page=>page.getByRole('button',{name:'Get quote',exact:false});
  const check=page=>page.getByRole('button',{name:'Check request',exact:false});
  async function offer(page){
    const details=page.locator('details.payment-details').first();
    if(!(await details.evaluate(el=>el.open))) await details.locator(':scope > summary').click();
    await page.getByRole('button',{name:'Report offer',exact:true}).click();
  }
  const payment=page=>page.getByRole('button',{name:'Agent 受控付款',exact:true}).click();
  async function assertBlocked(page){
    const existing=check(page);
    if(await existing.count())await expect(existing).toBeDisabled();
    await offer(page);await expect(quote(page)).toBeDisabled();await payment(page);
  }
  const session=page=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
  await writer.save({totalBudgetAtomic:'10000',perTransactionAtomic:'1000',validForMinutes:30,confirmed:true});
  const journal=await readFile(path,'utf8');
  const page=await newPage();
  await page.goto(origin);await quote(page).click();await expect(check(page)).toBeEnabled();
  const first=await session(page);
  assert.deepEqual(Object.keys(first).sort(),['checkAttempted','requestId','version']);
  assert.equal(first.checkAttempted,false);
  await page.reload();await expect(check(page)).toBeEnabled();
  assert.equal((await session(page)).requestId,first.requestId);assert.equal(inspectPosts,1);assert.ok(reads>0);
  evidence.push('quote reload restores original ID via GET only');
  await check(page).click();await expect(page.getByText('Passed · Scope only',{exact:true})).toBeVisible();
  assert.equal((await session(page)).checkAttempted,true);
  await page.reload();await expect(page.getByText('Passed · Scope only',{exact:true})).toBeVisible();await expect(check(page)).toBeDisabled();
  assert.equal(payPosts,1);assert.equal(inspectPosts,1);
  await page.screenshot({path:new URL('recovered.png',output).pathname,fullPage:true});
  evidence.push('checked request reload never repeats POST');
  // Explicit next quote is allowed only after the prior result was confirmed.
  await offer(page);await quote(page).click();await payment(page);await expect(check(page)).toBeEnabled();
  const second=await session(page);assert.notEqual(second.requestId,first.requestId);
  lostPay=true;await check(page).click();
  await assertBlocked(page);
  await page.reload();await expect(page.getByText('Passed · Scope only',{exact:true})).toBeVisible();
  assert.equal((await session(page)).requestId,second.requestId);assert.equal(payPosts,2);assert.equal(inspectPosts,2);
  evidence.push('lost response reload queries original completed result without retry');
  restarted=true;await page.reload();
  await expect(page.getByRole('button',{name:'Refresh status',exact:true})).toBeEnabled();
  await assertBlocked(page);
  assert.equal((await session(page)).requestId,second.requestId);
  await page.screenshot({path:new URL('backend-unavailable.png',output).pathname,fullPage:true});
  evidence.push('backend restart 404 keeps original identity and blocks new POST');
  restarted=false;
  for(const fault of ['corrupt','read','getter','write']){
    const p=await newPage(fault);await p.goto(origin);
    await expect(p.getByRole('heading',{name:'Agent 受控付款',exact:true})).toBeVisible();
    if(fault==='write'){await quote(p).click();}
    await assertBlocked(p);
    assert.equal(inspectPosts,2);assert.equal(payPosts,2);
    evidence.push(fault+' storage fault blocks all POST');
    await p.context().close();
  }
  assert.equal(scans,0);assert.deepEqual(unexpected,[]);assert.equal(await readFile(path,'utf8'),journal);
  const receipt={result:'PASS',scope:'offline intercepted browser; real BuyerService and temporary Grant journal',checks:evidence,inspectPosts,payPosts,queryReads:reads,scans,unexpectedNetwork:0,paymentEnabled:false};
  await writeFile(new URL('receipt.json',output),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{if(browser)await browser.close();await rm(directory,{recursive:true,force:true});}
