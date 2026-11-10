// Keep startup fixtures in separate Node test processes: evaluated VM modules
// retain their contexts on Node 24 even after JSDOM closes and GC runs.
import {test,encodeTile,assert,gzipSync,model,powerFacilities,stationFallbackModule,featureFilter,code,style,start,tick,providerHubTile,deferredHubHarness} from './startup-harness.mjs';

test('Service view starts with hollow stations and restores ordinary markers when changing mode',async()=>{
 const {dom,window,maps,errors}=await start({search:'?mode=service&stations=1&language=en'});
 try{
  const map=maps[0],layers=map.options.style.layers;
  const stations=layers.filter(layer=>layer.id.startsWith('station-')&&layer.type==='circle');
  assert.ok(stations.length>=7,'provider and both fallback sources are covered');
  for(const layer of stations){
   assert.equal(layer.paint['circle-opacity'],0,`${layer.id}: hollow before the first frame`);
   assert.equal(layer.paint['circle-stroke-color'],'#657571');
  }
  const route=layers.findIndex(layer=>layer.id==='service-routes');
  assert.ok(stations.every(layer=>layers.indexOf(layer)<route),'routes paint above every ordinary station source');
  assert.ok(route<layers.findIndex(layer=>layer.id==='place_label_city'),'accepted place text remains above routes');
  map.handlers['style.load']();
  window.document.querySelector('[data-mode="infrastructure"]').click();
  for(const layer of stations){
   const original=style.layers.find(item=>item.id===layer.id)
    ||stationFallbackModule.stationFallbackLayers(model.labelExpression).find(item=>item.id===layer.id);
   assert.equal(map.paintProperties[layer.id]['circle-color'],original.paint['circle-color']);
   assert.deepEqual(map.paintProperties[layer.id]['circle-radius'],original.paint['circle-radius']);
   assert.equal(map.paintProperties[layer.id]['circle-opacity'],1,'ordinary visibility is restored');
  }
  window.document.querySelector('[data-mode="service"]').click();
  assert.equal(map.paintProperties['station-provider-dots']['circle-opacity'],0);
  assert.equal(map.visibility['service-routes'],'visible');
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});


test('curated hub names with rare Han wait for their slices before reaching the map',async()=>{
 const penn=style.sources.stationMajor.data.features.find(f=>f.properties.wikidata==='Q54451');
 const member=penn.properties.osm_ids.split(';').concat([penn.properties.id])[0];
 const fetcher=async url=>String(url).includes('rare-han-v1/index.json')?{ok:true,status:200,json:async()=>({blocks:[0x2a7]})}:{ok:true,status:200,json:async()=>structuredClone(style)};
 const stationTile=async(url,lang)=>{
  const result=encodeTile.fromGeojsonVt({standard_railway_text_stations:{features:[{type:1,id:1,tags:{id:`${member}-train-train-station`,name:'\u{2A700}站',atlas_name:'\u{2A700}站',atlas_language:lang},geometry:[[2049,2048]]}]}},{version:2});
  return result.buffer.slice(result.byteOffset,result.byteOffset+result.byteLength);};
 const {dom,maps,fonts}=await start({search:'?language=local#3/40.75/-74',fetcher,stationTile,fontFaces:true});
 try{
  const map=maps[0],source=map.getSource.bind(map);
  map.getSource=id=>id==='stations'?{tiles:['atlasstation://local/https://tiles.test/stations/{z}/{x}/{y}']}:source(id);
  map.getBounds=()=>({getWest:()=>-80,getEast:()=>-70,getSouth:()=>35,getNorth:()=>45});
  map.handlers['style.load']();
  const slice=()=>fonts.find(f=>/rare-han-v1\/2a7\.woff2/.test(f.url));
  for(let i=0;i<100&&!slice();i++)await new Promise(r=>setTimeout(r,0));
  assert.ok(slice(),'the slice of the hub name is requested');
  const named=()=>map.sourceData?.stationMajor?.features.find(f=>f.properties.wikidata==='Q54451');
  assert.ok(named(),'the location is already present while its name waits');
  assert.equal(named().properties.atlas_name,'','the name waits for its slice');
  slice().finish();
  for(let i=0;i<50&&!named()?.properties.atlas_name;i++)await new Promise(r=>setTimeout(r,0));
  assert.equal(named()?.properties.atlas_name,'\u{2A700}站');
 }finally{dom.window.close();}
});
for(const layer of stationFallbackModule.STATION_FALLBACK_IDS)test(`visible ${layer} supports hover and station details through settings and recovery`,async()=>{
 const {dom,window,maps}=await start({search:'?mode=infrastructure&language=en&stations=1'});
 try{
  const doc=window.document,map=maps[0];map.zoom=10;
  map.getLayer=id=>map.options.style.layers.find(item=>item.id===id);
  map.isMoving=()=>false;
  window.cancelAnimationFrame=()=>{};window.requestAnimationFrame=callback=>{callback();return 1;};
  map.handlers['style.load']();
  const point={x:500,y:400},lngLat={lng:2.3753,lat:48.8909};
  map.rendered=[{source:layer.includes('curated')?'stationMajor':'openmaptiles',sourceLayer:'poi',
   layer:{id:layer},properties:{id:42,osm_id:42,osm_type:'node',name:'Fallback Paris',
    class:'railway',subclass:'station',feature:'station',state:'present'},
   geometry:{type:'Point',coordinates:[lngLat.lng,lngLat.lat]}}];
  const check=visible=>{
   // Keep the synthetic hit present even when hidden: the app must exclude
   // hidden fallback layers from its interaction query, not trust this stub.
   doc.getElementById('details').hidden=true;
   map.handlers.mousemove({point,lngLat,originalEvent:{buttons:0}});
   assert.equal(map.getCanvas().style.cursor,visible?'pointer':'');
   map.handlers.click({point,lngLat});
   assert.equal(doc.getElementById('details').hidden,!visible);
   if(visible)assert.equal(doc.querySelector('#details h2').textContent,'Fallback Paris');
  };
  check(false);
  map.handlers.error({sourceId:'stations',error:{status:503,message:'HTTP503'}});check(true);
  for(const mode of ['speed','infrastructure']){doc.querySelector(`[data-mode="${mode}"]`).click();check(true);}
  const stations=doc.getElementById('stations');
  for(const enabled of [false,true]){stations.checked=enabled;stations.dispatchEvent(new window.Event('change'));check(enabled);}
  const language=doc.getElementById('language');language.value='fr';language.dispatchEvent(new window.Event('change'));await tick();
  map.handlers.error({sourceId:'stations',error:{status:503,message:'HTTP503'}});check(true);
  map.handlers.sourcedata({sourceId:'stations',sourceDataType:'metadata',isSourceLoaded:true});check(false);
 }finally{maps[0]?.handlers.remove?.();dom.window.close();}
});
test('anonymous curated fallback clicks retain the exact selected OSM identity',async()=>{
 const {dom,window,maps}=await start({search:'?mode=infrastructure&language=en&stations=1'});
 try{
  const doc=window.document,map=maps[0];map.zoom=10;
  map.getLayer=id=>map.options.style.layers.find(item=>item.id===id);
  map.handlers['style.load']();
  map.handlers.error({sourceId:'stations',error:{status:503,message:'HTTP503'}});
  for(const id of ['24680','24681']) {
   map.rendered=[{source:'stationMajor',layer:{id:'station-curated-fallback-dots'},
    properties:{id:`curated-${id}`,osm_id:id,osm_type:'node',name:'',atlas_name:'',feature:'station',state:'present'},
    geometry:{type:'Point',coordinates:[2.3753,48.8909]}}];
   doc.getElementById('details').hidden=true;
   map.handlers.click({point:{x:500,y:400},lngLat:{lng:2.3753,lat:48.8909}});
   assert.equal(doc.getElementById('details').hidden,false,'anonymous markers remain interactive');
   assert.equal(doc.querySelector('#details h2').textContent,'Unnamed station');
   assert.equal(doc.querySelector('#details .osm-link').href,`https://www.openstreetmap.org/node/${id}`,
    'the selected object changes even when both titles are anonymous');
  }
 }finally{maps[0]?.handlers.remove?.();dom.window.close();}
});
for(const zoom of [9,9.8,10,11,12])test(`station fallback tracks actual source errors and settings at Paris zoom ${zoom}`,async()=>{
 const {dom,window,maps}=await start({search:'?mode=infrastructure&language=en&stations=1'});
 try{
  const map=maps[0];map.zoom=zoom;map.getLayer=id=>map.options.style.layers.find(layer=>layer.id===id);
  map.handlers['style.load']();
  const ids=stationFallbackModule.STATION_FALLBACK_IDS;
  const visibility=()=>ids.map(id=>map.getLayoutProperty(id,'visibility'));
  assert.deepEqual(visibility(),['none','none','none'],'healthy sources never duplicate station markers');
  map.handlers.error({sourceId:'railway',error:{status:403,message:'HTTP 403'}});
  assert.deepEqual(visibility(),['none','none','none'],'railway errors cannot activate a station fallback');
  map.handlers.error({sourceId:'stations',error:{status:403,message:'HTTP 403'}});
  assert.deepEqual(visibility(),['visible','visible','visible'],'station source error enables points and names');
  assert.match(window.document.getElementById('map-status').textContent,/station and track data unavailable/);
  for(const mode of ['speed','electrification','infrastructure']){
   window.document.querySelector(`[data-mode="${mode}"]`).click();assert.deepEqual(visibility(),['visible','visible','visible']);
  }
  for(const background of ['carto','hybrid']){
   window.document.querySelector(`[data-background="${background}"]`).click();assert.deepEqual(visibility(),['visible','visible','visible']);
  }
  const stations=window.document.getElementById('stations');stations.checked=false;stations.dispatchEvent(new window.Event('change'));
  assert.deepEqual(visibility(),['none','none','none']);
  stations.checked=true;stations.dispatchEvent(new window.Event('change'));assert.deepEqual(visibility(),['visible','visible','visible']);
  window.document.querySelector('[data-background="satellite"]').click();assert.deepEqual(visibility(),['none','none','none']);
  window.document.querySelector('[data-background="map"]').click();assert.deepEqual(visibility(),['visible','visible','visible']);
 }finally{maps[0].handlers.remove();dom.window.close();}
});
test('curated fallback repopulates on cold load and pan at raw zoom 22',async()=>{
 const input=structuredClone(style);
 const point=(id,coordinates)=>({type:'Feature',id,properties:{id,feature:'station',tier:3,name:'deferred'},geometry:{type:'Point',coordinates}});
 input.sources.stationMajor.data={type:'FeatureCollection',features:[point('paris',[2.3753,48.8909]),point('distant',[32.3753,48.8909])]};
 const {dom,maps}=await start({search:'?detail=2&language=en&stations=1',fetcher:async()=>({ok:true,json:async()=>structuredClone(input)})});
 try{
  const map=maps[0];map.zoom=22;
  map.getBounds=()=>({getWest:()=>2.37,getEast:()=>2.38,getSouth:()=>48.88,getNorth:()=>48.90});
  assert.equal(map.options.style.sources.stationMajor.data.features.length,0,'startup really clears the embedded GeoJSON');
  map.handlers['style.load']();await tick();await tick();
  assert.ok(map.sourceData.stationMajor,'cold maximum-zoom load must populate the source');
  assert.deepEqual(Array.from(map.sourceData.stationMajor.features,f=>f.properties.id),['paris'],'cold maximum-zoom load publishes the visible hub');
  map.getBounds=()=>({getWest:()=>32.37,getEast:()=>32.38,getSouth:()=>48.88,getNorth:()=>48.90});
  map.handlers.moveend();await tick();await tick();
  assert.ok(map.sourceData.stationMajor.features.some(f=>f.properties.id==='distant'),'maximum-zoom pan refreshes geometry beyond the initial viewport');
 }finally{maps[0].handlers.remove();dom.window.close();}
});

test('station fallback keeps the failed tile mask through neighboring success, recovery and pan',async()=>{
 const {dom,maps,window}=await start({search:'?mode=infrastructure&stations=1'});
 try{
  const map=maps[0];map.zoom=10;map.getLayer=id=>map.options.style.layers.find(layer=>layer.id===id);
  map.handlers['style.load']();
  const ids=stationFallbackModule.STATION_FALLBACK_IDS;
  const a={state:'errored',tileID:{canonical:{z:10,x:518,y:352}}},b={state:'errored',tileID:{canonical:{z:10,x:519,y:352}}};
  map.handlers.error({sourceId:'stations',tile:a,error:{status:403,message:'HTTP 403'}});
  for(const id of ids){
   assert.equal(map.getLayoutProperty(id,'visibility'),'visible');
   assert.equal(map.getFilter(id)[2][0],'within','fallback uses failed-tile geometry instead of the whole source');
   assert.equal(map.getFilter(id)[2][1].coordinates.length,1);
  }
  const first=JSON.stringify(map.getFilter(ids[0]));
  map.handlers.sourcedata({sourceId:'stations',tile:{...b,state:'loaded'},isSourceLoaded:true});
  assert.equal(JSON.stringify(map.getFilter(ids[0])),first,'neighbor success retains the exact failed-area mask');
  assert.match(window.document.getElementById('map-status').textContent,/station data unavailable/);
  map.handlers.error({sourceId:'stations',tile:b,error:{status:403,message:'HTTP 403'}});
  assert.equal(map.getFilter(ids[0])[2][1].coordinates.length,2);
  a.state='loaded';map.handlers.sourcedata({sourceId:'stations',tile:a,isSourceLoaded:true});
  assert.equal(map.getFilter(ids[0])[2][1].coordinates.length,1,'only one recovered tile leaves the failure set');
  assert.notEqual(JSON.stringify(map.getFilter(ids[0])),first);
  b.state='unloaded';map.handlers.moveend();
  for(const id of ids)assert.equal(map.getLayoutProperty(id,'visibility'),'none','panning to loaded tiles retires fallback');
  map.handlers.sourcedata({sourceId:'stations',tile:{...b,state:'loaded'},isSourceLoaded:true});
  assert.equal(window.document.getElementById('map-status').classList.contains('error'),false);
 }finally{maps[0].handlers.remove();dom.window.close();}
});

test('healthy descendant success immediately masks retained ancestor failures without clearing status',async()=>{
 const {dom,maps,window}=await start({search:'?mode=infrastructure&stations=1'});
 try{
  const map=maps[0];map.zoom=10;map.getLayer=id=>map.options.style.layers.find(layer=>layer.id===id);map.handlers['style.load']();
  const parent={state:'errored',tileID:{wrap:0,canonical:{z:9,x:259,y:176}}};
  const failed={state:'errored',tileID:{wrap:0,canonical:{z:10,x:518,y:352}}};
  const healthy={state:'loading',tileID:{wrap:0,canonical:{z:10,x:519,y:352}}};
  const tiles=[parent,failed,healthy];
  map.style={tileManagers:{stations:{getSource:()=>map.getSource('stations'),getIds:()=>tiles.map((_,i)=>i),getTileByID:i=>tiles[i]}}};
  for(const tile of [parent,failed])map.handlers.error({sourceId:'stations',tile,error:{status:403,message:'HTTP403'}});
  const shown=(id,tile)=>featureFilter(map.getFilter(id)).filter({zoom:10},{type:1,properties:{class:'railway',subclass:'station',feature:'station',tier:3},geometry:[[{x:4096,y:4096}]]},tile.tileID.canonical);
  for(const id of stationFallbackModule.STATION_FALLBACK_IDS)assert.equal(shown(id,healthy),true);
  healthy.state='loaded';map.handlers.sourcedata({sourceId:'stations',tile:healthy,isSourceLoaded:false});
  for(const id of stationFallbackModule.STATION_FALLBACK_IDS){
   assert.equal(shown(id,healthy),false,'only sourcedata is needed to remove the healthy neighbor fallback');
   assert.equal(shown(id,failed),true,'failed child stays covered');
   assert.equal(map.getLayoutProperty(id,'visibility'),'visible');
  }
  assert.match(window.document.getElementById('map-status').textContent,/station data unavailable/);
 }finally{maps[0].handlers.remove();dom.window.close();}
});

for(const transition of ['expired','reloading','errored','unloaded','aborted','removed','content-reloading','content-expired','native-abort'])test(`descendant ${transition} immediately restores installed station fallback masks without idle`,async()=>{
 const {dom,maps,window}=await start({search:'?mode=infrastructure&stations=1'});
 try{
  const map=maps[0];map.zoom=10;map.getLayer=id=>map.options.style.layers.find(layer=>layer.id===id);map.handlers['style.load']();
  const parent={state:'errored',tileID:{wrap:0,canonical:{z:9,x:259,y:176}}};
  const failed={state:'errored',tileID:{wrap:0,canonical:{z:10,x:518,y:352}}};
  const child={state:'loaded',tileID:{wrap:0,canonical:{z:10,x:519,y:352}}};
  const tiles=[parent,failed,child];
  map.style={tileManagers:{stations:{getSource:()=>map.getSource('stations'),getIds:()=>tiles.map((_,i)=>i),getTileByID:i=>tiles[i]}}};
  for(const tile of [parent,failed])map.handlers.error({sourceId:'stations',tile,error:{status:403,message:'HTTP403'}});
  const ids=stationFallbackModule.STATION_FALLBACK_IDS;
  const shown=(id,tile)=>featureFilter(map.getFilter(id)).filter({zoom:10},{type:1,properties:{class:'railway',subclass:'station',feature:'station',tier:3},geometry:[[{x:4096,y:4096}]]},tile.tileID.canonical);
  for(const id of ids)assert.equal(shown(id,child),false,'loaded child initially excludes fallback');
  const calls=[],setFilter=map.setFilter.bind(map);map.setFilter=(id,filter)=>{calls.push(id);setFilter(id,filter);};
  const sourceContent=transition.startsWith('content-');
  if(transition==='removed')tiles.pop();else if(transition==='aborted')child.aborted=true;else child.state=transition.replace('content-','');
  if(transition==='native-abort'){child.state='reloading';child.aborted=true;tiles.pop();}
  map.handlers[transition==='native-abort'?'sourcedataabort':'sourcedata'](sourceContent
   ? {sourceId:'stations',sourceDataType:'content',sourceDataChanged:transition==='content-expired',isSourceLoaded:false}
   : {sourceId:'stations',tile:child,isSourceLoaded:false});
  assert.deepEqual(calls,[...ids],'all three literal filters must refresh on the lifecycle event');
  for(const id of ids){assert.equal(shown(id,child),true,'obsolete hole closes immediately');assert.equal(shown(id,failed),true);}
  assert.match(window.document.getElementById('map-status').textContent,/station data unavailable/);
  calls.length=0;child.state='loaded';child.aborted=false;if(['removed','native-abort'].includes(transition))tiles.push(child);
  map.handlers.sourcedata({sourceId:'stations',tile:child,isSourceLoaded:false});
  assert.deepEqual(calls,[...ids],'successful recovery removes fallback again');
  for(const id of ids){assert.equal(shown(id,child),false);assert.equal(shown(id,failed),true);}
  calls.length=0;map.handlers.sourcedata({sourceId:'stations',tile:child,isSourceLoaded:false});
  assert.equal(calls.length,0,'unchanged filters are not reinstalled');
 }finally{maps[0].handlers.remove();dom.window.close();}
});

test('ordinary failed world copies retain fallback and status until all copies recover',async()=>{
 const {dom,maps,window}=await start({search:'?mode=infrastructure&stations=1'});
 try{
  const map=maps[0];map.zoom=10;map.getLayer=id=>map.options.style.layers.find(layer=>layer.id===id);map.handlers['style.load']();
  const a={state:'errored',tileID:{canonical:{z:10,x:518,y:352}}},b={state:'errored',tileID:{canonical:{z:10,x:518,y:352}}};
  for(const tile of [a,b])map.handlers.error({sourceId:'stations',tile,error:{status:403,message:'HTTP403'}});
  const status=window.document.getElementById('map-status');
  b.state='loaded';map.handlers.sourcedata({sourceId:'stations',tile:b,isSourceLoaded:true});
  for(const id of stationFallbackModule.STATION_FALLBACK_IDS)assert.equal(map.getLayoutProperty(id,'visibility'),'visible');
  assert.match(status.textContent,/station data unavailable/);
  a.state='loaded';map.handlers.sourcedata({sourceId:'stations',tile:a,isSourceLoaded:true});
  for(const id of stationFallbackModule.STATION_FALLBACK_IDS)assert.equal(map.getLayoutProperty(id,'visibility'),'none');
  assert.equal(status.classList.contains('error'),false);
 }finally{maps[0].handlers.remove();dom.window.close();}
});

test('source-data inventory pruning immediately updates the remaining station mask',async()=>{
 const {dom,maps,window}=await start({search:'?mode=infrastructure&stations=1'});
 try{
  const map=maps[0];map.zoom=11;map.getLayer=id=>map.options.style.layers.find(layer=>layer.id===id);map.handlers['style.load']();
  const a={state:'errored',tileID:{canonical:{z:10,x:518,y:352}}},b={state:'errored',tileID:{canonical:{z:10,x:519,y:352}}};
  const child={state:'loaded',tileID:{canonical:{z:11,x:1036,y:704}}};let tiles=[a,b];
  map.style={tileManagers:{stations:{getSource:()=>map.getSource('stations'),getIds:()=>tiles.map((_,i)=>i),getTileByID:i=>tiles[i]}}};
  for(const tile of [a,b])map.handlers.error({sourceId:'stations',tile,error:{status:403,message:'HTTP403'}});
  const ids=stationFallbackModule.STATION_FALLBACK_IDS;
  for(const id of ids)assert.equal(map.getFilter(id)[2][1].coordinates.length,2);
  tiles=[b,child];map.handlers.sourcedata({sourceId:'stations',tile:child,isSourceLoaded:true});
  for(const id of ids)assert.equal(map.getFilter(id)[2][1].coordinates.length,1,'no idle or move event required');
  assert.match(window.document.getElementById('map-status').textContent,/station data unavailable/);
 }finally{maps[0].handlers.remove();dom.window.close();}
});

test('coordinate-only station failure clears presentation and status after a healthy pan',async()=>{
 const {dom,maps,window}=await start({search:'?mode=infrastructure&stations=1'});
 try{
  const map=maps[0];map.zoom=10;map.getLayer=id=>map.options.style.layers.find(layer=>layer.id===id);
  map.getBounds=()=>({getWest:()=>2,getEast:()=>3,getSouth:()=>48,getNorth:()=>49});
  map.handlers['style.load']();
  map.handlers.error({sourceId:'stations',coord:{canonical:{z:10,x:518,y:352}},error:{status:403,message:'HTTP 403'}});
  const ids=stationFallbackModule.STATION_FALLBACK_IDS,status=window.document.getElementById('map-status');
  for(const id of ids)assert.equal(map.getLayoutProperty(id,'visibility'),'visible');
  assert.match(status.textContent,/station data unavailable/);
  map.getBounds=()=>({getWest:()=>20,getEast:()=>21,getSouth:()=>48,getNorth:()=>49});
  map.handlers.moveend();await tick();
  for(const id of ids)assert.equal(map.getLayoutProperty(id,'visibility'),'none');
  assert.doesNotMatch(status.textContent,/station data unavailable/);
  assert.equal(status.classList.contains('error'),false);
 }finally{maps[0].handlers.remove();dom.window.close();}
});

test('coordinate-only parent station failures retire when healthy higher-zoom tiles replace them',async()=>{
 const {dom,maps,window}=await start({search:'?mode=infrastructure&stations=1'});
 try{
  const map=maps[0];map.zoom=10;map.getLayer=id=>map.options.style.layers.find(layer=>layer.id===id);
  map.getBounds=()=>({getWest:()=>2,getEast:()=>3,getSouth:()=>48,getNorth:()=>49});map.handlers['style.load']();
  map.handlers.error({sourceId:'stations',coord:{canonical:{z:10,x:518,y:352}},error:{status:403,message:'HTTP 403'}});
  const ids=stationFallbackModule.STATION_FALLBACK_IDS,status=window.document.getElementById('map-status');
  assert.match(status.textContent,/station data unavailable/);
  map.zoom=11;map.handlers.moveend();
  map.handlers.sourcedata({sourceId:'stations',tile:{state:'loaded',tileID:{canonical:{z:11,x:1036,y:704}}},isSourceLoaded:true});await tick();
  for(const id of ids)assert.equal(map.getLayoutProperty(id,'visibility'),'none');
  assert.equal(status.classList.contains('error'),false);
  map.zoom=10;map.handlers.moveend();assert.equal(status.classList.contains('error'),false,'old parent does not resurrect');
 }finally{maps[0].handlers.remove();dom.window.close();}
});

for(const inventory of [false,true])test(`late coordinate-only station error cannot replace healthy zoom selection (inventory ${inventory})`,async()=>{
 const {dom,maps,window}=await start({search:'?mode=infrastructure&stations=1'});
 try{
  const map=maps[0];map.zoom=11;map.getLayer=id=>map.options.style.layers.find(layer=>layer.id===id);
  map.getBounds=()=>({getWest:()=>2,getEast:()=>3,getSouth:()=>48,getNorth:()=>49});map.handlers['style.load']();
  const healthy={state:'loaded',tileID:{canonical:{z:11,x:1036,y:704}}};
  if(inventory)map.style={tileManagers:{stations:{getSource:()=>map.getSource('stations'),getIds:()=>[0],getTileByID:()=>healthy}}};
  map.handlers.sourcedata({sourceId:'stations',tile:healthy,isSourceLoaded:true});
  const late=()=>map.handlers.error({sourceId:'stations',coord:{canonical:{z:10,x:518,y:352}},error:{status:403,message:'HTTP 403'}});
  late();await tick();
  const status=window.document.getElementById('map-status');
  for(const id of stationFallbackModule.STATION_FALLBACK_IDS)assert.equal(map.getLayoutProperty(id,'visibility'),'none');
  assert.equal(status.classList.contains('error'),false);
  map.handlers.error({sourceId:'stations',error:{status:403,message:'metadata HTTP 403'}});
  late();await tick();
  assert.match(status.textContent,/station data unavailable/,'obsolete tile cannot clear a separate metadata failure');
 }finally{maps[0].handlers.remove();dom.window.close();}
});

for(const [mode,source] of [['owner','ownerLow'],['axle','axleLow']])test(`${mode} low-zoom HTTP 403 remains an ORM railway outage`,async()=>{
 const {dom,maps,window}=await start({search:`?mode=${mode}&stations=0`});
 try{
  const map=maps[0];map.zoom=6;map.handlers['style.load']();
  map.handlers.error({sourceId:source,error:{status:403,message:'HTTP 403'}});
  const status=window.document.getElementById('map-status');
  assert.match(status.textContent,/OpenRailwayMap railway data unavailable/);
  assert.doesNotMatch(status.textContent,/Retrying|Some map data/,'nonretryable failure retains the provider identity');
  assert.equal(status.classList.contains('error'),true);
 }finally{maps[0].handlers.remove();dom.window.close();}
});
for(const options of [{metadata:false},{stationProtocol:false}])test(`curated dots survive an unavailable name dependency: ${Object.keys(options)[0]}`,async()=>{
 const h=await deferredHubHarness({tier:3,...options});
 try{
  assert.ok(h.point(),'local geometry does not require provider metadata or name protocols');
  assert.equal(h.point().properties.atlas_name,'');assert.equal(h.pending.length,0);
 }finally{h.dom.window.close();}
});
test('a selected deferred dot is named when missing provider metadata later becomes available',async()=>{
 const h=await deferredHubHarness({metadata:false});
 try{
  assert.ok(h.point());h.click();for(let i=0;i<5;i++)await tick();
  assert.equal(h.pending.length,0,'selection cannot request a nonexistent tile template');
  h.stationSource.tiles=['atlasstation://en/https://tiles.test/stations/{z}/{x}/{y}'];
  h.map.handlers.sourcedata({sourceId:'stations',sourceDataType:'metadata'});
  for(let i=0;i<50&&!h.pending.length;i++)await tick();
  assert.equal(h.pending.length,1,'metadata recovery names only the selected deferred station');
  h.pending[0].resolve(providerHubTile(h.hub,'en'));for(let i=0;i<50&&!h.departures.some(s=>s.names.includes('Provider hub (en)'));i++)await tick();
  assert.equal(h.window.document.querySelector('#detail-content h2').textContent,'Provider hub (en)');
 }finally{h.dom.window.close();}
});
test('curated locations publish before an eligible provider name request settles',async()=>{
 const h=await deferredHubHarness({tier:3});
 try{
  assert.ok(h.point(),'an unresolved name must not suppress its dot');
  assert.equal(h.point().properties.atlas_name,'');
  assert.equal(h.pending.length,1,'only the current tile is requested initially');
  h.pending[0].resolve(providerHubTile(h.hub,'en'));
  for(let i=0;i<50&&!h.point().properties.atlas_name;i++)await tick();
  assert.equal(h.point().properties.atlas_name,'Provider hub (en)');
 }finally{h.dom.window.close();}
});
test('opening a deferred curated dot loads its provider name and refreshes name-based departure matching',async()=>{
 const h=await deferredHubHarness();
 try{
  assert.ok(h.point());assert.equal(h.pending.length,0,'below-tier hubs have no bulk name request');
  h.click();h.click();
  for(let i=0;i<50&&!h.pending.length;i++)await tick();
  assert.equal(h.pending.length,1,'repeated selection shares the provider tile promise');
  assert.match(h.window.document.querySelector('#detail-content h2').textContent,/Unnamed station/);
  h.pending[0].resolve(providerHubTile(h.hub,'en'));
  for(let i=0;i<50&&!h.departures.some(s=>s.names.includes('Provider hub (en)'));i++)await tick();
  assert.equal(h.window.document.querySelector('#detail-content h2').textContent,'Provider hub (en)');
  assert.ok(h.departures.some(s=>s.names.includes('Provider hub (en)')),'the unnamed cached board cannot mask named matching');
  assert.equal(h.pending.length,1,'selecting one dot does not name the rest of the world');
 }finally{h.dom.window.close();}
});
test('failed selected-hub lookups stay bounded and preserve the anonymous point',async()=>{
 const h=await deferredHubHarness();
 try{
  h.click();
  for(let index=0;index<5;index++){
   for(let i=0;i<50&&h.pending.length<=index;i++)await tick();
   assert.ok(h.pending[index],`candidate ${index+1} requested`);
   h.pending[index].reject(new Error('synthetic unavailable tile'));
  }
  for(let i=0;i<10;i++)await tick();
  assert.equal(h.pending.length,5,'one z8 tile and four neighbours, never an overview fan-out');
  assert.ok(h.point());assert.equal(h.point().properties.atlas_name,'');
  assert.equal(h.window.document.querySelector('#detail-content h2').textContent,'Unnamed station');
 }finally{h.dom.window.close();}
});
for(const action of ['close','select another station'])test(`a deferred curated name cannot overwrite the panel after ${action}`,async()=>{
 const h=await deferredHubHarness();
 try{
  h.click();for(let i=0;i<50&&!h.pending.length;i++)await tick();
  if(action==='close')h.window.document.getElementById('details-close').click();
  else{
   h.map.rendered=[{source:'stations',layer:{id:'station-stations-dots'},properties:{id:'node-999',name:'Other station'},geometry:{type:'Point',coordinates:[1,2]}}];
   h.map.handlers.click({point:{x:500,y:400},lngLat:{lng:1,lat:2}});
  }
  h.pending[0].resolve(providerHubTile(h.hub,'en'));for(let i=0;i<10;i++)await tick();
  if(action==='close')assert.equal(h.window.document.getElementById('details').hidden,true);
  else assert.equal(h.window.document.querySelector('#detail-content h2').textContent,'Other station');
  assert.equal(h.departures.some(s=>s.names.includes('Provider hub (en)')),false,'stale completion must not start a new board');
 }finally{h.dom.window.close();}
});
test('an open deferred hub follows the newest language and ignores its older pending name',async()=>{
 const h=await deferredHubHarness();
 try{
  h.click();for(let i=0;i<50&&!h.pending.length;i++)await tick();
  const select=h.window.document.getElementById('language');select.value='fr';select.dispatchEvent(new h.window.Event('change'));
  for(let i=0;i<50&&!h.pending.some(p=>p.language==='fr');i++)await tick();
  const french=h.pending.find(p=>p.language==='fr');assert.ok(french);
  french.resolve(providerHubTile(h.hub,'fr'));for(let i=0;i<50&&!h.departures.some(s=>s.names.includes('Provider hub (fr)'));i++)await tick();
  h.pending.find(p=>p.language==='en').resolve(providerHubTile(h.hub,'en'));for(let i=0;i<10;i++)await tick();
  assert.equal(h.window.document.querySelector('#detail-content h2').textContent,'Provider hub (fr)');
  assert.equal(h.departures.some(s=>s.names.includes('Provider hub (en)')),false);
 }finally{h.dom.window.close();}
});

test('tiles served as stored load the rare Han slices of their text, such as service route names',async()=>{
 const tile=name=>{const result=encodeTile.fromGeojsonVt({service_routes:{features:[{type:2,id:1,tags:{name,trains:268439664},geometry:[[[0,0],[4096,4096]]]}]}},{version:2});return result.buffer.slice(result.byteOffset,result.byteOffset+result.byteLength);};
 const tiles={'8/1/1':tile('\u{2A700}線'),'8/1/2':tile('Plain line')};
 const fetcher=async url=>{url=String(url);
  if(url.includes('rare-han-v1/index.json'))return {ok:true,status:200,json:async()=>({blocks:[0x2a7]})};
  if(url.includes('service-routes/index.json'))return {ok:true,status:200,json:async()=>({tiles:Object.keys(tiles)})};
  const key=/service-routes\/(\d+\/\d+\/\d+)\.pbf\.gz/.exec(url)?.[1];
  if(key)return {ok:true,status:200,arrayBuffer:async()=>tiles[key].slice(0)};
  return {ok:true,status:200,json:async()=>structuredClone(style)};};
 const {dom,maps,fonts}=await start({fetcher,fontFaces:true});
 try{
  for(let i=0;i<100&&!maps.protocols.servicetiles;i++)await new Promise(r=>setTimeout(r,0));
  const plain=await maps.protocols.servicetiles({url:'servicetiles://8/1/2'},new AbortController());
  assert.ok(plain.data.byteLength>0);assert.equal(fonts.filter(f=>/rare-han/.test(f.url)).length,0,'a number whose bytes look like UTF-8 loads nothing');
  let done=false;const pending=maps.protocols.servicetiles({url:'servicetiles://8/1/1'},new AbortController()).then(r=>{done=true;return r;});
  const slice=()=>fonts.find(f=>/rare-han-v1\/2a7\.woff2/.test(f.url));
  for(let i=0;i<100&&!slice();i++)await new Promise(r=>setTimeout(r,0));
  assert.ok(slice(),'the route name requests its slice');assert.equal(done,false,'the tile waits for it');
  slice().finish();assert.ok((await pending).data.byteLength>0);
 }finally{dom.window.close();}
});

test('real renderer initialization failures reach the visible error message', async () => {
  const {dom,window,errors} = await start({failWebGL:true});
  try {
    assert.equal(errors.length,1);
    assert.match(window.document.getElementById('map-status').textContent,/could not start WebGL/);
    assert.equal(window.document.body.dataset.mapReady,undefined);
  } finally {dom.window.close();}
});


test('station inspection finds nearby interchanges and facility inspection avoids railway fields', async () => {
  const {dom,window,maps,errors}=await start();
  try {
    assert.deepEqual(errors,[]);const map=maps[0];map.handlers['style.load']();map.zoom=14;
    const station={source:'stations',sourceLayer:'standard_railway_text_stations',layer:{id:'station-detail-large-names'},properties:{name:'Central',station_size:'large',state:'present'},geometry:{type:'Point',coordinates:[0,0]}};
    const bus={id:123,source:'openmaptiles',sourceLayer:'poi',layer:{id:'context-transport-bus-label'},properties:{name:'Central Bus Interchange',class:'bus',subclass:'bus_station'},geometry:{type:'Point',coordinates:[0.001,0]}};
    map.sourceFeatures=[bus,bus];map.rendered=[station];
    map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
    const nearby=window.document.getElementById('nearby-transport');
    assert.match(nearby.textContent,/Central Bus Interchange/);
    assert.match(nearby.textContent,/110 m/);
    assert.match(nearby.textContent,/not verified/);
    assert.equal(nearby.querySelectorAll('li').length,1);
    await new Promise(resolve => setTimeout(resolve, 0));
    const board = window.document.querySelector('#detail-content .departures');
    assert.match(board.textContent, /No matching rail timetable stop was found within 400 m/);
    assert.match(board.querySelector('.departure-links a').href, /^https:\/\/api\.transitous\.org\/\?fromPlace=/);
    assert.equal([...board.querySelectorAll('a')].at(-1).href, 'https://transitous.org/sources/');
    map.rendered=[bus];map.handlers.click({point:{x:500,y:400},lngLat:{lng:0.001,lat:0}});
    const detail=window.document.getElementById('detail-content');
    assert.match(detail.textContent,/TRANSPORT FACILITY/);
    assert.doesNotMatch(detail.textContent,/Speed|Not recorded|RAILWAY INFRASTRUCTURE/);
    assert.equal(errors.length,0);
  } finally {dom.window.close();}
});

test('museum and theatre context does not offer a pointer or intercept railway inspection',async()=>{
  const {dom,window,maps}=await start();
  try {
    const map=maps[0];map.handlers['style.load']();map.zoom=14;map.isMoving=()=>false;
    window.cancelAnimationFrame=()=>{};window.requestAnimationFrame=callback=>{callback();return 1;};
    const point=(layer,properties)=>({source:'openmaptiles',sourceLayer:'poi',layer:{id:layer},properties,geometry:{type:'Point',coordinates:[0,0]}});
    const event={point:{x:500,y:400},lngLat:{lng:0,lat:0},originalEvent:{buttons:0}};
    for (const subclass of ['museum','theatre']) {
      map.rendered=[point('context-destinations-culture-label',{name:`Test ${subclass}`,subclass})];
      map.handlers.mousemove(event);
      assert.equal(map.getCanvas().style.cursor,'',subclass);
      map.handlers.click(event);
      assert.equal(window.document.getElementById('details').hidden,true,subclass);
    }
    const station={source:'stations',sourceLayer:'standard_railway_text_stations',layer:{id:'station-detail-large-names'},properties:{name:'Station beneath theatre',station_size:'large',state:'present'},geometry:{type:'Point',coordinates:[0,0]}};
    map.rendered=[point('context-destinations-culture-label',{name:'Theatre',subclass:'theatre'}),station];
    map.handlers.click(event);
    assert.match(window.document.getElementById('detail-content').textContent,/Station beneath theatre/);
    const bus=point('context-transport-bus-label',{name:'Bus interchange',class:'bus',subclass:'bus_station'});
    map.rendered=[bus];map.handlers.mousemove(event);
    assert.equal(map.getCanvas().style.cursor,'pointer');
    map.handlers.click(event);
    assert.match(window.document.getElementById('detail-content').textContent,/TRANSPORT FACILITY/);
  } finally {dom.window.close();}
});

test('concurrent train-control systems use compact names with complete hover and native expandable descriptions',async()=>{
  const {dom,window,maps,errors}=await start({search:'?mode=control'});
  try {
    const map=maps[0];map.getLayer=id=>map.options.style.layers.find(layer=>layer.id===id);
    map.handlers['style.load']();map.zoom=18;
    const codes=['etcs_2','lzb','pzb'];
    const feature={source:'railway',sourceLayer:'railway',layer:{id:'control-tracks'},properties:{name:'Shared protection systems',state:'present',train_protection0:'etcs_2',train_protection1:'lzb',train_protection2:'pzb',train_protection:'etcs_2;lzb;pzb;etcs_2'},geometry:{type:'LineString',coordinates:[[0,0],[0.001,0]]}};
    map.rendered=[feature];
    map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
    map.handlers.moveend();await new Promise(resolve=>setTimeout(resolve,300));
    for (const container of [window.document.getElementById('detail-content'),window.document.getElementById('legend')]) {
      const labels=[...container.querySelectorAll('details.system-label')];
      assert.equal(labels.length,3,'all concurrent systems appear once despite repeated tags');
      assert.deepEqual(labels.map(label=>label.querySelector('summary').textContent).sort(),['ETCS L2','LZB','PZB'].sort());
      for (const code of codes) {
        const system=model.trainProtection(code),label=labels.find(label=>label.querySelector('summary').textContent===model.trainProtectionShort(code));
        const summary=label.querySelector('summary'),description=[system[1],model.CONTROL_LEVELS[system[3]],model.CONTROL_FAMILIES[system[2]].note].join(' · ');
        assert.equal(label.open,false,'full descriptions start collapsed');
        assert.equal(summary.title,description,'hover includes the complete name, level and compatibility explanation');
        assert.equal(label.querySelector('.system-description').textContent,description);
        assert.ok(label instanceof window.HTMLDetailsElement,'native details/summary keeps tap and keyboard access');
        summary.click();assert.equal(label.open,true,'tapping the summary exposes its description');
        summary.click();assert.equal(label.open,false);
      }
    }
    assert.equal(errors.length,0);
  } finally {dom.window.close();}
});

test('railway energy supplies download once at facility zoom and relocalize existing data on language changes',async()=>{
  const requests=[],collection={type:'FeatureCollection',features:[{type:'Feature',id:'node-91',properties:{power_kind:'fuel',name:'Local railway depot','name:en':'Railway fuel depot','name:ja':'鉄道給油所'},geometry:{type:'Point',coordinates:[0,0]}}]};
  const {dom,window,maps,errors}=await start({fetcher:async url=>{
    const power=String(url).includes('/data/traction/power/power-facilities.geojson.gz');
    if(power)requests.push(String(url));
    if(String(url).includes('/data/traction/power/'))return new Response(gzipSync(JSON.stringify(power?collection:{type:'FeatureCollection',features:[]})));
    return {ok:true,json:async()=>structuredClone(style)};
  }});
  try {
    const map=maps[0];map.zoom=9;map.handlers['style.load']();
    assert.equal(requests.length,0,'Infrastructure does not request the Power dataset');
    window.document.querySelector('[data-mode="electrification"]').click();
    assert.equal(requests.length,0,'Power overview does not request detailed facilities');
    window.document.querySelector('[data-background="satellite"]').click();
    map.zoom=12;map.handlers.moveend();
    assert.equal(requests.length,0,'satellite without rail overlays does not request supplies');
    window.document.querySelector('[data-background="carto"]').click();
    // Decompressing the gzip snapshot takes a few event-loop turns.
    for(let turn=0;turn<50&&!map.sourceData.electricFacilities?.features?.length;turn++)await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(requests.length,1);
    const original=collection.features[0],loaded=map.sourceData.electricFacilities.features[0];
    assert.equal(loaded.id,original.id);assert.equal(loaded.type,original.type);assert.deepEqual(loaded.geometry,original.geometry);
    for(const [key,value] of Object.entries(original.properties))assert.equal(loaded.properties[key],value,'recorded supply tags are preserved');
    assert.equal(loaded.properties.atlas_name,original.properties.name);
    assert.equal(loaded.properties.atlas_language,'local');
    map.rendered=[{...loaded,source:'electricFacilities',layer:{id:'electrification-supply-points'}}];
    map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
    assert.equal(window.document.querySelector('#detail-content h2').textContent,original.properties.name);
    const language=window.document.getElementById('language');
    for(const code of ['en','ja']) {
      language.value=code;language.dispatchEvent(new window.Event('change'));
      await new Promise(resolve=>setTimeout(resolve,0));
      const localized=map.sourceData.electricFacilities.features[0].properties;
      assert.equal(localized.atlas_name,original.properties[`name:${code}`]);
      assert.equal(localized.atlas_language,code);
      for(const [key,value] of Object.entries(original.properties))assert.equal(localized[key],value,'language changes keep the original mapped tags');
      assert.equal(window.document.querySelector('#detail-content h2').textContent,original.properties[`name:${code}`]);
      assert.equal(requests.length,1,'language changes relocalize the loaded snapshot without another download');
    }
    map.handlers.moveend();map.handlers.moveend();
    window.document.querySelector('[data-mode="infrastructure"]').click();
    window.document.querySelector('[data-mode="electrification"]').click();
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(requests.length,1,'moving and returning to Power reuse the loaded snapshot');
    assert.equal(errors.length,0);
  } finally {dom.window.close();}
});

test('Power facilities inspect their supply type and source object without train speed or timetable fields',async()=>{
  const {dom,window,maps,errors}=await start({search:'?mode=electrification',fetcher:async url=>({ok:true,json:async()=>String(url).includes('power-facilities.geojson')?{type:'FeatureCollection',features:[]}:structuredClone(style)})});
  try {
    const map=maps[0];map.handlers['style.load']();map.zoom=18;
    const supplies=[
      ['fuel','node',91,{railway:'fuel',fuel:'diesel'}],
      ['coaling_facility','way',92,{railway:'coaling_facility'}],
      ['water_tank','relation',93,{railway:'water_tank',content:'water',capacity:'100 m³'}],
      ['plant','way',94,{power:'plant','plant:source':'hydro','plant:output:electricity':'20 MW'}],
    ];
    for (const [kind,type,id,tags] of supplies) {
      const feature={source:'electricFacilities',layer:{id:'electrification-supply-points'},properties:{...tags,name:`Test ${kind}`,power_kind:kind,power_state:'present',osm_type:type,osm_id:String(id)},geometry:{type:'Point',coordinates:[0,0]}};
      map.rendered=[feature];map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
      const detail=window.document.getElementById('detail-content');
      assert.match(detail.textContent,/RAILWAY ENERGY SUPPLY/);
      assert.ok(detail.textContent.includes(powerFacilities.POWER_FACILITY_KINDS[kind].label));
      assert.equal(detail.querySelector(`a[href="https://www.openstreetmap.org/${type}/${id}"]`)?.textContent,`Open this ${type} on OpenStreetMap ↗`);
      assert.doesNotMatch(detail.textContent,/Speed label|Train protection|Departures|RAILWAY INFRASTRUCTURE/);
      if(tags.fuel)assert.match(detail.textContent,/Recorded suppliesdiesel/);
      if(tags.capacity)assert.match(detail.textContent,/Capacity100 m³/);
      if(tags['plant:output:electricity'])assert.match(detail.textContent,/Output20 MW/);
    }
    map.rendered=[{source:'electricSubstations',sourceLayer:'electrification_substation',layer:{id:'electrification-substation-areas'},properties:{name:'Traction footprint',voltage:'25000'},geometry:{type:'Polygon',coordinates:[[[0,0],[0.001,0],[0,0.001],[0,0]]]}}];
    map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
    assert.match(window.document.getElementById('detail-content').textContent,/Traction footprintTypeTraction substation/);
    // A charger mapped as a line or area shares electricMethods with track
    // strokes but opens the facility inspector, not a track panel.
    for (const geometry of [{type:'LineString',coordinates:[[0,0],[0.001,0]]},{type:'Polygon',coordinates:[[[0,0],[0.001,0],[0.001,0.001],[0,0]]]}]) {
      map.rendered=[{source:'electricMethods',layer:{id:geometry.type==='Polygon'?'electrification-charging-areas':'electrification-charging-outlines'},properties:{name:'Shaped charger',amenity:'charging_station',train:'yes',power_kind:'charging_station',power_state:'present',osm_type:'way',osm_id:'95'},geometry}];
      map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
      const detail=window.document.getElementById('detail-content').textContent;
      assert.match(detail,/RAILWAY ENERGY SUPPLY/,geometry.type);
      assert.ok(detail.includes('Shaped charger')&&detail.includes(powerFacilities.POWER_FACILITY_KINDS.charging_station.label),geometry.type);
    }
    assert.equal(errors.length,0);
  } finally {dom.window.close();}
});

test('Power details keep train fuel, storage and generation sources distinct',async t=>{
 const {dom,window,maps,errors}=await start({search:'?mode=electrification'});
 try{
  const map=maps[0];map.handlers['style.load']();map.zoom=18;
  const cases=[
   ['fuel',{fuel:'diesel','fuel:hydrogen':'yes'}, {'Type':'Train refuelling point','Recorded supplies':'diesel, hydrogen'}],
   ['fuel',{fuel:'yes','fuel:diesel':'yes'}, {'Recorded supplies':'diesel','Fuel tag':'yes'}],
   ['fuel',{fuel:'no','fuel:diesel':'yes','fuel:hydrogen':'no'}, {'Recorded supplies':'diesel','Fuel tag':'no','Fuel tags':'fuel:diesel=yes; fuel:hydrogen=no'}],
   ['fuel',{}, {'Type':'Train refuelling point','Recorded supplies':'Not recorded'}],
   ['fuel_tank',{content:'diesel'}, {'Type':'Railway fuel tank','Stored contents':'diesel'}],
   ['water_tank',{man_made:'storage_tank',content:'water',usage:'railway'}, {'Type':'Railway water tank','Stored contents':'water'}],
   ['water_tower',{'disused:man_made':'water_tower',usage:'railway'}, {'Type':'Railway water tower'}],
   ['plant',{'plant:source':'hydro','generator:source':'solar'}, {'Plant energy source':'hydro','Generator energy source':'solar'}],
   ['generator',{'generator:source':'wind'}, {'Generator energy source':'wind'}],
   ['coaling_facility',{}, {'Type':'Steam engine coaling'}],
  ];
  for(const [kind,tags,expected] of cases)await t.test(`${kind}: ${JSON.stringify(tags)}`,()=>{
   map.rendered=[{source:'electricFacilities',layer:{id:'electrification-supply-points'},properties:{...tags,power_kind:kind,power_state:'present',osm_type:'node',osm_id:'91'},geometry:{type:'Point',coordinates:[0,0]}}];
   map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
   const detail=window.document.getElementById('detail-content');
   const rows=Object.fromEntries([...detail.querySelectorAll('dt')].map(term=>[term.textContent,term.nextElementSibling.textContent]));
   for(const [key,value] of Object.entries(expected))assert.equal(rows[key],value,`${kind}: ${key}`);
   if(['plant','generator','fuel_tank'].includes(kind))assert.equal(rows['Recorded supplies'],undefined,'energy source or stored contents do not establish refuelling fuel');
   assert.doesNotMatch(detail.textContent,/Fuel(?:hydro|solar|wind)/);
   window.document.getElementById('details-close').click();
   assert.equal(window.document.getElementById('details').hidden,true);
  });
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('Power help explains the facility drawing and retains the implemented coverage limits',async()=>{
 const {dom,window}=await start();
 try{
  const help=window.document.getElementById('about').textContent;
  for(const words of ['drawn as they are mapped','outlines for areas, small dots for points','substations, power stations','coaling stages, water towers'])assert.ok(help.includes(words),words);
  assert.match(help,/whole electricity grid.*not yet/i);
  assert.match(help,/storage alone does not establish a train servicing point/i);
 }finally{dom.window.close();}
});

test('close infrastructure details follow the mode, labels and background on the initial frame and after switching',async()=>{
 const {dom,window,maps}=await start({search:'?mode=speed&names=0'});
 try{
  const map=maps[0],ids=['platform-areas','platform-outlines','platform-points','platform-edges','platform-numbers','platform-lengths','infrastructure-signal-points','infrastructure-signal-references','infrastructure-entrance-points','infrastructure-entrance-references'];
  for(const id of ids)assert.equal(map.options.style.layers.find(l=>l.id===id).layout.visibility,'none',id);
  map.handlers['style.load']();window.document.querySelector('[data-mode="infrastructure"]').click();
  for(const id of ids)assert.equal(map.visibility[id],'visible',id);
  window.document.getElementById('labels').click();
  for(const id of ['platform-numbers','platform-lengths','infrastructure-signal-references','infrastructure-entrance-references'])assert.equal(map.visibility[id],'none',id);
  for(const id of ['platform-edges','infrastructure-signal-points','infrastructure-entrance-points'])assert.equal(map.visibility[id],'visible',id);
  window.document.querySelector('[data-background="satellite"]').click();for(const id of ids)assert.equal(map.visibility[id],'none',id);
  window.document.querySelector('[data-background="hybrid"]').click();assert.equal(map.visibility['infrastructure-entrance-points'],'visible');
  window.document.querySelector('[data-mode="control"]').click();for(const id of ids)assert.equal(map.visibility[id],id==='infrastructure-signal-points'?'visible':'none',id);
  window.document.getElementById('labels').click();
  for(const id of ids)assert.equal(map.visibility[id],id.startsWith('infrastructure-signal-')?'visible':'none',id);
 }finally{dom.window.close();}
});

test('signals and entrances inspect their mapped node and avoid track/timetable fields',async()=>{
 const {dom,window,maps,errors}=await start();
 try{
  assert.deepEqual(errors,[]);const map=maps[0];map.handlers['style.load']();map.zoom=19;
  for(const feature of [
   {source:'railwaySignals',sourceLayer:'railway_signals',layer:{id:'infrastructure-signal-points'},properties:{id:123,railway:'signal',ref:'S12',category0:'main',category1:'distant',deactivated1:true,direction_both:true},geometry:{type:'Point',coordinates:[0,0]}},
   {source:'stationEntrances',sourceLayer:'standard_station_entrances',layer:{id:'infrastructure-entrance-points'},properties:{id:456,label:'Exit A8'},geometry:{type:'Point',coordinates:[0,0]}}
  ]){
   map.rendered=[feature];map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
   const detail=window.document.getElementById('detail-content');assert.match(detail.textContent,feature.source==='railwaySignals'?/Signal S12/:/Exit A8/);
   assert.equal(detail.querySelector(`a[href="https://www.openstreetmap.org/node/${feature.properties.id}"]`)?.textContent,'Open this node on OpenStreetMap ↗');
   assert.doesNotMatch(detail.textContent,/Speed label|Train protection|Departures|Track in shared roadway/);
   if(feature.source==='railwaySignals'){assert.match(detail.textContent,/main, distant/);assert.match(detail.textContent,/Inactive componentsdistant/);assert.match(detail.textContent,/Both directions/);}
  }
  assert.equal(errors.length,0);
 }finally{dom.window.close();}
});

test('Carto shows railway overlays, honours terrain, hides duplicate basemap labels and keeps compact attribution', async () => {
  const {dom,window,maps} = await start({search:'?background=carto'});
  try {
    const map=maps[0], layer=id=>map.options.style.layers.find(l=>l.id===id);
    assert.equal(layer('carto').layout.visibility,'visible');
    assert.equal(layer('satellite').layout.visibility,'none');
    assert.equal(layer('water').layout.visibility,'none');
    assert.ok(map.controls.some(c=>c.options?.compact===true),'Carto keeps the same compact info control');
    map.handlers['style.load']();
    assert.equal(map.visibility['infrastructure-tracks'],'visible');
    assert.equal(map.visibility['terrain-relief'],'visible');
    assert.equal(map.visibility['water'],'none');
    assert.equal(window.document.getElementById('legend').hidden,false);
    window.document.getElementById('relief').click();
    assert.equal(map.visibility['terrain-relief'],'none');
    window.document.querySelector('[data-background="map"]').click();
    assert.equal(map.visibility.carto,'none');
    assert.equal(map.visibility.water,'visible');
  } finally {dom.window.close();}
});

test('desktop brand announces collapse on its first activation',async()=>{
 const {dom,window}=await start();try{const icon=window.document.getElementById('controls-open');assert.equal(icon.getAttribute('aria-label'),'Collapse map controls');icon.click();assert.equal(window.document.getElementById('controls').hidden,true);assert.equal(icon.getAttribute('aria-label'),'Open map controls');}finally{dom.window.close();}
});
