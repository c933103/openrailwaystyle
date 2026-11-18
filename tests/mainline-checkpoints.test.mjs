import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=await readFile('scripts/find-mainline-checkpoints.mjs','utf8');
const run=async({recovery='',recoveryDate='',wrongAcquirer=false,expired=false,foreign=false}={})=>{
 const bytes=Buffer.from('unchanged acquirer'),expected=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
 const recent={id:2,status:'completed',head_repository:{full_name:'owner/repo'},head_sha:'new'};
 const old={id:1,status:'completed',head_repository:{full_name:foreign?'other/repo':'owner/repo'},head_sha:'old'};
 const artifact=(id,name)=>({id,name,size_in_bytes:100,expired:false});
 let output;
 const responses={
  'actions/workflows/mainline-reference.yml/runs?per_page=30':{workflow_runs:recovery?[recent]:[recent,old]},
  'actions/runs/1':old,
  'actions/runs/2/artifacts':{artifacts:[artifact(20,'mainline-source-asia-2026-11-15')]},
  'actions/runs/1/artifacts':{artifacts:[{...artifact(10,recovery?'mainline-source-asia':'mainline-source-asia-2026-11-14'),expired}]},
  'contents/scripts/acquire-mainline-extract.py?ref=old':{sha:wrongAcquirer?'changed':expected}
 };
 const api=(command,args)=>{assert.equal(command,'gh');const key=args[1].replace('repos/owner/repo/','');assert.ok(key in responses,key);return JSON.stringify(responses[key]);};
 const execute=Object.getPrototypeOf(async function(){}).constructor('execFileSync','readFile','appendFile','createHash','MAINLINE_REGIONS','process','console',source.replace(/^import .*;\n/gm,''));
 await execute(api,async()=>bytes,async(path,text)=>{output=JSON.parse(text.slice('checkpoints='.length));},createHash,['asia'],
  {env:{GITHUB_REPOSITORY:'owner/repo',SOURCE_DATE:'2026-11-14',MAINLINE_CHECKPOINT_RUN:recovery,RECOVERY_SOURCE_DATE:recoveryDate,GITHUB_OUTPUT:'unused'}},{log(){}});
 return output;
};
test('newer wrong-date artifact cannot hide the older matching-date export',async()=>{
 assert.deepEqual(await run(),{asia:{artifact:10,run:1}});
});
test('explicit dated legacy recovery remains reachable outside the recent-run window',async()=>{
 assert.deepEqual(await run({recovery:'1',recoveryDate:'2026-11-14'}),{asia:{artifact:10,run:1}});
});
test('legacy recovery refuses mismatched date, expired export, changed acquirer and foreign repository',async()=>{
 for(const options of [{recoveryDate:'2026-11-15'},{expired:true},{wrongAcquirer:true},{foreign:true}])
  assert.deepEqual(await run({recovery:'1',recoveryDate:'2026-11-14',...options}),{});
});
