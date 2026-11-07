import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const workflow=await readFile('.github/workflows/mainline-reference-completed.yml','utf8');
const section=workflow.split('  release-obsolete-waits:\n')[1];
const script=section?.split('        run: |\n')[1].split('\n').map(line=>line.slice(10)).join('\n')??':';
const mock=`#!/usr/bin/env python3
import json,os,sys,pathlib
args=sys.argv[1:];case=os.environ['WAIT_CASE'];state=pathlib.Path(os.environ['WAIT_STATE']);log=pathlib.Path(os.environ['WAIT_LOG'])
counts=json.loads(state.read_text()) if state.exists() else {}
endpoint=next(x for x in args if x.startswith('repos/'));counts[endpoint]=counts.get(endpoint,0)+1;state.write_text(json.dumps(counts));count=counts[endpoint]
old='1'*40;new='2'*40
if '--method' in args:
 assert args[args.index('--method')+1]=='POST' and endpoint.endswith('/actions/runs/21/cancel')
 if case=='cancel_error':sys.exit(1)
 with log.open('a') as f:f.write(json.dumps(args)+'\\n')
 sys.exit(0)
def run(id,sha=old):
 return dict(id=id,name='Validate and deploy world railway map',path='.github/workflows/site.yml',repository=dict(id=123),head_repository=dict(id=123),head_branch='main',head_sha=sha,event='push',status='in_progress',conclusion=None)
def candidate():
 r=run(21)
 if case=='current':r['head_sha']=new
 if case=='fork':r['head_repository']['id']=999
 if case=='wrong_repo':r['repository']['id']=999
 if case=='pull_request':r['event']='pull_request'
 if case=='other_branch':r['head_branch']='release'
 if case=='other_workflow':r['path']='.github/workflows/other.yml'
 if case=='completed':r.update(status='completed',conclusion='success')
 if case=='failed':r.update(status='completed',conclusion='failure')
 if case=='queued':r['status']='queued'
 if case=='invalid_sha':r['head_sha']='invalid'
 if case=='head_race' and count>1:r['head_sha']='3'*40
 return r
if '/actions/workflows/mainline-reference.yml/runs?' in endpoint:
 assert '--paginate' in args and '--slurp' in args
 source=run(123);source.update(name='Build worldwide OSM railway reference',path='.github/workflows/mainline-reference.yml',status='completed',conclusion='success')
 data=[dict(workflow_runs=[] if case=='push_no_source' else [source])]
elif endpoint.endswith('/actions/runs/123'):
 data=run(123);data.update(name='Build worldwide OSM railway reference',path='.github/workflows/mainline-reference.yml',status='completed',conclusion='success')
 if case=='source_failed':data['conclusion']='failure'
 if case=='source_fork':data['head_repository']['id']=999
 if case=='source_pr':data['event']='pull_request'
 if case=='source_wrong_workflow':data['path']='.github/workflows/other.yml'
 if case=='dispatch':data['event']='workflow_dispatch'
elif endpoint.endswith('/git/ref/heads/main'):
 data=dict(object=dict(sha=old if case=='main_race' and count>1 else new))
 if case=='invalid_main':data['object']['sha']='bad'
elif '/actions/workflows/site.yml/runs?' in endpoint:
 assert '--paginate' in args and '--slurp' in args
 if 'head_sha=' in endpoint:
  replacement=run(22,new);replacement['status']='pending'
  if case=='replacement_failed':replacement.update(status='completed',conclusion='failure')
  if case=='replacement_wrong_head':replacement['head_sha']='3'*40
  if case=='replacement_fork':replacement['head_repository']['id']=999
  if case=='replacement_success':replacement.update(status='completed',conclusion='success')
  data=[dict(workflow_runs=[] if case=='no_replacement' else [replacement])]
 else:
  data=[dict(workflow_runs=[candidate()])]
  if case=='later_page':data=[dict(workflow_runs=[]),data[0]]
  if case=='duplicate_candidate':data.append(data[0])
elif '/actions/runs/21/jobs?' in endpoint:
 assert '--paginate' in args and '--slurp' in args and 'filter=latest' in endpoint
 ref=dict(id=1,name='reference',status='in_progress',conclusion=None,steps=[dict(name='Require worldwide railway reference '+'a'*64,status='in_progress')])
 jobs=[ref,dict(id=2,name='plan',status='completed',conclusion='success'),dict(id=3,name='facilities',status='completed',conclusion='success')]
 if case=='wrong_step':ref['steps'][0]['name']='Installing dependencies'
 if case=='completed_reference':ref.update(status='completed',conclusion='success')
 if case=='missing_step':ref['steps']=[]
 if case=='two_active_steps':ref['steps'].append(dict(name='Other step',status='in_progress'))
 if case=='failed_plan':jobs[1]['conclusion']='failure'
 if case=='active_facilities':jobs[2].update(status='in_progress',conclusion=None)
 if case in ['validation','deployment','queued_validation','race_to_validation'] and (case!='race_to_validation' or count>1):
  jobs.append(dict(id=4,name='deploy' if case=='deployment' else 'validate',status='queued' if case=='queued_validation' else 'in_progress',conclusion=None))
 if case=='unknown_job':jobs.append(dict(id=5,name='something',status='completed',conclusion='success'))
 if case=='duplicate_reference':jobs.append(ref)
 if case=='empty_jobs':jobs=[]
 data=[dict(jobs=jobs)]
 if case=='hidden_deploy_later_page':data.append(dict(jobs=[dict(id=4,name='deploy',status='in_progress',conclusion=None)]))
 if case=='jobs_api_error':sys.exit(1)
elif endpoint.endswith('/actions/runs/21'):data=candidate()
else:raise Exception('Unexpected API '+endpoint)
print(json.dumps(data))
`;
const positives=['push','obsolete','dispatch','later_page','duplicate_candidate','replacement_success'];
const negatives=['push_no_source','current','fork','wrong_repo','pull_request','other_branch','other_workflow','completed','failed','queued','invalid_sha',
 'head_race','main_race','source_failed','source_fork','source_pr','source_wrong_workflow','no_replacement','replacement_failed','replacement_wrong_head','replacement_fork',
 'wrong_step','completed_reference','missing_step','two_active_steps','failed_plan','active_facilities','validation','deployment','queued_validation','race_to_validation',
 'unknown_job','duplicate_reference','empty_jobs','hidden_deploy_later_page'];
for(const scenario of [...positives,...negatives,'invalid_main','jobs_api_error','cancel_error'])test(`obsolete main wait recovery: ${scenario}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'atlas-obsolete-wait-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const log=join(root,'calls'),state=join(root,'state');await writeFile(join(root,'gh'),mock,{mode:0o755});
 const result=spawnSync('bash',['-c',script],{encoding:'utf8',timeout:10000,env:{...process.env,PATH:root+':'+process.env.PATH,
  GH_TOKEN:'fixture-no-network',GITHUB_REPOSITORY:'test/atlas',GITHUB_REPOSITORY_ID:'123',TRIGGER_RUN:scenario.startsWith('push')?'':'123',RECOVERY_EVENT:scenario.startsWith('push')?'push':'workflow_run',GITHUB_REF:'refs/heads/main',WAIT_CASE:scenario,WAIT_STATE:state,WAIT_LOG:log}});
 assert.equal(result.error,undefined,result.error?.message);
 assert.equal(result.status,['invalid_main','jobs_api_error','cancel_error'].includes(scenario)?1:0,result.stderr);
 let calls=[];try{calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);}catch(e){if(e.code!=='ENOENT')throw e;}
 assert.equal(calls.length,positives.includes(scenario)?1:0);
 if(calls.length)assert.deepEqual(calls[0],['api','--method','POST','repos/test/atlas/actions/runs/21/cancel']);
});

test('obsolete-wait recovery stays metadata-only and does not change site acceptance or deployment concurrency',async()=>{
 assert.ok(section,'a trusted recovery job exists');
 assert.match(section,/actions: write\n      contents: read/);
 assert.doesNotMatch(section,/actions\/checkout|download-artifact|workflow run|run rerun|curl|node scripts\//);
 const site=await readFile('.github/workflows/site.yml','utf8');
 assert.match(site,/cancel-in-progress: \$\{\{ github.ref != 'refs\/heads\/main' \}\}/);
 assert.match(site,/verify-mainline-snapshot\.mjs styles\/data\/mainline-reference --require-browser-acceptance/);
 assert.match(site,/test "\$actual" = "\$\(node scripts\/mainline-provenance\.mjs\)"/);
});
