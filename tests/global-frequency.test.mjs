import test from 'node:test';
import {createHash} from 'node:crypto';
const sourceHash=value=>createHash('sha256').update(value).digest('hex');
const aliasProof=(url,hash=sourceHash(url))=>({schema:1,state:'schedule',specs:['gtfs'],processed_filename:null,acquisition_alias_of:'owner',alias_source_sha256:hash,selected_static_declaration:'a'.repeat(64),declarations:[{
  id:'a'.repeat(64),type:'transitland-atlas',reference_id:'static',declared_spec:null,upstream_skip:true,upstream_skip_reason:'',definition:{url:'https://github.test/xx.json',pointer:'/sources/0',sha256:'b'.repeat(64)},resolution:{state:'resolved',specs:['gtfs'],endpoints:[{role:'static_current',spec:'gtfs',url,url_sha256:hash,url_origin:'metadata',access_state:'public_declared'}]}}]});

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mergeInventories,countOutcomeReasons,pruneFrequencyOutputs,assemble} from '../scripts/assemble-global-frequency.mjs';
import {mkdtemp,mkdir,writeFile,readdir,rm,readFile} from 'node:fs/promises';
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

test('publication metadata redacts nested URL values without changing acquisition identity',async()=>{
  const {publishedMetadata,redactedSourceUrl}=await import('../scripts/assemble-global-frequency.mjs');
  const {createHash}=await import('node:crypto');
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const first='https://fixture-user:fixture-pass@feeds.example.test/gtfs.zip?token=fixture-token-one&region=fixture-region#fixture-fragment';
  const second=first.replace('fixture-token-one','fixture-token-two');
  const input={source:first,source_metadata:{lineage:[{source:second}],urls:[first,second],error:`Download failed at ${first}`,attempts:[{url:first,code:'http_403'}]},catalogue_url:'https://catalogue.example.test/feeds?api_key=fixture-catalogue'};
  const original=JSON.stringify(input),published=publishedMetadata(input);
  assert.equal(JSON.stringify(input),original,'publication does not mutate raw acquisition/cache objects');
  assert.equal(published.source,'https://feeds.example.test/gtfs.zip?token=%5Bredacted%5D&region=%5Bredacted%5D');
  assert.equal(published.source,published.source_metadata.lineage[0].source,'display endpoints may coincide');
  assert.equal(published.source_sha256,hash(first));
  assert.equal(published.source_metadata.lineage[0].source_sha256,hash(second));
  assert.notEqual(published.source_sha256,published.source_metadata.lineage[0].source_sha256,'exact full-URL fingerprints retain distinct identities');
  assert.deepEqual(published.source_metadata.urls_sha256,[hash(first),hash(second)]);
  const keyed=publishedMetadata({[first]:'first source',[second]:'second source'});
  assert.equal(Object.keys(keyed).length,2,'URL-keyed audit maps also preserve distinct identities');
  assert.ok(Object.keys(keyed).every(key=>!key.includes('fixture-')));
  assert.deepEqual(publishedMetadata(keyed),keyed);
  assert.match(published.source_metadata.error,/Download failed at https:\/\/feeds\.example\.test\/gtfs\.zip\?token=/);
  assert.equal(published.source_metadata.attempts[0].code,'http_403');
  for(const value of ['fixture-user','fixture-pass','fixture-token-one','fixture-token-two','fixture-region','fixture-fragment','fixture-catalogue'])assert.ok(!JSON.stringify(published).includes(value),`published synthetic metadata excludes ${value}`);
  assert.deepEqual(publishedMetadata(published),published,'repeat publication retains the original fingerprints');
  assert.equal(redactedSourceUrl('https://feeds.example.test:443/gtfs.zip?flag&token=a&token=b'),'https://feeds.example.test/gtfs.zip?flag=%5Bredacted%5D&token=%5Bredacted%5D&token=%5Bredacted%5D');
});

test('publication URL redaction handles encoded credentials, diagnostics and malformed URLs',async()=>{
  const {publishedMetadata,redactedSourceUrl}=await import('../scripts/assemble-global-frequency.mjs');
  const url='https://fixture%2Duser:fixture%2Dpass@feeds.example.test/rail%20feed.zip?%61pi_key=fixture%2Dtoken#fixture-fragment';
  const encoded=encodeURIComponent(url),escaped=url.replaceAll('/','\\/');
  const input={source:url,encoded,escaped,error:`Failed '${encoded}' and ${escaped}`,malformed:'https://fixture-user:fixture-pass@[invalid/gtfs?key=fixture-token',whitespace:'https://fixture-user:fixture-pass@feeds.example.test/gtfs?key=fixture token',relative:'//fixture-user:fixture-pass@feeds.example.test/gtfs?key=fixture-token'};
  const published=publishedMetadata(input),output=JSON.stringify(published);
  for(const value of ['fixture-user','fixture-pass','fixture-token','fixture%2Duser','fixture%2Dpass','fixture%2Dtoken','fixture-fragment','fixture token'])assert.ok(!output.includes(value),`published output excludes ${value}`);
  assert.equal(published.source,'https://feeds.example.test/rail%20feed.zip?api_key=%5Bredacted%5D');
  assert.equal(published.encoded,published.source);
  assert.equal(published.escaped,published.source);
  assert.equal(published.malformed,'[invalid source URL]');
  assert.equal(published.whitespace,'[invalid source URL]');
  assert.equal(published.relative,'//feeds.example.test/gtfs?key=%5Bredacted%5D');
  assert.equal(redactedSourceUrl('https://feeds.example.test/gtfs?%ZZ=fixture-token'),'https://feeds.example.test/gtfs?parameter=%5Bredacted%5D');
  assert.equal(redactedSourceUrl('https%3A%2F%2Ffeeds.example.test%2Fgtfs%3Fkey%3Dfixture-token%ZZ'),'[invalid source URL]');
});

test('aggregate publication scans exclude synthetic URL secrets and retain accounting and compiled payloads',async()=>{
  const {readFile}=await import('node:fs/promises'),{gzipSync}=await import('node:zlib'),{createHash}=await import('node:crypto');
  const root=await mkdtemp(join(tmpdir(),'atlas-publication-redaction-'));
  const urls=['first','second'].map(which=>`https://fixture-user:fixture-pass@feeds.example.test/gtfs.zip?api_key=fixture-${which}#fixture-fragment`);
  const make=(id,url)=>({schema:1,source:{id,sha256:id,url,service_date:'2026-10-05',checked:'2026-10-04',name:id,feed_info:{feed_publisher_url:url},lineage:[{source:url}],valid_until:1900000000},agencies:[{agency_id:'a',agency_name:id,agency_timezone:'UTC'}],routes:[{route_id:'r',route_type:'1'}],profiles:{h01:{start:'01:00:00',end:'02:00:00'}},segments:[{route_id:'r',agency_id:'a',geometry:[[0,0],[1,1]],profiles:{h01:{display_tph:2,forward_tph:2,backward_tph:2,quality:'scheduled'}}}]});
  const logs=[],originalLog=console.log;
  try{
    await mkdir(join(root,'feeds'));
    const entries=urls.map((url,i)=>({id:`feed-${i}`,status:'compiled',output:`feeds/feed-${i}.json.gz`,sha256:`feed-${i}`,country:'ZZ',source:url,catalogue:{lineage:[{source:url}]}}));
    entries.push({id:'failed',status:'retry_pending',reason_code:'source_http_403',error:`Denied ${urls[0]}`,source_attempts:[{url:urls[0],code:'http_403'}]});
    const rawFeeds=urls.map((url,i)=>gzipSync(JSON.stringify(make(`feed-${i}`,url))));
    for(let i=0;i<rawFeeds.length;i++)await writeFile(join(root,entries[i].output),rawFeeds[i]);
    const shard=JSON.stringify({schema:2,shard:0,shards:1,catalogue_url:'https://catalogue.example.test/feeds?token=fixture-catalogue',catalogue_sha256:'verified',catalogue_entries:3,service_date:'2026-10-05',entries});
    await writeFile(join(root,'inventory-0.json'),shard);
    console.log=(...parts)=>logs.push(parts.join(' '));
    const manifest=await assemble(root),inventory=JSON.parse(await readFile(join(root,'inventory.json'),'utf8'));
    const published=[await readFile(join(root,'manifest.json'),'utf8'),await readFile(join(root,'inventory.json'),'utf8'),...logs].join('\n');
    for(const value of ['fixture-user','fixture-pass','fixture-first','fixture-second','fixture-fragment','fixture-catalogue'])assert.ok(!published.includes(value),`aggregate files and assembly logs exclude ${value}`);
    assert.equal(manifest.feeds.length,2);
    assert.deepEqual(manifest.counts,{retry_pending:1,compiled:2});
    assert.deepEqual(inventory.counts,manifest.counts);
    assert.deepEqual(manifest.reason_codes,{source_http_403:1});
    assert.deepEqual(manifest.countries_with_mapped_feed,['ZZ']);
    assert.equal(inventory.entries.filter(e=>e.status==='compiled').length,2,'same display endpoint never coalesces feeds');
    for(let i=0;i<2;i++){
      const expected=createHash('sha256').update(urls[i]).digest('hex');
      assert.equal(manifest.feeds[i].source.url_sha256,expected);
      assert.equal(inventory.entries.find(e=>e.id===`feed-${i}`).source_sha256,expected);
      assert.deepEqual(await readFile(join(root,entries[i].output)),rawFeeds[i],'raw internal feed identity/profile payload stays unchanged');
    }
    const staged=JSON.parse(await readFile(join(root,'inventory-0.json'),'utf8'));
    assert.equal(staged.entries.length,3);
    assert.deepEqual(staged.entries.toSorted((a,b)=>a.id.localeCompare(b.id)),inventory.entries,'staged shard copies receive the same publication projection');
  }finally{console.log=originalLog;await rm(root,{recursive:true,force:true});}
});


test('combined catalogue provenance is verified through generator, compiler shards and manifest',()=>{
  const run=spawnSync('python3',['-m','unittest','discover','-s','tests','-p','frequency_provenance_test.py'],{encoding:'utf8',env:{...process.env,ATLAS_TEST_NODE:process.execPath}});
  assert.equal(run.status,0,run.stdout+run.stderr);
});

test('assembly rejects missing or inconsistent composite provenance without inventing legacy metadata',()=>{
  const provenance={schema:1,kind:'reconciled',transitous_ref:'a'.repeat(40),sources:['https://catalogue.example.test/one','https://catalogue.example.test/two'],input_sha256:{mobility_csv:'b'.repeat(64)}};
  const base={schema:2,shards:2,catalogue_url:null,catalogue_sha256:'hash',catalogue_entries:2,service_date:'2026-10-05',catalogue_provenance:provenance};
  const a={...base,shard:0,entries:[{id:'a'}]},b={...base,shard:1,entries:[{id:'b'}]};
  assert.deepEqual(mergeInventories([a,b]).catalogue_provenance,provenance);
  for(const changed of [undefined,{...provenance,transitous_ref:'c'.repeat(40)},
      {...provenance,sources:provenance.sources.slice(0,1)},
      {...provenance,input_sha256:{mobility_csv:'d'.repeat(64)}}]){
    assert.throws(()=>mergeInventories([a,{...b,catalogue_provenance:changed}]),/Inconsistent inventory catalogue_provenance/);
  }
  assert.throws(()=>mergeInventories([a,{...b,catalogue_url:'https://different.example.test/catalogue'}]),/Inconsistent inventory catalogue_url/);
  const legacy=mergeInventories([{...a,catalogue_provenance:undefined},{...b,catalogue_provenance:undefined}]);
  assert.deepEqual(legacy.catalogue_provenance,{schema:1,kind:'legacy-unverified',sources:[]},'old shards remain readable without fabricating verified origins');
});

test('format and alias outcomes retain identity accounting without duplicate contributions',()=>{
  const hash=sourceHash('https://provider.test/feed'),base={schema:3,shards:2,catalogue_url:null,catalogue_sha256:'fixture',catalogue_entries:3,service_date:'2026-10-05'};
  const owner={id:'owner',status:'no_rail',catalogue:{delivery:'direct',source:'https://provider.test/feed',source_sha256:hash}};
  const alias={id:'alias',status:'source_alias',reason_code:'duplicate_static_source',catalogue:{source:owner.catalogue.source,source_sha256:hash,source_resolution:aliasProof(owner.catalogue.source,hash)}};
  const bikes={id:'bikes',status:'non_timetable',reason_code:'non_timetable_format'};
  const merged=mergeInventories([{...base,shard:0,entries:[owner,bikes]},{...base,shard:1,entries:[alias]}]);
  assert.deepEqual(merged.counts,{source_alias:1,non_timetable:1,no_rail:1});
  assert.equal(merged.entries.find(e=>e.id==='alias').status,'source_alias');
  assert.deepEqual(countOutcomeReasons(merged.entries),{duplicate_static_source:1,non_timetable_format:1});
  const tryAlias=value=>mergeInventories([{...base,shard:0,entries:[owner,bikes]},{...base,shard:1,entries:[value]}]);
  for(const changes of [{acquisition_alias_of:'missing'},{acquisition_alias_of:'alias'},{alias_source_sha256:'b'.repeat(64)},{schema:2}]){
    assert.throws(()=>tryAlias({...alias,catalogue:{...alias.catalogue,source_resolution:{...alias.catalogue.source_resolution,...changes}}}),/Invalid static source alias/);
  }
  assert.throws(()=>tryAlias({...alias,catalogue:{...alias.catalogue,lineage:[{source:'https://different.test/static'}]}}),/Invalid static source alias/);
  assert.throws(()=>tryAlias({...alias,output:'feeds/alias.json.gz'}),/Invalid static source alias/);
  for(const authentication_type of ['0','1','2']){
    const inventories=[{...base,shard:0,entries:[{...owner,catalogue:{...owner.catalogue,lineage:[{catalogue:'mobility-database',source:owner.catalogue.source,source_sha256:hash,authentication_type}]}},bikes]},{...base,shard:1,entries:[alias]}];
    if(authentication_type==='0')assert.equal(mergeInventories(inventories).entries.find(e=>e.id==='alias').status,'source_alias');
    else assert.throws(()=>mergeInventories(inventories),/Invalid static source alias/);
  }

  for(const policy of [{status:'excluded',reason_code:'provider_policy'},{status:'retry_pending',reason_code:'source_access_review'},{catalogue:{...owner.catalogue,source_resolution:{schema:1,state:'unresolved'}}}])assert.throws(()=>mergeInventories([{...base,shard:0,entries:[{...owner,...policy},bikes]},{...base,shard:1,entries:[alias]}]),/Invalid static source alias/);
  assert.throws(()=>mergeInventories([{...base,shard:0,entries:[{...owner,status:'source_alias',catalogue:{...owner.catalogue,source_resolution:{acquisition_alias_of:'alias'}}},bikes]},{...base,shard:1,entries:[alias]}]),/Invalid static source alias/);
});

test('assembled format-aware inventories keep alias provenance and emit one canonical feed',async()=>{
  const {gzipSync}=await import('node:zlib'),{readFile}=await import('node:fs/promises');
  const root=await mkdtemp(join(tmpdir(),'atlas-reference-assembly-')),hash=sourceHash('https://provider.test/static');
  const feed={schema:1,source:{id:'owner',sha256:'fixture-content',service_date:'2026-10-05',checked:'2026-10-04',name:'Rail',feed_info:{},valid_until:1900000000},agencies:[{agency_id:'a',agency_name:'Rail',agency_timezone:'UTC'}],routes:[{route_id:'r',route_type:'2'}],profiles:{h01:{start:'01:00:00',end:'02:00:00'}},segments:[{route_id:'r',agency_id:'a',geometry:[[0,0],[1,1]],profiles:{h01:{display_tph:2,forward_tph:2,backward_tph:2,quality:'scheduled'}}}]};
  try{
    await mkdir(join(root,'feeds'));await writeFile(join(root,'feeds/owner.json.gz'),gzipSync(JSON.stringify(feed)));
    const owner={id:'owner',country:'XX',status:'compiled',output:'feeds/owner.json.gz',sha256:'fixture-content',catalogue:{delivery:'direct',source:'https://provider.test/static',source_sha256:hash}};
    const alias={id:'alias',country:'XX',status:'source_alias',reason_code:'duplicate_static_source',catalogue:{source:owner.catalogue.source,source_sha256:hash,source_resolution:aliasProof(owner.catalogue.source,hash)}};
    const bikes={id:'bikes',country:'XX',status:'non_timetable',reason_code:'non_timetable_format'};
    const base={schema:3,shards:2,catalogue_url:null,catalogue_sha256:'fixture',catalogue_entries:3,service_date:'2026-10-05'};
    await writeFile(join(root,'inventory-0.json'),JSON.stringify({...base,shard:0,entries:[owner,bikes]}));
    await writeFile(join(root,'inventory-1.json'),JSON.stringify({...base,shard:1,entries:[alias]}));
    const manifest=await assemble(root);
    assert.deepEqual(manifest.counts,{source_alias:1,non_timetable:1,compiled:1});
    assert.equal(manifest.feeds.length,1);assert.equal(manifest.feeds[0].id,'owner');assert.equal(manifest.tiles,0);
    const inventory=JSON.parse(await readFile(join(root,'inventory.json'),'utf8'));
    assert.equal(inventory.entries.length,3);assert.equal(inventory.entries.find(e=>e.id==='alias').status,'source_alias');
    assert.deepEqual(await readdir(join(root,'feeds')),['owner.json.gz']);
  }finally{await rm(root,{recursive:true,force:true});}
});

function referencePublicationFixtures(){
  const run=spawnSync('python3',['-c',String.raw`
import sys,json,copy
sys.path.insert(0,'tests')
import global_frequency_test as test
p=test.pipeline
baseline=test.GlobalFrequency().projection_fixture()
baseline['source_resolution']['declarations'][0]['licence']={'spdx_identifier':'CC0-1.0','url':'https://provider.test/licence'}
baseline['source_resolution']['declarations'][0]['resolution']['endpoints'][0]['authorization']['info_url']='https://provider.test/docs?key=synthetic-query-marker'
paths=[['credentials'],['ordinary_static_declarations',0,'authorization'],['declarations',0,'api-key'],
 ['declarations',0,'definition','headers'],['declarations',0,'licence','credentials'],
 ['declarations',0,'resolution','credentials'],['declarations',0,'resolution','endpoints',0,'credentials'],
 ['declarations',0,'resolution','endpoints',0,'authorization','value'],
 ['declarations',0,'resolution','endpoints',0,'authorization','headers']]
cases=[]
for path in paths:
 row=copy.deepcopy(baseline); target=row['source_resolution']
 for key in path[:-1]: target=target[key]
 target[path[-1]]={'synthetic_marker':'synthetic-extra-marker'}
 prepared=p.registry.prepare_catalogue_row(row)
 cases.append({'path':path,'row':row,'prepared':p.published_metadata(prepared),
  'published':p.published_metadata(row)})
lineage_cases=[]
lineage_baseline=copy.deepcopy(baseline)
test.add_published_lineage(lineage_baseline,'https://public.test/static')
lineage_baseline['lineage'].append({'catalogue':'mobility-database','id':'known','url':p.registry.MOBILITY_CSV,'source':'https://public.test/static','status':'','authentication_type':'0'})
for i in range(len(lineage_baseline['lineage'])):
 for nested in [False,True]:
  row=copy.deepcopy(lineage_baseline)
  if nested: row['lineage'][i]['source']={'credentials':{'token':'synthetic-lineage-marker'}}
  else: row['lineage'][i]['credentials']={'token':'synthetic-lineage-marker'}
  lineage_cases.append({'row':row,'published':p.published_metadata(row),'prepared':p.published_metadata(p.registry.prepare_catalogue_row(row))})
print(json.dumps({'baseline':baseline,'cases':cases,'baseline_published':p.published_metadata(baseline),'lineage_cases':lineage_cases}))
`],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  return JSON.parse(run.stdout);
}

test('shared reference projection agrees across staging and both publication languages',async()=>{
  const {publishedMetadata}=await import('../scripts/assemble-global-frequency.mjs');
  const {referenceMetadataValid,projectReferenceMetadata}=await import('../scripts/frequency-reference-metadata.mjs');
  const {baseline,cases,baseline_published}=referencePublicationFixtures();
  assert.equal(referenceMetadataValid(baseline.source_resolution),true);
  assert.deepEqual(publishedMetadata(baseline),baseline_published);
  for(const {path,row,prepared,published} of cases){
    assert.equal(referenceMetadataValid(row.source_resolution),false,path.join('.'));
    for(const status of ['pending','retry_pending','excluded','non_timetable','compiled','no_rail']){
      const input={status,catalogue:row,source:{catalogue_attribution:row}};
      const output=publishedMetadata(input);
      assert.deepEqual(output.catalogue,published,path.join('.'));
      assert.deepEqual(output.source.catalogue_attribution,published);
      assert.deepEqual(prepared.source_resolution,published.source_resolution);
      assert.deepEqual(publishedMetadata(output),output);
      assert.doesNotMatch(JSON.stringify(output),/synthetic-extra-marker|synthetic-query-marker/);
      const metadata=output.catalogue.source_resolution;
      assert.equal(metadata.state,'unresolved');assert.equal(metadata.processed_filename,null);
      assert.equal(metadata.acquisition_alias_of,null);assert.equal(metadata.selected_static_declaration,null);
      const declaration=metadata.declarations[0],auth=declaration.resolution.endpoints[0].authorization;
      assert.equal(declaration.reference_id,'rt');assert.match(declaration.definition.sha256,/^[a-f0-9]{64}$/);
      assert.equal(auth.parameter_name,'Authorization');
      assert.equal(auth.info_url,'https://provider.test/docs?key=%5Bredacted%5D');
      assert.equal(referenceMetadataValid(metadata),true,'projected evidence stays structurally valid');
    }
  }
  for(const metadata of [null,[],{...baseline.source_resolution,declarations:Array(65).fill(baseline.source_resolution.declarations[0])},
      {...baseline.source_resolution,reason:'x'.repeat(81)}, {...baseline.source_resolution,reason:'😀'.repeat(80)}]){
    const projected=projectReferenceMetadata(metadata);
    assert.equal(projected.state,'unresolved');assert.equal(referenceMetadataValid(projected),true);
    assert.deepEqual(projectReferenceMetadata(projected),projected);
  }
});

test('assembly projects incoming held shard copies and compiled attribution before publication',async()=>{
  const {gzipSync}=await import('node:zlib'),{readFile}=await import('node:fs/promises');
  const {publishedMetadata}=await import('../scripts/assemble-global-frequency.mjs');
  const {cases}=referencePublicationFixtures(),row=cases[0].row;
  row.lineage[0].credentials={token:'synthetic-lineage-marker'};
  const root=await mkdtemp(join(tmpdir(),'atlas-reference-projection-'));
  const source={id:'rail',sha256:'fixture',service_date:'2026-10-05',checked:'2026-10-04',name:'Rail',feed_info:{},valid_until:1900000000,catalogue_attribution:row};
  const feed={schema:1,source,agencies:[{agency_id:'a',agency_name:'Rail',agency_timezone:'UTC'}],routes:[{route_id:'r',route_type:'2'}],profiles:{h01:{start:'01:00:00',end:'02:00:00'}},segments:[{route_id:'r',agency_id:'a',geometry:[[0,0],[1,1]],profiles:{h01:{display_tph:2,forward_tph:2,backward_tph:2,quality:'scheduled'}}}]};
  try{
    await mkdir(join(root,'feeds'));const raw=gzipSync(JSON.stringify(feed));
    await writeFile(join(root,'feeds/rail.json.gz'),raw);
    const entries=[{id:'rail',country:'XX',status:'compiled',sha256:'fixture',output:'feeds/rail.json.gz',catalogue:row},
      ...['retry_pending','excluded','non_timetable','no_rail'].map(status=>({id:status,status,catalogue:row}))];
    const shard={schema:3,shards:1,shard:0,catalogue_sha256:'fixture',catalogue_entries:entries.length,service_date:'2026-10-05',entries};
    await writeFile(join(root,'inventory-0.json'),JSON.stringify(shard));
    const manifest=await assemble(root);
    for(const name of ['inventory-0.json','inventory.json','manifest.json']){
      const output=JSON.parse(await readFile(join(root,name),'utf8'));
      assert.doesNotMatch(JSON.stringify(output),/synthetic-extra-marker|synthetic-query-marker|synthetic-lineage-marker/,name);
      assert.deepEqual(publishedMetadata(output),output,name+' remains idempotent');
    }
    const staged=JSON.parse(await readFile(join(root,'inventory-0.json'),'utf8'));
    assert.deepEqual(staged,publishedMetadata(shard));
    assert.equal(manifest.feeds[0].source.catalogue_attribution.source_resolution.reason,'invalid_reference_metadata');
    assert.deepEqual(await readFile(join(root,'feeds/rail.json.gz')),raw,'internal compiled payload remains unchanged');
    assert.equal(manifest.counts.compiled,1);assert.equal(manifest.counts.retry_pending,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('reference URL grammar is identical and publication-stable in both languages',async()=>{
  const {referenceUrlValid,referenceMetadataValid}=await import('../scripts/frequency-reference-metadata.mjs');
  const {publishedMetadata}=await import('../scripts/assemble-global-frequency.mjs');
  const urls=[
    ['https://provider.test/feed',true],['https://xn--a.test/feed',true],['HTTPS://PROVIDER.test/feed',true],['https://provider.test:443/feed',true],
    ['http://provider.test:0/feed',true],['https://provider.test:65535/feed',true],['https://provider.test:65536/feed',false],
    ['https://provider.test:99999/feed',false],['https://provider.test:invalid/feed',false],['https://provider.test:/feed',false],
    ['http://exa mple.test/feed',false],['https://provider.test/space here',false],['https://provider.test/line\nfeed',false],
    ['https://provider.test\\other/feed',false],['https://user:synthetic-pass@provider.test/feed?key=synthetic-query',true],
    ['https://[2001:db8::1]:443/feed',true],['https://[::ffff:192.0.2.1]/feed',true],['https://[bad:ip]/feed',false],
    ['https://provider.test./feed',true],['https://xn--bcher-kva.example/feed',true],['https://bücher.example/feed',false],
    ['https://provider.test/%E8%BB%8C',true],['https://provider.test/軌',false],['https://provider.test/%ZZ',false],
    ['http://192.0.2.1/feed',true],['http://127.1/feed',false],['http://0x7f000001/feed',false],['http://provider.123/feed',false],
    ['https://provider.test/feed?'+Array(129).fill('k=v').join('&'),false],
    ['https://provider.test/'+ 'a'.repeat(4074),true],['https://provider.test/'+ 'a'.repeat(4075),false],
    ['https://provider.test/'+ 'a'.repeat(4052)+'?k=v',false]
  ];
  const run=spawnSync('python3',['-c',String.raw`
import sys,json,copy
sys.path.insert(0,'tests');import global_frequency_test as t
p=t.pipeline;baseline=t.GlobalFrequency().projection_fixture();result=[]
for url,_ in json.loads(sys.argv[1]):
 row=copy.deepcopy(baseline);row['source_resolution']['declarations'][0]['resolution']['endpoints'][0]['authorization']['info_url']=url
 published=p.published_metadata(row)
 result.append({'valid':p.registry.references.reference_url_valid(url),'row':row,'state':published['source_resolution']['state'],
 'published':published,'idempotent':p.published_metadata(published)==published})
print(json.dumps(result))
`,JSON.stringify(urls)],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);const python=JSON.parse(run.stdout);
  for(let i=0;i<urls.length;i++){
    const [url,valid]=urls[i],fixture=python[i];
    assert.equal(referenceUrlValid(url),valid,url);assert.equal(fixture.valid,valid,url);
    assert.equal(referenceMetadataValid(fixture.row.source_resolution),valid,url);
    const published=publishedMetadata(fixture.row);
    assert.equal(published.source_resolution.state,fixture.state,url);
    assert.deepEqual(published,fixture.published,url+' uses the same supported URI redaction');
    assert.deepEqual(publishedMetadata(published),published,url);
    assert.equal(fixture.idempotent,true,url);
  }
});

test('reference lineage projection and alias reconciliation preserve complete owner links',async()=>{
  const {projectReferenceRow}=await import('../scripts/frequency-reference-metadata.mjs');
  const {publishedMetadata}=await import('../scripts/assemble-global-frequency.mjs');
  const hash=sourceHash('https://provider.test/feed'),base={schema:3,shards:1,shard:0,catalogue_sha256:'fixture',catalogue_entries:2,service_date:'2026-10-05'};
  const owner={id:'owner',status:'no_rail',catalogue:{delivery:'direct',source:'https://provider.test/feed',source_sha256:hash}};
  const alias={id:'alias',status:'source_alias',catalogue:{source:owner.catalogue.source,source_sha256:hash,
    source_resolution:aliasProof(owner.catalogue.source,hash)}};
  const merge=(a=alias,o=owner)=>mergeInventories([{...base,entries:[o,a]}]);
  assert.equal(publishedMetadata(merge()).entries.find(e=>e.id==='alias').catalogue.source_resolution.acquisition_alias_of,'owner');
  for(const extra of [{unknown_extra:{credential:'synthetic-lineage-marker'}},{specs:['gbfs']}]){
    const bad=structuredClone(alias);Object.assign(bad.catalogue.source_resolution,extra);
    assert.throws(()=>merge(bad),/Invalid static source alias/);
  }
  const badOwner=structuredClone(owner);badOwner.catalogue.source_resolution={...alias.catalogue.source_resolution,acquisition_alias_of:null,unknown_extra:'synthetic-lineage-marker'};
  assert.throws(()=>merge(alias,badOwner),/Invalid static source alias/);
  const {baseline,lineage_cases}=referencePublicationFixtures();
  for(const fixture of lineage_cases){
    assert.deepEqual(publishedMetadata(fixture.row),fixture.published);
    assert.deepEqual(fixture.prepared.source_resolution,fixture.published.source_resolution);
    assert.deepEqual(fixture.prepared.lineage,fixture.published.lineage);
    assert.deepEqual(publishedMetadata(fixture.published),fixture.published);
  }
  const licence={catalogue:'transitous-licence',id:baseline.filename,url:'https://github.com/public-transport/transitous/blob/'+ 'b'.repeat(40)+'/website/data/license.json',source:''};
  baseline.catalogue_url=licence.url;baseline.lineage.push(licence);
  for(const index of [0,baseline.lineage.length-1]){
    const bad=structuredClone(baseline);bad.lineage[index].credentials={token:'synthetic-lineage-marker'};
    const projected=projectReferenceRow(bad);assert.equal(projected.source_resolution.state,'unresolved');
    assert.doesNotMatch(JSON.stringify(projected),/synthetic-lineage-marker/);
    assert.deepEqual(projectReferenceRow(projected),projected);
    const output=publishedMetadata({status:'compiled',catalogue:bad,source:{catalogue_attribution:bad}});
    assert.doesNotMatch(JSON.stringify(output),/synthetic-lineage-marker/);assert.deepEqual(publishedMetadata(output),output);
  }
  const legacy={lineage:[{catalogue:'fixture',unknown_extra:'ordinary-fixture'}]};
  assert.deepEqual(projectReferenceRow(legacy),legacy,'legacy non-reference rows keep their established behavior');
});

test('alias ownership binds visible resources and recoverable raw hashes',async()=>{
  const {publishedMetadata}=await import('../scripts/assemble-global-frequency.mjs');
  const base={schema:3,shards:1,shard:0,catalogue_sha256:'fixture',catalogue_entries:2,service_date:'2026-10-05'};
  const fixture=url=>{
    const hash=sourceHash(url),owner={id:'owner',status:'no_rail',catalogue:{delivery:'direct',source:url,source_sha256:hash}};
    const alias={id:'alias',status:'source_alias',catalogue:{source:url,source_sha256:hash,source_resolution:aliasProof(owner.catalogue.source,hash)}};
    return {owner,alias};
  };
  const merge=(owner,alias)=>mergeInventories([{...base,entries:[owner,alias]}]);
  for(const url of ['https://provider.test/feed','https://provider.test/feed?region=one&mode=rail']){
    const {owner,alias}=fixture(url);
    assert.equal(merge(owner,alias).entries[0].status,'source_alias');
    for(const other of ['https://different.test/feed','https://provider.test/other','https://provider.test/feed?region=two&mode=rail']){
      const bad=structuredClone(alias);bad.catalogue.source=other;
      assert.throws(()=>merge(owner,bad),/Invalid static source alias/,'copied original hash is not source equivalence');
    }
    const invalidOwner=structuredClone(owner);invalidOwner.catalogue.source='unusable';
    invalidOwner.catalogue.lineage=[{source:url,source_sha256:owner.catalogue.source_sha256}];
    assert.throws(()=>merge(invalidOwner,alias),/Invalid static source alias/);
    const publicOwner=publishedMetadata(owner),publicAlias=publishedMetadata(alias);
    assert.equal(merge(publicOwner,publicAlias).entries[0].status,'source_alias');
    assert.equal(merge(owner,publicAlias).entries[0].status,'source_alias');
    assert.equal(merge(publicOwner,alias).entries[0].status,'source_alias');
    const bad=structuredClone(publicAlias);bad.catalogue.source=bad.catalogue.source.replace('/feed','/other');
    assert.throws(()=>merge(publicOwner,bad),/Invalid static source alias/);
    if(url.includes('?')){
      const hidden=structuredClone(publicAlias);hidden.catalogue.source_sha256='b'.repeat(64);
      assert.throws(()=>merge(publicOwner,hidden),/Invalid static source alias/,'same display retains distinct original hashes');
      const visible=structuredClone(publicAlias);visible.catalogue.source=visible.catalogue.source.replace('%5Bredacted%5D','different');
      assert.throws(()=>merge(publicOwner,visible),/Invalid static source alias/);
    }
  }
});

test('versioned resource syntax has exact Python JavaScript fixture parity',async()=>{
  const {referenceResourceKey,referenceDisplayUrl,resourceNormalization}=await import('../scripts/frequency-reference-metadata.mjs');
  const vectors=JSON.parse(await readFile(new URL('./fixtures/service-frequency/resource-syntax-v2.json',import.meta.url),'utf8'));
  assert.equal(resourceNormalization,vectors.normalization);
  for(const {url,key} of vectors.canonical)assert.deepEqual(referenceResourceKey(url),key);
  const urls=[...vectors.canonical.map(x=>x.url),...vectors.pairs.flatMap(x=>[x.a,x.b]),...vectors.invalid];
  const python=spawnSync('python3',['-c',"import json,sys;sys.path.insert(0,'scripts');import frequency_references as r;print(json.dumps([r.resource_key(x) for x in json.load(sys.stdin)]))"],{input:JSON.stringify(urls),encoding:'utf8'});
  assert.equal(python.status,0,python.stderr);assert.deepEqual(urls.map(referenceResourceKey),JSON.parse(python.stdout));
  for(const {a,b,equal} of vectors.pairs){assert.equal(JSON.stringify(referenceResourceKey(a))===JSON.stringify(referenceResourceKey(b)),equal);assert.notEqual(sourceHash(a),sourceHash(b));}
  for(const url of vectors.invalid)assert.equal(referenceResourceKey(url),null);
  // The identity helper must not rewrite caller inputs or public display bytes.
  const raw='https://public.test/a%2fb?region=synthetic-value',display=referenceDisplayUrl(raw);
  referenceResourceKey(raw);assert.equal(raw,'https://public.test/a%2fb?region=synthetic-value');
  assert.equal(referenceDisplayUrl(raw),display);assert.match(display,/a%2fb/);
});

test('resource syntax applies to published alias holds without replacing original identity',async()=>{
  const {publishedMetadata}=await import('../scripts/assemble-global-frequency.mjs');
  const {referenceResourceKey,referenceDisplayUrl}=await import('../scripts/frequency-reference-metadata.mjs');
  const vectors=JSON.parse(await readFile(new URL('./fixtures/service-frequency/resource-syntax-v2.json',import.meta.url),'utf8'));
  const base={schema:3,shards:1,shard:0,catalogue_entries:2,catalogue_sha256:'fixture'};
  for(const {a,b,equal} of vectors.pairs){
    const hash=sourceHash(a),owner={id:'owner',status:'no_rail',catalogue:{delivery:'direct',source:a,source_sha256:hash}};
    const alias={id:'alias',status:'source_alias',catalogue:{source:a,source_sha256:hash,source_resolution:aliasProof(a,hash)}};
    alias.catalogue.source_resolution.ordinary_static_declarations=[{type:'http',spec:'gtfs',url:b,url_sha256:sourceHash(b),access_state:'authorization_required',upstream_skip:true,definition:{url:'https://github.test/source.json',pointer:'/sources/1',sha256:'c'.repeat(64)}}];
    const merge=entries=>mergeInventories([{...base,entries}]);
    if(equal)assert.throws(()=>merge([owner,alias]),/Invalid static source alias/);
    else assert.equal(merge([owner,alias]).entries.find(x=>x.id==='alias').status,'source_alias');
    const uncertain=(a.includes('?')||b.includes('?'))&&JSON.stringify(referenceResourceKey(referenceDisplayUrl(a)))===JSON.stringify(referenceResourceKey(referenceDisplayUrl(b)));
    const entries=publishedMetadata([owner,alias]);
    if(equal||uncertain)assert.throws(()=>merge(entries),/Invalid static source alias/);
    else assert.equal(merge(entries).entries.find(x=>x.id==='alias').status,'source_alias');
  }
  const url='https://public.test/a%2fb?region=synthetic-value',hash=sourceHash(url);
  const owner=publishedMetadata({id:'owner',status:'no_rail',catalogue:{delivery:'direct',source:url,source_sha256:hash}});
  const alias=publishedMetadata({id:'alias',status:'source_alias',catalogue:{source:url,source_sha256:hash,source_resolution:aliasProof(url,hash)}});
  alias.catalogue.source=alias.catalogue.source.replace('%2f','%2F');
  alias.catalogue.source_resolution.declarations[0].resolution.endpoints[0].url=alias.catalogue.source;
  assert.equal(mergeInventories([{...base,entries:[owner,alias]}]).entries.find(x=>x.id==='alias').status,'source_alias');
  alias.catalogue.source_sha256='d'.repeat(64);
  assert.throws(()=>mergeInventories([{...base,entries:[owner,alias]}]),/Invalid static source alias/);
});

test('alias owner authentication accepts only supported scalar public values',async()=>{
  const {publishedMetadata}=await import('../scripts/assemble-global-frequency.mjs');
  // Send the same literal JSON to both parsers; stringify would erase 0.0/0e0.
  const tokens=['null','""','"0"','0','0.0','0e0','-0.0','1e-400','"none"','" NONE "','"1"','1','"2"','false','true','[]','["0"]','{}','0.5','-0.5','1e309','-1e309'];
  const literal='['+tokens.join(',')+']',values=JSON.parse(literal),expected=values.map((_,index)=>index<10);
  const python=spawnSync('python3',['-c',"import json,sys; sys.path.insert(0,'scripts'); import frequency_references as r; print(json.dumps([r.alias_owner_metadata_compatible({'lineage':[{'catalogue':'mobility-database','authentication_type':x}]}) for x in json.load(sys.stdin)]))"],{input:literal,encoding:'utf8'});
  assert.equal(python.status,0,python.stderr);assert.deepEqual(JSON.parse(python.stdout),expected);
  const url='https://public.test/feed',hash=sourceHash(url),base={schema:3,shards:1,shard:0,catalogue_entries:2,catalogue_sha256:'fixture'};
  for(const [index,authentication_type] of values.entries()){
    const owner={id:'owner',status:'no_rail',catalogue:{delivery:'direct',source:url,source_sha256:hash,lineage:[{catalogue:'mobility-database',authentication_type}]}};
    const alias={id:'alias',status:'source_alias',catalogue:{source:url,source_sha256:hash,source_resolution:aliasProof(url,hash)}};
    const before=structuredClone(owner);
    const copies=[[owner,alias],[publishedMetadata(owner),publishedMetadata(alias)]];
    // Nonfinite numbers are rejected before serialization can turn them null.
    if(typeof authentication_type!=='number'||Number.isFinite(authentication_type))copies.push(JSON.parse(JSON.stringify(copies[1])));
    for(const entries of copies){
      const merge=()=>mergeInventories([{...base,entries}]);
      if(expected[index])assert.equal(merge().entries.find(x=>x.id==='alias').status,'source_alias');
      else assert.throws(merge,/Invalid static source alias/);
    }
    assert.deepEqual(owner,before,'alias validation never rewrites the legacy owner');
  }
  const generated=spawnSync('python3',['-c',[
    'import json,sys; sys.path.insert(0,"tests")',
    'from global_frequency_test import alias_owner_literal_fixture,fixture_discover,pipeline',
    'result=[]',
    'for literal in json.load(sys.stdin):',
    ' entries=fixture_discover(alias_owner_literal_fixture(literal),{})',
    ' result.append({"raw":entries,"published":pipeline.published_metadata(entries)})',
    'print(json.dumps(result,allow_nan=False))'
  ].join('\n')],{input:JSON.stringify(tokens.slice(0,-2)),encoding:'utf8'});
  assert.equal(generated.status,0,generated.stderr);
  for(const [index,fixture] of JSON.parse(generated.stdout).entries()){
    for(const input of [fixture.raw,fixture.published]){
      // Compiler publication supplies original fingerprints before assembly.
      const entries=publishedMetadata(input);
      const result=mergeInventories([{...base,entries}]);
      assert.equal(result.entries.find(x=>x.id==='xx_reference').status,expected[index]?'source_alias':'retry_pending');
      assert.deepEqual(result.entries.find(x=>x.id==='mdb_owner'),entries.find(x=>x.id==='mdb_owner'));
    }
  }
});

test('alias assembly requires its own semantic public static proof and respects row holds',async()=>{
  const {publishedMetadata}=await import('../scripts/assemble-global-frequency.mjs');
  const url='https://public.test/feed',hash=sourceHash(url),base={schema:3,shards:1,shard:0,catalogue_entries:2,catalogue_sha256:'fixture'};
  const owner={id:'owner',status:'no_rail',catalogue:{delivery:'direct',source:url,source_sha256:hash}};
  const baseline={id:'alias',status:'source_alias',catalogue:{source:url,source_sha256:hash,source_resolution:aliasProof(url,hash)}};
  const merge=alias=>mergeInventories([{...base,entries:[owner,alias]}]);
  const ordinary=value=>({type:'http',spec:'gtfs',url:value,url_sha256:sourceHash(value),access_state:'authorization_required',upstream_skip:true,definition:{url:'https://github.test/xx.json',pointer:'/sources/1',sha256:'c'.repeat(64)}});
  for(const change of ['held_static','review_static','held_effective','held_declared','held_ordinary','held_mobility','row_hold','no_declarations','missing_selection','inconsistent_access','active_static','active_ordinary','held_empty_params','unknown_skip']){
    const alias=structuredClone(baseline),r=alias.catalogue.source_resolution,d=r.declarations[0],e=d.resolution.endpoints[0];
    if(change==='held_static'||change==='review_static'){
      r.selected_static_declaration=null;e.access_state=change==='held_static'?'authorization_required':'review_required';d.resolution.state=change==='held_static'?'authorization_required':'transport_options_required';
    }else if(change==='held_effective'||change==='held_declared'){
      const held=structuredClone(d);held.id='d'.repeat(64);held.reference_id='held';held.resolution.state='authorization_required';
      const endpoint=held.resolution.endpoints[0];endpoint.access_state='authorization_required';endpoint.url='https://other.test/feed';endpoint.url_sha256=sourceHash(endpoint.url);
      const value='https://PUBLIC.test:443/feed#fixture';endpoint[change==='held_effective'?'url':'declared_url']=value;endpoint[(change==='held_effective'?'url':'declared_url')+'_sha256']=sourceHash(value);r.declarations.push(held);
    }else if(change==='held_ordinary')r.ordinary_static_declarations=[ordinary('https://PUBLIC.test:443/feed#fixture')];
    else if(change==='held_mobility')alias.catalogue.lineage=[{catalogue:'mobility-database',id:'held',url:'https://files.mobilitydatabase.org/feeds_v2.csv',source:'https://PUBLIC.test:443/feed#fixture',source_sha256:sourceHash('https://PUBLIC.test:443/feed#fixture'),status:'',authentication_type:'1'}];
    else if(change==='held_empty_params')r.ordinary_static_declarations=[ordinary(url+';')];
    else if(change==='row_hold')alias.catalogue.access_review=[{reason:'fixture_hold'}];
    else if(change==='no_declarations')r.declarations=[];
    else if(change==='missing_selection')r.selected_static_declaration=null;
    else if(change==='inconsistent_access')d.resolution.state='authorization_required';
    else if(change==='active_static')d.upstream_skip=false;
    else if(change==='active_ordinary')r.ordinary_static_declarations=[{...ordinary(url),access_state:'public_declared',upstream_skip:false}];
    else delete d.upstream_skip;
    assert.throws(()=>merge(alias),/Invalid static source alias/,change);
    assert.throws(()=>merge(publishedMetadata(alias)),/Invalid static source alias/,change+' after projection');
  }
  const companion=structuredClone(baseline),r=companion.catalogue.source_resolution,rt=structuredClone(r.declarations[0]);
  rt.id='d'.repeat(64);rt.reference_id='rt';rt.declared_spec='gtfs-rt';rt.resolution={state:'authorization_required',specs:['gtfs-rt'],endpoints:[{role:'realtime_trip_updates',spec:'gtfs-rt',url:'https://private.test/rt',url_sha256:sourceHash('https://private.test/rt'),url_origin:'metadata',access_state:'authorization_required'}]};
  r.declarations.push(rt);r.specs.push('gtfs-rt');r.ordinary_static_declarations=[ordinary('https://different.test/held')];
  assert.equal(merge(companion).entries[0].status,'source_alias');
  assert.equal(merge(publishedMetadata(companion)).entries[0].status,'source_alias');
  for(const publicUrl of ['https://public.test/feed?region=one','https://public.test/feed?region=two']){
    const h=sourceHash(publicUrl),a={id:'alias',status:'source_alias',catalogue:{source:publicUrl,source_sha256:h,source_resolution:aliasProof(publicUrl,h)}};
    a.catalogue.source_resolution.ordinary_static_declarations=[ordinary('https://PUBLIC.test:443/feed?region=one#held')];
    const o={...owner,catalogue:{...owner.catalogue,source:publicUrl,source_sha256:h}};
    const run=entry=>mergeInventories([{...base,entries:[o,entry]}]);
    if(publicUrl.endsWith('one'))assert.throws(()=>run(a),/Invalid static source alias/);
    else assert.equal(run(a).entries[0].status,'source_alias','distinct fully raw query values remain separate');
    assert.throws(()=>run(publishedMetadata(a)),/Invalid static source alias/,'redacted held original remains uncertain');
  }
});
