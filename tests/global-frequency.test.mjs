import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mergeInventories,countOutcomeReasons,pruneFrequencyOutputs,assemble} from '../scripts/assemble-global-frequency.mjs';
import {mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('worldwide discovery, selective downloads and shapeless data processing',()=>{
  const run=spawnSync('python3',['-m','unittest','discover','-s','tests','-p','global_frequency_test.py'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stdout+run.stderr);
});
test('global assembly rejects missing shards, duplicate feeds and catalogue drift',()=>{
  const base={schema:2,shards:2,catalogue_sha256:'hash',catalogue_entries:2,service_date:'2026-10-05'};
  const a={...base,shard:0,entries:[{id:'a'}]},b={...base,shard:1,entries:[{id:'b'}]};
  assert.equal(mergeInventories([a,b]).entries.length,2);
  const c={...base,shard:0,counts:{compiled:1},entries:[{id:'a',status:'compiled'}]},d={...base,shard:1,counts:{no_rail:1},entries:[{id:'b',status:'no_rail'}]};
  assert.deepEqual(mergeInventories([c,d]).counts,{compiled:1,no_rail:1},'totals cover every shard, not only the first');
  assert.throws(()=>mergeInventories([a]),/Incomplete/);
  assert.throws(()=>mergeInventories([a,{...b,entries:[{id:'a'}]}]),/Duplicate feed/);
  assert.throws(()=>mergeInventories([a,{...b,catalogue_sha256:'changed'}]),/Inconsistent/);
});
test('reconciled registry fixtures have offline test coverage',()=>{
  const run=spawnSync('python3',['-m','unittest','discover','-s','tests','-p','frequency_catalogue_test.py'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stdout+run.stderr);
});
test('failure classes remain distinct from provider-source prohibitions',()=>{
  const reasons=countOutcomeReasons([
    {id:'a',status:'excluded',reason_code:'source_terms_prohibit_derived_use'},
    {id:'b',status:'excluded',reason_code:'provider_policy'},
    {id:'c',status:'failed',reason_code:'source_http_404'},
    {id:'d',status:'retry_pending',reason_code:'table_row_limit'},
    {id:'e',status:'retry_pending',reason_code:'source_http_404'},
    {id:'f',status:'compiled'}]);
  assert.deepEqual(reasons,{source_terms_prohibit_derived_use:1,provider_policy:1,source_http_404:2,table_row_limit:1});
});
test('published feed directories retain only current verified inventory outputs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'atlas-feed-prune-'));
  try{
    await mkdir(join(root,'feeds'));
    for(const file of ['current.json.gz','old.json.gz','interrupted.tmp'])await writeFile(join(root,'feeds',file),'cache');
    await assert.rejects(pruneFrequencyOutputs(root,[{status:'compiled',output:'../outside.json.gz'}]),/Invalid/);
    assert.equal((await readdir(join(root,'feeds'))).length,3);
    await pruneFrequencyOutputs(root,[{status:'compiled',output:'feeds/current.json.gz'},{status:'failed',output:'feeds/old.json.gz'}]);
    assert.deepEqual(await readdir(join(root,'feeds')),['current.json.gz']);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('snapshot asset and release lookup follow the publishing repository',()=>{
  const run=spawnSync('python3',['-m','unittest','discover','-s','tests','-p','load_frequency_snapshot_test.py'],{encoding:'utf8'});
  assert.equal(run.status,0,run.stdout+run.stderr);
});


test('a large feed is kept for matching beside its peers, and no feed builds map tiles',async()=>{
  const {gzipSync}=await import('node:zlib');const root=await mkdtemp(join(tmpdir(),'atlas-assembly-budget-'));
  const make=id=>({schema:1,source:{id,sha256:id,service_date:'2026-10-05',checked:'2026-10-04',name:id,feed_info:{},valid_until:1900000000},agencies:[{agency_id:'a',agency_name:id,agency_timezone:'America/New_York'}],routes:[{route_id:'r',route_type:'1',route_short_name:'R'}],profiles:{h01:{start:'01:00:00',end:'02:00:00'}},segments:[{route_id:'r',agency_id:'a',geometry:[[-73.99,40.75],[-73.98,40.76]],profiles:{h01:{display_tph:2,forward_tph:2,backward_tph:2,quality:'scheduled'}}}]});
  try{
    await mkdir(join(root,'feeds'));const good=make('good'),bad=make('bad');bad.segments=Array.from({length:10000},()=>({...bad.segments[0],geometry:[[-179,0],[179,0]]}));
    for(const feed of [good,bad])await writeFile(join(root,`feeds/${feed.source.id}.json.gz`),gzipSync(JSON.stringify(feed)));
    const entries=['bad','good'].map(id=>({id,status:'compiled',output:`feeds/${id}.json.gz`,sha256:id,country:'US'}));
    await writeFile(join(root,'inventory-0.json'),JSON.stringify({schema:2,shard:0,shards:1,catalogue_sha256:'verified',catalogue_entries:2,service_date:'2026-10-05',entries}));
    const manifest=await assemble(root);assert.equal(manifest.counts.failed,undefined);assert.equal(manifest.counts.compiled,2);assert.deepEqual(manifest.feeds.map(f=>f.id),['bad','good']);assert.equal(manifest.tiles,0,'timetables build no map tiles');
    assert.deepEqual(manifest.countries_compiled,['US']);
    assert.deepEqual(manifest.countries_with_mapped_feed,['US']);
    assert.deepEqual(manifest.reason_codes,{});
    const inventory=JSON.parse(await (await import('node:fs/promises')).readFile(join(root,'inventory.json'),'utf8'));assert.equal(inventory.entries[0].status,'compiled');assert.equal(inventory.entries[0].failure_stage,undefined);assert.deepEqual(inventory.counts,manifest.counts,'the published inventory totals match its entries after assembly');assert.equal(inventory.entries[0].error,undefined);assert.deepEqual(await readdir(join(root,'feeds')),['bad.json.gz','good.json.gz'],'both feeds are kept');
  }finally{await rm(root,{recursive:true,force:true});}
});
