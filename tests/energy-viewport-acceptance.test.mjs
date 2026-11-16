import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {energyCandidateCameras,ENERGY_CAMERAS,ENERGY_VIEWPORTS,energyAcceptanceStyle,energyFixtureFiles,energyResponseRecord,summarizeEnergyDemand,assertEnergyDemand} from '../scripts/energy-viewport-acceptance.mjs';
import {createEnergyNetworkProtocol} from '../styles/energy-network.mjs';
const call='energynetwork://overview/5/16/15';
const receipt=(path,size)=>energyResponseRecord(path,Buffer.alloc(size));
const input=()=>({protocolRequests:[call],requests:[receipt('manifest.json',100),receipt('overview/index.json',100),receipt('overview/5/16/15.bundle.gz',100000)]});
test('cold viewport accounts metadata and every repeated compressed response, not unique bundles',()=>{
 const data=input();data.requests.push(data.requests[2]);const result=assertEnergyDemand(data);
 assert.equal(result.bytes,200200);assert.equal(result.metadataBytes,200);assert.equal(result.bundleBytes,200000);assert.equal(result.repeatedResponses,1);
 data.requests.push(receipt('overview/5/17/15.bundle.gz',149800));assert.throws(()=>assertEnergyDemand(data),/350000/,'exact limit fails');
});
test('failed, absent and malformed acceptance evidence never certifies a viewport',()=>{
 for(const edit of [d=>d.errors=['decode failed'],d=>d.protocolRequests=[],d=>d.requests=[],d=>d.requests[0].status=404,d=>d.requests[0].bytes=NaN,d=>d.requests[0].sha256='',d=>d.requests[0].path='../secret']){
  const data=input();edit(data);assert.throws(()=>assertEnergyDemand(data));
 }
 assert.equal(assertEnergyDemand({active:false,requests:[],protocolRequests:[]}).bytes,0);
 assert.throws(()=>assertEnergyDemand({...input(),active:false}));
});
test('actual production protocol requests match ledger metadata and compressed fixture bundles',async()=>{
 const files=energyFixtureFiles(),requests=[],protocolRequests=[];
 const protocol=createEnergyNetworkProtocol({root:new URL('https://fixture.invalid/data/energy-network/'),active:()=>true,fetcher:async url=>{
  const path=new URL(url).pathname.split('/data/energy-network/')[1],body=files.get(path);assert.ok(body,path);
  requests.push(energyResponseRecord(path,body));return new Response(body);
 }});
 for(let i=0;i<2;i++){protocolRequests.push(call);const {data}=await protocol({url:call},new AbortController());assert.ok(data.byteLength>0);}
 assert.deepEqual(requests.map(r=>r.path),['manifest.json','overview/index.json','overview/5/16/15.bundle.gz']);
 assert.equal(summarizeEnergyDemand({requests,protocolRequests}).protocolRequests,2);
 assert.equal(assertEnergyDemand({requests,protocolRequests}).repeatedResponses,0,'shared reader coalesces same bundle');
});
test('camera matrix covers rotation, pitch, globe, tier boundaries, overscale and dateline',()=>{
 for(const zoom of [5,7.75,8,11.75,12,14,16]){
  const cases=ENERGY_CAMERAS.filter(c=>c.zoom===zoom);assert.equal(cases.length,6);assert.ok(cases.some(c=>c.pitch===80));assert.ok(cases.some(c=>c.projection==='globe'&&c.pitch===60));assert.ok(cases.some(c=>c.projection==='mercator'&&c.pitch===60&&c.bearing!==0));assert.ok(cases.some(c=>c.pitch===0&&c.bearing!==0));
 }
 assert.ok(ENERGY_CAMERAS.some(c=>c.center[0]>179));assert.ok(ENERGY_CAMERAS.some(c=>c.center[1]>64));assert.equal(ENERGY_VIEWPORTS.length,2);
});
test('sampling preserves production energy layer/source definitions and mode visibility',async()=>{
 const world=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
 const active=energyAcceptanceStyle(world),inactive=energyAcceptanceStyle(world,false);
 assert.equal(Object.keys(active.sources).length,3);assert.equal(active.layers.length,world.layers.filter(l=>l.source?.startsWith('energyNetwork')).length);
 assert.ok(active.layers.every(l=>l.layout.visibility==='visible'));assert.ok(inactive.layers.every(l=>l.layout.visibility==='none'));
 for(const layer of active.layers){const original=world.layers.find(l=>l.id===layer.id);assert.deepEqual(layer.paint,original.paint);assert.deepEqual(layer.filter,original.filter);assert.equal(layer.minzoom,original.minzoom);assert.equal(layer.maxzoom,original.maxzoom);}
});

test('candidate hotspots target actual bundles and reject empty metadata-only candidates',async()=>{
 const files=energyFixtureFiles(),read=async path=>{assert.ok(files.has(path),path);return files.get(path);},size=async path=>(await read(path)).length;
 const cameras=await energyCandidateCameras('',{read,size});assert.equal(cameras.length,18);
 for(const camera of cameras.filter(c=>c.expectedBundle)){assert.ok(files.has(camera.expectedBundle));assert.ok(camera.center.every(Number.isFinite));assert.equal(camera.pitch,0);}
 for(const key of files.keys())if(key.endsWith('index.json'))files.set(key,Buffer.from('{"bundles":[]}'));
 await assert.rejects(energyCandidateCameras('',{read,size}),/populated hotspot/);
});
