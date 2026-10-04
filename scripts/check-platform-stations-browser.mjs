import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {waitUntil} from './wait-until.mjs';

// Complete OSM platform areas from the three reported stations, encoded with
// the provider's real tile contract (typed identity/name, no ref or length).
const fixture=JSON.parse(await readFile(new URL('../tests/fixtures/platform-stations.json',import.meta.url)));
const platforms=fixture.stations.flatMap(s=>s.platforms),byId=new Map(platforms.map(f=>[f.properties.id,f]));
const index=geojsonvt({type:'FeatureCollection',features:platforms.map(f=>({...f,properties:{id:f.properties.id,name:f.properties.name}}))},{maxZoom:22,indexMaxZoom:17,extent:4096});
const archive=Buffer.alloc(130);archive.write('PMTiles');archive[7]=3;
for(const [offset,value] of [[8,127],[16,1],[24,128],[32,2],[40,130],[56,130]])archive.writeBigUInt64LE(BigInt(value),offset);
archive[96]=1;archive[97]=archive[98]=archive[99]=1;archive[101]=22;
for(const [offset,value] of [[102,-1800000000],[106,-850000000],[110,1800000000],[114,850000000]])archive.writeInt32LE(value,offset);
archive.write('{}',128);
const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/'),runtime=process.env.ATLAS_BROWSER_RUNTIME,glyphFile=process.env.ATLAS_BROWSER_GLYPHS;
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
await mkdir('browser-review',{recursive:true});
try{for(const [kind,width,height] of [['desktop',1365,900],['mobile',412,915]]){
 const page=await browser.newPage({viewport:{width,height},hasTouch:kind==='mobile',deviceScaleFactor:kind==='mobile'?2:1,serviceWorkers:'block'}),errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));
 if(runtime)await page.route('https://cdn.jsdelivr.net/npm/**',async route=>{const path=new URL(route.request().url()).pathname,local=path.includes('maplibre-gl')?'maplibre-gl/dist/'+path.split('/').at(-1):'pmtiles/dist/pmtiles.js';await route.fulfill({body:await readFile(`${runtime}/${local}`),contentType:path.endsWith('.css')?'text/css':'text/javascript'});});
 await page.route('https://tuiles.enliberte.fr/planet.pmtiles',route=>route.fulfill({body:archive,contentType:'application/octet-stream'}));
 if(glyphFile)await page.route('https://tuiles.enliberte.fr/fonts/**',async route=>route.fulfill({body:await readFile(glyphFile),contentType:'application/x-protobuf'}));
 await page.route('**/data/**/index.json',route=>route.fulfill({json:{tiles:[]}}));
 await page.route('https://openrailwaymap.app/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.startsWith('/api/feature/')){const f=byId.get(path.split('/').at(-1));assert.ok(f);await route.fulfill({json:{properties:{ref:f.properties.ref.split(';'),name:f.properties.name}}});}
  else await route.fulfill({json:{tilejson:'3.0.0',tiles:[`${base}review-station-tiles${path}/{z}/{x}/{y}.pbf`],minzoom:0,maxzoom:22}});
 });
 await page.route('**/review-station-tiles/**',async route=>{
  const [,layer,z,x,y]=/review-station-tiles\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.pbf/.exec(route.request().url());
  const tile=layer==='standard_railway_platforms'?index.getTile(+z,+x,+y):null;
  await route.fulfill({body:tile?Buffer.from(vtpbf.fromGeojsonVt({[layer]:tile},{version:2})):Buffer.alloc(0),contentType:'application/x-protobuf'});
 });
 await page.route('https://api.openstreetmap.org/api/0.6/**',async route=>{
  const [,id]=/\/way\/(\d+)\/full\.json$/.exec(new URL(route.request().url()).pathname),f=byId.get(`way-${id}`);assert.ok(f);requests.push(id);
  const coords=f.geometry.type==='Polygon'?f.geometry.coordinates[0]:f.geometry.coordinates,nodes=coords.map(([lon,lat],i)=>({type:'node',id:i+1,lon,lat})),ids=nodes.map(n=>n.id);
  if(f.geometry.type==='Polygon')ids[ids.length-1]=ids[0];
  await route.fulfill({json:{elements:[...nodes,{type:'way',id:+id,nodes:ids,tags:{ref:f.properties.ref,name:f.properties.name,railway:'platform'}}]}});
 });
 await page.goto(base+'?mode=infrastructure&language=zh-Hant&background=plain&relief=0&stations=0&names=0&inactive=0&trackCounts=0&transport=0&destinations=0&constraints=0#19/35.1167/129.0440',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('body[data-map-ready="true"]',{state:'attached',timeout:60000});
 await page.evaluate(async()=>{window.reviewMap=(await import(document.querySelector('script[type="module"]').src)).map;});
 await page.waitForFunction(()=>document.fonts.check('24px "Atlas CJK TC"')&&window.reviewMap.style.glyphManager.localIdeographFontFamily.includes('Atlas CJK TC'),undefined,{timeout:30000});
 const checkGlyphs=async code=>{
  const result=await page.evaluate(async code=>{
   const map=window.reviewMap,stack=map.getStyle().layers.find(l=>l.id.startsWith('station-')&&l.type==='symbol').layout['text-font'].join(','),ids=[...'汉岛华顿联车漢島華頓聯車'].map(c=>c.codePointAt(0));
   const glyphs=(await map.style.glyphManager.getGlyphs({[stack]:ids}))[stack],entry=map.style.glyphManager.entries[stack];
   return {stack,font:entry.tinySDF?.ctx.font,visible:ids.every(id=>glyphs[id]?.bitmap.data.some(v=>v>0)),distinct:new Set(ids.map(id=>glyphs[id]?.bitmap.data.join(','))).size};
  },code);
  assert.ok(result.stack.includes(`Atlas CJK ${code}`));assert.ok(result.font.includes(`Atlas CJK ${code}`),'actual TinySDF canvas must use the packaged font');assert.equal(result.visible,true);assert.equal(result.distinct,12,'missing-character boxes must not replace Simplified fallback glyphs');
 };
 await checkGlyphs('TC');
 for(const station of fixture.stations){
  await page.evaluate(center=>window.reviewMap.jumpTo({center,zoom:19}),station.center);
  await waitUntil(page,async()=>{
   const map=window.reviewMap,visible=[...new Set(map.queryRenderedFeatures({layers:['platform-areas']}).map(f=>f.properties.id))],data=(await map.getSource('platformNumbers').getData()).features;
   return visible.length>=2&&visible.every(id=>data.some(f=>f.properties.id===id&&f.properties.platform_length>0&&f.properties.length_estimated));
  },undefined,{timeout:35000});
  const labels=await page.evaluate(async()=>(await window.reviewMap.getSource('platformNumbers').getData()).features.map(f=>f.properties));
  for(const p of labels){const f=byId.get(p.id);assert.ok(f);assert.equal(p.ref,f.properties.ref.split(';').filter(Boolean).join(' / '));assert.ok(p.platform_length>0&&p.platform_length<1200);}
  assert.ok(await page.evaluate(()=>window.reviewMap.queryRenderedFeatures({layers:['platform-numbers']}).length>0));
  await page.screenshot({path:`browser-review/platform-${station.name}-${kind}.png`});
  // A viewport at a platform's end excludes its full midpoint. The label must
  // remain visible and retain the complete-object length at maximum zoom.
  const f=station.platforms.find(f=>f.properties.ref),tip=f.geometry.coordinates[0][0],before=labels.find(p=>p.id===f.properties.id)?.platform_length;
  await page.evaluate(center=>window.reviewMap.jumpTo({center,zoom:22}),tip);
  await waitUntil(page,async id=>window.reviewMap.queryRenderedFeatures({layers:['platform-numbers']}).some(f=>f.properties.id===id&&f.properties.platform_length>0),f.properties.id,{timeout:20000});
  const p=await page.evaluate(async id=>(await window.reviewMap.getSource('platformNumbers').getData()).features.find(f=>f.properties.id===id).properties,f.properties.id);
  if(before)assert.equal(p.platform_length,before);assert.equal(p.ref,f.properties.ref.split(';').join(' / '));
  console.log(`PASS: ${kind} ${station.name}, complete area lengths, recorded numbers and visible end labels at zoom 22`);
 }
 if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();
 await page.selectOption('#language','zh-Hans');
 await page.waitForFunction(()=>document.fonts.check('24px "Atlas CJK SC"')&&window.reviewMap.style.glyphManager.localIdeographFontFamily.includes('Atlas CJK SC'),undefined,{timeout:30000});
 await checkGlyphs('SC');
 const counts=new Map();for(const id of requests)counts.set(id,(counts.get(id)||0)+1);assert.ok([...counts.values()].every(n=>n===1),'pans, zooms and font/style changes reuse complete-object cache');
 assert.deepEqual(errors,[]);console.log(`PASS: ${kind} both packaged CJK fonts load without blocking startup`);await page.close();
}}finally{await browser.close();}
