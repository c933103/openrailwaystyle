import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {launchBrowser} from './browser.mjs';
import {rendererFixture} from './browser-renderer-fixture.mjs';
import {MAINLINE_CONTROLS,MAINLINE_REGIONS,sha256} from './mainline-coverage.mjs';
import {mainlineRegion,mainlineTiles} from './mainline-overview.mjs';
const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const published=process.argv.includes('--published');
const style=published?await (await fetch(new URL('world.style.json',base))).json():JSON.parse(await readFile('styles/world.style.json'));
const layers=style.layers.filter(l=>l.source==='railReference');assert.equal(layers.length,3);
const readerModule=new URL('mainline-reference.mjs',base).href;
const renderer=await rendererFixture(base),library=[...renderer.keys()].find(u=>/maplibre-gl.+\.js$/.test(u));
const paths=new Map(),requests=[],samples=[],profiles=[];
let controls,manifest;
if(published){
 manifest=await (await fetch(new URL('data/mainline-reference/manifest.json',base))).json();
 assert.equal(manifest.complete,true);assert.equal(manifest.sources.length,8);
 const response=await fetch(new URL(`data/mainline-reference/generations/${manifest.generation}/coverage-audit.json`,base));
 assert.ok(response.ok);controls=await response.json();assert.equal(controls.length,MAINLINE_CONTROLS.length);
 for(const c of controls)assert.ok(c.chainIdsByZoom&&c.feature.properties.osm_version>0);
}else{
 // Synthetic country viewpoints validate rendering only. Never source proof.
 const features=mainlineRegion({elements:MAINLINE_CONTROLS.map((c,i)=>({type:'way',id:1000+i,version:1,
  tags:{railway:'rail',usage:'main'},geometry:[{lon:c.center[0]-1,lat:c.center[1]},{lon:c.center[0]+1,lat:c.center[1]}]}))});
 const data=mainlineTiles(features),generation='f'.repeat(24);
 const index=JSON.stringify({schema:1,complete:true,generation,tiles:[...data.tiles].map(([key,bytes])=>({key,bytes:bytes.length,sha256:sha256(bytes)}))});
 manifest={...data.manifest,complete:true,generation,oldestSource:'2026-10-09T20:00:00Z',newestSource:'2026-10-09T20:00:00Z',
  sources:MAINLINE_REGIONS.map(region=>({region,source:'synthetic renderer fixture'})),indexSha256:sha256(index)};
 paths.set('manifest.json',Buffer.from(JSON.stringify(manifest)));paths.set(`generations/${generation}/index.json`,Buffer.from(index));
 for(const [key,bytes] of data.tiles)paths.set(`generations/${generation}/${key}.pbf.gz`,bytes);
 controls=MAINLINE_CONTROLS.map((c,i)=>({...c,chainIdsByZoom:Object.fromEntries(Array.from({length:7},(_,z)=>[z,[`way-${1000+i}`]]))}));
}
await mkdir('browser-review',{recursive:true});
for(const profile of [{name:'desktop',engine:'chromium',width:800,height:600},
 {name:'android',engine:'chromium',width:360,height:640},
 {name:'safari',engine:'webkit',width:390,height:640}]){
 const browser=await launchBrowser({engine:profile.engine}),page=await browser.newPage({viewport:{width:profile.width,height:profile.height}});
 if(!published)await page.route(library,route=>route.fulfill(renderer.get(library)));
 if(!published)await page.route(new URL('data/mainline-reference/**',base).href,route=>{
  const key=route.request().url().split('/data/mainline-reference/')[1],body=paths.get(key);requests.push({key,bytes:body?.length||0});
  return body?route.fulfill({body,contentType:key.endsWith('.gz')?'application/octet-stream':'application/json'}):route.fulfill({status:404,body:''});
 });
 // Explicit fixture outage for a live thematic overview. No public ORM egress.
 await page.route('https://mainline-fixture.invalid/**',route=>route.fulfill({status:503,body:'upstream unavailable'}));
 await page.route(new URL('mainline-test.html',base).href,route=>route.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
 try{
  await page.goto(new URL('mainline-test.html',base).href);
  await page.setContent(`<html><body style="margin:0"><div id="test-map" style="width:${profile.width}px;height:${profile.height}px"></div></body></html>`);
  await page.addScriptTag({url:library});
  await page.evaluate(async({layers,base,module})=>{
   const {createReferenceReader}=await import(module),reader=createReferenceReader({root:new URL('data/mainline-reference/',base)});
   window.referenceReader=reader;window.referenceLayers=layers;
   maplibregl.addProtocol('mainlinetiles',async(p,c)=>({data:await reader.tile(p.url.slice('mainlinetiles://'.length),c.signal)}));
   window.testMap=new maplibregl.Map({container:'test-map',minZoom:-2,maxZoom:9,center:[139.75,35.68],zoom:6,fadeDuration:0,
    canvasContextAttributes:{preserveDrawingBuffer:true},style:{version:8,sources:{
     railReference:{type:'vector',tiles:['mainlinetiles://{z}/{x}/{y}'],minzoom:0,maxzoom:6,promoteId:'id'},
     missingLive:{type:'vector',tiles:['https://mainline-fixture.invalid/{z}/{x}/{y}'],minzoom:0,maxzoom:6}},
    layers:[{id:'background',type:'background',paint:{'background-color':'#fafafa'}},...layers,
     {id:'missing-live',type:'line',source:'missingLive','source-layer':'missing',paint:{'line-color':'red'}}]}});
   window.sourceErrors=[];testMap.on('error',e=>sourceErrors.push({source:e.sourceId,message:e.error?.message}));
  },{layers,base,module:readerModule});
  for(const projection of ['mercator','globe'])for(const c of controls)for(const zoom of [-.1,0,3,4,5,6,7]){
   const expected=c.chainIdsByZoom[Math.min(6,Math.max(0,Math.floor(zoom)))],started=Date.now();
   await page.evaluate(({center,zoom,projection,expected})=>{
    testMap.setProjection({type:projection});testMap.jumpTo({center,zoom});
    // Globe queryRenderedFeatures uses a planar approximation in this pinned
    // renderer. Isolate exact expected chains, then check their painted pixels.
    for(const layer of referenceLayers)testMap.setFilter(layer.id,['all',layer.filter,['in',['get','id'],['literal',expected]]]);
   },{center:c.center,zoom,projection,expected});
   try{await page.waitForFunction(expected=>testMap.isSourceLoaded('railReference')&&
    testMap.querySourceFeatures('railReference',{sourceLayer:'atlas_mainline_overview',filter:['in',['get','id'],['literal',expected]]}).length,
    expected,{timeout:30000})}
   catch(error){
    const diagnostic=await page.evaluate(()=>({zoom:testMap.getZoom(),center:testMap.getCenter(),loaded:testMap.loaded(),
     sourceLoaded:testMap.isSourceLoaded('railReference'),errorCount:sourceErrors.length,errors:sourceErrors.filter(e=>e.source!=='missingLive').slice(-10),
     rendered:testMap.queryRenderedFeatures({layers:['rail-reference-main','rail-reference-unknown']}).slice(0,30).map(f=>({id:f.properties.id,properties:f.properties}))}));
    const failure={profile:profile.name,projection,name:c.name,zoom,expected,diagnostic};
    console.error('MAINLINE_RENDER_FAILURE',JSON.stringify(failure));
    await writeFile('browser-review/mainline-failure.json',JSON.stringify(failure,null,2)+'\n');
    await page.screenshot({path:'browser-review/mainline-failure.png'});throw error;
   }
   const result=await page.evaluate(async expected=>{
    await new Promise(resolve=>{testMap.once('render',resolve);testMap.triggerRepaint()});
    const found=testMap.querySourceFeatures('railReference',{sourceLayer:'atlas_mainline_overview',filter:['in',['get','id'],['literal',expected]]});
    const canvas=testMap.getCanvas(),gl=canvas.getContext('webgl2');gl.finish();
    const scale=canvas.width/testMap.getContainer().clientWidth;let painted=0;
    for(const f of found){
     const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;
     for(const points of lines)for(const coordinate of [...points,...points.slice(1).flatMap((b,i)=>[.25,.5,.75].map(t=>[points[i][0]+t*(b[0]-points[i][0]),points[i][1]+t*(b[1]-points[i][1])]))]){
      const p=testMap.project(coordinate),x=Math.round(p.x*scale),y=canvas.height-Math.round(p.y*scale);
      if(x<5||y<5||x>canvas.width-5||y>canvas.height-5)continue;
      const pixels=new Uint8Array(9*9*4);gl.readPixels(x-4,y-4,9,9,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]&&Math.min(pixels[i],pixels[i+1],pixels[i+2])<230)painted++;
      if(painted)break;
     }
     if(painted)break;
    }
    return {ids:[...new Set(found.map(f=>f.properties.id))],painted,zoom:testMap.getZoom(),errors:sourceErrors.length};
   },expected);
   assert.ok(result.ids.length&&result.painted>0,`${profile.name} ${projection} ${c.name} z${zoom}: actual reference stroke must paint`);
   samples.push({profile:profile.name,projection,name:c.name,zoom,latencyMs:Date.now()-started,ids:result.ids,painted:result.painted});
  }
  assert.ok(await page.evaluate(()=>sourceErrors.some(e=>e.source==='missingLive')),'reference success cannot conceal live provider outage');
  profiles.push({profile:profile.name,...await page.evaluate(()=>referenceReader.statistics())});
  await page.screenshot({path:`browser-review/mainline-${profile.name}.png`});
 }finally{await browser.close()}
}
const latencies=samples.map(s=>s.latencyMs).sort((a,b)=>a-b);
const report={scope:published?'Actual published OSM generation; exact chain identities':'Synthetic renderer fixtures; no OSM completeness claim',
 generation:manifest.generation,samples,profiles,assetRequests:profiles.reduce((n,p)=>n+p.assetRequests,0),
 requestBytes:profiles.reduce((n,p)=>n+p.assetBytes,0),
 timing:{medianMs:latencies[Math.floor(latencies.length*.5)],p95Ms:latencies[Math.floor(latencies.length*.95)]},providerRequests:0};
await writeFile('browser-review/mainline-reference.json',JSON.stringify(report,null,2)+'\n');
console.log('PASS: independent reference with unavailable thematic provider',JSON.stringify({samples:samples.length,timing:report.timing,generation:manifest.generation}));
