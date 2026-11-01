import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,utimes,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gunzipSync} from 'node:zlib';
import {buildPowerMethods,validatePowerMethodsSnapshot,POWER_METHOD_REGIONS,POWER_METHOD_LIMITS} from '../scripts/build-power-methods.mjs';
import {powerMethodQuery} from '../scripts/power-method-data.mjs';
import {buildElectricitySignals} from '../scripts/build-electricity-signals.mjs';

const element={type:'way',id:12,tags:{railway:'subway',electrified:'rail'},geometry:[{lon:135,lat:34},{lon:135.001,lat:34.001}]};
const complete={osm3s:{timestamp_osm_base:'2026-10-13T00:00:00Z'},elements:[element]};
const response=(json=complete,{status=200,headers={}}={})=>new Response(typeof json==='string'?json:JSON.stringify(json),{status,headers});
async function fixture(fn) {
  const dir=await mkdtemp(join(tmpdir(),'atlas-power-builder-'));
  let clock=Date.now(),calls=[],sleeps=[];
  const options={cache:join(dir,'cache'),output:join(dir,'output'),now:()=>clock,sleep:async ms=>{sleeps.push(ms);clock+=ms;},log:()=>{}};
  const run=async(fetcher=()=>response(),extra={})=>buildPowerMethods({...options,fetcher:async(url,init)=>{calls.push({query:init.body.get('data'),signal:init.signal,redirect:init.redirect});return fetcher(calls.length,init);},...extra});
  try {await fn({dir,options,run,calls,sleeps,advance:ms=>clock+=ms});}finally{await rm(dir,{recursive:true,force:true});}
}
async function unpublished(output) {
  for(const file of ['power-methods.geojson','power-methods.geojson.gz','methods-manifest.json'])await assert.rejects(access(join(output,file)));
}

for(const status of [400,401,403,404,422,501])test(`permanent HTTP ${status} stops after one request without splits or publication`,()=>fixture(async({run,calls,sleeps,options})=>{
  await assert.rejects(run(()=>response('timeout; out of memory',{status})),error=>error.category==='http-permanent');
  assert.equal(calls.length,1);assert.deepEqual(sleeps,[]);await unpublished(options.output);
}));
for(const [name,payload,category] of [
  ['malformed JSON','{"elements":','parsing'],['HTML success body','<html>Bad query</html>','parsing'],
  ['missing elements',{},'validation'],['wrong elements type',{elements:{}},'validation'],
  ['unknown partial remark',{remark:'runtime error: backend failure',elements:[element]},'validation'],
  ['query parse error',{remark:'parse error: invalid request',elements:[]},'validation'],
  ['parse error mentioning timeout',{remark:'parse error: timed out expression',elements:[]},'validation'],
  ['authorization remark mentioning memory',{remark:'permission denied: memory limit exceeded',elements:[]},'validation'],
  ['incomplete geometry',{elements:[{...element,geometry:[{}]}]},'validation']
])test(`${name} terminates without retries and never caches partial data`,()=>fixture(async({run,calls,options})=>{
  await assert.rejects(run(()=>response(payload)),error=>error.category===category);
  assert.equal(calls.length,1);await unpublished(options.output);
  await assert.rejects(access(join(options.cache,`power-methods-v2-${POWER_METHOD_REGIONS[0].join('_')}.json`)));
}));
for(const status of [408,429,500,502,503,504])test(`HTTP ${status} retries only the same region and exhausts after three`,()=>fixture(async({run,calls,sleeps,options})=>{
  await assert.rejects(run(()=>response('timed out',{status})),new RegExp(`HTTP ${status}`));
  assert.equal(calls.length,3);assert.equal(new Set(calls.map(c=>c.query)).size,1);assert.deepEqual(sleeps,[40000,40000]);await unpublished(options.output);
}));
for(const status of [403,429])test(`HTTP ${status} classification survives error-body cancellation failure`,()=>fixture(async({run,calls,options})=>{
  await assert.rejects(run(()=>({ok:false,status,body:{cancel:async()=>{throw Object.assign(new Error('error body timed out'),{code:'UND_ERR_BODY_TIMEOUT'});}}})),new RegExp(`HTTP ${status}`));
  assert.equal(calls.length,status===403?1:3);
  const {readdir}=await import('node:fs/promises');assert.deepEqual(await readdir(options.cache),[]);
}));
test('rate limit honors Retry-After seconds and recovers without a split',()=>fixture(async({run,calls,sleeps})=>{
  const result=await run(n=>n===1?response('busy',{status:429,headers:{'Retry-After':'120'}}):response());
  assert.equal(calls.length,9);assert.equal(sleeps[0],120000);assert.equal(result.manifest.coverage.length,8);
  assert.equal(calls[0].query,calls[1].query);assert.equal(calls[0].redirect,'error');
}));
test('HTTP-date Retry-After and transient 503 respect the clock',()=>fixture(async({run,sleeps,options})=>{
  await run(n=>n===1?response('busy',{status:503,headers:{'Retry-After':new Date(options.now()+180000).toUTCString()}}):response());
  assert.ok(sleeps[0]>=179000&&sleeps[0]<=180000);
}));
test('oversized Retry-After stops instead of retrying before the server deadline',()=>fixture(async({run,calls,options})=>{
  await assert.rejects(run(()=>response('busy',{status:429,headers:{'Retry-After':'301'}})),/wait budget/);
  assert.equal(calls.length,1);await unpublished(options.output);
}));
test('invalid Retry-After uses bounded default backoff',()=>fixture(async({run,sleeps})=>{
  await run(n=>n===1?response('busy',{status:429,headers:{'Retry-After':'invalid'}}):response());assert.equal(sleeps[0],40000);
}));
for(const kind of ['timeout','resource'])test(`${kind} subdivides on its first explicit response, deduplicates and retains full coverage`,()=>fixture(async({run,calls})=>{
  const root=powerMethodQuery(POWER_METHOD_REGIONS[0]);
  const {data,manifest}=await run((n,init)=>{
    if(init.body.get('data')!==root)return response();
    if(kind==='timeout')return response({remark:'runtime error: Query timed out in query at line 2',elements:[element]});
    return response({remark:'runtime error: Query ran out of memory in query at line 2',elements:[element]});
  });
  assert.equal(calls.length,12);assert.equal(calls.filter(c=>c.query===root).length,1);
  assert.equal(manifest.coverage.length,11);assert.equal(data.features.length,1);
  assert.equal(validatePowerMethodsSnapshot(data,manifest),manifest);
}));
for(const initial of ['transport','rate-limit'])test(`${initial} still backs off before an explicit limit splits without another parent request`,()=>fixture(async({run,calls,sleeps})=>{
  const root=powerMethodQuery(POWER_METHOD_REGIONS[0]);let parents=0;
  const result=await run((n,init)=>{
    if(init.body.get('data')!==root)return response();
    parents++;
    if(parents===1){
      if(initial==='transport')throw Object.assign(new TypeError('fetch failed'),{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});
      return response('busy',{status:429,headers:{'Retry-After':'120'}});
    }
    if(parents===2)return response({remark:'runtime error: Query timed out in query',elements:[element]});
    throw Object.assign(new TypeError('fetch failed'),{cause:{code:'UND_ERR_BODY_TIMEOUT'}});
  });
  assert.equal(parents,2);assert.equal(calls.length,13);assert.equal(sleeps[0],initial==='transport'?40000:120000);
  assert.equal(result.manifest.coverage.length,11);assert.equal(result.data.features.length,1);
}));
for(const kind of ['body-timeout','body-deadline'])test(`${kind} retries without persisting an unproven spatial split`,()=>fixture(async({run,calls,options})=>{
  await assert.rejects(run(()=>({ok:true,body:(async function*(){
    if(kind==='body-timeout')throw Object.assign(new Error('body read failed'),{code:'UND_ERR_BODY_TIMEOUT'});
    throw new DOMException('body read timed out','TimeoutError');
  })()})),error=>error.category==='transport');
  assert.equal(calls.length,3);assert.equal(new Set(calls.map(c=>c.query)).size,1);
  const {readdir}=await import('node:fs/promises');assert.deepEqual(await readdir(options.cache),[]);
  assert.equal((await run()).manifest.coverage.length,8);
}));
for(const code of ['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','opaque-fetch-deadline'])test(`${code} retries without creating spatial checkpoints`,()=>fixture(async({run,calls,sleeps,options})=>{
  await assert.rejects(run(()=>{
    if(code==='opaque-fetch-deadline')throw new DOMException('fetch timed out','TimeoutError');
    throw Object.assign(new TypeError('fetch failed'),{cause:{code}});
  }),error=>error.category==='transport');
  assert.equal(calls.length,3);assert.equal(new Set(calls.map(c=>c.query)).size,1);assert.deepEqual(sleeps,[40000,40000]);
  const {readdir}=await import('node:fs/promises');assert.deepEqual(await readdir(options.cache),[]);
  const recovered=await run();assert.equal(recovered.manifest.requests,8);assert.equal(recovered.manifest.coverage.length,8);
}));
test('transport reset retries without subdivision',()=>fixture(async({run,calls})=>{
  await assert.rejects(run(()=>{throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}});}),error=>error.category==='transport');
  assert.equal(calls.length,3);assert.equal(new Set(calls.map(c=>c.query)).size,1);
}));
test('certificate and unknown transport errors stop without retries',()=>fixture(async({run,calls})=>{
  await assert.rejects(run(()=>{throw Object.assign(new Error('certificate verification failed'),{code:'CERT_HAS_EXPIRED'});}),/certificate/);
  assert.equal(calls.length,1);
}));
test('global request budget caps spatial fan-out across the tree',()=>fixture(async({run,calls,options})=>{
  await assert.rejects(run(()=>response({remark:'Query timed out',elements:[]}),{limits:{requests:5}}),/request budget/);
  assert.equal(calls.length,5);await unpublished(options.output);
}));
test('depth budget caps repeated spatial failures independently of request budget',()=>fixture(async({run,calls,options})=>{
  await assert.rejects(run(()=>response({remark:'Query timed out',elements:[]}),{limits:{depth:1}}),/timed out/);
  assert.equal(calls.length,2);await unpublished(options.output);
}));
test('download bytes include malformed responses and stop mid-stream without retry',()=>fixture(async({run,calls,options})=>{
  let closed=false;
  await assert.rejects(run(()=>({ok:true,body:(async function*(){try{yield Buffer.alloc(6);yield Buffer.alloc(6);throw new Error('should not read third chunk');}finally{closed=true;}})()}),{limits:{bytes:10}}),/download budget/);
  assert.equal(calls.length,1);assert.equal(closed,true);await unpublished(options.output);
}));
test('elapsed-time budget refuses excessive backoff before another request',()=>fixture(async({run,calls,sleeps,options})=>{
  await assert.rejects(run(()=>response('busy',{status:429,headers:{'Retry-After':'120'}}),{limits:{elapsedMs:60000}}),/elapsed-time budget/);
  assert.equal(calls.length,1);assert.deepEqual(sleeps,[]);await unpublished(options.output);
}));
test('elapsed-time budget also stops after a successful slow response',()=>fixture(async({run,calls,advance,options})=>{
  await assert.rejects(run(()=>{advance(60001);return response();},{limits:{elapsedMs:60000}}),/elapsed-time budget/);
  assert.equal(calls.length,1);await unpublished(options.output);
}));
test('incomplete runs reuse completed leaves and split checkpoints without re-querying the parent',()=>fixture(async({run,calls,options})=>{
  const root=powerMethodQuery(POWER_METHOD_REGIONS[0]);
  await assert.rejects(run((n,init)=>init.body.get('data')===root?response({remark:'Query timed out',elements:[]}):n===3?response('forbidden',{status:403}):response()),/HTTP 403/);
  assert.equal(calls.length,3);await unpublished(options.output);
  const {manifest}=await run();
  assert.equal(manifest.requests,10);assert.equal(manifest.coverage.length,11);
  assert.equal(calls.slice(3).some(c=>c.query===root),false);
  const cached=await run(()=>{throw new Error('Unexpected request');});assert.equal(cached.manifest.requests,0);
  const body=await readFile(join(options.output,'power-methods.geojson'));
  assert.deepEqual(gunzipSync(await readFile(join(options.output,'power-methods.geojson.gz'))),body);
}));
test('changed, partial and refresh-requested checkpoints cannot suppress requests; an old one takes its changes',()=>fixture(async({run,options,calls})=>{
  await run();
  const file=join(options.cache,`power-methods-v2-${POWER_METHOD_REGIONS[0].join('_')}.json`);
  const saved=await readFile(file,'utf8');
  for(const record of [{query:'changed',response:complete},{query:powerMethodQuery(POWER_METHOD_REGIONS[0]),response:{remark:'Query timed out',elements:[]}}]) {
    await writeFile(file,JSON.stringify(record));assert.equal((await run()).manifest.requests,1);
  }
  // An old checkpoint is no reason to download again: one change request.
  await writeFile(file,saved);const old=new Date(options.now()-400*86400_000);await utimes(file,old,old);
  assert.equal((await run()).manifest.requests,1);
  assert.match(calls.at(-1).query,/^\[out:xml\].*\[adiff:"2026-10-13T00:00:00Z"\];/);
  assert.equal((await run(undefined,{refresh:true})).manifest.requests,8);
}));
test('a wrong-query split decision is ignored; an old one, or one on a refresh, still splits',()=>fixture(async({run,options,calls})=>{
  const file=join(options.cache,`power-methods-v2-${POWER_METHOD_REGIONS[0].join('_')}.json.split`);
  await import('node:fs/promises').then(fs=>fs.mkdir(options.cache,{recursive:true}));
  await writeFile(file,JSON.stringify({query:'obsolete',kind:'spatial-split',version:1}));
  assert.equal((await run()).manifest.coverage.length,8);
  await rm(file.slice(0,-6));await writeFile(file,JSON.stringify({query:powerMethodQuery(POWER_METHOD_REGIONS[0]),kind:'spatial-split',version:1}));
  const old=new Date(options.now()-29*86400_000);await utimes(file,old,old);
  // The region is known to exceed the server's limits: its parts are asked
  // for, never the whole region again, after 28 days and on a refresh.
  for(const refresh of [false,true]) {
    calls.length=0;
    assert.equal((await run(undefined,{refresh})).manifest.coverage.length,11);
    assert.equal(calls.some(c=>c.query===powerMethodQuery(POWER_METHOD_REGIONS[0])),false);
  }
}));
test('incomplete rebuild leaves the last published files byte-identical',()=>fixture(async({run,options})=>{
  await run();
  const names=['power-methods.geojson','power-methods.geojson.gz','methods-manifest.json'];
  const before=await Promise.all(names.map(n=>readFile(join(options.output,n))));
  await assert.rejects(run(n=>n===9?response():response('bad',{status:400}),{refresh:true}),/HTTP 400/);
  for(let i=0;i<names.length;i++)assert.deepEqual(await readFile(join(options.output,names[i])),before[i]);
}));
test('empty world and inconsistent publication metadata are rejected',()=>fixture(async({run,options})=>{
  await assert.rejects(run(()=>response({elements:[]})),/empty worldwide/);await unpublished(options.output);
  const {data,manifest}=await run(undefined,{refresh:true});
  for(const bad of [
    {...manifest,complete:false},{...manifest,features:2},{...manifest,sha256:'bad'},
    {...manifest,coverage:manifest.coverage.slice(1)},
    {...manifest,coverage:[manifest.coverage[0],...manifest.coverage.slice(0,7)]},
    {...manifest,coverage:[...manifest.coverage,{bbox:[-90,-180,-45,-135],features:1}]},
    {...manifest,coverage:[...manifest.coverage.slice(1),{bbox:[-90,-180,0,-100],features:1}]}
  ])assert.throws(()=>validatePowerMethodsSnapshot(data,bad));
}));
test('unsafe overrides cannot raise hard acquisition limits',()=>fixture(async({run,calls})=>{
  for(const limits of [{requests:POWER_METHOD_LIMITS.requests+1},{elapsedMs:NaN},{attempts:0}])await assert.rejects(run(undefined,{limits}),/Invalid power-method limit/);
  assert.equal(calls.length,0);
}));

test('actual publisher and site workflow gates reject incomplete files and preserve legacy assembly',()=>fixture(async({run,options,dir})=>{
  const {mkdir,symlink,copyFile}=await import('node:fs/promises');
  const {spawnSync}=await import('node:child_process');
  await symlink(new URL('../scripts',import.meta.url).pathname,join(dir,'scripts'));
  const {manifest}=await run();
  await mkdir(join(dir,'power-data'));await mkdir(join(dir,'signal-data'));
  await writeFile(join(dir,'power-data/manifest.json'),JSON.stringify({complete:true,features:1,coverage:Array(8).fill({})}));
  await writeFile(join(dir,'power-data/power-facilities.geojson'),JSON.stringify({type:'FeatureCollection',features:[{}]}));
  await writeFile(join(dir,'signal-data/manifest.json'),JSON.stringify({complete:true}));
  await writeFile(join(dir,'signal-data/index.json'),JSON.stringify({tiles:['fixture']}));
  for(const file of ['power-methods.geojson','methods-manifest.json'])await copyFile(join(options.output,file),join(dir,'power-data',file));
  // The publisher also requires the complete electrification-signal snapshot.
  const signal={type:'node',id:51,lon:9,lat:50,tags:{railway:'signal','railway:signal:electricity':'DE-ESO:el6'}};
  await buildElectricitySignals({...options,output:join(dir,'signals-out'),fetcher:async()=>response({osm3s:{},elements:[signal]})});
  for(const file of ['electricity-signals.geojson','electricity-signals-manifest.json'])await copyFile(join(dir,'signals-out',file),join(dir,'power-data',file));
  const script=async(file,step)=>{
    const workflow=await readFile(new URL(`../.github/workflows/${file}`,import.meta.url),'utf8');
    const body=workflow.slice(workflow.indexOf(`- name: ${step}`)).match(/node --input-type=module <<'JS'\n([\s\S]*?)\n {10}JS/);
    assert.ok(body,'Workflow validation must execute');return body[1].replace(/^ {10}/gm,'');
  };
  const publisher=await script('traction-facilities.yml','Validate complete snapshots');
  const site=await script('site.yml','Load worldwide railway signals and energy supplies');
  const gate=body=>spawnSync(process.execPath,['--input-type=module'],{input:body,cwd:dir,encoding:'utf8',timeout:15000});
  assert.equal(gate(publisher).status,0);
  for(const bad of [{...manifest,complete:false},{...manifest,sha256:'bad'},{...manifest,coverage:Array(8).fill(manifest.coverage[0])}]) {
    await writeFile(join(dir,'power-data/methods-manifest.json'),JSON.stringify(bad));
    assert.notEqual(gate(publisher).status,0);
  }
  await writeFile(join(dir,'power-data/methods-manifest.json'),JSON.stringify(manifest));
  await rm(join(dir,'power-data/power-methods.geojson'));assert.notEqual(gate(publisher).status,0);
  const root=join(dir,'styles/data/traction');await mkdir(root,{recursive:true});
  await symlink(join(dir,'power-data'),join(root,'power'));await symlink(join(dir,'signal-data'),join(root,'signals'));
  assert.notEqual(gate(site).status,0,'one supplement file cannot pass assembly');
  await rm(join(dir,'power-data/methods-manifest.json'));assert.equal(gate(site).status,0,'legacy snapshot remains available');
  for(const file of ['power-methods.geojson','methods-manifest.json'])await copyFile(join(options.output,file),join(dir,'power-data',file));
  assert.equal(gate(site).status,0);
  await writeFile(join(dir,'power-data/methods-manifest.json'),JSON.stringify({...manifest,sha256:'bad'}));assert.notEqual(gate(site).status,0);
}));

test('optimized query leaves v1 responses and expensive-query split evidence untouched',()=>fixture(async({run,options})=>{
  const {mkdir}=await import('node:fs/promises');await mkdir(options.cache,{recursive:true});
  const legacyQuery=await readFile(new URL('./fixtures/power-methods-v1-query.ql',import.meta.url),'utf8');
  const stem=join(options.cache,`power-methods-v1-${POWER_METHOD_REGIONS[0].join('_')}.json`);
  const legacy=JSON.stringify({query:legacyQuery.trim(),response:complete}),split=JSON.stringify({query:legacyQuery.trim(),kind:'spatial-split',version:1});
  await writeFile(stem,legacy);await writeFile(stem+'.split',split);
  const result=await run();assert.equal(result.manifest.requests,8);assert.equal(result.manifest.coverage.length,8);
  assert.equal(await readFile(stem,'utf8'),legacy);assert.equal(await readFile(stem+'.split','utf8'),split);
  assert.equal((await run(()=>{throw new Error('Unexpected request');})).manifest.requests,0);
}));

// Synthetic augmented diff: the cached way moved, a new one added.
const changeXml=`<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="Overpass API">\n<meta osm_base="2026-10-20T00:00:00Z"/>\n`
  +'<action type="modify"><old/><new><way id="12" version="2"><nd ref="1" lat="34" lon="135"/><nd ref="2" lat="34.002" lon="135.002"/><tag k="railway" v="subway"/><tag k="electrified" v="rail"/></way></new></action>\n'
  +'<action type="create"><way id="13" version="1"><nd ref="3" lat="35" lon="136"/><nd ref="4" lat="35.001" lon="136.001"/><tag k="railway" v="tram"/><tag k="electrified" v="rail"/></way></action>\n</osm>\n';
test('a week-old cached region takes one change request instead of a new download',()=>fixture(async({run,calls,options,advance})=>{
  await run();
  const first=calls.length;
  advance(8*86400000);
  await run((n,init)=>{assert.match(init.body.get('data'),/^\[out:xml\].*\[adiff:"2026-10-13T00:00:00Z"\];/);return response(changeXml);});
  const changeCalls=calls.slice(first);
  assert.equal(changeCalls.length,first,'one change request per cached region');
  assert.ok(changeCalls.every(c=>/\[adiff:/.test(c.query)&&/out meta geom qt;$/.test(c.query)),'no region downloaded again');
  const data=JSON.parse(await readFile(join(options.output,'power-methods.geojson'),'utf8'));
  assert.deepEqual(data.features.map(f=>f.id).sort(),['way-12','way-13']);
  assert.deepEqual(data.features.find(f=>f.id==='way-12').geometry.coordinates.at(-1),[135.002,34.002],'the moved way');
  const cached=JSON.parse(await readFile(join(options.cache,`power-methods-v2-${POWER_METHOD_REGIONS[0].join('_')}.json`),'utf8'));
  assert.equal(cached.response.osm3s.timestamp_osm_base,'2026-10-20T00:00:00Z','the next update starts from the new database time');
}));
test('a refused change request keeps the cached region and still publishes it',()=>fixture(async({run,calls,options,advance})=>{
  await run();
  const first=calls.length;
  advance(8*86400000);
  await run(()=>response('busy',{status:503}));
  assert.equal(calls.length-first,first,'one change attempt per region, no retries, no new download');
  const data=JSON.parse(await readFile(join(options.output,'power-methods.geojson'),'utf8'));
  assert.deepEqual(data.features.map(f=>f.id),['way-12']);
}));
test('a cached region of another query takes only the difference, not a new download',()=>fixture(async({run,calls,options})=>{
  await run();
  const box=POWER_METHOD_REGIONS[0],file=join(options.cache,`power-methods-v2-${box.join('_')}.json`),query=powerMethodQuery(box);
  // The same query with a narrower usage filter: the current one selects more.
  const older=query.replace('(railway|traction)','(railway)');
  assert.notEqual(older,query);
  await writeFile(file,JSON.stringify({query:older,response:complete}));
  const first=calls.length,added={type:'way',id:14,tags:{railway:'rail',electrified:'rail'},geometry:[{lon:136,lat:35},{lon:136.001,lat:35.001}]};
  await run((n,init)=>{
    const body=init.body.get('data');
    if(body.includes('[adiff:'))return response(changeXml.replace(/<action[\s\S]*<\/action>\n/,''));
    return response(body.endsWith('out ids;')?{elements:[{type:'way',id:12},{type:'way',id:14}]}:{elements:[added]});
  });
  const asked=calls.slice(first).map(c=>c.query);
  assert.equal(asked.length,3,'the changes of the old query, then the new query\'s ids and only the new element');
  assert.match(asked[2],/\(way\(id:14\);\);out body geom qt;$/);
  assert.match(asked[0],/^\[out:xml\].*\[adiff:"2026-10-13T00:00:00Z"\];/);
  assert.ok(asked.slice(1).every(q=>q.includes('[date:"2026-10-20T00:00:00Z"]')),'both at the database time of those changes');
  const data=JSON.parse(await readFile(join(options.output,'power-methods.geojson'),'utf8'));
  assert.deepEqual(data.features.map(f=>f.id).sort(),['way-12','way-14']);
  const cached=JSON.parse(await readFile(file,'utf8'));
  assert.equal(cached.query,query,'kept under the current query');
  assert.equal(cached.response.osm3s.timestamp_osm_base,'2026-10-20T00:00:00Z');
  // If the difference fails, the region is downloaded in full, never kept under the old query.
  await writeFile(file,JSON.stringify({query:older,response:complete}));
  const before=calls.length;
  await run((n,init)=>init.body.get('data').includes('[adiff:')?response('busy',{status:503}):response());
  assert.deepEqual(calls.slice(before).map(c=>c.query),[calls.slice(before)[0].query,query]);
}));
test('a change without geometry keeps the cached region; the request budget still stops the run',()=>fixture(async({run,calls,options,advance})=>{
  await run();
  advance(8*86400000);
  const bare=changeXml.replace(/<nd ref="3" lat="35" lon="136"\/><nd ref="4" lat="35.001" lon="136.001"\/>/,'');
  await run(()=>response(bare));
  const data=JSON.parse(await readFile(join(options.output,'power-methods.geojson'),'utf8'));
  assert.deepEqual(data.features.map(f=>f.id),['way-12'],'never drawn without its line; the region keeps its data');
  const cached=JSON.parse(await readFile(join(options.cache,`power-methods-v2-${POWER_METHOD_REGIONS[0].join('_')}.json`),'utf8'));
  assert.equal(cached.response.osm3s.timestamp_osm_base,'2026-10-13T00:00:00Z','asked again next time');
  const before=calls.length;
  await assert.rejects(run(()=>response(changeXml),{limits:{requests:2}}),/request budget/);
  assert.equal(calls.length-before,2);
}));
