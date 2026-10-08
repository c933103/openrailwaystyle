import test from 'node:test';
import assert from 'node:assert/strict';
import {createRailProviderRecovery,isRetryableRailError} from '../styles/rail-provider-recovery.mjs';
function fixture(){
 const timers=new Map(),reloads=[],source={url:'atlasrail://https://openrailwaymap.app/railway_line_high',setUrl(){reloads.push('metadata');}};
 let id=0,active=true;
 const map={getSource:()=>source,refreshTiles:(id,tiles)=>reloads.push({id,tiles})};
 const recovery=createRailProviderRecovery(map,{active:()=>active,setTimer:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimer:id=>timers.delete(id)});
 return {map,source,recovery,reloads,timers,setActive:v=>active=v,next(){const [id,t]=timers.entries().next().value;timers.delete(id);t.fn();}};
}
const tile=(x=1)=>({state:'errored',tileID:{canonical:{z:7,x,y:2}}});
test('only failed tiles are refreshed, not healthy source data or metadata',()=>{
 const f=fixture(),t=tile();
 f.recovery.noteError({sourceId:'railway',tile:t,error:new Error('Map names returned 520')});
 assert.equal(f.timers.size,1);f.next();
 assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:1,y:2}]}]);
 assert.equal(f.recovery.noteSourceData({sourceId:'railway',isSourceLoaded:true}),false);
 assert.equal(f.recovery.hasFailures(),true);
 t.state='loaded';assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:t}),true);
 assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0);f.recovery.dispose();
});
test('multiple failed tiles share a timer and preserve separate recovery evidence',()=>{
 const f=fixture(),a=tile(1),b=tile(2);
 for(const t of [a,b])f.recovery.noteError({sourceId:'railway',tile:t,error:new Error('Failed to fetch')});
 assert.equal(f.timers.size,1);f.next();assert.equal(f.reloads[0].tiles.length,2);
 a.state='loaded';f.recovery.noteSourceData({sourceId:'railway',tile:a});assert.equal(f.recovery.hasFailures(),true);
 b.state='reloading';f.next();assert.equal(f.reloads.length,1,'do not restart already loading tiles');
 f.recovery.dispose();
});
test('HTTP status takes priority over AJAXError text; cancellation is not an outage',()=>{
 for(const status of [403,404])assert.equal(isRetryableRailError(new Error('AJAXError: '+status)),false);
 for(const status of [408,429,503,520])assert.equal(isRetryableRailError({status,message:'provider response'}),true);
 assert.equal(isRetryableRailError(new Error('net::ERR_ABORTED')),false);
 const malformed=new Error('Provider returned an invalid vector tile');malformed.name='ProviderDataError';
 assert.equal(isRetryableRailError(malformed),true);
 assert.equal(isRetryableRailError(new Error('expression invalid')),false);
});
test('hidden/offline maps do no retries and disposal removes timers',()=>{
 const f=fixture();f.setActive(false);
 f.recovery.noteError({sourceId:'railway',tile:tile(),error:new Error('Failed to fetch')});assert.equal(f.timers.size,0);
 f.setActive(true);f.recovery.wake();assert.equal(f.timers.size,1);
 f.setActive(false);f.next();assert.equal(f.reloads.length,0);
 f.setActive(true);f.recovery.wake();f.recovery.dispose();assert.equal(f.timers.size,0);
});
test('source replacement discards obsolete failures and metadata needs a metadata success event',()=>{
 const f=fixture();f.recovery.noteError({sourceId:'railway',error:new Error('Failed to fetch')});
 f.next();assert.deepEqual(f.reloads,['metadata']);
 assert.equal(f.recovery.noteSourceData({sourceId:'railway',isSourceLoaded:true}),false);
 assert.equal(f.recovery.noteSourceData({sourceId:'railway',sourceDataType:'metadata'}),true);
 f.recovery.noteError({sourceId:'railway',tile:tile(),error:new Error('Failed to fetch')});
 f.map.getSource=()=>undefined;f.recovery.wake();assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0);f.recovery.dispose();
});
test('provider matching does not accept a host embedded in another host',()=>{
 const f=fixture();f.source.url='https://openrailwaymap.app.attacker.invalid/railway_line_high';
 assert.equal(f.recovery.noteError({sourceId:'railway',error:new Error('Failed to fetch')}),false);f.recovery.dispose();
});

test('repeated movement preserves the shared deadline through capped backoff and independent failures',()=>{
 let now=0,sequence=0,peak=0;
 const timers=new Map(),calls=[],sources=new Map(['a','b'].map(id=>[id,{url:'https://openrailwaymap.app/railway_line_high'}]));
 const layers=new Set(['a','b']);let active=true;
 const map={getSource:id=>sources.get(id),getZoom:()=>7,getStyle:()=>({layers:[...layers].map(source=>({source}))}),refreshTiles:(id,tiles)=>calls.push({id,tiles,at:now})};
 const recovery=createRailProviderRecovery(map,{active:()=>active,setTimer:(fn,delay)=>{timers.set(++sequence,{fn,due:now+delay});peak=Math.max(peak,timers.size);return sequence;},clearTimer:id=>timers.delete(id)});
 const advance=ms=>{const end=now+ms;for(;;){const next=[...timers].sort((a,b)=>a[1].due-b[1].due)[0];if(!next||next[1].due>end)break;now=next[1].due;timers.delete(next[0]);next[1].fn();}now=end;};
 const a=tile(1),b=tile(2);
 recovery.noteError({sourceId:'a',tile:a,error:{status:520}});
 for(const delay of [5000,15000,45000,120000,300000,300000]){
  const due=now+delay,scheduled=sequence;
  for(const step of [delay-2,1]){advance(step);recovery.wake();recovery.wake();assert.equal(sequence,scheduled,'movement must not replace the pending timer');}
  if(!calls.some(c=>c.id==='b'))recovery.noteError({sourceId:'b',tile:b,error:{status:429}});
  advance(1);assert.equal(calls.at(-1).at,due);assert.deepEqual(calls.slice(-2).map(c=>c.id),['a','b']);
 }
 assert.deepEqual(calls.map(c=>[c.id,c.at]),[5000,20000,65000,185000,485000,785000].flatMap(at=>[['a',at],['b',at]]),'no extra or postponed retry requests');
 a.state='loaded';recovery.noteSourceData({sourceId:'a',tile:a});
 const due=[...timers.values()][0].due;layers.delete('a');recovery.wake();assert.equal([...timers.values()][0].due,due,'one source must not reset another');
 active=false;recovery.wake();assert.equal(timers.size,0);const count=calls.length;advance(600000);assert.equal(calls.length,count);
 active=true;recovery.wake();assert.equal(timers.size,1);
 layers.delete('b');recovery.wake();assert.equal(timers.size,0,'irrelevant sources do not retain a retry');
 layers.add('b');recovery.wake();sources.set('b',{url:sources.get('b').url});recovery.wake();assert.equal(timers.size,0,'replaced sources are retired');
 recovery.noteError({sourceId:'b',tile:tile(3),error:{status:520}});recovery.dispose();advance(600000);assert.equal(calls.length,count);assert.equal(peak,1);
});
