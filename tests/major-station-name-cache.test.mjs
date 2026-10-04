import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const app=await readFile(new URL('../styles/app.mjs',import.meta.url),'utf8');
const begin=app.indexOf('const OSM_API='),end=app.indexOf('function updateMajorStations()',begin);
assert.ok(begin>=0&&end>begin,'exercise the actual app name loader');
const loaderCode=app.slice(begin,end)+'\n;({load:majorStationNameTags,next:()=>majorStationNextRefreshAt});';
const key='atlas_major_station_osm_names_v2',day=86400000;
const data=(...ids)=>({type:'FeatureCollection',features:ids.map(id=>{const [osm_type,osm_id]=id.split('/');return{type:'Feature',properties:{osm_type,osm_id,name:'MAINTENANCE NOTE MUST NOT LEAK'},geometry:{type:'Point',coordinates:[0,0]}};})});
const response=(elements,status=200)=>({ok:status===200,status,json:async()=>({elements})});
function harness(fetcher,cache){
 let clock=20*day;
 const stored=new Map(cache?[[key,JSON.stringify(cache)]]:[]),calls=[];
 const api=vm.runInNewContext(loaderCode,{
  URL,AbortController,setTimeout,clearTimeout,Date:{now:()=>clock},console:{warn(){}},
  localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,value)=>stored.set(k,value)},
  fetch:async(url,options)=>{calls.push({url:new URL(String(url)),signal:options.signal});return fetcher(new URL(String(url)),options,calls.length);},
 });
 return{...api,calls,advance:ms=>clock+=ms,cache:()=>JSON.parse(stored.get(key)||'null')};
}

test('OSM name cache stores only source name tags and reuses each fresh object',async()=>{
 const h=harness(url=>{const type=url.pathname.includes('nodes')?'node':'way';return response([{type,id:type==='node'?1:2,tags:{name:'Mapped name','name:de':'Erfasster Name',operator:'Do not cache',tier:'Do not override'}}]);});
 const features=data('node/1','way/2');
 const names=await h.load(features);
 assert.equal(names['node/1'].name,'Mapped name');
 assert.equal(names['way/2']['name:de'],'Erfasster Name');
 assert.equal(names['node/1'].operator,undefined);
 assert.equal(names['node/1'].tier,undefined);
 assert.equal(JSON.stringify(names).includes('MAINTENANCE NOTE'),false);
 await h.load(features);
 assert.equal(h.calls.length,2);
});

test('one failed object type preserves successful names and is not cached as empty',async()=>{
 let failWay=true;
 const h=harness(url=>url.pathname.includes('nodes')?response([{type:'node',id:1,tags:{name:'Node station'}}]):failWay?response([],503):response([{type:'way',id:2,tags:{name:'Way station'}}]));
 const features=data('node/1','way/2'),first=await h.load(features);
 assert.equal(first['node/1'].name,'Node station');
 assert.equal(first['way/2'],undefined);
 assert.equal(h.cache().records['way/2'],undefined);
 failWay=false;h.advance(31000);
 const next=await h.load(features);
 assert.equal(next['way/2'].name,'Way station');
 assert.equal(h.calls.filter(call=>call.url.pathname.includes('nodes')).length,1,'fresh nodes do not refetch with failed ways');
});

test('malformed and omitted objects never acquire seven-day empty cache records',async()=>{
 for(const payload of [{notElements:[]},{elements:[]}]){
  let valid=false;
  const h=harness(()=>valid?response([{type:'node',id:1,tags:{name:'Recovered'}}]):{ok:true,status:200,json:async()=>payload});
  assert.equal((await h.load(data('node/1')))['node/1'],undefined);
  assert.equal(h.cache().records['node/1'],undefined);
  valid=true;
  assert.equal((await h.load(data('node/1')))['node/1'].name,'Recovered');
 }
});

test('the round deadline bounds a stalled body and cannot later poison successful names',async()=>{
 let finishBody;
 const h=harness(url=>url.pathname.includes('nodes')?{ok:true,status:200,json:()=>new Promise(resolve=>finishBody=resolve)}:response([{type:'way',id:2,tags:{name:'Available'}}]));
 const names=await h.load(data('node/1','way/2'),{timeout:15});
 assert.equal(names['way/2'].name,'Available');
 assert.equal(names['node/1'],undefined);
 assert.ok(h.calls.every(call=>call.signal.aborted));
 finishBody({elements:[{type:'node',id:1,tags:{name:'Late response'}}]});
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(h.cache().records['node/1'],undefined);
});

test('offline fallback retains OSM cache age instead of declaring stale data fresh',async()=>{
 const fetchedAt=10*day;
 const h=harness(()=>response([],503),{version:2,records:{'node/1':{fetchedAt,tags:{name:'Cached OSM name'}}}});
 assert.equal((await h.load(data('node/1')))['node/1'].name,'Cached OSM name');
 assert.equal(h.cache().records['node/1'].fetchedAt,fetchedAt);
 assert.equal(h.next(),20*day+30000);
});

test('future-dated or structurally invalid cache rows are not trusted',async()=>{
 for(const record of [{fetchedAt:30*day,tags:{name:'Future'}},{fetchedAt:19*day,tags:['Invalid']},{fetchedAt:'fresh',tags:{name:'Invalid date'}}]){
  const h=harness(()=>response([],503),{version:2,records:{'node/1':record}});
  assert.equal((await h.load(data('node/1')))['node/1'],undefined);
 }
});

test('a deleted object does not hide its valid batch sibling',async()=>{
 const h=harness(url=>url.searchParams.get('nodes')==='1'?response([{type:'node',id:1,tags:{name:'Still present'}}]):response([],404));
 const names=await h.load(data('node/1','node/2'));
 assert.equal(names['node/1'].name,'Still present');
 assert.equal(names['node/2'],undefined);
 assert.equal(h.cache().records['node/2'],undefined);
});

test('a completely missing batch has a finite subdivision request budget',async()=>{
 const h=harness(()=>response([],404));
 const names=await h.load(data(...Array.from({length:100},(_,i)=>`node/${i+1}`)));
 assert.equal(Object.keys(names).length,0);
 assert.ok(h.calls.length<=32,`${h.calls.length} requests`);
});
