// Real Atlas/MapLibre, controlled Paris station tiles. The shared browser guard
// blocks all unmocked provider egress; no live station inventory is downloaded.
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {serveAtlasAppFixture} from './atlas-app-browser-fixture.mjs';
import {ormVectorFixture} from './orm-vector-fixture.mjs';
import {waitUntil} from './wait-until.mjs';
import {STATION_FALLBACK_IDS} from '../styles/station-fallback.mjs';
import {stationLanguageStyleReady} from './rail-fixture-readiness.mjs';

const center=[2.3553,48.8809],curated=[2.3753,48.8909],distant=[32.3753,48.8909];
const point=(id,coordinates,properties)=>({type:'Feature',id,properties:{id,...properties},geometry:{type:'Point',coordinates}});
const basemapPoint=point('fixture-paris-poi',[2.3353,48.8709],{class:'railway',subclass:'station',name:'Gare témoin', 'name:en':'Fixture station','name:fr':'Gare témoin'});
const neighbor=[2.62,48.8809]; // east of the z10 tile edge at longitude 2.4609375
const neighborPoi=point('fixture-neighbor-poi',[2.60,48.8709],{class:'railway',subclass:'station',name:'Healthy neighboring station'});
const poi=[basemapPoint,neighborPoi,point('fixture-entrance',[2.3453,48.8709],{class:'railway',subclass:'subway_entrance',name:'Entrance'}),point('fixture-crossing',[2.3453,48.8809],{class:'railway',subclass:'level_crossing',name:'Crossing'})];
const providerPoint=point('node/12345',center,{feature:'station',station:'train',state:'present',station_size:'large',name:'Provider station'});
const neighborProvider=point('node/54321',neighbor,{feature:'station',station:'train',state:'present',station_size:'large',name:'Healthy provider station'});
const hubs={type:'FeatureCollection',features:[point('curated-paris',curated,{feature:'station',tier:3,name:'Curated Paris'}),point('curated-neighbor',[2.64,48.8909],{feature:'station',tier:3,name:'Healthy curated neighbor'}),point('curated-distant',distant,{feature:'station',tier:3,name:'Curated distant'})]};
const index=features=>geojsonvt({type:'FeatureCollection',features},{maxZoom:16,indexMaxZoom:7,extent:4096,buffer:64});
const poiIndex=index(poi),stationIndex=index([providerPoint,neighborProvider]),basemapTiles={};
const tileAt=(position,z)=>{const n=2**z,[lon,lat]=position;return {z,x:Math.floor((lon+180)/360*n),y:Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n)};};
// Only tiles touching the tiny synthetic point fixture, including their buffer.
for(let z=8;z<=14;z++)for(const f of poi){
 const n=2**z,[lon,lat]=f.geometry.coordinates,x=Math.floor((lon+180)/360*n),y=Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n);
 for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
  const tile=poiIndex.getTile(z,x+dx,y+dy);if(tile?.features.length)basemapTiles[`${z}/${x+dx}/${y+dy}`]=[...vtpbf.fromGeojsonVt({poi:tile},{version:2})];
 }
}
const server=await serveAtlasAppFixture(),base=server.origin+'/',browser=await launchBrowser();
const reports=[],errors=[],requests=[];let page,provider='healthy',currentCase;
await mkdir('browser-review',{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await installEmptyMapProviders(context,base);
 await context.addInitScript(tiles=>{
  let pmtiles;
  const patch=value=>{if(!value)return value;const Protocol=value.Protocol;return {...value,Protocol:class extends Protocol{
   tile=async params=>({data:params.type==='json'?{tilejson:'3.0.0',minzoom:0,maxzoom:14,tiles:['pmtiles://fixture/{z}/{x}/{y}']}:
    new Uint8Array(tiles[/\/(\d+\/\d+\/\d+)$/.exec(params.url)?.[1]]||[]).buffer});
  }};};
  pmtiles=patch(window.pmtiles);Object.defineProperty(window,'pmtiles',{configurable:true,get:()=>pmtiles,set:value=>{pmtiles=patch(value)}});
 },basemapTiles);
 page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
 style.sources.stationMajor.data=hubs;
 await page.route('**/world.style.json*',route=>route.fulfill({json:style}));
 await page.route('**/major-stations.geojson*',route=>route.fulfill({json:hubs}));
 await page.route('https://openrailwaymap.app/**',route=>{
  const path=new URL(route.request().url()).pathname;
  let requested;
  const response=ormVectorFixture(path,{'standard_railway_text_stations':stationIndex},tile=>{requested=tile;requests.push({...tile,provider});});
  if(!response)return route.fallback();
  const failed=provider==='failed'||provider==='mixed'&&requested.x===tileAt(center,requested.z).x&&requested.y===tileAt(center,requested.z).y;
  if(path.startsWith('/standard_railway_text_stations/')&&failed)return route.fulfill({status:503,body:'Controlled station failure'});
  return route.fulfill(response);
 });
 const sample=async()=>page.evaluate(async ids=>{
  const map=window.stationMap,all=map.getStyle().layers;
  const manager=map.style.tileManagers.stations;
  const rendered=layers=>map.queryRenderedFeatures({layers}).map(f=>({id:f.properties.id,name:f.properties.atlas_name||f.properties.name}));
  return {zoom:map.getZoom(),styleLoaded:map.isStyleLoaded(),tilesLoaded:map.areTilesLoaded(),
   filters:Object.fromEntries(ids.map(id=>[id,map.getFilter(id)])),
   stationTiles:manager.getIds().map(id=>{const tile=manager.getTileByID(id);return {state:tile.state,wrap:tile.tileID.wrap,...tile.tileID.canonical};}),
   visibility:Object.fromEntries(ids.map(id=>[id,map.getLayoutProperty(id,'visibility')])),
   fallback:rendered([ids[0]]),curated:rendered([ids[1]]),names:rendered([ids[2]]),
   provider:rendered(all.filter(l=>l.source==='stations'&&l.type==='circle').map(l=>l.id)),
   providerNames:rendered(all.filter(l=>l.source==='stations'&&l.type==='symbol').map(l=>l.id)),
   curatedData:(await map.getSource('stationMajor').getData()).features.map(f=>f.properties.id),
   status:document.querySelector('#map-status').textContent,error:document.querySelector('#map-status').classList.contains('error')};
 },STATION_FALLBACK_IDS);
 const ready=async({fallback=provider==='failed',enabled=true,hub='curated-paris',requirePoi=true}={})=>{
  await waitUntil(page,({ids,show,healthy,enabled,hub,requirePoi})=>{
   const map=window.stationMap;if(!map?.isStyleLoaded())return false;
   const count=id=>map.queryRenderedFeatures({layers:[id]}).length;
   if(ids.some(id=>map.getLayoutProperty(id,'visibility')!==(show?'visible':'none')))return false;
   if(show)return map.queryRenderedFeatures({layers:[ids[1]]}).some(f=>f.properties.id===hub)&&(!requirePoi||(count(ids[0])>0&&count(ids[2])>0));
   if(ids.some(id=>count(id)>0))return false;
   const providerCount=map.queryRenderedFeatures({layers:map.getStyle().layers.filter(l=>l.source==='stations'&&l.type==='circle').map(l=>l.id)}).length;
   return enabled?(!healthy||providerCount>0):providerCount===0;
  },{ids:STATION_FALLBACK_IDS,show:fallback&&enabled,healthy:!fallback&&enabled,enabled,hub,requirePoi},{timeout:30000});
  const result=await sample();reports.push({...currentCase,...result});return result;
 };
 const open=async(zoom,background='map',position=center,detail=0)=>{
  currentCase={provider,zoom,background,action:'cold load'};
  await page.goto(`${base}?mode=infrastructure&background=${background}&language=en&detail=${detail}&stations=1&relief=0&inactive=0&trackCounts=0&transport=0&destinations=0&constraints=0#${zoom}/${position[1]}/${position[0]}`);
  await page.waitForSelector('body[data-map-ready="true"]',{timeout:60000});
  await page.evaluate(async()=>{window.stationMap=(await import(document.querySelector('script[type="module"]').src)).map});
 };
 const check=async()=>{
  const report=await ready();
  if(provider==='healthy'){
   assert.ok(report.provider.some(f=>f.id===providerPoint.properties.id),'healthy provider point renders');
   assert.equal(report.fallback.length,0);assert.equal(report.curated.length,0);assert.equal(report.names.length,0);
   assert.equal(report.error,false,'healthy stations must not report an outage');
  }else{
   assert.ok(report.fallback.some(f=>f.id==='fixture-paris-poi'));
   assert.ok(report.fallback.every(f=>['fixture-paris-poi','fixture-neighbor-poi'].includes(f.id)),'entrances/crossings cannot become station fallback');
   assert.ok(report.names.some(f=>f.id==='fixture-paris-poi'),'fallback station name actually renders');
   assert.ok(report.curated.some(f=>f.id==='curated-paris'),'curated hub actually renders');
   assert.equal(report.provider.length,0);assert.match(report.status,/station data unavailable/);assert.equal(report.error,true);
  }
  return report;
 };
 for(provider of ['healthy','failed']){
 for(const zoom of [9,9.8,10,11,12]){await open(zoom);await check();}
 for(const background of ['carto','hybrid']){await open(10,background);await check();}
 await open(10);await check();
 for(const mode of ['speed','electrification','infrastructure']){
  currentCase={provider,action:'mode switch',mode};await page.locator(`[data-mode="${mode}"]`).click();await check();
 }
 for(const language of ['fr','en','fr']){
  currentCase={provider,action:'language switch',language};await page.selectOption('#language',language);
  await page.waitForFunction(stationLanguageStyleReady,language,{timeout:30000});
  await check();
  if(provider==='failed'){
  await waitUntil(page,name=>window.stationMap.queryRenderedFeatures({layers:['station-basemap-fallback-names']}).some(f=>f.properties.atlas_name===name),language==='fr'?'Gare témoin':'Fixture station');
  const report=await sample();assert.ok(report.names.some(f=>f.name===(language==='fr'?'Gare témoin':'Fixture station')),'rendered fallback uses selected language');
  }
 }
 currentCase={provider,action:'stations off'};
 await page.locator('#settings-open').click();await page.locator('#stations').uncheck();const disabled=await ready({enabled:false});
 assert.equal(disabled.fallback.length+disabled.curated.length+disabled.names.length+disabled.provider.length,0);
 currentCase={provider,action:'stations on'};await page.locator('#stations').check();await check();await page.locator('#settings-close').click();
 await page.screenshot({path:`browser-review/paris-station-${provider}.png`});
 currentCase={provider,action:'satellite only'};await page.locator('[data-background="satellite"]').click();
 const satellite=await ready({enabled:false});assert.equal(satellite.fallback.length+satellite.curated.length+satellite.names.length,0);
 await page.locator('[data-background="map"]').click();await check();
 }
 // A subsequent successful retry clears fallback markers, including their names.
 provider='healthy';currentCase={provider,action:'provider recovery'};
 await page.evaluate(()=>{const source=window.stationMap.getSource('stations');source.setTiles([...source.tiles]);});
 await check();
 // Mixed success is different from a provider-wide outage: neighboring ORM
 // stations must render without either neighboring fallback geometry or names.
 provider='mixed';await open(10,'map',[2.45,48.8809]);currentCase={provider,action:'mixed tile success'};
 await ready({fallback:true});
 const mixed=await sample();
 assert.ok(mixed.provider.some(f=>f.id===neighborProvider.properties.id),'healthy neighboring ORM station remains');
 assert.ok(!mixed.provider.some(f=>f.id===providerPoint.properties.id),'failed tile supplies no ORM station');
 assert.deepEqual([...new Set(mixed.fallback.map(f=>f.id))],['fixture-paris-poi'],'healthy neighboring POI is masked');
 assert.deepEqual([...new Set(mixed.curated.map(f=>f.id))],['curated-paris'],'healthy neighboring curated hub is masked');
 assert.ok(!mixed.names.some(f=>f.id==='fixture-neighbor-poi'),'healthy neighboring name is masked');
 await page.screenshot({path:'browser-review/paris-station-mixed.png'});
 currentCase={provider,action:'pan to healthy neighboring tiles'};
 await page.evaluate(center=>window.stationMap.jumpTo({center,zoom:12}),neighbor);
 await waitUntil(page,()=>{
  const map=window.stationMap;if(!map?.isStyleLoaded())return false;
  const fallback=map.queryRenderedFeatures({layers:['station-basemap-fallback-dots','station-curated-fallback-dots','station-basemap-fallback-names']});
  const provider=map.queryRenderedFeatures({layers:map.getStyle().layers.filter(l=>l.source==='stations'&&l.type==='circle').map(l=>l.id)});
  return !fallback.length&&provider.some(f=>f.properties.id==='node/54321');
 },null,{timeout:30000});
 reports.push({...currentCase,...await sample()});
 // Returning to the failed tile restores its scoped fallback; only successful
 // recovery of that tile removes it while the healthy neighbor stays intact.
 await page.evaluate(()=>window.stationMap.jumpTo({center:[2.45,48.8809],zoom:10}));
 await ready({fallback:true});provider='healthy';currentCase={provider,action:'mixed tile recovery'};
 await page.evaluate(()=>{const source=window.stationMap.getSource('stations');source.setTiles([...source.tiles]);});
 await check();
 provider='failed';
 // Regression for the reviewed raw-z22 cutoff: initial data is cleared by app
 // startup, then repopulated by updateMajorStations at maximum More detail.
 await open(22,'map',curated,2);let maximum=await ready({requirePoi:false});assert.equal(maximum.zoom,22);
 assert.ok(maximum.curatedData.includes('curated-paris'));assert.ok(!maximum.curatedData.includes('curated-distant'));
 currentCase={provider,zoom:22,action:'pan at maximum zoom'};
 await page.evaluate(center=>window.stationMap.jumpTo({center,zoom:22}),distant);
 maximum=await ready({requirePoi:false,hub:'curated-distant'});assert.ok(maximum.curatedData.includes('curated-distant'));
 assert.ok(requests.some(r=>r.provider==='failed'&&r.layer==='standard_railway_text_stations'),'real station HTTP failures exercised');
 assert.ok(requests.some(r=>r.provider==='healthy'&&r.layer==='standard_railway_text_stations'),'healthy fixture source exercised');
 assert.deepEqual(errors,[]);console.log(`Paris station fallback: ${reports.length} real-renderer cases passed`);
}catch(error){
 let diagnostic;try{diagnostic=page?await page.evaluate(()=>({status:document.querySelector('#map-status')?.textContent,zoom:window.stationMap?.getZoom(),layers:window.stationMap?.getStyle()?.layers.filter(l=>l.id.includes('fallback')).map(l=>({id:l.id,layout:l.layout})),sources:window.stationMap?.getStyle()?.sources})):null;}catch{}
 await writeFile('browser-review/paris-station-fallback-failure.json',JSON.stringify({currentCase,error:String(error),diagnostic,errors,requests,reports},null,2));throw error;
}finally{
 await writeFile('browser-review/paris-station-fallback.json',JSON.stringify({reports,errors,requests},null,2));
 try{await browser.close();}finally{await server.close();}
}
