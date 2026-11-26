import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inputIdentity, selectedGeneration, lastVerifiedGeneration} from '../scripts/extract-pages-handoff.mjs';

const hash = char => char.repeat(64), oid = char => char.repeat(40);
const day = n => '2026-11-' + n + 'T00:00:00Z';
const section = (c,n) => ({sha256:hash(c),sourceTimestamp:day(n)});
const old = {regions:{a:section('a',15),b:section('b',20),c:section('c',24)}, generation:'first'};
const advanced = {regions:{...old.regions,b:section('d',23)},generation:'second'};
const read = (id, identity, ref='a') => ({ref:oid(ref),marker:JSON.stringify({schema:1,complete:true,dataset:id,
  source:'extract', osmTimestamp:day(15), inputSha256:identity})});
const selected = {lifecycle:{source:'extract'}, 'branch-lines':{source:'overpass'}};
const gen = async (index, polar='c') => (await selectedGeneration(selected,
  async s => {assert.equal(s,'lifecycle-extract-data');return read('lifecycle', inputIdentity(index,oid('e'),oid(polar)));})).generation;
const run = (id, conclusion='success') => ({id,head_branch:'main',event:'workflow_dispatch',conclusion,run_attempt:2});
const deploy = (generation, conclusion='success') => ({name:'deploy',conclusion,steps:generation === undefined ? [] :
  [{name:'Retain verified extract generation '+generation,conclusion}]});

test('an interior region and a polar update both change the generation at the same date bounds', async () => {
  assert.notEqual(await gen(old),await gen(advanced));
  assert.notEqual(await gen(old),await gen(old,'f'));
  assert.equal(await gen(old),await gen({regions:{c:old.regions.c,b:old.regions.b,a:old.regions.a},generation:'rerun'}));
  assert.throws(()=>inputIdentity({regions:{a:section('z',15)}},oid('e'),null),/digest/);
});

test('a replay compares with actual successful deployment, not with mutable before/after refs', async () => {
  const held=await gen(advanced), previous=await gen(old);
  const failed=run(3,'failure'), skipped=run(2), verified=run(1);
  const history=[failed,skipped,verified];
  const get=async (id,attempt) => {assert.equal(attempt,2);return id===2?[deploy(held,'skipped')]:[deploy(previous)];};
  assert.equal(await lastVerifiedGeneration(history,get),previous);
  assert.notEqual(await lastVerifiedGeneration(history,get),held);
  assert.equal(await lastVerifiedGeneration([run(4),...history],async id=>id===4?[deploy(held)]:[]),held);
  assert.equal(await lastVerifiedGeneration([run(4),...history],async id=>id===4?[deploy()]:[]),null,
    'a historic matching receipt cannot mask a newer unbound delivery');
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
  const positions=['extract-pages-handoff.mjs pin','Choose each dataset','extract-pages-handoff.mjs check','Save reviewable site',
    'Verify published map with local railway fixture','Retain verified extract generation'].map(x=>site.indexOf(x));
  assert.ok(positions.every((n,i)=>n>=0 && (i===0 || n>positions[i-1])));
});
