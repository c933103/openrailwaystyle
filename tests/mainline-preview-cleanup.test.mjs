import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const workflow=await readFile('.github/workflows/mainline-preview-cleanup.yml','utf8');
const script=workflow.split('        run: |\n')[1].split('\n').map(line=>line.slice(10)).join('\n');
const mock=`#!/usr/bin/env python3
import os,sys,json
args=sys.argv[1:]
method=args[args.index('--method')+1] if '--method' in args else 'GET'
with open(os.environ['CALLS'],'a') as f:f.write(json.dumps(dict(method=method,args=args))+'\\n')
case=os.environ['CASE'];seen=open(os.environ['CALLS']).read().count('\\n')
status=200;data={'ref':'refs/heads/mainline-preview-375','object':{'type':'commit','sha':'a'*40}}
if method=='GET':
 if case=='absent' or case=='gone' and seen>1:status=404;data={'message':'Not Found'}
 elif case=='wrong-ref':data['ref']='refs/heads/mainline-preview-3750'
 elif case=='list':data=[data]
 elif case in ['forbidden','server','transport']:status={'forbidden':403,'server':500,'transport':0}[case];data={'message':'unavailable'}
 elif case=='malformed':data=None
elif method=='DELETE':
 status=204;data=None
 if case=='absent' or case in ['gone','delete-fails']:status=422;data={'message':'Reference does not exist'}
 if case=='delete-forbidden':status=403;data={'message':'Forbidden'}
if '--include' in args and status:print('HTTP/2.0 '+str(status)+' Fixture\\ncontent-type: application/json\\n')
if status==200 and '--jq' in args:print(data.get('ref','') if isinstance(data,dict) else '')
elif data is not None:print(json.dumps(data))
elif case=='malformed':print('{')
if status>=400 or status==0:
 print('gh: fixture HTTP '+str(status),file=sys.stderr);sys.exit(1)
`;
async function run(scenario,preview='mainline-preview-375'){
 const root=await mkdtemp(join(tmpdir(),'preview-cleanup-'));
 try{
  await writeFile(join(root,'gh'),mock,{mode:0o755});await writeFile(join(root,'calls'),'');
  const result=spawnSync('bash',['-e','-c',script],{encoding:'utf8',timeout:10000,env:{...process.env,PATH:root+':'+process.env.PATH,CASE:scenario,CALLS:join(root,'calls'),GH_TOKEN:'fixture-no-network',GITHUB_REPOSITORY:'test/atlas',PREVIEW:preview}});
  const calls=(await readFile(join(root,'calls'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  for(const call of calls)assert.ok(call.args.some(arg=>arg==='repos/test/atlas/git/ref/heads/'+preview||arg==='repos/test/atlas/git/refs/heads/'+preview),'only the exact generated preview may be addressed');
  return {result,calls};
 }finally{await rm(root,{recursive:true,force:true});}
}
for(const [scenario,ok,methods]of [
 ['absent',true,['GET']],['present',true,['GET','DELETE']],['gone',true,['GET','DELETE','GET']],
 ['forbidden',false,['GET']],['server',false,['GET']],['transport',false,['GET']],
 ['wrong-ref',false,['GET']],['list',false,['GET']],['malformed',false,['GET']],
 ['delete-fails',false,['GET','DELETE','GET']],['delete-forbidden',false,['GET','DELETE']],
])test(`preview cleanup handles ${scenario} without treating error text as a branch`,async()=>{
 const {result,calls}=await run(scenario);
 assert.equal(result.status===0,ok,result.stderr);assert.deepEqual(calls.map(x=>x.method),methods);
});
for(const value of ['main','mainline-preview-0','mainline-preview-375/other'])test(`preview cleanup rejects an unrelated or malformed target ${value}`,async()=>{
 const {result,calls}=await run('present',value);assert.notEqual(result.status,0);assert.deepEqual(calls,[]);
});
test('cleanup keeps the same closed-PR, same-repository and serialized write scope',()=>{
 assert.match(workflow,/types: \[closed\]/);assert.match(workflow,/contents: write/);
 assert.match(workflow,/if: github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
 assert.match(workflow,/group: mainline-publication-\$\{\{ github\.event\.pull_request\.number \}\}/);
 assert.match(workflow,/cancel-in-progress: false/);
 assert.doesNotMatch(workflow,/actions\/checkout|pull_request_target|actions: write|id-token:/);
});
