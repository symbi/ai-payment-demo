import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {checkDemo,formatCli} from './check-demo.mjs';
const dirs:string[]=[];afterEach(()=>{for(const p of dirs.splice(0))rmSync(p,{recursive:true,force:true});vi.unstubAllGlobals();});
const readyEnv={PRIVATE_RISK_MACHINE:'personal',PRIVATE_RISK_FREE_QUOTA_CONFIRMED:'true',PRIVATE_RISK_PRIOR_REQUESTS:'0',INTERCEPTA_API_KEY:'injected-test-only-secret',BUYER_ADDRESS:'0x1111111111111111111111111111111111111111',SELLER_PAY_TO:'0x2222222222222222222222222222222222222222'};
function root(){const dir=mkdtempSync(join(tmpdir(),'demo-readiness-'));dirs.push(dir);mkdirSync(join(dir,'docs'));writeFileSync(join(dir,'docs/private-risk.html'),'<title>test-only</title>');return dir;}
const resolve=()=>undefined;
describe('readiness check without network or actual environment files',()=>{
 it('checks local files and injected configuration without exposing secrets or modifying files',()=>{const dir=root();writeFileSync(join(dir,'.env'),'sentinel-not-read');const network=vi.fn(()=>{throw Error('No network');});vi.stubGlobal('fetch',network);const result=checkDemo({root:dir,env:readyEnv,resolve,nodeVersion:'26.6.0'});expect(result.passed).toBe(true);expect(formatCli(result)).toContain('local-preparation-only');expect(JSON.stringify(result)+formatCli(result)).not.toContain(readyEnv.INTERCEPTA_API_KEY);expect(readFileSync(join(dir,'.env'),'utf8')).toBe('sentinel-not-read');expect(network).not.toHaveBeenCalled();});
 it.each([['22.11.0',false],['22.12.0',true],['26.6.0',true],['27.0.0',false]])('enforces supported runtime %s', (version,expected)=>{expect(checkDemo({root:root(),env:readyEnv,resolve,nodeVersion:version}).node).toBe(expected);});
 it.each(['PRIVATE_RISK_MACHINE','PRIVATE_RISK_FREE_QUOTA_CONFIRMED','PRIVATE_RISK_PRIOR_REQUESTS','INTERCEPTA_API_KEY'])('fails when readiness input is absent: %s',key=>{const env={...readyEnv,[key]:''};expect(checkDemo({root:root(),env,resolve}).passed).toBe(false);});
 it('rejects a malformed key and dependency failure without printing private errors',()=>{expect(checkDemo({root:root(),env:{...readyEnv,INTERCEPTA_API_KEY:'x\ny'},resolve}).passed).toBe(false);const result=checkDemo({root:root(),env:readyEnv,resolve:()=>{throw Error('private path');}});expect(result.dependencies).toBe(false);expect(formatCli(result)).not.toContain('private path');});
 it('does not require budget addresses for address assessment',()=>{const result=checkDemo({root:root(),env:{...readyEnv,BUYER_ADDRESS:'',SELLER_PAY_TO:''},resolve});expect(result.passed).toBe(true);expect(result.budgetAddresses).toBe(false);});
});
