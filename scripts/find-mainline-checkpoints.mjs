import {execFileSync} from 'node:child_process';
import {readFile,appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MAINLINE_REGIONS} from './mainline-coverage.mjs';
const repository=process.env.GITHUB_REPOSITORY;
if(!/^[\w.-]+\/[\w.-]+$/.test(repository||''))throw Error('Expected GitHub repository');
const api=path=>JSON.parse(execFileSync('gh',['api',`repos/${repository}/${path}`],{encoding:'utf8',timeout:90000,maxBuffer:8*1024**2}));
const bytes=await readFile('scripts/acquire-mainline-extract.py');
const expected=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const checkpoints={};
const runs=api('actions/workflows/mainline-reference.yml/runs?per_page=30').workflow_runs;
for(const run of runs){
 if(run.head_repository?.full_name!==repository||!['completed','in_progress'].includes(run.status))continue;
 const artifacts=api(`actions/runs/${run.id}/artifacts`).artifacts.filter(a=>!a.expired&&a.size_in_bytes<1024**3&&
  MAINLINE_REGIONS.some(region=>a.name===`mainline-source-${region}`&&!checkpoints[region]));
 if(!artifacts.length)continue;
 const source=api(`contents/scripts/acquire-mainline-extract.py?ref=${run.head_sha}`);
 if(source.sha!==expected)continue;
 for(const artifact of artifacts){const region=artifact.name.slice('mainline-source-'.length);
  checkpoints[region]={artifact:artifact.id,run:run.id};
 }
 if(Object.keys(checkpoints).length===MAINLINE_REGIONS.length)break;
}
await appendFile(process.env.GITHUB_OUTPUT,'checkpoints='+JSON.stringify(checkpoints)+'\n');
console.log('Retained same-acquirer checkpoints',JSON.stringify(checkpoints));
