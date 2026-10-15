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
test('same-canonical world copies recover independently in either success order',()=>{
 for(const first of [0,1]){
  const f=fixture(),copies=[tile(),tile()];
  copies.forEach((t,wrap)=>{t.tileID.wrap=wrap;f.recovery.noteError({sourceId:'railway',tile:t,error:{status:520}});});
  f.next();assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:1,y:2}]}]);
  const pending=[...f.timers.keys()];
  copies[first].state='loaded';
  assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:copies[first]}),true);
  assert.equal(f.recovery.hasFailures(),true,`copy ${1-first} still needs recovery`);
  assert.deepEqual([...f.timers.keys()],pending,'one success preserves the pending sibling retry');
  f.next();assert.deepEqual(f.reloads[1],f.reloads[0]);
  assert.equal([...f.timers.values()][0].delay,45000,'partial success does not reset backoff');
  copies[1-first].state='loaded';
  assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:copies[1-first]}),true);
  assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0,'final success cancels the timer');
  f.recovery.noteError({sourceId:'railway',tile:tile(2),error:{status:520}});
  assert.equal([...f.timers.values()][0].delay,5000,'fully settled failures reset backoff');f.recovery.dispose();
 }
});
test('a loaded clone cannot settle a known failure at the same canonical coordinate',()=>{
 const f=fixture(),a=tile(),b=tile(),clone=tile();clone.state='loaded';
 for(const t of [a,b])f.recovery.noteError({sourceId:'railway',tile:t,error:{status:520}});
 const pending=[...f.timers.keys()];
 assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:clone}),false);
 assert.equal(f.recovery.hasFailures(),true);assert.deepEqual([...f.timers.keys()],pending);
 f.next();assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:1,y:2}]}]);
 b.state='loaded';f.recovery.noteSourceData({sourceId:'railway',tile:b});
 assert.equal(f.recovery.hasFailures(),true);a.state='loaded';f.recovery.noteSourceData({sourceId:'railway',tile:a});
 assert.equal(f.timers.size,0);f.recovery.dispose();
});
test('repeated instance errors deduplicate without replacing the deadline or canonical retry',()=>{
 const f=fixture(),a=tile(),b=tile();
 f.recovery.noteError({sourceId:'railway',tile:a,error:{status:520}});const pending=[...f.timers.keys()];
 for(let i=0;i<5;i++)for(const t of [a,b])f.recovery.noteError({sourceId:'railway',tile:t,error:{status:520}});
 assert.deepEqual([...f.timers.keys()],pending);f.next();assert.equal(f.reloads[0].tiles.length,1);
 a.state='loaded';assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:a}),true);
 assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:a}),false);
 assert.equal(f.recovery.hasFailures(),true);
 b.state='loaded';assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:b}),true);
 assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0);f.recovery.dispose();
});
test('aborted, unloaded and loaded world copies are pruned individually',()=>{
 for(const state of ['aborted','unloaded','loaded'])for(const retired of [0,1]){
  const f=fixture(),copies=[tile(),tile()];
  for(const t of copies)f.recovery.noteError({sourceId:'railway',tile:t,error:{status:520}});
  if(state==='aborted')copies[retired].aborted=true;else copies[retired].state=state;
  f.recovery.wake();assert.equal(f.recovery.hasFailures(),true,`${state} copy ${retired} must not retire its sibling`);
  f.next();assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:1,y:2}]}]);
  copies[1-retired].state='loaded';f.recovery.noteSourceData({sourceId:'railway',tile:copies[1-retired]});
  assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0);f.recovery.dispose();
 }
});
test('canonical retries wait for loading, reloading and expired world copies',()=>{
 const states=['errored','expired','loading','reloading'];
 for(const first of states)for(const second of states){
  const f=fixture(),copies=[tile(),tile()];
  for(const t of copies)f.recovery.noteError({sourceId:'railway',tile:t,error:{status:520}});
  copies[0].state=first;copies[1].state=second;
  const inFlight=[first,second].some(state=>['loading','reloading','expired'].includes(state));
  f.next();assert.equal(f.recovery.hasFailures(),true,`${first}/${second}`);
  assert.equal(f.reloads.length,inFlight?0:1,`${first}/${second} must not restart an in-flight canonical request`);
  if(!inFlight)assert.equal(f.reloads[0].tiles.length,1);
  assert.equal([...f.timers.values()][0].delay,inFlight?5000:15000);
  if(inFlight){
   f.next();assert.equal(f.reloads.length,0);assert.equal([...f.timers.values()][0].delay,5000);
   copies.forEach(t=>{t.state='errored';});f.next();
   assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:1,y:2}]}]);
   assert.equal([...f.timers.values()][0].delay,15000);
  }
  f.recovery.dispose();assert.equal(f.timers.size,0);
 }
});
test('an in-flight world copy blocks only its canonical coordinate',()=>{
 const f=fixture(),a=tile(),b=tile(),other=tile(2);
 for(const t of [a,b,other])f.recovery.noteError({sourceId:'railway',tile:t,error:{status:520}});
 a.state='reloading';f.next();assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:2,y:2}]}]);
 assert.equal([...f.timers.values()][0].delay,15000);
 a.state='loaded';other.state='loaded';
 for(const t of [a,other])f.recovery.noteSourceData({sourceId:'railway',tile:t});
 f.next();assert.deepEqual(f.reloads[1],{id:'railway',tiles:[{z:7,x:1,y:2}]});
 assert.equal([...f.timers.values()][0].delay,45000);f.recovery.dispose();
});
test('active unrecorded world copies block canonical retries until their requests settle',()=>{
 for(const state of ['loading','reloading','expired'])for(const settle of ['loaded','unloaded','aborted','removed']){
  const f=fixture(),failed=tile(),sibling=tile(),inventory=[failed,sibling];sibling.state=state;
  f.map.style={tileManagers:{railway:{getSource:()=>f.source,getIds:()=>inventory.map((_,i)=>i),getTileByID:i=>inventory[i]}}};
  f.recovery.noteError({sourceId:'railway',tile:failed,error:{status:520}});
  for(let i=0;i<2;i++){f.next();assert.deepEqual(f.reloads,[],`${state}/${settle}`);assert.equal([...f.timers.values()][0].delay,5000);}
  if(settle==='removed')inventory.pop();else if(settle==='aborted')sibling.aborted=true;else sibling.state=settle;
  assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:sibling}),false,'unrecorded sibling cannot settle the failure');
  assert.equal(f.recovery.hasFailures(),true);f.next();
  assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:1,y:2}]}]);assert.equal([...f.timers.values()][0].delay,15000);
  failed.state='loaded';f.recovery.noteSourceData({sourceId:'railway',tile:failed});assert.equal(f.timers.size,0);f.recovery.dispose();
 }
});
test('active inventory blocking is scoped to the matching canonical coordinate and source',()=>{
 const f=fixture(),a=tile(),b=tile(2),other=tile(),unrecorded=tile();unrecorded.state='expired';
 const inventory=[a,b,unrecorded];
 f.map.style={tileManagers:{railway:{getSource:()=>f.source,getIds:()=>inventory.map((_,i)=>i),getTileByID:i=>inventory[i]}}};
 for(const [sourceId,t] of [['railway',a],['railway',b],['other',other]])f.recovery.noteError({sourceId,tile:t,error:{status:520}});
 f.next();assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:2,y:2}]},{id:'other',tiles:[{z:7,x:1,y:2}]}]);
 assert.equal([...f.timers.values()][0].delay,15000);
 for(const [sourceId,t] of [['railway',unrecorded],['railway',b],['other',other]]){t.state='loaded';f.recovery.noteSourceData({sourceId,tile:t});}
 f.next();assert.deepEqual(f.reloads[2],{id:'railway',tiles:[{z:7,x:1,y:2}]});
 assert.equal([...f.timers.values()][0].delay,45000);f.recovery.dispose();
});
test('unavailable or mismatched inventory preserves the recorded-instance compatibility guard',()=>{
 for(const kind of ['absent','incomplete','mismatched']){
  const f=fixture(),a=tile(),b=tile();a.state='reloading';
  if(kind==='incomplete')f.map.style={tileManagers:{railway:{getIds:()=>[]}}};
  if(kind==='mismatched')f.map.style={tileManagers:{railway:{getSource:()=>({url:f.source.url}),getIds:()=>{throw Error('obsolete manager');},getTileByID:()=>undefined}}};
  for(const t of [a,b])f.recovery.noteError({sourceId:'railway',tile:t,error:{status:520}});
  f.next();assert.deepEqual(f.reloads,[],kind);assert.equal([...f.timers.values()][0].delay,5000);
  a.state='loaded';f.recovery.noteSourceData({sourceId:'railway',tile:a});f.next();
  assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:1,y:2}]}]);f.recovery.dispose();
 }
});
test('settled, aborted or malformed inventory entries do not block valid canonical failures',()=>{
 for(const kind of ['loaded','unloaded','aborted','malformed']){
  const f=fixture(),a=tile(),b=tile();
  b.state=['loaded','unloaded'].includes(kind)?kind:'expired';
  if(kind==='aborted')b.aborted=true;
  if(kind==='malformed')b.tileID.canonical.z='7';
  const inventory=[a,b];
  f.map.style={tileManagers:{railway:{getSource:()=>f.source,getIds:()=>inventory.map((_,i)=>i),getTileByID:i=>inventory[i]}}};
  f.recovery.noteError({sourceId:'railway',tile:a,error:{status:520}});f.next();
  assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:1,y:2}]}],kind);f.recovery.dispose();
 }
});
test('verified empty inventory retires known and coordinate-only failures without refreshing healthy copies',()=>{
 for(const coordinateOnly of [false,true])for(const initiallyKnown of [false,true])for(const remaining of ['empty','healthy','different']){
  const f=fixture(),a=tile(),inventory=[a];
  const style={tileManagers:{railway:{getSource:()=>f.source,getIds:()=>inventory.map((_,i)=>i),getTileByID:i=>inventory[i]}}};
  if(initiallyKnown)f.map.style=style;
  const event={sourceId:'railway',...(coordinateOnly?{coord:a.tileID}:{tile:a}),error:{status:520}};
  f.recovery.noteError(event);f.next();assert.equal(f.reloads.length,1);
  inventory.length=0;
  if(remaining!=='empty'){const replacement=tile(remaining==='different'?2:1);replacement.state='loaded';inventory.push(replacement);}
  f.map.style=style;
  f.recovery.wake();assert.equal(f.recovery.hasFailures(),false,`${coordinateOnly}/${remaining}`);assert.equal(f.timers.size,0);
  f.recovery.noteError(event);assert.equal(f.recovery.hasFailures(),false,'late cached errors do not recreate demand');
  assert.equal(f.timers.size,0);assert.equal(f.reloads.length,1);f.recovery.dispose();
 }
});
test('coordinate-only failures bind unresolved active identities instead of settling on a loaded clone',()=>{
 const f=fixture(),a=tile(),b=tile(),clone=tile(),inventory=[a,b,clone];clone.state='loaded';
 f.map.style={tileManagers:{railway:{getSource:()=>f.source,getIds:()=>inventory.map((_,i)=>i),getTileByID:i=>inventory[i]}}};
 f.recovery.noteError({sourceId:'railway',coord:a.tileID,error:{status:520}});
 assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:clone}),false);
 a.state='loaded';assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:a}),true);assert.equal(f.recovery.hasFailures(),true);
 f.next();assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:1,y:2}]}]);
 b.state='loaded';assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:b}),true);
 assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0);f.recovery.dispose();
});
test('unobtainable inventory snapshots preserve compatibility failures',()=>{
 for(const kind of ['throws','non-array','missing-tile'])for(const coordinateOnly of [false,true]){
  const f=fixture(),a=tile();
  const manager={getSource:()=>f.source,getIds:()=>kind==='non-array'?null:['missing'],getTileByID:()=>undefined};
  if(kind==='throws')manager.getIds=()=>{throw Error('style transition');};
  f.map.style={tileManagers:{railway:manager}};
  f.recovery.noteError({sourceId:'railway',...(coordinateOnly?{coord:a.tileID}:{tile:a}),error:{status:520}});
  assert.equal(f.recovery.hasFailures(),true,`${kind}/${coordinateOnly}`);f.next();
  assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:1,y:2}]}]);f.recovery.dispose();
 }
});
test('real MapLibre cached expired copies cannot keep refreshing a healthy active sibling',async()=>{
 const [{build},{JSDOM},{fileURLToPath}]=await Promise.all([import('esbuild'),import('jsdom'),import('node:url')]);
 const compiled=await build({stdin:{
  contents:"export {TileManager} from './src/tile/tile_manager.ts'; export {Evented} from './src/util/evented.ts'; export {Tile} from './src/tile/tile.ts'; export {TileCache} from './src/tile/tile_cache.ts'; export {InViewTiles} from './src/tile/tile_manager_in_view_tiles.ts'; export {OverscaledTileID} from './src/tile/tile_id.ts';",
  resolveDir:fileURLToPath(new URL('.',import.meta.resolve('maplibre-gl/package.json'))),loader:'ts',
 },bundle:true,write:false,format:'iife',globalName:'fixtureLibrary',platform:'browser',
 tsconfigRaw:{compilerOptions:{useDefineForClassFields:false}},loader:{'.glsl':'text'}});
 const dom=new JSDOM('',{runScripts:'outside-only'});
 try{
  dom.window.eval(compiled.outputFiles[0].text);
  const {TileManager,Evented,Tile,TileCache,InViewTiles,OverscaledTileID}=dom.window.fixtureLibrary;
  for(const removed of [0,1])for(const cachedFirst of [false,true]){
   const source=new Evented(),requests=[],timers=new Map();let sequence=0,refreshes=0,errors=0;
   source.url='https://openrailwaymap.app/railway_line_high';source.loaded=()=>true;
   source.loadTile=tile=>{const request={tile,...Promise.withResolvers()};requests.push(request);return request.promise;};
   const manager=Object.create(TileManager.prototype);
   Object.assign(manager,{_source:source,_inViewTiles:new InViewTiles(),_outOfViewCache:new TileCache(10,tile=>tile.unloadVectorData()),_timers:{},_state:{initializeTileState(){}},map:null});
   const copies=[0,1].map(wrap=>new Tile(new OverscaledTileID(7,wrap,7,1,2),512));
   for(const tile of copies){tile.state='errored';tile.uses=1;manager._inViewTiles.setTile(tile.tileID.key,tile);}
   const map={getSource:()=>source,style:{tileManagers:{railway:manager}},refreshTiles:(_id,coords)=>{
    refreshes++;manager.refreshTiles(coords.map(c=>({equals:other=>c.z===other.z&&c.x===other.x&&c.y===other.y})));
   }};
   const recovery=createRailProviderRecovery(map,{active:()=>true,setTimer:(fn,delay)=>{timers.set(++sequence,{fn,delay});return sequence;},clearTimer:id=>timers.delete(id)});
   source.on('error',event=>{errors++;recovery.noteError({sourceId:'railway',tile:event.tile,error:event.error});});
   source.on('data',event=>recovery.noteSourceData({sourceId:'railway',tile:event.tile}));
   try{
    for(const tile of copies)recovery.noteError({sourceId:'railway',tile,error:{status:520}});
    const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();
    assert.equal(requests.length,2);assert.ok(copies.every(tile=>tile.state==='expired'));
    assert.equal([...timers.values()][0].delay,15000);const staleRetry=[...timers.values()][0].fn;
    const cached=copies[removed],active=copies[1-removed];manager._removeTile(cached.tileID.key);
    assert.equal(manager._outOfViewCache.order.length,1);assert.equal(manager.getIds().length,1);
    assert.equal(Boolean(cached.aborted),false,'real expired removal caches without aborting');
    const failCached=()=>requests.find(request=>request.tile===cached).reject(Object.assign(new dom.window.Error('synthetic HTTP 520'),{status:520}));
    const loadActive=()=>{active.state='loaded';requests.find(request=>request.tile===active).resolve();};
    for(const settle of cachedFirst?[failCached,loadActive]:[loadActive,failCached]){settle();await new Promise(setImmediate);}
    assert.equal(errors,1);assert.equal(cached.state,'errored');assert.equal(active.state,'loaded');
    assert.equal(recovery.hasFailures(),false);assert.equal(timers.size,0);
    staleRetry();recovery.wake();assert.equal(timers.size,0);assert.equal(refreshes,1);assert.equal(requests.length,2,'no healthy-only refresh amplification');
   }finally{recovery.dispose();manager._outOfViewCache.reset();}
  }
 }finally{dom.window.close();}
});
test('coordinate-only errors remain tile-scoped and settle with loaded coordinate evidence',()=>{
 const f=fixture(),t=tile(),coord=t.tileID;
 for(let i=0;i<3;i++)f.recovery.noteError({sourceId:'railway',coord,error:{status:520}});
 f.next();assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:1,y:2}]}]);
 assert.equal(f.recovery.noteSourceData({sourceId:'railway',coord,isSourceLoaded:true}),false);
 const other=tile(2);other.state='loaded';
 assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:other}),false);
 assert.equal(f.recovery.hasFailures(),true);
 t.state='loaded';assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:t}),true);
 assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0);f.recovery.dispose();
});
test('coordinate-only compatibility never clears known sibling instances or restarts them in flight',()=>{
 for(const coordinateFirst of [false,true]){
  const f=fixture(),a=tile(),b=tile(),clone=tile(),coord=a.tileID;
  const events=[{sourceId:'railway',coord,error:{status:520}},...[a,b].map(tile=>({sourceId:'railway',tile,error:{status:520}}))];
  for(const event of coordinateFirst?events:events.reverse())f.recovery.noteError(event);
  a.state='loading';f.next();assert.deepEqual(f.reloads,[]);
  clone.state='loaded';assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:clone}),true,'settles the coordinate-only marker');
  assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:clone}),false);
  assert.equal(f.recovery.hasFailures(),true);f.next();assert.deepEqual(f.reloads,[]);
  a.state='loaded';f.recovery.noteSourceData({sourceId:'railway',tile:a});
  f.next();assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:7,x:1,y:2}]}]);
  b.state='loaded';f.recovery.noteSourceData({sourceId:'railway',tile:b});
  assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0);f.recovery.dispose();
 }
});
test('grouped failures preserve visibility, activity, source and off-screen boundaries',()=>{
 for(const retire of ['removed','replaced','offscreen']){
  const f=fixture(),copies=[tile(),tile()];let visible=true;
  f.map.getZoom=()=>7;f.map.getStyle=()=>({layers:[{source:'railway',layout:{visibility:visible?'visible':'none'}}]});
  for(const t of copies)f.recovery.noteError({sourceId:'railway',tile:t,error:{status:520}});
  f.next();assert.equal(f.reloads.length,1);
  visible=false;f.recovery.wake();assert.equal(f.timers.size,0);assert.equal(f.recovery.hasFailures(),false);
  visible=true;f.recovery.wake();assert.equal([...f.timers.values()][0].delay,15000);
  f.setActive(false);f.recovery.wake();assert.equal(f.timers.size,0);
  f.setActive(true);f.recovery.wake();assert.equal([...f.timers.values()][0].delay,15000);
  if(retire==='removed')f.map.getSource=()=>undefined;
  else if(retire==='replaced'){const replacement={url:f.source.url};f.map.getSource=()=>replacement;}
  else f.map.getBounds=()=>({getWest:()=>0,getEast:()=>20,getSouth:()=>-90,getNorth:()=>90});
  f.recovery.wake();assert.equal(f.recovery.hasFailures(),false,retire);assert.equal(f.timers.size,0);
  assert.deepEqual(f.recovery.failedSourceIds(),[]);assert.equal(f.reloads.length,1);f.recovery.dispose();
 }
});
test('disposing grouped failures prevents stale timer and event callbacks from retrying',()=>{
 const f=fixture(),copies=[tile(),tile()];
 for(const t of copies)f.recovery.noteError({sourceId:'railway',tile:t,error:{status:520}});
 const stale=[...f.timers.values()][0].fn;f.recovery.dispose();stale();f.recovery.wake();
 assert.equal(f.recovery.noteError({sourceId:'railway',tile:copies[0],error:{status:520}}),false);
 copies[1].state='loaded';assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:copies[1]}),false);
 assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0);assert.deepEqual(f.reloads,[]);
});
function malformedLocations(){
 const locations=[['empty coord',{coord:{}}],['null coord',{coord:null}],['undefined coord',{coord:undefined}],
  ['empty tile',{tile:{}}],['null tile',{tile:null}],['undefined tile',{tile:undefined}],
  ['missing tile canonical',{tile:{tileID:{}}}],['missing coord canonical',{coord:{z:7,x:1,y:2}}]];
 const invalid=[['empty',{}],['null',null],['undefined',undefined],['zoom too large',{z:31,x:1,y:2}],
  ['x outside grid',{z:7,x:128,y:2}],['y outside grid',{z:7,x:1,y:128}],
  ['x outside zoom zero',{z:0,x:1,y:0}],['y outside zoom zero',{z:0,x:0,y:1}],
  ['x outside maximum zoom',{z:30,x:2**30,y:0}],['y outside maximum zoom',{z:30,x:0,y:2**30}]];
 for(const axis of ['z','x','y'])for(const value of [-1,0.5,NaN,Infinity,'1',null,undefined]){
  invalid.push([`${axis}=${String(value)}`,{z:7,x:1,y:2,[axis]:value}]);
 }
 for(const [label,canonical] of invalid){
  locations.push([`coord canonical ${label}`,{coord:{canonical}}]);
  locations.push([`tile canonical ${label}`,{tile:{state:'errored',tileID:{canonical}}}]);
 }
 return locations;
}
test('malformed error locations neither invent metadata failures nor erase existing retries',()=>{
 for(const [label,location] of malformedLocations())for(const existing of [false,true]){
  const f=fixture(),copies=[tile(),tile()];
  if(existing){for(const t of copies)f.recovery.noteError({sourceId:'railway',tile:t,error:{status:520}});f.next();}
  const pending=[...f.timers],calls=[...f.reloads];
  for(let i=0;i<2;i++)assert.equal(f.recovery.noteError({sourceId:'railway',...location,error:{status:520}}),false,label);
  assert.equal(f.recovery.hasFailures(),existing,label);
  assert.deepEqual(f.recovery.failedSourceIds(),existing?['railway']:[],label);
  assert.deepEqual([...f.timers],pending,`${label}: preserve timer and deadline`);assert.deepEqual(f.reloads,calls);
  if(existing){
   f.next();assert.deepEqual(f.reloads,[calls[0],calls[0]],`${label}: no metadata or invalid tile refresh`);
   assert.equal([...f.timers.values()][0].delay,45000,`${label}: preserve backoff`);
   for(const t of copies){t.state='loaded';f.recovery.noteSourceData({sourceId:'railway',tile:t});}
   assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0);
  }
  f.recovery.dispose();
 }
});
test('malformed success locations cannot settle metadata or existing tile failures',()=>{
 for(const [label,location] of malformedLocations()){
  const f=fixture(),t=tile();
  f.recovery.noteError({sourceId:'railway',error:{status:520}});
  f.recovery.noteError({sourceId:'railway',tile:t,error:{status:520}});
  const event={sourceId:'railway',sourceDataType:'metadata',...location};
  if(event.tile)event.tile={...event.tile,state:'loaded'};
  const pending=[...f.timers];
  assert.equal(f.recovery.noteSourceData(event),false,label);assert.deepEqual([...f.timers],pending,label);
  f.next();assert.deepEqual(f.reloads,['metadata'],`${label}: metadata remains unresolved`);
  assert.equal(f.recovery.noteSourceData({sourceId:'railway',sourceDataType:'metadata'}),true);
  f.next();assert.deepEqual(f.reloads[1],{id:'railway',tiles:[{z:7,x:1,y:2}]},`${label}: tile remains unresolved`);
  t.state='loaded';assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:t}),true);
  assert.equal(f.timers.size,0);f.recovery.dispose();
 }
});
test('valid canonical boundary coordinates remain tile-scoped',()=>{
 for(const canonical of [{z:0,x:0,y:0},{z:30,x:0,y:0},{z:30,x:2**30-1,y:2**30-1}])for(const coordinateOnly of [false,true]){
  const f=fixture(),t={state:'errored',tileID:{canonical}};
  const location=coordinateOnly?{coord:t.tileID}:{tile:t};
  assert.equal(f.recovery.noteError({sourceId:'railway',...location,error:{status:520}}),true);
  f.next();assert.deepEqual(f.reloads,[{id:'railway',tiles:[canonical]}]);
  t.state='loaded';assert.equal(f.recovery.noteSourceData({sourceId:'railway',tile:t}),true);
  assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0);f.recovery.dispose();
 }
});
test('only events without tile or coord fields establish or settle metadata failure',()=>{
 const f=fixture(),t=tile();
 assert.equal(f.recovery.noteError({sourceId:'railway',sourceDataType:'metadata',error:{status:520}}),true);
 t.state='loaded';assert.equal(f.recovery.noteSourceData({sourceId:'railway',sourceDataType:'metadata',tile:t}),false);
 assert.equal(f.recovery.noteSourceData({sourceId:'railway',sourceDataType:'metadata',coord:t.tileID}),false);
 f.next();assert.deepEqual(f.reloads,['metadata']);
 assert.equal(f.recovery.noteSourceData({sourceId:'railway',sourceDataType:'metadata'}),true);
 assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0);f.recovery.dispose();
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

function boundedFailure(west,east,south=-60,north=30,c={z:2,x:2,y:2}){
 const f=fixture();f.map.getBounds=()=>({getWest:()=>west,getEast:()=>east,getSouth:()=>south,getNorth:()=>north});
 const t={state:'errored',tileID:{canonical:c}};
 f.recovery.noteError({sourceId:'railway',tile:t,error:{status:520}});return {...f,t};
}
test('visible failures survive arbitrary positive and negative world copies without replacing their retry',()=>{
 for(const world of [-100,-3,-2,-1,0,1,2,3,100]){
  const f=boundedFailure(world*360-20,world*360+20);
  assert.equal(f.recovery.hasFailures(),true,`world ${world}`);
  const timer=[...f.timers.keys()][0];f.recovery.wake();assert.deepEqual([...f.timers.keys()],[timer]);
  f.next();assert.deepEqual(f.reloads,[{id:'railway',tiles:[{z:2,x:2,y:2}]}]);
  f.recovery.dispose();
 }
});
test('world-copy overlap preserves off-screen longitude, latitude and source retirement',()=>{
 for(const world of [-3,0,3])for(const [west,east,south,north] of [[100,120,-60,30],[-20,20,70,80],[-20,20,-85,-70]]){
  const f=boundedFailure(west+world*360,east+world*360,south,north);
  assert.equal(f.recovery.hasFailures(),false);assert.equal(f.timers.size,0);f.recovery.dispose();
 }
 const f=boundedFailure(700,740);f.map.getSource=()=>undefined;f.recovery.wake();assert.equal(f.timers.size,0);assert.equal(f.recovery.hasFailures(),false);f.recovery.dispose();
});
test('antimeridian, touching edges and world-wide viewports retain overlapping canonical tiles',()=>{
 for(const [west,east,x] of [[170,-170,3],[170,-170,0],[890,910,3],[-910,-890,0],[90,90,2],[700,1060,0],[-1000,-280,3]]){
  const f=boundedFailure(west,east,-60,30,{z:2,x,y:2});assert.equal(f.recovery.hasFailures(),true,`${west}..${east}, tile ${x}`);f.recovery.dispose();
 }
 const f=boundedFailure(700,1100,70,80);assert.equal(f.recovery.hasFailures(),false,'a world-wide viewport still prunes latitude');f.recovery.dispose();
});
test('unavailable or nonfinite bounds cannot establish off-screen longitude',()=>{
 for(const bounds of [undefined,{}, {getWest:()=>720}, {getWest:()=>NaN,getEast:()=>740}, {getWest:()=>700,getEast:()=>Infinity}]){
  const f=fixture();f.map.getBounds=()=>bounds;f.recovery.noteError({sourceId:'railway',tile:tile(),error:{status:520}});
  assert.equal(f.recovery.hasFailures(),true);f.recovery.dispose();
 }
 const f=boundedFailure(NaN,NaN,70,80);assert.equal(f.recovery.hasFailures(),false,'known latitude still establishes exclusion');f.recovery.dispose();
});

test('empty runs with missing retry methods do not consume shared backoff',()=>{
 for(const metadata of [false,true]){
  const f=fixture();f.map.refreshTiles=undefined;f.source.setUrl=undefined;
  f.recovery.noteError({sourceId:'railway',...(metadata?{}:{tile:tile()}),error:{status:520}});
  for(let i=0;i<6;i++){f.next();assert.equal([...f.timers.values()][0].delay,5000);assert.equal(f.timers.size,1);}
  assert.deepEqual(f.reloads,[]);f.recovery.dispose();
 }
});
test('mixed eligible and in-flight sources advance once per dispatching run',()=>{
 const f=fixture(),a=tile(1),b=tile(2);a.state='loading';
 f.recovery.noteError({sourceId:'a',tile:a,error:{status:520}});
 for(let i=0;i<6;i++){f.next();assert.equal([...f.timers.values()][0].delay,5000);}
 f.recovery.noteError({sourceId:'b',tile:b,error:{status:520}});
 f.recovery.noteError({sourceId:'metadata',error:{status:520}});
 f.next();assert.deepEqual(f.reloads,[{id:'b',tiles:[{z:7,x:2,y:2}]},'metadata']);assert.equal([...f.timers.values()][0].delay,15000);
 f.recovery.noteSourceData({sourceId:'metadata',sourceDataType:'metadata'});b.state='reloading';
 f.next();assert.equal(f.reloads.length,2);assert.equal([...f.timers.values()][0].delay,15000);
 a.state='errored';b.state='errored';f.next();assert.equal(f.reloads.length,4);assert.equal([...f.timers.values()][0].delay,45000);
 for(const [sourceId,t] of [['a',a],['b',b]]){t.state='loaded';f.recovery.noteSourceData({sourceId,tile:t});}
 assert.equal(f.timers.size,0);f.recovery.dispose();
});

for(const inFlightState of ['reloading','expired'])test(`two slow request attempts preserve backoff while the tile is ${inFlightState}`,async t=>{
 const {createRequestPool}=await import('../styles/request-pool.mjs');
 t.mock.timers.enable({apis:['setTimeout']});
 let now=0,fetches=0;const dispatches=[],delays=[],tileState=tile();
 const pool=createRequestPool({now:()=>now,timeout:12000,retries:[1000],fetcher:async()=>{
  if(++fetches<=2)return new Promise(()=>{});
  return {ok:true,status:200,arrayBuffer:async()=>new ArrayBuffer(0)};
 }});
 const source={url:'https://openrailwaymap.app/railway_line_high'};
 let recovery;
 const map={getSource:()=>source,refreshTiles:()=>{
  dispatches.push(now);tileState.state=inFlightState;
  pool.get('https://openrailwaymap.app/railway_line_high/7/1/2').then(()=>{
   tileState.state='loaded';recovery.noteSourceData({sourceId:'railway',tile:tileState});
  },error=>{tileState.state='errored';recovery.noteError({sourceId:'railway',tile:tileState,error});});
 }};
 recovery=createRailProviderRecovery(map,{active:()=>true,setTimer:(fn,delay)=>{delays.push(delay);return setTimeout(fn,delay);}});
 const advance=async ms=>{now+=ms;t.mock.timers.tick(ms);await new Promise(resolve=>setImmediate(resolve));};
 try{
  recovery.noteError({sourceId:'railway',tile:tileState,error:{status:520}});
  await advance(5000);assert.deepEqual(dispatches,[5000]);
  await advance(12000);await advance(1000);assert.equal(fetches,2);
  await advance(2000);assert.equal(tileState.state,inFlightState);assert.deepEqual(dispatches,[5000]);assert.deepEqual(delays,[5000,15000,15000]);
  await advance(10000);assert.equal(tileState.state,'errored');
  await advance(5000);assert.deepEqual(dispatches,[5000,35000]);assert.equal(fetches,3);
  assert.equal(tileState.state,'loaded');assert.equal(recovery.hasFailures(),false);
  await advance(300000);assert.deepEqual(dispatches,[5000,35000]);
 }finally{recovery.dispose();pool.dispose();}
});
test('a synchronous error during a real dispatch sees the incremented backoff',()=>{
 const f=fixture(),t=tile();let invoked=0;
 f.map.refreshTiles=()=>{invoked++;f.recovery.noteError({sourceId:'railway',tile:t,error:{status:520}});};
 f.recovery.noteError({sourceId:'railway',tile:t,error:{status:520}});f.next();
 assert.equal(invoked,1);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].delay,15000);f.recovery.dispose();
});
