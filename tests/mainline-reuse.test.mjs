import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm,cp,chmod} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import vtpbf from 'vt-pbf';
import {DATA_INPUTS,REFERENCE_INPUTS,generationWorkflowInputs,referenceDataInputDigest,referenceInputDigest} from '../scripts/mainline-provenance.mjs';
import {reusableReference,planReferenceReuse} from '../scripts/plan-mainline-reuse.mjs';
import {MAINLINE_REGIONS,MAINLINE_CONTROLS,sha256} from '../scripts/mainline-coverage.mjs';

const hash='a'.repeat(64),other='b'.repeat(64),sha='c'.repeat(40);
const sources=()=>MAINLINE_REGIONS.map(region=>({schema:1,complete:true,region,date:'2026-10-09',license:'ODbL-1.0',
 url:`https://download.geofabrik.de/${region}-261009.osm.pbf`,sourceTimestamp:'2026-10-09T20:00:00Z',
 pbfBytes:100,pbfSha256:hash,exportBytes:100,exportSha256:other}));
const manifest=()=>({schema:1,complete:true,generation:'d'.repeat(24),minzoom:0,maxzoom:6,wayCount:1,license:'ODbL-1.0',
 indexSha256:hash,inputSha256:other,sourceDate:'2026-10-09',oldestSource:'2026-10-09T20:00:00Z',newestSource:'2026-10-09T20:00:00Z',
 sources:sources(),rendererAcceptance:{complete:true}});

test('modern generator identity permits fresh renderer acceptance without changing the dataset',async()=>{
 const m={...manifest(),dataInputSha256:hash},before=structuredClone(m);
 assert.equal(await reusableReference(m,{dataDigest:hash}),true);
 assert.equal(await reusableReference(m,{dataDigest:other}),false);
 assert.deepEqual(m,before,'selection does not rewrite source dates, checksums or old renderer claims');
});
test('legacy adoption requires both exact old renderer provenance and unchanged generating code',async()=>{
 const m=manifest();
 assert.equal(await reusableReference(m,{dataDigest:hash,legacyInputDigest:other,legacyDataDigest:hash}),true);
 for(const proof of [{},{legacyInputDigest:hash,legacyDataDigest:hash},{legacyInputDigest:other,legacyDataDigest:other}])
  assert.equal(await reusableReference(m,{dataDigest:hash,...proof}),false);
});
for(const [label,patch] of [['incomplete',{complete:false}],['invalid generator',{dataInputSha256:'broken'}],
 ['no renderer',{rendererAcceptance:null}],['no accepted key',{inputSha256:'broken'}],
 ['changed source date',{sourceDate:'2026-10-10'}],['missing continent',{sources:sources().slice(1)}]]){
 test(`invalid published candidate cannot become a reuse result: ${label}`,async()=>{
  await assert.rejects(reusableReference({...manifest(),...patch},{dataDigest:hash,legacyInputDigest:other,legacyDataDigest:hash}));
 });
}
test('scheduled and explicit refreshes never silently select an older generation',async()=>{
 for(const options of [{event:'schedule'},{event:'workflow_dispatch'},{event:'pull_request',requestedDate:'2026-10-10'}]){
  const result=await planReferenceReuse({...options,readPublished:()=>{throw Error('must not read candidate');}});
  assert.deepEqual(result,{reuse:false,reason:'explicit-refresh'});
 }
});
test('PR/push reuse pins the exact reference ref and date, without invoking legacy reads for modern provenance',async()=>{
 const dataDigest=await referenceDataInputDigest(),m={...manifest(),dataInputSha256:dataDigest};
 for(const event of ['pull_request','push']){
  const result=await planReferenceReuse({event,readPublished:async()=>({sha,manifest:m}),readLegacy:()=>{throw Error('not needed');}});
  assert.deepEqual(result,{reuse:true,sha,date:m.sourceDate,generation:m.generation,dataDigest});
 }
});
test('changed generators use the normal fresh-source plan instead of pinning a potentially expired published date',async()=>{
 const m={...manifest(),dataInputSha256:hash};
 const result=await planReferenceReuse({event:'pull_request',readPublished:async()=>({sha,manifest:m})});
 assert.deepEqual(result,{reuse:false,reason:'generator-or-legacy-provenance-mismatch'});
});
test('legacy base proof must be successful; read/transport failure never turns into automatic acquisition',async()=>{
 const m=manifest(),dataDigest=await referenceDataInputDigest();let read=0;
 const args={event:'pull_request',baseSha:sha,readPublished:async()=>({sha,manifest:m}),readLegacy:async base=>{
  assert.equal(base,sha);read++;return {legacyInputDigest:m.inputSha256,legacyDataDigest:dataDigest};}};
 assert.equal((await planReferenceReuse(args)).reuse,true);assert.equal(read,1);
 await assert.rejects(planReferenceReuse({...args,readLegacy:async()=>{throw Error('source unavailable');}}),/source unavailable/);
 await assert.rejects(planReferenceReuse({...args,readPublished:async()=>{throw Error('API unavailable');}}),/API unavailable/);
 await assert.rejects(planReferenceReuse({...args,readPublished:async()=>({sha:'mainline-data',manifest:m})}),/Unpinned/);
 assert.deepEqual(await planReferenceReuse({...args,readPublished:async()=>null}),{reuse:false,reason:'no-published-reference'});
});

test('generator identity follows actual transform dependencies and package lock, while browser changes retain data identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mainline-data-provenance-'));
 try{
  for(const path of ['scripts','styles','.github','package.json','package-lock.json'])await cp(path,join(root,path),{recursive:true});
  await mkdir(join(root,'tests/fixtures'),{recursive:true});await cp('tests/fixtures/browser-glyphs',join(root,'tests/fixtures/browser-glyphs'),{recursive:true});
  const data=await referenceDataInputDigest(root),renderer=await referenceInputDigest(root);
  for(const path of ['styles/departures.mjs','styles/app.mjs','styles/sw.js','scripts/mainline-provenance.mjs']){
   const file=join(root,path),bytes=await readFile(file);await writeFile(file,Buffer.concat([bytes,Buffer.from('\n// renderer or acceptance change\n')]));
   assert.equal(await referenceDataInputDigest(root),data,path);
   assert.notEqual(await referenceInputDigest(root),renderer,path);
   await writeFile(file,bytes);
  }
  for(const path of [...DATA_INPUTS,'styles/pbf-utf8.mjs']){
   const file=join(root,path),bytes=await readFile(file);await writeFile(file,Buffer.concat([bytes,Buffer.from('\n')]));
   assert.notEqual(await referenceDataInputDigest(root),data,path);await writeFile(file,bytes);
  }
  const file=join(root,'scripts/mainline-overview.mjs'),bytes=await readFile(file);
  await writeFile(join(root,'scripts/generator-fixture.mjs'),'export const value=1;\n');
  await writeFile(file,Buffer.concat([bytes,Buffer.from('\nimport "./generator-fixture.mjs";\n')]));
  const first=await referenceDataInputDigest(root);
  await writeFile(join(root,'scripts/generator-fixture.mjs'),'export const value=2;\n');
  assert.notEqual(await referenceDataInputDigest(root),first,'new transform imports are bound');
 }finally{await rm(root,{recursive:true,force:true})}
});
test('Git object reads reproduce pinned source keys without checking out or executing old code',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mainline-legacy-source-'));
 try{
  for(const path of new Set([...DATA_INPUTS,...REFERENCE_INPUTS])){
   await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),'fixture bytes\n');
  }
  await writeFile(join(root,'.github/workflows/mainline-reference.yml'),await readFile('.github/workflows/mainline-reference.yml'));
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  git(['init','-q']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Fixture']);
  const ref=git(['rev-parse','HEAD']);
  assert.equal(await referenceInputDigest(root,{ref}),await referenceInputDigest(root));
  assert.equal(await referenceInputDigest(root,{ref,legacy:true}),await referenceInputDigest(root,{legacy:true}));
  assert.equal(await referenceDataInputDigest(root,{ref}),await referenceDataInputDigest(root));
  await writeFile(join(root,'styles/app.mjs'),'changed\n');
  assert.notEqual(await referenceInputDigest(root,{ref}),await referenceInputDigest(root));
  await assert.rejects(referenceDataInputDigest(root,{ref:'HEAD'}),/immutable/);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('actual CLI reads only pinned GitHub metadata, writes reuse outputs and fails closed on API errors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mainline-reuse-cli-'));
 try{
  const bin=join(root,'bin'),output=join(root,'outputs'),calls=join(root,'calls');await mkdir(bin);
  const m={...manifest(),dataInputSha256:await referenceDataInputDigest()},payload=join(root,'manifest.json');
  await writeFile(payload,JSON.stringify(m));
  const mock=`#!/usr/bin/env python3
import os,sys,json,base64
args=sys.argv[1:]
with open(os.environ['MOCK_CALLS'],'a') as f:f.write(json.dumps(args)+'\\n')
if os.environ.get('MOCK_FAIL'): sys.exit(1)
assert args[0]=='api'
if args[1].endswith('/git/matching-refs/heads/mainline-data'):
 print(json.dumps([dict(ref='refs/heads/mainline-data',object=dict(sha='${sha}'))]))
else:
 assert args[1].endswith('/contents/manifest.json?ref=${sha}')
 body=open(os.environ['MOCK_MANIFEST'],'rb').read()
 print(json.dumps(dict(encoding='base64',size=len(body),content=base64.b64encode(body).decode())))
`;
  await writeFile(join(bin,'gh'),mock);await chmod(join(bin,'gh'),0o755);
  const run=extra=>spawnSync(process.execPath,['scripts/plan-mainline-reuse.mjs'],{encoding:'utf8',env:{...process.env,
   PATH:bin+':'+process.env.PATH,GITHUB_REPOSITORY:'fixture/repository',GITHUB_OUTPUT:output,
   REFERENCE_EVENT:'pull_request',MOCK_MANIFEST:payload,MOCK_CALLS:calls,...extra}});
  const result=run({});assert.equal(result.status,0,result.stderr);
  assert.equal(await readFile(output,'utf8'),`reuse=true\nreference_sha=${sha}\nreference_date=2026-10-09\n`);
  assert.equal((await readFile(calls,'utf8')).trim().split('\n').length,2,'no provider request or acquisition command');
  await writeFile(output,'');assert.notEqual(run({MOCK_FAIL:'1'}).status,0);
  assert.equal(await readFile(output,'utf8'),'','a failed candidate read cannot select acquisition');
  await writeFile(calls,'');assert.equal(run({REFERENCE_EVENT:'schedule'}).status,0);
  assert.equal(await readFile(calls,'utf8'),'','explicit refresh remains a separate path');
 }finally{await rm(root,{recursive:true,force:true})}
});

test('legacy metadata extraction never hides a transform change or arbitrary provenance dependency',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mainline-legacy-transition-'));
 try{
  for(const path of ['scripts','styles','.github','package.json','package-lock.json'])await cp(path,join(root,path),{recursive:true});
  const file=join(root,'scripts/build-mainline-snapshot.mjs'),current=await readFile(file,'utf8');
  const expected=await referenceDataInputDigest(root);
  const legacy="import {referenceInputDigest} from './mainline-provenance.mjs';\n"+
   current.replace('complete:true,generation,coverage:', 'complete:true,generation,inputSha256:await referenceInputDigest(),coverage:');
  assert.notEqual(current,legacy);await writeFile(file,legacy);
  assert.equal(await referenceDataInputDigest(root,{legacy:true}),expected,'only the exact removed metadata expressions are normalized');
  await writeFile(file,legacy+'\n// actual transform change\n');
  assert.notEqual(await referenceDataInputDigest(root,{legacy:true}),expected);
  await writeFile(file,current+"\nimport './mainline-provenance.mjs';\n");
  assert.notEqual(await referenceDataInputDigest(root),expected,'new metadata imports are not exempt from transform closure');
  await writeFile(file,current);await assert.rejects(referenceDataInputDigest(root,{legacy:true}),/Unsupported legacy/);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('generation configuration changes invalidate reuse while renderer-only workflow edits do not',async()=>{
 const workflow=await readFile('.github/workflows/mainline-reference.yml','utf8'),base=generationWorkflowInputs(workflow);
 const changes=[
  workflow.replace('sudo apt-get install -y osmium-tool','sudo apt-get install -y osmium-tool=99'),
  workflow.replace('acquire.acquire(os.environ','acquire.altered(os.environ'),
  workflow.replace('MAX_PBF_BYTES=min','MAX_PBF_BYTES=max'),
  workflow.replace('NODE_OPTIONS: --max-old-space-size=6144','NODE_OPTIONS: --max-old-space-size=2048'),
  workflow.replace('max-parallel: 2','max-parallel: 3'),
  workflow.replace('    runs-on: ubuntu-latest\n    timeout-minutes: 180','    runs-on: ubuntu-24.04\n    timeout-minutes: 180'),
  workflow.replace("          node-version: '22'\n      - run: npm ci", "          node-version: '24'\n      - run: npm ci"),
  workflow.replace('jobs:\n','env:\n  GENERATOR_SCALE: 2\njobs:\n'),
  workflow.replace('jobs:\n','defaults:\n  run:\n    shell: sh\njobs:\n'),
  workflow.replace('      - name: Verify the exact generation and renderer before publication','      - run: node scripts/extra-transform.mjs\n      - name: Verify the exact generation and renderer before publication'),
 ];
 for(const changed of changes){assert.notEqual(changed,workflow);assert.notEqual(generationWorkflowInputs(changed),base);}
 const renderer=workflow.replace('node scripts/check-mainline-reference-browser.mjs --published','node scripts/check-mainline-reference-browser.mjs --published --new-renderer-check');
 assert.equal(generationWorkflowInputs(renderer),base);
 assert.throws(()=>generationWorkflowInputs(workflow.replace('Verify the exact generation and renderer before publication','Unknown boundary')),/boundary/);
 assert.throws(()=>generationWorkflowInputs(workflow.replace('  extract:','  extract-new:')),/job/);
 for(const changed of [
  workflow.replace('name: Build worldwide OSM railway reference','name: &runner ubuntu-latest').replace('    runs-on: ubuntu-latest\n    timeout-minutes: 180','    runs-on: *runner\n    timeout-minutes: 180'),
  workflow.replace('jobs:\n','defaults: *externalDefaults\njobs:\n'),
  workflow.replace('  extract:\n','  extract:\n    env: &generatorEnv\n      NODE_OPTIONS: --random-seed=42\n'),
 ])assert.throws(()=>generationWorkflowInputs(changed),/aliases\/anchors/);
});

test('fresh renderer receipt preserves generation/source bytes and binds both provenance keys only after passing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mainline-reaccept-'));
 try{
  const m=manifest();m.controls=MAINLINE_CONTROLS.map(c=>({...c,chainIdsByZoom:Object.fromEntries(Array.from({length:7},(_,z)=>[z,['chain-'+c.name]]))}));
  const generation=join(root,'generations',m.generation);await mkdir(join(generation,'0/0'),{recursive:true});
  const tile=join(generation,'0/0/0.pbf.gz');await writeFile(tile,'untouched stored bytes');
  const samples=MAINLINE_CONTROLS.flatMap(c=>['desktop','android','safari'].flatMap(profile=>['mercator','globe'].flatMap(projection=>
   [-.1,0,3,4,5,6,7].map(zoom=>({name:c.name,profile,projection,zoom,cameraZoom:zoom,painted:1,ids:['chain-'+c.name]})))));
  const report={generation:m.generation,scope:'Actual OSM generation; exact chain identities',samples,
   appSamples:Array.from({length:18},()=>({ids:['fixture'],zoom:3,cameraZoom:3}))};
  const manifestPath=join(root,'manifest.json'),reportPath=join(root,'report.json');
  await writeFile(manifestPath,JSON.stringify(m));await writeFile(reportPath,JSON.stringify({...report,samples:samples.slice(1)}));
  const run=()=>spawnSync(process.execPath,['scripts/record-mainline-acceptance.mjs',root,reportPath],{encoding:'utf8'});
  assert.notEqual(run().status,0,'incomplete renderer evidence is not accepted');
  assert.deepEqual(JSON.parse(await readFile(manifestPath)),m);
  await writeFile(reportPath,JSON.stringify(report));const result=run();assert.equal(result.status,0,result.stderr);
  const after=JSON.parse(await readFile(manifestPath));
  assert.equal(after.inputSha256,await referenceInputDigest());assert.equal(after.dataInputSha256,await referenceDataInputDigest());
  assert.equal(after.rendererAcceptance.inputSha256,after.inputSha256);
  for(const key of ['generation','sourceDate','oldestSource','newestSource','sources','indexSha256'])assert.deepEqual(after[key],m[key],key);
  assert.equal(await readFile(tile,'utf8'),'untouched stored bytes');
 }finally{await rm(root,{recursive:true,force:true})}
});

test('actual snapshot verifier rejects changed data and current-acceptance bindings while retaining legacy compatibility',async()=>{
 const root=await mkdtemp(join(tmpdir(),'mainline-verifier-inputs-'));
 try{
  // Synthetic integrity fixture only; this is not geographic/OSM acceptance.
  const m={...manifest(),dataInputSha256:hash},dir=join(root,'generations',m.generation);
  const tile=gzipSync(vtpbf.fromGeojsonVt({atlas_mainline_overview:{features:[
   {type:2,geometry:[[[0,0],[4096,4096]]],tags:{id:'chain'},id:1},
  ]}})),tiles=[];
  for(let z=0;z<=6;z++){
   const key=`${z}/0/0`;await mkdir(join(dir,String(z),'0'),{recursive:true});
   await writeFile(join(dir,key+'.pbf.gz'),tile);tiles.push({key,bytes:tile.length,sha256:sha256(tile)});
  }
  const index=JSON.stringify({schema:1,complete:true,generation:m.generation,tiles});
  await writeFile(join(dir,'index.json'),index);m.indexSha256=sha256(index);m.tileBytes=tile.length*7;
  const audit=JSON.stringify(MAINLINE_CONTROLS.map(c=>({name:c.name,feature:{properties:{id:'way-1',osm_version:1}},
   chainIdsByZoom:Object.fromEntries(Array.from({length:7},(_,z)=>[z,['chain']]))})));
  await writeFile(join(dir,'coverage-audit.json'),audit);m.coverageAuditSha256=sha256(audit);
  const report='{}',reportSha=sha256(report),reportPath=`generations/${m.generation}/renderer-acceptance-${reportSha}.json`;
  await writeFile(join(root,reportPath),report);
  m.rendererAcceptance={complete:true,path:reportPath,sha256:reportSha,samples:840,appSamples:18,inputSha256:m.inputSha256};
  const manifestPath=join(root,'manifest.json');
  const run=()=>spawnSync(process.execPath,['scripts/verify-mainline-snapshot.mjs',root,'--require-browser-acceptance'],{encoding:'utf8'});
  await writeFile(manifestPath,JSON.stringify(m));let result=run();assert.equal(result.status,0,result.stderr);
  for(const patch of [
   {dataInputSha256:'broken'},
   {rendererAcceptance:{...m.rendererAcceptance,inputSha256:hash}},
   {rendererAcceptance:{...m.rendererAcceptance,inputSha256:undefined}},
  ]){
   await writeFile(manifestPath,JSON.stringify({...m,...patch}));result=run();
   assert.notEqual(result.status,0);assert.match(result.stderr,/generator provenance|different application inputs/);
  }
  const legacy=structuredClone(m);delete legacy.dataInputSha256;delete legacy.rendererAcceptance.inputSha256;
  await writeFile(manifestPath,JSON.stringify(legacy));result=run();assert.equal(result.status,0,result.stderr);
  await writeFile(manifestPath,JSON.stringify(m));await writeFile(join(dir,'0/0/0.pbf.gz'),'changed bytes');
  result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/tile byte count|tile digest/);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('reuse workflow still verifies every stored byte and performs full current renderer acceptance before publication',async()=>{
 const workflow=await readFile('.github/workflows/mainline-reference.yml','utf8');
 assert.match(workflow,/PINNED_SOURCE_DATE: \$\{\{ steps\.reuse\.outputs\.reference_date \}\}/);
 assert.match(workflow,/extract:\n\s+needs: plan\n\s+if: needs\.plan\.outputs\.reuse != 'true'/);
 assert.ok(workflow.includes("if: ${{ !cancelled() && needs.plan.result == 'success' && (needs.plan.outputs.reuse == 'true' || needs.extract.result == 'success') }}"));
 const start=workflow.indexOf('Read the pinned complete generation');
 const verify=workflow.indexOf('node scripts/verify-mainline-snapshot.mjs mainline-output --require-browser-acceptance',start);
 const browser=workflow.indexOf('node scripts/check-mainline-reference-browser.mjs --published',verify);
 const record=workflow.indexOf('node scripts/record-mainline-acceptance.mjs',browser);
 const publish=workflow.indexOf('Publish complete reference generation atomically',record);
 assert.ok(start>0&&verify>start&&browser>verify&&record>browser&&publish>record);
 assert.match(workflow,/git fetch --no-tags --depth=1 origin "\$REFERENCE_SHA"/);
 assert.match(workflow,/node scripts\/verify-mainline-snapshot\.mjs mainline-output --require-browser-acceptance\n/);
 assert.ok((await readFile('.github/workflows/site.yml','utf8')).includes('if [ "$actual" = "$expected" ]'),'existing exact current-renderer readiness remains mandatory');
});
