import test from 'node:test';
import assert from 'node:assert/strict';
import {stationBaseRegions,stationRegionQuery,stationWorldCoverage,newStationAcquisition,
 checkStationAcquisition,applyStationRegion,postponeStationRegion,splitStationRegion,
 centerInside,nextStationAcquisitionCycle,stationQueryExceededLimits} from '../scripts/station-acquisition.mjs';

const node=(id,lon,lat)=>({type:'node',id,lon,lat,version:1,timestamp:'2026-10-11T00:00:00Z',tags:{railway:'station',name:'Railway'}});

test('station query limits require a bounded explicit executed-query diagnostic',()=>{
 assert.equal(stationQueryExceededLimits(504,'<p>runtime error: Query timed out in "query" at line 1 after 120 seconds.</p>'),true);
 assert.equal(stationQueryExceededLimits(200,'runtime error: Query run out of memory using about 64 MB of RAM.'),true);
 for(const status of [undefined,NaN,Infinity,'504',400,401,403,429,503,600])
  assert.equal(stationQueryExceededLimits(status,'runtime error: Query run out of memory using about 64 MB of RAM.'),false);
 for(const message of [null,{},'Gateway timeout','Unknown maxsize setting','Query validation failed: out of memory',
  '<'.repeat(64*1024),'runtime error: Query '+ 'X'.repeat(64*1024)+' timed out'])
  assert.equal(stationQueryExceededLimits(504,message),false);
});

test('world region coverage is a nonoverlapping exhaustive partition',()=>{
 const regions=stationBaseRegions();
 assert.equal(regions.length,32);
 const initial=newStationAcquisition();
 assert.equal(checkStationAcquisition(initial,[]),true);
 assert.equal(stationWorldCoverage(regions.map(box=>({box}))),true);
 assert.equal(stationWorldCoverage(regions.slice(1).map(box=>({box}))),false);
 assert.equal(stationWorldCoverage([...regions,regions[0]].map(box=>({box}))),false);
 const partial={...initial,pending:initial.pending.slice(1)};
 assert.throws(()=>checkStationAcquisition(partial,[]),/Missing/);
 const overlap={...initial,completed:[{box:initial.pending[0].box}]};
 assert.throws(()=>checkStationAcquisition(overlap,[]),/Overlapping/);
});

test('station acquisition query targets exactly stations with rail-mode evidence',()=>{
 const query=stationRegionQuery([0,0,45,45]);
 assert.ok(query.includes('nwr[railway~"^(station|halt|tram_stop)$"](0,0,45,45);'));
 assert.ok(query.includes('nwr[public_transport=station][subway=yes](0,0,45,45);'));
 assert.ok(query.includes('out meta center qt;'),'version metadata is required for overlapping source geometry');
 assert.ok(!query.includes('out geom;'),'only centre coords are required for mapped station points');
 assert.throws(()=>stationRegionQuery([-90,-181,90,181]),/Invalid/);
 assert.deepEqual(splitStationRegion([0,0,45,45]),[
  [0,0,22.5,22.5],[0,22.5,22.5,45],[22.5,0,45,22.5],[22.5,22.5,45,45],
 ]);
 assert.equal(centerInside([0,0,45,45],{lat:0,lon:44.99}),true);
 assert.equal(centerInside([0,0,45,45],{lat:45,lon:40}),false);
 assert.equal(centerInside([45,135,90,180],{lat:90,lon:180}),true);
});

test('verified regional responses checkpoint only their contained stations',()=>{
 let state=newStationAcquisition(),records=[];
 const box=state.pending[0].box;
 const response={elements:[
  node(5,box[1]+1,box[0]+1),
  node(6,box[1]+1,box[0]+2),
  node(7,box[3],box[2]),
  // Intersecting OSM area: the reported bounding-box center is elsewhere.
  // Its source region still legitimately returns this geometry.
  {type:'way',id:99,version:1,timestamp:'2026-10-11T00:00:00Z',center:{lon:0,lat:0},
    tags:{railway:'station',name:'Multi-region station facility'}},
 ]};
 const processed=applyStationRegion(state,records,box,response);
 state=processed.state;records=processed.records;
 assert.equal(records.length,3,'retain out-of-region center for intersecting ways while filtering boundary nodes');
 assert.ok(records.some(x=>x.id==='way-99'),'cross-region station areas must survive');
 assert.equal(state.completed.length,1);
 assert.equal(state.pending.length,31);
 assert.equal(checkStationAcquisition(state,records),true);
 assert.throws(()=>applyStationRegion(state,records,box,response),/Unexpected/);
 assert.throws(()=>applyStationRegion(state,records,state.pending[0].box,{elements:[],remark:'runtime error'}),/Incomplete/);
 assert.equal(state.completed.length,1,'invalid next response cannot advance checkpoint');
});

test('higher-version OSM station updates reconcile across overlapping region queries',()=>{
 const initial=newStationAcquisition();
 const first=initial.pending[0].box;
 const source={type:'way',id:998,version:1,timestamp:'2026-10-10T00:00:00Z',
   center:{lat:0,lon:0},tags:{railway:'station',name:'Station old'}};
 let {state,records}=applyStationRegion(initial,[],first,{elements:[source]});
 assert.equal(records[0].name,'Station old');
 const second=state.pending[0].box;
 const changed={...source,version:2,timestamp:'2026-10-11T00:00:00Z',
   tags:{railway:'station',name:'Station updated'}};
 ({state,records}=applyStationRegion(state,records,second,{elements:[changed]}));
 assert.equal(records.length,1);
 assert.equal(records[0].name,'Station updated');
 assert.equal(records[0].osm_version,2);
 ({state,records}=applyStationRegion(state,records,state.pending[0].box,{elements:[source]}));
 assert.equal(records[0].osm_version,2,'older response cannot roll back a later station version');
 assert.throws(()=>applyStationRegion(state,records,state.pending[0].box,{
   elements:[{...changed,tags:{railway:'station',name:'Corrupted tag'}}]}),/identical version/);
 assert.throws(()=>applyStationRegion(state,records,state.pending[0].box,{
   elements:[{...changed,version:undefined}]}),/lacks version metadata/);
});

test('timed-out region subdivision preserves complete world topology and data',()=>{
 const initial=newStationAcquisition(),first=initial.pending[0].box;
 const split=postponeStationRegion(initial,first);
 assert.equal(split.completed.length,0);
 assert.equal(split.pending.length,35);
 assert.equal(checkStationAcquisition(split,[]),true);
 assert.deepEqual(split.pending[0].box,splitStationRegion(first)[0]);
 assert.throws(()=>postponeStationRegion(split,split.pending[0].box,{maxDepth:1}),/after 1 splits/);
 assert.throws(()=>postponeStationRegion(initial,[0,0,1,1]),/Unexpected/);
});

test('next worldwide refresh is fresh and cannot erase an immutable published generation',()=>{
 const initial=newStationAcquisition();
 const records=[{id:'node-1'}];
 assert.equal(nextStationAcquisitionCycle(initial,records).refreshed,false);
 const complete={...initial,pending:[],completed:initial.pending.map(({box})=>({box,at:'2026-10-11T00:00:00Z',count:0}))};
 assert.equal(checkStationAcquisition(complete,records),true);
 const restarted=nextStationAcquisitionCycle(complete,records);
 assert.equal(restarted.refreshed,true);
 assert.equal(restarted.records.length,0);
 assert.equal(restarted.state.pending.length,32);
 assert.equal(checkStationAcquisition(restarted.state,restarted.records),true);
 assert.equal(records.length,1,'last complete generation remains immutable in memory');
 assert.deepEqual(complete.pending,[]);
});
