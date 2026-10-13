// Real renderer, synthetic Shanghai geometry; all external traffic is fixtured.
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {MODES} from '../styles/map-model.mjs';

const base='http://127.0.0.1:4173/';
const center=[121.42631,31.18992];
const coordinates=[[121.41,31.12],[121.43,31.20],[121.45,31.28]];
const rail={type:'Feature',properties:{id:'fixture-shanghai-mainline',class:'rail',subclass:'rail'},geometry:{type:'LineString',coordinates}};
const metro={type:'Feature',properties:{id:'fixture-shanghai-metro',class:'transit',subclass:'subway'},geometry:{type:'LineString',coordinates:coordinates.map(([x,y])=>[x+.025,y])}};
const road={...rail,properties:{id:'fixture-road',class:'primary'}};
const detailed=[rail,metro].map((f,i)=>({...f,properties:{id:f.properties.id,feature:i?'subway':'rail',state:'present',usage:'main',maxspeed:120,gaugeint0:1435}}));
const station={type:'Feature',properties:{id:'fixture-station',feature:'station',station:'train',state:'present',station_size:'large',name:'Shanghai fixture'},geometry:{type:'Point',coordinates:center}};
const index=features=>geojsonvt({type:'FeatureCollection',features},{maxZoom:16,indexMaxZoom:7,extent:4096,buffer:64});
const basemap=index([rail,metro,road]),tracks=index(detailed),stations=index([station]);
const tile=(index,layer,z,x,y)=>{const data=index.getTile(+z,+x,+y);return data?.features.length?Buffer.from(vtpbf.fromGeojsonVt({[layer]:data},{version:2})):Buffer.alloc(0)};
const browser=await launchBrowser({headless:true});
const context=await browser.newContext({viewport:{width:360,height:760}});
const reports=[],errors=[];let provider='empty';
try{
 await installEmptyMapProviders(context,base);
 const basemapTiles={};
 for(let z=8;z<=14;z++){
  const n=2**z,xt=lon=>Math.floor((lon+180)/360*n),yt=lat=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n);
  for(let x=xt(121.39);x<=xt(121.50);x++)for(let y=yt(31.30);y<=yt(31.10);y++){
   const data=tile(basemap,'transportation',z,x,y);if(data.length)basemapTiles[`${z}/${x}/${y}`]=[...data];
  }
 }
 // Extend the existing synthetic PMTiles transport with basemap rail bytes;
 // the production basemap source and atlasbase localization path stay intact.
 await context.addInitScript(tiles=>{
  let pmtiles;
  const patch=value=>{if(!value)return value;const Protocol=value.Protocol;
   return {...value,Protocol:class extends Protocol{
    tile=async params=>({data:params.type==='json'?{tilejson:'3.0.0',minzoom:0,maxzoom:14,tiles:['pmtiles://fixture/{z}/{x}/{y}']}:
     new Uint8Array(tiles[/\/(\d+\/\d+\/\d+)$/.exec(params.url)?.[1]]||[]).buffer});
   }};
  };
  pmtiles=patch(window.pmtiles);
  Object.defineProperty(window,'pmtiles',{configurable:true,get:()=>pmtiles,set:value=>{pmtiles=patch(value)}});
 },basemapTiles);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const style=JSON.parse(await readFile('styles/world.style.json','utf8'));
 style.sources.stationMajor.data={type:'FeatureCollection',features:[]};
 await page.route('**/world.style.json*',route=>route.fulfill({json:style}));
 await page.route('https://openrailwaymap.app/**',route=>{
  const m=/^\/([^/]+)\/(\d+)\/(\d+)\/(\d+)$/.exec(new URL(route.request().url()).pathname);
  if(!m)return route.fallback();
  const [,layer,z,x,y]=m;
  if(layer==='railway_line_high'&&provider==='error')return route.fulfill({status:403,body:'synthetic access error'});
  const data=layer==='standard_railway_text_stations'?tile(stations,layer,z,x,y):layer==='railway_line_high'&&provider==='healthy'?tile(tracks,layer,z,x,y):Buffer.alloc(0);
  return route.fulfill({contentType:'application/x-protobuf',body:data});
 });
 const open=async(mode,background='map',zoom=10.9)=>{
  await page.goto(`${base}?mode=${mode}&background=${background}&language=en&relief=0&inactive=0&transport=0&destinations=0&constraints=0#${zoom}/${center[1]}/${center[0]}`);
  await page.waitForSelector('body[data-map-ready="true"]',{timeout:60000});
  await page.evaluate(async()=>{window.referenceMap=(await import(document.querySelector('script[type="module"]').src)).map});
  await page.waitForFunction(()=>window.referenceMap.loaded(),null,{timeout:60000});
  const report=await page.evaluate(mode=>{
   const map=window.referenceMap,hasReference=Boolean(map.getLayer('rail-basemap-reference'));
   return {mode,zoom:map.getZoom(),hasReference,reference:hasReference?map.queryRenderedFeatures({layers:['rail-basemap-reference']}).map(f=>f.properties.id):[],
    tracks:map.queryRenderedFeatures({layers:[`${mode}-tracks`]}).map(f=>f.properties.id),stations:map.queryRenderedFeatures({layers:['station-provider-dots']}).length,
    status:document.querySelector('#map-status').textContent,error:document.querySelector('#map-status').classList.contains('error')};
  },mode);reports.push({provider,background,...report});return report;
 };
 for(const mode of MODES){
  const report=await open(mode);
  assert.ok(report.hasReference,'Detailed zooms need a railway reference independent of the detailed provider');
  for(const id of ['fixture-shanghai-mainline','fixture-shanghai-metro'])assert.ok(report.reference.includes(id),`${mode}: missing ${id}`);
  assert.ok(!report.reference.includes('fixture-road'),'Road geometry must never become rail');
  assert.equal(report.tracks.length,0);assert.ok(report.stations>0,'Station loading alone cannot prove railway loading');
  assert.match(report.status,/reference.*detailed railway data/i);
 }
 for(const background of ['carto','hybrid'])assert.ok((await open('infrastructure',background)).reference.length>0,`${background} keeps reference rails`);
 assert.equal((await open('infrastructure','satellite')).reference.length,0,'Satellite-only hides railway overlays');
 provider='healthy';
 for(const mode of MODES){const report=await open(mode);assert.ok(report.tracks.length>0,`${mode}: detailed rails must remain above the reference`);assert.doesNotMatch(report.status,/Only.*reference/i)}
 provider='error';
 const failed=await open('infrastructure');assert.ok(failed.reference.length>0);assert.equal(failed.tracks.length,0);assert.ok(failed.error,'Reference must not conceal a real provider error');
 assert.deepEqual(errors,[]);
 await mkdir('browser-review',{recursive:true});
 await page.screenshot({path:'browser-review/shanghai-rail-reference.png'});
 await writeFile('browser-review/shanghai-rail-reference.json',JSON.stringify(reports,null,2));
 console.log('Shanghai rail reference:',reports.length,'real-renderer cases passed');
}finally{await browser.close()}
