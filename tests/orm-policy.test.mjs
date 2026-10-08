import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchLoopbackNoRedirect, localOrmAuditTarget, localOrmFulfillOptions} from '../scripts/browser-policy.mjs';
import {installEmptyMapProviders} from '../scripts/browser-renderer-fixture.mjs';

function fakeFixtureContext() {
  const state={initScripts:0};
  return {state,
    addInitScript: async()=>{state.initScripts++;},
    route: async (_match,handler)=>{state.handler=handler;},
  };
}
function fakeRoute(url) {
  const result={};
  return {result, route:{
    request:()=>({url:()=>url}),
    continue:async()=>{result.continued=true;},
    fulfill:async value=>{result.fulfilled=value;},
  }};
}
function fakeResponse(value,{status=200,headers={'content-type':'application/json'}}={}) {
  const body=Buffer.isBuffer(value)?value:Buffer.from(value);
  return {status:()=>status,headers:()=>headers,body:async()=>body};
}

test('deployment fixture mode leaves deployed first-party style and data untouched', async()=>{
  const base='https://example.invalid/openrailwaystyle/';
  const context=fakeFixtureContext();
  await installEmptyMapProviders(context,base,{firstParty:'network',rendererAssets:new Map()});
  assert.equal(context.state.initScripts,0,'deployment must not replace the deployed PMTiles client/data path');
  for(const path of ['world.style.json','data/manifest.json','major-stations.geojson']){
    const {route,result}=fakeRoute(base+path);await context.state.handler(route);
    assert.equal(result.continued,true,path+' must come from the deployed site');
    assert.equal(result.fulfilled,undefined,path+' must not be fulfilled from checkout fixtures');
  }
});

test('station audit accepts natural loopback tile URLs and still rewrites public provider URLs',()=>{
  const local='http://localhost:4174/standard_railway_text_stations_low/7/1/2.pbf?lang=en';
  assert.equal(localOrmAuditTarget(local,'http://127.0.0.1:4174/root/'),local);
  assert.equal(localOrmAuditTarget('https://openrailwaymap.app/standard_railway_text_stations_low/7/1/2.pbf?lang=en','http://127.0.0.1:4174/root/'),
    'http://127.0.0.1:4174/root/standard_railway_text_stations_low/7/1/2.pbf?lang=en');
  assert.throws(()=>localOrmAuditTarget('https://mirror.example/standard_railway_text_stations_low/7/1/2.pbf','http://127.0.0.1:4174/'),/only from loopback/i);
});

test('local station fetch rejects redirects before they can be fulfilled to Chromium',async()=>{
  let options;
  const redirect={status:()=>302};
  await assert.rejects(fetchLoopbackNoRedirect({fetch:async value=>(options=value,redirect)},'http://127.0.0.1:4174/stations'),/redirected/i);
  assert.deepEqual(options,{url:'http://127.0.0.1:4174/stations',maxRedirects:0});
  const ok={status:()=>200};
  assert.equal(await fetchLoopbackNoRedirect({fetch:async()=>ok},'http://localhost:4174/stations'),ok);
});

test('local TileJSON exposes only loopback tile templates to Chromium',async()=>{
  const mirror='http://127.0.0.1:4174/root/';
  const target=mirror+'railway_line_high';
  const response=fakeResponse(JSON.stringify({tilejson:'3.0.0',tiles:[
    'https://openrailwaymap.app/railway_line_high/{z}/{x}/{y}',
    './tiles/{z}/{x}/{y}.pbf?ratio={ratio}',
    'http://[::1]:4175/local/{z}/{x}/{y}.pbf',
  ]}),{headers:{'content-type':'application/json','content-length':'999','content-encoding':'gzip','x-test':'kept'}});
  const safe=await fetchLoopbackNoRedirect({fetch:async()=>response},target,mirror);
  const options=safe.routeFulfillOptions();
  assert.equal(safe.status(),200);
  assert.equal(String(await safe.body()),String(options.body));
  assert.equal(options.status,200);
  assert.deepEqual(JSON.parse(String(options.body)).tiles,[
    'http://127.0.0.1:4174/root/railway_line_high/{z}/{x}/{y}',
    'http://127.0.0.1:4174/root/tiles/{z}/{x}/{y}.pbf?ratio={ratio}',
    'http://[::1]:4175/local/{z}/{x}/{y}.pbf',
  ]);
  assert.equal(options.headers['content-length'],undefined);
  assert.equal(options.headers['content-encoding'],undefined);
  assert.equal(options.headers['x-test'],'kept');
  await assert.rejects(fetchLoopbackNoRedirect({fetch:async()=>fakeResponse(JSON.stringify({tiles:['https://tiles.example/{z}/{x}/{y}.pbf']}))},target,mirror),/non-loopback tile URL/i);
});
