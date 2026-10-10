// Offline publication and disposable-artifact regressions. Node 22 supported.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gzipSync,gunzipSync} from 'node:zlib';
import net from 'node:net';
import {createHash} from 'node:crypto';
import dns from 'node:dns';
const deny=()=>{throw new Error('network_and_dns_forbidden');};
net.Socket.prototype.connect=deny;dns.lookup=deny;dns.resolve=deny;globalThis.fetch=deny;
const root=resolve(process.env.ATLAS_SOURCE_ROOT||fileURLToPath(new URL('../',import.meta.url)));
const {publishedMetadata,assemble,mergeInventories}=await import(pathToFileURL(join(root,'scripts/assemble-global-frequency.mjs')));
const {validateAppliedFrequency}=await import(pathToFileURL(join(root,'scripts/stage-applied-frequency.mjs')));
const {createTimetableMatcher}=await import(pathToFileURL(join(root,'scripts/timetable-frequency.mjs')));
const {table,feed,now}=await import(pathToFileURL(join(root,'tests/fixtures/service-frequency/matching-fixture.mjs')));
const marker='synthetic-unpublished-lineage-marker',url='https://feeds.example.test/static.zip?region=synthetic-one';
const lineage={catalogue:'mobility-database',id:'synthetic',url:'https://files.mobilitydatabase.org/feeds_v2.csv',source:url,status:'active',authentication_type:'0',authorization:{value:marker},debug:{nested:[marker]}};
test('applied aggregate staging binds compressed bytes, OSM sections and safe publication metadata',()=>{
 const artifact={schema:1,osm_sha256:'a'.repeat(64),records:[],sections:[],feeds:[],matching:{sections:0,feeds:[]}},bytes=gzipSync(JSON.stringify(artifact));
 const manifest={applied_profiles:{schema:1,file:'profiles.json.gz',sha256:createHash('sha256').update(bytes).digest('hex'),osm_sha256:artifact.osm_sha256,sections:0}};
 assert.deepEqual(validateAppliedFrequency(bytes,manifest),artifact);
 for(const change of [m=>m.applied_profiles.sha256='b'.repeat(64),m=>m.applied_profiles.osm_sha256='b'.repeat(64),m=>m.applied_profiles.sections=1,m=>m.applied_profiles.file='../profiles.json.gz']){const m=structuredClone(manifest);change(m);assert.throws(()=>validateAppliedFrequency(bytes,m));}
 const changed={...artifact,records:[{properties:{frequency_until:1900000000,frequency_sources:'fixture'},profiles:{am:{rate:-1,high:0,quality:'scheduled'}}}]},bad=gzipSync(JSON.stringify(changed)),bound=structuredClone(manifest);bound.applied_profiles.sha256=createHash('sha256').update(bad).digest('hex');assert.throws(()=>validateAppliedFrequency(bad,bound));
 const unsafe={...artifact,feeds:[{source:{url:'https://user:synthetic@public.example.test/feed?token=synthetic'}}]},raw=gzipSync(JSON.stringify(unsafe));bound.applied_profiles.sha256=createHash('sha256').update(raw).digest('hex');assert.throws(()=>validateAppliedFrequency(raw,bound));
});
test('a nonempty matched aggregate retains counts and section bindings through the actual stage worker',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'atlas-applied-stage-'));
 try{
  const matcher=createTimetableMatcher(table(),{now});matcher.addFeed(feed());const artifact=publishedMetadata(matcher.finish()),bytes=gzipSync(JSON.stringify(artifact));
  const manifest={applied_profiles:{schema:1,file:'profiles.json.gz',sha256:createHash('sha256').update(bytes).digest('hex'),osm_sha256:artifact.osm_sha256,sections:artifact.sections.length}};
  const manifestPath=join(directory,'manifest.json'),profilePath=join(directory,'profiles.json.gz');await writeFile(manifestPath,JSON.stringify(manifest));await writeFile(profilePath,bytes);
  const result=spawnSync(process.execPath,[join(root,'scripts/stage-applied-frequency.mjs'),manifestPath,profilePath],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const staged=await readFile(profilePath),binding=JSON.parse(await readFile(manifestPath));assert.deepEqual(validateAppliedFrequency(staged,binding),artifact);assert.equal(artifact.sections.length,3);assert.deepEqual(artifact.records.map(r=>r.profiles.am.rate).sort((a,b)=>a-b),[4,7,10]);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('legacy lineage in every outcome drops unsupported nested fields',()=>{
  for(const status of ['compiled','excluded','retry_pending','failed','no_rail','non_timetable','source_alias']){
    const value={id:'fixture',status,catalogue:{lineage:[lineage]},source:{catalogue_lineage:[lineage]}};
    const original=structuredClone(value),result=publishedMetadata(value);
    assert.deepEqual(value,original);
    assert.ok(!JSON.stringify(result).includes(marker),status);
  }
});
test('malformed authority/container/hash is rejected rather than repaired into new authority',()=>{
  for(const value of [{lineage:null},{lineage:{value:marker}},{lineage:[null]},
    {lineage:[{...lineage,authentication_type:{value:marker}}]},
    {lineage:[{...lineage,source_sha256:'invalid'}]}])assert.throws(()=>publishedMetadata(value));
});
test('valid scalar auth, fingerprints and existing Unicode display are preserved',()=>{
  for(const auth of ['0','none','',null,0,1,true,false,1.5,'key'])assert.equal(publishedMetadata({lineage:[{...lineage,authentication_type:auth}]}).lineage[0].authentication_type,auth);
  const original={lineage:[{...lineage,source:'https://例子.test/鉄道.zip',source_sha256:'a'.repeat(64)}]};
  const result=publishedMetadata(original);
  assert.equal(result.lineage[0].source,'https://xn--fsqu00a.test/%E9%89%84%E9%81%93.zip');
  assert.equal(result.lineage[0].source_sha256,'a'.repeat(64));
  assert.deepEqual(publishedMetadata(result),result);
});
test('external retained gzip remains raw input; assembly coverage alone cannot certify artifact upload',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'atlas-staged-boundary-'));
  try{
    await mkdir(join(directory,'feeds'));
    const id='https://ids.example.test/r?identity=keep';
    const source={id:'fixture',sha256:'a'.repeat(64),service_date:'2026-10-05',checked:'2026-10-05',name:'Fixture',
      feed_info:{},valid_until:1900000000,catalogue_lineage:[lineage],catalogue_attribution:{source:url,lineage:[lineage]},license:'CC-BY-4.0',rights:{attribution_required:true}};
    const feed={schema:1,source,agencies:[{agency_id:'a',agency_name:'Fixture',agency_timezone:'UTC'}],routes:[{route_id:id,route_type:'1'}],profiles:{h01:{start:'01:00:00',end:'02:00:00'}},segments:[{route_id:id,agency_id:'a',trip_id:'https://ids.example.test/t?identity=keep',geometry:[[0,0],[1,1]],profiles:{h01:{display_tph:2,forward_tph:2,backward_tph:2,quality:'scheduled'}}}]};
    const compressed=gzipSync(JSON.stringify(feed));
    await writeFile(join(directory,'feeds/fixture.json.gz'),compressed);
    await writeFile(join(directory,'inventory-0.json'),JSON.stringify({schema:3,shard:0,shards:1,catalogue_sha256:'b'.repeat(64),catalogue_entries:1,service_date:'2026-10-05',entries:[{id:'fixture',status:'compiled',output:'feeds/fixture.json.gz',sha256:source.sha256,country:'ZZ',catalogue:{source:url,lineage:[lineage]}}]}));
    const manifest=await assemble(directory),retained=await readFile(join(directory,'feeds/fixture.json.gz'));
    assert.deepEqual(retained,compressed,'Read-only input contract: future artifact stage must use a separate destination');
    assert.deepEqual(JSON.parse(gunzipSync(retained)).segments,feed.segments);
    assert.equal(manifest.counts.compiled,1);assert.equal(manifest.tiles,0);
    assert.ok(JSON.stringify(JSON.parse(gunzipSync(retained))).includes(marker),'Characterizes retained input, not a claim that the future upload boundary is safe');
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('both intermediate artifact uploads use isolated validated staging',async()=>{
  const workflow=await readFile(join(root,'.github/workflows/service-frequency.yml'),'utf8');
  const compile=workflow.split('\n  compile:\n')[1].split('\n  assemble:\n')[0];
  const assembled=workflow.split('\n  assemble:\n')[1].split('\n  publish:\n')[0];
  for(const job of [compile,assembled]){
    assert.match(job,/scripts\/stage-frequency-artifact\.py/);
    assert.doesNotMatch(job,/path: frequency-output\//);
  }
});
test('release aggregates and operational catalogue acquisition handoff remain exact',async()=>{
  const workflow=await readFile(join(root,'.github/workflows/service-frequency.yml'),'utf8');
  for(const file of ['catalogue/catalogue.json','catalogue/catalogue-report.json','catalogue/publication-index.json','catalogue/inventory-0.json'])assert.ok(workflow.includes(file));
  assert.match(workflow,/tar -czf frequency-snapshot\.tar\.gz -C frequency-output manifest\.json inventory\.json profiles\.json\.gz tiles/);
});


test('publication never makes a previously rejected legacy owner valid alias proof',()=>{
  const source='https://public.example.test/feed',hash=createHash('sha256').update(source).digest('hex');
  const proof={schema:1,state:'schedule',specs:['gtfs'],processed_filename:null,acquisition_alias_of:'owner',alias_source_sha256:hash,selected_static_declaration:'a'.repeat(64),declarations:[{id:'a'.repeat(64),type:'transitland-atlas',reference_id:'static',declared_spec:null,upstream_skip:true,upstream_skip_reason:'',definition:{url:'https://github.test/xx.json',pointer:'/sources/0',sha256:'b'.repeat(64)},resolution:{state:'resolved',specs:['gtfs'],endpoints:[{role:'static_current',spec:'gtfs',url:source,url_sha256:hash,url_origin:'metadata',access_state:'public_declared'}]}}]};
  const base={schema:3,shards:1,shard:0,catalogue_entries:2,catalogue_sha256:'fixture'};
  const accepts=entries=>{try{mergeInventories([{...base,entries}]);return true;}catch{return false;}};
  for(const bad of ['https://[broken]/feed','https://例子.test/feed']){
    const entries=[{id:'owner',status:'no_rail',catalogue:{delivery:'direct',source,source_sha256:hash,lineage:[{catalogue:'mobility-database',source:bad,authentication_type:'0'}]}},{id:'alias',status:'source_alias',catalogue:{source,source_sha256:hash,source_resolution:proof}}];
    assert.equal(accepts(entries),false);
    let projected;try{projected=publishedMetadata(entries);}catch{continue;}
    assert.equal(accepts(projected),false,'Either reject the malformed publication or preserve the pre-publication alias rejection');
  }
  const entries=[{id:'owner',status:'no_rail',catalogue:{delivery:'direct',source,source_sha256:hash,lineage:[{catalogue:'mobility-database',source,authentication_type:'0'}]}},{id:'alias',status:'source_alias',catalogue:{source,source_sha256:hash,source_resolution:proof}}];
  assert.equal(accepts(entries),true);assert.equal(accepts(publishedMetadata(entries)),true);
  const raw='https://synthetic:synthetic@public.example.test/feed?key=synthetic';
  const rawHash=createHash('sha256').update(raw).digest('hex');
  const display='https://public.example.test/feed?key=%5Bredacted%5D';
  const sourceOnly=structuredClone(entries);
  sourceOnly[0].catalogue={delivery:'direct',source:raw,source_sha256:rawHash};
  const alias=sourceOnly[1].catalogue;
  alias.source=display;alias.source_sha256=rawHash;
  alias.source_resolution.alias_source_sha256=rawHash;
  alias.source_resolution.declarations[0].resolution.endpoints[0].url=display;
  alias.source_resolution.declarations[0].resolution.endpoints[0].url_sha256=rawHash;
  assert.equal(accepts(sourceOnly),false);
  const safe=publishedMetadata(sourceOnly);
  assert.equal(safe[0].catalogue.publication_alias_eligible,false);
  assert.equal(accepts(safe),false);
  assert.deepEqual(publishedMetadata(safe),safe);
  entries[0].catalogue.publication_alias_eligible=false;
  assert.equal(accepts(publishedMetadata(entries)),false,'A publication-only rejection is monotone');
});

import {spawnSync} from 'node:child_process';
test('offline Python publication and disposable staging regressions',()=>{
  for(const pattern of ['frequency_publication_boundary_test.py','frequency_artifact_staging_test.py']){
    const result=spawnSync('python3',['-m','unittest','discover','-s','tests','-p',pattern],{encoding:'utf8',cwd:root});
    assert.equal(result.status,0,result.stdout+result.stderr);
  }
});

test('legacy projection has shared scalar/hash/marker semantics across runtimes',()=>{
  const cases=[
    {source:url,lineage:[lineage],catalogue_lineage:[lineage]},
    {delivery:'direct',source:'synthetic-plain-source',lineage:[{source:'synthetic:plain'}]},
    {source:'https://PUBLIC.example.test/feed',lineage:[{source:'https://PUBLIC.example.test/feed'}]},
    {source:url,lineage:[{...lineage,authentication_type:0}],publication_alias_eligible:true},
    {source:url,lineage:[{...lineage,authentication_type:1}],publication_alias_eligible:true},
    {source:url,lineage:[lineage],publication_alias_eligible:false},
    {lineage:[{source:'https://public.example.test/?key=%5Bredacted%5D',source_sha256:'a'.repeat(64)}]},
  ];
  const code=`import json,sys,importlib.util; from pathlib import Path; spec=importlib.util.spec_from_file_location('p',Path('scripts/global-service-frequency.py')); p=importlib.util.module_from_spec(spec); spec.loader.exec_module(p); print(json.dumps(p.published_metadata(json.load(sys.stdin)),allow_nan=False))`;
  const python=spawnSync('python3',['-c',code],{input:JSON.stringify(cases),encoding:'utf8',cwd:root});
  assert.equal(python.status,0,python.stderr);
  assert.deepEqual(publishedMetadata(cases),JSON.parse(python.stdout));
  assert.deepEqual(publishedMetadata(publishedMetadata(cases)),publishedMetadata(cases));
  for(const marker of [null,0,1,'false',[],{}])assert.throws(()=>publishedMetadata({lineage:[],publication_alias_eligible:marker}),/invalid_publication_alias_marker/);
});


test('plain legacy metadata stays readable without becoming alias authority',()=>{
  for(const source of ['synthetic-plain-source','synthetic:plain','','[invalid source URL]']){
    const row={delivery:'direct',source,lineage:[{catalogue:'mobility-database',source,authentication_type:'0'}]};
    const result=publishedMetadata(row);
    assert.equal(result.lineage[0].source,source);assert.equal(result.publication_alias_eligible,false);
    assert.deepEqual(publishedMetadata(result),result);
  }
  const row={source:'https://PUBLIC.example.test/feed',lineage:[{source:'https://PUBLIC.example.test/feed'}]};
  const result=publishedMetadata(row);assert.equal(result.publication_alias_eligible,false);
  assert.deepEqual(publishedMetadata(result),result);
  assert.throws(()=>publishedMetadata({lineage:[{source:'https://[broken]/feed'}]}),/invalid_publication_lineage_url/);
});
