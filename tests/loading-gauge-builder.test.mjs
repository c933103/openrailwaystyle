import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeLoadingGauges} from '../styles/loading-gauge-list.mjs';
const builder=fileURLToPath(new URL('../scripts/build-loading-gauge-list.mjs',import.meta.url));
async function run(t,rules,{cached='123\tGB\n'}={}){
 const root=await mkdtemp(join(tmpdir(),'loading-gauge-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'.snapshot-cache'));
 if(cached!==null)await writeFile(join(root,'.snapshot-cache/loading-gauge.csv'),cached);
 await writeFile(join(root,'fake.mjs'),`
  import {writeFileSync} from 'node:fs';
  let clock=Date.parse('2026-11-06T00:00:00Z');Date.now=()=>clock;
  globalThis.setTimeout=(f,ms)=>{clock+=ms||0;f();return 0;};
  const rules=${JSON.stringify(rules)},requests=[];
  globalThis.fetch=async(url,init)=>{
   requests.push({url:String(url),query:init.body.get('data'),at:clock});writeFileSync('requests.json',JSON.stringify(requests));
   const rule=rules[Math.min(requests.length-1,rules.length-1)],headers={...rule.headers};
   if(rule.dateDelay)headers['Retry-After']=new Date(clock+rule.dateDelay).toUTCString();
   if(rule.fetchError)throw new TypeError('fetch failed');
   const response=new Response(rule.body??'busy',{status:rule.status??503,headers});
   if(rule.bodyError)response.text=async()=>{throw new TypeError('body interrupted');};
   return response;
  };
 `);
 const result=spawnSync(process.execPath,['--import','./fake.mjs',builder],{cwd:root,encoding:'utf8',timeout:10000});
 const requests=JSON.parse(await readFile(join(root,'requests.json'),'utf8'));
 const cache=await readFile(join(root,'.snapshot-cache/loading-gauge.csv'),'utf8').catch(()=>null);
 const output=await readFile(join(root,'snapshot/loading-gauge.json'),'utf8').then(JSON.parse).catch(()=>null);
 return {result,requests,cache,output};
}
const good={status:200,body:'456\tGC\n'};

test('loading-gauge retry honors a seconds Retry-After without changing its query',async t=>{
 const r=await run(t,[{headers:{'Retry-After':'600'}},good]);
 assert.equal(r.result.status,0,r.result.stderr);assert.equal(r.requests.length,2);
 assert.ok(r.requests[1].at-r.requests[0].at>=600000);
 assert.equal(r.requests[1].query,r.requests[0].query);assert.equal(r.cache,good.body);
 assert.equal(decodeLoadingGauges(r.output).get(456),'GC');
});
test('loading-gauge interrupted body retains a header-time HTTP-date pause',async t=>{
 const r=await run(t,[{status:200,dateDelay:600000,bodyError:true},good]);
 assert.equal(r.requests.length,2);assert.ok(r.requests[1].at-r.requests[0].at>=600000);
});
for(const value of ['901','9999999999999999999999999999999999999999'])test(`loading-gauge long provider pause ${value} stops requests and reuses cache`,async t=>{
 const r=await run(t,[{headers:{'Retry-After':value}}]);
 assert.equal(r.result.status,0,r.result.stderr);assert.equal(r.requests.length,1);
 assert.equal(r.cache,'123\tGB\n');assert.equal(decodeLoadingGauges(r.output).get(123),'GB');
 assert.match(r.result.stderr,/Retry-After/);
});
for(const status of [400,401,403,404])test(`loading-gauge HTTP ${status} is not retried`,async t=>{
 const r=await run(t,[{status}]);assert.equal(r.requests.length,1);assert.equal(r.cache,'123\tGB\n');
 assert.equal(decodeLoadingGauges(r.output).get(123),'GB');
});
test('loading-gauge retry count and minute waits stay bounded on transport failures',async t=>{
 const r=await run(t,[{fetchError:true}]);assert.equal(r.requests.length,3);
 assert.deepEqual(r.requests.slice(1).map((x,i)=>x.at-r.requests[i].at),[60000,60000]);
 assert.equal(r.cache,'123\tGB\n');
});
test('loading-gauge transient 406/429 and exact 15-minute boundary can recover',async t=>{
 for(const status of [406,429]){
  const r=await run(t,[{status,headers:{'Retry-After':'900'}},good]);
  assert.equal(r.requests.length,2);assert.equal(r.requests[1].at-r.requests[0].at,900000);
  assert.equal(r.cache,good.body);
 }
});
test('loading-gauge unavailable with no previous cache publishes no invented list',async t=>{
 const r=await run(t,[{status:403}],{cached:null});assert.equal(r.requests.length,1);
 assert.equal(r.result.status,0);assert.equal(r.cache,null);assert.equal(r.output,null);
});
test('loading-gauge malformed and past Retry-After retain the original one-minute retry',async t=>{
 for(const value of ['soon','-1','Thu, 05 Nov 2026 00:00:00 GMT']){
  const r=await run(t,[{headers:{'Retry-After':value}},good]);
  assert.equal(r.requests.length,2);assert.equal(r.requests[1].at-r.requests[0].at,60000);
 }
});
test('loading-gauge complete success needs no retry even when a later request is discouraged',async t=>{
 const r=await run(t,[{...good,headers:{'Retry-After':'3600'}}]);
 assert.equal(r.requests.length,1);assert.equal(r.cache,good.body);
 assert.equal(decodeLoadingGauges(r.output).get(456),'GC');
});
test('loading-gauge long pause with a broken successful body preserves old bytes',async t=>{
 const r=await run(t,[{status:200,headers:{'Retry-After':'3600'},bodyError:true}]);
 assert.equal(r.requests.length,1);assert.equal(r.cache,'123\tGB\n');
 assert.equal(decodeLoadingGauges(r.output).get(123),'GB');
});

for(const value of ["Wed, 31 Feb 2027 00:10:00 GMT", "Mon, 07 Nov 2026 00:10:00 GMT", "Foo, 07 Nov 2026 00:10:00 GMT", "Sat, 07 Nov 2026 24:00:00 GMT", "2027-01-01T00:00:00Z", "Sat, 07 Nov 2026 00:10:00 +0000"])for(const bodyError of [false,true])test(`loading-gauge rejects malformed calendar pause ${value} (bodyError=${bodyError})`,async t=>{
 const r=await run(t,[{status:bodyError?200:503,bodyError,headers:{'Retry-After':value}},good]);
 assert.equal(r.result.status,0,r.result.stderr);assert.equal(r.requests.length,2);assert.equal(r.requests[1].at-r.requests[0].at,60000);
 assert.equal(r.cache,good.body);assert.equal(decodeLoadingGauges(r.output).get(456),'GC');
});
for(const value of ['Fri, 06 Nov 2026 00:10:05 GMT','Friday, 06-Nov-26 00:10:05 GMT','Fri Nov  6 00:10:05 2026'])test(`loading-gauge retains valid calendar pause ${value}`,async t=>{
 const timezone=process.env.TZ;process.env.TZ='Asia/Tokyo';t.after(()=>{if(timezone===undefined)delete process.env.TZ;else process.env.TZ=timezone;});
 const r=await run(t,[{headers:{'Retry-After':value}},good]);assert.equal(r.result.status,0,r.result.stderr);
 assert.equal(r.requests.length,2);assert.equal(r.requests[1].at-r.requests[0].at,600000);assert.equal(r.cache,good.body);
});
