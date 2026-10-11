import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

// Execute the actual trusted shell with metadata-only API fixtures and real jq.
// No GitHub credentials, network requests or source artifacts are available.
const workflow=await readFile('.github/workflows/mainline-reference-completed.yml','utf8');
const script=workflow.split('        run: |\n')[1].split('\n').map(line=>line.slice(10)).join('\n');
const mock=`#!/usr/bin/env python3
import os,sys,json,subprocess
args=sys.argv[1:];sha=os.environ['SOURCE_SHA'];case=os.environ['RETRY_CASE']
if args[:2]==['run','rerun']:
 with open(os.environ['RETRY_LOG'],'a') as f:f.write(json.dumps(args)+'\\n')
 sys.exit(0)
assert args[0]=='api';endpoint=next(a for a in args[1:] if a.startswith('repos/'))
def identity(number=186,empty=False):
 return dict(head_sha=sha,head_branch='feature',head_repository=dict(id=42),pull_requests=[] if empty else [dict(number=number)])
def site_run(n):
 run=dict(id=n,name='Validate and deploy world railway map',event='pull_request',status='completed',conclusion='failure' if n==21 else 'timed_out',run_attempt=1,**identity(empty=case.startswith('empty_')))
 if case=='closed_other_pr_same_sha':run['pull_requests']=[dict(number=999)]
 if case=='empty_other_repo':run['head_repository']['id']=99
 if case=='empty_other_branch':run['head_branch']='different'
 if case=='empty_missing_identity':run.pop('head_repository')
 if case=='pending_site':run['status']='in_progress'
 if case=='retried':run['run_attempt']=2
 return run
def source_run():
 site=case in ['late_site','no_source','late_site_stale_then_matching'];dispatch=case=='dispatch'
 run=dict(id=123,status='completed',conclusion='failure' if site else 'success',event='workflow_dispatch' if dispatch else 'pull_request',name='Validate and deploy world railway map' if site else 'Build worldwide OSM railway reference',**identity(empty=dispatch or case=='fork'))
 if case=='stale_trigger':run['head_sha']='2'*40
 if case=='other_source_pr':run['pull_requests']=[dict(number=999)]
 if case=='other_source_repo':run['pull_requests']=[];run['head_repository']['id']=99
 return run
def pr(number=186):
 return dict(number=number,state='closed' if case in ['closed','closed_race'] or number==999 else 'open',head=dict(sha='2'*40 if case=='changed' else sha,ref='feature',repo=dict(id=42)))
if '/artifacts?' in endpoint:
 assert '--paginate' in args
 run_id=int(endpoint.split('/runs/')[1].split('/')[0])
 digest='b'*64 if case in ['stale_source_inputs','artifact_later_page'] or run_id==124 else 'a'*64
 artifact=dict(id=888,name='mainline-reference-2026-10-09-'+digest,expired=case=='expired_source_artifact',size_in_bytes=1234)
 if case=='oversized_source_artifact':artifact['size_in_bytes']=1073741824
 if case=='empty_source_artifact':artifact['size_in_bytes']=0
 if case=='legacy_source_artifact':artifact['name']='mainline-reference-2026-10-09'
 data=dict(artifacts=[] if case=='missing_source_artifact' else [artifact])
elif '/actions/runs/123' in endpoint:data=source_run()
elif '/pulls?state=all' in endpoint:
 assert '--paginate' in args
 data=[] if case=='empty_missing_history' else [pr()]
 if case in ['empty_closed_other_pr_same_sha','empty_other_base','empty_closed_changed_head','explicit_with_history','empty_history_missing_identity']:
  old=pr(999)
  if case=='empty_other_base':old.update(state='open',base=dict(ref='release'))
  if case=='empty_closed_changed_head':old['head']['sha']='3'*40
  if case=='empty_history_missing_identity':old['head']['repo']=None
  data.append(old)
elif '/pulls?state=open' in endpoint:data=[] if case=='closed' else [dict(pr(),state='open',head=dict(sha=sha,ref='feature',repo=dict(id=42)))]
elif '/actions/workflows/mainline-reference.yml/runs?' in endpoint:
 source=source_run();source.update(name='Build worldwide OSM railway reference',conclusion='success')
 data=dict(workflow_runs=[] if case=='no_source' else [dict(source,id=124),source] if case=='late_site_stale_then_matching' else [source])
elif '/actions/workflows/site.yml/runs?' in endpoint:
 data=dict(workflow_runs=[site_run(21),site_run(22),dict(site_run(23),conclusion='success'),dict(site_run(24),status='in_progress',conclusion=None)])
elif '/jobs?' in endpoint:
 steps=[] if case=='missing_site_inputs' else [dict(name='Require worldwide railway reference '+'a'*64)]
 if case=='ambiguous_site_inputs':steps.append(dict(name='Require worldwide railway reference '+'b'*64))
 data=dict(jobs=[dict(id=321,name='reference',conclusion='success' if case=='test_failure' else 'failure',steps=steps)])
elif '/actions/runs/21' in endpoint or '/actions/runs/22' in endpoint:
 data=site_run(int(endpoint.rsplit('/',1)[1]))
 if case=='retried_race':data['run_attempt']=2
elif endpoint.endswith('/pulls/999'):data=pr(999)
elif endpoint.endswith('/pulls/186'):data=pr()
else:raise Exception('Unexpected API '+endpoint)
if '--jq' in args:
 query=args[args.index('--jq')+1];result=subprocess.run(['jq','-r',query],input=json.dumps(data),text=True)
 if '/pulls?state=all' in endpoint and case=='empty_later_page_closed':subprocess.run(['jq','-r',query],input=json.dumps([pr(999)]),text=True,check=True)
 if '/artifacts?' in endpoint and case=='artifact_later_page':
  later=dict(artifact,name='mainline-reference-2026-10-09-'+'a'*64)
  subprocess.run(['jq','-r',query],input=json.dumps(dict(artifacts=[later])),text=True,check=True)
 sys.exit(1 if (case=='history_error' and '/pulls?state=all' in endpoint) or (case=='source_artifact_error' and '/artifacts?' in endpoint) else result.returncode)
if case=='source_artifact_error' and '/artifacts?' in endpoint:sys.exit(1)
print(json.dumps(data))
`;

for(const [scenario,expected,exit] of [
 ['explicit_with_history',['21','22'],0],['fork',['21','22'],0],['late_site',['21','22'],0],['dispatch',['21','22'],0],
 ['empty_closed_other_pr_same_sha',[],0],['empty_other_base',[],0],['empty_closed_changed_head',[],0],
 ['empty_later_page_closed',[],0],['empty_history_missing_identity',[],0],['empty_missing_history',[],0],['history_error',[],1],['empty_matching',['21','22'],0],['pending_site',[],0],['changed',[],0],['closed',[],0],['closed_race',[],0],['no_source',[],0],
 ['retried',[],0],['retried_race',[],0],['test_failure',[],0],['stale_trigger',[],1],
 ['closed_other_pr_same_sha',[],0],['empty_other_repo',[],0],['empty_other_branch',[],0],
 ['empty_missing_identity',[],0],['other_source_pr',[],0],['other_source_repo',[],0],
 ['stale_source_inputs',[],0],['expired_source_artifact',[],0],['oversized_source_artifact',[],0],
 ['empty_source_artifact',[],0],['legacy_source_artifact',[],0],['missing_source_artifact',[],0],
 ['missing_site_inputs',[],0],['ambiguous_site_inputs',[],0],['source_artifact_error',[],1],
 ['artifact_later_page',['21','22'],0],['late_site_stale_then_matching',['21','22'],0],
])test(`trusted reference completion: ${scenario}`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'atlas-reference-retry-')),log=join(root,'calls.jsonl');
 try{
  await writeFile(join(root,'gh'),mock,{mode:0o755});
  const result=spawnSync('bash',['-c',script],{encoding:'utf8',env:{...process.env,
   PATH:root+':'+process.env.PATH,GH_TOKEN:'fixture-no-network',GITHUB_REPOSITORY:'test/atlas',
   TRIGGER_RUN:'123',TRIGGER_NAME:['late_site','no_source','late_site_stale_then_matching'].includes(scenario)?'Validate and deploy world railway map':'Build worldwide OSM railway reference',
   SOURCE_SHA:'1'.repeat(40),RETRY_CASE:scenario,RETRY_LOG:log}});
  assert.equal(result.status,exit,result.stderr);
  let calls=[];try{calls=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line))}
  catch(error){if(error.code!=='ENOENT')throw error}
  assert.deepEqual(calls.map(call=>call[2]),expected);
  for(const call of calls)assert.deepEqual(call.slice(3),['--failed','--repo','test/atlas']);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('the completion controller is the only automatic preview retry authority',async()=>{
 const publisher=await readFile('.github/workflows/mainline-reference.yml','utf8');
 assert.doesNotMatch(publisher,/gh run rerun/);
 assert.doesNotMatch(workflow,/actions\/checkout|download-artifact|curl|node scripts\//);
 assert.match(workflow,/run_attempt/);
});
