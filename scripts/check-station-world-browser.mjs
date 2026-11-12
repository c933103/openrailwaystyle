// Real MapLibre exercise of a *complete* OSM station snapshot. Every remote
// response is synthetic and explicitly routed; no OSM/ORM or public tile calls.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {encodeBundle} from '../styles/tile-bundles.mjs';
import {launchBrowser} from './browser.mjs';
import {rendererFixture,installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {serveAtlasAppFixture} from './atlas-app-browser-fixture.mjs';
import {MODES,stationMarkerDiameter} from '../styles/map-model.mjs';
import {serviceFrequencyPaint} from '../styles/service-frequency.mjs';

const server=await serveAtlasAppFixture(),base=server.origin+'/',assets=await rendererFixture(base);
const renderer=[...assets.keys()].find(url=>url.endsWith('maplibre-gl-5.24.0-atlas.2.js'));
assert.ok(renderer);
const center=[15,15],points=Array.from({length:8},(_,i)=>({
 type:'Feature',id:i+1,properties:{id:`node-${i+1}`,osm_id:String(i+1),osm_type:'node',
 name:'Repeated name',feature:'station',station:'train',state:'present'},
 geometry:{type:'Point',coordinates:[15+i*.00002,15]},
}));
const grid=geojsonvt({type:'FeatureCollection',features:points},
 {maxZoom:7,indexMaxZoom:3,indexMaxPoints:0,extent:4096,buffer:64,tolerance:0});
const parent=[];
for(let z=3;z<=7;z++){
 const n=2**z,x=Math.floor((15+180)/360*n),lat=15*Math.PI/180;
 const y=Math.floor((1-Math.asinh(Math.tan(lat))/Math.PI)/2*n);
 const tile=grid.getTile(z,x,y);
 assert.equal(tile?.features.length,8,`z${z} synthetic source must carry every mapped station`);
 parent.push([`${z}/${x}/${y}`,vtpbf.fromGeojsonVt({atlas_station_points:tile},{version:2,extent:4096})]);
}
const payload=gzipSync(encodeBundle(new Map(parent)));
const root=new URL('./data/station-points/',base);
const manifest={complete:true,schema:1,license:'ODbL-1.0',minzoom:3,maxzoom:7,stations:8,
 tiles:parent.length,bundles:1,polar:0,pendingRegions:0,completedRegions:32};
const index={zoom:3,bundles:['4/3']}; // At latitude 15°N the z3 tile is 4/3.
const browser=await launchBrowser({engine:process.env.ATLAS_TEST_ENGINE==='webkit'?'webkit':'chromium'}),page=await browser.newPage({viewport:{width:860,height:620}}),
 calls=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
try {
await installEmptyMapProviders(page.context(),base);
// WebKit routes MapLibre's Blob workers through Playwright. Replay only the
// recorded real renderer bytes; the transport guard still denies remote egress.
await page.addInitScript(()=>{
 window.stationFixtureBlobs=new Map();const create=URL.createObjectURL.bind(URL);
 URL.createObjectURL=blob=>{const url=create(blob);stationFixtureBlobs.set(url,blob);return url;};
});
await page.context().route(`blob:${server.origin}/**`,async route=>{
 const body=await page.evaluate(async url=>stationFixtureBlobs.get(url)?.text()??null,route.request().url());
 assert.notEqual(body,null,'only actual recorded renderer Blob workers can be replayed');
 await route.fulfill({body,contentType:'text/javascript'});
});
await page.route(new URL('station-world-browser-fixture.html',base).href,route=>
 route.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body><div id="map" style="position:fixed;inset:0"></div></body></html>'}));
await page.route(renderer,route=>route.fulfill(assets.get(renderer)));
const glyphs=await readFile('tests/fixtures/browser-glyphs/0-255.pbf');
await page.route('https://glyph-fixture.invalid/**',route=>route.fulfill({
 contentType:'application/x-protobuf',body:glyphs}));
await page.route(new URL('manifest.json',root).href,route=>{
 calls.push('manifest');return route.fulfill({json:manifest})});
await page.route(new URL('index.json',root).href,route=>{
 calls.push('index');return route.fulfill({json:index})});
await page.route(new URL('3/4/3.bundle.gz',root).href,route=>{
 calls.push('bundle');return route.fulfill({contentType:'application/octet-stream',body:payload})});
await page.goto(new URL('station-world-browser-fixture.html',base).href);
await page.addScriptTag({url:renderer});
// Headless Linux WebKit may lack a working WebGL 2 context although Safari
// on iOS/macOS supports it. Verify the actual browser capability instead of
// mistaking missing graphics for a station data regression or marking a fake
// full-render pass.
if(process.env.ATLAS_TEST_ENGINE==='webkit'){
 const caps=await page.evaluate(()=>({
   webgl2:Boolean(document.createElement('canvas').getContext('webgl2')),
   gzip:typeof DecompressionStream==='function',
 }));
 assert.equal(caps.gzip,true,'WebKit must support gzip station bundles');
 if(!caps.webgl2){
   const bytes=await page.evaluate(async root=>{
     const resp=await fetch(new URL('3/4/3.bundle.gz',root));
     if(!resp.ok)throw new Error('WebKit station bundle unavailable');
     const buffer=await new Response(resp.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
     const data=new Uint8Array(buffer);
     return {length:data.length,magic:Array.from(data.slice(0,4))};
   },root.href);
   assert.ok(bytes.length>32&&bytes.magic.join(',')==='65,84,66,49',
     'WebKit decoded the real compressed Atlas bundle');
   console.log('WEBKIT_BUNDLE_PASS: native gzip and ATB1 decode; real renderer SKIPPED (headless Linux WebGL2 unavailable)');
   await browser.close();await server.close();process.exit(0);
 }
}
await page.evaluate(({center,serviceWidth})=>{
  window.fixtureMap=new maplibregl.Map({
    container:'map',center,zoom:3,attributionControl:false,fadeDuration:0,preserveDrawingBuffer:true,
    style:{version:8,glyphs:'https://glyph-fixture.invalid/{fontstack}/{range}.pbf',
      sources:{
        crossings:{type:'geojson',data:{type:'FeatureCollection',features:[
          {type:'Feature',properties:{id:'crossing'},geometry:{type:'Point',coordinates:center}}]}},
        places:{type:'geojson',data:{type:'FeatureCollection',features:[
          {type:'Feature',properties:{name:'Repeated name'},geometry:{type:'Point',coordinates:center}}]}},
        service:{type:'geojson',data:{type:'FeatureCollection',features:[
          {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[14.99,15],[15.01,15]]}}]}},
      },layers:[
        {id:'background',type:'background',paint:{'background-color':'#ffffff'}},
        {id:'infrastructure-crossing-overview',type:'circle',source:'crossings',
          minzoom:5,paint:{'circle-radius':2.4,'circle-color':'#70412e'}},
        {id:'service-routes',type:'line',source:'service',layout:{visibility:'none'},
          paint:{'line-color':'#d62c2c','line-width':serviceWidth}},
        {id:'place_label_city',type:'symbol',source:'places',
          layout:{'text-field':['get','name'],'text-font':['Noto Sans Regular'],'text-size':14,
          'text-allow-overlap':false}},
      ]},
  });
  fixtureMap.on('error',e=>{(window.errors||=[]).push(e.error?.message||'unknown')});
},{center,serviceWidth:serviceFrequencyPaint().width});
try {await page.waitForFunction(()=>fixtureMap.isStyleLoaded(),null,{timeout:30000});}
catch(error){console.error('STATION_STYLE_FAILURE',await page.evaluate(()=>({errors:window.errors,styleLoaded:fixtureMap.isStyleLoaded()})),errors);throw error;}
const installed=await page.evaluate(async root=>{
 const mod=await import('/station-world.mjs?v=20261019-station-world-1');
 const overlay=await mod.prepareWorldStationOverlay({root:new URL(root)});
 if(!overlay)return false;
 overlay.register(maplibregl);
 overlay.install(window.fixtureMap);
 fixtureMap.setLayoutProperty(mod.WORLD_STATION_DOTS,'visibility','visible');
 return true;
},root.href);
assert.equal(installed,true);
const results=[];
for(const zoom of [3,4,5,6,7,8,10,11,12]){
 await page.evaluate(zoom=>fixtureMap.jumpTo({center:[15,15],zoom}),zoom);
 await page.waitForFunction(zoom=>{
   if(!fixtureMap.loaded())return false;
   const station=fixtureMap.queryRenderedFeatures({layers:['station-world-dots']});
   return zoom<12?new Set(station.map(f=>f.properties.id)).size===8:station.length===0;
 },zoom,{timeout:45000});
 const sample=await page.evaluate(()=>{
   const station=fixtureMap.queryRenderedFeatures({layers:['station-world-dots']});
   const crossing=fixtureMap.queryRenderedFeatures({layers:['infrastructure-crossing-overview']});
   const at=fixtureMap.queryRenderedFeatures(fixtureMap.project([15,15])).map(f=>f.layer.id);
   return {zoom:fixtureMap.getZoom(),markerCount:new Set(station.map(f=>f.properties.id)).size,
    crossingCount:crossing.length,topLayers:at,sourceLoaded:fixtureMap.isSourceLoaded('stationWorld')};
 });
 assert.equal(sample.markerCount,zoom<12?8:0,`world station visibility across z${zoom}`);
 if(zoom>=5&&zoom<12){
   const dot=sample.topLayers.indexOf('station-world-dots'),cross=sample.topLayers.indexOf('infrastructure-crossing-overview');
   assert.ok(dot>=0&&cross>=0&&dot<cross,`station ink above crossing at z${zoom}`);
 }
 results.push(sample);
}
assert.deepEqual(await page.evaluate(()=>window.errors||[]),[],'renderer must not report source/worker errors');
assert.equal(errors.length,0,errors.join('\n'));
assert.ok(calls.includes('manifest')&&calls.includes('index')&&calls.includes('bundle'));
await mkdir('browser-review',{recursive:true});
await writeFile('browser-review/station-world-overlay.json',JSON.stringify({scope:'synthetic only',calls,results},null,2)+'\n');
await page.screenshot({path:'browser-review/station-world-z12.png'});
console.log('PASS: all 8 synthetic station nodes independent of text and crossing ink at z3–11; preserved detail handoff at z12');

// At the reporting user's regional Service zoom, compare actual route pixels
// with and without the complete, deliberately overlapping station inventory.
await page.evaluate(async()=>{
 const {createStationViewPaint}=await import('/station-world.mjs');
 const map=fixtureMap,paint=createStationViewPaint()(map.getLayer('station-world-dots'),'service',7.8);
 for(const [key,value] of Object.entries(paint))map.setPaintProperty('station-world-dots',key,value);
 map.setLayoutProperty('service-routes','visibility','visible');
 map.setLayoutProperty('place_label_city','visibility','none');
 map.setLayoutProperty('station-world-dots','visibility','none');
 map.jumpTo({center:[15,15],zoom:7.8});
});
const servicePixels=()=>page.evaluate(async()=>{
 const map=fixtureMap;
 await new Promise(resolve=>{map.once('idle',resolve);map.triggerRepaint();});
 const canvas=map.getCanvas(),ratio=canvas.width/map.getContainer().clientWidth;
 const point=map.project([15,15]),radius=Math.ceil(6*ratio),size=radius*2+1;
 const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;
 const context=copy.getContext('2d');context.drawImage(canvas,0,0);
 const rgba=[...context.getImageData(Math.round(point.x*ratio)-radius,Math.round(point.y*ratio)-radius,size,size).data];
 return {rgba,stations:new Set(map.queryRenderedFeatures({layers:['station-world-dots']}).map(f=>f.properties.id)).size};
});
const lineOnly=await servicePixels();
const red=[];
for(let i=0;i<lineOnly.rgba.length;i+=4)
 if(lineOnly.rgba[i]===214&&lineOnly.rgba[i+1]===44&&lineOnly.rgba[i+2]===44&&lineOnly.rgba[i+3]===255)red.push(i);
assert.ok(red.length>0,'the synthetic Service route must have solid coloured pixels');
await page.evaluate(()=>fixtureMap.setLayoutProperty('station-world-dots','visibility','visible'));
const servicePositive=await servicePixels();
assert.equal(servicePositive.stations,8,'Service view keeps every station identity');
assert.ok(red.every(i=>lineOnly.rgba.slice(i,i+4).every((v,n)=>servicePositive.rgba[i+n]===v)),
 'all solid route pixels survive the station inventory byte-for-byte');
await page.evaluate(()=>fixtureMap.moveLayer('station-world-dots','place_label_city'));
const wrongServiceOrder=await servicePixels();
assert.ok(red.some(i=>lineOnly.rgba.slice(i,i+4).some((v,n)=>wrongServiceOrder.rgba[i+n]!==v)),
 'negative control: station rings painted above the route must obstruct some measured route pixels');
await page.evaluate(()=>fixtureMap.moveLayer('station-world-dots','service-routes'));
const serviceRestored=await servicePixels();
assert.ok(red.every(i=>lineOnly.rgba.slice(i,i+4).every((v,n)=>serviceRestored.rgba[i+n]===v)));
await page.screenshot({path:'browser-review/station-world-service-z7.8.png'});
await writeFile('browser-review/station-world-service-pixels.json',JSON.stringify({scope:'synthetic only',zoom:7.8,
 redPixels:red.length,lineOnly,servicePositive,wrongServiceOrder,serviceRestored},null,2)+'\n');
console.log('PASS: Service route colours remain exact through eight overlapping station rings; reversed paint order fails');

// Exercise the actual app handler as well as the isolated layer. A serialized
// language style retains runtime entries; a fresh replacement does not.
await page.goto(`${base}?mode=infrastructure&language=en&stations=1&autoGlobe=0&relief=0&inactive=0&trackCounts=0&transport=0&destinations=0&constraints=0#7/15/15`);
await page.waitForSelector('body[data-map-ready="true"]',{timeout:60000});
await page.evaluate(async()=>{window.stationAppMap=(await import(document.querySelector('script[type="module"]').src)).map;});
const appReady=async()=>{
 await page.waitForFunction(()=>{
  const map=window.stationAppMap;
  return map?.getLayer('station-world-dots')&&map.isStyleLoaded()&&
   map.getLayoutProperty('station-world-dots','visibility')==='visible'&&
   new Set(map.queryRenderedFeatures({layers:['station-world-dots']}).map(f=>f.properties.id)).size===8;
 },null,{timeout:45000});
 const sample=await page.evaluate(()=>{
  const map=stationAppMap;
  return {language:document.querySelector('#language').value,
   source:Boolean(map.getSource('stationWorld')),
   markerIds:[...new Set(map.queryRenderedFeatures({layers:['station-world-dots']}).map(f=>f.properties.id))].sort(),
   layers:map.getStyle().layers.filter(layer=>layer.id==='station-world-dots').length,
   superseded:['station-major-dots','station-stationLow-dots','station-stationMed-dots','station-provider-dots','station-curated-fallback-dots','station-basemap-fallback-dots']
    .filter(id=>map.getLayer(id)).map(id=>[id,map.getLayoutProperty(id,'visibility')])};
 });
 assert.equal(sample.source,true);assert.equal(sample.layers,1);
 assert.deepEqual(sample.markerIds,points.map(f=>f.properties.id).sort());
 assert.ok(sample.superseded.every(([,visibility])=>visibility==='none'));
 return sample;
};
const appResults=[{action:'cold load',...await appReady()}],metadata=calls.filter(call=>call!=='bundle');
for(const language of ['fr','en']){
 await page.selectOption('#language',language);
 appResults.push({action:'language reload',...await appReady()});
}
for(const fresh of [false,true,true]){
 await page.evaluate(fresh=>{
  const style=stationAppMap.getStyle();
  if(fresh){delete style.sources.stationWorld;style.layers=style.layers.filter(layer=>layer.id!=='station-world-dots');}
  stationAppMap.setStyle(style,{diff:false});
 },fresh);
 appResults.push({action:fresh?'fresh style reload':'serialized style reload',...await appReady()});
}
// Intentional source cancellation is not a data failure, even after reload.
await page.evaluate(()=>stationAppMap.fire('error',{sourceId:'stationWorld',error:new DOMException('The operation was aborted','AbortError')}));
appResults.push({action:'intentional abort',...await appReady()});
for(const mode of [...MODES,'service']){
 await page.click(`[data-mode="${mode}"]`);
 appResults.push({action:`${mode} view`,...await appReady()});
 const paint=await page.evaluate(()=>stationAppMap.getPaintProperty('station-world-dots','circle-opacity'));
 assert.equal(paint,0,'every view keeps hollow station markers');
 for(const zoom of [6.999999,7,7.8,9.7]){
  await page.evaluate(zoom=>stationAppMap.jumpTo({center:[15,15],zoom}),zoom);
  await appReady();
  const actual=await page.evaluate(()=>({zoom:stationAppMap.getZoom(),
    radius:stationAppMap.getPaintProperty('station-world-dots','circle-radius'),
    stroke:stationAppMap.getPaintProperty('station-world-dots','circle-stroke-width')}));
  assert.ok(Math.abs(2*(actual.radius+actual.stroke)-stationMarkerDiameter(mode,actual.zoom))<1e-12,
    `${mode} z${zoom}: outer diameter follows the live line-width scale`);
 }
}
await page.selectOption('#language','fr');
appResults.push({action:'Service language reload',...await appReady()});
assert.equal(await page.evaluate(()=>stationAppMap.getPaintProperty('station-world-dots','circle-opacity')),0);
assert.deepEqual(calls.filter(call=>call!=='bundle'),metadata,'style/language reloads reuse the verified manifest/index');
assert.deepEqual(errors,[],'the full app must not throw during style replacement');
await writeFile('browser-review/station-world-app-reloads.json',JSON.stringify({scope:'synthetic only',appResults,calls},null,2)+'\n');
console.log('PASS: actual Atlas language, serialized/fresh style reloads and abort preserve all eight station identities');
} finally {await browser.close();await server.close();}
