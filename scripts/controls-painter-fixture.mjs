import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import vtpbf from 'vt-pbf';
import {rendererFixture,emptyReferenceFixture} from './browser-renderer-fixture.mjs';
import {MAPLIBRE_BACKPORT} from '../styles/map-controls.mjs';
import {depthFixturePng} from './bathymetry-browser-fixture.mjs';

const hash=body=>createHash('sha256').update(body).digest('hex');
export function comparePixelBytes(original,candidate){
 assert.ok(original&&candidate,'Both pixel arms must exist');
 assert.equal(original.length,512*512*4,'Original pixel buffer is complete');
 assert.equal(candidate.length,original.length,'Candidate pixel buffer is complete');
 let changedBytes=0;for(let i=0;i<original.length;i++)if(original[i]!==candidate[i])changedBytes++;
 return changedBytes;
}
export async function controlsPainterManifest(){
 const sources={
  'node_modules/maplibre-gl/src/render/painter.ts':'bf19980d31838a1e6d32cd940673bcb7b367fb102af426050afd5555abd913c0',
  'node_modules/maplibre-gl/src/style/style_layer.ts':'6b3730cb2721888003d5d2a00af23ff80506650b0e8197315d7f9f20b5f62fce',
  'node_modules/maplibre-gl/src/tile/tile.ts':'e40cf65d5ff780cc1cbd043196c8e5487814c31268f4fd3386befb0778aa6aab',
  'node_modules/maplibre-gl/dist/maplibre-gl.js':MAPLIBRE_BACKPORT.upstreamSha256,
  'node_modules/maplibre-gl/dist/maplibre-gl.js.map':'a09ebdfe7d8a259b7c67a470caa2d4e57d31262bc99020ec41983d3325fa9901',
  [`styles/${MAPLIBRE_BACKPORT.target}`]:MAPLIBRE_BACKPORT.sha256,
 };
 for(const [file,expected] of Object.entries(sources))assert.equal(hash(await readFile(file)),expected,file);
 const inputs={};
 for(const file of ['scripts/controls-painter-probe.mjs','scripts/controls-painter-fixture.mjs','scripts/check-controls-painter-browser.mjs','styles/app.mjs','styles/world.style.json','styles/request-pool.mjs','styles/tile-labels.mjs'])inputs[file]=hash(await readFile(file));
 return {renderer:'MapLibre 5.24.0 atlas.1 attribution-only backport',sourceCommit:process.env.GITHUB_SHA||null,pullRequestHead:process.env.ATLAS_DIAGNOSTIC_HEAD||null,sources,inputs,settlementDeadlineMs:60000,arms:['baseline','hidden-mask-guard'],repetitionsPerArm:1,productionChanges:false};
}

export const nonemptyMaskTile=Buffer.from(vtpbf.fromGeojsonVt({fixture:{extent:4096,features:[
 {id:1,type:3,tags:{kind:'area'},geometry:[[[-64,-64],[4160,-64],[4160,4160],[-64,4160],[-64,-64]]]},
 {id:2,type:2,tags:{kind:'line'},geometry:[[[-512,768],[4608,3328]]]},
 {id:3,type:2,tags:{kind:'line'},geometry:[[[-512,3328],[4608,768]]]},
]}}));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==','base64');

// Match the original controls provider fixtures, including empty glyph bodies.
// The global browser-network guard remains the final pre-egress boundary.
export async function installControlsPainterFixtures(context,base,lifecycle){
 const style=JSON.parse(await readFile('styles/world.style.json','utf8'));
 style.sources.stationMajor.data={type:'FeatureCollection',features:[]};
 const renderer=await rendererFixture(base),probe=await readFile(new URL('./controls-painter-probe.mjs',import.meta.url));
 await context.addInitScript(()=>{window.pmtiles={Protocol:class{tiles=new Map();tile=async params=>({data:params.type==='json'?{tilejson:'3.0.0',minzoom:0,maxzoom:14,tiles:['pmtiles://fixture/{z}/{x}/{y}']}:new ArrayBuffer(0)});},FetchSource:class{getKey(){return 'fixture';}},PMTiles:class{}};});
 const counts={provider:0,nonempty:0,dem:0,unknown:0};
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const fulfill=async options=>{await route.fulfill(options);lifecycle?.fulfilled(request);};
  const asset=renderer.get(url.href);if(asset)return fulfill(asset);
  if(url.href.startsWith(base)){
   if(path.endsWith('/__controls-painter-probe.mjs'))return fulfill({body:probe,contentType:'text/javascript'});
   if(path.endsWith('/__controls-painter-pixels'))return fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><style>body{margin:0;overflow:hidden}#map{width:2048px;height:2048px;transform:scale(.25);transform-origin:0 0}</style><div id="map"></div>'});
   if(path.includes('/__controls-mask-tiles/')){counts.nonempty++;return fulfill({contentType:'application/x-protobuf',body:nonemptyMaskTile});}
   if(path.includes('/__controls-mask-dem/')){counts.dem++;const match=/\/(\d+)\/(\d+)\/\d+\.png$/.exec(path);assert.ok(match);return fulfill({contentType:'image/png',body:depthFixturePng(+match[1],+match[2])});}
   if(path.endsWith('/major-stations.geojson'))return fulfill({json:{type:'FeatureCollection',features:[]}});
   if(path.endsWith('/world.style.json'))return fulfill({json:style});
   const reference=emptyReferenceFixture(path);if(reference)return fulfill(reference);
   if(path.includes('/data/polar/'))return fulfill({status:404,body:''});
   if(path.includes('/data/'))return fulfill({json:{tiles:[],features:[],countries:{}}});
   return route.continue();
  }
  counts.provider++;
  if(/\.(png|jpg|jpeg)$/.test(path))return fulfill({contentType:'image/png',body:png});
  if(/\/\d+\/\d+\/\d+(?:\.pbf)?$|\/fonts\//.test(path))return fulfill({contentType:'application/x-protobuf',body:Buffer.alloc(0)});
  return fulfill({json:{tilejson:'3.0.0',minzoom:0,maxzoom:16,tiles:['https://fixture.invalid/{z}/{x}/{y}']}});
 });
 return counts;
}

export function nonemptyPainterStyle(base){
 const sources=Object.fromEntries(['A','B','hidden'].map(id=>[id,{type:'vector',minzoom:0,maxzoom:4,tiles:[`${base}__controls-mask-tiles/${id}/{z}/{x}/{y}.pbf`]}]));
 sources.dem={type:'raster-dem',tileSize:256,encoding:'terrarium',minzoom:0,maxzoom:4,tiles:[`${base}__controls-mask-dem/{z}/{x}/{y}.png`]};
 const layers=[{id:'background',type:'background',paint:{'background-color':'#ffffff'}}];
 for(let i=0;i<16;i++){
  layers.push({id:`fill-${i}`,type:'fill',source:i%2?'A':'B','source-layer':'fixture',filter:['==','kind','area'],paint:{'fill-color':i%2?'#d5e8f5':'#e9e2c6','fill-opacity':i<8?1:.35}});
  layers.push({id:`hidden-${i}`,type:'line',source:'hidden','source-layer':'fixture',filter:['==','kind','line'],layout:{visibility:'none'},paint:{'line-color':'#e52238','line-width':32}});
 }
 layers.push({id:'lines',type:'line',source:'A','source-layer':'fixture',filter:['==','kind','line'],paint:{'line-color':'#122f83','line-width':12,'line-opacity':.8}});
 layers.push({id:'zoom-line',type:'line',source:'B','source-layer':'fixture',minzoom:4,paint:{'line-color':'#16843d','line-width':8}});
 layers.push({id:'hidden-toggle',type:'line',source:'A','source-layer':'fixture',filter:['==','kind','line'],layout:{visibility:'none'},paint:{'line-color':'#e52238','line-width':24}});
 return {version:8,transition:{duration:0,delay:0},sources,layers};
}
