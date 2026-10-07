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
