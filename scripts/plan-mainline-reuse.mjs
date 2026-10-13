import {execFileSync} from 'node:child_process';
import {appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateReferenceManifest} from '../styles/mainline-reference.mjs';
import {validateMainlineSources} from './mainline-coverage.mjs';
import {referenceDataInputDigest} from './mainline-provenance.mjs';

// This only chooses a candidate. The entire pinned dataset must still pass
// current checksum/coverage validation and fresh current-app browser acceptance.
export async function reusableReference(manifest,{dataDigest}={}){
 validateReferenceManifest(manifest);validateMainlineSources(manifest.sources);
 if(manifest.sourceDate!==manifest.sources[0].date)throw Error('Changed reference source date');
 if(!manifest.rendererAcceptance?.complete||!/^[a-f0-9]{64}$/.test(manifest.inputSha256||''))
  throw Error('Published reference lacks accepted provenance');
 if(!/^[a-f0-9]{64}$/.test(dataDigest||''))throw Error('Missing current generator identity');
 if(manifest.dataInputSha256!==undefined){
  if(!/^[a-f0-9]{64}$/.test(manifest.dataInputSha256))throw Error('Invalid published generator identity');
  return manifest.dataInputSha256===dataDigest;
 }
 // Legacy data has no independently recorded generator identity. Rebuild once
 // through the normal verified source path rather than infer equivalence.
 return false;
}

export async function planReferenceReuse({event,requestedDate,readPublished,root=process.cwd()}={}){
 if(event==='schedule'||event==='workflow_dispatch'||requestedDate)return {reuse:false,reason:'explicit-refresh'};
 if(!['pull_request','push'].includes(event))throw Error('Unsupported reference event');
 const published=await readPublished();
 if(!published)return {reuse:false,reason:'no-published-reference'};
 if(!/^[a-f0-9]{40}$/.test(published.sha||''))throw Error('Unpinned reference candidate');
 const dataDigest=await referenceDataInputDigest(root),manifest=published.manifest;
 if(!await reusableReference(manifest,{dataDigest}))return {reuse:false,reason:'generator-provenance-missing-or-mismatch'};
 return {reuse:true,sha:published.sha,date:manifest.sourceDate,generation:manifest.generation,dataDigest};
}

async function main(){
 const repository=process.env.GITHUB_REPOSITORY;
 if(!/^[\w.-]+\/[\w.-]+$/.test(repository||''))throw Error('Expected GitHub repository');
 const api=path=>JSON.parse(execFileSync('gh',['api',`repos/${repository}/${path}`],{encoding:'utf8',timeout:90000,maxBuffer:2*1024**2}));
 const result=await planReferenceReuse({event:process.env.REFERENCE_EVENT,requestedDate:process.env.REQUESTED,
  readPublished:async()=>{
   // Absence is a known bootstrap condition; other transport/API errors fail
   // rather than silently turning a failed read into a new acquisition.
   const refs=api('git/matching-refs/heads/mainline-data');
   const ref=refs.find(ref=>ref.ref==='refs/heads/mainline-data');if(!ref)return null;
   const sha=ref.object.sha,file=api(`contents/manifest.json?ref=${sha}`);
   if(file.encoding!=='base64'||file.size>256*1024)throw Error('Invalid reference manifest envelope');
   return {sha,manifest:JSON.parse(Buffer.from(file.content,'base64').toString('utf8'))};
  }
 });
 const outputs={reuse:String(result.reuse),reference_sha:result.sha||'',reference_date:result.date||''};
 for(const [key,value] of Object.entries(outputs))await appendFile(process.env.GITHUB_OUTPUT,`${key}=${value}\n`);
 console.log('Reference plan',JSON.stringify(result));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
