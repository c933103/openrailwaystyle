import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const shaPattern=/^[a-f0-9]{40}$/;
const repositoryPattern=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const pending=new Set(['queued','pending']);

// A push-triggered site run that has not started any jobs cannot have
// pinned the previous data generation. It will read the just-published
// reference once it gets the main Pages concurrency slot.
export function waitingSitePush(run,{repositoryId,commit}) {
  return Number.isSafeInteger(run?.id) && run.id>0 &&
    run.repository?.id===repositoryId && run.head_repository?.id===repositoryId &&
    run.path==='.github/workflows/site.yml' && run.head_branch==='main' &&
    run.head_sha===commit && run.event==='push' && run.conclusion===null &&
    pending.has(run.status);
}

export function findQueuedSitePush({event,commit,repository,repositoryId,read}) {
  if(event!=='push'||!shaPattern.test(commit??'')||!repositoryPattern.test(repository??'')||
     !Number.isSafeInteger(repositoryId)||repositoryId<=0)return null;
  const root='repos/'+repository+'/';
  const current=()=>read(root+'git/ref/heads/main').object?.sha;
  try {
    if(current()!==commit)return null;
    const matches=read(root+'actions/workflows/site.yml/runs?branch=main&head_sha='+commit+'&per_page=100').workflow_runs;
    const context={repositoryId,commit};
    for(const candidate of matches.filter(run=>waitingSitePush(run,context))){
      const detail=root+'actions/runs/'+candidate.id;
      const jobs=read(detail+'/jobs?filter=latest&per_page=1');
      if(jobs.total_count!==0||!Array.isArray(jobs.jobs)||jobs.jobs.length!==0)continue;
      if(!waitingSitePush(read(detail),context)||current()!==commit)return null;
      return candidate.id;
    }
  } catch {
    // Preserve the existing redeploy when GitHub's metadata is unavailable.
  }
  return null;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {GITHUB_EVENT_NAME:event,GITHUB_SHA:commit,GITHUB_REPOSITORY:repository,GITHUB_REPOSITORY_ID:id}=process.env;
  const candidate=findQueuedSitePush({event,commit,repository,repositoryId:Number(id),
    read:path=>JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']}))});
  if(candidate)process.stdout.write(String(candidate));
}
