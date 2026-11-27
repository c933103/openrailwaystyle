import assert from 'node:assert/strict';
import {test} from 'node:test';
import {findQueuedSitePush} from '../scripts/site-reference-redeploy.mjs';

const commit='1'.repeat(40), later='2'.repeat(40), repository='owner/atlas', repositoryId=17;
const run={id:38,status:'pending',conclusion:null,repository:{id:17},head_repository:{id:17},
  path:'.github/workflows/site.yml',head_branch:'main',head_sha:commit,event:'push'};
const empty={total_count:0,jobs:[]};
function fixture({list=[run],fresh=run,jobs=empty,heads=[commit,commit],error=false}={}){
  let i=0;
  return path=>{
    if(error)throw new Error('unavailable');
    assert.ok(path.startsWith('repos/owner/atlas/'));
    if(path.endsWith('/git/ref/heads/main'))return {object:{sha:heads[i++]}};
    if(path.includes('/actions/workflows/site.yml/runs?'))return {workflow_runs:list};
    if(path.endsWith('/actions/runs/38/jobs?filter=latest&per_page=1'))return jobs;
    if(path.endsWith('/actions/runs/38'))return fresh;
    throw new Error('unexpected path');
  };
}
const find=(read,event='push')=>findQueuedSitePush({read,event,commit,repository,repositoryId});

test('does not displace the unstarted exact main push with a second run',()=>{
  assert.equal(find(fixture()),38);
  const queued={...run,status:'queued'};
  assert.equal(find(fixture({list:[queued],fresh:queued})),38);
});

test('retains scheduled and manual deployment even if a push run is queued',()=>{
  for(const event of ['schedule','workflow_dispatch','pull_request']){
    let asked=false;
    assert.equal(find(()=>{asked=true;return {};},event),null);
    assert.equal(asked,false);
  }
});

test('will not reuse stale, cancelled, already-started, foreign, or differently dispatched runs',()=>{
  for(const item of [{...run,status:'in_progress'},{...run,status:'completed',conclusion:'cancelled'},
    {...run,head_sha:later},{...run,head_branch:'release'},{...run,head_repository:{id:99}},
    {...run,path:'.github/workflows/another.yml'},{...run,event:'workflow_dispatch'}]){
    assert.equal(find(fixture({list:[item],fresh:item})),null);
  }
  assert.equal(find(fixture({fresh:{...run,status:'in_progress'}})),null);
  assert.equal(find(fixture({jobs:{total_count:1,jobs:[{name:'reference'}]}})),null);
  assert.equal(find(fixture({jobs:{total_count:0,jobs:[{name:'reference'}]}})),null);
});

test('retains redeploy if main moves, the run is missing, or the API cannot verify it',()=>{
  assert.equal(find(fixture({heads:[commit,later]})),null);
  assert.equal(find(fixture({heads:[later]})),null);
  assert.equal(find(fixture({list:[]})),null);
  assert.equal(find(fixture({error:true})),null);
});
