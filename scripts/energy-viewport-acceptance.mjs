// Sampled cold renderer demand, separate from the worldwide north-up bound.
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {decodeBundle} from '../styles/tile-bundles.mjs';
import {createHash} from 'node:crypto';
import {networkTiles} from './build-extract-energy-network.mjs';
import {heritageBundles} from './heritage-data.mjs';
import {ENERGY_TIERS} from './energy-network-schema.mjs';
import {layerVisibility} from '../styles/layer-semantics.mjs';
export const ENERGY_VIEWPORT_BUDGET=350000;
export const ENERGY_VIEWPORTS=[{width:1365,height:900,deviceScaleFactor:1},{width:412,height:915,deviceScaleFactor:2.625}];
export const ENERGY_CENTRES=[[0.001,0.001],[-51.72,64.18],[179.99,20]];
export const ENERGY_CAMERAS=[5,7.75,8,11.75,12,14,16].flatMap((zoom,i)=>[
 {projection:'mercator',bearing:0,pitch:0},
 {projection:'mercator',bearing:45,pitch:0},
 {projection:'mercator',bearing:135,pitch:60},
 {projection:'globe',bearing:45,pitch:60},
 {projection:'mercator',bearing:45,pitch:80},
 {projection:'globe',bearing:135,pitch:80},
].map(camera=>({...camera,zoom,center:ENERGY_CENTRES[i%ENERGY_CENTRES.length]})));
export function energyAcceptanceStyle(world,active=true){
 const settings={mode:active?'electrification':'infrastructure',background:'map',inactive:true,labels:true};
 const sources=Object.fromEntries(Object.entries(world.sources).filter(([id])=>id.startsWith('energyNetwork')));
 assert.equal(Object.keys(sources).length,3,'production energy sources required');
 const layers=world.layers.filter(layer=>layer.source in sources).map(layer=>({...layer,layout:{...layer.layout,visibility:layerVisibility(layer,settings)?'visible':'none'}}));
 assert.ok(layers.length>0,'production energy layers required');
 return {version:8,glyphs:world.glyphs,sources,layers};
}
export function energyFixtureFiles(){
 const data={type:'FeatureCollection',features:ENERGY_CENTRES.map((coordinates,id)=>({type:'Feature',id,properties:{power_state:'present',energy_minzoom:5,energy_domain:'electricity',supply_tier:'civil_network'},geometry:{type:'Point',coordinates}}))};
 const files=new Map();let count=0,bytes=0;
 for(const [tier,{minzoom,maxzoom,bundleZoom}] of Object.entries(ENERGY_TIERS)){
  const bundles=heritageBundles(networkTiles(data,{minZoom:minzoom,maxZoom:maxzoom}),bundleZoom);
  files.set(`${tier}/index.json`,Buffer.from(JSON.stringify({format:'atlas-tile-bundle-1',zoom:bundleZoom,bundles:[...bundles.keys()].map(key=>key.split('/').slice(1).join('/'))})));
  for(const [key,body] of bundles){files.set(`${tier}/${key}.bundle.gz`,body);count++;bytes+=body.length;}
 }
 files.set('manifest.json',Buffer.from(JSON.stringify({schema:2,dataset:'energy-network',complete:true,format:'atlas-tile-bundle-1',minzoom:5,maxzoom:14,selectionFilters:{region:'synthetic',gap:'synthetic'},bundles:count,bytes})));
 return files;
}
export function energyResponseRecord(path,body,status=200){
 assert.ok(path==='manifest.json'||/^(overview|context|detail)\/(index\.json|\d+\/\d+\/\d+\.bundle\.gz)$/.test(path),'unexpected energy path');
 return {path,status,bytes:body.byteLength,sha256:createHash('sha256').update(body).digest('hex')};
}
export function summarizeEnergyDemand({requests,protocolRequests,errors=[],active=true}){
 assert.deepEqual(errors,[],'renderer or transport failure invalidates sample');
 assert.ok(Array.isArray(requests)&&Array.isArray(protocolRequests),'request evidence required');
 for(const record of requests){
  assert.equal(record.status,200,'failed response invalidates sample');
  assert.ok(Number.isSafeInteger(record.bytes)&&record.bytes>=0,'body bytes required');
  assert.match(record.sha256,/^[a-f0-9]{64}$/,'body identity required');
  energyResponseRecord(record.path,Buffer.alloc(0));
 }
 if(active){assert.ok(protocolRequests.length>0,'renderer must request energy tiles');assert.ok(requests.some(r=>r.path==='manifest.json'),'cold manifest required');assert.ok(requests.some(r=>r.path.endsWith('/index.json')),'tier index required');}
 else{assert.equal(protocolRequests.length,0,'inactive view issued a protocol request');assert.equal(requests.length,0,'inactive view fetched energy bytes');}
 for(const url of protocolRequests)assert.match(url,/^energynetwork:\/\/(overview|context|detail)\/\d+\/\d+\/\d+$/);
 const unique=new Map(requests.map(r=>[r.path,r]));
 const bytes=requests.reduce((n,r)=>n+r.bytes,0),metadataBytes=requests.filter(r=>r.path.endsWith('.json')).reduce((n,r)=>n+r.bytes,0);
 return {bytes,metadataBytes,bundleBytes:bytes-metadataBytes,requests:requests.length,uniqueFiles:unique.size,repeatedResponses:requests.length-unique.size,protocolRequests:protocolRequests.length,budget:ENERGY_VIEWPORT_BUDGET,withinBudget:bytes<ENERGY_VIEWPORT_BUDGET};
}
export function assertEnergyDemand(input){const result=summarizeEnergyDemand(input);assert.ok(result.withinBudget,`Energy viewport requires ${result.bytes} bytes; must be below ${ENERGY_VIEWPORT_BUDGET}`);return result;}

// The largest compressed bundle in each populated tier supplies a real-data
// hotspot. Choose an actual contained tile, not the possibly empty bundle centre.
export async function energyCandidateCameras(root,{read=readFile,size=async path=>(await stat(path)).size}={}){
 const cameras=[];
 for(const [tier,{bundleZoom}] of Object.entries(ENERGY_TIERS)){
  const index=JSON.parse(await read(join(root,tier,'index.json')));let largest;
  for(const key of index.bundles){const path=`${tier}/${bundleZoom}/${key}.bundle.gz`,bytes=await size(join(root,path));if(!largest||bytes>largest.bytes)largest={path,bytes};}
  if(!largest)continue;
  const tiles=[...decodeBundle(gunzipSync(await read(join(root,largest.path))))].sort((a,b)=>b[1].byteLength-a[1].byteLength);
  assert.ok(tiles.length,'candidate hotspot requires a populated bundle');
  const [zoom,x,y]=tiles[0][0].split('/').map(Number),n=2**zoom;
  const center=[(x+.5)/n*360-180,Math.atan(Math.sinh(Math.PI*(1-2*(y+.5)/n)))*180/Math.PI];
  cameras.push(...ENERGY_CAMERAS.slice(0,6).map(camera=>({...camera,zoom,center,hotspot:largest.path,expectedBundle:camera.pitch===0&&camera.bearing===0?largest.path:null})));
 }
 assert.ok(cameras.length,'candidate must provide a populated hotspot');return cameras;
}
