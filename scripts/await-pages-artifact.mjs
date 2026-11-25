import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

const digits=/^[1-9][0-9]*$/;
const betweenProbes=[0, 2000, 4000, 8000, 12000, 18000, 24000];

export async function awaitPagesArtifact({
  apiURL, repository, runId, attempt, artifactId, token,
  fetcher=fetch, sleep=delay, delays=betweenProbes, settlingDelay=12000,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) ||
      ![runId,attempt,artifactId].every(value=>typeof value==='string'&&digits.test(value)) || !token)
    throw new Error('Missing or invalid current GitHub Pages artifact identity');
  const api = new URL(apiURL);
  if (api.protocol!=='https:' || api.username || api.password || api.search || api.hash)
    throw new Error('Expected a trusted HTTPS GitHub API URL');
  const endpoint = new URL(`repos/${repository}/actions/runs/${runId}/artifacts`,api.href.replace(/\/?$/,'/'));
  const artifactName=`github-pages-${runId}-${attempt}`;
  endpoint.searchParams.set('name',artifactName);
  const options=()=>({headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`},
    redirect:'error',signal:AbortSignal.timeout(6000)});
  let unresolved='not listed';
  for(const interval of delays) {
    if(interval)await sleep(interval);
    let response;
    try{response=await fetcher(endpoint,options());}
    catch{unresolved='transient artifact lookup failure';continue;}
    if(!response.ok){
      unresolved=`artifact lookup HTTP ${response.status}`;
      if(response.status>=500 || [404,409,429].includes(response.status))continue;
      throw new Error(unresolved);
    }
    let body;
    try{body=await response.json();}
    catch{unresolved='invalid artifact list';continue;}
    const named=body?.artifacts?.filter?.(entry=>entry?.name===artifactName)??[];
    if (named.length>1)throw new Error('Multiple artifacts use the current Pages attempt name');
    const item=named[0];
    if(!item){unresolved='not listed';continue;}
    if(String(item.id)!==artifactId)throw new Error('The listed Pages artifact is not the artifact just uploaded');
    if(item.expired!==false)throw new Error('The current Pages artifact has expired or its expiry is unverified');
    if(!Number.isSafeInteger(item.size_in_bytes)||item.size_in_bytes<=0){unresolved='artifact has not reported a positive size';continue;}
    // deploy-pages reads an internal Actions index rather than this REST
    // endpoint. Allow it a short settling interval without rerunning the build.
    await sleep(settlingDelay);
    return {artifactName,artifactId};
  }
  throw new Error(`The current Pages artifact never became visible: ${unresolved}`);
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const e=process.env;
    const result=await awaitPagesArtifact({apiURL:e.GITHUB_API_URL,repository:e.GITHUB_REPOSITORY,
      runId:e.GITHUB_RUN_ID,attempt:e.GITHUB_RUN_ATTEMPT,artifactId:e.PAGES_ARTIFACT_ID,token:e.GH_TOKEN});
    console.log(`Verified Pages artifact ${result.artifactName} (ID ${result.artifactId}).`);
  } catch(error) {
    console.error(error.message);
    process.exitCode=1;
  }
}
