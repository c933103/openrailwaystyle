import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {extractReadiness,targetedRefresh} from '../scripts/extract-rollout.mjs';
const filter=id=>id.startsWith('gap/')?'gap-v2':'region-v2';
const complete=()=>({schema:1,generation:'20261117T010203Z-123',missing:[],regions:{a:{region:'a',filter:'region-v2'},'gap/1':{region:'gap/1',filter:'gap-v2'}}});
test('current regional and gap selections allow assembly only for their completed refresh',()=>{
 assert.equal(extractReadiness(complete(),{filter,runId:123}).ready,true);
 for(const runId of [124,'123|.*','',0])assert.equal(extractReadiness(complete(),{filter,runId}).ready,false);
});
test('missing, unknown and stale inputs cannot advance to assembly',()=>{
 for(const index of [undefined,{}, {...complete(),schema:2},{...complete(),missing:null},{...complete(),missing:['b']},{...complete(),regions:{}}])assert.equal(extractReadiness(index,{filter}).ready,false);
 for(const id of ['a','gap/1']){
  const stale=complete();stale.regions[id].filter='old';assert.equal(extractReadiness(stale,{filter}).ready,false);
  const wrong=complete();wrong.regions[id].region='other';assert.equal(extractReadiness(wrong,{filter}).ready,false);
 }
});
test('derive selection readiness from each entry rather than trusting summary fields',()=>{
 const index=complete();index.olderFilter=[];index.regions.a.filter='old';assert.equal(extractReadiness(index,{filter}).ready,false);
});
test('continuation uses trusted main and existing bounded workflows without a new schedule',()=>{
 const w=readFileSync(new URL('../.github/workflows/extract-rollout.yml',import.meta.url),'utf8');
 assert.match(w,/head_branch == 'main'/);assert.match(w,/head_repository.full_name == github.repository/);assert.match(w,/conclusion == 'success'/);
 assert.match(w,/ref: main/);assert.match(w,/persist-credentials: false/);assert.doesNotMatch(w,/pull_request_target|schedule:/);
 assert.doesNotMatch(w,/gh run list/);assert.match(w,/workflow=osm-extract.yml; else workflow=osm-assemble.yml/);
 assert.match(w,/EXTRACT_RUN_ID:.*workflow_run.id/);assert.match(w,/cancel-in-progress: false/);
});

test('active same-source or gaps-only runs cannot swallow a needed continuation',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/extract-rollout.yml',import.meta.url),'utf8');
 const script=workflow.slice(workflow.lastIndexOf('        run: |')+'        run: |'.length).split('\n').map(line=>line.replace(/^          /,'')).join('\n');
 for(const [event,active,expected] of [['workflow_run','1','osm-assemble.yml'],['push','1','osm-extract.yml'],['push','0','osm-extract.yml']]){
  const harness=`gh(){ if [ "$1" = run ]; then echo "$MOCK_ACTIVE"; else echo "DISPATCH:$3"; fi; }; git(){ echo trustedhead; };\n${script}`;
  const result=spawnSync('bash',['-e','-c',harness],{encoding:'utf8',env:{...process.env,EVENT_NAME:event,MOCK_ACTIVE:active}});
  assert.equal(result.status,0,result.stderr);
  if(expected)assert.ok(result.stdout.includes(`DISPATCH:${expected}`),result.stdout);else assert.ok(!result.stdout.includes('DISPATCH:'),result.stdout);
 }
});

test('the reviewed 531 request never expands past its two existing working copies',()=>{
 const request={schema:1,reason:531,sourceDate:'2026-11-24',regionIds:['south-america','australia-oceania']};
 const current=complete();
 for(const id of request.regionIds) current.regions[id]={region:id,filter:filter(id),sourceTimestamp:'2026-11-15T21:22:28Z'};
 assert.deepEqual(targetedRefresh(current,request,filter),{required:true,regionIds:request.regionIds,sourceDate:request.sourceDate});
 for(const id of request.regionIds) current.regions[id].sourceTimestamp='2026-11-24T20:00:00Z';
 assert.equal(targetedRefresh(current,request,filter).required,false);
 assert.throws(()=>targetedRefresh(current,{...request,regionIds:[...request.regionIds,'china']},filter),/not the reviewed/i);
 assert.throws(()=>targetedRefresh(current,{...request,sourceDate:'2026-11-25'},filter),/not the reviewed/i);
 delete current.regions['south-america'];
 assert.throws(()=>targetedRefresh(current,request,filter),/missing or invalid/i);
 current.regions.a.filter='old';
 assert.throws(()=>targetedRefresh(current,request,filter),/complete current filter/);
});

test('an older triggering push still reads its exact request from a shallow checkout',()=>{
 const home=mkdtempSync(join(tmpdir(),'atlas-targeted-refresh-'));
 try{
  const repo=join(home,'repo'), shallow=join(home,'shallow');mkdirSync(repo);
  const run=(cwd,command,args,env={})=>{
   const result=spawnSync(command,args,{cwd,encoding:'utf8',env:{...process.env,...env}});
   assert.equal(result.status,0,result.stderr);
   return result.stdout.trim();
  };
  const git=(...args)=>run(repo,'git',args);
  git('init','-q');git('config','user.name','fixture');git('config','user.email','fixture@example.invalid');
  const commit=message=>{git('add','.');git('commit','-qm',message);return git('rev-parse','HEAD');};
  writeFileSync(join(repo,'log'),'base');const before=commit('base');
  const path='scripts/extract-refresh-requests/531.json';
  mkdirSync(join(repo,'scripts','extract-refresh-requests'),{recursive:true});
  const request='{"test":"exact triggering file"}';
  writeFileSync(join(repo,path),request);const after=commit('request');
  writeFileSync(join(repo,'log'),'later1');commit('later1');
  writeFileSync(join(repo,'log'),'later2');commit('later2');
  run(home,'git',['clone','--quiet','--depth=2',pathToFileURL(repo).href,shallow]);
  assert.notEqual(spawnSync('git',['cat-file','-e',after+'^{commit}'],{cwd:shallow}).status,0);
  const workflow=readFileSync(new URL('../.github/workflows/extract-rollout.yml',import.meta.url),'utf8');
  const step=workflow.split('      - name: Read the reviewed two-region refresh request\n')[1].split('      - name: Dispatch only')[0];
  const script=step.split('        run: |\n')[1].split('\n').map(line=>line.replace(/^          /,'')).join('\n');
  const log=join(home,'outputs.txt');
  const harness='node(){ cat "$4"; };\n'+script;
  assert.equal(run(shallow,'bash',['-e','-c',harness],{PUSH_BEFORE:before,PUSH_AFTER:after,GITHUB_OUTPUT:log}),request);
  assert.equal(readFileSync(log,'utf8'),'matched=true\n');
 }finally{rmSync(home,{recursive:true,force:true});}
});
