// Shared only by the existing polar elevation and OSM maintenance reads.
// A provider pause belongs to its origin, not only the query that received it.
const MAX_PROVIDER_WAIT_MS=15*60_000;
export function createPolarTextFetcher({userAgent,fetcher=fetch,now=()=>Date.now(),
 wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),warn=console.warn}={}){
 const providers=new Map();
 return async function fetchText(url,options={}){
  const origin=new URL(url).origin;
  if(!providers.has(origin))providers.set(origin,{notBefore:0,stopped:false});
  const provider=providers.get(origin);
  const pauseError=()=>new Error('Polar provider Retry-After exceeds the 15-minute wait limit; previous data retained');
  for(let attempt=0;;attempt++){
   if(provider.stopped)throw pauseError();
   while(provider.notBefore>now())await wait(provider.notBefore-now());
   let terminal=false;
   try{
    const response=await fetcher(url,{...options,headers:{'User-Agent':userAgent,...options.headers},signal:AbortSignal.timeout(300000)});
    const receivedAt=now(),value=String(response.headers.get('retry-after')??'').trim();let pause=0;
    if(/^\d+$/.test(value))pause=Number(value)*1000;
    else if(value){const date=Date.parse(value);if(Number.isFinite(date))pause=Math.max(0,date-receivedAt);}
    if(pause>MAX_PROVIDER_WAIT_MS)provider.stopped=true;
    if(pause>0)provider.notBefore=Math.max(provider.notBefore,receivedAt+pause);
    terminal=response.status>=400&&response.status<500&&![406,408,429].includes(response.status);
    if(!response.ok){try{response.body?.cancel().catch(()=>{});}catch{}throw new Error(`HTTP ${response.status}`);}
    return await response.text();
   }catch(error){
    if(provider.stopped)throw pauseError();
    if(terminal||attempt>=3)throw error;
    warn(String(url).slice(0,80),error.message,'- retrying');
    await wait(30000*(attempt+1));
   }
  }
 };
}
