/** Display-only payment check. Every API is intercepted; provider calls are forbidden. */
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { TEST_USDC } from '../../../shared/contracts.ts';
const vite=await createServer({configFile:'apps/web/vite.config.ts',server:{host:'127.0.0.1',port:0}});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try {
 await vite.listen();const origin=`http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const calls:string[]=[];const errors:string[]=[];let id='';let failQuery=false;let huge=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();if(!u.pathname.startsWith('/api/'))return route.continue();calls.push(u.pathname);
 if(u.pathname==='/api/health')return route.fulfill({json:{resourcePath:'/api/contract-insights',buyer:{connected:true},seller:{connected:true,ready:false,message:'Fixture'},configuration:{payToConfigured:true,interceptaKeyConfigured:true},paymentEnabled:false}});
 if(u.pathname==='/api/inspect'){id=route.request().postDataJSON().requestId;return route.fulfill({json:{requestId:id,status:huge?'denied':'held',decision:huge?'deny':'hold',reasons:['Unverified'],terms:{scheme:'exact',amount:huge?'9'.repeat(78):'1000',asset:TEST_USDC,payTo:huge?'invalid-recipient-'.padEnd(128,'x'):'0x2222222222222222222222222222222222222222',network:'eip155:84532'},risk:huge?undefined:{source:'live',decision:'hold',reasons:['Unverified'],address:'0x2222222222222222222222222222222222222222',provider:'intercepta',checkedAt:'2026-09-26T00:00:00Z',scan:{transport:'received',toxicScore:0,traitsCount:0,requestedNetwork:'eip155:84532',coverage:'unverified',semantics:'unverified'}},counters:{sign:0,settle:0},events:[],aiMode:'not_configured',paymentEnabled:false}});}
 if(u.pathname.startsWith('/api/requests/')&&failQuery)return route.abort('connectionreset');throw new Error(`Forbidden API ${u.pathname}`);});
 await page.goto(origin);await expect(page.getByRole('heading',{name:'Intercepta',exact:true})).toBeVisible();
 await expect(page.getByRole('navigation')).toHaveCount(0);await expect(page.locator('.check-source').getByText('Offline example · Synthetic evidence',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Not checked',exact:true})).toBeVisible();
 await expect(page.getByLabel('Evidence view')).not.toBeVisible();
 await expect(page.locator('.recipient-line')).toContainText('Recipient');
 await page.getByRole('button',{name:'Preview check'}).click();await expect(page.getByRole('heading',{name:'Block',exact:true})).toBeVisible();
 const choose=async(value:string)=>{await page.locator('.demo-examples').evaluate(e=>{(e as HTMLDetailsElement).open=true;});await page.getByLabel('Evidence view').selectOption(value);await page.locator('.demo-examples>summary').click();};
 const start=calls.length;
 for(const [value,decision] of [['block','Block'],['pause','Pause'],['continue','Continue']]){
 await choose(value);await expect(page.getByRole('heading',{name:'Not checked',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Preview check'}).click();await expect(page.getByRole('heading',{name:decision,exact:true})).toBeVisible();
 await expect(page.getByText('Decision only · No payment',{exact:true})).toBeVisible();
 }
 assert.equal(calls.length,start,'offline switches/checks must make zero API requests');
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:950});assert.equal(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth),true);await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();scrollTo(0,0);});await page.screenshot({path:`/private/tmp/intercepta-simple-${width}.png`,fullPage:true});}
 await choose('current');await expect(page.getByRole('button',{name:'Check risk'})).toBeDisabled();
 await page.locator('.payment-details>summary').click();await page.getByRole('button',{name:'Report offer',exact:true}).click();await page.getByRole('button',{name:'Get quote'}).click();
 await expect(page.getByRole('heading',{name:'Scan received',exact:true})).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'Intercepta',exact:true}).click();await choose('current');
 const before=calls.length;await page.getByRole('button',{name:'Check risk'}).click();await expect(page.getByRole('heading',{name:'Pause',exact:true})).toBeVisible();
 await expect(page.locator('.check-source').getByText('Current request · Live provider response',{exact:true})).toBeVisible();
 await page.locator('.payment-details>summary').click();await expect(page.locator('.payment-details').getByText('0 · uninterpreted',{exact:true})).toBeVisible();assert.equal(calls.length,before);
 await page.getByRole('button',{name:'Saved request',exact:true}).click();failQuery=true;await page.getByRole('button',{name:'Query request'}).click();
 await expect(page.getByRole('heading',{name:'Status unknown',exact:true})).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'Intercepta',exact:true}).click();await choose('current');await page.getByRole('button',{name:'Check risk'}).click();
 await expect(page.getByRole('heading',{name:'Pause',exact:true})).toBeVisible();await expect(page.locator('.payment-status')).toContainText('Unconfirmed');
 huge=true;await page.reload();await page.locator('.payment-details>summary').click();await page.getByRole('button',{name:'Report offer',exact:true}).click();await page.getByRole('button',{name:'Get quote'}).click();await expect(page.getByRole('heading',{name:'Declined',exact:true})).toBeVisible();await page.getByRole('navigation').getByRole('button',{name:'Intercepta',exact:true}).click();await choose('current');await page.getByRole('button',{name:'Check risk'}).click();await expect(page.getByRole('heading',{name:'Block',exact:true})).toBeVisible();
 for(const width of [390,320]){await page.setViewportSize({width,height:950});assert.equal(await page.locator('html').evaluate(e=>e.scrollWidth<=innerWidth),true,'long current quote must not overflow');assert.equal(await page.locator('.single-payment-card').evaluate(e=>e.scrollWidth<=e.clientWidth),true);}
 assert.equal(calls.filter(p=>p==='/api/pay').length,0);assert.equal(calls.filter(p=>p==='/api/inspect').length,2);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',checks:['collapsed scenarios/default preview/recipient label','single order/action/no primary nav','offline provenance persists','switch resets checked state','continue/block/pause examples','no API on display switches/check','empty real mode disabled','actual quote/zero-score stays paused','unknown request remains paused/unconfirmed','original request preserved','1440/390/320 no overflow','no pay/provider calls','78-digit denied amount and 128-char invalid recipient wrap', 'no runtime errors'],evidence:'isolated fixtures only'}));
}finally{await browser?.close();await vite.close();}
