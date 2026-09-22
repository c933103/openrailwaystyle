import test from 'node:test';
import assert from 'node:assert/strict';
import {viewBox, GROUPS, inactiveQuery, toGeoJSON, createInactiveOverlay} from '../styles/inactive.mjs';
const bounds = (w,s,e,n) => ({getWest:()=>w,getSouth:()=>s,getEast:()=>e,getNorth:()=>n});
const geo = [{lon:1,lat:50},{lon:2,lat:50},null,{lon:3,lat:50},{lon:4,lat:50}];

test('regional queries are viewport-bounded and support the antimeridian', () => {
  assert.deepEqual(viewBox(bounds(179,-10,181,-8)),[-10,179,-8,-179]);
  assert.equal(viewBox(bounds(-100,-30,100,30)),null);
  assert.match(inactiveQuery([50,-1,51,1]),/out tags geom\(50,-1,51,1\)/);
  assert.match(inactiveQuery([50,-1,51,1]),/abandoned/);
  assert.ok(!inactiveQuery([50,-1,51,1]).includes('[~'));
  const planned = inactiveQuery([33.06115,126.29708,35.38088,132.19293],GROUPS[0].states);
  assert.ok(planned.includes('["proposed:railway"'));
  assert.ok(!planned.includes('abandoned'));
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
const response = (state, id) => ({ok:true,json:async()=>({elements:[{type:'way',id,tags:{railway:state},geometry:geo.slice(0,2)}]})});
const eventually = async condition => {
  for(let i=0;i<100;i++) {if(condition()) return; await new Promise(resolve=>setTimeout(resolve,5));}
  assert.fail('Expected overlay state was not reached');
};
function harness(fetcher, options = {}) {
  const events = {}, updates = [], statuses = [];
  const view = {box:bounds(126.29708,33.06115,132.19293,35.38088),zoom:7.83,enabled:true};
  const map = {getZoom:()=>view.zoom,getBounds:()=>view.box,on:(key,fn)=>events[key]=fn,off:key=>delete events[key],getSource:()=>({setData:data=>updates.push(data)})};
  const overlay = createInactiveOverlay(map,()=>view.enabled,(message,details)=>statuses.push({message,...details}),{fetcher,debounce:0,cooldown:0,retryDelay:15,storage:null,...options});
  return {events,updates,statuses,view,overlay};
}
test('planned lines survive former-line failure and automatic retry fetches only the missing group', async t => {
  t.mock.method(console,'warn',()=>{});
  let planned = 0, former = 0;
  const h = harness(async(url,options)=>{
    if(options.body.get('data').includes('proposed:railway')) {planned++;return response('proposed',1);}
    former++;
    return former===1 ? {ok:false,status:503} : response('abandoned',2);
  });
  try {
    h.overlay.refresh();
    await eventually(()=>h.statuses.some(s=>s.retry));
    assert.deepEqual(h.updates.at(-1).features.map(f=>f.id),[1]);
    assert.ok(h.statuses.some(s=>/Former lines incomplete.*HTTP 503/.test(s.message)));
    await eventually(()=>h.updates.at(-1)?.features.length===2);
    assert.equal(planned,1); assert.equal(former,2);
    assert.equal(h.statuses.at(-1).message,'');
    h.overlay.refresh();
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(planned,1); assert.equal(former,2);
    h.view.zoom=12; h.overlay.refresh();
    h.view.zoom=7; h.view.enabled=false; h.overlay.refresh();
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(former,2);
  } finally {h.overlay.destroy();}
});
test('panning during a request automatically loads the latest viewport and does not publish the old one', async () => {
  let calls=0, finish;
  const h = harness(async()=>{
    calls++;
    if(calls===1) return await new Promise(resolve=>finish=resolve);
    return response(calls===2?'proposed':'abandoned',calls);
  });
  try {
    h.overlay.refresh(); await eventually(()=>calls===1);
    h.view.box=bounds(130,34,132,35); h.events.moveend();
    finish(response('proposed',1));
    await eventually(()=>h.updates.at(-1)?.features.length===2);
    // The first response contains this smaller viewport and should be reused.
    assert.equal(calls,2);
    assert.deepEqual(h.updates.at(-1).features.map(f=>f.id),[1,2]);
    assert.ok(h.updates.length>=2);
  } finally {h.overlay.destroy();}
});
test('a changed viewport outside the pending request is fetched without another user action', async () => {
  let calls=0, finish;
  const h = harness(async()=>{
    calls++;
    if(calls===1) return await new Promise(resolve=>finish=resolve);
    return response(calls===2?'proposed':'abandoned',calls);
  });
  try {
    h.overlay.refresh(); await eventually(()=>calls===1);
    h.view.box=bounds(10,50,12,51); h.events.moveend();
    finish(response('proposed',1));
    await eventually(()=>h.updates.at(-1)?.features.length===2);
    assert.equal(calls,3);
    assert.deepEqual(h.updates.at(-1).features.map(f=>f.id),[2,3]);
    assert.ok(h.updates.every(data=>data.features.every(f=>f.id!==1)));
  } finally {h.overlay.destroy();}
});
test('the persistent cache survives reloads without repeating regional service requests', async () => {
  const saved = new Map(), storage={getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)};
  let calls=0;
  const first=harness(async()=>response(++calls===1?'proposed':'abandoned',calls),{storage});
  try {first.overlay.refresh();await eventually(()=>first.updates.at(-1)?.features.length===2);} finally {first.overlay.destroy();}
  const second=harness(async()=>{throw new Error('Cache should cover this view');},{storage});
  try {
    second.overlay.refresh();await eventually(()=>second.updates.at(-1)?.features.length===2);
    assert.equal(calls,2);assert.equal(second.statuses.at(-1).message,'');
  } finally {second.overlay.destroy();}
});
