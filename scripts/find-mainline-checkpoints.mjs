import {execFileSync} from 'node:child_process';
import {readFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MAINLINE_REGIONS} from './mainline-coverage.mjs';
const repository=process.env.GITHUB_REPOSITORY;
if(!/^[\w.-]+\/[\w.-]+$/.test(repository||''))throw Error('Expected GitHub repository');
const api=path=>JSON.parse(execFileSync('gh',['api',`repos/${repository}/${path}`],{encoding:'utf8',timeout:90000,maxBuffer:8*1024**2}));
const bytes=await readFile('scripts/acquire-mainline-extract.py');
const expected=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const date=process.env.SOURCE_DATE;
if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw Error('Expected checkpoint source date');
const checkpoints={};
const runs=api('actions/workflows/mainline-reference.yml/runs?per_page=30').workflow_runs;
const recoveryRun=process.env.MAINLINE_CHECKPOINT_RUN;
if(recoveryRun){
 if(!/^[1-9]\d*$/.test(recoveryRun))throw Error('Invalid checkpoint recovery run');
 // Explicit dated recovery must remain reachable beyond the recent-run window.
 const preferred=api(`actions/runs/${recoveryRun}`);
 runs.unshift(preferred);
}
for(const run of runs){
 if(run.head_repository?.full_name!==repository||!['completed','in_progress'].includes(run.status))continue;
 const regionOf=a=>MAINLINE_REGIONS.find(region=>a.name===`mainline-source-${region}-${date}` ||
  String(run.id)===recoveryRun && date===process.env.RECOVERY_SOURCE_DATE && a.name===`mainline-source-${region}`);
 const artifacts=api(`actions/runs/${run.id}/artifacts`).artifacts.filter(a=>!a.expired&&a.size_in_bytes<1024**3&&
  regionOf(a)&&!checkpoints[regionOf(a)]);
 if(!artifacts.length)continue;
 const source=api(`contents/scripts/acquire-mainline-extract.py?ref=${run.head_sha}`);
 if(source.sha!==expected)continue;
 for(const artifact of artifacts){const region=regionOf(artifact);
  checkpoints[region]={artifact:artifact.id,run:run.id};
 }
 if(Object.keys(checkpoints).length===MAINLINE_REGIONS.length)break;
}
await appendFile(process.env.GITHUB_OUTPUT,'checkpoints='+JSON.stringify(checkpoints)+'\n');
console.log('Retained same-acquirer checkpoints',JSON.stringify(checkpoints));
