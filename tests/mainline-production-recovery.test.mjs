import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative,join} from 'node:path';
const planner=await readFile('scripts/plan-mainline-reuse.mjs','utf8');
const provenance=await readFile('scripts/mainline-provenance.mjs','utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const hash='a'.repeat(64),other='b'.repeat(64),sha='c'.repeat(40);
const merged=()=>({number:461,merged_at:'2026-11-17T01:00:00Z',base:{ref:'main',repo:{full_name:'c933103/openrailwaystyle'}},head:{sha,repo:{full_name:'c933103/openrailwaystyle'}}});
const loadPlanner=async()=>{
 const code=planner.replace(/^import .*;\n/gm,'').replaceAll('export ','').split('if(process.argv[1]')[0];
 return new AsyncFunction('referenceDataInputDigestFrom',code+'\nreturn planMergedReferenceRecovery;')(
  async readSource=>(await readSource('scripts/dependency.mjs')).toString());
};
test('merged same-generator main pushes retain raw-export recovery without claiming production reuse',async()=>{
 const plan=await loadPlanner(),seen=[];
 for(const currentHead of ['first-main-merge','subsequent-browser-push']){
  const result=await plan({event:'push',ref:'refs/heads/main',repository:'c933103/openrailwaystyle',dataDigest:hash,currentHead,
   readMergedPr:async number=>{assert.equal(number,461);return merged();},
   readSourceAt:async(commit,path)=>{seen.push([commit,path]);return Buffer.from(hash);}});
  assert.deepEqual(result,{reuse:false,reason:'merged-generator-source-recovery',date:'2026-11-14',checkpointRun:'43893320392'});
 }
 assert.deepEqual(seen,[[sha,'scripts/dependency.mjs'],[sha,'scripts/dependency.mjs']]);
});
test('different generator does not retain the old recovery date',async()=>{
 const plan=await loadPlanner();
 assert.equal(await plan({event:'push',ref:'refs/heads/main',repository:'c933103/openrailwaystyle',dataDigest:other,readMergedPr:async()=>merged(),readSourceAt:async()=>Buffer.from(hash)}),null);
});
test('scheduled, manual, PR, nonmain and explicitly dated runs do not query recovery metadata',async()=>{
 const plan=await loadPlanner();
 for(const options of [{event:'schedule'},{event:'workflow_dispatch'},{event:'pull_request'},{ref:'refs/heads/feature'},{requestedDate:'2026-11-15'},{repository:'fork/repo'}])
  assert.equal(await plan({event:'push',ref:'refs/heads/main',repository:'c933103/openrailwaystyle',...options,readMergedPr:()=>{throw Error('unexpected query');}}),null);
});
test('unmerged, foreign, wrong-base and unrelated PRs cannot select raw-export recovery',async()=>{
 const plan=await loadPlanner();
 for(const change of [p=>p.merged_at=null,p=>p.number=462,p=>p.base.ref='feature',p=>p.base.repo.full_name='other/repo',p=>p.head.repo.full_name='other/repo']){
  const pr=merged();change(pr);
  assert.equal(await plan({event:'push',ref:'refs/heads/main',repository:'c933103/openrailwaystyle',readMergedPr:async()=>pr,readSourceAt:()=>{throw Error('unexpected source read');}}),null);
 }
});
test('metadata failures and unpinned sources fail before any fresh acquisition',async()=>{
 const plan=await loadPlanner(),base={event:'push',ref:'refs/heads/main',repository:'c933103/openrailwaystyle',dataDigest:hash};
 await assert.rejects(plan({...base,readMergedPr:async()=>{throw Error('metadata unavailable');}}),/metadata unavailable/);
 await assert.rejects(plan({...base,readMergedPr:async()=>({...merged(),head:{...merged().head,sha:'branch'}})}),/Unpinned/);
 await assert.rejects(plan({...base,readMergedPr:async()=>merged(),readSourceAt:async()=>{throw Error('source unavailable');}}),/source unavailable/);
});
test('immutable source reader uses the same complete generator dependency closure',async()=>{
 const files=new Map(),sha256=b=>createHash('sha256').update(b).digest('hex');
 const code=provenance.replace(/^import .*;\n/gm,'').replaceAll('export ','').split('if(process.argv[1]')[0];
 const api=await new AsyncFunction('readFile','readdir','resolve','dirname','relative','join','sha256',code+'\nreturn {DATA_INPUTS,referenceDataInputDigest,referenceDataInputDigestFrom};')(
  async path=>files.get(relative('/fixture',path)),()=>{throw Error('not used');},resolve,dirname,relative,join,sha256);
 for(const path of api.DATA_INPUTS)files.set(path,Buffer.from(''));
 files.set('scripts/mainline-overview.mjs',Buffer.from("import './mapped.mjs';"));
 files.set('scripts/mapped.mjs',Buffer.from('mapped attributes'));
 const before=await api.referenceDataInputDigestFrom(async path=>files.get(path));
 assert.equal(before,await api.referenceDataInputDigest('/fixture'));
 files.set('scripts/mapped.mjs',Buffer.from('changed mapping'));
 assert.notEqual(before,await api.referenceDataInputDigestFrom(async path=>files.get(path)));
 files.set('scripts/mainline-overview.mjs',Buffer.from("import '../../outside.mjs';"));
 await assert.rejects(api.referenceDataInputDigestFrom(async path=>files.get(path)),/escaped repository/);
});
