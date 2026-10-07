import test from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync, gunzipSync} from 'node:zlib';
import {addResult, commitStage, readTable, toTable, writeTable, geometrySummary} from '../scripts/service-routes.mjs';
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
globalThis.setTimeout=(callback)=>{callback();return 0;};
globalThis.fetch=async(url,options)=>{appendFileSync(process.env.MOCK_LOG,JSON.stringify({url,query:options.body.get('data')})+'\\n');
const next=observations[count++];if(!next)throw new Error('Unexpected fetch');
return new Response(next.padding?' '.repeat(next.padding):JSON.stringify(next.body),{status:next.status||200});};`);
    const run = async (responses, previousState = state(), table = {routes:new Map(),ways:new Map()}, environment = {}) => {
      await writeFile(join(root,'responses.json'),JSON.stringify(responses));
      await writeFile(join(root,'previous/state.json'),JSON.stringify(previousState));
      await writeFile(join(root,'previous/service-routes.ndjson.gz'),gzipSync(writeTable(table)));
      const child = spawnSync(process.execPath,['--import',join(root,'mock.mjs'),join(root,'scripts/build-service-routes.mjs')],{cwd:root,encoding:'utf8',
        env:{...process.env,PREVIOUS_DATA:join(root,'previous'),OVERPASS_URL:'https://overpass.invalid/test',MOCK_PATH:join(root,'responses.json'),MOCK_LOG:join(root,'requests.ndjson'),GITHUB_OUTPUT:'',...environment}});
      assert.equal(child.status,0,child.stderr);
      return {root,stdout:child.stdout,read:async name => JSON.parse(await readFile(join(root,'service-data',name),'utf8'))};
    };
    await fn(run);
  } finally { await rm(root,{recursive:true,force:true}); }
}

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
