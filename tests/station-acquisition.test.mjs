import test from 'node:test';
import assert from 'node:assert/strict';
import {stationBaseRegions,stationRegionQuery,stationWorldCoverage,newStationAcquisition,
 checkStationAcquisition,applyStationRegion,postponeStationRegion,splitStationRegion,
 centerInside} from '../scripts/station-acquisition.mjs';

const node=(id,lon,lat)=>({type:'node',id,lon,lat,tags:{railway:'station',name:'Railway'}});

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
 assert.ok(query.includes('out body center qt;'));
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
 ]};
 const processed=applyStationRegion(state,records,box,response);
 state=processed.state;records=processed.records;
 assert.equal(records.length,2,'no border-overlapping feature outside its owning region');
 assert.equal(state.completed.length,1);
 assert.equal(state.pending.length,31);
 assert.equal(checkStationAcquisition(state,records),true);
 assert.throws(()=>applyStationRegion(state,records,box,response),/Unexpected/);
 assert.throws(()=>applyStationRegion(state,records,state.pending[0].box,{elements:[],remark:'runtime error'}),/Incomplete/);
 assert.equal(state.completed.length,1,'invalid next response cannot advance checkpoint');
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
