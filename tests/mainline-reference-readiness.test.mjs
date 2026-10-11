import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const workflow=await readFile('.github/workflows/site.yml','utf8');
const script=workflow.split('        id: reference\n')[1].split('        run: |\n')[1].split('\n  facilities:')[0].split('\n').map(line=>line.slice(10)).join('\n');
const mock=`#!/usr/bin/env python3
import os,sys,json,subprocess,pathlib
args=sys.argv[1:];endpoint=args[1];case=os.environ['READINESS_CASE'];state=pathlib.Path(os.environ['POLL_STATE'])
expected=os.environ['EXPECTED_DIGEST'];old='b'*64
if '/actions/workflows/mainline-reference.yml/runs?' in endpoint:
 poll=int(state.read_text())+1 if state.exists() else 1;state.write_text(str(poll))
 data={'workflow_runs':[dict(id=300,status='completed' if poll>1 or case!='pending_new' else 'in_progress',conclusion='success' if poll>1 or case!='pending_new' else None),dict(id=200,status='completed',conclusion='success')]}
elif '/artifacts' in endpoint:
 run=int(endpoint.split('/runs/')[1].split('/')[0]);new=run==300
 digest=expected if new else old
 name='mainline-reference-2026-10-09-'+digest if new else 'mainline-reference-2026-10-09'
 artifact=dict(id=888 if new else 777,name=name,expired=False,size_in_bytes=1234)
 if case=='older_matching':artifact['name']='mainline-reference-2026-10-09-'+(old if new else expected)
 if case=='legacy_only':artifact['name']='mainline-reference-2026-10-09'
 if case=='expired':artifact['expired']=True
 if case=='oversized':artifact['size_in_bytes']=1073741824
 if case=='empty':artifact['size_in_bytes']=0
 if case=='wrong_base':artifact['name']='mainline-reference-2026-10-09-'+old
 artifacts=[] if case=='deleted' else [artifact]
 if case=='multiple' and new:
  artifacts=[dict(artifact,id=990,name='mainline-reference-2026-10-09-'+old),dict(artifact,id=1000,expired=True),artifact,dict(artifact,id=889)]
 data={'artifacts':artifacts}
else:raise Exception(endpoint)
query=args[args.index('--jq')+1]
sys.exit(subprocess.run(['jq','-r',query],input=json.dumps(data),text=True).returncode)
`;
for(const [scenario,artifact,polls,run=300] of [
 ['older_matching','777',1,200],['matching','888',1],['pending_new','888',2],['multiple','889',1],
 ['wrong_base',null,3],['legacy_only',null,3],['expired',null,3],['deleted',null,3],['oversized',null,3],['empty',null,3],
])test(`reference readiness keeps provenance in the reference job: ${scenario}`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'atlas-reference-ready-'));
 try{
  await writeFile(join(root,'gh'),mock,{mode:0o755});
  await writeFile(join(root,'node'),'#!/bin/sh\nprintf "%s\\n" "$EXPECTED_DIGEST"\n',{mode:0o755});
  await writeFile(join(root,'git'),'#!/bin/sh\n[ "$1" = ls-remote ] && exit 2\necho unexpected git command >&2; exit 1\n',{mode:0o755});
  await writeFile(join(root,'sleep'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  await writeFile(join(root,'seq'),'#!/bin/sh\nprintf "1\\n2\\n3\\n"\n',{mode:0o755});
  const output=join(root,'outputs'),state=join(root,'poll');
  const result=spawnSync('bash',['-c',script],{encoding:'utf8',env:{...process.env,PATH:root+':'+process.env.PATH,
   GH_TOKEN:'fixture-no-network',GITHUB_REPOSITORY:'test/atlas',PR_HEAD_SHA:'1'.repeat(40),PREVIEW_BRANCH:'',
   EXPECTED_DIGEST:'a'.repeat(64),EXPECTED_REFERENCE_DIGEST:'a'.repeat(64),READINESS_CASE:scenario,POLL_STATE:state,GITHUB_OUTPUT:output}});
  assert.equal(result.status,artifact?0:1,result.stderr);
  let outputs='';try{outputs=await readFile(output,'utf8')}catch(error){if(error.code!=='ENOENT')throw error}
  assert.equal(outputs,artifact?`artifact=${artifact}\nrun=${run}\n`:'');
  assert.equal(Number(await readFile(state,'utf8')),polls);
 }finally{await rm(root,{recursive:true,force:true})}
});

test('publisher names accepted artifacts with current input digest and validator keeps content gate',async()=>{
 const publisher=await readFile('.github/workflows/mainline-reference.yml','utf8');
 assert.match(publisher,/name: mainline-reference-\$\{\{ needs\.plan\.outputs\.date \}\}-\$\{\{ steps\.provenance\.outputs\.digest \}\}/);
 assert.match(publisher,/digest=\$\(node scripts\/mainline-provenance\.mjs\)/);
 assert.match(workflow,/verify-mainline-snapshot\.mjs styles\/data\/mainline-reference --require-browser-acceptance/);
 assert.match(workflow,/test "\$actual" = "\$\(node scripts\/mainline-provenance\.mjs\)"/);
 assert.ok(workflow.includes('name: Require worldwide railway reference ${{ steps.inputs.outputs.digest }}'));
 assert.ok(workflow.includes('EXPECTED_REFERENCE_DIGEST: ${{ steps.inputs.outputs.digest }}'));
});
