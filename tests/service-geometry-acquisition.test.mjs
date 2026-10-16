import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync, gunzipSync} from 'node:zlib';
import {addResult, buildTiles, commitStage, partQuery, readTable, toTable, writeTable, geometrySummary} from '../scripts/service-routes.mjs';
import {STAGES, quarters} from '../scripts/branch-lines.mjs';
const points = [[139.70,35.68],[139.71,35.69],[139.72,35.68],[139.73,35.69],[139.74,35.68]];
const response = (day, coordinates = points) => ({osm3s: {timestamp_osm_base: `2026-10-${day}T00:00:00Z`}, elements: [
  {type:'relation',id:1,version:1,timestamp:'2026-10-01T00:00:00Z',tags:{route:'subway',ref:'1',name:'One',network:'N'},members:[{type:'way',ref:10,role:''}]},
  {type:'way',id:10,version:1,timestamp:'2026-10-01T00:00:00Z',nodes:[1,2,3,4,5],geometry:coordinates.map(p => p && {lon:p[0],lat:p[1]})},
]});
const state = () => ({version:1,downloadStages:3,stages:{japan:{completed:null,pending:null,seen:[]}},runs:[]});
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'atlas-geometry-acquisition-'));
  try {
    await cp('scripts', join(root,'scripts'), {recursive:true});
    await mkdir(join(root,'styles'));
    for (const name of ['pbf-utf8.mjs','service-frequency.mjs']) await cp(`styles/${name}`,join(root,'styles',name));
    await symlink(resolve('node_modules'),join(root,'node_modules'),'dir');
    await mkdir(join(root,'previous'));
    await writeFile(join(root,'mock.mjs'), `import {readFileSync,appendFileSync} from 'node:fs';
const observations=JSON.parse(readFileSync(process.env.MOCK_PATH,'utf8')); let count=0;
globalThis.setTimeout=(callback,ms)=>{appendFileSync(process.env.MOCK_SLEEPS,JSON.stringify(ms)+'\\n');callback();return 0;};
globalThis.fetch=async(url,options)=>{appendFileSync(process.env.MOCK_LOG,JSON.stringify({url,query:options.body.get('data')})+'\\n');
const next=observations[count++];if(!next)throw new Error('Unexpected fetch');
if(next.error)throw new TypeError('fetch failed',{cause:Object.assign(new Error('transport'),{code:next.error})});
return new Response(next.padding?' '.repeat(next.padding):next.text??JSON.stringify(next.body),{status:next.status||200});};`);
    const run = async (responses, previousState = state(), table = {routes:new Map(),ways:new Map()}, environment = {}) => {
      await writeFile(join(root,'responses.json'),JSON.stringify(responses));
      await writeFile(join(root,'previous/state.json'),JSON.stringify(previousState));
      await writeFile(join(root,'previous/service-routes.ndjson.gz'),gzipSync(writeTable(table)));
      const child = spawnSync(process.execPath,['--import',join(root,'mock.mjs'),join(root,'scripts/build-service-routes.mjs')],{cwd:root,encoding:'utf8',
        env:{...process.env,PREVIOUS_DATA:join(root,'previous'),OVERPASS_URL:'https://overpass.invalid/test',MOCK_PATH:join(root,'responses.json'),MOCK_LOG:join(root,'requests.ndjson'),MOCK_SLEEPS:join(root,'sleeps.ndjson'),GITHUB_OUTPUT:join(root,'github-output'),GITHUB_STEP_SUMMARY:join(root,'summary.md'),...environment}});
      assert.equal(child.status,0,child.stderr);
      return {root,stdout:child.stdout,stderr:child.stderr,read:async name => JSON.parse(await readFile(join(root,'service-data',name),'utf8')),
        requests:async()=> (await readFile(join(root,'requests.ndjson'),'utf8')).trim().split('\n').map(JSON.parse),
        sleeps:async()=> (await readFile(join(root,'sleeps.ndjson'),'utf8')).trim().split('\n').map(JSON.parse)};
    };
    await fn(run);
  } finally { await rm(root,{recursive:true,force:true}); }
}

// Sanitized diagnostic excerpt from urban acquisition run 38883856813,
// job 116916739952 (2026-10-16); not a complete archived provider response.
const capacity = '# 502 Gateway Timeout\nThis Overpass API server is currently at capacity. All query workers are busy and the request queue is full.';
const japan = STAGES.find(stage=>stage.name==='japan').parts[0];
const parentQuery = partQuery(japan,japan.box);
const html = detail=>`<html><head><title>Gateway Timeout</title></head><body>${detail}</body></html>`;

for (const [name,status,text] of [
  ['observed capacity',502,capacity],
  ['capacity without worker wording',502,html('This server is at capacity.')],
  ['busy workers',504,html('All query workers are busy.')],
  ['full queue',504,html('The request queue is full.')],
  ['case and whitespace',502,html('THE REQUEST\nQUEUE IS FULL.')],
  ['diagnostic beyond the log excerpt',502,html(`${'Synthetic preamble. '.repeat(20)}The request queue is full.`)],
]) {
  test(`urban acquisition: ${name} retries the same box before Gateway Timeout subdivision`,async()=>fixture(async run=>{
    const body=response('07'),result=await run([{status,text},{body}]),saved=await result.read('state.json');
    assert.deepEqual((await result.requests()).map(item=>item.query),[parentQuery,parentQuery]);
    assert.deepEqual(await result.sleeps(),[0,60000]);
    assert.equal(saved.stages.japan.lastAttempt.splitBoxes,0);
    assert.equal(saved.stages.japan.lastAttempt.fetchedBoxes,1);
    assert.equal(saved.stages.japan.lastAttempt.status,'acquired');
    assert.equal(saved.stages.japan.pending,null);
    assert.equal(saved.runs[0].bytes,Buffer.byteLength(text)+Buffer.byteLength(JSON.stringify(body)));
    const warning=result.stderr.split('\n').find(line=>line.startsWith('Overpass attempt'));
    assert.ok(warning.length<=240,'provider log excerpts remain bounded');
    if(name==='diagnostic beyond the log excerpt') assert.doesNotMatch(warning,/queue is full/);
  }));
}

test('urban acquisition: five overload attempts preserve accepted data, queue, byte accounting and deferred publication',async()=>fixture(async run=>{
  const table={routes:new Map(),ways:new Map()};addResult(table,toTable(response('06')),'japan');commitStage(table,'japan');
  const before=writeTable(table),prior=state();
  prior.stages.japan.pending=[{part:0,box:[35,139,36,140],depth:2},{part:0,box:[34,138,35,139],depth:2}];
  prior.stages.japan.started='2026-10-01T00:00:00Z';
  const result=await run(Array.from({length:5},()=>({status:502,text:capacity})),prior,table);
  const saved=await result.read('state.json'),attempt=saved.stages.japan.lastAttempt;
  assert.deepEqual((await result.requests()).map(item=>item.query),Array(5).fill(partQuery(japan,prior.stages.japan.pending[0].box)));
  assert.deepEqual(await result.sleeps(),[0,60000,120000,180000,240000]);
  assert.deepEqual(saved.stages.japan.pending,prior.stages.japan.pending);
  assert.equal(saved.stages.japan.completed,null);
  assert.equal(attempt.status,'deferred');assert.equal(attempt.fetchedBoxes,0);assert.equal(attempt.splitBoxes,0);
  assert.equal(attempt.requests,5);assert.equal(attempt.downloadedBytes,5*Buffer.byteLength(capacity));
  assert.equal(saved.runs[0].bytes,attempt.downloadedBytes);
  assert.match(attempt.reason,/Overpass stayed unavailable: HTTP 502/);
  assert.equal(gunzipSync(await readFile(join(result.root,'service-data/service-routes.ndjson.gz'))).toString(),before);
  assert.equal((await result.read('manifest.json')).run.status,'deferred');
  assert.equal(await readFile(join(result.root,'github-output'),'utf8'),'publish=true\nredeploy=false\n');
  assert.match(await readFile(join(result.root,'summary.md'),'utf8'),/0 fetched boxes; 2 pending/);
}));

test('urban acquisition: overload after progress retains partial geometry and the untouched remaining box',async()=>fixture(async run=>{
  const prior=state(),boxes=quarters(japan.box).slice(0,2);prior.stages.japan.pending=boxes.map(box=>({part:0,box,depth:1}));
  prior.stages.japan.started='2026-10-01T00:00:00Z';
  const body=response('07'),result=await run([{body},...Array.from({length:5},()=>({status:502,text:capacity}))],prior);
  const saved=await result.read('state.json'),attempt=saved.stages.japan.lastAttempt;
  assert.deepEqual((await result.requests()).map(item=>item.query),[partQuery(japan,boxes[0]),...Array(5).fill(partQuery(japan,boxes[1]))]);
  assert.deepEqual(await result.sleeps(),[0,15000,60000,120000,180000,240000]);
  assert.deepEqual(saved.stages.japan.pending,[prior.stages.japan.pending[1]]);
  assert.equal(saved.stages.japan.completed,null);
  assert.equal(attempt.status,'partial');assert.equal(attempt.fetchedBoxes,1);assert.equal(attempt.splitBoxes,0);assert.equal(attempt.requests,6);
  assert.equal(attempt.downloadedBytes,Buffer.byteLength(JSON.stringify(body))+5*Buffer.byteLength(capacity));
  assert.equal(saved.runs[0].bytes,attempt.downloadedBytes);
  const persisted=readTable(gunzipSync(await readFile(join(result.root,'service-data/service-routes.ndjson.gz'))).toString());
  assert.equal(persisted.routes.size,1);assert.equal(persisted.ways.size,1);
  assert.equal(persisted.ways.get(10).nextGeometry.japan.snapshot,'2026-10-07T00:00:00Z');
  const manifest=await result.read('manifest.json');assert.equal(manifest.run.status,'partial');assert.equal(manifest.routes,1);assert.ok(manifest.tiles>0);
  assert.equal(await readFile(join(result.root,'github-output'),'utf8'),'publish=true\nredeploy=true\n');
}));

for (const [name,failure] of [
  ['genuine HTTP timeout',{status:504,text:html('runtime error: Query timed out in query at line 1 after 181 seconds.')}],
  ['JSON query timeout',{body:{remark:'runtime error: Query timed out in query at line 1 after 181 seconds.'}}],
  ['query memory exhaustion',{body:{remark:'runtime error: Query run out of memory using about 2048 MB of RAM.'}}],
  ['truncated JSON',{text:'{"elements":['}],
]) {
  test(`urban acquisition: ${name} retains spatial subdivision and ordinary request spacing`,async()=>fixture(async run=>{
    const result=await run([failure,...quarters(japan.box).map(()=>({body:response('07')}))]);
    assert.deepEqual((await result.requests()).map(item=>item.query),[parentQuery,...quarters(japan.box).map(box=>partQuery(japan,box))]);
    assert.deepEqual(await result.sleeps(),[0,15000,15000,15000,15000]);
    const saved=await result.read('state.json');assert.equal(saved.stages.japan.lastAttempt.splitBoxes,1);
    assert.equal(saved.stages.japan.lastAttempt.fetchedBoxes,4);assert.equal(saved.stages.japan.pending,null);
  }));
}

test('urban acquisition: repeated genuine timeouts retain the depth-six split limit and pending leaf',async()=>fixture(async run=>{
  const result=await run(Array.from({length:7},()=>({status:504,text:'Query timed out after 181 seconds.'})));
  const expected=[];let box=japan.box;
  for(let depth=0;depth<=6;depth++){expected.push(partQuery(japan,box));box=quarters(box)[0];}
  assert.deepEqual((await result.requests()).map(item=>item.query),expected);
  assert.deepEqual(await result.sleeps(),[0,...Array(6).fill(15000)]);
  const saved=await result.read('state.json');assert.equal(saved.stages.japan.lastAttempt.splitBoxes,6);
  assert.equal(saved.stages.japan.pending.length,19);assert.equal(saved.stages.japan.pending[0].depth,6);
  assert.equal(saved.stages.japan.completed,null);assert.match(saved.stages.japan.lastAttempt.reason,/could not fetch region/);
}));

for (const [name,status,text] of [
  ['Dispatcher timeout',504,'Dispatcher_Client::request_read_and_idx::timeout'],
  ['rate limit',429,'Gateway Timeout'],
  ['service unavailable',503,'Gateway Timeout'],
  ['generic gateway failure',502,'Bad Gateway'],
]) {
  test(`urban acquisition: ${name} retains five bounded retries without subdivision`,async()=>fixture(async run=>{
    const result=await run(Array.from({length:5},()=>({status,text}))),saved=await result.read('state.json');
    assert.deepEqual((await result.requests()).map(item=>item.query),Array(5).fill(parentQuery));
    assert.deepEqual(await result.sleeps(),[0,60000,120000,180000,240000]);
    assert.equal(saved.stages.japan.lastAttempt.splitBoxes,0);assert.equal(saved.stages.japan.lastAttempt.status,'deferred');
    assert.equal(saved.stages.japan.pending.length,1);assert.equal(saved.stages.japan.completed,null);
  }));
}

test('urban acquisition: default 50 MB run budget stops after an oversized response and retains the split queue',async()=>fixture(async run=>{
  const result=await run([{padding:50_000_001}]),saved=await result.read('state.json');
  assert.deepEqual((await result.requests()).map(item=>item.query),[parentQuery]);
  assert.equal(saved.stages.japan.lastAttempt.downloadedBytes,50_000_001);assert.equal(saved.runs[0].bytes,50_000_001);
  assert.equal(saved.stages.japan.lastAttempt.splitBoxes,1);assert.equal(saved.stages.japan.pending.length,4);
  assert.equal(saved.stages.japan.completed,null);assert.match(saved.stages.japan.lastAttempt.reason,/download budget reached/);
}));

test('urban acquisition: default 100 MB daily allowance counts recent failed-response bytes',async()=>fixture(async run=>{
  const prior=state();prior.runs=[{at:new Date().toISOString(),bytes:85_000_000}];
  const result=await run([{padding:15_000_001}],prior),saved=await result.read('state.json');
  assert.equal((await result.requests()).length,1);assert.equal(saved.stages.japan.lastAttempt.downloadedBytes,15_000_001);
  assert.equal(saved.runs.reduce((sum,item)=>sum+item.bytes,0),100_000_001);
  assert.equal(saved.stages.japan.completed,null);assert.match(saved.stages.japan.lastAttempt.reason,/download budget reached/);
}));

test('zero-byte transport outage persists a deferred attempt, unchanged geometry and an unfinished queue',async () => fixture(async run => {
  const table={routes:new Map(),ways:new Map()};addResult(table,toTable(response('06')),'japan');commitStage(table,'japan');
  const before=writeTable(table),result=await run(Array.from({length:5},()=>({error:'ENETUNREACH'})),state(),table);
  const saved=readTable(gunzipSync(await readFile(join(result.root,'service-data/service-routes.ndjson.gz'))).toString());
  assert.equal(writeTable(saved),before);
  const acquired=await result.read('state.json');
  assert.equal(acquired.stages.japan.completed,null);
  assert.equal(acquired.stages.japan.pending.length,1);
  assert.equal(acquired.stages.japan.lastAttempt.status,'deferred');
  assert.match(acquired.stages.japan.lastAttempt.reason,/ENETUNREACH/);
  assert.equal(acquired.stages.japan.lastAttempt.requests,5);
  assert.equal(acquired.stages.japan.lastAttempt.downloadedBytes,0);
  assert.equal((await result.read('manifest.json')).run.status,'deferred');
  const {selectDownloadStage}=await import('../scripts/download-stages.mjs');
  assert.equal(selectDownloadStage(acquired).name,'east-asia');
}));

test('geometry acquisition: busy-server retry retains metadata and records partial refresh health', async () => fixture(async run => {
  const result = await run([{status:503,body:{remark:'too busy'}},{body:response('07',[points[0],points[1],null,points[3],points[4]])}]);
  const acquired = await result.read('state.json'), health = acquired.stages.japan.geometry;
  assert.equal(health.status,'incomplete'); assert.equal(health.counts.partial,1); assert.equal(health.attempts,1);
  assert.equal(health.retry,'next-stage-refresh'); assert.equal(health.lastFailure,'unresolved-source-geometry');
  assert.equal(acquired.runs.length,1); assert.ok(acquired.runs[0].bytes>0);
  const requests=(await readFile(join(result.root,'requests.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(requests.length,2); assert.match(requests[0].query,/out meta geom qt/);
  const table=readTable(gunzipSync(await readFile(join(result.root,'service-data/service-routes.ndjson.gz'))).toString());
  assert.equal(table.ways.get(10).geometry.sources[0].endpoint,'https://overpass.invalid/test');
  assert.equal(table.ways.get(10).geometry.sources[0].stage,'japan');
  assert.deepEqual((await result.read('manifest.json')).geometry,geometrySummary(table));
}));

test('geometry acquisition: same-stage newest incomplete source survives box order and persisted publication', async () => fixture(async run => {
  const prior=state(); prior.stages.japan.pending=[{part:0,box:[35,139,36,140]},{part:0,box:[34,138,35,139]}]; prior.stages.japan.started='2026-10-01T00:00:00Z';
  const partial=response('07',[points[0],points[1],null,points[3],points[4]]);
  const result=await run([{body:partial},{body:response('06')}],prior);
  const table=readTable(gunzipSync(await readFile(join(result.root,'service-data/service-routes.ndjson.gz'))).toString());
  assert.equal(table.ways.get(10).geometry.snapshot,'2026-10-07T00:00:00Z');
  assert.equal(table.ways.get(10).lines.length,2);
  assert.equal((await result.read('state.json')).stages.japan.geometry.status,'incomplete');
}));

test('geometry acquisition: exceeded response budget resumes split queue without changing accepted evidence', async () => fixture(async run => {
  const table={routes:new Map(),ways:new Map()}; addResult(table,toTable(response('06')),'japan');commitStage(table,'japan');
  const before=writeTable(table), result=await run([{padding:10_000_001}],state(),table,{BUDGET_BYTES:'10000000'});
  const saved=readTable(gunzipSync(await readFile(join(result.root,'service-data/service-routes.ndjson.gz'))).toString());
  assert.equal(writeTable(saved),before);
  const acquired=await result.read('state.json');assert.equal(acquired.stages.japan.pending.length,4);
  assert.ok(acquired.stages.japan.pending.every(item=>item.depth===1));assert.equal(acquired.runs[0].bytes,10_000_001);
  assert.equal(acquired.stages.japan.completed,null);
}));

test('geometry acquisition: rolling daily budget prevents a request without resetting the source table', async () => fixture(async run => {
  const prior=state();prior.runs=[{at:new Date().toISOString(),bytes:95_000_000}];
  const result=await run([],prior);assert.match(result.stdout,/waiting for a later run/);
  await assert.rejects(readFile(join(result.root,'requests.ndjson')), {code:'ENOENT'});
}));

test('geometry acquisition: rejected conflicting refresh retains accepted data and the observed repair reason', async () => fixture(async run => {
  const initial=response('06'), relation=initial.elements[0];
  initial.elements.unshift(...Array.from({length:24},(_,i)=>({...relation,id:i+2,tags:{...relation.tags,ref:String(i+2),name:`Line ${i+2}`}})));
  const table={routes:new Map(),ways:new Map()};addResult(table,toTable(initial),'japan');commitStage(table,'japan');
  const before=writeTable(table), prior=state();Object.assign(prior.stages.japan,{completed:'2026-09-01T00:00:00Z',started:'2026-10-07T00:00:00Z',pending:[{part:0,box:[35,139,36,140]}]});
  const conflict=response('07');conflict.elements.push({...conflict.elements[1],geometry:points.map(([lon,lat])=>({lon,lat:lat+0.02}))});
  const result=await run([{body:conflict}],prior,table), acquired=await result.read('state.json');
  const saved=readTable(gunzipSync(await readFile(join(result.root,'service-data/service-routes.ndjson.gz'))).toString());
  assert.equal(writeTable(saved),before);
  assert.equal(acquired.stages.japan.geometry.status,'incomplete');
  assert.equal(acquired.stages.japan.geometry.lastFailure,'membership-refresh-rejected');
  assert.equal(acquired.stages.japan.geometry.observed.counts.conflict,1);
  assert.deepEqual(acquired.stages.japan.geometry.observed.affectedWays,[10]);
  assert.equal(acquired.stages.japan.geometry.retry,'next-stage-refresh');
}));

test('relation acquisition: relation-only contradiction marks stage incomplete with no way conflicts', async () => fixture(async run => {
  const body = response('07'); body.elements.push({...body.elements[0], tags: {...body.elements[0].tags, name: 'Contradictory name'}});
  const result = await run([{body}]), health = (await result.read('state.json')).stages.japan.geometry;
  assert.equal(health.status, 'incomplete'); assert.equal(health.counts.conflict, 0); assert.equal(health.relationCounts.conflict, 1);
  assert.deepEqual(health.affectedRelations, [1]); assert.equal(health.retry, 'next-stage-refresh');
  assert.deepEqual((await result.read('manifest.json')).geometry.relations.relationsWithConflicts, [1]);
}));

test('relation acquisition: full declarations with no returned ways remain unresolved and cannot report complete coverage', async () => fixture(async run => {
  const body = response('07'); body.elements = body.elements.filter(element => element.type === 'relation');
  const result = await run([{body}]), health = (await result.read('state.json')).stages.japan.geometry;
  assert.equal(health.status, 'incomplete'); assert.equal(health.relationCounts.partial, 1);
  assert.deepEqual(health.affectedRelations, [1]);
  const manifest = await result.read('manifest.json'); assert.equal(manifest.ways, 0);
  assert.deepEqual(manifest.geometry.relations.relationsWithUnresolvedMembers, [1]);
}));

test('relation acquisition: conflicting unverified refresh cannot report successful repair from retained accepted evidence', async () => fixture(async run => {
  const table = {routes: new Map(), ways: new Map()}; addResult(table, toTable(response('06')), 'japan'); commitStage(table, 'japan');
  const body = response('07'); delete body.elements[0].version;
  body.elements.push({...body.elements[0], tags: {...body.elements[0].tags, name: 'Conflicting unknown'}});
  const result = await run([{body}], state(), table), health = (await result.read('state.json')).stages.japan.geometry;
  assert.equal(health.observed.relationCounts.conflict, 1); assert.equal(health.relationCounts.complete, 1);
  assert.equal(health.status, 'incomplete'); assert.equal(health.retry, 'next-stage-refresh');
  assert.equal(health.lastFailure, 'unresolved-source-relations');
  const saved = readTable(gunzipSync(await readFile(join(result.root, 'service-data/service-routes.ndjson.gz'))).toString());
  assert.equal(saved.routes.get('r1').evidence.view.label, 'One');
  assert.ok((await result.read('manifest.json')).geometry.relations.details[0].reasons.includes('ignored_unverified_relation'));
}));

test('relation acquisition: retiring current stage refreshes older-stage retained dependency health', async () => fixture(async run => {
  const table = {routes: new Map(), ways: new Map()}, original = response('06'), changed = response('07');
  changed.elements[0] = {...changed.elements[0], version: 2, timestamp: '2026-10-02T00:00:00Z', members: [{type: 'way', ref: 11, role: ''}]};
  changed.elements[1] = {...changed.elements[1], id: 11};
  addResult(table, toTable(original), 'east-asia'); commitStage(table, 'east-asia');
  addResult(table, toTable(changed), 'japan'); commitStage(table, 'japan');
  const prior = state(); prior.stages['east-asia'] = {completed: '2026-10-01T00:00:00Z', geometry: {status: 'complete', attempts: 3, retry: null, lastFailure: null}};
  const result = await run([{body: {osm3s: {timestamp_osm_base: '2026-10-07T01:00:00Z'}, elements: []}}], prior, table);
  const older = (await result.read('state.json')).stages['east-asia'].geometry;
  assert.equal(older.status, 'incomplete'); assert.equal(older.attempts, 3);
  assert.equal(older.lastFailure, 'retained-relation-membership-unavailable'); assert.deepEqual(older.unavailableRelations, [1]);
  assert.deepEqual((await result.read('manifest.json')).geometry.relations.relationsWithUnavailableMemberships, [1]);
}));

test('relation acquisition: a complete refresh during a dependency gap can recover when another stage restores it', async () => fixture(async run => {
  const {refreshRelationDependencyHealth} = await import('../scripts/service-geometry-health.mjs');
  const table = {routes: new Map(), ways: new Map()}, original = response('06'), changed = response('07');
  changed.elements[0] = {...changed.elements[0], version: 2, timestamp: '2026-10-02T00:00:00Z', members: [{type: 'way', ref: 11, role: ''}]};
  changed.elements[1] = {...changed.elements[1], id: 11};
  addResult(table, toTable(original), 'japan'); commitStage(table, 'japan');
  addResult(table, toTable(changed), 'east-asia'); commitStage(table, 'east-asia'); commitStage(table, 'east-asia');
  const prior = state(); prior.stages.japan.geometry = {status: 'complete', attempts: 3, retry: null, lastFailure: null};
  refreshRelationDependencyHealth(prior, table, '2026-10-07T00:00:00Z');
  assert.equal(prior.stages.japan.geometry.status, 'incomplete');
  const result = await run([{body: original}], prior, table), savedState = await result.read('state.json');
  const savedTable = readTable(gunzipSync(await readFile(join(result.root, 'service-data/service-routes.ndjson.gz'))).toString());
  const health = savedState.stages.japan.geometry;
  assert.equal(health.status, 'incomplete'); assert.equal(health.observed.status, 'complete'); assert.equal(health.sourceOutcome.status, 'complete');
  addResult(savedTable, toTable(changed), 'russia'); commitStage(savedTable, 'russia');
  refreshRelationDependencyHealth(savedState, savedTable, '2026-10-07T01:00:00Z');
  assert.equal(savedState.stages.japan.geometry.status, 'complete'); assert.equal(savedState.stages.japan.geometry.retry, null);
  assert.equal(savedState.stages.japan.geometry.lastFailure, null); assert.equal(savedState.stages.japan.geometry.attempts, 4);
}));

test('inactive acquisition: published active totals differ from retained source declarations and frequency rebuild agrees',async()=>fixture(async run=>{
  const body=response('07'),first=body.elements[0];
  body.elements.unshift({...first,id:2,tags:{...first.tags,name:'Two',ref:'2'}});
  first.tags={...first.tags,name:'',ref:''};
  const result=await run([{body}]),manifest=await result.read('manifest.json'),savedState=await result.read('state.json');
  assert.equal(manifest.routes,1);assert.equal(manifest.retainedRelations,2);
  assert.equal(manifest.stages.find(s=>s.name==='japan').routes,1);assert.equal(manifest.stages.find(s=>s.name==='japan').retainedRelations,2);
  assert.equal(savedState.stages.japan.routes,1);assert.equal(savedState.stages.japan.retainedRelations,2);
  assert.equal(savedState.stages.japan.geometry.relationCounts.complete,2);
  assert.deepEqual(manifest.geometry.routeRelationsWithoutGeometry,[]);
  assert.match(result.stdout,/1 active routes .*2 retained declarations/);
  const directory=join(result.root,'service-data'),raw=await readFile(join(directory,'service-routes.ndjson.gz'));
  const table=readTable(gunzipSync(raw).toString());assert.equal(table.routes.size,2);assert.equal(table.ways.size,1);
  const rebuild=spawnSync(process.execPath,['scripts/rebuild-service-frequency.mjs',directory,join(result.root,'credits.html'),'--fixtures'],{encoding:'utf8'});
  assert.equal(rebuild.status,0,rebuild.stderr);
  assert.deepEqual(JSON.parse(await readFile(join(directory,'frequency-manifest.json'),'utf8')).geometry,manifest.geometry);
  assert.deepEqual(await readFile(join(directory,'service-routes.ndjson.gz')),raw);
}));

test('unverified relation acquisition retains committed tiles below the stage loss threshold',async()=>fixture(async run=>{
  const table={routes:new Map(),ways:new Map()};addResult(table,toTable(response('06')),'japan');commitStage(table,'japan');
  const expected=buildTiles(table),body=response('07');delete body.elements[0].members;
  const result=await run([{body}],state(),table),manifest=await result.read('manifest.json'),savedState=await result.read('state.json');
  assert.equal(manifest.routes,1);assert.equal(manifest.ways,1);assert.deepEqual(manifest.geometry.routeRelationsWithoutGeometry,[]);
  const saved=readTable(gunzipSync(await readFile(join(result.root,'service-data/service-routes.ndjson.gz'))).toString());
  assert.deepEqual(saved.ways.get(10).routes.japan,['r1']);
  assert.equal(savedState.stages.japan.geometry.observed.relationCounts.unknown,1);
  assert.equal(savedState.stages.japan.geometry.lastFailure,'unverified-source');
  const actual=new Map();for(const key of (await result.read('index.json')).tiles)actual.set(key,gunzipSync(await readFile(join(result.root,`service-data/${key}.pbf.gz`))));
  assert.deepEqual([...actual].sort(),[...expected].map(([key,bytes])=>[key,Buffer.from(bytes)]).sort(),'actual published tiles preserve the retained accepted service');
}));
