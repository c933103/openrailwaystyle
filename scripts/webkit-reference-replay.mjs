// Parse page-clock protocol arrivals, not HTTP requests. Cached reads and shared
// in-flight subscribers are explicit START events and must not be deduplicated.
import assert from 'node:assert/strict';
export function readProtocolSchedule(log) {
 const events=[], starts=new Map();
 let origin, last=-Infinity;
 for(const line of log.split('\n')){
  const match=/^ATLAS_REFERENCE_PROTOCOL_(START|ABORT) (\{.*\})$/.exec(line);
  if(!match)continue;
  const [,kind,raw]=match, {requestId,key,atMs,aborted}=JSON.parse(raw);
  assert.ok(Number.isSafeInteger(requestId)&&requestId>0&&Number.isFinite(atMs)&&atMs>=last,'Invalid protocol ordering');
  assert.match(key,/^[0-6]\/\d+\/\d+$/);
  origin??=atMs;last=atMs;
  if(kind==='START'){
   assert.equal(requestId,starts.size+1,'Incomplete start trace');
   assert.equal(typeof aborted,'boolean');
   starts.set(requestId,{key,aborted});
  }else{
   const prior=starts.get(requestId);
   assert.ok(prior?.key===key&&!prior.aborted,'Invalid or repeated abort');
   prior.aborted=true;
  }
  events.push({kind,requestId,key,offsetMs:atMs-origin,aborted:aborted===true});
 }
 assert.ok(starts.size>0&&events.length<=20000&&events.at(-1).offsetMs<=600000,'Missing or oversize protocol trace');
 return events;
}
