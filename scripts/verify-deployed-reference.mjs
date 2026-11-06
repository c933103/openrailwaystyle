// Bind the public reference to the exact manifest in the reviewed site artifact.
// The separate published browser check validates geometry; an older internally
// valid manifest must not stand in for adoption of this deployment's artifact.
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const DEPLOYED_REFERENCE_LIMITS=Object.freeze({attempts:12,requestTimeoutMs:20000,retryDelayMs:5000});

async function boundedBody(response,limit,signal){
 if(!response.body)return Buffer.alloc(0);
 const reader=response.body.getReader(),chunks=[];let received=0,abort;
 const interrupted=new Promise((_,reject)=>{
  abort=()=>{const error=signal.reason;reader.cancel(error).catch(()=>{});reject(error);};
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)abort();
 });
 try{
  while(true){
   const {value,done}=await Promise.race([reader.read(),interrupted]);
   signal.throwIfAborted();
   if(done)return Buffer.concat(chunks);
   received+=value.byteLength;
   if(received>limit)throw Error(`Deployed manifest body exceeds expected ${limit} bytes`);
   chunks.push(Buffer.from(value));
  }
 }catch(error){
  try{await reader.cancel(error);}catch{}
  throw error;
 }finally{
  signal.removeEventListener('abort',abort);reader.releaseLock();
 }
}

export async function verifyDeployedReference({baseUrl,expectedBytes,fetcher=fetch,wait=sleep,warn=console.warn,
 maxAttempts=DEPLOYED_REFERENCE_LIMITS.attempts,requestTimeoutMs=DEPLOYED_REFERENCE_LIMITS.requestTimeoutMs,
 retryDelayMs=DEPLOYED_REFERENCE_LIMITS.retryDelayMs}={}){
 for(const [value,maximum] of [[maxAttempts,12],[requestTimeoutMs,20000],[retryDelayMs,5000]]){
  if(!Number.isInteger(value)||value<1||value>maximum)throw Error('Invalid deployed-reference request bound');
 }
 const expected=Buffer.from(expectedBytes),manifest=JSON.parse(expected.toString('utf8'));
 if(manifest?.complete!==true||!/^[a-f0-9]{24}$/.test(manifest.generation)||!/^[a-f0-9]{64}$/.test(manifest.inputSha256)||!Array.isArray(manifest.sources)||manifest.sources.length!==8)throw Error('Invalid expected reference manifest');
 const base=new URL(String(baseUrl).replace(/\/?$/,'/'));
 if(!['https:','http:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw Error('Invalid deployment URL');
 const url=new URL('data/mainline-reference/manifest.json',base),expectedSha256=sha256(expected);
 let failure;
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  const signal=AbortSignal.timeout(requestTimeoutMs);
  try{
   const response=await fetcher(url,{redirect:'error',headers:{'Cache-Control':'no-cache'},signal});
   signal.throwIfAborted();
   if(!response.ok){try{await response.body?.cancel();}catch{}throw Error(`Deployed manifest HTTP ${response.status}`);}
   const actual=await boundedBody(response,expected.length,signal);
   if(!actual.equals(expected))throw Error(`Deployed manifest mismatch: expected SHA256 ${expectedSha256}; received ${sha256(actual)} (${actual.length} bytes)`);
   return {attempts:attempt,sha256:expectedSha256,bytes:expected.length,generation:manifest.generation,inputSha256:manifest.inputSha256};
  }catch(error){
   failure=error;
   if(attempt<maxAttempts){warn(`Reference adoption pending (${attempt}/${maxAttempts}): ${String(error.message).replace(/[\r\n]/g,' ').slice(0,350)}`);await wait(retryDelayMs);}
  }
 }
 throw new Error(`Deployed reference did not match expected manifest after ${maxAttempts} attempts: ${failure.message}`,{cause:failure});
}

if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const [baseUrl,path]=process.argv.slice(2);
 if(!baseUrl||!path)throw Error('Usage: verify-deployed-reference.mjs <site URL> <reviewed artifact manifest>');
 console.log('PASS: exact deployed reference manifest',JSON.stringify(await verifyDeployedReference({baseUrl,expectedBytes:await readFile(path)})));
}
