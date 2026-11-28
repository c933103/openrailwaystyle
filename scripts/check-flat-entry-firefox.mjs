import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {firefox} from 'playwright';
import {launchBrowser} from './browser.mjs';
import {gzipSync} from 'node:zlib';
import {electricitySignalsGeoJSON} from './electricity-signal-data.mjs';
import {ELECTRICITY_SIGNAL_STYLE} from '../styles/power-facilities.mjs';
import {zxyToTileId} from 'pmtiles';
import vtPbf from 'vt-pbf';
import {pmtilesBytesResponse} from './pmtiles-browser-fixture.mjs';
import {createPreviewServer} from './serve.mjs';
import {flatVectorFixture} from '../tests/fixtures/flat-vector.mjs';
import {oceanFixtureArchive,terrariumFixturePng} from './bathymetry-browser-fixture.mjs';

const preview=createPreviewServer().listeners('request')[0];
const root=new URL('../styles/',import.meta.url);
const standardPage=await readFile(new URL('index.html',root),'utf8');
assert.match(standardPage,/<html\b[^>]* data-flat-entry="staged">/,'the packaged entry must enable fallback');
const rollbackPage=standardPage.replace(' data-flat-entry="staged"','');
const chromiumSwitch=process.argv.includes('--chromium-switch');
const serviceOverlap=process.argv.includes('--service-overlap');
const watchFocus=process.argv.includes('--watch-focus');
const startupFallback=process.argv.includes('--startup-fallback');
const detailState=process.argv.includes('--detail-state');
const toolbarClearance=process.argv.includes('--toolbar-clearance');
const doubleClickZoom=process.argv.includes('--double-click-zoom');
const watchDoubleTap=process.argv.includes('--watch-double-tap');
const desktopParity=process.argv.includes('--canvas-desktop-parity');
const style=JSON.parse(await readFile(new URL('world.style.json',root),'utf8'));
const fixtureRasterBackgrounds=style.layers.filter(layer=>['carto','satellite'].includes(layer.id));
let fixtureCredits=false;
// Replace the original production layers with the same IDs. Canvas could
// tolerate the duplicates, but MapLibre rejects the whole invalid fixture.
const fixtureElectricityPath='/data/traction/power/electricity-signals.geojson.gz';
const fixtureElectricitySignals=gzipSync(JSON.stringify(electricitySignalsGeoJSON({elements:[
  {type:'node',id:88101,lon:0.001,lat:0.001,tags:{railway:'signal',ref:'P1','railway:signal:electricity':'lower_pantograph'}},
  {type:'node',id:88102,lon:0.006,lat:0.001,tags:{railway:'signal',ref:'P2','railway:signal:electricity':'lower_pantograph','railway:signal:electricity:deactivated':'yes'}},
]})));
const fixturePowerSources=new Set(['electricSignals','electricFacilities','electricMethods']);
const fixturePowerLayers=style.layers.filter(layer=>fixturePowerSources.has(layer.source));
const fixtureServiceLayer=style.layers.find(layer=>layer.id==='service-routes');
const fixtureServiceStart=Date.parse('2026-06-01T08:00:00Z'), fixtureServiceEnd=fixtureServiceStart+60000;
const servicePoint=[1,1], serviceZoom=12, serviceN=2**serviceZoom;
const localServicePoint=([lng,lat])=>[(lng+180)/360*serviceN,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*serviceN];
const [serviceX,serviceY]=localServicePoint(servicePoint).map(Math.floor);
const serviceCoordinates=[[.990,1],[1.010,1]].map(p=>localServicePoint(p).map((u,i)=>Math.round(4096*(u-[serviceX,serviceY][i]))));
const fixtureServiceMvt=vtPbf.fromGeojsonVt({service_routes:{features:serviceOverlap?[
 {id:88106,type:2,geometry:[serviceCoordinates],tags:{id:'relation-101',kind:'rail',name:'Fixture red overlap',colour:'#ff2020',n:2,i:0,
  group_relation_ids:'[101,102]',segment_relation_ids:'[101]',frequency_am:6,frequency_high_am:6,frequency_width_am:4,frequency_offset_am:-6,frequency_until:fixtureServiceEnd/1000}},
 {id:88107,type:2,geometry:[serviceCoordinates],tags:{id:'relation-211',kind:'rail',name:'Fixture blue overlap',colour:'#0060ff',n:2,i:1,
  group_relation_ids:'[211,212]',segment_relation_ids:'[211]',frequency_am:9,frequency_high_am:9,frequency_width_am:5,frequency_offset_am:6,frequency_until:fixtureServiceEnd/1000}},
]: [{
  id:88106,type:2,geometry:[serviceCoordinates],tags:{name:'Fixture scheduled rail',colour:'#ff2020',n:1,i:0,
    frequency_am:6,frequency_high_am:6,frequency_width_am:8,frequency_offset_am:0,frequency_until:fixtureServiceEnd/1000},
}]}},{version:2,extent:4096});
const facilitySnapshot='/data/traction/power/power-facilities.geojson.gz',
  methodSnapshot='/data/traction/power/power-methods.geojson.gz';
const mapped=(id, type, coordinates, properties)=>({id,type:'Feature',geometry:{type,coordinates},properties});
const packed=features=>gzipSync(JSON.stringify({type:'FeatureCollection',features}));
const ring=(x,y,r)=>[[x-r,y-r],[x+r,y-r],[x+r,y+r],[x-r,y+r],[x-r,y-r]];
const powerFixtureFiles={
 [facilitySnapshot]:packed([
  mapped('way-88103','Polygon',[ring(.985,1.004,.007),ring(.985,1.004,.002).reverse()],
   {osm_type:'way',osm_id:'88103',name:'Fixture power yard',power_kind:'traction_substation',power_state:'present',power_minzoom:10}),
  mapped('node-88104','Point',[1.015,1.010],
   {osm_type:'node',osm_id:'88104',name:'Fixture power marker',power_kind:'traction_substation',power_state:'present',power_minzoom:10}),
 ]),
 [methodSnapshot]:packed([
  mapped('way-88105','LineString',[[.983,.989],[1.017,.989]],
   {osm_type:'way',osm_id:'88105',power_state:'present',power_method:'rail',power_method_label:'Fixture conductor rail',
    method_rail:true,voltage:750,frequency:0}),
 ]),
};
const replacing=new Set(['infrastructure-tracks','context-transport-bus-label','service-routes']);
style.layers=[...style.layers.filter(layer=>!replacing.has(layer.id)&&!fixturePowerSources.has(layer.source))
  .map(layer=>({...layer,metadata:{...layer.metadata,'atlas:semantics-version':1,'atlas:views':['fixture-off']}})),
  {id:'fixture-bg',type:'background',paint:{'background-color':'#02131b'}},
  ...fixturePowerLayers,
  fixtureServiceLayer,
  {id:'infrastructure-tracks',type:'line',source:'entryRail','source-layer':'rail',paint:{'line-color':'#ff0000','line-width':7}},
  {id:'station-fixture-dots',type:'circle',source:'stationFixture','source-layer':'station',metadata:{'atlas:semantics-version':1,'atlas:settings':['stations']},paint:{'circle-color':'#00dc20','circle-radius':6}},
  {id:'fixture-track-names',type:'symbol',source:'entryRail','source-layer':'rail',layout:{
    'text-field':['get','name'],'symbol-placement':'line','text-size':20,'text-offset':[0,-1.2],
  },paint:{'text-color':'#ffff00'}},
  {id:'station-fixture-names',type:'symbol',source:'labelFixture','source-layer':'station',metadata:{'atlas:semantics-version':1,'atlas:settings':['stations']},layout:{
    'text-field':['get','name'],'text-size':18,'text-anchor':'top','text-offset':[0,0.9],
  },paint:{'text-color':'#ff00ff'}},
  {...style.layers.find(layer=>layer.id==='context-transport-bus-label'),
    metadata:{'atlas:semantics-version':1,'atlas:settings':['transport']}},
  {id:'fixture-hidden',type:'line',source:'hiddenRail','source-layer':'rail',metadata:{'atlas:semantics-version':1,'atlas:views':['fixture-off']}},
];
assert.equal(new Set(style.layers.map(layer=>layer.id)).size,style.layers.length,'Fixture layer IDs must be unique');
style.sources.openmaptiles.url='pmtiles://data/nearby-fixture.pmtiles';

// MapLibre clamps the persisted world view to z1. The Firefox z0 fixture
// rail lies north of the 700×440 viewport at z1, despite its tile loading.
// Place the same deterministic rail closer to the equator for this proof.
const bytes=Buffer.from(flatVectorFixture({railY:chromiumSwitch?1600:900,sameNameNeighbour:chromiumSwitch}));
const stationMissingBytes=Buffer.from(flatVectorFixture({railY:1600,sameNameNeighbour:true,missingStation:true}));
let selectionTargetUnavailable=false;
// A single archived bus interchange roughly 90 m from the fixture station.
const nearbyLngLat=[-0.1017,51.501], n=2**14;
const mx=(nearbyLngLat[0]+180)/360*n,my=(1-Math.asinh(Math.tan(nearbyLngLat[1]*Math.PI/180))/Math.PI)/2*n;
const xx=Math.floor(mx),yy=Math.floor(my);
const local=[Math.round((mx-xx)*4096),Math.round((my-yy)*4096)];
const nearbyMvt=vtPbf.fromGeojsonVt({poi:{features:[
  {id:611,type:1,tags:{class:'bus_station',name:'Fixture Bus Interchange'},geometry:[local]},
]}},{version:2,extent:4096});
const varints=values=>Buffer.from(values.flatMap(value=>{
  const out=[];while(value>127){out.push(value%128+128);value=Math.floor(value/128);}
  out.push(value);return out;
}));
function pointArchive(mvt,z,x,y){
  const packed=gzipSync(mvt), dir=varints([1,zxyToTileId(z,x,y),1,packed.length,1]);
  const meta=Buffer.from('{}'), header=Buffer.alloc(127);
  header.write('PMTiles');header[7]=3;
  const begin=127+dir.length,end=begin+meta.length;
  for(const [offset,value] of [[8,127],[16,dir.length],[24,begin],[32,meta.length],[40,end],[48,0],
    [56,end],[64,packed.length],[72,1],[80,1],[88,1]])header.writeBigUInt64LE(BigInt(value),offset);
  header[96]=1;header[97]=1;header[98]=2;header[99]=1;header[100]=z;header[101]=z;
  for(const [offset,value] of [[102,-180],[106,-85],[110,180],[114,85]])header.writeInt32LE(value*1e7,offset);
  return Buffer.concat([header,dir,meta,packed]);
}
const nearbyArchive=pointArchive(nearbyMvt,14,xx,yy);
const stationPOI=vtPbf.fromGeojsonVt({poi:{features:[
  {id:701,type:1,tags:{class:'railway',subclass:'station',name:'Fallback West'},geometry:[[1536,1024]]},
  {id:702,type:1,tags:{class:'railway',subclass:'station',name:'Fallback East'},geometry:[[2560,1024]]},
]}},{version:2,extent:4096});
const fallbackArchive=pointArchive(stationPOI,7,64,64);
const primaryStationMvt=vtPbf.fromGeojsonVt({station:{features:[
  {id:705,type:1,tags:{feature:'station',name:'Primary East'},geometry:[[1024,2048]]},
]}},{version:2,extent:4096});
const neutralRail=pointArchive(vtPbf.fromGeojsonVt({transportation:{features:[
  {id:711,type:2,tags:{class:'rail',subclass:'rail'},geometry:[[[0,1024],[4096,1024]]]},
]}},{version:2,extent:4096}),7,64,64);
const healthyRail=vtPbf.fromGeojsonVt({rail:{features:[
  {id:712,type:2,tags:{feature:'rail'},geometry:[[[0,2368],[4096,2368]]]},
]}},{version:2,extent:4096});
const legendRail=vtPbf.fromGeojsonVt({rail:{features:[
  {id:713,type:2,tags:{feature:'rail',gaugeint0:1435},geometry:[[[0,2368],[4096,2368]]]},
  {id:714,type:2,tags:{feature:'rail',gaugeint0:1067},geometry:[[[0,4000],[4096,4000]]]},
  {id:715,type:2,tags:{feature:'rail',gaugeint0:1000,hidden:true},geometry:[[[0,2200],[4096,2200]]]},
]}},{version:2,extent:4096});
let railFailureFixture='';
let stationFailureFixture='';
const fixtureDepartures=[];
const fixtureDepartureAt=new Date(Date.now()+600_000).toISOString();
const paths=[];
let failStyle=false, useRollbackEntry=false,useElevationFixture=false,missingWebGLAsset=null;
const landPng=terrariumFixturePng(()=>123),seabedPng=terrariumFixturePng(()=>-20);
const historicalPng=terrariumFixturePng(()=>63);
const terrainRequests=[];
const server=createServer((req,res)=>{
  const {pathname}=new URL(req.url,'http://127.0.0.1');
  paths.push(pathname);
  if(pathname==='/') {res.writeHead(200,{'content-type':'text/html'});res.end(useRollbackEntry?rollbackPage:standardPage);}
  else if(missingWebGLAsset && pathname===missingWebGLAsset){res.writeHead(404).end();}
  else if(powerFixtureFiles[pathname]) {res.writeHead(200,{'content-type':'application/gzip'}).end(powerFixtureFiles[pathname]);}
  else if(pathname==='/data/service-routes/frequency-manifest.json')
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({schema:3,profiles:['am']}));
  else if(pathname.startsWith('/fixture-service/')) {
    const hit=pathname===`/fixture-service/${serviceZoom}/${serviceX}/${serviceY}.pbf`;
    res.writeHead(200,{'content-type':'application/x-protobuf'}).end(hit?fixtureServiceMvt:Buffer.alloc(0));
  }
  else if(pathname===fixtureElectricityPath) {res.writeHead(200,{'content-type':'application/gzip'}).end(fixtureElectricitySignals);}
  else if(pathname==='/world.style.json') {
    const payload=railFailureFixture?{
      ...style,
      sources:{...style.sources,entryRail:{type:'vector',url:`${origin}/rail-health.json`,maxzoom:8},
        openmaptiles:{type:'vector',url:'pmtiles://data/rail-reference-fixture.pmtiles',maxzoom:7}},
      layers:[style.layers.find(layer=>layer.id==='fixture-bg'),...style.layers.flatMap(layer=>{
        if(layer.id==='fixture-bg'||layer.id==='fixture-track-names')return [];
        if(layer.id==='rail-basemap-reference')return [{id:layer.id,type:'line',
          source:'openmaptiles','source-layer':'transportation',minzoom:8,
          paint:{'line-color':'#00b0ff','line-width':7}}];
        if(railFailureFixture==='legend'&&layer.id==='gauge-tracks')return [{
          id:layer.id,type:'line',minzoom:8,source:'entryRail','source-layer':'rail',
          metadata:{'atlas:semantics-version':1,'atlas:views':['gauge']},
          paint:{'line-color':'#ff0000','line-width':7,'line-opacity':['case',['boolean',['get','hidden'],false],0,1]},
        }];
        if(layer.id==='infrastructure-tracks')return [{...layer,minzoom:8,
          metadata:{'atlas:semantics-version':1,'atlas:views':['infrastructure']}}];
        return [layer];
      })],
    }:stationFailureFixture?{
      ...style,
      sources:{...style.sources,
        openmaptiles:{type:'vector',url:'pmtiles://data/station-fallback-fixture.pmtiles',maxzoom:7},
        stationMed:{type:'vector',url:`${origin}/station-medium-fixture.json`,maxzoom:7},
        stationMajor:{...style.sources.stationMajor,data:{type:'FeatureCollection',features:[
          {type:'Feature',id:706,geometry:{type:'Point',coordinates:[0.25,-0.25]},
            properties:{feature:'station',tier:'medium',name:'Curated Hub',curated:true}},
        ]}},
        stations:{type:'vector',url:`${origin}/station-failure-tilejson.json`,maxzoom:8}},
      layers:[style.layers.find(layer=>layer.id==='fixture-bg'),...style.layers.filter(layer=>layer.id!=='fixture-bg'),
        ...fixtureRasterBackgrounds.filter(layer=>layer.id==='satellite'),
        {id:'station-primary-health-test',type:'circle',source:'stations','source-layer':'station',
        minzoom:8,metadata:{'atlas:semantics-version':1,'atlas:settings':['stations']},
        paint:{'circle-color':'#00dc20','circle-radius':5}},
        {id:'station-primary-medium-test',type:'circle',source:'stationMed','source-layer':'station',
          minzoom:7,maxzoom:8,metadata:{'atlas:semantics-version':1,'atlas:settings':['stations']},
          paint:{'circle-color':'#00dc20','circle-radius':5}}],
    }:fixtureCredits?{
      ...style,
      sources:{...style.sources,entryRail:{...style.sources.entryRail,attribution:
        'Rail fixture · <a href="https://example.org/rail-credit" title="unused">Provider credit</a>'}},
      layers:[style.layers.find(layer=>layer.id==='fixture-bg'),
        ...style.layers.flatMap(layer=>layer.id==='fixture-bg'?[]:layer.id==='infrastructure-tracks'
          ?[...fixtureRasterBackgrounds,{...layer,metadata:{'atlas:semantics-version':1,'atlas:group':'railway'}}]:[layer])],
    }:style;
    res.writeHead(failStyle?503:200,{'content-type':'application/json'});res.end(failStyle?'{}':JSON.stringify(payload));
  } else if(pathname==='/data/rail-reference-fixture.pmtiles') {
    const r=pmtilesBytesResponse(neutralRail,req.headers.range,'flat-rail-reference-fixture-v1');
    res.writeHead(r.status,r.headers);res.end(r.body);
  } else if(pathname==='/rail-health.json') {
    if(railFailureFixture==='metadata'){res.writeHead(404).end();return;}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({
      minzoom:8,maxzoom:8,tiles:[`${origin}/rail-health/{z}/{x}/{y}.pbf`],
    }));
  } else if(pathname.startsWith('/rail-health/')) {
    if(railFailureFixture==='tile'&&pathname==='/rail-health/8/128/128.pbf'){res.writeHead(404).end();return;}
    res.writeHead(200,{'content-type':'application/x-protobuf'}).end(pathname.endsWith('/129/128.pbf')?(railFailureFixture==='legend'?legendRail:healthyRail):undefined);
  } else if(pathname==='/data/station-fallback-fixture.pmtiles') {
    const r=pmtilesBytesResponse(fallbackArchive,req.headers.range,'flat-station-fixture-v1');
    res.writeHead(r.status,r.headers);res.end(r.body);
  } else if(pathname==='/station-medium-fixture.json') {
    if(stationFailureFixture==='curated'){res.writeHead(404).end();return;}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({
      minzoom:7,maxzoom:7,tiles:[`${origin}/station-medium/{z}/{x}/{y}.pbf`],
    }));
  } else if(pathname.startsWith('/station-medium/')) {
    res.writeHead(200,{'content-type':'application/x-protobuf'}).end();
  } else if(pathname==='/station-failure-tilejson.json') {
    if(stationFailureFixture==='metadata'){res.writeHead(404).end();return;}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({
      minzoom:8,maxzoom:8,tiles:[`${origin}/station-failure/{z}/{x}/{y}.pbf`],
    }));
  } else if(pathname.startsWith('/station-failure/')) {
    if(pathname==='/station-failure/8/128/128.pbf'){res.writeHead(404).end();return;}
    res.writeHead(200,{'content-type':'application/x-protobuf'});
    res.end(pathname==='/station-failure/8/129/128.pbf'?primaryStationMvt:Buffer.alloc(0));
  } else if(pathname==='/data/nearby-fixture.pmtiles') {
    const r=pmtilesBytesResponse(useElevationFixture?oceanFixtureArchive:nearbyArchive,
      req.headers.range,useElevationFixture?'measure-ocean-fixture-v1':'nearby-fixture-v1');
    res.writeHead(r.status,r.headers);res.end(r.body);
  } else if(pathname==='/entry-tilejson.json') {
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({tiles:[railTemplate],minzoom:0,maxzoom:0}));
  } else if(pathname==='/fixture/0/0/0.pbf'||pathname==='/label/0/0/0.pbf') {
    res.writeHead(200,{'content-type':'application/x-protobuf','cache-control':'no-store'});res.end(selectionTargetUnavailable?stationMissingBytes:bytes);
  } else preview(req,res);
});
await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port;
const railTemplate=origin+'/fixture/{z}/{x}/{y}.pbf';
const labelTemplate=origin+'/label/{z}/{x}/{y}.pbf';
style.sources.serviceRoutes={type:'vector',tiles:[origin+'/fixture-service/{z}/{x}/{y}.pbf'],minzoom:serviceZoom,maxzoom:serviceZoom};
style.sources.entryRail={type:'vector',url:origin+'/entry-tilejson.json',maxzoom:0};
style.sources.stationFixture={type:'vector',tiles:[railTemplate],maxzoom:0};
style.sources.labelFixture={type:'vector',tiles:[labelTemplate],maxzoom:0};
style.sources.hiddenRail={type:'vector',tiles:[origin+'/never-request/{z}/{x}/{y}.pbf']};
const proofDir='browser-review/renderer-switch';
let browser;
try {
  browser=chromiumSwitch ? await launchBrowser({executablePath:process.env.CHROMIUM_EXECUTABLE})
    : await firefox.launch({headless:true,executablePath:process.env.FIREFOX_EXECUTABLE,firefoxUserPrefs:{'webgl.disabled':true}});
  const fresh=async (off=false,heights=false,painterFault=false,hasTouch=false)=>{
    const context=await browser.newContext({viewport:{width:700,height:440},deviceScaleFactor:chromiumSwitch?1:3,hasTouch,serviceWorkers:'block'});
    await context.addInitScript(({off,painterFault})=>{
      if(!localStorage.getItem('atlas_view')) localStorage.setItem('atlas_view',JSON.stringify({c:[0,0],z:0,b:0,p:0,g:false,t:false}));
      if(off&&localStorage.getItem('atlas_disable_webgl')===null) localStorage.setItem('atlas_disable_webgl','1');
      window.atlasTestIncomingWork=sessionStorage.getItem('atlas_renderer_work_v1');
      const get=HTMLCanvasElement.prototype.getContext;
      window.webglAttempts=[];
      window.atlasTestPaintContext=null;
      HTMLCanvasElement.prototype.getContext=function(type,...args){
        if(type.startsWith('webgl')) {
          window.webglAttempts.push(type);
          if(painterFault){
            if(!this.matches('canvas.maplibregl-canvas'))return {getExtension:()=>null};
            const a=args[0];
            window.painterAttributes={alpha:a.alpha,depth:a.depth,stencil:a.stencil,premultipliedAlpha:a.premultipliedAlpha};
            this.dispatchEvent(new Event('webglcontextcreationerror'));
            return null;
          }
        }
        const context=get.call(this,type,...args);
        if(type.startsWith('webgl') && this.matches('canvas.maplibregl-canvas') &&
          (context instanceof WebGL2RenderingContext || context instanceof WebGLRenderingContext))
          window.atlasTestPaintContext=context;
        return context;
      };
    },{off,painterFault});
    const page=await context.newPage();
    page.on('pageerror',error=>console.error(error.message));
    page.on('console',msg=>{if(msg.type()==='error') console.error(msg.text());});
    await page.route('**/*',r=>{
      const url=new URL(r.request().url());
      if(url.origin===origin) return r.continue();
      if(fixtureCredits||stationFailureFixture){
        const image={'tiles.maps.eox.at':landPng,'tile.openstreetmap.org':seabedPng,'indianopenmaps.com':historicalPng}[url.hostname];
        if(image) return r.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'image/png',body:image});
      }
      if(heights && url.hostname==='s3.amazonaws.com'){
        const m=/^\/elevation-tiles-prod\/terrarium\/(\d+)\/\d+\/\d+\.png$/.exec(url.pathname);
        if(!m) throw new Error('Unexpected elevation fixture request');
        const z=Number(m[1]);terrainRequests.push(z);
        return r.fulfill({headers:{'access-control-allow-origin':'*'},contentType:'image/png',body:z>10?landPng:seabedPng});
      }
      if(['api.openrailwaymap.org','nominatim.openstreetmap.org'].includes(url.hostname) &&
        url.searchParams.get('q')==='Fixture Station')
        return r.fulfill({status:503,headers:{'access-control-allow-origin':'*'},body:''});
      const json=(rows)=>r.fulfill({status:200,headers:{'access-control-allow-origin':'*'},json:rows});
      if(url.hostname==='api.openrailwaymap.org') return json([
        {osm_id:9001,name:'Demo station',latitude:51.5,longitude:-0.1,railway:'station',operator:'Line One'},
        {osm_id:9003,name:'Demo station',latitude:51.501,longitude:-0.103,railway:'station',operator:'Line Two'},
      ]);
      if(url.hostname==='nominatim.openstreetmap.org') return json([
        {osm_type:'relation',osm_id:9002,name:'Demo town',lat:'51.6',lon:'-0.2',type:'town',
          display_name:'Demo town, Fixture region',boundingbox:['51.55','51.65','-0.25','-0.15']},
      ]);
      if(url.hostname==='api.transitous.org') {
        if(stationFailureFixture!=='tile')return json([]);
        const op=url.pathname.split('/').at(-1);
        fixtureDepartures.push(op);
        const place=(name,stopId)=>({name,stopId,tz:'Etc/UTC',departure:fixtureDepartureAt,arrival:fixtureDepartureAt});
        if(url.pathname==='/api/v6/map/stops'){
          const min=url.searchParams.get('min').split(',').map(Number), max=url.searchParams.get('max').split(',').map(Number);
          assert.ok(min.every(Number.isFinite)&&max.every(Number.isFinite)&&min.every((value,i)=>value<max[i]));
          assert.equal(url.searchParams.get('grouped'),'true');
          assert.ok(url.searchParams.getAll('modes').includes('RAIL'));
          const [lat,lon]=min.map((x,i)=>(x+max[i])/2);
          return json([{stopId:'east-station',name:'Primary East',lat,lon,modes:['REGIONAL_RAIL']}]);
        }
        if(op==='stoptimes'){
          assert.equal(url.searchParams.get('stopId'),'east-station');
          return json({stopTimes:[{mode:'REGIONAL_RAIL',displayName:'R1',headsign:'Fixture Terminus',
            tripId:'canvas-east-trip',realTime:false,place:place('Primary East','east-station')}]});
        }
        assert.equal(op,'trip');
        assert.equal(url.searchParams.get('tripId'),'canvas-east-trip');
        return json({legs:[{mode:'REGIONAL_RAIL',realTime:false,from:place('Previous Station','before'),
          intermediateStops:[place('Primary East','east-station')],to:place('Fixture Terminus','end')}]});
      }
      return r.abort();
    });
    return {page,context};
  };
  const ready=page=>page.waitForFunction(()=>{
    const c=document.querySelector('canvas.atlas-flat-preview');
    if(!c) return false;
    const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    for(let i=0;i<a.length;i+=4) if(a[i]===255&&a[i+1]===0&&a[i+2]===0&&a[i+3]===255) return true;
    return false;
  },null,{timeout:15000});
  // In Chromium, CDP supplies trusted touch pointers and the browser performs
  // real capture/release. Unlike the Firefox DOM fixture, no methods on
  // the canvas or native event ordering are replaced.
  async function trustedCanvasTouch() {
    const {page,context}=await fresh(true,false,false,true);
    const events=()=>page.evaluate(()=>window.atlasTouchEvents);
    const view=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')));
    const center=()=>page.locator('#map').getAttribute('data-flat-center');
    try {
      await page.goto(origin);
      await ready(page);
      const canvas=page.locator('canvas.atlas-flat-preview');
      const bounds=await canvas.boundingBox();
      assert.ok(bounds);
      const x=Math.round(bounds.x+bounds.width*.72),y=Math.round(bounds.y+bounds.height*.58);
      const points=(span,dy=0)=>[{x:x-span,y:y+dy,id:1},{x:x+span,y:y+dy,id:2}];
      assert.equal(await canvas.evaluate((node,args)=>args.every(p=>document.elementFromPoint(p.x,p.y)===node),points(90)),true);
      await canvas.evaluate(node=>{
        window.atlasTouchEvents=[];
        for(const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture','click'])
          node.addEventListener(type,event=>window.atlasTouchEvents.push({
            type, id:event.pointerId, pointerType:event.pointerType, trusted:event.isTrusted,
            captured:node.hasPointerCapture(event.pointerId),
          }),{passive:true});
      });
      const session=await context.newCDPSession(page);
      const dispatch=(type,touchPoints=[])=>session.send('Input.dispatchTouchEvent',{type,touchPoints});
      const initial=await view();
      await dispatch('touchStart',points(45));
      await dispatch('touchMove',points(90));
      await dispatch('touchEnd');
      await page.waitForFunction(z=>Math.abs(JSON.parse(localStorage.getItem('atlas_view')).z-z)<1e-6,initial.z+1);
      await page.waitForFunction(()=>window.atlasTouchEvents.filter(e=>e.type==='lostpointercapture').length===2);
      const zoomed=await view(), committed=await center();
      const first=await events();
      const assertCapture=(trace,end)=>{
        const byType=type=>trace.filter(e=>e.type===type);
        const began=byType('pointerdown');
        assert.equal(began.length,2);
        const ids=began.map(e=>e.id).sort();
        assert.equal(new Set(ids).size,2);
        assert.ok(trace.every(e=>e.trusted&&e.pointerType==='touch'));
        assert.ok(byType('pointermove').length>=2);
        for(const type of ['gotpointercapture',end,'lostpointercapture'])
          assert.deepEqual(byType(type).map(e=>e.id).sort(),ids);
        assert.ok(byType('gotpointercapture').every(e=>e.captured));
        assert.ok(byType('lostpointercapture').every(e=>!e.captured));
        assert.equal(byType('click').length,0);
      };
      assertCapture(first,'pointerup');
      await dispatch('touchStart',points(45));
      await dispatch('touchMove',points(90,34));
      assert.notEqual(await center(),committed);
      assert.deepEqual(await view(),zoomed);
      await dispatch('touchCancel');
      await page.waitForFunction(previous=>document.querySelector('#map').dataset.flatCenter===previous,committed);
      await page.waitForFunction(()=>window.atlasTouchEvents.filter(e=>e.type==='lostpointercapture').length===4);
      const cancelled=(await events()).slice(first.length);
      assertCapture(cancelled,'pointercancel');
      assert.deepEqual(await view(),zoomed);
      assert.equal(await page.getByRole('heading',{name:'Fixture Station'}).isVisible(),false);

      // A subsequent gesture must start normally and commit after cancellation.
      await dispatch('touchStart',points(90));
      await dispatch('touchMove',points(45));
      await dispatch('touchEnd');
      await page.waitForFunction(z=>Math.abs(JSON.parse(localStorage.getItem('atlas_view')).z-z)<1e-6,initial.z);
      const recovered=await view();
      assert.deepEqual(await page.evaluate(()=>window.webglAttempts),[]);
      await page.reload();
      await ready(page);
      assert.deepEqual(await view(),recovered);
      assert.deepEqual(await page.evaluate(()=>window.webglAttempts),[]);
      return {initial,zoomed,recovered,completedEvents:first,cancelledEvents:cancelled};
    } finally {await context.close();}
  }
  async function verifyStartupFallback() {
    const disabled=await fresh();
    try {
      const start=paths.length;
      await disabled.page.goto(origin);
      await ready(disabled.page);
      assert.equal(await disabled.page.locator('#canvas-mode-note').getAttribute('hidden'),null,'the 2D limitation notice must be enabled');
      assert.deepEqual(await disabled.page.evaluate(()=>window.webglAttempts),['webgl2','webgl']);
      assert.ok(!paths.slice(start).some(path=>path.startsWith('/vendor/maplibre-gl-')),
        'browsers with no WebGL must not fetch either renderer asset');
      assert.equal(await disabled.page.evaluate(()=>localStorage.getItem('atlas_disable_webgl')),null);
    } finally {await disabled.context.close();}
    // The narrow fault is at the actual MapLibre canvas, not the startup probe.
    let current=await fresh(false,false,true);
    const start=paths.length;
    await current.page.goto(origin);
    await ready(current.page);
    assert.deepEqual(await current.page.evaluate(()=>window.webglAttempts),['webgl2','webgl2','webgl']);
    assert.deepEqual(await current.page.evaluate(()=>window.painterAttributes),
      {alpha:true,depth:true,stencil:true,premultipliedAlpha:true});
    assert.equal(await current.page.locator('.maplibregl-canvas-container').count(),0,'no partial map DOM');
    assert.equal(await current.page.evaluate(()=>localStorage.getItem('atlas_disable_webgl')),null,'automatic fallback is not a user preference');
    assert.equal(paths.slice(start).filter(path=>path==='/').length,1,'fallback did not reload the page');
    assert.equal(paths.slice(start).filter(path=>path==='/world.style.json').length,1,'shared initialization did not restart');
    assert.match(await current.page.locator('#map-status').textContent(),/the WebGL map could not start/);
    await current.page.locator('canvas.atlas-flat-preview').press('ArrowRight');
    assert.ok(await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')).c[0]>10));
    await current.context.close();

    for(const missing of ['/vendor/maplibre-gl-5.24.0-atlas.4.js','/vendor/maplibre-gl-5.24.0.css']){
      missingWebGLAsset=missing;
      current=await fresh(false,false,true);
      const start=paths.length;
      await current.page.goto(origin);
      await ready(current.page);
      assert.ok(paths.slice(start).includes(missing));
      assert.deepEqual(await current.page.evaluate(()=>window.webglAttempts),['webgl2'],'probe passed, but painter was not attempted');
      assert.match(await current.page.locator('#map-status').textContent(),/the WebGL renderer files could not load/);
      assert.equal(await current.page.evaluate(()=>localStorage.getItem('atlas_disable_webgl')),null);
      await current.context.close();
    }
    missingWebGLAsset=null;

    failStyle=true;
    current=await fresh(false,false,true);
    await current.page.goto(origin);
    await current.page.getByText('The map style could not load. Reload to try again.').waitFor();
    assert.deepEqual(await current.page.evaluate(()=>window.webglAttempts),['webgl2'],'broken shared style never attempts the painter');
    assert.equal(await current.page.locator('canvas.atlas-flat-preview').count(),0);
    await current.context.close();
    failStyle=false;
    // Real fragment history must update an already-mounted Canvas, without
    // reloading or discarding either map link from browser history.
    current=await fresh(true);
    await current.page.goto(origin+'/#9/25.04/121.56/40');
    await current.page.locator('canvas.atlas-flat-preview').waitFor();
    const back='#8/35.68/139.77/-25';
    const forward='#10/22.29/114.16/70';
    const assertView=(hash,center,z,b)=>current.page.waitForFunction(({hash,center,z,b})=>{
      const saved=JSON.parse(localStorage.getItem('atlas_view'));
      return location.hash===hash && saved.z===z && saved.b===b &&
        saved.c.every((n,i)=>Math.abs(n-center[i])<0.000002);
    },{hash,center,z,b});
    await current.page.evaluate(hash=>{location.hash=hash;},back);
    await assertView(back,[139.77,35.68],8,-25);
    await current.page.evaluate(hash=>{location.hash=hash;},forward);
    await assertView(forward,[114.16,22.29],10,70);
    await current.page.goBack();
    await assertView(back,[139.77,35.68],8,-25);
    await current.page.goForward();
    await assertView(forward,[114.16,22.29],10,70);
    // Both ends of the Canvas camera range can be shared. A fragment
    // applied in place must use the same bounds as opening it in a new tab.
    for (const [hash,center,z,b] of [
      ['#-0.5/0/15', [15,0], -.5, 0],
      ['#22/22.29/114.16/70', [114.16,22.29], 22, 70],
    ]) {
      await current.page.evaluate(hash=>{location.hash=hash;},hash);
      await assertView(hash,center,z,b);
      await current.page.reload();
      const boundaryButton=current.page.getByRole('button',{name:z<0?'Zoom out':'Zoom in',exact:true});
      await current.page.waitForFunction(button=>button.disabled,await boundaryButton.elementHandle());
      assert.equal(new URL(current.page.url()).hash,hash);
    }
    // Holding an arrow must not depend on OS key-repeat events. A live
    // fragment replaces the held movement instead of being cleared by it.
    await current.page.goto(origin+'/#8/22/114');
    const keyCanvas=current.page.locator('canvas.atlas-flat-preview');
    await keyCanvas.focus();
    const longitude=()=>current.page.locator('#map').getAttribute('data-flat-center').then(v=>Number(v.split(',')[0]));
    const startLongitude=await longitude();
    await current.page.keyboard.down('ArrowRight');
    const initial=await longitude();
    await current.page.waitForFunction(initial=>+document.querySelector('#map').dataset.flatCenter.split(',')[0]>initial+.2,initial,{timeout:5000});
    await current.page.keyboard.up('ArrowRight');
    const released=await longitude();
    assert.ok(released>startLongitude+.2);
    assert.equal(await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')).c[0]),released);
    await current.page.keyboard.down('ArrowLeft');
    await current.page.waitForFunction(released=>+document.querySelector('#map').dataset.flatCenter.split(',')[0]<released-.1,released,{timeout:5000});
    await current.page.evaluate(hash=>{location.hash=hash;},forward);
    await assertView(forward,[114.16,22.29],10,70);
    await current.page.keyboard.up('ArrowLeft');
    await current.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(new URL(current.page.url()).hash,forward);
    assert.ok(Math.abs(await longitude()-114.16)<.000002);
    await current.context.close();
    useRollbackEntry=true;
    current=await fresh(true);
    await current.page.goto(origin);
    await current.page.getByText('This browser could not start WebGL. Enable graphics acceleration in your browser settings, then reload the map.').waitFor({timeout:15000});
    assert.ok(paths.some(path=>path.includes('/vendor/maplibre-gl-')&&path.endsWith('.js')));
    assert.ok(paths.some(path=>path.includes('/vendor/maplibre-gl-')&&path.endsWith('.css')));
    assert.equal(await current.page.locator('#flat-preview-preference').isVisible(),false);
    assert.equal(await current.page.locator('#canvas-mode-note').getAttribute('hidden'),'');
    assert.equal(await current.page.locator('canvas.atlas-flat-preview').count(),0);
    await current.context.close();
  }
  async function verifyCanvasDesktopParity(){
  // A drag rotates but a stationary secondary click still opens Watch.
  const mouseBearing=await fresh(true);
  try {
    const {page:p}=mouseBearing;
    await p.goto(origin+'/?ui=watch#9/25.04/121.56/40');
    const canvas=p.locator('canvas.atlas-flat-preview'), menu=p.locator('#watch-menu');
    await canvas.waitFor();
    const box=await canvas.boundingBox();
    const x=Math.round(box.x+box.width*.59), y=Math.round(box.y+box.height*.58);
    const view=()=>p.evaluate(()=>localStorage.getItem('atlas_view'));
    const center=()=>p.locator('#map').getAttribute('data-flat-center');
    const originalCenter=await center();
    const startView=await view();
    const drag=async(button,dx)=>{
      await p.mouse.move(x,y);
      await p.mouse.down({button});
      await p.mouse.move(x+dx,y,{steps:4});
    };
    await p.mouse.click(x,y,{button:'right'});
    await menu.waitFor({state:'visible'});
    await p.keyboard.press('Escape');
    await menu.waitFor({state:'hidden'});
    assert.equal(await view(),startView,'stationary secondary click changes no camera state');
    await drag('right',50);
    await p.keyboard.press('Escape');
    await p.mouse.up({button:'right'});
    assert.equal(await view(),startView,'Escape must roll back rotation without persistence');
    assert.equal(await menu.isHidden(),true);
    await drag('right',50);
    await p.mouse.up({button:'right'});
    const right=JSON.parse(await view());
    assert.ok(Math.abs(right.b)<0.001&&right.z===9,'right drag must only change the bearing');
    assert.equal(await center(),originalCenter);
    assert.equal(await menu.isHidden(),true,'no context menu after right drag');
    await p.keyboard.down('Control');
    await drag('left',-50);
    await p.mouse.up();
    await p.keyboard.up('Control');
    const ctrl=JSON.parse(await view());
    assert.ok(Math.abs(ctrl.b-40)<0.001&&ctrl.z===9,'Control-drag must rotate instead of panning');
    assert.equal(await center(),originalCenter);
    assert.equal(await menu.isHidden(),true);
    await p.mouse.click(x,y,{button:'right'});
    await menu.waitFor({state:'visible'});
  } finally {await mouseBearing.context.close();}

  // Native Shift-left drags on the real Canvas entry.
  const boxCase=await fresh(true);
  try {
    const {page:p}=boxCase;
    await p.setViewportSize({width:1200,height:760});
    await p.goto(origin+'/#9/25.04/121.56/40');
    const canvas=p.locator('canvas.atlas-flat-preview'), overlay=p.locator('.atlas-flat-box-zoom');
    await canvas.waitFor();
    const box=await canvas.boundingBox();
    const points=[[.54,.38],[.77,.57]].map(([x,y])=>[
      Math.round(box.x+box.width*x),Math.round(box.y+box.height*y)]);
    for(const point of points) assert.equal(await p.evaluate(([x,y])=>
      document.elementFromPoint(x,y)?.matches('canvas.atlas-flat-preview'),point),true);
    const view=()=>p.evaluate(()=>localStorage.getItem('atlas_view'));
    const initial=await view();
    const drag=async()=>{
      await p.mouse.move(...points[0]);
      await p.keyboard.down('Shift');
      await p.mouse.down();
      await p.mouse.move(...points[1],{steps:5});
      await overlay.waitFor({state:'visible'});
      const drawn=await overlay.boundingBox();
      assert.ok(Math.abs(drawn.x-points[0][0])<1&&Math.abs(drawn.y-points[0][1])<1);
      assert.ok(Math.abs(drawn.width-points[1][0]+points[0][0])<1);
      assert.ok(Math.abs(drawn.height-points[1][1]+points[0][1])<1);
    };
    const release=async()=>{
      await p.mouse.up();
      await p.keyboard.up('Shift');
      await overlay.waitFor({state:'hidden'});
    };
    await drag();
    await p.keyboard.press('Escape');
    await release();
    assert.equal(await view(),initial,'Escape must not move the map');
    await canvas.evaluate(el=>el.addEventListener('pointerdown',e=>window.boxPointer=e.pointerId,{once:true}));
    await drag();
    await canvas.evaluate(el=>el.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.boxPointer})));
    await release();
    assert.equal(await view(),initial,'pointer cancellation must not move the map');
    // Independent Mercator oracle in Node: the deployed entry serves the
    // compiled renderer, not its source modules.
    const angle=40*Math.PI/180, radians=Math.PI/180, world=512*2**9;
    const dx=(points[0][0]+points[1][0]-box.width)/2-box.x;
    const dy=(points[0][1]+points[1][1]-box.height)/2-box.y;
    const xOffset=(dx*Math.cos(angle)-dy*Math.sin(angle))/world;
    const yOffset=(dx*Math.sin(angle)+dy*Math.cos(angle))/world;
    const northing=Math.asinh(Math.tan(25.04*radians))-2*Math.PI*yOffset;
    const expected={
      center:[121.56+360*xOffset, Math.atan(Math.sinh(northing))/radians],
      z:9+Math.log2(Math.min(box.width/(points[1][0]-points[0][0]),box.height/(points[1][1]-points[0][1]))),
    };
    await drag();
    assert.equal(await view(),initial,'preview must not move the camera before release');
    await release();
    const after=JSON.parse(await view());
    assert.ok(Math.abs(after.z-expected.z)<0.001&&after.b===40);
    assert.ok(after.c.every((v,i)=>Math.abs(v-expected.center[i])<0.000002));
    await p.mouse.move(...points[0]);await p.mouse.down();
    await p.mouse.move(...points[1],{steps:5});await p.mouse.up();
    assert.equal(await overlay.isHidden(),true);
    const panned=JSON.parse(await view());
    assert.equal(panned.z,after.z);
    assert.notDeepEqual(panned.c,after.c);
    await p.keyboard.down('Shift');
    await p.mouse.dblclick(...points[0]);
    await p.keyboard.up('Shift');
    assert.ok(Math.abs(JSON.parse(await view()).z-after.z+1)<0.001);
  } finally {await boxCase.context.close();}

  // Inject movement headings through the geolocation callback, and sample the
  // real canvas pixels. Playwright's setGeolocation does not expose heading.
  const directionalLocation=await fresh(true);
  try {
    const {page:p}=directionalLocation;
    await p.addInitScript(()=>{
      Object.defineProperty(navigator,'geolocation',{value:{
        watchPosition(success){window.emitHeading=heading=>success({
          coords:{longitude:0,latitude:0,accuracy:1,heading},
        });return 17;},
        clearWatch(){},
      }});
    });
    await p.goto(origin);
    await ready(p);
    const button=p.getByRole('button',{name:'My location',exact:true});
    const canvas=p.locator('canvas.atlas-flat-preview');
    await button.click();
    const emit=heading=>p.evaluate(async heading=>{
      window.emitHeading(heading);
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    },heading);
    const blue=([x,y])=>{
      const c=document.querySelector('canvas.atlas-flat-preview'), density=c.width/c.clientWidth;
      const d=c.getContext('2d').getImageData(c.width/2+x*density,c.height/2+y*density,1,1).data;
      return d[0]===21&&d[1]===118&&d[2]===229&&d[3]===255;
    };
    await emit(0);
    await p.waitForFunction(blue,[0,-15]);
    await emit(90);
    await p.waitForFunction(blue,[15,0]);
    assert.equal(await p.evaluate(blue,[0,-15]),false);
    for(let i=0;i<6;i++)await canvas.press('Shift+ArrowRight');
    await p.waitForFunction(blue,[0,-15]);
    assert.equal(await p.evaluate(blue,[15,0]),false);
    await emit(null);
    assert.equal(await p.evaluate(blue,[0,-15]),false,'missing heading must remove the arrow');
    assert.equal(await p.evaluate(blue,[0,0]),true,'missing heading must keep the fix marker');
    await emit(360);
    assert.equal(await p.evaluate(blue,[0,-15]),false,'out-of-range headings must not draw');
    if(await button.getAttribute('data-location-state')==='paused') await button.click();
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'),'false');
  } finally {await directionalLocation.context.close();}

  }
  if(desktopParity){
    await verifyCanvasDesktopParity();
    console.log('Native Canvas desktop parity: mouse bearing, Watch context menu, box zoom and location heading');
  } else if(watchDoubleTap){
    assert.equal(chromiumSwitch,true,'Native touch gate uses Chromium CDP');
    for(const off of [false,true]){
      const {page,context}=await fresh(off,false,false,true);
      try{
        await page.goto(origin+'/?ui=watch#9/25.04/121.56');
        const canvas=page.locator(off?'canvas.atlas-flat-preview':'canvas.maplibregl-canvas');
        await canvas.waitFor();
        if(!off)await page.waitForSelector('body[data-map-ready=true]',{state:'attached',timeout:16000});
        const menu=page.locator('#watch-menu'), box=await canvas.boundingBox();
        const pt={x:Math.round(box.x+box.width*.62),y:Math.round(box.y+box.height*.61),id:1};
        assert.equal(await canvas.evaluate((c,p)=>document.elementFromPoint(p.x,p.y)===c,pt),true);
        const client=await context.newCDPSession(page);
        const send=(type,touchPoints=[])=>client.send('Input.dispatchTouchEvent',{type,touchPoints});
        const tap=async()=>{await send('touchStart',[pt]);await send('touchEnd');};
        const read=async()=>page.evaluate(async ({off,box,pt})=>{
          if(!off){
            const {map}=await import(document.querySelector('script[type=module]').src);
            const anchor=map.unproject([pt.x-box.x,pt.y-box.y]);
            return {z:map.getZoom(),anchor:[anchor.lng,anchor.lat],moving:map.isMoving()};
          }
          const v=JSON.parse(localStorage.getItem('atlas_view'));
          const current=v.z>=9?v:{z:9,c:[121.56,25.04]};
          const scale=512*2**current.z, x=pt.x-box.x-box.width/2, y=pt.y-box.y-box.height/2;
          const b=(current.b??0)*Math.PI/180,c=Math.cos(b),s=Math.sin(b);
          return {z:current.z,anchor:[current.c[0]+360*(x*c-y*s)/scale,
            Math.atan(Math.sinh(Math.asinh(Math.tan(current.c[1]*Math.PI/180))-2*Math.PI*(x*s+y*c)/scale))*180/Math.PI]};
        },{off,box,pt});
        const before=await read();
        assert.equal(before.z,9);
        // Browser-native input; do not emit a DOM dblclick or override events.
        await tap();await tap();
        await page.waitForTimeout(650);
        const after=await read();
        console.log(JSON.stringify({renderer:off?'Canvas':'WebGL',before,after}));
        assert.ok(Math.abs(after.z-before.z-1)<0.02,(off?'Canvas':'WebGL')+' trusted double tap should add exactly one zoom level');
        assert.ok(after.anchor.every((v,i)=>Math.abs(v-before.anchor[i])<0.00006),'zoom must keep the off-center geographic anchor');
        assert.equal(await menu.isHidden(),true);
        assert.equal(await page.locator('#details').isHidden(),true);
        if(off)assert.deepEqual(await page.evaluate(()=>window.webglAttempts),[]);
        await tap();await page.waitForTimeout(450);
        assert.equal((await read()).z,after.z,'single tap must not zoom');
        await send('touchStart',[pt]);
        await menu.waitFor({timeout:2200});
        await send('touchEnd');
        await page.keyboard.press('Escape');
        assert.equal(await menu.isHidden(),true,'touch hold must still open the Watch menu');
        assert.equal((await read()).z,after.z,'touch hold must not zoom');
        const bearing=() => page.evaluate(async off=>{
          if(off)return JSON.parse(localStorage.getItem('atlas_view')).b;
          const {map}=await import(document.querySelector('script[type=module]').src);
          return map.getBearing();
        },off);
        const b0=await bearing(), twist=(angle)=>Array.from({length:2},(_,i)=>{
          const sign=i===0?-1:1;
          return {x:Math.round(pt.x+sign*85*Math.cos(angle)),y:Math.round(pt.y+sign*85*Math.sin(angle)),id:i+1};
        });
        await send('touchStart',twist(0));
        for(const angle of [0.15,0.30,0.50,0.75])await send('touchMove',twist(angle));
        await send('touchEnd');
        await page.waitForTimeout(650);
        const turned=await read(), b1=await bearing();
        console.log(JSON.stringify({twist:off?'Canvas':'WebGL',initialBearing:b0,finalBearing:b1,zoom:turned.z,anchor:turned.anchor}));
        assert.ok(b1-b0 < -20,'a clockwise two-finger twist must rotate the map clockwise');
        assert.ok(Math.abs(turned.z-after.z)<0.04,'a near-constant span should not materially zoom');
        if(off)assert.ok(turned.anchor.every((v,i)=>Math.abs(v-after.anchor[i])<0.00006),'Canvas twist should preserve the midpoint anchor');
        assert.equal(await menu.isHidden(),true,'two-finger twist must not open Watch controls');
      }finally{await context.close();}
    }
  } else if(doubleClickZoom){
    const {context,page}=await fresh(true);
    await page.setViewportSize({width:1200,height:760});
    try{
      await page.goto(origin+'/?detail=1#10/25.04/121.56');
      const canvas=page.locator('canvas.atlas-flat-preview');
      await canvas.waitFor();
      const box=await canvas.boundingBox();
      const positions=[[.60,.36],[.71,.44],[.66,.51]].map(([x,y])=>[
        Math.round(box.x+x*box.width),Math.round(box.y+y*box.height)]);
      for(const at of positions)assert.ok(await page.evaluate(([x,y])=>
        document.elementFromPoint(x,y)?.matches('canvas.atlas-flat-preview'),at));
      const view=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')||'null'));
      const zoom=async expected=>page.waitForFunction(expected=>
        JSON.parse(localStorage.getItem('atlas_view')||'null')?.z===expected,expected,{timeout:3000});
      const mercator=lat=>Math.asinh(Math.tan(lat*Math.PI/180));
      const underPointer=(v,[x,y])=>{
        const scale=512*2**v.z;
        return [v.c[0]+360*(x-box.x-box.width/2)/scale,
          mercator(v.c[1])-2*Math.PI*(y-box.y-box.height/2)/scale];
      };
      const at=positions[0];
      const start={z:9,c:[121.56,25.04]};
      const anchor=underPointer(start,at);
      const compare=async expected=>{
        await zoom(expected);
        const actual=underPointer(await view(),at);
        assert.ok(Math.abs(actual[0]-anchor[0])<0.00002&&Math.abs(actual[1]-anchor[1])<0.0000004,
          'Location under the off-center pointer must stay fixed: '+JSON.stringify({anchor,actual}));
      };
      await page.mouse.dblclick(...at);
      await compare(10);
      await page.keyboard.down('Shift');
      await page.mouse.dblclick(...at);
      await page.keyboard.up('Shift');
      await compare(9);
      await page.getByRole('button',{name:'Measure',exact:true}).click();
      await page.mouse.click(...positions[1]);
      await page.mouse.dblclick(...positions[2]);
      await page.waitForFunction(()=>/Distance: .+ over 1 segment\./.test(document.querySelector('#measure-status').textContent));
      assert.equal((await view()).z,9,'Double-click must finish the distance instead of zooming');
      await page.locator('#measure-close').click();
      await page.getByRole('button',{name:'Drawing tools',exact:true}).click();
      await page.locator('[data-draw="line"]').click();
      await page.mouse.click(...positions[1]);
      await page.mouse.dblclick(...positions[2]);
      const line=await page.waitForFunction(()=>JSON.parse(localStorage.getItem('openrailwayatlas-drawing')||'null')
        ?.features.find(f=>f.geometry.type==='LineString')?.geometry).then(h=>h.jsonValue());
      assert.equal(line.coordinates.length,2);
      assert.equal((await view()).z,9,'Double-click must finish the drawing instead of zooming');
      console.log('Canvas: double-click +1 / Shift-double-click -1 at fixed geographic anchor; distance and line finished without zoom.');
    }finally{await context.close();}
  } else if(toolbarClearance){
    const {context,page}=await fresh(!chromiumSwitch);
    try{
      await page.setViewportSize({width:1100,height:760});
      await page.goto(origin+'/#8/25.04/121.56');
      const canvas=page.locator(chromiumSwitch?'canvas.maplibregl-canvas':'canvas.atlas-flat-preview');
      await canvas.waitFor();
      if(chromiumSwitch)await page.waitForSelector('body[data-map-ready=true]',{timeout:20000,state:'attached'});
      const panel=page.getByRole('complementary',{name:'Map controls'});
      if(!await page.locator('#settings-open').isVisible())await page.locator('#controls-open').click();
      assert.ok(await panel.isVisible());
      await page.getByTitle('Drawing tools',{exact:true}).click();
      const point=page.locator('[data-draw="point"]');
      const toolbar=page.locator('#draw-toolbar');
      const other=chromiumSwitch?'.maplibregl-ctrl-top-right':'.atlas-flat-tool-buttons';
      for(const width of [1100,1001,1240,1320]){
        await page.setViewportSize({width,height:760});
        const rects=await page.evaluate(other=>{
          const rect=q=>document.querySelector(q).getBoundingClientRect();
          const g=rect('#draw-toolbar'),p=rect('.panel'),r=rect(other);
          const at=rect('[data-draw="point"]'),hit=document.elementFromPoint((at.left+at.right)/2,(at.top+at.bottom)/2);
          return {left:g.left,right:g.right,panel:p.right,tools:r.left,point:hit?.closest('[data-draw]')?.dataset.draw};
        },other);
        assert.equal(rects.point,'point',width+' px: '+JSON.stringify(rects));
        assert.ok(rects.left>=rects.panel+4&&rects.right<=rects.tools-4,width+' px: '+JSON.stringify(rects));
        await point.click();
        assert.equal(await point.getAttribute('aria-pressed'),'true');
        await toolbar.locator('[data-draw="line"]').click();
      }
      await point.click();
      const bounds=await canvas.boundingBox();
      await page.mouse.click(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
      const geo=await page.waitForFunction(()=>JSON.parse(localStorage.getItem('openrailwayatlas-drawing')||'null')
        ?.features[0]?.geometry.coordinates).then(r=>r.jsonValue());
      assert.ok(Math.abs(geo[0]-121.56)<0.002&&Math.abs(geo[1]-25.04)<0.002);
      if(!chromiumSwitch){
        await page.setViewportSize({width:700,height:440});
        await toolbar.locator('[data-draw="line"]').click();
        await toolbar.locator('#draw-dash').selectOption('dashed');
        const narrow=await page.evaluate(()=>{
          const map=document.querySelector('#map').getBoundingClientRect();
          const x=map.left+map.width/2-18,y=map.top+105;
          const target=document.elementFromPoint(x,y);
          return {x,y,canvas:target?.tagName==='CANVAS',target:target?.className};
        });
        assert.equal(narrow.canvas,true,'Narrow drawing area retained: '+JSON.stringify(narrow));
        console.log('700 px × 440 px: drawing toolbar does not cover the upper map interaction point.');
      }
      console.log('Point and Line clickable with expanded sidebar at 1001, 1100, 1240 and 1320 px; verified first saved point in '+(chromiumSwitch?'Chromium WebGL':'Firefox Canvas'));
    }finally{await context.close();}
  } else if(detailState){
    const {context,page}=await fresh(false);
    await page.setViewportSize({width:1320,height:760});
    try{
      await page.addInitScript(()=>{
        Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.copiedMap=value;}}});
      });
      const canvas=page.locator('canvas.atlas-flat-preview');
      const view=async()=>page.evaluate(()=>{
        const map=document.querySelector('#map'),rect=map.getBoundingClientRect();
        return {width:map.clientWidth,visualWidth:rect.width,height:map.clientHeight,visualHeight:rect.height,
          center:map.dataset.flatCenter?.split(',').map(Number),scale:document.querySelector('.atlas-flat-scale')?.getBoundingClientRect().width};
      });
      const settingsPanel=async()=>{
        if(!await page.locator('#settings-open').isVisible())await page.locator('#controls-open').click();
        await page.locator('#settings-open').click();
      };
      const switchRenderer=async()=>{
        await settingsPanel();await Promise.all([page.waitForEvent('load'),page.locator('#disable-webgl').click()]);
      };
      if(chromiumSwitch){
        await page.goto(origin+'/#8/25.04/121.56');
        await page.waitForSelector('body[data-map-ready=true]',{timeout:20000,state:'attached'});
        const detail=page.getByRole('button',{name:/More detail:/});
        await detail.click();await detail.click();
        await page.waitForFunction(()=>document.querySelector('#map').classList.contains('detail-2'));
        await switchRenderer();
      }else await page.goto(origin+'/?detail=2&terrain3d=1#10/25.04/121.56/0/35');
      await canvas.waitFor();
      const size=await view();
      const box=await canvas.boundingBox(),draw=page.getByRole('button',{name:'Drawing tools',exact:true});
      await draw.click();await page.locator('[data-draw="point"]').click();
      const at=[box.x+box.width/2,box.y+box.height/2];
      assert.equal(await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.classList.contains("atlas-flat-preview"),at),true);
      await page.mouse.click(...at);
      const vertex=await page.waitForFunction(()=>JSON.parse(localStorage.getItem('openrailwayatlas-drawing')||'null')
        ?.features[0]?.geometry.coordinates).then(handle=>handle.jsonValue());
      console.log(JSON.stringify({size,vertex,tools:(await draw.boundingBox()).width}));
      assert.ok(Math.abs(vertex[0]-121.56)<0.002&&Math.abs(vertex[1]-25.04)<0.002,'center click must draw at the displayed center');
      assert.equal(size.width,size.visualWidth);
      assert.equal(size.height,size.visualHeight);
      assert.ok(size.scale>25&&(await draw.boundingBox()).width>25);
      if(!await page.locator('#share').isVisible())await page.locator('#controls-open').click();
      await page.locator('#share').click();
      const copied=new URL(await page.waitForFunction(()=>window.copiedMap).then(r=>r.jsonValue()));
      assert.equal(copied.hash,'#10/25.04/121.56');
      assert.equal(copied.searchParams.get('terrain3d'),'0');
      assert.equal(copied.searchParams.get('detail'),'2');
      assert.equal(await page.evaluate(()=>JSON.parse(decodeURIComponent(/(?:^|; )atlas_settings=([^;]+)/.exec(document.cookie)[1])).detail),2);
      if(chromiumSwitch){
        await switchRenderer();
        await page.waitForSelector('body[data-map-ready=true]',{timeout:20000,state:'attached'});
        assert.equal(await page.locator('#map').evaluate(el=>el.classList.contains('detail-2')),true);
        const restored=await page.evaluate(async()=>{
          const {map}=await import(document.querySelector('script[type=module]').src);
          return {zoom:map.getZoom(),lng:map.getCenter().lng,lat:map.getCenter().lat};
        });
        assert.ok(Math.abs(restored.zoom-10)<0.02&&Math.abs(restored.lng-121.56)<0.002&&Math.abs(restored.lat-25.04)<0.002);
      }
      if(!chromiumSwitch){
        const recipient=await fresh(false);
        try{
          await recipient.page.goto(copied.href);
          await recipient.page.getByRole('button',{name:/More detail: highest tile detail/}).waitFor();
          const received=await recipient.page.locator('#map').getAttribute('data-flat-center');
          assert.deepEqual(received.split(',').map(n=>Number(Number(n).toFixed(5))),[121.56,25.04]);
        }finally{await recipient.context.close();}
      }
      console.log('Detail state: center drawing and actual flat share correct; setting preserved'+(chromiumSwitch?' across WebGL round trip':' on opening a WebGL link'));
    }finally{await context.close();}
  } else if(startupFallback){
    assert.equal(chromiumSwitch,false,'This gate requires Firefox with WebGL disabled');
    await verifyStartupFallback();
    console.log('Firefox startup: no context, refused painter, missing JS, missing CSS, shared style error and rollback entry verified');
  } else if(watchFocus){
    const {page,context}=await fresh(!chromiumSwitch,chromiumSwitch,false,chromiumSwitch);
    try {
      await page.goto(origin+'/?ui=watch');
      const selector=chromiumSwitch?'canvas.maplibregl-canvas':'canvas.atlas-flat-preview';
      const canvas=page.locator(selector),menu=page.locator('#watch-menu');
      if(chromiumSwitch)await page.waitForSelector('body[data-map-ready=true]',{state:'attached',timeout:10000});
      else await ready(page);
      const focused=()=>page.evaluate(s=>document.activeElement?.matches(s)===true,selector);
      const closed=async()=>{
        assert.equal(await menu.isHidden(),true);
        assert.equal(await page.locator('#map-frame').evaluate(e=>e.inert),false);
        assert.equal(await focused(),true,'closing Watch controls must focus the active renderer canvas');
      };
      const open=async()=>{
        await page.keyboard.press('Shift+F10');
        await menu.waitFor({timeout:3500});
        assert.equal(await page.locator('#map-frame').evaluate(e=>e.inert),true);
        assert.equal(await menu.getByLabel('Railway view').evaluate(e=>e===document.activeElement),true);
      };
      await canvas.focus();
      await open();
      await page.keyboard.press('Escape');
      await closed();
      if(!chromiumSwitch){
        const original=await page.locator('#map').getAttribute('data-flat-center');
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(before=>document.querySelector('#map').dataset.flatCenter!==before,original,{timeout:3500});
      }
      await open();
      await menu.getByRole('button',{name:'Map',exact:true}).click();
      await closed();
      await open();
      await menu.getByLabel('Map options').selectOption('layers');
      const stations=menu.getByRole('button',{name:'Stations',exact:true});
      const before=await stations.getAttribute('aria-pressed');
      await stations.click();
      await closed();
      await open();
      await menu.getByLabel('Map options').selectOption('layers');
      assert.equal(await menu.getByRole('button',{name:'Stations',exact:true}).getAttribute('aria-pressed'),String(before!=='true'));
      await page.keyboard.press('Escape');
      await closed();
      if(chromiumSwitch){
        const box=await canvas.boundingBox(),client=await context.newCDPSession(page);
        const pt={x:Math.round(box.x+box.width*.6),y:Math.round(box.y+box.height*.55)};
        await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[pt]});
        await menu.waitFor({timeout:2200});
        await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        await page.keyboard.press('Escape');
        await closed();
      }else assert.deepEqual(await page.evaluate(()=>window.webglAttempts),[]);
      console.log('Watch controls restore keyboard focus after Escape, Map, and layer choice in '+(chromiumSwitch?'Chromium WebGL; native touch hold still opens them.':'Firefox Canvas; arrow pan and keyboard reopen work without WebGL.'));
    } finally {await context.close();}
  } else if(serviceOverlap){
   const service=await fresh(true),p=service.page;
   try {
    await p.clock.install({time:fixtureServiceStart});
    await p.goto(origin+'/?mode=service&serviceWidth=frequency&frequencyPeriod=peak&peakPhase=am#12/1/1');
    const canvas=p.locator('canvas.atlas-flat-preview');await canvas.waitFor();
    const stripes=()=>{
     const c=document.querySelector('.atlas-flat-preview'),scale=c.width/c.clientWidth,ctx=c.getContext('2d');
     const red=[],blue=[];
     for(let y=200;y<240;y++){
      const [r,g,b]=ctx.getImageData(Math.round(c.width/2),Math.round(y*scale),1,1).data;
      if(r>220&&g<60&&b<80)red.push(y);if(b>220&&g>60&&g<130&&r<50)blue.push(y);
     }
     return red.length&&blue.length?[red[Math.floor(red.length/2)],blue[Math.floor(blue.length/2)]]:null;
    };
    await p.waitForFunction(stripes);
    const selected=await p.evaluate(stripes);
    assert.ok(Math.abs(selected[0]-selected[1])>=5);
    if(await p.locator('#collapse').isVisible())await p.locator('#collapse').click();
    for(const [i,name,frequency,id] of [[0,'Fixture red overlap',6,101],[1,'Fixture blue overlap',9,211]]){
     await canvas.click({position:{x:350,y:selected[i]}});
     await p.getByRole('heading',{name,exact:true}).waitFor({timeout:5000});
     await p.getByText(frequency+'/h/direction (scheduled)',{exact:true}).waitFor();
     assert.equal(await p.locator('#detail-content [data-relation-scope="segment"] a').getAttribute('href'),'https://www.openstreetmap.org/relation/'+id);
     await p.locator('#details-close').click();
    }
    assert.deepEqual(await p.evaluate(()=>window.webglAttempts),[]);
    console.log('PASS: two services sharing the same track paint as separate stripes and select the correct routes, schedules and segment relations in no-WebGL Firefox.');
   } finally {await service.context.close();}
  } else if(chromiumSwitch){
    await mkdir(proofDir,{recursive:true});
    const {page,context}=await fresh(false,true);
    const canvas=kind=>page.locator(kind==='webgl'?'canvas.maplibregl-canvas':'canvas.atlas-flat-preview');
    const frames=[];
    const painted=async (kind, phase)=>{
      const c=canvas(kind);
      await c.waitFor({timeout:15000});
      if(kind==='webgl') await page.waitForFunction(()=>window.atlasTestPaintContext &&
        !window.atlasTestPaintContext.isContextLost(),null,{timeout:15000});
      else {
        await ready(page);
        assert.equal(await page.locator('canvas.maplibregl-canvas').count(),0);
        assert.deepEqual(await page.evaluate(()=>window.webglAttempts),[]);
      }
      const end=Date.now()+15000;
      let shot;
      do {
        shot=await c.screenshot({timeout:4000});
        const seen=await page.evaluate(async png=>{
          const b=await createImageBitmap(await (await fetch('data:image/png;base64,'+png)).blob());
          const probe=new OffscreenCanvas(b.width,b.height).getContext('2d');
          probe.drawImage(b,0,0);
          const rgba=probe.getImageData(0,0,b.width,b.height).data;
          let pixels=0;
          for(let i=0;i<rgba.length;i+=4)
            if(rgba[i]>=244&&rgba[i+1]<18&&rgba[i+2]<18&&rgba[i+3]===255) pixels++;
          return pixels;
        },shot.toString('base64'));
        if(seen>32){
          await writeFile(proofDir+'/'+phase+'.png',shot);
          const gl=await page.evaluate(()=>{
            const c=window.atlasTestPaintContext;
            if(!c)return null;
            const ext=c.getExtension('WEBGL_debug_renderer_info');
            return ext?c.getParameter(ext.UNMASKED_RENDERER_WEBGL):c.getParameter(c.RENDERER);
          });
          frames.push({phase,renderer:kind,gl,railPixels:seen});
          return;
        }
      }while(Date.now()<end);
      await writeFile(proofDir+'/'+phase+'-missing-rail.png',shot);
      throw new Error('Synthetic red railway was not painted by '+kind+' in '+phase);
    };
    const clickMap=async(kind,x,y)=>{
      const box=await canvas(kind).boundingBox();
      const point=[Math.round(box.x+box.width*x),Math.round(box.y+box.height*y)];
      const target=await page.evaluate(([left,top])=>{
        const node=document.elementFromPoint(left,top);
        return node?{tag:node.tagName,id:node.id,className:node.getAttribute('class')}:null;
      },point);
      assert.match(target?.className||'',kind==='webgl'?/maplibregl-canvas/:/atlas-flat-preview/,
        'Map click '+point.join(',')+' hit '+JSON.stringify(target));
      await page.mouse.click(...point);
    };
    const switchMode=async off=>{
      if(!(await page.locator('#settings-open').isVisible()))await page.locator('#controls-open').click();
      await page.locator('#settings-open').click();
      const toggle=page.locator('#disable-webgl');
      assert.equal(await toggle.isChecked(),!off);
      await Promise.all([page.waitForEvent('load'),toggle.click()]);
      assert.equal(await page.locator('#disable-webgl').isChecked(),off);
    };
    const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('openrailwayatlas-drawing')||'{"features":[]}'));
    const incoming=()=>page.evaluate(()=>JSON.parse(window.atlasTestIncomingWork));
    const consumed=()=>page.evaluate(()=>sessionStorage.getItem('atlas_renderer_work_v1')===null);
    // Compare actual computed browser geometry and artwork, not just the
    // availability of equivalent commands. The standard renderer is the
    // reference; only the two genuinely WebGL-only buttons are excluded.
    const controlGeometry=async()=>{
      await page.waitForFunction(()=>document.querySelectorAll('.maplibregl-ctrl-top-right .maplibregl-ctrl-group button:not(#terrain-toggle):not(#globe-toggle)').length===7 &&
        document.querySelector('.maplibregl-ctrl-attrib-button'));
      return page.evaluate(()=>{
        const signature=(el)=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {
          x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),
          background:s.backgroundColor,border:s.borderTopWidth,radius:s.borderRadius,
          font:s.fontSize,icon:el.querySelector('.maplibregl-ctrl-icon')?
            getComputedStyle(el.querySelector('.maplibregl-ctrl-icon')).backgroundImage:null,
          label:el.querySelector('.maplibregl-ctrl-icon')?null:el.textContent,
        };};
        const groups=Array.from(document.querySelectorAll('.maplibregl-ctrl-top-right .maplibregl-ctrl-group'),g=>{
          const s=getComputedStyle(g);
          return {background:s.backgroundColor,radius:s.borderRadius,shadow:s.boxShadow,
            buttons:Array.from(g.querySelectorAll('button:not(#terrain-toggle):not(#globe-toggle)'),signature)};
        });
        const info=document.querySelector('.maplibregl-ctrl-attrib-button');
        const credit=signature(info);
        // The summary's hidden accessible name is not visual content.
        credit.label=null;credit.icon=getComputedStyle(info).backgroundImage;
        return {groups,credit};
      });
    };
    try {
      await context.grantPermissions(['geolocation'],{origin});
      await page.goto(origin);
      await painted('webgl','before');
      const standardControls=await controlGeometry();
      assert.deepEqual(standardControls.groups.map(g=>g.buttons.length),[1,2,1,3]);
      for(const group of standardControls.groups.slice(0,3))for(const button of group.buttons)assert.notEqual(button.icon,'none');
      const stationLink=id=>page.locator(`#detail-content a[href="https://www.openstreetmap.org/node/${id}"]`);
      const stationPoint=await page.waitForFunction(async()=>{
        const {map}=await import(document.querySelector('script[type=module]').src);
        const features=map.queryRenderedFeatures().filter(f=>f.layer?.id==='station-fixture-dots');
        const match=features.find(f=>f.id===7), neighbour=features.find(f=>f.id===8);
        if(!match||neighbour?.properties.name!==match.properties.name)return null;
        const p=map.project(match.geometry.coordinates),r=map.getCanvas().getBoundingClientRect();
        const x=p.x+r.x-5,y=p.y+r.y;
        return document.elementFromPoint(x,y)===map.getCanvas()?{point:[x,y],neighbour:neighbour.geometry.coordinates}:null;
      },null,{timeout:9000});
      const originalStationPoint=await stationPoint.jsonValue();
      await page.mouse.click(...originalStationPoint.point);
      await stationLink(7).waitFor({timeout:7000}).catch(async e=>{console.error('Initial station inspector',await page.locator('#detail-content').textContent(),await page.locator('#detail-content a').evaluateAll(links=>links.map(a=>a.href)));throw e;});
      await switchMode(true);
      await painted('canvas','selection-canvas');
      assert.deepEqual(await controlGeometry(),standardControls,'Canvas controls match standard mode position, size, grouping, style and icons');
      assert.equal(await page.locator('#terrain-toggle,#globe-toggle').count(),0);
      console.log('PASS: Canvas and standard control layout and artwork match; only globe and 3D terrain are unavailable.');
      await stationLink(7).waitFor({timeout:7000});
      assert.equal(await stationLink(8).count(),0);
      assert.equal(await consumed(),true);
      await switchMode(false);
      await painted('webgl','selection-webgl');
      await stationLink(7).waitFor({timeout:7000});
      assert.equal(await stationLink(8).count(),0);
      selectionTargetUnavailable=true;
      await switchMode(true);
      await painted('canvas','selection-target-missing');
      assert.equal(await consumed(),true);
      assert.equal(await page.locator('#details').evaluate(el=>el.hidden),true);
      // The nearby identically named decoy remains selectable. A new user
      // click cancels the unresolved handoff instead of reopening old content.
      await page.waitForTimeout(350);
      assert.equal(await page.locator('#details').evaluate(el=>el.hidden),true);
      const decoy=await page.evaluate(async location=>{
        const c=document.querySelector('canvas.atlas-flat-preview'),r=c.getBoundingClientRect();
        const v=JSON.parse(localStorage.getItem('atlas_view'));
        const {flatCamera}=await import(new URL('flat-camera.mjs',document.querySelector('script[type=module]').src));
        const [x,y]=flatCamera({center:v.c,zoom:v.z,width:r.width,height:r.height,bearing:v.b??0}).project(location);
        const spot=[r.left+x,r.top+y];
        if(document.elementFromPoint(...spot)!==c)throw new Error('Neighbour click is not over the Canvas');
        return spot;
      },originalStationPoint.neighbour);
      await page.mouse.click(...decoy);
      await stationLink(8).waitFor({timeout:7000});
      assert.equal(await stationLink(7).count(),0);
      await page.locator('#details-close').click();
      selectionTargetUnavailable=false;
      await switchMode(false);
      await painted('webgl','before-draft-tests');
      console.log('The exact station reopened in both renderers; a missing target did not reopen a same-name neighbour.');
      await page.getByTitle('Drawing tools',{exact:true}).click();
      await page.locator('[data-draw="line"]').click();
      await page.locator('#draw-dash').selectOption('dotted');
      // The compact toolbars cover the centre of this viewport.
      await clickMap('webgl',.14,.42);await clickMap('webgl',.84,.44);
      assert.equal((await saved()).features.length,0);
      await switchMode(true);
      await painted('canvas','after-canvas');
      assert.equal((await incoming()).drawing.points.length,2);
      assert.equal(await consumed(),true);
      assert.equal(await page.locator('[data-draw="line"]').getAttribute('aria-pressed'),'true');
      assert.equal(await page.locator('#draw-dash').inputValue(),'dotted');
      assert.equal((await saved()).features.length,0);
      await clickMap('canvas',.15,.56);
      await page.locator('#draw-finish').click();
      const finished=await saved();
      assert.equal(finished.features.length,1);
      assert.equal(finished.features[0].geometry.coordinates.length,3);
      assert.equal(finished.features[0].properties.dash,'dotted');

      await page.getByRole('button',{name:'Measure',exact:true}).click();
      await clickMap('canvas',.14,.52);await clickMap('canvas',.84,.46);
      const status=page.locator('#measure-status');
      // While pointing at the map, status also counts a live cursor segment.
      // The handoff below must contain only the two committed vertices.
      assert.equal(await page.locator('#measure-finish').isEnabled(),true);
      await switchMode(false);
      await painted('webgl','after-webgl');
      const transferred=(await incoming()).measurement;
      assert.equal(transferred.mode,'distance');
      assert.equal(transferred.points.length,2);
      assert.equal(transferred.ended,false);
      assert.equal(await consumed(),true);
      assert.match(await status.textContent(),/over 1 segment · double-click to end/);
      assert.deepEqual(await saved(),finished);
      await clickMap('webgl',.15,.61);
      await page.locator('#measure-finish').click();
      assert.match(await status.textContent(),/over 2 segments\./);
      assert.equal(await page.locator('#measure-finish').isDisabled(),true);
      const trustedTouch=await trustedCanvasTouch();
      await writeFile(proofDir+'/result.json',JSON.stringify({frames,drawingVertices:3,measurementSegments:2,trustedTouch},null,2));
      console.log('Chromium renderer switch passed: WebGL → Canvas → WebGL; captured railway pixels and finished both drafts.');
    } catch(error) {
      await page.screenshot({path:proofDir+'/failure.png',timeout:3000}).catch(()=>{});
      await writeFile(proofDir+'/failure.json',JSON.stringify({frames,error:error.message,paths:paths.slice(-40)},null,2));
      throw error;
    } finally {await context.close();}
  } else {
  // The normal coordinate setting must work on a browser with no WebGL.
  const readoutCase=await fresh(true);
  try {
    const p=readoutCase.page;
    await p.goto(origin);
    await ready(p);
    const value=p.locator('.atlas-flat-readout');
    await value.waitFor();
    const center=await value.textContent();
    assert.match(center,/0\.00000.*0\.00000.*zoom 0\.0/);
    await p.mouse.move(90,100);
    await p.waitForFunction(before=>document.querySelector('.atlas-flat-readout').textContent!==before,center);
    await p.mouse.move(40,30); // The brand button is above the Canvas.
    await p.waitForFunction(before=>document.querySelector('.atlas-flat-readout').textContent===before,center);
    if(!(await p.locator('#settings-open').isVisible()))await p.locator('#controls-open').click();
    const scale=p.getByRole('group',{name:'Map scale'});
    await scale.waitFor();
    assert.equal(await scale.textContent(),'5000 km');
    assert.ok(Math.abs((await scale.boundingBox()).width-63.95)<.03);
    await p.locator('#units').selectOption('imperial');
    assert.equal(await scale.textContent(),'2000 mi');
    await p.locator('#settings-open').click();
    await p.locator('#readout').uncheck();
    assert.equal(await value.isVisible(),false);
    assert.equal(await scale.isVisible(),true);
    await p.reload();
    await ready(p);
    assert.equal(await value.isVisible(),false);
    if(!(await p.locator('#settings-open').isVisible()))await p.locator('#controls-open').click();
    await p.locator('#settings-open').click();
    await p.locator('#readout').check();
    await value.waitFor();
    assert.equal(await value.textContent(),center);
    await scale.waitFor();
    assert.equal(await scale.textContent(),'2000 mi');
    await p.locator('#settings-close').click();
    await p.locator('#units').selectOption('metric');
    assert.equal(await scale.textContent(),'5000 km');
    await p.mouse.move(470,210);
    await p.mouse.wheel(0,-120); // One wheel event changes the camera by 0.25 zoom.
    await p.waitForFunction(()=>parseFloat(document.querySelector('.atlas-flat-scale').style.width)>72);
    assert.equal(await scale.textContent(),'5000 km'); // Same round distance, longer bar.
    for(let i=0;i<3;i++)await p.mouse.wheel(0,-120);
    await p.waitForFunction(()=>document.querySelector('.atlas-flat-scale').textContent==='2000 km');
    const view=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')));
    const wheelView=await view();
    assert.equal(wheelView.z,1);
    await p.getByRole('button',{name:'Zoom in',exact:true}).click();
    assert.deepEqual(await view(),{...wheelView,z:2});
    await p.getByRole('button',{name:'Zoom out',exact:true}).press('Enter');
    assert.deepEqual(await view(),wheelView);
    const canvas=p.locator('canvas.atlas-flat-preview');
    await canvas.press('Shift+Equal');
    assert.deepEqual(await view(),{...wheelView,z:2});
    await canvas.press('Minus');
    assert.deepEqual(await view(),wheelView);
    await canvas.press('Equal');
    assert.deepEqual(await view(),{...wheelView,z:2});
    await p.reload();
    await canvas.waitFor();
    await value.waitFor();
    assert.match(await value.textContent(),/zoom 2\.0/);
    assert.deepEqual(await view(),{...wheelView,z:2});
    for(let i=0;i<4;i++)await canvas.press('Minus');
    assert.deepEqual(await view(),{...wheelView,z:-0.5});
    assert.deepEqual(await p.evaluate(()=>window.webglAttempts),[]);
  } finally {await readoutCase.context.close();}
  // A rotated shared view keeps its orientation until the user resets it.
  const compassCase=await fresh(true);
  try {
    const p=compassCase.page, rotated='#0/3/4/45', north='#0/3/4';
    await p.addInitScript(()=>{
      Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('clipboard unavailable');}}});
    });
    const copyLink=async()=>{
      if(!(await p.locator('#share').isVisible()))await p.locator('#controls-open').click();
      await p.getByRole('button',{name:'Copy map link',exact:true}).click();
      const link=p.getByRole('textbox',{name:'map address'});
      await link.waitFor();
      return await link.inputValue();
    };
    await p.goto(origin+rotated);
    const compass=p.getByRole('button',{name:'Reset map to north',exact:true});
    const needle=()=>compass.locator('span').evaluate(el=>el.style.transform);
    const center=()=>p.locator('#map').getAttribute('data-flat-center');
    const redRows=minimum=>{
      const c=document.querySelector('canvas.atlas-flat-preview');
      const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let widest=0;
      for(let y=0;y<c.height;y++){
        let red=0;
        for(let x=0;x<c.width;x++){
          const i=(y*c.width+x)*4;
          if(d[i]===255&&d[i+1]===0&&d[i+2]===0&&d[i+3]===255) red++;
        }
        widest=Math.max(widest,red);
      }
      return widest>=minimum;
    };
    await compass.waitFor();
    await ready(p);
    assert.equal(await needle(),'rotate(-45deg)');
    assert.equal(await p.evaluate(redRows,100),false,'Rotated red line does not fill a horizontal row');
    const before=await center();
    assert.equal(new URL(await copyLink()).hash,rotated);
    await compass.click();
    assert.equal(await needle(),'rotate(0deg)');
    assert.equal(await center(),before);
    assert.equal(await p.evaluate(()=>location.hash),'');
    const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')));
    assert.equal(saved.b,0);
    assert.equal(saved.z,0);
    assert.ok(Math.abs(saved.c[0]-4)<1e-9 && Math.abs(saved.c[1]-3)<1e-9);
    await p.waitForFunction(redRows,500);
    const link=await copyLink();
    assert.equal(new URL(link).hash,north);
    await p.reload();
    await compass.waitFor();
    assert.equal(await needle(),'rotate(0deg)');
    assert.equal(await center(),before);
    assert.deepEqual(await p.evaluate(()=>window.webglAttempts),[]);
    // Follow the exact copied link from a fresh browser context.
    const recipient=await fresh(true);
    try {
      await recipient.page.goto(link);
      const received=recipient.page.getByRole('button',{name:'Reset map to north',exact:true});
      await received.waitFor();
      assert.equal(await received.locator('span').evaluate(el=>el.style.transform),'rotate(0deg)');
      assert.equal(await recipient.page.locator('#map').getAttribute('data-flat-center'),before);
      assert.deepEqual(await recipient.page.evaluate(()=>window.webglAttempts),[]);
    } finally {await recipient.context.close();}
  } finally {await compassCase.context.close();}
  // Browser-provided synthetic positions, never an operator's actual location.
  const locationCase=await fresh(true);
  try {
    const {page:p,context}=locationCase;
    await context.grantPermissions(['geolocation'],{origin});
    await context.setGeolocation({longitude:114,latitude:22,accuracy:18});
    await p.goto(origin);
    await ready(p);
    const button=p.getByRole('button',{name:'My location',exact:true});
    const state=()=>button.getAttribute('data-location-state');
    const center=()=>p.locator('#map').getAttribute('data-flat-center');
    const assertCenter=async (lng,lat)=>{
      const [x,y]=(await center()).split(',').map(Number);
      assert.ok(Math.abs(x-lng)<1e-8 && Math.abs(y-lat)<1e-8, `${x},${y} is not ${lng},${lat}`);
    };
    const waitCenter=([lng,lat])=>p.waitForFunction(([lng,lat])=>{
      const [x,y]=document.querySelector('#map').dataset.flatCenter.split(',').map(Number);
      return Math.abs(x-lng)<1e-8&&Math.abs(y-lat)<1e-8;
    },[lng,lat]);
    const blueAtCenter=()=>{
      const c=document.querySelector('canvas.atlas-flat-preview');
      const d=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;
      return d[0]===21&&d[1]===118&&d[2]===229&&d[3]===255;
    };
    assert.equal(await state(),'off');
    await assertCenter(0,0);
    await button.press('Enter');
    await waitCenter([114,22]);
    await p.waitForFunction(blueAtCenter);
    assert.equal(await state(),'following');
    assert.match(await p.locator('.atlas-flat-readout').textContent(),/zoom 15\.0/);
    assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')).c),[0,0]);
    await context.setGeolocation({longitude:114.001,latitude:22.001,accuracy:20});
    await waitCenter([114.001,22.001]);
    const canvas=p.locator('canvas.atlas-flat-preview');
    await canvas.press('ArrowRight');
    assert.equal(await state(),'paused');
    const paused=await center();
    await context.setGeolocation({longitude:114.003,latitude:22.002,accuracy:20});
    // The fix moves the visible dot about 33 px right and 50 px up but
    // does not recenter the camera while follow is paused.
    await p.waitForFunction(()=>{
      const c=document.querySelector('canvas.atlas-flat-preview');
      const density=c.width/c.clientWidth;
      const d=c.getContext('2d').getImageData(c.width/2+27*density,c.height/2-57*density,16*density,16*density).data;
      return d.some((v,i)=>i%4===0&&v===21&&d[i+1]===118&&d[i+2]===229&&d[i+3]===255);
    });
    assert.equal(await center(),paused);
    assert.equal(await state(),'paused');
    await button.click();
    await waitCenter([114.003,22.002]);
    assert.equal(await state(),'following');
    assert.notEqual(await center(),paused);
    await button.click();
    assert.equal(await state(),'off');
    await p.waitForFunction(()=>document.querySelector('.atlas-flat-location-status').textContent.includes('stopped'));
    await p.waitForFunction(()=>{const c=document.querySelector('canvas.atlas-flat-preview');
      const d=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;
      return d[0]!==21||d[1]!==118||d[2]!==229;
    });
    await context.setGeolocation({longitude:115,latitude:21,accuracy:10});
    await canvas.press('Equal');
    await assertCenter(114.003,22.002);
    assert.deepEqual(await p.evaluate(()=>window.webglAttempts),[]);
  } finally {await locationCase.context.close();}
  const deniedLocation=await fresh(true);
  try {
    const p=deniedLocation.page;
    await p.setViewportSize({width:280,height:440});
    await p.addInitScript(()=>{
      Object.defineProperty(navigator,'geolocation',{value:{
        watchPosition(_success,failure){setTimeout(()=>failure({code:1}),0);return 7;},
        clearWatch(id){window.clearedLocationWatch=id;},
      }});
    });
    await p.goto(origin);
    await p.locator('canvas.atlas-flat-preview').waitFor();
    const tools=await p.locator('.atlas-flat-tool-buttons').boundingBox();
    assert.ok(tools.x>=65 && tools.x+tools.width<=280);
    await p.getByRole('button',{name:'My location',exact:true}).click();
    await p.getByText('Location permission was denied.',{exact:true}).waitFor();
    assert.equal(await p.getByRole('button',{name:'My location',exact:true}).getAttribute('aria-pressed'),'false');
    assert.equal(await p.evaluate(()=>window.clearedLocationWatch),7);
  } finally {await deniedLocation.context.close();}
  // The five real controls and data paths, with intercepted fixture imagery.
  const creditCase=await fresh(true);
  fixtureCredits=true;
  try {
    const p=creditCase.page;
    await p.goto(origin);
    await ready(p);
    const credits=p.locator('.atlas-flat-credit-content');
    await p.locator('.atlas-flat-credit-box summary').click();
    assert.equal(await credits.isVisible(),true);
    const select=async key=>{
      const choice=p.locator(`[data-background="${key}"]`);
      if(!await choice.isVisible())await p.locator('#controls-open').click();
      await choice.click();
      assert.equal(await choice.getAttribute('aria-pressed'),'true');
    };
    const pixel=rgba=>p.waitForFunction(rgba=>{
      const c=document.querySelector('canvas.atlas-flat-preview');
      const d=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;
      return rgba.every((n,i)=>n===d[i]);
    },rgba,{timeout:12000});
    const has=href=>credits.locator(`a[href="${href}"]`).count();
    const rail='https://example.org/rail-credit', eox='https://cloudless.eox.at/',
      carto='https://www.openstreetmap.org/copyright',topo='https://github.com/ramSeraph/russian_world_topo_maps';
    await pixel([2,19,27,255]);
    assert.equal(await has(rail),1);
    assert.equal(await credits.locator('a[title="unused"]').count(),0);
    await select('satellite');
    await pixel([128,123,0,255]);
    assert.equal(await has(rail),0);
    assert.equal(await has(eox),1);
    assert.equal(await has('https://www.esri.com/'),0);
    assert.equal(await has('https://nasa-gibs.github.io/gibs-api-docs/'),0);
    await select('hybrid');
    await pixel([128,123,0,255]);
    await ready(p);
    assert.equal(await has(rail),1);
    assert.equal(await has(eox),1);
    await select('carto');
    await pixel([127,236,0,255]);
    assert.equal(await has(carto),1);
    assert.equal(await has(eox),0);
    await select('soviet');
    // The historical raster can have a masked coverage gap at the map center.
    await p.waitForFunction(()=>{
      const c=document.querySelector('canvas.atlas-flat-preview');
      const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      return d.some((v,i)=>i%4===0&&v===128&&d[i+1]===63&&d[i+2]===0&&d[i+3]===255);
    },null,{timeout:12000});
    assert.equal(await has(topo),1);
    assert.equal(await has(rail),1);
    assert.equal(await has(eox),0);
    await select('map');
    await pixel([2,19,27,255]);
    assert.equal(await has(topo),0);
    await p.reload();
    await ready(p);
    assert.equal(await credits.isVisible(),true);
    assert.equal(await has(rail),1);
    assert.deepEqual(await p.evaluate(()=>window.webglAttempts),[]);
  } finally {
    fixtureCredits=false;
    await creditCase.context.close();
  }
  // Independent POIs must only appear in the missing primary coverage.
  for(const failure of ['metadata','tile']){
    const stationCase=await fresh(true);
    stationFailureFixture=failure;
    try {
      const p=stationCase.page;
      await p.goto(origin+'/#8/-0.703/1.40625');
      const c=p.locator('canvas.atlas-flat-preview');
      await c.waitFor();
      const coverage=()=>{
        const canvas=document.querySelector('canvas.atlas-flat-preview');
        const {width,height,clientWidth:cssWidth,clientHeight:cssHeight}=canvas, ratio=width/cssWidth;
        const d=canvas.getContext('2d').getImageData(0,0,width,height).data;
        const groups={left:{dots:0,letters:0},right:{dots:0,letters:0}};
        for(let y=Math.round(height*.34);y<Math.round(height*.69);y++)
          for(let x=0;x<width;x++){
            const i=(y*width+x)*4, group=x<width/2?groups.left:groups.right;
            const px=cssWidth/2+(group===groups.left?-128:128),py=cssHeight/2;
            // The shared thematic style uses a small unfilled grey station
            // outline, not the fallback layer's seed orange paint.
            if(Math.abs(x-px*ratio)<2*ratio&&Math.abs(y-py*ratio)<2*ratio&&d[i]>5&&d[i]<95&&
                d[i+1]>=d[i]+12&&d[i+2]>=d[i+1]+5&&d[i+3]===255){
              group.dots++;
              group.dot=[px,py];
            }
            if(d[i]===8&&d[i+1]===101&&d[i+2]===192&&d[i+3]===255)group.letters++;
          }
        return groups;
      };
      for(let i=0;i<80;i++){
        const shown=await p.evaluate(coverage);
        if(shown.left.dots&&shown.left.letters&&shown.right.dots)break;
        await new Promise(resolve=>setTimeout(resolve,150));
      }
      const shown=await p.evaluate(coverage);
      assert.ok(shown.left.dots&&shown.left.letters,JSON.stringify(shown));
      if(failure==='metadata')assert.ok(shown.right.dots&&shown.right.letters,JSON.stringify(shown));
      else {
        assert.ok(shown.right.dots>0,JSON.stringify(shown));
        assert.equal(shown.right.letters,0);
      }
      await c.click({position:{x:shown.left.dot[0],y:shown.left.dot[1]}});
      await p.getByRole('heading',{name:'Fallback West',exact:true}).waitFor();
      await p.getByText(/departures are unavailable for this fallback marker/).waitFor();
      assert.equal(fixtureDepartures.length,0,'fallback-only marker must not ask for guessed departures');
      await p.locator('#details .close').click();
      if(failure==='tile'){
        await c.click({position:{x:shown.right.dot[0],y:shown.right.dot[1]}});
        await p.getByRole('heading',{name:'Primary East',exact:true}).waitFor();
        assert.equal(await p.getByText(/departures are unavailable for this fallback marker/).count(),0);
        const summary=p.locator('.departure-summary').filter({hasText:'Fixture Terminus'});
        await summary.waitFor();
        await p.getByText(/Timetabled times: no live data/).waitFor();
        assert.deepEqual(fixtureDepartures,['stops','stoptimes']);
        await summary.click();
        await p.locator('.trip-stops').waitFor();
        assert.deepEqual(await p.locator('.trip-stops tbody th').allTextContents(),
          ['Previous Station','Primary East','Fixture Terminus']);
        assert.deepEqual(fixtureDepartures,['stops','stoptimes','trip']);
        assert.equal(await p.locator('.trip-current-stop').count(),1);
        console.log('Firefox staged Canvas: clicked painted station, loaded a timetabled board, and opened the correct train schedule without prefetch.');
        await p.locator('#details .close').click();
      }
      if(!(await p.locator('#settings-open').isVisible()))await p.locator('#controls-open').click();
      await p.locator('[data-background="satellite"]').click();
      assert.equal((await p.evaluate(coverage)).left.dots,0);
      await p.locator('[data-background="map"]').click();
      for(let i=0;i<80&&!(await p.evaluate(coverage)).left.dots;i++)
        await new Promise(resolve=>setTimeout(resolve,150));
      assert.ok((await p.evaluate(coverage)).left.dots>0);
      await p.locator('#settings-open').click();
      await p.locator('#stations').uncheck();
      assert.equal((await p.evaluate(coverage)).left.dots,0);
      assert.deepEqual(await p.evaluate(()=>window.webglAttempts),[]);
    } finally {stationFailureFixture='';await stationCase.context.close();}
  }
  const curatedCase=await fresh(true);
  stationFailureFixture='curated';
  try {
    const p=curatedCase.page;
    await p.goto(origin+'/#7.5/-0.25/0.25');
    const canvas=p.locator('canvas.atlas-flat-preview');
    await canvas.waitFor();
    const hasCuratedOutline=()=>{
      const c=document.querySelector('canvas.atlas-flat-preview');
      const d=c.getContext('2d').getImageData(c.width/2-4,c.height/2-4,9,9).data;
      return d.some((v,i)=>i%4===0&&v>5&&v<95&&d[i+1]>=v+12&&d[i+2]>=d[i+1]+5&&d[i+3]===255);
    };
    await p.waitForFunction(hasCuratedOutline);
    assert.ok(paths.includes('/station-medium-fixture.json'));
    await canvas.click({position:{x:350,y:220}});
    await p.getByRole('heading',{name:'Curated Hub',exact:true}).waitFor();
    await p.locator('#details .close').click();
    if(!(await p.locator('#settings-open').isVisible()))await p.locator('#controls-open').click();
    await p.locator('#settings-open').click();
    await p.locator('#stations').uncheck();
    assert.equal(await p.evaluate(hasCuratedOutline),false);
    stationFailureFixture='curated-healthy';
    await p.locator('#stations').check();
    for(let i=0;i<80&&!paths.some(path=>path.startsWith('/station-medium/'));i++)
      await new Promise(resolve=>setTimeout(resolve,150));
    assert.ok(paths.some(path=>path.startsWith('/station-medium/')));
    assert.equal(await p.evaluate(hasCuratedOutline),false);
    assert.deepEqual(await p.evaluate(()=>window.webglAttempts),[]);
  } finally {stationFailureFixture='';await curatedCase.context.close();}
  for(const failure of ['metadata','tile','healthy']){
    const railCase=await fresh(true), p=railCase.page;
    railFailureFixture=failure;
    try{
      const before=paths.length;
      await p.goto(origin+'/#8/-0.7031/1.40625');
      const errors=[];p.on('pageerror',error=>errors.push(error.message));
      await p.locator('canvas.atlas-flat-preview').waitFor().catch(async error=>{
        console.error(failure,errors,await p.locator('#map-status').textContent(),paths.slice(before));throw error;});
      const colors=()=>{
        const c=document.querySelector('canvas.atlas-flat-preview'), g=c.getContext('2d');
        const contains=(x,y,test)=>g.getImageData(x-5,y-6,11,13).data.some((r,i,d)=>i%4===0&&test(r,d[i+1],d[i+2]));
        const blue=(r,g,b)=>r<25&&g>140&&b>220,red=(r,g,b)=>r>225&&g<30&&b<30;
        const x=c.width/2,y=c.height/2,sx=c.width/c.clientWidth,sy=c.height/c.clientHeight;
        return {west:contains(x-90*sx,y,blue),east:contains(x+90*sx,y,blue),
          primary:contains(x+90*sx,y+40*sy,red)};
      };
      const expected={west:failure!=='healthy',east:failure==='metadata',primary:failure!=='metadata'};
      for(let i=0;i<80&&JSON.stringify(await p.evaluate(colors))!==JSON.stringify(expected);i++)
        await new Promise(resolve=>setTimeout(resolve,125));
      const observed=await p.evaluate(colors);
      if(JSON.stringify(observed)!==JSON.stringify(expected))console.error(failure,paths.slice(before),errors,
        await p.locator('#map-status').textContent(),await p.evaluate(()=>{
          const c=document.querySelector('canvas.atlas-flat-preview'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
          const reds=[];for(let i=0;i<d.length;i+=4)if(d[i]>225&&d[i+1]<30&&d[i+2]<30&&reds.length<10)reds.push([(i/4)%c.width,Math.floor(i/4/c.width)]);
          return {size:[c.width,c.height],reds,center:document.querySelector('#map').dataset.flatCenter};}));
      assert.deepEqual(observed,expected,failure);
      assert.ok(paths.slice(before).includes('/rail-health.json'));
      if(failure==='healthy')assert.ok(!paths.slice(before).includes('/data/rail-reference-fixture.pmtiles'));
      else await p.getByText(/Neutral reference lines, where shown/).waitFor();
      assert.deepEqual(await p.evaluate(()=>window.webglAttempts),[]);
    }finally {railFailureFixture='';await railCase.context.close();}
  }
  railFailureFixture='legend';
  const legendCase=await fresh(true), lp=legendCase.page;
  try {
    await lp.goto(origin+'/#8/-0.7031/1.40625');
    await lp.locator('canvas.atlas-flat-preview').waitFor();
    const gauge=lp.getByRole('button',{name:'Gauge',exact:true});
    if(!(await gauge.isVisible()))await lp.locator('#controls-open').click();
    await gauge.click();
    const hasRed=()=> {
      const c=document.querySelector('canvas.atlas-flat-preview');
      const p=c.getContext('2d').getImageData(c.width/2+90*c.width/c.clientWidth-5,
        c.height/2+40*c.height/c.clientHeight-6,11,13).data;
      return p.some((r,i)=>i%4===0&&r>225&&p[i+1]<30&&p[i+2]<30);
    };
    await lp.waitForFunction(hasRed);
    const legend=lp.locator('#legend');
    await legend.getByText(/1[,.]?435 mm/).waitFor();
    if(await legend.getByText(/1[,.]?067 mm|1[,.]?000 mm/).count())throw Error('Unpainted gauge appeared in legend');
    const speed=lp.getByRole('button',{name:'Max speed',exact:true});
    await speed.click();
    await legend.getByText(/Mapped maximum speed/).waitFor();
    assert.equal(await legend.getByText(/1[,.]?435 mm/).count(),0);
    await gauge.click();
    await legend.getByText(/1[,.]?435 mm/).waitFor();
    assert.deepEqual(await lp.evaluate(()=>window.webglAttempts),[]);
    console.log('Canvas thematic legend follows visible, painted gauge; offscreen and transparent values are excluded.');
  } finally {railFailureFixture='';await legendCase.context.close();}
  const signalCase=await fresh(true), sp=signalCase.page;
  try {
    const reads=()=>paths.filter(path=>path===fixtureElectricityPath).length;
    const prior=reads();
    await sp.goto(origin+'/?inactive=0#12/0.001/0.001');
    const canvas=sp.locator('canvas.atlas-flat-preview');
    await canvas.waitFor();
    if(!(await sp.locator('#settings-open').isVisible()))await sp.locator('#controls-open').click();
    const power=sp.locator('[data-mode="electrification"]');
    await power.click();
    assert.equal(reads(),prior,'Power below zoom 13 must not request the signal snapshot');
    await canvas.press('+');
    const painted=async (x,shape,expected)=>sp.waitForFunction(([x,shade,expected])=>{
      const c=document.querySelector('.atlas-flat-preview'), scale=c.width/c.clientWidth;
      const pixels=c.getContext('2d').getImageData(Math.round(c.width/2+x*scale)-2,Math.round(c.height/2)-2,5,5).data;
      const rgb=shade.slice(1).match(/../g).map(v=>parseInt(v,16));
      return pixels.some((r,i)=>i%4===0&&r===rgb[0]&&pixels[i+1]===rgb[1]&&pixels[i+2]===rgb[2])===expected;
    },[x,ELECTRICITY_SIGNAL_STYLE[shape],expected]);
    await painted(0,'color',true).catch(async error=>{
      console.error('Electricity signal fixture:',reads(),paths.slice(-20),await sp.evaluate(()=>({
        status:document.querySelector('#map-status').textContent,
        pressed:document.querySelector('[data-mode="electrification"]').getAttribute('aria-pressed'),
        center:document.querySelector('#map').dataset.flatCenter, view:localStorage.getItem('atlas_view'),
      })));throw error;
    });
    assert.equal(reads(),prior+1);
    await canvas.click({position:{x:350,y:220}});
    await sp.getByRole('heading',{name:'Signal P1',exact:true}).waitFor();
    await sp.locator('#detail-content a[href="https://www.openstreetmap.org/node/88101"]').waitFor();
    await sp.locator('#details .close').click();
    const x=512*2**13*0.005/360;
    await painted(x,'paper',false);
    if(!(await sp.locator('#settings-open').isVisible()))await sp.locator('#controls-open').click();
    await sp.locator('#settings-open').click();
    await sp.locator('#inactive').check();
    await painted(x,'paper',true);
    await sp.locator('#settings-close').click();
    await canvas.click({position:{x:350+x,y:220}});
    await sp.getByRole('heading',{name:'Signal P2',exact:true}).waitFor();
    await sp.locator('#details .close').click();
    if(!(await sp.locator('#settings-open').isVisible()))await sp.locator('#controls-open').click();
    await sp.locator('[data-mode="infrastructure"]').click();
    await painted(0,'color',false);
    await power.click();
    await painted(0,'color',true);
    assert.equal(reads(),prior+1,'Power reuses the loaded snapshot across mode changes');
    assert.deepEqual(await sp.evaluate(()=>window.webglAttempts),[]);
    console.log('Canvas Power: painted current/former electrification signals, real detail panels, zoom gate and cached snapshot.');
  } finally {await signalCase.context.close();}
  const geometryCase=await fresh(true), gp=geometryCase.page;
  try {
    const count=path=>paths.filter(p=>p===path).length;
    const initial=[facilitySnapshot,methodSnapshot,fixtureElectricityPath].map(count);
    await gp.goto(origin+'/#12/1/1');
    const canvas=gp.locator('canvas.atlas-flat-preview');
    await canvas.waitFor();
    if(!(await gp.locator('#settings-open').isVisible()))await gp.locator('#controls-open').click();
    assert.deepEqual([facilitySnapshot,methodSnapshot,fixtureElectricityPath].map(count),initial);
    const power=gp.locator('[data-mode="electrification"]');
    const targets=[[.980,1.004],[.985,1.004],[1.015,1.010],[1,.989]];
    const coords=await gp.evaluate(targets=>{
      const mercY=lat=>(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2, world=512*2**12;
      return targets.map(([lon,lat])=>[350+(lon-1)/360*world,220+(mercY(lat)-mercY(1))*world]);
    },targets);
    const pixelRows=(coords)=>coords.map(([x,y])=>{
      const c=document.querySelector('.atlas-flat-preview'), sx=c.width/c.clientWidth, sy=c.height/c.clientHeight;
      return Array.from(c.getContext('2d').getImageData(Math.round(sx*x)-8,Math.round(sy*y)-8,17,17).data).join(',');
    });
    await gp.waitForFunction(coords=>{const c=document.querySelector('.atlas-flat-preview');return c.getContext('2d').getImageData(Math.round(coords[0][0]*c.width/c.clientWidth),Math.round(coords[0][1]*c.height/c.clientHeight),1,1).data[3]===255;},coords);
    const baseline=await gp.evaluate(pixelRows,coords);
    await power.click();
    for(let i=0;i<70;i++){
      const seen=await gp.evaluate(pixelRows,coords);
      if([0,2,3].every(i=>seen[i]!==baseline[i]))break;
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    const present=await gp.evaluate(pixelRows,coords);
    for(const i of [0,2,3])assert.notEqual(present[i],baseline[i],'Power feature painted at fixture pixel '+i);
    assert.equal(present[1],baseline[1],'polygon hole stays clear');
    assert.deepEqual([facilitySnapshot,methodSnapshot,fixtureElectricityPath].map(count),[initial[0]+1,initial[1]+1,initial[2]]);
    await gp.locator('#collapse').click();
    await canvas.click({position:{x:coords[1][0],y:coords[1][1]}});
    assert.equal(await gp.locator('#details').isVisible(),false,'polygon hole is not a hit');
    for(const [i,name,osm] of [[0,'Fixture power yard','way/88103'],[2,'Fixture power marker','node/88104'],[3,'Fixture conductor rail','way/88105']]){
      await canvas.click({position:{x:coords[i][0],y:coords[i][1]}});
      await gp.getByRole('heading',{name,exact:true}).waitFor();
      await gp.locator('#detail-content a[href="https://www.openstreetmap.org/'+osm+'"]').waitFor();
      await gp.locator('#details .close').click();
    }
    if(!(await gp.locator('#settings-open').isVisible()))await gp.locator('#controls-open').click();
    await gp.locator('[data-mode="infrastructure"]').click();
    assert.deepEqual(await gp.evaluate(pixelRows,coords),baseline);
    await power.click();
    assert.deepEqual(await gp.evaluate(pixelRows,coords),present);
    assert.deepEqual([facilitySnapshot,methodSnapshot,fixtureElectricityPath].map(count),[initial[0]+1,initial[1]+1,initial[2]]);
    assert.deepEqual(await gp.evaluate(()=>window.webglAttempts),[]);
    console.log('Canvas Power: production facility polygon with clear/unselectable hole, facility point and conductor rail paint and open details; snapshots are gated and cached.');
  } finally {await geometryCase.context.close();}
  for(const openPanel of [false,true]){
    const service=await fresh(true), p=service.page;
    try {
      await p.clock.install({time:fixtureServiceStart});
      await p.goto(origin+'/?mode=service&serviceWidth=frequency&frequencyPeriod=peak&peakPhase=am#12/1/1');
      const canvas=p.locator('canvas.atlas-flat-preview');
      await canvas.waitFor();
      const showsFresh=(fresh)=>{
        const c=document.querySelector('.atlas-flat-preview'),k=c.width/c.clientWidth;
        const [r]=c.getContext('2d').getImageData(Math.round(c.width/2),Math.round(c.height/2+3*k),1,1).data;
        return (r>200)===fresh;
      };
      await p.waitForFunction(showsFresh,true);
      const openDetail=async ()=>{
        if(await p.locator('#collapse').isVisible())await p.locator('#collapse').click();
        await canvas.click({position:{x:350,y:220}});
        await p.getByRole('heading',{name:'Fixture scheduled rail',exact:true}).waitFor();
      };
      if(openPanel){await openDetail();await p.getByText('6/h/direction (scheduled)').waitFor();}
      const initialReads=paths.filter(path=>path.startsWith('/fixture-service/')).length;
      await p.clock.fastForward(65000);
      await p.waitForFunction(showsFresh,false);
      if(!openPanel)await openDetail();
      await p.getByText('Matched frequency profile has expired; current frequency is unknown.').waitFor();
      assert.equal(paths.filter(path=>path.startsWith('/fixture-service/')).length,initialReads,
        'Expiry should redraw existing service tiles, not request them again');
      assert.deepEqual(await p.evaluate(()=>window.webglAttempts),[]);
    } finally {await service.context.close();}
  }
  console.log('Canvas Service: idle expiry refreshes the existing line and an open detail panel, without refetching.');
  let current=await fresh(true);
  await current.page.goto(origin);
  await ready(current.page).catch(async e=>{console.error(await current.page.locator("#map-status").textContent(),paths.slice(-35));throw e;});
  assert.deepEqual(await current.page.evaluate(()=>window.webglAttempts),[]);
  assert.equal(await current.page.locator('#disable-webgl').isChecked(),true);
  assert.ok(paths.includes('/entry-tilejson.json')&&paths.includes('/fixture/0/0/0.pbf'));
  await current.page.waitForFunction(()=>{
    const c=document.querySelector('canvas.atlas-flat-preview');
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    return d.some((value,i)=>i%4===0&&value===255&&d[i+1]===0&&d[i+2]===255&&d[i+3]===255);
  },null,{timeout:10000});
  assert.ok(paths.includes('/label/0/0/0.pbf'),'symbol-only source supplied the visibly painted name');
  await current.page.waitForFunction(()=>{
    const c=document.querySelector('canvas.atlas-flat-preview');
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    return d.some((value,i)=>i%4===0&&value===255&&d[i+1]===255&&d[i+2]===0&&d[i+3]===255);
  },null,{timeout:10000});


  assert.ok(!paths.some(path=>path.includes('/vendor/maplibre-gl-')||path.startsWith('/never-request/')));
  // A settings change must affect the current canvas, not just storage or
  // the next load. The other rail source stays installed without refetching.
  const railReads=paths.filter(path=>path==='/entry-tilejson.json').length;
  await current.page.locator('canvas.atlas-flat-preview').evaluate(canvas=>canvas.dataset.optionProbe='current');
  if(!(await current.page.locator('#settings-open').isVisible()))await current.page.locator('#controls-open').click();
  await current.page.locator('#settings-open').click();
  const labelVisible=expected=>current.page.waitForFunction(expected=>{
    const c=document.querySelector('canvas.atlas-flat-preview');
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    return d.some((value,i)=>i%4===0&&value===255&&d[i+1]===0&&d[i+2]===255&&d[i+3]===255)===expected;
  },expected,{timeout:10000});
  await current.page.locator('#stations').uncheck();await labelVisible(false);await ready(current.page);
  await current.page.locator('#stations').check();await labelVisible(true);await ready(current.page);
  await current.page.locator('#settings-close').click();
  assert.equal(await current.page.locator('canvas.atlas-flat-preview').getAttribute('data-option-probe'),'current');
  assert.equal(paths.filter(path=>path==='/entry-tilejson.json').length,railReads);
  assert.deepEqual(await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')).c),[0,0]);

  const screenFeature=async (color)=>{
    const point=await current.page.waitForFunction(color=>{
      const c=document.querySelector('canvas.atlas-flat-preview'),r=c.getBoundingClientRect();
      const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++) {
        const i=4*(y*c.width+x),sx=r.left+(x+0.5)*r.width/c.width,sy=r.top+(y+0.5)*r.height/c.height;
        // Real startup applies the standard translucent station stroke, not the fixture's nominal fill.
        const marked=color ? color.every((value,j)=>d[i+j]===value) :
          d[i]>2 && d[i]<100 && d[i+1]>19 && d[i+1]<130 && d[i+2]>27 && d[i+2]<130;
        if(marked&&document.elementFromPoint(sx,sy)===c)return [sx,sy];
      }
      return null;
    },color,{timeout:10000});
    await current.page.mouse.click(...await point.jsonValue());
  };
  await screenFeature([255,0,0,255]);
  await current.page.getByRole('heading',{name:'Fixture Line'}).waitFor();
  await current.page.locator('#details-close').click();
  await screenFeature(null);
  await current.page.getByRole('heading',{name:'Fixture Station'}).waitFor();
  await current.page.locator('#details-close').click();
  const page=current.page, canvas=page.locator('canvas.atlas-flat-preview');
  await page.getByRole('button',{name:'Measure',exact:true}).click();
  assert.equal(await page.locator('[data-measure="distance"]').getAttribute('aria-pressed'),'true');
  const positions=await canvas.evaluate(c=>{
    const r=c.getBoundingClientRect();
    // Stay out of the settings panel and change the measured line's direction.
    return [[.57,.22],[.70,.30],[.63,.35],[.75,.23]].map(([x,y])=>[r.left+x*r.width,r.top+y*r.height]);
  });
  assert.ok(await page.evaluate(points=>points.every(([x,y])=>document.elementFromPoint(x,y)?.matches("canvas.atlas-flat-preview")),positions));
  for(const xy of positions.slice(0,2))await page.mouse.click(...xy);
  await page.locator('#measure-finish').click();
  await page.waitForFunction(()=>/Distance: .+ over 1 segment\./.test(document.querySelector('#measure-status').textContent));
  await page.waitForFunction(positions=>{
    const c=document.querySelector('canvas.atlas-flat-preview'),r=c.getBoundingClientRect(),cx=c.getContext('2d');
    return positions.slice(0,2).every(([x,y])=>{
      const rgb=cx.getImageData(Math.round((x-r.left)*c.width/r.width),Math.round((y-r.top)*c.height/r.height),1,1).data;
      return rgb[0]===255&&rgb[1]===254&&rgb[2]===248;
    });
  },positions);
  const prior=await page.locator('#measure-status').textContent();
  assert.equal(await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.matches('canvas.atlas-flat-preview'),positions[1]),true);
  await page.mouse.move(...positions[1]);await page.mouse.down();await page.mouse.move(...positions[3],{steps:5});await page.mouse.up();
  assert.notEqual(await page.locator('#measure-status').textContent(),prior,'moving a handle updates the measure');
  await page.locator('#measure-profile').click();
  await page.getByRole('heading',{name:'Distance elevation profile'}).waitFor();
  await page.getByText('The terrain tiles could not load here.',{exact:true}).waitFor();
  await page.locator('#details-close').click();
  await page.locator('[data-measure="radius"]').click();
  for(const xy of positions.slice(0,3))await page.mouse.click(...xy);
  await page.waitForFunction(()=>document.querySelector('#measure-status').textContent.includes('Curve radius ≈'));
  await page.locator('#measure-undo').click();
  assert.match(await page.locator('#measure-status').textContent(),/1 more point/);
  await page.locator('[data-measure="elevation"]').click();
  await page.mouse.click(...positions[0]);
  await page.waitForFunction(()=>document.querySelector('#measure-status').textContent.includes('Elevation: unavailable'));
  await page.locator('#measure-close').click();
  assert.equal(await page.locator('#measure-toolbar').isVisible(),false);
  assert.deepEqual(await page.evaluate(()=>window.webglAttempts),[]);
  const stored=await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')));
  assert.deepEqual(stored.c,[0,0]);
  const keyCanvas=current.page.locator('canvas.atlas-flat-preview');
  const keyView=()=>current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')));
  await keyCanvas.press('Shift+ArrowRight');
  const turned=await keyView();
  assert.deepEqual({c:turned.c,z:turned.z,b:turned.b}, {c:stored.c,z:stored.z,b:15},'right rotation keeps the centre and zoom');
  await current.page.reload();
  await ready(current.page).catch(async e=>{console.error(await current.page.locator("#map-status").textContent(),paths.slice(-35));throw e;});
  await keyCanvas.press('Shift+ArrowLeft');
  const straight=await keyView();
  assert.deepEqual({c:straight.c,z:straight.z,b:straight.b}, {c:stored.c,z:stored.z,b:0},'left rotation starts from the restored bearing');
  await keyCanvas.press('ArrowRight');
  assert.ok((await keyView()).c[0]>10,'unmodified right still pans');
  assert.deepEqual(await current.page.evaluate(()=>window.webglAttempts),[]);
  await current.context.close();

  // The missing-data case above does not show whether Canvas passes valid
  // heights through the native browser PNG decoder and the actual profile.
  useElevationFixture=true;
  current=await fresh(true,true);
  await current.context.addInitScript(()=>{
    const n=2**14,x=8180,y=7200;
    const c=[(x+.5)*360/n-180,Math.atan(Math.sinh(Math.PI*(1-2*(y+.5)/n)))*180/Math.PI];
    localStorage.setItem('atlas_view',JSON.stringify({c,z:14,b:0,p:0,g:false,t:false}));
  });
  await current.page.goto(origin);
  const hg=current.page, hCanvas=hg.locator('canvas.atlas-flat-preview');
  await hCanvas.waitFor();
  await hg.getByRole('button',{name:'Measure',exact:true}).click();
  const coords=await hCanvas.evaluate(c=>{
    const r=c.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2-43;
    return [[x,y],[x+112,y]];
  });
  assert.ok(await hg.evaluate(points=>points.every(([x,y])=>document.elementFromPoint(x,y)?.matches('canvas.atlas-flat-preview')),coords));
  await hg.locator('[data-measure="elevation"]').click();
  await hg.mouse.click(...coords[0]);
  await hg.waitForFunction(()=>document.querySelector('#measure-status').textContent.includes('123 m above sea level'),null,{timeout:10000}).catch(async e=>{console.error('Positive elevation probe',await hg.locator('#measure-status').textContent(),terrainRequests,paths.filter(x=>x.includes('nearby-fixture')).slice(-20),await hg.locator('#map').getAttribute('data-flat-center'));throw e;});
  await hg.mouse.click(...coords[1]);
  await hg.waitForFunction(()=>document.querySelector('#measure-status').textContent.includes('20 m below sea level'),null,{timeout:10000});
  assert.ok(terrainRequests.includes(14)&&terrainRequests.includes(10),'land and seabed use the intended tile scales');
  await hg.locator('[data-measure="distance"]').click();
  for(const xy of coords)await hg.mouse.click(...xy);
  await hg.locator('#measure-finish').click();
  await hg.waitForFunction(()=>document.querySelector('#measure-status').textContent.includes('End to end: −143 m'),null,{timeout:10000});
  await hg.locator('#measure-profile').click();
  await hg.getByRole('img',{name:'Elevation along the line'}).waitFor({timeout:10000});
  const summary=await hg.locator('#detail-content dl').innerText();
  assert.match(summary,/-20 m/);assert.match(summary,/123 m/);
  await hg.getByRole('img',{name:'Elevation along the line'}).evaluate(svg=>{
    const r=svg.getBoundingClientRect();
    svg.dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+r.width*.3,clientY:r.top+r.height*.4}));
  });
  await hg.locator('.profile-cursor[visibility="visible"]').waitFor({state:'attached'});
  await hg.waitForFunction(()=>{
    const c=document.querySelector('canvas.atlas-flat-preview'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    return d.some((v,i)=>i%4===0&&v===224&&d[i+1]===112&&d[i+2]===27&&d[i+3]===255);
  },null,{timeout:10000});
  await hg.locator('#details-close').click();
  await hg.locator('#measure-close').click();
  await hg.getByRole('button',{name:'Drawing tools',exact:true}).click();
  const drawing=()=>hg.evaluate(()=>JSON.parse(localStorage.getItem('openrailwayatlas-drawing')));
  const sketch=await hCanvas.evaluate(c=>{
    const r=c.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+105;
    return {a:[x-18,y],b:[x+128,y],mid:[x+55,y],drag:[x+57,y+44],
      point:[x+83,y-30],area:[[x+150,y-34],[x+220,y-37],[x+185,y+18]]};
  });
  const clickAt=async point=>{
    const blocked=await hg.evaluate(([x,y])=>{
      const target=document.elementFromPoint(x,y);
      return target?.matches('canvas.atlas-flat-preview') ? null : target?.tagName+'#'+target?.id;
    },point);
    assert.equal(blocked,null,'The click must reach the real map at '+point);
    await hg.mouse.click(...point);
  };
  await hg.locator('[data-draw="line"]').click();
  await hg.locator('#draw-dash').selectOption('dashed');
  await clickAt(sketch.a);await clickAt(sketch.b);
  await hg.locator('#draw-finish').click();
  let saved=await drawing();
  assert.deepEqual(saved.features.map(f=>[f.geometry.type,f.properties.dash]),[['LineString','dashed']]);
  await hg.waitForFunction(([x,y])=>{
    const c=document.querySelector('canvas.atlas-flat-preview'),r=c.getBoundingClientRect();
    const rgb=c.getContext('2d').getImageData(Math.round((x-r.left-10)*c.width/r.width),
      Math.round((y-r.top-4)*c.height/r.height),Math.round(20*c.width/r.width),Math.round(8*c.height/r.height)).data;
    return rgb.some((v,i)=>i%4===0&&v===194&&rgb[i+1]===24&&rgb[i+2]===91);
  },sketch.mid);
  await hg.mouse.move(...sketch.mid);await hg.mouse.down();await hg.mouse.move(...sketch.drag,{steps:5});await hg.mouse.up();
  saved=await drawing();
  assert.equal(saved.features[0].geometry.coordinates.length,3,'midpoint drag inserts exactly one vertex');
  assert.ok(saved.features[0].geometry.coordinates[1][1]<saved.features[0].geometry.coordinates[0][1]);
  await hg.locator('#draw-close').click();
  await clickAt(sketch.drag);
  await hg.getByRole('img',{name:'Elevation along the line'}).waitFor({timeout:10000});
  assert.match(await hg.locator('#detail-content dl').innerText(),/-20 m/);
  await hg.locator('#details-close').click();
  await hg.getByRole('button',{name:'Drawing tools',exact:true}).click();
  await hg.locator('[data-draw="point"]').click();
  await clickAt(sketch.point);
  await hg.locator('[data-draw="area"]').click();
  for(const p of sketch.area)await clickAt(p);
  await hg.locator('#draw-finish').click();
  assert.deepEqual((await drawing()).features.map(f=>f.geometry.type),['LineString','Point','Polygon']);
  await hg.reload();
  await hCanvas.waitFor();
  await hg.getByRole('button',{name:'Drawing tools',exact:true}).click();
  await hg.locator('[data-draw="erase"]').click();
  await clickAt(sketch.point);
  assert.deepEqual((await drawing()).features.map(f=>f.geometry.type),['LineString','Polygon']);
  const [exported]=await Promise.all([hg.waitForEvent('download'),hg.locator('#draw-save').click()]);
  const exportedFile=await exported.path();
  assert.deepEqual(JSON.parse(await readFile(exportedFile,'utf8')),await drawing());
  await hg.locator('#draw-file').setInputFiles(exportedFile);
  await hg.getByText('Opened 2 drawings.',{exact:true}).waitFor();
  const beforeSwitch=await drawing();
  assert.deepEqual(beforeSwitch.features.map(f=>f.geometry.type),['LineString','Polygon','LineString','Polygon']);
  assert.deepEqual(await hg.evaluate(()=>window.webglAttempts),[]);
  await hg.locator('[data-draw="line"]').click();
  await hg.locator('#draw-dash').selectOption('dotted');
  await hg.locator('#draw-width').selectOption('5');
  const draftPoints=await hCanvas.evaluate(c=>{
    const r=c.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+62;
    return [[x+12,y],[x+91,y+3],[x+145,y+32]];
  });
  for(const p of draftPoints.slice(0,2))await clickAt(p);
  if(!(await hg.locator('#settings-open').isVisible()))await hg.locator('#controls-open').click();
  await hg.locator('#settings-open').click();
  // Refusing transient storage must not silently reload or lose this draft.
  await hg.evaluate(()=>{
    const old=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(this===sessionStorage&&key==='atlas_renderer_work_v1')throw new DOMException('Unavailable','QuotaExceededError');
      old.call(this,key,value);
    };
    window.restoreDrawingStorage=()=>{Storage.prototype.setItem=old;};
  });
  await hg.locator('#disable-webgl').click();
  await hg.getByText('The browser could not keep this drawing across a renderer switch. Finish the drawing before switching.').waitFor();
  assert.equal(await hg.locator('#disable-webgl').isChecked(),true);
  assert.deepEqual(await drawing(),beforeSwitch);
  await hg.evaluate(()=>window.restoreDrawingStorage());
  await Promise.all([hg.waitForEvent('load'),hg.locator('#disable-webgl').click()]);
  await hCanvas.waitFor();
  await hg.locator('#draw-toolbar').waitFor();
  assert.equal(await hg.locator('[data-draw="line"]').getAttribute('aria-pressed'),'true');
  assert.equal(await hg.locator('#draw-dash').inputValue(),'dotted');
  assert.equal(await hg.locator('#draw-width').inputValue(),'5');
  assert.equal(await hg.evaluate(()=>sessionStorage.getItem('atlas_renderer_work_v1')),null);
  assert.deepEqual(await drawing(),beforeSwitch,'renderer preference reload does not commit the draft');
  await clickAt(draftPoints[2]);
  await hg.locator('#draw-finish').click();
  const completed=(await drawing()).features.at(-1);
  assert.equal(completed.geometry.coordinates.length,3);
  assert.equal(completed.properties.dash,'dotted');
  assert.equal(completed.properties.width,5);
  assert.deepEqual(await hg.evaluate(()=>window.webglAttempts),['webgl2','webgl']);
  await hg.getByRole('button',{name:'Measure',exact:true}).click();
  assert.equal(await hg.locator('#draw-toolbar').isVisible(),false);
  for(const point of coords)await clickAt(point);
  await hg.waitForFunction(()=>!document.querySelector('#measure-finish').disabled);
  for(const name of ['Reset map to north','Zoom in','Zoom out']){
    await hg.getByRole('button',{name,exact:true}).press('Enter');
    assert.equal(await hg.locator('#measure-finish').isEnabled(),true,'Map control activation leaves measurement unfinished');
  }
  if(!(await hg.locator('#settings-open').isVisible()))await hg.locator('#controls-open').click();
  await hg.locator('#settings-open').click();
  await Promise.all([hg.waitForEvent('load'),hg.locator('#disable-webgl').click()]);
  await hCanvas.waitFor();await hg.locator('#measure-toolbar').waitFor();
  assert.equal(await hg.locator('[data-measure="distance"]').getAttribute('aria-pressed'),'true');
  assert.equal(await hg.locator('#draw-toolbar').isVisible(),false);
  assert.equal(await hg.evaluate(()=>sessionStorage.getItem('atlas_renderer_work_v1')),null);
  assert.match(await hg.locator('#measure-status').textContent(),/over 1 segment · double-click to end/);
  await hg.locator('#measure-finish').click();
  await hg.waitForFunction(()=>document.querySelector('#measure-status').textContent.includes('End to end: −143 m'),null,{timeout:10000});
  await hg.locator('#measure-profile').click();
  await hg.getByRole('img',{name:'Elevation along the line'}).waitFor({timeout:10000});
  assert.deepEqual(await hg.evaluate(()=>window.webglAttempts),[]);
  // Simulate the saved state read on renderer reload after a second tab
  // changed the original while an identical neighbour remained untouched.
  const conflict=await hg.evaluate(()=>{
    const original={type:'Feature',properties:{color:'#345678',dash:'dotted',width:5},
      geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}};
    const changed={...original,geometry:{type:'LineString',coordinates:[[0,0],[8,0]]}};
    const saved={type:'FeatureCollection',features:[changed,original]};
    localStorage.setItem('openrailwayatlas-drawing',JSON.stringify(saved));
    const points=[[0,0],[1,0],[2,1]];
    sessionStorage.setItem('atlas_renderer_work_v1',JSON.stringify({drawing:{
      mode:'line',paused:false,style:original.properties,curved:false,points,flags:[0,0,0],
      selected:null,extension:{at:0,original,unambiguous:false},
    }}));
    return {saved,points};
  });
  await hg.reload();
  await hCanvas.waitFor();
  await hg.getByText('The original line could not be identified.',{exact:false}).waitFor();
  assert.deepEqual(await drawing(),conflict.saved);
  assert.equal(await hg.evaluate(()=>sessionStorage.getItem('atlas_renderer_work_v1')),null);
  await hg.locator('#draw-finish').click();
  const recovered=await drawing();
  assert.deepEqual(recovered.features.slice(0,2).map(f=>f.geometry),conflict.saved.features.map(f=>f.geometry));
  assert.deepEqual(recovered.features[2].geometry.coordinates,conflict.points);
  await current.context.close();
  useElevationFixture=false;

  current=await fresh();
  await current.page.goto(origin+'/#0/89/5');
  await current.page.locator('canvas.atlas-flat-preview').waitFor();
  assert.deepEqual(await current.page.evaluate(()=>window.webglAttempts),['webgl2','webgl']);
  assert.equal(new URL(current.page.url()).hash,'#0/89/5');
  assert.deepEqual(await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')).c),[0,0]);
  assert.ok(Math.abs(Number((await current.page.locator('#map').getAttribute('data-flat-center')).split(',')[1])-85.05112878)<1e-6);
  await current.page.locator('canvas.atlas-flat-preview').press('ArrowDown');
  assert.equal(new URL(current.page.url()).hash,'');
  assert.ok(await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')).c[1]>0));
  await current.context.close();

  current=await fresh();
  await current.page.goto(origin);
  await ready(current.page).catch(async e=>{console.error(await current.page.locator("#map-status").textContent(),paths.slice(-35));throw e;});
  assert.deepEqual(await current.page.evaluate(()=>window.webglAttempts),['webgl2','webgl']);
  assert.ok(!paths.some(path=>path.includes('/vendor/maplibre-gl-')));
  if (!(await current.page.locator('#settings-open').isVisible())) await current.page.locator('#controls-open').click();
  await current.page.locator('#settings-open').click();
  await current.page.locator('#disable-webgl').check();
  await current.page.waitForFunction(()=>localStorage.getItem('atlas_disable_webgl')==='1' && window.webglAttempts?.length===0);
  await current.context.close();

  current=await fresh(true);
  await current.page.goto(origin);
  await ready(current.page);
  const openControls=async()=>{
    if(!(await current.page.locator('#search-input').isVisible())) await current.page.locator('#controls-open').click();
  };
  const submit=async()=>{
    await openControls();
    await current.page.locator('#search-input').fill('Demo');
    await current.page.locator('#search-input').press('Enter');
    await current.page.getByRole('button',{name:/Demo station.*Line Two/}).waitFor();
  };
  const view=()=>current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')));
  await submit();
  await current.page.getByRole('button',{name:/Demo station.*Line Two/}).click();
  let camera=await view();
  assert.ok(Math.abs(camera.c[0]+0.103)<1e-8&&Math.abs(camera.c[1]-51.501)<1e-8&&camera.z===14);
  await current.page.getByRole('heading',{name:'Demo station'}).waitFor();
  const nearby=current.page.locator('#nearby-transport');
  await nearby.getByRole('button',{name:'Fixture Bus Interchange'}).waitFor({timeout:10000}).catch(async error=>{
    console.error('Nearby state:',await nearby.textContent(), 'Map:',await current.page.locator('#map-status').textContent(),
      'Archives:',paths.filter(path=>path.endsWith('.pmtiles')));throw error;
  });
  assert.match(await nearby.innerText(),/Bus \/ coach interchange · 90 m/);
  assert.match(await nearby.innerText(),/Within 500 m in a straight line/);
  assert.ok(paths.includes('/data/nearby-fixture.pmtiles'));
  await nearby.getByRole('button',{name:'Fixture Bus Interchange'}).click();
  await current.page.getByRole('heading',{name:'Fixture Bus Interchange'}).waitFor();
  camera=await view();
  assert.ok(Math.abs(camera.c[0]-nearbyLngLat[0])<0.00002&&Math.abs(camera.c[1]-nearbyLngLat[1])<0.00002&&camera.z===14);

  await current.page.locator('#details-close').click();
  // After nearby recentering, open the same facility from its actual icon.
  const paintedBus=expected=>current.page.waitForFunction(expected=>{
    const c=document.querySelector('canvas.atlas-flat-preview'),r=c.getBoundingClientRect();
    const x=Math.round(c.width/2),y=Math.round(c.height/2);
    const d=c.getContext('2d').getImageData(x-15,y-15,31,31).data;
    const visible=d.some((v,i)=>i%4===0&&v===255&&d[i+1]===254&&d[i+2]===248&&d[i+3]===255);
    return visible===expected?[r.left+x*r.width/c.width,r.top+y*r.height/c.height]:null;
  },expected,{timeout:10000});
  const clickPoint=await (await paintedBus(true)).jsonValue();
  await current.page.mouse.click(...clickPoint);
  await current.page.getByRole('heading',{name:'Fixture Bus Interchange'}).waitFor();
  await current.page.locator('#details-close').click();
  if(!(await current.page.locator('#settings-open').isVisible()))await current.page.locator('#controls-open').click();
  await current.page.locator('#settings-open').click();
  await current.page.locator('#transport').uncheck();
  await paintedBus(false);
  await current.page.locator('#settings-close').click();
  await current.page.mouse.click(...clickPoint);
  assert.equal(await current.page.getByRole('heading',{name:'Fixture Bus Interchange'}).isVisible(),false);
  await current.page.locator('#settings-open').click();
  await current.page.locator('#transport').check();
  await current.page.locator('#settings-close').click();
  await paintedBus(true);
  await submit();
  await current.page.getByRole('button',{name:/Demo town/}).click();
  camera=await view();
  assert.ok(Math.abs(camera.c[0]+0.2)<1e-8&&Math.abs(camera.c[1]-51.6)<0.001&&camera.z>=8&&camera.z<14);
  assert.deepEqual(await current.page.evaluate(()=>window.webglAttempts),[]);
  await current.context.close();

  current=await fresh(true);
  await current.page.goto(origin);
  await ready(current.page);
  const touches=await current.page.evaluate(()=>{
    const canvas=document.querySelector('canvas.atlas-flat-preview'),r=canvas.getBoundingClientRect();
    const x=r.left+r.width/2,y=r.top+r.height/2,captures=[];
    // Firefox's fixture driver cannot inject simultaneous native touches.
    // DOM events exercise the actual entry, listeners and storage; only native capture is substituted.
    canvas.setPointerCapture=id=>captures.push(id);
    const emit=(type,id,dx,dy)=>canvas.dispatchEvent(new PointerEvent(type,{
      pointerId:id,pointerType:'touch',button:type==='pointermove'?-1:0,clientX:x+dx,clientY:y+dy,
    }));
    const persisted=()=>JSON.parse(localStorage.getItem('atlas_view'));
    const center=()=>document.querySelector('#map').dataset.flatCenter;
    const initial=persisted();
    emit('pointerdown',1,-50,0);emit('pointerdown',2,50,0);
    emit('pointermove',1,-100,0);emit('pointermove',2,100,0);
    emit('pointerup',1,-100,0);
    const firstUp=persisted();
    emit('lostpointercapture',1,-100,0);
    emit('pointerup',2,100,0);
    const zoomed=persisted(),beforeCancel=center();
    emit('pointerdown',3,-50,0);emit('pointerdown',4,50,0);
    emit('pointermove',3,-80,40);emit('pointermove',4,140,40);
    const duringCancel=center();
    emit('pointercancel',4,140,40);emit('pointerup',3,-80,40);
    return {captures,initial,firstUp,zoomed,beforeCancel,duringCancel,afterCancel:center(),persisted:persisted()};
  });
  assert.deepEqual(touches.captures,[1,2,3,4]);
  assert.deepEqual(touches.firstUp,touches.initial);
  assert.equal(touches.zoomed.z,1);
  assert.ok(touches.zoomed.c.every(value=>Math.abs(value)<0.001));
  assert.notEqual(touches.duringCancel,touches.beforeCancel);
  assert.equal(touches.afterCancel,touches.beforeCancel);
  assert.deepEqual(touches.persisted,touches.zoomed);
  assert.equal(await current.page.getByRole('heading',{name:'Fixture Station'}).isVisible(),false);
  await current.page.reload();
  await current.page.locator("canvas.atlas-flat-preview").waitFor();
  assert.deepEqual(await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view'))),touches.zoomed);
  await current.context.close();

  current=await fresh(true);
  await current.page.goto(origin);
  await ready(current.page);
  const localInput=current.page.getByRole('searchbox',{name:'Find a station, railway facility or place'});
  if(!await localInput.isVisible())await current.page.locator('#controls-open').click();
  // The map's own vector tile should work even with both search endpoints down.
  await localInput.fill('Fixture Station');await localInput.press('Enter');
  const localResult=current.page.locator('#search-results').getByRole('button',{name:/Fixture Station/});
  await localResult.waitFor({timeout:15000});
  assert.equal(await localResult.count(),1);
  await localResult.click();
  await current.page.getByRole('heading',{name:'Fixture Station'}).waitFor();
  const localView=await current.page.evaluate(()=>JSON.parse(localStorage.getItem('atlas_view')));
  assert.equal(localView.z,14);
  assert.ok(Math.abs(localView.c[0])<1e-8&&localView.c[1]<-35&&localView.c[1]>-38);
  await current.context.close();

  await verifyStartupFallback();
  console.log('Firefox real Atlas entry: rails and point/line labels painted with automatic and explicit Canvas, no GL library/CSS, preference persisted, station toggling repainted without remount or rail refetch, rails and stations inspected, search destinations selected, loaded station found despite remote outage and nearby transport and its painted icon opened, drawing created, edited, profiled, restored and round-tripped as GeoJSON, in-progress measurement restored and profiled after renderer preference reload, pan committed, simulated multi-touch zoom and cancellation verified, passive polar view preserved, actual constructor context refusal and separate missing renderer JS/CSS recovered without reloading, and style errors surfaced.');
  }
} finally {await browser?.close();server.close();}
