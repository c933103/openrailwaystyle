import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {waitUntil} from './wait-until.mjs';

// Synthetic geometry, with fields checked against OpenRailwayMap-vector
// 3c8942fa5c9403fe66fa91485ccec8c9e33a5436. The complete edge length is
// the recorded Tokyo fixture; its visible tile geometry is deliberately clipped.
const edge=JSON.parse(await readFile(new URL('../tests/fixtures/platform-edge.json',import.meta.url)));
const feature=(properties,type,coordinates)=>({type:'Feature',properties,geometry:{type,coordinates}});
const datasets={
 standard_railway_platform_edges:[edge.feature],
 standard_railway_platforms:[
  feature({id:'relation-9001',feature:'platform',name:'Island platform'},'Polygon',[[[139.76615,35.68135],[139.76630,35.68135],[139.76630,35.68170],[139.76615,35.68170],[139.76615,35.68135]]]),
  feature({id:'way-9002',feature:'platform'},'LineString',[[139.76662,35.6814],[139.76662,35.6816]]),
  feature({id:'node-9003',feature:'platform'},'Point',[139.7662,35.68135]),
 ],
 railway_signals:[feature({id:9004,railway:'signal',ref:'S12',caption:'Main signal',category0:'main',deactivated0:false,azimuth:90},'Point',[139.76650,35.68175]),feature({id:9999,railway:'buffer_stop',ref:'Buffer'},'Point',[139.766,35.68175])],
 standard_station_entrances:[feature({id:9005,label:'East entrance'},'Point',[139.76650,35.6812])],
 railway_line_high:[feature({id:9100,railway:'rail',usage:'main',service:'',feature:'rail'},'LineString',edge.feature.geometry.coordinates.map(([x,y])=>[x+.00005,y]))],
};
const indexes=Object.fromEntries(Object.entries(datasets).map(([key,features])=>[key,geojsonvt({type:'FeatureCollection',features},{maxZoom:22,indexMaxZoom:17,extent:4096})]));
const refs={'relation-9001':['1','2'],'way-9002':['3'],'node-9003':['9']};
// Empty, valid PMTiles v3 basemap: keep this test independent of planet ranges.
const archive=Buffer.alloc(130);archive.write('PMTiles');archive[7]=3;
for(const [offset,value] of [[8,127],[16,1],[24,128],[32,2],[40,130],[56,130]])archive.writeBigUInt64LE(BigInt(value),offset);
archive[96]=1;archive[97]=archive[98]=archive[99]=1;archive[101]=22;
for(const [offset,value] of [[102,-1800000000],[106,-850000000],[110,1800000000],[114,850000000]])archive.writeInt32LE(value,offset);
archive.write('{}',128);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const base=(process.env.MAP_BASE_URL||'http://127.0.0.1:4173/').replace(/\/?$/,'/');
const runtime=process.env.ATLAS_BROWSER_RUNTIME,glyphFile=process.env.ATLAS_BROWSER_GLYPHS;
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
await mkdir('browser-review',{recursive:true});
try{for(const [kind,width,height] of [['desktop',1365,900],['mobile',412,915]]){
 const page=await browser.newPage({viewport:{width,height},hasTouch:kind==='mobile',deviceScaleFactor:kind==='mobile'?2:1,serviceWorkers:'block'});
 const errors=[],requests=[];
 page.on('console',message=>{if(message.type()==='error')console.error(kind,message.text());});page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,options){return get.call(this,kind,/^webgl2?$/.test(kind)?{...options,preserveDrawingBuffer:true}:options);};});
 if(runtime)await page.route('https://cdn.jsdelivr.net/npm/**',async route=>{const path=new URL(route.request().url()).pathname;const local=path.includes('maplibre-gl')?'maplibre-gl/dist/'+path.split('/').at(-1):'pmtiles/dist/pmtiles.js';await route.fulfill({body:await readFile(`${runtime}/${local}`),contentType:path.endsWith('.css')?'text/css':'text/javascript'});});
 await page.route('https://tuiles.enliberte.fr/planet.pmtiles',route=>route.fulfill({body:archive,contentType:'application/octet-stream'}));
 if(glyphFile)await page.route('https://tuiles.enliberte.fr/fonts/**',async route=>route.fulfill({body:await readFile(glyphFile),contentType:'application/x-protobuf'}));
 await page.route('**/data/**/index.json',route=>route.fulfill({json:{tiles:[]}}));
 await page.route('https://openrailwaymap.app/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.startsWith('/api/feature/')){
   requests.push(path);const id=path.split('/').at(-1);
   if(path.includes('standard_railway_platform_edges/')&&id==='349685435')await route.fulfill({json:edge.response});
   else if(path.includes('standard_railway_platforms/')&&refs[id])await route.fulfill({json:{properties:{ref:refs[id]}}});
   else await route.fulfill({status:404,body:''});
  }else await route.fulfill({json:{tilejson:'3.0.0',tiles:[`${base}review-tiles${path}/{z}/{x}/{y}.pbf`],minzoom:0,maxzoom:22}});
 });
 await page.route('**/review-tiles/**',async route=>{
  const match=/review-tiles\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.pbf/.exec(route.request().url());assert.ok(match);
  const [,layer,z,x,y]=match,tile=indexes[layer]?.getTile(+z,+x,+y);
  await route.fulfill({body:tile?Buffer.from(vtpbf.fromGeojsonVt({[layer]:tile},{version:2})):Buffer.alloc(0),contentType:'application/x-protobuf'});
 });
 await page.route('https://tiles.maps.eox.at/**',route=>route.fulfill({body:png,contentType:'image/png'}));
 await page.route('https://api.openstreetmap.org/api/0.6/**',async route=>{
  const match=/\/(node|way|relation)\/(\d+)/.exec(new URL(route.request().url()).pathname),[,type,id]=match,key=`${type}-${id}`;
  const f=datasets.standard_railway_platforms.find(f=>f.properties.id===key);assert.ok(f);
  const coordinates=f.geometry.type==='Polygon'?f.geometry.coordinates[0]:f.geometry.type==='Point'?[f.geometry.coordinates]:f.geometry.coordinates;
  const nodes=coordinates.map(([lon,lat],i)=>({type:'node',id:10000+i,lon,lat}));
  const tags={ref:refs[key].join(';')},way={type:'way',id:type==='way'?+id:20000,nodes:nodes.map(n=>n.id),tags};
  if(f.geometry.type==='Polygon')way.nodes[way.nodes.length-1]=way.nodes[0];
  await route.fulfill({json:{elements:type==='node'?[{...nodes[0],id:+id,tags}]:type==='way'?[...nodes,way]:[...nodes,way,{type:'relation',id:+id,tags,members:[{type:'way',ref:20000,role:'outer'}]}]}});
 });
 await page.goto(base+'?mode=infrastructure&relief=0&stations=0&names=0&inactive=0&trackCounts=0&transport=0&destinations=0&constraints=0#17/35.6815/139.7664',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('body[data-map-ready="true"]',{state:'attached',timeout:60000});
 await page.evaluate(async()=>{window.reviewMap=(await import(document.querySelector('script[type="module"]').src)).map;});
 await waitUntil(page,async()=>((await window.reviewMap.getSource('platformNumbers').getData()).features||[]).length===3,undefined,{timeout:20000});
 assert.equal(requests.filter(path=>path.includes('standard_railway_platform_edges')).length,0,'references need no length lookup at zoom 17');
 assert.deepEqual(await page.evaluate(async()=>(await window.reviewMap.getSource('platformNumbers').getData()).features.map(f=>f.properties.ref).sort()),['1 / 2','3','9']);
 assert.ok(await page.evaluate(async()=>(await window.reviewMap.getSource('platformLengths').getData()).features.some(f=>f.properties.ref==='1'&&!f.properties.platform_length)));
 await page.evaluate(()=>window.reviewMap.jumpTo({zoom:19}));
 try{await waitUntil(page,async()=>(await window.reviewMap.getSource('platformLengths').getData()).features.some(f=>Math.abs(f.properties.platform_length-246.86183810409128)<.001),undefined,{timeout:20000});}catch(error){console.error(JSON.stringify({kind,requests,state:await page.evaluate(async()=>({zoom:window.reviewMap.getZoom(),edges:window.reviewMap.queryRenderedFeatures({layers:['platform-edges']}).map(f=>({properties:f.properties,geometry:f.geometry})),labels:await window.reviewMap.getSource('platformLengths').getData()}))}));throw error;}
 await page.waitForFunction(()=>['infrastructure-signal-points','infrastructure-entrance-points','platform-numbers'].every(id=>window.reviewMap.queryRenderedFeatures({layers:[id]}).length>0));
 assert.ok(await page.evaluate(()=>window.reviewMap.queryRenderedFeatures({layers:['infrastructure-signal-points']}).every(f=>f.properties.railway==='signal')));
 if(await page.locator('#controls').isHidden())await page.locator('#controls-open').click();
 await page.selectOption('#units','imperial');
 assert.ok(await page.evaluate(()=>JSON.stringify(window.reviewMap.getLayoutProperty('platform-lengths','text-field')).includes(' ft')));
 assert.equal(requests.filter(path=>path.includes('standard_railway_platform_edges')).length,1,'units reuse the cached complete length');
 await page.selectOption('#units','metric');
 await page.waitForFunction(()=>window.reviewMap.queryRenderedFeatures({layers:['platform-lengths']}).some(f=>f.properties.platform_length>0));
 await page.locator('#collapse').click();
 await page.screenshot({path:`browser-review/infrastructure-${kind}.png`});
 for(const [layer,type,id] of [['infrastructure-signal-points','node','9004'],['infrastructure-entrance-points','node','9005'],['platform-points','node','9003']]){
  const point=await page.evaluate(layer=>{const map=window.reviewMap,f=map.queryRenderedFeatures({layers:[layer]})[0];if(!f)throw new Error(`No rendered ${layer}`);const p=map.project(f.geometry.coordinates);return {x:p.x,y:p.y};},layer);
  await page.locator('#map canvas').click({position:point});
  await page.waitForSelector('#details:not([hidden])');assert.equal(await page.locator(`#detail-content a[href="https://www.openstreetmap.org/${type}/${id}"]`).count(),1);
  await page.locator('#details-close').click();
 }
 await page.locator('#controls-open').click();
 await page.locator('[data-mode="speed"]').click();
 await page.waitForFunction(()=>['platform-edges','platform-numbers','platform-lengths','infrastructure-signal-points','infrastructure-entrance-points'].every(id=>window.reviewMap.getLayoutProperty(id,'visibility')==='none'));
 await page.locator('[data-mode="infrastructure"]').click();
 await page.locator('#settings-open').click();
 await page.locator('#labels').uncheck();
 assert.ok(await page.evaluate(()=>['platform-numbers','platform-lengths','infrastructure-signal-references','infrastructure-entrance-references'].every(id=>window.reviewMap.getLayoutProperty(id,'visibility')==='none')&&window.reviewMap.getLayoutProperty('infrastructure-signal-points','visibility')==='visible'));
 await page.locator('#labels').check();
 await page.evaluate(()=>window.reviewMap.jumpTo({zoom:18}));
 await waitUntil(page,async()=>{const data=await window.reviewMap.getSource('platformLengths').getData();return data.features.some(f=>f.properties.ref==='1')&&data.features.every(f=>!f.properties.platform_length);});
 assert.equal(requests.filter(path=>path.includes('standard_railway_platform_edges')).length,1);
 assert.deepEqual(errors,[]);console.log(`PASS: ${kind} real vector rendering, typed platform references, full lengths, mapped point links, labels and view switching`);await page.close();
}}finally{await browser.close();}
