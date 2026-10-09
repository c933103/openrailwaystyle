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

test('aggregate publication scans exclude synthetic URL secrets and retain accounting and raw files',async()=>{
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
    assert.equal(await readFile(join(root,'inventory-0.json'),'utf8'),shard,'raw shard file stays unchanged');
  }finally{console.log=originalLog;await rm(root,{recursive:true,force:true});}
});
