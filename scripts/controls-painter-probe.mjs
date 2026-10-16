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
 let active=false,started=0,ended=0,frame=null,frames=[],frameCount=0,draws=0,hiddenMaskCalls=0,clearCount=0,dispatch=[],dispatchTruncated=false,timer,stopReason;
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
   if(dispatch.length<2048)dispatch.push(`${this.renderPass}:${layer.id}`);else dispatchTruncated=true;
  }
  return original.call(this,p,manager,layer,coords,...args);
 });
 wrap(map,'_render',original=>function(...args){
  if(!active)return original.apply(this,args);
  frame={start:now(),maskDraws:0,maskMs:0};dispatch=[];dispatchTruncated=false;
  try{return original.apply(this,args);}
  finally{frame.end=now();frameCount++;frames.push(frame);if(frames.length>limit)frames.shift();frame=null;}
 });
 const api={
  originalMaskSource,
  arm(){if(active)throw new Error('Capture already active');active=true;started=now();ended=0;stopReason=null;frames=[];frameCount=draws=hiddenMaskCalls=clearCount=0;dispatch=[];scope.__atlasControlsFetchProbe?.arm();timer=scope.setTimeout(()=>api.stop('capture-limit'),60000);},
  stop(reason='settlement-finished'){if(active){ended=now();active=false;stopReason=reason;scope.clearTimeout(timer);scope.__atlasControlsFetchProbe?.stop();}},
  snapshot(){return {clock:'document performance.now milliseconds',timeOrigin:scope.performance.timeOrigin,started,ended,active,guard,stopReason,captureLimitMs:60000,frameCount,frames:frames.map(f=>({...f})),framesTruncated:frameCount>limit,maskDraws:draws,hiddenMaskCalls,stencilClears:clearCount,lastVisibleDispatch:[...dispatch],dispatchTruncated,fetch:scope.__atlasControlsFetchProbe?.snapshot()??{unavailable:true}};},
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
