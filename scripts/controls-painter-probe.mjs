// Diagnostic-only wrappers. Imported by an isolated fixture page, never by the
// application or its build. Both arms get identical observation wrappers.
export function guardHiddenTileMasks(original) {
 return function(layer,...args) {
  if(layer.isHidden(this.transform.zoom))return;
  return original.call(this,layer,...args);
 };
}

// Self-contained for addInitScript. Never reads an extra body or changes an
// abort signal, URL, response bytes, retry, timeout or provider request limit.
export function installControlsFetchProbe(scope=globalThis) {
 const original=scope.fetch,now=()=>scope.performance.now(),limit=512;
 let current=null;
 const wrapped=function(...args) {
  const capture=current;
  // Preserve the original promise and scheduling outside the one capture.
  if(!capture?.active)return original.apply(this,args);
  let record;
  if(capture?.active) {
   let address;
   try{const url=new URL(typeof args[0]==='string'?args[0]:args[0]?.url,scope.location.href);
    if(url.hostname==='openrailwaymap.app')address=url.origin+url.pathname;}catch{}
   if(address){capture.total++;if(capture.records.length<limit){record={id:capture.total,url:address,start:now()};capture.records.push(record);}else capture.truncated=true;}
  }
  return (async()=>{try{
   const response=await original.apply(this,args);
   if(record){
    record.headers=now();record.status=response.status;
    const body=response.arrayBuffer;
    try{response.arrayBuffer=async function(...bodyArgs){
     record.bodyStart=now();
     try{const result=await body.apply(this,bodyArgs);record.bodyEnd=now();record.bytes=result.byteLength;return result;}
     catch(error){record.bodyFailed=now();throw error;}
    };}catch{record.bodyObservationUnavailable=true;}
   }
   return response;
  }catch(error){if(record)record.failed=now();throw error;}})();
 };
 scope.fetch=wrapped;
 const api={
  arm(){current={active:true,total:0,truncated:false,records:[]};},
  stop(){if(current)current.active=false;},
  snapshot(){return current?{total:current.total,truncated:current.truncated,records:current.records.map(r=>({...r}))}:{unavailable:true};},
  dispose(){if(current)current.active=false;if(scope.fetch===wrapped)scope.fetch=original;},
 };
 scope.__atlasControlsFetchProbe=api;return api;
}

export function installControlsPainterProbe(map,{guard=false,scope=globalThis}={}) {
 const painter=map.painter,now=()=>scope.performance.now(),restore=[],limit=128;
 if(!painter||typeof painter._renderTileClippingMasks!=='function'||typeof painter._renderTileMasks!=='function')throw new Error('Pinned renderer boundary unavailable');
 let active=false,started=0,ended=0,frame=null,frames=[],frameCount=0,draws=0,hiddenMaskCalls=0,clearCount=0,dispatch=[],dispatchRecords=[],dispatchTruncated=false,timer,stopReason;
 const terrainObservers=new WeakSet();
 const originalMaskSource=painter._renderTileClippingMasks.toString();
 function wrap(object,name,decorate){const original=object[name],replacement=decorate(original);object[name]=replacement;restore.push(()=>{if(object[name]===replacement)object[name]=original;});}
 if(guard)wrap(painter,'_renderTileClippingMasks',guardHiddenTileMasks);
 wrap(painter,'_renderTileClippingMasks',original=>function(layer,...args){
  if(active&&layer.isHidden(this.transform.zoom))hiddenMaskCalls++;
  return original.call(this,layer,...args);
 });
 wrap(painter,'_renderTileMasks',original=>function(refs,tiles,...args){
  const start=active?now():0;
  if(active){draws+=tiles.length;if(frame)frame.maskDraws+=tiles.length;}
  try{return original.call(this,refs,tiles,...args);}
  finally{if(active&&frame)frame.maskMs+=now()-start;}
 });
 wrap(painter,'clearStencil',original=>function(...args){if(active)clearCount++;return original.apply(this,args);});
 wrap(painter,'renderLayer',original=>function(p,manager,layer,coords,...args){
  if(active&&!layer.isHidden(this.transform.zoom)&&(layer.type==='background'||layer.type==='custom'||coords?.length)){
   if(dispatch.length<2048){dispatch.push(`${this.renderPass}:${layer.id}`);if(this.renderToTexture)dispatchRecords.push({pass:this.renderPass,layer:layer.id,coords:(coords||[]).map(coord=>coord.key),toTexture:!!args[0]?.isRenderingToTexture});}else dispatchTruncated=true;
  }
  return original.call(this,p,manager,layer,coords,...args);
 });
 function observeTerrain(rtt){
  if(!rtt||terrainObservers.has(rtt))return;terrainObservers.add(rtt);
  wrap(rtt,'prepareForRender',original=>function(...args){
   if(!active||!frame)return original.apply(this,args);
   const before=readControlsTerrainState(map,this);
   const result=original.apply(this,args);
   frame.terrain={before,prepared:readControlsTerrainState(map,this)};
   return result;
  });
 }
 wrap(map,'_render',original=>function(...args){
  if(!active)return original.apply(this,args);
  frame={start:now(),maskDraws:0,maskMs:0};dispatch=[];dispatchRecords=[];dispatchTruncated=false;
  observeTerrain(painter.renderToTexture);
  try{return original.apply(this,args);}
  finally{if(frame.terrain){frame.terrain.after=readControlsTerrainState(map,painter.renderToTexture);frame.terrain.dispatch=[...dispatch];frame.terrain.dispatchTruncated=dispatchTruncated;frame.terrain.records=dispatchRecords.map(record=>({...record,coords:[...record.coords]}));}frame.end=now();frameCount++;frames.push(frame);if(frames.length>limit)frames.shift();frame=null;}
 });
 const api={
  originalMaskSource,
  arm(){if(active)throw new Error('Capture already active');active=true;started=now();ended=0;stopReason=null;frames=[];frameCount=draws=hiddenMaskCalls=clearCount=0;dispatch=[];dispatchRecords=[];scope.__atlasControlsFetchProbe?.arm();timer=scope.setTimeout(()=>api.stop('capture-limit'),60000);},
  stop(reason='settlement-finished'){if(active){ended=now();active=false;stopReason=reason;scope.clearTimeout(timer);scope.__atlasControlsFetchProbe?.stop();}},
  snapshot(){return {clock:'document performance.now milliseconds',timeOrigin:scope.performance.timeOrigin,started,ended,active,guard,stopReason,captureLimitMs:60000,frameCount,frames:frames.map(f=>({...f})),framesTruncated:frameCount>limit,maskDraws:draws,hiddenMaskCalls,stencilClears:clearCount,lastVisibleDispatch:[...dispatch],lastVisibleDispatchRecords:dispatchRecords.map(record=>({...record,coords:[...record.coords]})),lastTerrain:frames.at(-1)?.terrain??null,dispatchTruncated,fetch:scope.__atlasControlsFetchProbe?.snapshot()??{unavailable:true}};},
  dispose(){api.stop();for(const undo of restore.reverse())undo();},
 };
 return api;
}

// Preserve the original controls predicate verbatim in behavior: real idle,
// all source/tile/motion conditions, and the actual canvas backing size.
export async function controlsMapIdle(map=globalThis.controlsMap) {
 await new Promise(resolve=>{map.once('idle',resolve);map.triggerRepaint();});
 const canvas=map.getCanvas(),container=map.getContainer(),ratio=map.getPixelRatio();
 return map.loaded()&&map.areTilesLoaded()&&!map.isMoving()
  &&canvas.width===Math.floor(container.clientWidth*ratio)&&canvas.height===Math.floor(container.clientHeight*ratio);
}

// A settled terrain frame may reuse any number of previously rendered textures.
// Compare explicitly cold and warm samples, retaining the natural trace separately.
// Map.redraw() is synchronous in the pinned renderer; no polling/retry is introduced.
export function sampleControlsTerrainFrame(map,probe,{cache}={}) {
 const fail=message=>{throw new Error(`Terrain sample: ${message}`);};
 if(cache!=='cold'&&cache!=='warm')fail('explicit cold/warm cache state required');
 const settled=()=>{
  const canvas=map.getCanvas(),container=map.getContainer(),ratio=map.getPixelRatio();
  return map.loaded()&&map.areTilesLoaded()&&!map.isMoving()
   &&canvas.width===Math.floor(container.clientWidth*ratio)&&canvas.height===Math.floor(container.clientHeight*ratio);
 };
 if(!settled())fail('map must already satisfy the original settlement predicates');
 const rtt=map.painter?.renderToTexture,manager=rtt?.terrain?.tileManager;
 if(!manager||typeof map.redraw!=='function')fail('pinned terrain/redraw boundary unavailable');
 const read=()=>{
  const tiles=manager.getRenderableTiles();
  if(!tiles.length)fail('nonempty terrain required');
  return {tiles,identity:{
   terrain:tiles.map(tile=>tile.tileID.key),
   sources:Object.entries(map.style.tileManagers).map(([id,source])=>({id,revision:source.getState().revision,coords:source.getVisibleCoordinates().map(coord=>coord.key)})),
   layers:map.style._order.filter(id=>!map.style._layers[id].isHidden(map.painter.transform.zoom)),
  },cache:tiles.map(tile=>({tile:tile.tileID.key,valid:tile.rtt.length>0&&tile.rtt.every(slot=>slot&&rtt.pool.getObjectForId(slot.id)?.stamp===slot.stamp)}))};
 };
 const before=read();
 if(cache==='warm'&&!before.cache.every(tile=>tile.valid))fail('warm sample requires every terrain texture to be cached');
 if(cache==='cold')for(const tile of before.tiles)tile.rtt=[];
 probe.arm();
 try{map.redraw();}finally{probe.stop(`controlled-${cache}-terrain-frame`);}
 const observation=probe.snapshot(),after=read();
 if(!settled()||JSON.stringify(before.identity)!==JSON.stringify(after.identity))fail('settled tile/source/layer identity changed during redraw');
 if(observation.frameCount!==1||observation.framesTruncated||observation.dispatchTruncated)fail('exactly one complete render frame required');
 if(!after.cache.every(tile=>tile.valid))fail('redraw did not populate every terrain texture');
 const expected=cache==='cold'?after.identity.terrain.flatMap(()=>after.identity.layers.map(id=>`translucent:${id}`)):[];
 if(JSON.stringify(observation.lastVisibleDispatch)!==JSON.stringify(expected))fail('fixture must redraw every ordered layer/tile cold and reuse every texture warm');
 return {cache,identity:after.identity,cacheBefore:before.cache,cacheAfter:after.cache,probe:observation};
}


// Observe actual terrain cache inputs/outputs; never infer equivalence from counts.
export function readControlsTerrainState(map,rtt=map.painter.renderToTexture){
 if(!rtt?.terrain?.tileManager)throw new Error('Terrain observation boundary unavailable');
 const tiles=rtt.terrain.tileManager.getRenderableTiles();
 return {identity:{
  terrain:tiles.map(tile=>tile.tileID.key),
  sources:Object.entries(map.style.tileManagers).map(([id,source])=>({id,revision:source.getState().revision,coords:source.getVisibleCoordinates().map(coord=>coord.key)})),
  layers:map.style._order.filter(id=>!map.style._layers[id].isHidden(map.painter.transform.zoom)),
 },cache:tiles.map(tile=>({tile:tile.tileID.key,slots:tile.rtt.map(slot=>!!slot&&rtt.pool.getObjectForId(slot.id)?.stamp===slot.stamp)}))};
}

// Equality is meaningful only for complete observations. In particular, [] is
// valid cold-cache evidence; an absent cache/slot/source field is never evidence.
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.length>0;
const count=value=>Number.isSafeInteger(value)&&value>=0;
const strings=value=>Array.isArray(value)&&[...value].every(text)&&new Set(value).size===value.length;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function terrainStateComplete(state){
 const identity=state?.identity;
 if(!object(state)||!object(identity)||!strings(identity.terrain)||!identity.terrain.length||!strings(identity.layers)||!identity.layers.length)return false;
 if(!Array.isArray(identity.sources)||!identity.sources.length||![...identity.sources].every(source=>object(source)&&text(source.id)&&count(source.revision)&&strings(source.coords)))return false;
 if(new Set(identity.sources.map(source=>source.id)).size!==identity.sources.length)return false;
 return Array.isArray(state.cache)&&state.cache.length===identity.terrain.length&&[...state.cache].every((entry,index)=>
  object(entry)&&entry.tile===identity.terrain[index]&&Array.isArray(entry.slots)&&[...entry.slots].every(slot=>typeof slot==='boolean'));
}
function dispatchComplete(dispatch,records,layers){
 return Array.isArray(dispatch)&&Array.isArray(records)&&dispatch.length===records.length&&dispatch.length<=2048&&[...records].every((record,index)=>
  object(record)&&['offscreen','opaque','translucent'].includes(record.pass)&&text(record.layer)&&layers.includes(record.layer)&&strings(record.coords)&&typeof record.toTexture==='boolean'&&dispatch[index]===`${record.pass}:${record.layer}`);
}
function terrainFrameComplete(terrain){
 return object(terrain)&&['before','prepared','after'].every(stage=>terrainStateComplete(terrain[stage]))
  &&equal(terrain.prepared.identity,terrain.after.identity)&&terrain.dispatchTruncated===false
  &&dispatchComplete(terrain.dispatch,terrain.records,terrain.prepared.identity.layers);
}
function terrainProbeComplete(probe){
 return object(probe)&&!probe.unavailable&&probe.active===false&&count(probe.frameCount)&&probe.frameCount>0&&probe.frameCount<=128
  &&probe.framesTruncated===false&&probe.dispatchTruncated===false&&Array.isArray(probe.frames)&&probe.frames.length===probe.frameCount
  &&[...probe.frames].every(frame=>object(frame)&&terrainFrameComplete(frame.terrain))&&terrainFrameComplete(probe.lastTerrain)
  &&equal(probe.lastTerrain,probe.frames.at(-1).terrain)
  &&dispatchComplete(probe.lastVisibleDispatch,probe.lastVisibleDispatchRecords,probe.lastTerrain.prepared.identity.layers)
  &&equal(probe.lastVisibleDispatch,probe.lastTerrain.dispatch)&&equal(probe.lastVisibleDispatchRecords,probe.lastTerrain.records);
}

export function controlsTerrainNaturalEquivalent(a,b){
 if(!terrainProbeComplete(a)||!terrainProbeComplete(b))return false;
 const equivalent=probe=>({prepared:probe.lastTerrain.prepared,after:probe.lastTerrain.after,dispatch:probe.lastVisibleDispatch,records:probe.lastVisibleDispatchRecords});
 return equal(equivalent(a),equivalent(b));
}


// This fixture-only scheduler waits for the current source-request batch before
// entering the real renderer. It does not change requests, tiles, cache entries,
// fingerprints, render inputs, or the renderer itself. Completion events already
// call triggerRepaint(); no added timer, redraw, retry, or cache reset is needed.
export function readControlsSourceBatch(map){
 if(!map.style?.tileManagers)throw new Error('Terrain source batch: managers unavailable');
 return Object.entries(map.style.tileManagers).map(([id,manager])=>{
  const source=manager.getSource?.(),tiles=manager._inViewTiles?.getAllTiles?.();
  if(!source||typeof source.loaded!=='function'||!Array.isArray(tiles)||typeof manager.getState!=='function')throw new Error('Terrain source batch: pinned source boundary unavailable');
  if(manager._sourceErrored||tiles.some(tile=>tile.state==='errored'))throw new Error('Terrain source batch: failed fixture source/tile');
  return {id,loaded:source.loaded(),revision:manager.getState().revision,
   used:!!manager.used,usedForTerrain:!!manager.usedForTerrain,
   tiles:tiles.map(tile=>({key:tile.tileID.key,state:tile.state})).sort((a,b)=>a.key.localeCompare(b.key))};
 });
}

export function installControlsTerrainBatchBarrier(map){
 if(!map.loaded()||!map.areTilesLoaded()||map.isMoving()||map._frameRequest)throw new Error('Terrain source batch: install only at an idle boundary');
 const original=map._render,limit=128,frames=[],deferred=[];
 let frameCount=0,deferredCount=0,failure=null,disposed=false;
 const clone=value=>JSON.parse(JSON.stringify(value));
 const wrapped=function(...args){
  let before;
  try{before=readControlsSourceBatch(map);}catch(error){failure=String(error.message);throw error;}
  if(before.some(source=>!source.loaded||source.tiles.some(tile=>tile.state!=='loaded'))){
   deferredCount++;if(deferred.length<limit)deferred.push(before);
   return;
  }
  const frame={before};frameCount++;if(frames.length<limit)frames.push(frame);
  try{return original.apply(this,args);}
  catch(error){failure=String(error.message);throw error;}
  finally{try{frame.after=readControlsSourceBatch(map);}catch(error){failure=String(error.message);throw error;}}
 };
 map._render=wrapped;
 return {
  snapshot(){return {kind:'complete-source-batches',frameCount,deferredCount,truncated:frameCount>limit||deferredCount>limit,failure,frames:clone(frames),deferred:clone(deferred)};},
  dispose(){if(disposed)return;disposed=true;if(map._render===wrapped)map._render=original;},
 };
}

function sourceBatchComplete(sources){
 if(!Array.isArray(sources)||!sources.length||![...sources].every(source=>object(source)&&text(source.id)&&typeof source.loaded==='boolean'&&count(source.revision)
  &&typeof source.used==='boolean'&&typeof source.usedForTerrain==='boolean'&&Array.isArray(source.tiles)&&[...source.tiles].every(tile=>object(tile)&&text(tile.key)&&['loading','loaded','reloading','expired','unloaded'].includes(tile.state))
  &&new Set(source.tiles.map(tile=>tile.key)).size===source.tiles.length))return false;
 return new Set(sources.map(source=>source.id)).size===sources.length;
}
const sourceBatchReady=sources=>sources.every(source=>source.loaded&&source.tiles.every(tile=>tile.state==='loaded'));

export function controlsTerrainBatchesEquivalent(a,b){
 for(const record of [a,b]){
  const batch=record?.sourceBatch,probe=record?.probe;
  if(!object(batch)||batch.kind!=='complete-source-batches'||batch.failure!==null||batch.truncated!==false||!count(batch.frameCount)||batch.frameCount<1||batch.frameCount>128||!count(batch.deferredCount)||batch.deferredCount>128
   ||!Array.isArray(batch.frames)||batch.frames.length!==batch.frameCount||!Array.isArray(batch.deferred)||batch.deferred.length!==batch.deferredCount||!terrainProbeComplete(probe)||batch.frameCount!==probe.frameCount)return false;
  if(![...batch.frames].every(frame=>object(frame)&&sourceBatchComplete(frame.before)&&sourceBatchReady(frame.before)&&sourceBatchComplete(frame.after)))return false;
  if(![...batch.deferred].every(sources=>sourceBatchComplete(sources)&&!sourceBatchReady(sources)))return false;
 }
 // Waiting observations remain diagnostic: their timing and completion order may
 // differ. Every actual renderer invocation must have identical complete inputs,
 // cache populations, coordinate-bearing dispatches, and resulting cache state.
 const equivalent=record=>({batches:record.sourceBatch.frames,terrain:record.probe.frames.map(frame=>frame.terrain)});
 return JSON.stringify(equivalent(a))===JSON.stringify(equivalent(b));
}
