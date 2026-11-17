import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractReadiness} from '../scripts/extract-rollout.mjs';
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
 assert.match(w,/headSha == env.ROLLOUT_HEAD/);assert.match(w,/workflow=osm-extract.yml; else workflow=osm-assemble.yml/);
 assert.match(w,/EXTRACT_RUN_ID:.*workflow_run.id/);assert.match(w,/cancel-in-progress: false/);
});
