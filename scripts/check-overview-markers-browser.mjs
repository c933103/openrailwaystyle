// Production station/backbone layers, real MapLibre and synthetic local tiles.
// This is cartographic integration evidence, not worldwide source completeness.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {launchBrowser} from './browser.mjs';
import {waitUntil} from './wait-until.mjs';
import {rendererFixture} from './browser-renderer-fixture.mjs';

const style=JSON.parse(await readFile('styles/world.style.json','utf8'));
const base='http://127.0.0.1:4173/',assets=await rendererFixture(base);
const library=[...assets.keys()].find(url=>url.endsWith('maplibre-gl-5.24.0-atlas.1.js'));
assert.ok(library);
const points=prefix=>({type:'FeatureCollection',features:Array.from({length:8},(_,i)=>i).map(i=>({type:'Feature',id:i+1,
 properties:{id:`node-${prefix}${i}`,name:'Collision test station',atlas_name:'Collision test station',tier:3,rank:i,
  feature:'station',station:'train',state:'present',station_size:'large'},geometry:{type:'Point',coordinates:[i*.0001,0]}}))});
const duplicate=structuredClone(style.sources.stationMajor.data.features.find(f=>f.properties.osm_ids.includes(';')));
assert.ok(duplicate);duplicate.geometry.coordinates=[-.02,0];duplicate.properties={...duplicate.properties,name:'Curated identity control',atlas_name:'Curated identity control',tier:3,rank:99};
const providerDuplicate={...structuredClone(duplicate),id:99,geometry:{type:'Point',coordinates:[.02,0]},properties:{...duplicate.properties,id:duplicate.properties.osm_ids.split(';')[1]+'-train-station'}};
// Place overlapping crossing dots at the first station's coordinates to
// check the actual renderer's paint order, not merely an array position.
const fixtureCrossings=new Set(['infrastructure-crossing-overview','infrastructure-crossing-dots','infrastructure-crossing-marks','infrastructure-level-crossings']);
const layers=style.layers.filter(l=>l.id.startsWith('station-')||l.id.startsWith('rail-backbone-')||fixtureCrossings.has(l.id)).map(l=>({...l,layout:{...l.layout,visibility:'visible'}}));
const sources={},indexes=new Map(),requests=[];
for(const layer of layers){
 if(layer.source==='stationMajor'){sources.stationMajor={type:'geojson',data:{type:'FeatureCollection',features:[...points('major').features,duplicate]}};continue;}
 if(!sources[layer.source])sources[layer.source]={type:'vector',tiles:[`https://overview-fixture.invalid/${layer.source}/{z}/{x}/{y}.pbf`],minzoom:0,maxzoom:12};
 const key=`${layer.source}/${layer['source-layer']}`;
 if(fixtureCrossings.has(layer.id)){
  indexes.set(key,geojsonvt({type:'FeatureCollection',features:[{type:'Feature',id:100,
   properties:{id:'overlap-crossing',kind:'road',minor:false,type:'level_crossing'},geometry:{type:'Point',coordinates:[0,0]}}]},{maxZoom:12,extent:4096,buffer:64}));continue;
 }
 if(!indexes.has(key))indexes.set(key,geojsonvt(layer.source==='railBackbone'?{type:'FeatureCollection',features:[{type:'Feature',
  properties:{id:key},geometry:{type:'LineString',coordinates:[[-2,1],[2,1]]}}]}:{type:'FeatureCollection',features:[...points(layer.source).features,providerDuplicate]},{maxZoom:12,extent:4096,buffer:64}));
}
// Exercise the real new TileJSON URL too. It must be fulfilled by a fixture,
// never whitelisted through the network guard.
sources.railBackbone={...style.sources.railBackbone};
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:800,height:600}}),errors=[],samples=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route(library,route=>route.fulfill(assets.get(library)));
await page.route(style.sources.railBackbone.url,route=>{requests.push({metadata:true,url:route.request().url()});return route.fulfill({json:{tilejson:'3.0.0',minzoom:0,maxzoom:7,tiles:['https://overview-fixture.invalid/railBackbone/{z}/{x}/{y}.pbf']}});});
const serveTiles=(route,fixtureIndexes=indexes)=>{
 const [source,z,x,rawY]=new URL(route.request().url()).pathname.slice(1).split('/'),y=Number(rawY.replace('.pbf',''));
 requests.push({source,z:+z,x:+x,y});const tiles={};
 for(const [key,index] of fixtureIndexes)if(key.startsWith(source+'/')){const tile=index.getTile(+z,+x,y);if(tile?.features.length)tiles[key.slice(source.length+1)]=tile;}
 return route.fulfill({contentType:'application/x-protobuf',body:Object.keys(tiles).length?Buffer.from(vtpbf.fromGeojsonVt(tiles)):Buffer.alloc(0)});
};
await page.route('https://overview-fixture.invalid/**',route=>serveTiles(route));
const glyphs=await readFile('tests/fixtures/browser-glyphs/0-255.pbf');
await page.route('https://glyph-fixture.invalid/**',route=>route.fulfill({contentType:'application/x-protobuf',body:glyphs}));
await mkdir('browser-review',{recursive:true});
try{
 await page.setContent('<div id="map" style="position:absolute;inset:0"></div>');await page.addScriptTag({url:library});
 await page.evaluate(({sources,layers})=>{
  const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,options){return original.call(this,kind,/^webgl2?$/.test(kind)?{...options,preserveDrawingBuffer:true}:options);};
  window.fixtureMap=new maplibregl.Map({container:'map',center:[0,0],zoom:3,fadeDuration:0,attributionControl:false,
   style:{version:8,glyphs:'https://glyph-fixture.invalid/{fontstack}/{range}.pbf',sources,layers:[{id:'background',type:'background',paint:{'background-color':'#ffffff'}},...layers]}});
  fixtureMap.on('styleimagemissing',event=>{
   if(event.id!=='crossing-x')return;
   // Synthetic SDF with the production crossing sprite's dimensions/shape.
   const size=32,half=8,stroke=2,data=new Uint8Array(size*size*4);
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const px=Math.abs(x+.5-size/2),py=Math.abs(y+.5-size/2);
    const t=Math.min(half,(px+py)/2),d=Math.hypot(px-t,py-t)-stroke;
    data[(y*size+x)*4+3]=Math.max(0,Math.min(255,Math.round(191-d*32)));
   }
   fixtureMap.addImage(event.id,{width:size,height:size,data},{pixelRatio:2,sdf:true});
  });
  window.fixtureErrors=[];fixtureMap.on('error',event=>fixtureErrors.push(event.error?.message));
 },{sources,layers});
 for(const zoom of [3,4,5,6,7,6,7,8,9,10,12]){
  await page.evaluate(zoom=>fixtureMap.jumpTo({center:[0,0],zoom}),zoom);
  const expected=zoom<4?['stationMajor']:zoom<6?['stationMajor','stationLow']:zoom<7?['stationMajor','stationMed']:zoom<8?['stationMed']:['stations'];
  const expectedCounts=Object.fromEntries(expected.map(source=>[source,8+(source==='stationMajor'||zoom>=7?1:0)]));
  await page.waitForFunction(counts=>Object.entries(counts).every(([source,count])=>new Set(fixtureMap.queryRenderedFeatures().filter(f=>f.source===source&&f.layer.type==='circle').map(f=>f.properties.id)).size===count),expectedCounts,{timeout:30000});
  await page.waitForFunction(()=>fixtureMap.loaded(),null,{timeout:30000});
  const sample=await page.evaluate(()=>{
   const features=fixtureMap.queryRenderedFeatures();return {zoom:fixtureMap.getZoom(),
    markers:Object.fromEntries([...new Set(features.filter(f=>f.layer.type==='circle'&&f.layer.id.startsWith('station-')).map(f=>f.source))].map(source=>[source,[...new Set(features.filter(f=>f.source===source&&f.layer.type==='circle'&&f.layer.id.startsWith('station-')).map(f=>f.properties.id))]])),
    overlapping:fixtureMap.queryRenderedFeatures(fixtureMap.project([0,0])).filter(f=>f.layer.type==='circle'&&(f.layer.id.startsWith('station-')||f.layer.id.startsWith('infrastructure-crossing-'))).map(f=>f.layer.id),
    names:[...new Set(features.filter(f=>f.layer.type==='symbol'&&f.layer.id.startsWith('station-')).map(f=>f.properties.id))],
    backbone:[...new Set(features.filter(f=>f.source==='railBackbone').map(f=>f.sourceLayer))]};
  });
  assert.deepEqual(Object.keys(sample.markers).sort(),expected.sort());
  for(const source of expected){assert.equal(sample.markers[source].length,expectedCounts[source]);if(source!=='stationMajor')assert.equal(sample.markers[source].includes(providerDuplicate.properties.id),zoom>=7,'curated/provider identity handoff in both zoom directions');}
  assert.ok(sample.names.length>0,'positive label control must render before testing collision suppression');
  assert.ok(sample.names.length<expected.length*8,'collisions suppress names while every fixture point stays rendered: '+JSON.stringify(sample));
  assert.equal(sample.backbone.length,zoom>=4&&zoom<7?2:0,'backbone follows its z4–6 window');
  if(zoom>=5&&zoom<11){
   const marker=sample.overlapping.findIndex(id=>id.startsWith('station-'));
   const crossing=sample.overlapping.findIndex(id=>id.startsWith('infrastructure-crossing-'));
   const crossingLayer=zoom<9?'infrastructure-crossing-overview':'infrastructure-crossing-dots';
   assert.ok(marker>=0&&crossing>=0,'both station and crossing must render at the shared coordinates');
   assert.ok(sample.overlapping.includes(crossingLayer),`${crossingLayer} must render at zoom ${zoom}`);
   assert.ok(marker<crossing,'MapLibre must draw the overlapping station dot above the crossing dot');
  }
  samples.push(sample);
 }
 await page.screenshot({path:'browser-review/overview-markers-z12.png'});

 // Symbols have a separate placement path. Isolate the overlap from station
 // names, while retaining the production circle/icon/text layers and MVT data.
 // Exercise both symbol sources, their handoff, and the previous wrong order.
 const overlapLayers=layers.filter(l=>fixtureCrossings.has(l.id)||(l.id.startsWith('station-')&&l.type==='circle'));
 // The earlier density fixture deliberately has eight near-coincident stations.
 // At detail zoom their neighboring strokes can cover the first station's
 // center. Use one co-located station/crossing here, with a separate URL origin
 // to prevent MapLibre reusing dense-station tiles from the previous style.
 const overlapIndexes=new Map([...indexes].map(([key,index])=>[key,key.startsWith('station')
  ?geojsonvt({type:'FeatureCollection',features:points('overlap').features.slice(0,1)},{maxZoom:12,extent:4096,buffer:64}):index]));
 const overlapSources=structuredClone(sources);
 for(const source of Object.values(overlapSources))if(source.tiles)source.tiles=source.tiles.map(url=>url.replace('overview-fixture.invalid','symbol-overlap-fixture.invalid'));
 overlapSources.stationMajor.data={type:'FeatureCollection',features:points('overlap').features.slice(0,1)};
 await page.route('https://symbol-overlap-fixture.invalid/**',route=>serveTiles(route,overlapIndexes));
 await page.evaluate(({sources,layers})=>fixtureMap.setStyle({version:8,glyphs:'https://glyph-fixture.invalid/{fontstack}/{range}.pbf',sources,
  layers:[{id:'background',type:'background',paint:{'background-color':'#ffffff'}},...layers]}),{sources:overlapSources,layers:overlapLayers});
 const overlapSamples=[];
 const pixels=()=>page.evaluate(()=>{
  const map=fixtureMap,canvas=map.getCanvas(),point=map.project([0,0]),ratio=canvas.width/map.getContainer().clientWidth;
  const scratch=document.createElement('canvas');scratch.width=canvas.width;scratch.height=canvas.height;
  const context=scratch.getContext('2d');context.drawImage(canvas,0,0);
  const radius=Math.ceil(8*ratio),size=radius*2+1,cx=Math.round(point.x*ratio),cy=Math.round(point.y*ratio);
  const rgba=[...context.getImageData(cx-radius,cy-radius,size,size).data];
  const orangePixels=rgba.flatMap((_,i)=>i%4===0&&rgba[i]>240&&rgba[i+1]>145&&rgba[i+1]<180&&rgba[i+2]<70&&rgba[i+3]===255?[i/4]:[]);
  const crossingInkPixels=rgba.flatMap((_,i)=>i%4===0&&rgba[i]<170&&rgba[i+1]<130&&rgba[i+2]<120&&rgba[i+3]===255?[i/4]:[]);
  // Record a wider ink bounding box for diagnosis without accepting ink
  // outside the measured station interior as an overlap.
  const wideRadius=Math.ceil(32*ratio),wideSize=wideRadius*2+1;
  const wide=context.getImageData(cx-wideRadius,cy-wideRadius,wideSize,wideSize).data;
  const inkBounds={left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity,pixels:0};
  for(let y=0;y<wideSize;y++)for(let x=0;x<wideSize;x++){
   const i=(y*wideSize+x)*4;
   if(wide[i]<170&&wide[i+1]<130&&wide[i+2]<120&&wide[i+3]===255){
    inkBounds.left=Math.min(inkBounds.left,(x-wideRadius)/ratio);
    inkBounds.right=Math.max(inkBounds.right,(x-wideRadius)/ratio);
    inkBounds.top=Math.min(inkBounds.top,(y-wideRadius)/ratio);
    inkBounds.bottom=Math.max(inkBounds.bottom,(y-wideRadius)/ratio);inkBounds.pixels++;
   }
  }
  return {rgba,patch:{radius,size,ratio,centerPixel:radius*size+radius},wideInk:inkBounds.pixels?inkBounds:null,orange:orangePixels.length,orangePixels,crossingInkPixels,
   overlapping:map.queryRenderedFeatures(point).filter(f=>f.layer.id.startsWith('station-')||f.layer.id.startsWith('infrastructure-crossing-')||f.layer.id==='infrastructure-level-crossings').map(f=>({id:f.layer.id,type:f.layer.type}))};
 });
 const rendered=()=>waitUntil(page,async()=>{await new Promise(resolve=>{fixtureMap.once('idle',resolve);fixtureMap.triggerRepaint();});return fixtureMap.loaded()&&fixtureMap.areTilesLoaded();});
 for(const zoom of [11,12,13,14,15,16]){
  await page.evaluate(zoom=>fixtureMap.jumpTo({center:[0,0],zoom}),zoom);await rendered();
  const layer=zoom<15?'infrastructure-crossing-marks':'infrastructure-level-crossings';
  const positive=await pixels();
  assert.ok(positive.overlapping.some(f=>f.id===layer&&f.type==='symbol'),`real crossing symbol must render at zoom ${zoom}`);
  assert.ok(positive.overlapping.some(f=>f.id.startsWith('station-')&&f.type==='circle'),`station circle must render at zoom ${zoom}`);
  // Small production circles have antialiased/stroked edges. Measure their
  // solid interior with the crossing hidden, rather than assuming every
  // sampled pixel is inside the circle at every zoom. The 17 CSS px patch spans
  // the production station footprint; a text glyph need not ink its anchor.
  await page.evaluate(id=>fixtureMap.setLayoutProperty(id,'visibility','none'),layer);await rendered();
  const stationOnly=await pixels();
  assert.ok(stationOnly.orangePixels.includes(stationOnly.patch.centerPixel),`station-only center must be solid orange at zoom ${zoom}: ${JSON.stringify(stationOnly)}`);
  const interiorVisible=sample=>stationOnly.orangePixels.filter(pixel=>sample.orangePixels.includes(pixel)).length;
  assert.equal(interiorVisible(positive),stationOnly.orange,`station interior must cover the crossing at zoom ${zoom}: ${JSON.stringify({positive,stationOnly})}`);
  const stationIds=overlapLayers.filter(l=>l.id.startsWith('station-')).map(l=>l.id);
  await page.evaluate(({layer,stationIds})=>{for(const id of stationIds)fixtureMap.setLayoutProperty(id,'visibility','none');fixtureMap.setLayoutProperty(layer,'visibility','visible');},{layer,stationIds});await rendered();
  const crossingOnly=await pixels();
  const inkOverlap=stationOnly.orangePixels.filter(pixel=>crossingOnly.crossingInkPixels.includes(pixel));
  const diagnostic={zoom,layer,stationOnly,positive,crossingOnly,inkOverlap};
  await writeFile('browser-review/crossing-symbol-overlap.json',JSON.stringify([...overlapSamples,diagnostic],null,2)+'\n');
  assert.ok(inkOverlap.length>0,`crossing-only ink must visibly intersect the measured station interior at zoom ${zoom}: ${JSON.stringify({inkOverlap,crossingOnly,stationOnly})}`);
  await page.evaluate(({layer,stationIds})=>{for(const id of stationIds)fixtureMap.setLayoutProperty(id,'visibility','visible');fixtureMap.moveLayer(layer);},{layer,stationIds});await rendered();
  const wrongOrder=await pixels();
  diagnostic.wrongOrder=wrongOrder;
  await writeFile('browser-review/crossing-symbol-overlap.json',JSON.stringify([...overlapSamples,diagnostic],null,2)+'\n');
  assert.ok(wrongOrder.overlapping.some(f=>f.id===layer), 'negative control retains the crossing');
  assert.ok(inkOverlap.some(pixel=>!wrongOrder.orangePixels.includes(pixel)),`reversed paint order must visibly cover the measured crossing/station ink intersection at zoom ${zoom}: ${JSON.stringify({wrongOrder,stationOnly})}`);
  await page.evaluate(id=>fixtureMap.moveLayer(id,'station-stationLow-dots'),layer);await rendered();
  const restored=await pixels();assert.equal(interiorVisible(restored),stationOnly.orange,'restoring production order recovers the entire measured station interior');
  overlapSamples.push({...diagnostic,restored});
 }
 await page.screenshot({path:'browser-review/crossing-symbol-overlap-z16.png'});
 await writeFile('browser-review/crossing-symbol-overlap.json',JSON.stringify(overlapSamples,null,2)+'\n');


 // The high-zoom crossing is collision-managed. Keep the production place
 // label priority as well as the circle paint order tested above.
 const collisionSamples=[];
 for(const [zoom,kind,placeId] of [[15,'city','place_label_city'],[15,'village','place_label_other'],[16,'village','place_label_other']]){
  const crossingId='infrastructure-level-crossings',placementId=placeId+'-placement';
  const collisionLayers=style.layers.filter(l=>l.id===placeId||l.id===placementId||l.id===crossingId).map(l=>{
   const layer={...l,layout:{...l.layout,visibility:'visible'}};
   if(layer.id===placeId||layer.id===placementId)delete layer['source-layer'];return layer;
  });
  const collisionSources={crossings:sources.crossings,openmaptiles:{type:'geojson',data:{type:'FeatureCollection',features:[{
   type:'Feature',properties:{class:kind,'name:latin':'Collision','name:nonlatin':''},geometry:{type:'Point',coordinates:[0,0]}
  }]}}};
  await page.evaluate(({zoom,sources,layers})=>{
   fixtureMap.setStyle({version:8,glyphs:'https://glyph-fixture.invalid/{fontstack}/{range}.pbf',sources,layers});
   fixtureMap.jumpTo({center:[0,0],zoom});
  },{zoom,sources:collisionSources,layers:collisionLayers});await rendered();
  const placement=()=>page.evaluate(({placeId,crossingId})=>({
   place:fixtureMap.queryRenderedFeatures({layers:[placeId]}).length,
   crossing:fixtureMap.queryRenderedFeatures({layers:[crossingId]}).length
  }),{placeId,crossingId});
  const positive=await placement();
  assert.ok(positive.crossing>0&&positive.place===0,`crossing keeps production collision priority at ${zoom}/${kind}: ${JSON.stringify(positive)}`);
  await page.evaluate(id=>fixtureMap.setLayoutProperty(id,'visibility','none'),crossingId);await rendered();
  const placeOnly=await placement();assert.ok(placeOnly.place>0,'place label must render when the crossing is absent');
  await page.evaluate(({placementId,crossingId})=>{fixtureMap.moveLayer(placementId);fixtureMap.setLayoutProperty(crossingId,'visibility','visible');},{placementId,crossingId});await rendered();
  const wrongOrder=await placement();
  assert.ok(wrongOrder.place>0&&wrongOrder.crossing===0,'reversed symbol priority must suppress the crossing');
  await page.evaluate(({placementId,crossingId})=>fixtureMap.moveLayer(placementId,crossingId),{placementId,crossingId});await rendered();
  const restored=await placement();assert.ok(restored.crossing>0&&restored.place===0,'restoring priority recovers the crossing');
  collisionSamples.push({zoom,kind,positive,placeOnly,wrongOrder,restored});
 }
 await writeFile('browser-review/crossing-place-collisions.json',JSON.stringify(collisionSamples,null,2)+'\n');
 // Place labels keep their visible ink above station circles while their
 // opacity-zero placement twins retain the earlier collision priority.
 // Keep the production order, layout, paint, filters and zoom windows; only
 // substitute local GeoJSON sources for this isolated paint-order fixture.
 const stationPlaceSamples=[];
 for(const [zoom,kind,placeId,circleId] of [
  [15,'city','place_label_city','station-stations-dots'],
  [15,'village','place_label_other','station-stations-dots'],
  [8,'state','state_label','station-provider-dots'],
 ]){
  const placementId=placeId+'-placement',selectedIds=new Set([placementId,circleId,placeId]);
  const stationPlaceLayers=style.layers.filter(layer=>selectedIds.has(layer.id)).map(original=>{
   const layer=structuredClone(original);
   layer.source=layer.id===circleId?'station-place-point':'station-place-labels';
   delete layer['source-layer'];
   layer.layout={...layer.layout,visibility:'visible'};
   return layer;
  });
  assert.deepEqual(stationPlaceLayers.map(layer=>layer.id),[placementId,circleId,placeId],
   'the generated production order must separate place placement from visible ink');
  const twin=stationPlaceLayers[0],visible=stationPlaceLayers[2];
  assert.deepEqual(twin.layout,visible.layout,'placement and visible layers must share production layout');
  assert.deepEqual(twin.filter,visible.filter,'placement and visible layers must share production filtering');
  assert.equal(twin.paint['text-opacity'],0,'placement twin must not contribute visible ink');
  const stationPlaceSources={
   'station-place-labels':{type:'geojson',data:{type:'FeatureCollection',features:[{
    type:'Feature',id:1,properties:{class:kind,'name:latin':'HH','name:nonlatin':''},
    geometry:{type:'Point',coordinates:[0,0]},
   }]}},
   'station-place-point':{type:'geojson',data:{type:'FeatureCollection',features:[]}},
  };
  await page.evaluate(({zoom,sources,layers})=>{
   fixtureMap.setStyle({version:8,glyphs:'https://glyph-fixture.invalid/{fontstack}/{range}.pbf',sources,
    layers:[{id:'background',type:'background',paint:{'background-color':'#ffffff'}},...layers]});
   fixtureMap.jumpTo({center:[0,0],zoom});
  },{zoom,sources:stationPlaceSources,layers:stationPlaceLayers});await rendered();

  // Locate actual fixture glyph ink, rather than assuming the label anchor
  // or all nine center pixels intersect the glyph or a small station circle.
  const ink=await page.evaluate(placeId=>{
   const map=fixtureMap,canvas=map.getCanvas(),container=map.getContainer(),center=map.project([0,0]);
   const ratioX=canvas.width/container.clientWidth,ratioY=canvas.height/container.clientHeight;
   const radiusX=Math.ceil(15*ratioX),radiusY=Math.ceil(15*ratioY);
   const width=radiusX*2+1,height=radiusY*2+1;
   const left=Math.round(center.x*ratioX)-radiusX,top=Math.round(center.y*ratioY)-radiusY;
   const scratch=document.createElement('canvas');scratch.width=canvas.width;scratch.height=canvas.height;
   const context=scratch.getContext('2d');context.drawImage(canvas,0,0);
   const rgba=context.getImageData(left,top,width,height).data,candidates=[];
   for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4,pixel=[...rgba.slice(i,i+4)];
    if(pixel[3]===255&&pixel[0]<190&&pixel[1]<190&&pixel[2]<190)
     candidates.push({x:left+x,y:top+y,rgba:pixel,ink:pixel[0]+pixel[1]+pixel[2],distance:((x-radiusX)/ratioX)**2+((y-radiusY)/ratioY)**2});
   }
   candidates.sort((a,b)=>a.ink-b.ink||a.distance-b.distance);
   const chosen=candidates[0];
   if(!chosen)return {candidates:0,place:map.queryRenderedFeatures({layers:[placeId]}).length};
   const css=[(chosen.x+.5)/ratioX,(chosen.y+.5)/ratioY];
   return {candidates:candidates.length,patch:{left,top,width,height,ratioX,ratioY},pixel:[chosen.x,chosen.y],
    rgba:chosen.rgba,css,coordinates:map.unproject(css).toArray(),
    place:map.queryRenderedFeatures({layers:[placeId]}).length};
  },placeId);
  assert.ok(ink.place>0&&ink.candidates>0,
   `label-only control must contain measured dark glyph ink at ${zoom}/${kind}: ${JSON.stringify(ink)}`);

  const station=structuredClone(points('place-paint').features[0]);station.geometry.coordinates=ink.coordinates;
  await page.evaluate(station=>fixtureMap.getSource('station-place-point').setData({type:'FeatureCollection',features:[station]}),station);
  await rendered();
  const atInk=()=>page.evaluate(({pixel,css,placeId,circleId})=>{
   const map=fixtureMap,canvas=map.getCanvas(),scratch=document.createElement('canvas');
   scratch.width=canvas.width;scratch.height=canvas.height;
   const context=scratch.getContext('2d');context.drawImage(canvas,0,0);
   return {rgba:[...context.getImageData(pixel[0],pixel[1],1,1).data],
    place:map.queryRenderedFeatures({layers:[placeId]}).length,
    station:new Set(map.queryRenderedFeatures(css,{layers:[circleId]}).map(feature=>feature.properties.id)).size,
    loaded:map.loaded(),tilesLoaded:map.areTilesLoaded()};
  },{pixel:ink.pixel,css:ink.css,placeId,circleId});
  const darkGlyph=sample=>sample.rgba[3]===255&&sample.rgba[0]<200&&sample.rgba[1]<200&&sample.rgba[2]<200;
  const solidOrange=sample=>sample.rgba[0]>240&&sample.rgba[1]>145&&sample.rgba[1]<180&&sample.rgba[2]<70&&sample.rgba[3]===255;
  const assertLayers=(sample,label)=>{
   assert.ok(sample.loaded&&sample.tilesLoaded&&sample.place>0&&sample.station===1,
    `${label} must retain both production layers at ${zoom}/${kind}: ${JSON.stringify(sample)}`);
  };
  const positive=await atInk();assertLayers(positive,'positive');
  assert.ok(darkGlyph(positive),`visible place glyph must remain above the station at ${zoom}/${kind}: ${JSON.stringify({ink,positive})}`);

  // Move only the visible original. The twin, sources, glyphs, feature,
  // layout, opacity, filters and selected physical pixel remain unchanged.
  await page.evaluate(({placeId,circleId})=>fixtureMap.moveLayer(placeId,circleId),{placeId,circleId});await rendered();
  const wrongOrder=await atInk();assertLayers(wrongOrder,'negative control');
  assert.ok(solidOrange(wrongOrder),
   `reversed visible paint order must cover the same measured glyph pixel with solid station orange at ${zoom}/${kind}: ${JSON.stringify({ink,positive,wrongOrder})}`);
  await page.evaluate(placeId=>fixtureMap.moveLayer(placeId),placeId);await rendered();
  const restored=await atInk();assertLayers(restored,'restored');
  assert.ok(darkGlyph(restored),`restoring the visible place layer must recover glyph ink at ${zoom}/${kind}: ${JSON.stringify(restored)}`);
  stationPlaceSamples.push({zoom,kind,placeId,placementId,circleId,ink,positive,wrongOrder,restored});
 }
 await writeFile('browser-review/station-place-paint-order.json',JSON.stringify(stationPlaceSamples,null,2)+'\n');

 assert.ok(requests.some(r=>r.metadata),'real backbone metadata URL was intercepted');
 assert.deepEqual(await page.evaluate(()=>fixtureErrors),[]);assert.deepEqual(errors,[]);
 await writeFile('browser-review/overview-markers.json',JSON.stringify({scope:'Synthetic cartography; no source completeness claim',samples,requests},null,2)+'\n');
 console.log('PASS: independent station markers at z3/4/5/6/7/6/7/8/9/10/12; MapLibre paints stations above both crossing-dot sources at z5–10; exact-identity deduplication and collision-managed names and backbone z4–6; symbol overlaps at z11–16 with pixel and reversed-order controls; crossing/place collision priority at z15 city and z15–16 village; city/village/state glyph ink above station circles with reversed and restored paint controls');
}finally{await browser.close();}
