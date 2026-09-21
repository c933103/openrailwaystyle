import test from 'node:test';
import assert from 'node:assert/strict';
import {viewBox, inactiveQuery, toGeoJSON, createInactiveOverlay} from '../styles/inactive.mjs';
const bounds = (w,s,e,n) => ({getWest:()=>w,getSouth:()=>s,getEast:()=>e,getNorth:()=>n});
const geo = [{lon:1,lat:50},{lon:2,lat:50},null,{lon:3,lat:50},{lon:4,lat:50}];

test('regional queries are viewport-bounded and support the antimeridian', () => {
  assert.deepEqual(viewBox(bounds(179,-10,181,-8)),[-10,179,-8,-179]);
  assert.equal(viewBox(bounds(-100,-30,100,30)),null);
  assert.match(inactiveQuery([50,-1,51,1]),/out tags geom\(50,-1,51,1\)/);
  assert.match(inactiveQuery([50,-1,51,1]),/abandoned/);
  assert.match(inactiveQuery([50,-1,51,1]),/railway\$/);
});
test('lifecycle tags survive conversion without imaginary bridges or active tracks', () => {
  const json = {elements:[
    {type:'way',id:1,tags:{railway:'abandoned',name:'Old line'},geometry:geo},
    {type:'way',id:2,tags:{'razed:railway':'rail',highway:'cycleway'},geometry:geo.slice(0,2)},
    {type:'way',id:3,tags:{railway:'rail','disused:railway':'rail'},geometry:geo},
    {type:'way',id:4,tags:{railway:'construction',construction:'station'},geometry:geo},
  ]};
  const result = toGeoJSON(json);
  assert.deepEqual(result.features.map(f=>f.properties.state),['abandoned','razed']);
  assert.equal(result.features[0].geometry.type,'MultiLineString');
  assert.equal(result.features[0].geometry.coordinates.length,2);
  assert.equal(result.features[1].geometry.type,'LineString');
  assert.equal(result.features[0].properties.maxspeed,undefined);
  assert.throws(()=>toGeoJSON({remark:'runtime error: timeout',elements:[]}),/Incomplete/);
});
test('regional loading avoids duplicates, caches views and ignores stale responses', async () => {
  const events = {}, statuses = [], data = []; let zoom = 7, enabled = true, calls = 0, resolve;
  let box = bounds(0,50,2,51);
  const map = {getZoom:()=>zoom,getBounds:()=>box,on:(key,fn)=>events[key]=fn,off:key=>delete events[key],getSource:()=>({setData:value=>data.push(value)})};
  const overlay = createInactiveOverlay(map,()=>enabled,s=>statuses.push(s),{
    debounce:0,cooldown:0,
    fetcher:async()=>{calls++; return await new Promise(r=>resolve=r);},
  });
  const tick = () => new Promise(r=>setTimeout(r,10));
  const response = () => ({ok:true,json:async()=>({elements:[{type:'way',id:1,tags:{railway:'abandoned'},geometry:geo.slice(0,2)}]})});
  try {
    overlay.refresh(); await tick(); assert.equal(calls,1);
    events.moveend(); await tick(); assert.equal(calls,1,'only one request in flight');
    resolve(response()); await tick(); assert.equal(data.length,0,'stale generation must not replace current view');
    overlay.refresh(); await tick(); assert.equal(calls,1); assert.equal(data.length,1,'reuse cached response');
    zoom=12; overlay.refresh(); await tick(); assert.equal(calls,1);
    zoom=7; enabled=false; overlay.refresh(); await tick(); assert.equal(calls,1);
    enabled=true; box=bounds(10,50,12,51); overlay.refresh(); await tick(); assert.equal(calls,2);
    resolve({ok:true,json:async()=>({remark:'timeout',elements:[]})}); await tick();
    assert.match(statuses.at(-1),/unavailable/);
    assert.equal(data.length,1,'failed response must not erase existing coverage');
  } finally {overlay.destroy();}
});
