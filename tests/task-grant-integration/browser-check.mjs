// Offline UI integration: every browser request is intercepted. No service listens,
// no live entry is imported, no environment file is read and no risk scan runs.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskGrantStore } from '../../apps/buyer/src/task-grant-store.ts';
import { RESOURCE_PATH, TEST_NETWORK, TEST_USDC } from '../../shared/contracts.ts';

const origin = 'http://127.0.0.1:47919';
const directory = await mkdtemp(join(tmpdir(), 'grant-browser-test-'));
const context = {taskId:'offline-test',taskName:'离线验收用报告',agentId:'test-agent',agentName:'离线测试执行器',account:'0x1111111111111111111111111111111111111111',payTo:'0x2222222222222222222222222222222222222222',network:TEST_NETWORK,asset:TEST_USDC,resource:RESOURCE_PATH};
let journalPath = join(directory, 'grant.json');
let store = new TaskGrantStore({path:journalPath,context});
const html = (await readFile(new URL('../../docs/private-risk.html', import.meta.url), 'utf8')).replace('<body>', '<body><p style="padding:12px;background:#fff2bb;color:#111">离线自动化验收：测试账户及预算；没有调用真实风险 API、钱包或付款。</p>');
let posts = 0, scans = 0, uncertain = false, release;
const held = new Promise(resolve => { release = resolve; });
const unexpected = [];
let browser;
try {
  browser = await chromium.launch({channel:'chrome',headless:true});
  const page = await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await page.route('**/*', async route => {
    const request=route.request(), url=new URL(request.url());
    if(url.origin!==origin) { unexpected.push(request.url()); await route.abort(); return; }
    const json = body => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname==='/' && request.method()==='GET') { await route.fulfill({status:200,contentType:'text/html',body:html}); return; }
    if(url.pathname==='/api/private-risk/status' && request.method()==='GET') {
      await json({contractRevision:'private-risk-scan-v1',mode:'private-scan-only',paymentEnabled:false,ready:false,message:'离线验收：不调用风险 API。',maxRequests:3,usedRequests:0,records:[]}); return;
    }
    if(url.pathname==='/api/task-grant') {
      if(request.method()==='GET') { await json(await store.status()); return; }
      if(request.method()==='POST') {
        posts++; const result=await store.save(request.postDataJSON());
        if(uncertain) { await route.abort('failed'); return; }
        await held; await json(result); return;
      }
    }
    if(url.pathname.includes('/scan')) scans++;
    if(url.pathname!=='/favicon.ico') unexpected.push(`${request.method()} ${url.pathname}`);
    await route.abort();
  });
  await page.goto(origin);
  const total=page.getByLabel('USDC 总预算'), single=page.getByLabel('USDC 单笔上限');
  await expect(total).toBeEnabled();
  await total.fill('0.005'); await single.fill('0.006');
  await page.getByRole('button',{name:'保存任务许可',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'单笔上限不能超过总预算'})).toBeVisible();
  assert.equal(posts,0);
  await single.fill('0.001');
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'保存任务许可',exact:true}).click();
  await expect(page.getByRole('button',{name:'正在保存…',exact:true})).toBeDisabled();
  await expect(page.getByRole('heading',{name:'已保存的任务许可',exact:true})).toHaveCount(0);
  release();
  await expect(page.getByRole('heading',{name:'已保存的任务许可',exact:true})).toBeVisible();
  const first=(await store.status()).grant;
  assert.equal(posts,1);
  await page.screenshot({path:new URL('./browser-desktop.png',import.meta.url).pathname,fullPage:true});
  store=new TaskGrantStore({path:journalPath,context});
  await page.reload();
  await expect(page.getByText(`${first.grantId} · v1`,{exact:true})).toBeVisible();
  assert.equal(posts,1);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile overflow');
  await page.screenshot({path:new URL('./browser-mobile.png',import.meta.url).pathname,fullPage:true});

  // Simulate a write that succeeded while its response was lost. Query must
  // recover the persisted record without an automatic second POST.
  journalPath=join(directory,'uncertain.json'); store=new TaskGrantStore({path:journalPath,context}); uncertain=true;
  await page.reload(); await expect(total).toBeEnabled();
  await total.fill('0.005'); await single.fill('0.001'); await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'保存任务许可',exact:true}).click();
  await expect(page.getByText('保存结果未确认，请查询已有许可；不会自动重复保存。',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'已保存的任务许可',exact:true})).toHaveCount(0);
  assert.equal(posts,2);
  await page.getByRole('button',{name:'查询已有许可',exact:true}).click();
  await expect(page.getByRole('heading',{name:'已保存的任务许可',exact:true})).toBeVisible();
  assert.equal(posts,2); assert.equal(scans,0); assert.deepEqual(unexpected,[]);
  console.log(JSON.stringify({result:'PASS',scope:'offline browser UI + real temporary Grant store',checks:['invalid budget blocked','no optimistic save','reload preserves grant','mobile no horizontal overflow','lost response recovered with GET only'],grantPosts:posts,riskCalls:scans,unexpectedRequests:unexpected.length,livePayment:false},null,2));
} finally {
  if(browser) await browser.close();
  await rm(directory,{recursive:true,force:true});
}
