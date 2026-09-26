import { Duplex } from 'node:stream';
import { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,it,expect,vi} from 'vitest';
import type {Express} from 'express';
import {TaskGrantStore} from '../../buyer/src/task-grant-store.ts';
import {createPrivateRiskApp} from './app.ts';
import {RESOURCE_PATH,TEST_NETWORK,TEST_USDC} from '../../../shared/contracts.ts';
import {isTaskGrantStatus} from '../../../shared/task-grant.ts';
// Integration uses only temp files, in-memory HTTP and injected scanner. No live entry or network.
const directories:string[]=[];
afterEach(()=>{for(const p of directories.splice(0))rmSync(p,{recursive:true,force:true});vi.unstubAllGlobals();});
const context={taskId:'test-task',taskName:'Test report',agentId:'test-agent',agentName:'Test executor',account:'0x1111111111111111111111111111111111111111',payTo:'0x2222222222222222222222222222222222222222',network:TEST_NETWORK,asset:TEST_USDC,resource:RESOURCE_PATH} as const;
const input={totalBudgetAtomic:'5000',perTransactionAtomic:'1000',validForMinutes:30,confirmed:true};
function setup(){const dir=mkdtempSync(join(tmpdir(),'grant-integrated-'));directories.push(dir);const scanner=vi.fn(async()=>{throw new Error('No scan allowed');});const path=join(dir,'grant.json');const make=()=>createPrivateRiskApp({journalPath:join(dir,'scan.json'),scanner,ready:false,message:'test-only',html:'<title>test</title>',taskGrantStore:new TaskGrantStore({path,context,now:()=>new Date('2026-09-27T00:00:00Z')})});return {path,scanner,make};}
async function inject(app:Express,method:string,url:string,body?:unknown,headers:Record<string,string>={}){
 const chunks:Buffer[]=[];const socket=new Duplex({read(){},write(chunk,_encoding,callback){chunks.push(Buffer.from(chunk));callback();}});
 const request=new IncomingMessage(socket as never);request.complete=true;request.method=method;request.url=url;
 const encoded=body===undefined?null:Buffer.from(JSON.stringify(body));request.headers={host:'127.0.0.1',...(encoded?{'content-type':'application/json','content-length':String(encoded.length)}:{}),...headers};
 const response=new ServerResponse(request);response.assignSocket(socket as never);const finished=new Promise<void>((resolve,reject)=>{response.once('finish',resolve);response.once('error',reject);});app(request,response);if(encoded)request.push(encoded);request.push(null);await finished;
 const [head,payload='']=Buffer.concat(chunks).toString('utf8').split('\r\n\r\n');return {status:Number(/^HTTP\/1\.1 (\d+)/m.exec(head)?.[1]),json:JSON.parse(payload)};
}
describe('same Demo task permission integration',()=>{
 it('saves and recovers the original grant without network, scanner or payment',async()=>{
  const network=vi.fn(()=>{throw new Error('Network forbidden');});vi.stubGlobal('fetch',network);
  const {make,scanner}=setup();const app=make();const initial=await inject(app,'GET','/api/task-grant');expect(initial.status).toBe(200);expect(isTaskGrantStatus(initial.json)).toBe(true);
  const saved=await inject(app,'POST','/api/task-grant',input);expect(saved.status).toBe(200);expect(isTaskGrantStatus(saved.json)).toBe(true);expect(saved.json).toMatchObject({paymentEnabled:false,executionConnected:false,accounting:{state:'not_connected',spentAtomic:null}});
  const restored=await inject(make(),'GET','/api/task-grant');expect(restored.json.grant).toEqual(saved.json.grant);
  const repeated=await inject(make(),'POST','/api/task-grant',input);expect(repeated.json.grant).toEqual(saved.json.grant);
  expect((await inject(make(),'POST','/api/pay',{})).status).toBe(404);expect(scanner).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();
 });
 it('applies the parent origin guard before permission persistence',async()=>{const {make,path,scanner}=setup();const denied=await inject(make(),'POST','/api/task-grant',input,{origin:'https://elsewhere.invalid'});expect(denied.status).toBe(403);expect(existsSync(path)).toBe(false);expect(scanner).not.toHaveBeenCalled();});
 it('rejects an oversized permission body and cannot inject payment capability',async()=>{const {make,scanner}=setup();expect((await inject(make(),'POST','/api/task-grant',{...input,extra:'x'.repeat(5000)})).status).toBe(413);expect((await inject(make(),'POST','/api/task-grant',{...input,paymentEnabled:true})).status).toBe(400);expect(scanner).not.toHaveBeenCalled();});
});
