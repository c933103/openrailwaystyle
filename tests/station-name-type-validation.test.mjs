import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../styles/app.mjs',import.meta.url),'utf8');
const begin=app.indexOf("const OSM_API="),end=app.indexOf('function updateMajorStations()',begin);
assert.ok(begin>=0&&end>begin,'exercise the actual OSM name loader');
const loaderCode=app.slice(begin,end);
const key='atlas_major_station_osm_names_v2';
const station={type:'FeatureCollection',features:[{properties:{osm_type:'node',osm_id:'1'}}]};
const stale=Date.now()-8*86400000;
function harness(tags,fetchedAt,answer){
  const values=new Map([[key,JSON.stringify({version:2,records:{'node/1':{fetchedAt,tags}}})]]);
  let requests=0;
  const api=vm.runInNewContext(loaderCode+'\n({majorStationNameTags});',{
    URL,AbortController,setTimeout,clearTimeout,console,
    localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},
    fetch:async()=>{requests++;if(answer instanceof Error)throw answer;if(typeof answer==='function')return answer();return {ok:true,status:200,json:async()=>answer};}
  });
  return {load:(timeout=100)=>api.majorStationNameTags(station,{timeout}),next:value=>{answer=value;},saved:()=>JSON.parse(values.get(key)).records,requests:()=>requests};
}
test('malformed successful OSM name fields cannot erase or freshen a valid prior name',async()=>{
  for(const invalid of [null,123,true,[],{}]){
    const h=harness({name:'Retained OSM name'},stale,{elements:[{type:'node',id:1,tags:{name:invalid}}]});
    const names=await h.load();
    assert.equal(names['node/1'].name,'Retained OSM name');
    assert.equal(h.saved()['node/1'].fetchedAt,stale);
  }
});
test('malformed fresh cache name fields are rejected and refreshed rather than treated as verified empty',async()=>{
  for(const invalid of [null,123,true,[],{}]){
    const h=harness({'name:en':invalid},Date.now(),{elements:[{type:'node',id:1,tags:{name:'Current OSM name'}}]});
    const names=await h.load();
    assert.equal(h.requests(),1);
    assert.equal(names['node/1'].name,'Current OSM name');
  }
});
test('a genuinely nameless OSM object remains valid and clears a removed source name',async()=>{
  const h=harness({name:'Removed OSM name'},stale,{elements:[{type:'node',id:1,tags:{railway:'station'}}]});
  const names=await h.load();
  assert.equal(Object.keys(names['node/1']).length,0);
  assert.ok(h.saved()['node/1'].fetchedAt>stale);
});

test('mixed cache name fields preserve usable OSM values as stale fallback when refresh fails',async()=>{
  for(const invalid of [null,123,true,[],{}]){
    const h=harness({name:'Cached native name','name:de':'Cached German name','name:en':invalid},Date.now(),new Error('offline'));
    const names=await h.load();
    assert.equal(names['node/1'].name,'Cached native name');
    assert.equal(names['node/1']['name:de'],'Cached German name');
    assert.equal('name:en' in names['node/1'],false);
    assert.ok(h.saved()['node/1'].fetchedAt<=Date.now()-7*86400000,'salvage must not become fresh');
    h.next({elements:[{type:'node',id:1,tags:{name:'Updated native name','name:en':'Updated English name'}}]});
    const updated=await h.load();
    assert.equal(h.requests(),2,'invalid cache freshness forces a later refresh');
    assert.equal(updated['node/1']['name:en'],'Updated English name');
    await h.load();
    assert.equal(h.requests(),2,'successful refresh restores normal freshness');
  }
});
test('mixed cache name fields survive a timed-out refresh without becoming fresh empty data',async()=>{
  const h=harness({name:'Cached native name','name:en':123},Date.now(),()=>new Promise(()=>{}));
  const names=await h.load(20);
  assert.equal(names['node/1'].name,'Cached native name');
  assert.equal('name:en' in names['node/1'],false);
  assert.ok(h.saved()['node/1'].fetchedAt<=Date.now()-7*86400000);
});
