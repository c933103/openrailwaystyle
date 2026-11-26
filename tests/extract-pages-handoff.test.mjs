import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inputIdentity, selectedGeneration, lastVerifiedGeneration, verifyStagedCommits} from '../scripts/extract-pages-handoff.mjs';

const hash = char => char.repeat(64), oid = char => char.repeat(40);
const day = n => '2026-11-' + n + 'T00:00:00Z';
const section = (c,n) => ({sha256:hash(c),sourceTimestamp:day(n)});
const old = {regions:{a:section('a',15),b:section('b',20),c:section('c',24)}, generation:'first'};
const advanced = {regions:{...old.regions,b:section('d',23)},generation:'second'};
const read = (id, identity, ref='a') => ({ref:oid(ref),marker:JSON.stringify({schema:1,complete:true,dataset:id,
  source:'extract', osmTimestamp:day(15), inputSha256:identity})});
const selected = {lifecycle:{source:'extract'}, 'branch-lines':{source:'overpass'}};
const gen = async (index, polar='c', builder='e') => (await selectedGeneration(selected,
  async s => {assert.equal(s,'lifecycle-extract-data');return read('lifecycle', inputIdentity(index,hash(builder),oid(polar)));})).generation;
const run = (id, conclusion='success') => ({id,head_branch:'main',event:'workflow_dispatch',conclusion,run_attempt:1});
const deploy = (generation, conclusion='success', published='success', when='01') => ({name:'deploy',conclusion,steps:[
  {name:'Deploy to GitHub Pages',conclusion:published,started_at:day(when)},
  ...(generation === undefined ? [] : [{name:'Retain verified extract generation '+generation,conclusion}]),
]});

test('an interior region and a polar update both change the generation at the same date bounds', async () => {
  assert.notEqual(await gen(old),await gen(advanced));
  assert.notEqual(await gen(old),await gen(old,'f'));
  assert.notEqual(await gen(old),await gen(old,'c','f'));
  assert.equal(await gen(old),await gen({regions:{c:old.regions.c,b:old.regions.b,a:old.regions.a},generation:'rerun'}));
  assert.throws(()=>inputIdentity({regions:{a:section('z',15)}},hash('e'),null),/digest/);
});

test('a replay compares with actual successful deployment, not with mutable before/after refs', async () => {
  const held=await gen(advanced), previous=await gen(old);
  const failed=run(3,'failure'), skipped=run(2), verified=run(1);
  const history=[failed,skipped,verified];
  const get=async (id,attempt) => {
    assert.equal(attempt,1);
    return id===2?[deploy(held,'skipped','skipped','02')]:id===1?[deploy(previous)]:[];
  };
  assert.equal(await lastVerifiedGeneration(history,get),previous);
  assert.notEqual(await lastVerifiedGeneration(history,get),held);
  const withAdvance=[run(4),...history];
  assert.equal(await lastVerifiedGeneration(withAdvance,async (id,attempt)=>id===4?[deploy(held,'success','success','04')]:get(id,attempt)),held);
  assert.equal(await lastVerifiedGeneration(withAdvance,async (id,attempt)=>id===4?[deploy(undefined,'success','success','04')]:get(id,attempt)),null,
    'a historic matching receipt cannot mask a newer unbound delivery');
});

test('a newer unverified publication invalidates a stale success even across reruns', async () => {
  const held=await gen(advanced);
  const runs=[{...run(3,'failure'),run_attempt:2},run(1)];
  const get=async (id,attempt) => {
    if (id===3 && attempt===2) return [deploy(undefined,'failure','skipped','04')];
    if (id===3) return [deploy(undefined,'failure','success','03')];
    return [deploy(held,'success','success','01')];
  };
  assert.equal(await lastVerifiedGeneration(runs,get),null);
});

test('source selection alone cannot certify skipped or wrong staging', () => {
  const expected={crossings:oid('f'),'axle-load':oid('e')};
  assert.throws(()=>verifyStagedCommits(expected,[['axle-load',oid('e')]]),/crossings/);
  assert.throws(()=>verifyStagedCommits(expected,[['crossings',oid('f')],['axle-load',oid('a')]]),/axle-load/);
  assert.throws(()=>verifyStagedCommits(expected,[['crossings',oid('f')],['crossings',oid('f')],['axle-load',oid('e')]]),/crossings/);
  verifyStagedCommits(expected,[['crossings',oid('f')],['axle-load',oid('e')],['lifecycle',oid('c')]]);
});

test('selection gates incomplete or missing inputs and binds a legacy complete marker to its exact ref', async () => {
  assert.deepEqual(await selectedGeneration(selected,async()=>null),{generation:null,commits:{}});
  assert.equal((await selectedGeneration(selected,async()=>({ref:oid('a'),marker:'{}'}))).generation,null);
  assert.notEqual((await selectedGeneration(selected,async()=>read('lifecycle',undefined,'a'))).generation,
    (await selectedGeneration(selected,async()=>read('lifecycle',undefined,'b'))).generation);
  assert.equal((await selectedGeneration(selected,async()=>read('lifecycle',hash('c'),'a'))).generation,
    (await selectedGeneration(selected,async()=>read('lifecycle',hash('c'),'b'))).generation);
});

test('workflows bind a verified delivery and can retry without acquisition', () => {
  const readWorkflow = name => readFileSync(new URL('../.github/workflows/'+name,import.meta.url),'utf8');
  const assemble=readWorkflow('osm-assemble.yml'),site=readWorkflow('site.yml');
  assert.equal((assemble.match(/extract-pages-handoff\.mjs" stamp/g)??[]).length,10);
  assert.match(assemble,/assemble:\n    if: '!inputs\.pages_only'/);
  assert.match(assemble,/if: always\(\) && !cancelled\(\) && github\.ref == 'refs\/heads\/main' && \(needs\.assemble\.result == 'success' \|\| inputs\.pages_only\)/);
  assert.match(assemble,/gh workflow run site\.yml --ref main --field "extract_generation=\$GENERATION"/);
  assert.equal((site.match(/extract-pages-handoff\.mjs staged/g)??[]).length,11);
  assert.equal((assemble.match(/Verify Node 26 security baseline/g)??[]).length,2);
  const positions=['extract-pages-handoff.mjs pin','Choose each dataset','extract-pages-handoff.mjs check','Save reviewable site',
    'Verify published map with local railway fixture','Retain verified extract generation'].map(x=>site.indexOf(x));
  assert.ok(positions.every((n,i)=>n>=0 && (i===0 || n>positions[i-1])));
});
