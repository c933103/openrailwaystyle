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
await page.route('https://overview-fixture.invalid/**',route=>{
 const [source,z,x,rawY]=new URL(route.request().url()).pathname.slice(1).split('/'),y=Number(rawY.replace('.pbf',''));
 requests.push({source,z:+z,x:+x,y});const tiles={};
 for(const [key,index] of indexes)if(key.startsWith(source+'/')){const tile=index.getTile(+z,+x,y);if(tile?.features.length)tiles[key.slice(source.length+1)]=tile;}
 return route.fulfill({contentType:'application/x-protobuf',body:Object.keys(tiles).length?Buffer.from(vtpbf.fromGeojsonVt(tiles)):Buffer.alloc(0)});
});
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
 await page.evaluate(({sources,layers})=>fixtureMap.setStyle({version:8,glyphs:'https://glyph-fixture.invalid/{fontstack}/{range}.pbf',sources,
  layers:[{id:'background',type:'background',paint:{'background-color':'#ffffff'}},...layers]}),{sources,layers:overlapLayers});
 const overlapSamples=[];
 const pixels=()=>page.evaluate(()=>{
  const map=fixtureMap,canvas=map.getCanvas(),point=map.project([0,0]),ratio=canvas.width/map.getContainer().clientWidth;
  const scratch=document.createElement('canvas');scratch.width=canvas.width;scratch.height=canvas.height;
  const context=scratch.getContext('2d');context.drawImage(canvas,0,0);
  const rgba=[...context.getImageData(Math.round(point.x*ratio)-1,Math.round(point.y*ratio)-1,3,3).data];
  const orangePixels=rgba.flatMap((_,i)=>i%4===0&&rgba[i]>240&&rgba[i+1]>145&&rgba[i+1]<180&&rgba[i+2]<70&&rgba[i+3]===255?[i/4]:[]);
  return {rgba,orange:orangePixels.length,orangePixels,
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
  // solid interior with the crossing hidden, rather than assuming all nine
  // sampled pixels are inside the circle at every zoom.
  await page.evaluate(id=>fixtureMap.setLayoutProperty(id,'visibility','none'),layer);await rendered();
  const stationOnly=await pixels();
  assert.ok(stationOnly.orangePixels.includes(4),`station-only center must be solid orange at zoom ${zoom}: ${JSON.stringify(stationOnly)}`);
  const interiorVisible=sample=>stationOnly.orangePixels.filter(pixel=>sample.orangePixels.includes(pixel)).length;
  assert.equal(interiorVisible(positive),stationOnly.orange,`station interior must cover the crossing at zoom ${zoom}: ${JSON.stringify({positive,stationOnly})}`);
  await page.evaluate(id=>{fixtureMap.moveLayer(id);fixtureMap.setLayoutProperty(id,'visibility','visible');},layer);await rendered();
  const wrongOrder=await pixels();
  assert.ok(wrongOrder.overlapping.some(f=>f.id===layer), 'negative control retains the crossing');
  assert.ok(interiorVisible(wrongOrder)<stationOnly.orange,`reversed paint order must visibly cover the station interior at zoom ${zoom}: ${JSON.stringify({wrongOrder,stationOnly})}`);
  await page.evaluate(id=>fixtureMap.moveLayer(id,'station-stationLow-dots'),layer);await rendered();
  const restored=await pixels();assert.equal(interiorVisible(restored),stationOnly.orange,'restoring production order recovers the entire measured station interior');
  overlapSamples.push({zoom,layer,stationOnly,positive,wrongOrder,restored});
 }
 await page.screenshot({path:'browser-review/crossing-symbol-overlap-z16.png'});
 await writeFile('browser-review/crossing-symbol-overlap.json',JSON.stringify(overlapSamples,null,2)+'\n');

 assert.ok(requests.some(r=>r.metadata),'real backbone metadata URL was intercepted');
 assert.deepEqual(await page.evaluate(()=>fixtureErrors),[]);assert.deepEqual(errors,[]);
 await writeFile('browser-review/overview-markers.json',JSON.stringify({scope:'Synthetic cartography; no source completeness claim',samples,requests},null,2)+'\n');
 console.log('PASS: independent station markers at z3/4/5/6/7/6/7/8/9/10/12; MapLibre paints stations above both crossing-dot sources at z5–10; exact-identity deduplication and collision-managed names and backbone z4–6; symbol overlaps at z11–16 with pixel and reversed-order controls');
}finally{await browser.close();}
