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
if '/actions/runs/123' in endpoint:
 site=case in ['late_site','no_source'];dispatch=case=='dispatch'
 data=dict(conclusion='failure' if site else 'success',event='workflow_dispatch' if dispatch else 'pull_request',
  name='Validate and deploy world railway map' if site else 'Build worldwide OSM railway reference',
  head_sha=sha if case!='stale_trigger' else '2'*40,pull_requests=[])
elif '/pulls?state=open' in endpoint:
 data=[] if case=='closed' else [dict(number=186,state='open',head=dict(sha=sha))]
elif '/actions/workflows/mainline-reference.yml/runs?' in endpoint:
 data=dict(workflow_runs=[] if case=='no_source' else [dict(id=123,status='completed',conclusion='success',event='pull_request')])
elif '/actions/workflows/site.yml/runs?' in endpoint:
 data=dict(workflow_runs=[dict(id=21,status='in_progress' if case=='pending_site' else 'completed',conclusion='failure',run_attempt=2 if case=='retried' else 1),
  dict(id=22,status='in_progress' if case=='pending_site' else 'completed',conclusion='timed_out',run_attempt=2 if case=='retried' else 1),
  dict(id=23,status='completed',conclusion='success',run_attempt=1),dict(id=24,status='in_progress',conclusion=None,run_attempt=1)])
elif '/jobs?' in endpoint:
 data=dict(jobs=[dict(id=321,name='reference',conclusion='success' if case=='test_failure' else 'failure')])
elif endpoint.endswith('/pulls/186'):
 data=dict(state='open',head=dict(sha='2'*40 if case=='changed' else sha))
else:raise Exception('Unexpected API '+endpoint)
query=args[args.index('--jq')+1];result=subprocess.run(['jq','-r',query],input=json.dumps(data),text=True)
sys.exit(result.returncode)
`;

for(const [scenario,expected,exit] of [
 ['fork',['21','22'],0],['late_site',['21','22'],0],['dispatch',['21','22'],0],
 ['pending_site',[],0],['changed',[],0],['closed',[],0],['no_source',[],0],
 ['retried',[],0],['test_failure',[],0],['stale_trigger',[],1],
])test(`trusted reference completion: ${scenario}`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'atlas-reference-retry-')),log=join(root,'calls.jsonl');
 try{
  await writeFile(join(root,'gh'),mock,{mode:0o755});
  const result=spawnSync('bash',['-c',script],{encoding:'utf8',env:{...process.env,
   PATH:root+':'+process.env.PATH,GH_TOKEN:'fixture-no-network',GITHUB_REPOSITORY:'test/atlas',
   TRIGGER_RUN:'123',TRIGGER_NAME:['late_site','no_source'].includes(scenario)?'Validate and deploy world railway map':'Build worldwide OSM railway reference',
   SOURCE_SHA:'1'.repeat(40),RETRY_CASE:scenario,RETRY_LOG:log}});
  assert.equal(result.status,exit,result.stderr);
  let calls=[];try{calls=(await readFile(log,'utf8')).trim().split('\n').map(line=>JSON.parse(line))}
  catch(error){if(error.code!=='ENOENT')throw error}
  assert.deepEqual(calls.map(call=>call[2]),expected);
  for(const call of calls)assert.deepEqual(call.slice(3),['--failed','--repo','test/atlas']);
 }finally{await rm(root,{recursive:true,force:true})}
});
