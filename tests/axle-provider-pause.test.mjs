import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const builder=fileURLToPath(new URL('../scripts/build-axle-load-list.mjs',import.meta.url));
const previous={updated:'2026-09-01T00:00:00Z',ways:7,retained:'prior validated lookup'};
async function run(t,rules,{cached=previous,parts={}}={}){
 const root=await mkdtemp(join(tmpdir(),'axle-pause-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'.snapshot-cache'));
 if(cached!==null)await writeFile(join(root,'.snapshot-cache/axle-load.json'),JSON.stringify(cached));
 await writeFile(join(root,'.snapshot-cache/axle-load-parts.json'),JSON.stringify(parts));
 await writeFile(join(root,'fake.mjs'),`
  import {writeFileSync} from 'node:fs';
  let clock=Date.parse('2026-11-07T00:00:00Z'),elapsed=0,oversleep=0;
  Date.now=()=>clock;Object.defineProperty(performance,'now',{value:()=>elapsed});
  globalThis.setTimeout=(f,ms)=>{clock+=(ms||0)+oversleep;elapsed+=(ms||0)+oversleep;oversleep=0;f();return 0;};
  const rules=${JSON.stringify(rules)},requests=[];
  globalThis.fetch=async(url,init)=>{
   requests.push({url:String(url),query:init.body.get('data'),at:clock,elapsed});writeFileSync('requests.json',JSON.stringify(requests));
   const rule=rules[requests.length-1]??{},headers={...rule.headers};oversleep=rule.oversleep??0;
   if(rule.dateDelay)headers['Retry-After']=new Date(clock+rule.dateDelay).toUTCString();
   if(rule.fetchError)throw new TypeError('fetch failed');
   const body=init.body.get('data').includes('ISO3166-1')?'count\\t0\\t0\\n':'count\\t0\\t0\\t\\t\\t\\n';
   const response=new Response(body,{status:rule.status??200,headers});
   const read=response.text.bind(response);response.text=async()=>{
    elapsed+=rule.elapsed??0;clock+=rule.elapsed??0;clock+=rule.wallShift??0;
    if(rule.bodyError)throw new TypeError('body interrupted');return read();
   };
   return response;
  };
 `);
 const result=spawnSync(process.execPath,['--import','./fake.mjs',builder],{cwd:root,encoding:'utf8',timeout:10000});
 const requests=await readFile(join(root,'requests.json'),'utf8').then(JSON.parse).catch(()=>[]);
 const output=await readFile(join(root,'snapshot/axle-load.json'),'utf8').then(JSON.parse).catch(()=>null);
 const partsResult=await readFile(join(root,'.snapshot-cache/axle-load-parts.json'),'utf8').then(JSON.parse);
 return {result,requests,output,parts:partsResult};
}
for(const rule of [{headers:{'Retry-After':'600'}},{dateDelay:600000}])test(`axle next part respects successful response pause ${JSON.stringify(rule)}`,async t=>{
 const r=await run(t,[rule]);assert.equal(r.result.status,0,r.result.stderr);
 assert.equal(r.requests.length,5);assert.ok(r.requests[1].elapsed-r.requests[0].elapsed>=600000);
 assert.equal(new Set(r.requests.map(r=>r.query)).size,5);assert.equal(r.output.ways,0);
});
test('axle provider pause is monotonic despite a forward wall-clock correction',async t=>{
 const r=await run(t,[{headers:{'Retry-After':'600'},wallShift:3600000}]);
 assert.equal(r.requests.length,5);assert.equal(r.requests[1].elapsed,600000);
});
test('axle elapsed body time counts toward the provider pause',async t=>{
 const r=await run(t,[{headers:{'Retry-After':'600'},elapsed:400000}]);
 assert.equal(r.requests.length,5);assert.equal(r.requests[1].elapsed,600000);
});
for(const value of ['1200','9999999999999999999999999999999999999999'])test(`axle pause beyond remaining request budget retains old lookup: ${value}`,async t=>{
 const r=await run(t,[{headers:{'Retry-After':value}}]);
 assert.equal(r.requests.length,1);assert.deepEqual(r.output,previous);assert.deepEqual(Object.keys(r.parts),['capacity']);
 assert.match(r.result.stderr,/provider pause|budget/i);
});
test('axle cumulative pauses cannot exceed the existing maintenance job time budget',async t=>{
 const r=await run(t,[{headers:{'Retry-After':'600'}},{headers:{'Retry-After':'600'}}]);
 assert.equal(r.requests.length,2);assert.deepEqual(r.output,previous);assert.deepEqual(Object.keys(r.parts),['capacity','legal']);
});
for(const value of ['soon','-1','Fri, 06 Nov 2026 00:00:00 GMT'])test(`axle malformed or past pause adds no request or delay: ${value}`,async t=>{
 const r=await run(t,[{headers:{'Retry-After':value}}]);assert.equal(r.requests.length,5);assert.equal(r.requests[1].elapsed,0);
});
test('axle HTTP failures and interrupted bodies still make no retry or next part request',async t=>{
 for(const rule of [{status:429,headers:{'Retry-After':'600'}},{headers:{'Retry-After':'600'},bodyError:true}]){
  const r=await run(t,[rule]);assert.equal(r.requests.length,1);assert.deepEqual(r.output,previous);assert.deepEqual(r.parts,{});
 }
});
test('axle complete cache makes no provider request',async t=>{
 const cached={...previous,updated:'2026-11-06T00:00:00Z'};const r=await run(t,[],{cached});
 assert.equal(r.requests.length,0);assert.deepEqual(r.output,cached);
});
test('axle unavailable with no prior lookup does not publish partial data',async t=>{
 const r=await run(t,[{headers:{'Retry-After':'3600'}}],{cached:null});
 assert.equal(r.requests.length,1);assert.equal(r.output,null);assert.deepEqual(Object.keys(r.parts),['capacity']);
});
test('axle final success needs no extra request or wait for a future provider pause',async t=>{
 const r=await run(t,[{},{},{},{},{headers:{'Retry-After':'3600'}}]);
 assert.equal(r.requests.length,5);assert.equal(r.requests[4].elapsed,0);assert.equal(r.output.ways,0);
});

test('axle exact 24-minute wait-plus-request boundary is allowed',async t=>{
 const r=await run(t,[{headers:{'Retry-After':'1140'}}]);
 assert.equal(r.requests.length,5);assert.equal(r.requests[1].elapsed,1140000);assert.equal(r.output.ways,0);
});
test('axle rechecks the request budget after an overslept provider pause',async t=>{
 const r=await run(t,[{headers:{'Retry-After':'600'},oversleep:600000}]);
 assert.equal(r.requests.length,1);assert.deepEqual(r.output,previous);
});
test('axle slow earlier parts cannot start a full request beyond the budget',async t=>{
 const r=await run(t,[{elapsed:1200000}]);assert.equal(r.requests.length,1);assert.deepEqual(r.output,previous);
});
test('axle complete cached remaining parts do not wait for an unnecessary request',async t=>{
 const parts=Object.fromEntries(['legal','d4','other-classes','finland'].map(key=>[key,{updated:'2026-11-06T00:00:00Z',rows:[]}]))
 const r=await run(t,[{headers:{'Retry-After':'3600'}}],{parts});
 assert.equal(r.requests.length,1);assert.equal(r.output.ways,0);
});

for(const value of ["Wed, 31 Feb 2027 00:10:00 GMT", "Mon, 07 Nov 2026 00:10:00 GMT", "Foo, 07 Nov 2026 00:10:00 GMT", "Sat, 07 Nov 2026 24:00:00 GMT", "2027-01-01T00:00:00Z", "Sat, 07 Nov 2026 00:10:00 +0000"])test(`axle rejects malformed calendar pause ${value}`,async t=>{
 const r=await run(t,[{headers:{'Retry-After':value}}]);
 assert.equal(r.result.status,0,r.result.stderr);assert.equal(r.requests.length,5);assert.equal(r.requests[1].elapsed,0);assert.equal(r.output.ways,0);
});
for(const value of ['Sat, 07 Nov 2026 00:10:00 GMT','Saturday, 07-Nov-26 00:10:00 GMT','Sat Nov  7 00:10:00 2026'])test(`axle retains valid calendar pause ${value}`,async t=>{
 const timezone=process.env.TZ;process.env.TZ='Asia/Tokyo';t.after(()=>{if(timezone===undefined)delete process.env.TZ;else process.env.TZ=timezone;});
 const r=await run(t,[{headers:{'Retry-After':value}}]);assert.equal(r.result.status,0,r.result.stderr);
 assert.equal(r.requests.length,5);assert.equal(r.requests[1].elapsed,600000);assert.equal(r.output.ways,0);
});
