import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
// Run from the candidate root; provide a checkout of baseline 50b8063 as argv[2].
if (!process.argv[2]) throw new Error('Usage: node independent-invariants.mjs BASELINE_CHECKOUT');
const moduleAt = (root, file) => import(pathToFileURL(resolve(root, 'styles', file)).href);
const {pickStops,stationDepartures} = await moduleAt(process.cwd(), 'departures.mjs');
const {searchResults,tileStations} = await moduleAt(process.cwd(), 'map-model.mjs');
const {pickStops:oldPick} = await moduleAt(process.argv[2], 'departures.mjs');
const {searchResults:oldSearch,tileStations:oldTile} = await moduleAt(process.argv[2], 'map-model.mjs');
globalThis.fetch = () => { throw new Error('Real provider fetch forbidden in independent review'); };
const wrap = x => Math.atan2(Math.sin(x*Math.PI/180),Math.cos(x*Math.PI/180))*180/Math.PI;
const station = (lon,lat) => ({lon,lat,names:['Terminal 1']});
const stop = (lon,lat,extra={}) => ({id:'candidate',name:'Terminal 1',lon,lat,modes:['REGIONAL_RAIL'],type:'STOP',...extra});
const facility = (longitude,latitude) => ({osm_id:1,osm_type:'node',longitude,latitude,name:'Terminal 1'});
const place = (lon,lat,extra={}) => ({osm_id:2,osm_type:'way',category:'railway',type:'station',lon:String(lon),lat:String(lat),namedetails:{name:'Terminal 1'},...extra});
const tile = (lon,lat,extra={}) => ({geometry:{type:'Point',coordinates:[lon,lat]},properties:{id:'way-2-station',name:'Terminal 1',...extra}});
let seed=0xc933103;
const random = () => ((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
let comparisons=0;
for(let i=0;i<10000;i++) {
  const lat=(random()*170)-85,dy=(random()-.5)*.014,dx=(random()-.5)*.06;
  const sign=random()>.5?1:-1,from=sign*(179.99+random()*.01),to=wrap(from+dx);
  const old=[oldPick([stop(dx,lat+dy)],station(0,lat)).length,oldSearch([facility(0,lat)],[place(dx,lat+dy)]).rail.length,oldTile([tile(dx,lat+dy)],'Terminal',[0,lat],[facility(0,lat)]).length];
  const shifts = [0,360*(Math.floor(random()*7)-3)];
  for(const shift of shifts){
    const observed=[pickStops([stop(to+shift,lat+dy)],station(from,lat)).length,searchResults([facility(from,lat)],[place(to+shift,lat+dy)]).rail.length,tileStations([tile(to+shift,lat+dy)],'Terminal',[from,lat],[facility(from,lat)]).length];
    assert.deepEqual(observed,old,`Rotational/world-copy preservation ${JSON.stringify({lat,dy,dx,from,to,shift,old,observed})}`); comparisons+=3;
  }
}
let boundaries=0;
for(const lat of [-85,-60,0,60,85]) for(const direction of [-1,1]) {
  const from=direction*179.9999;
  for(const [metres,expect] of [[399.999,true],[400.001,false]]) {
    const dx=metres/6371000*180/Math.PI/Math.cos(lat*Math.PI/180);
    assert.equal(pickStops([stop(wrap(from+direction*dx),lat)],station(from,lat)).length>0,expect); boundaries++;
  }
  for(const [scaled,expect] of [[.003999,true],[.004001,false]]) {
    const to=wrap(from+direction*scaled/Math.cos(lat*Math.PI/180));
    assert.equal(searchResults([facility(from,lat)],[place(to,lat)]).rail.length===1,expect);
    assert.equal(tileStations([tile(to,lat)],'Terminal',[from,lat],[facility(from,lat)]).length===0,expect); boundaries+=2;
  }
  for(const [dy,expect] of [[.003999,true],[.004001,false]]) {
    assert.equal(searchResults([facility(from,lat)],[place(wrap(from+.000001),lat+dy)]).rail.length===1,expect);
    assert.equal(tileStations([tile(wrap(from+.000001),lat+dy)],'Terminal',[from,lat],[facility(from,lat)]).length===0,expect); boundaries+=2;
  }
}
let invalidChecks=0;
for(const bad of [NaN,Infinity,-Infinity,undefined,null,'-179.999']) {
  for(const field of ['lat','lon']){ assert.deepEqual(pickStops([stop(-179.999,0,{[field]:bad})],station(179.999,0)),[]); invalidChecks++; }
}
for(const extra of [{type:'PLACE'},{modes:['BUS']},{modes:[]}]) {assert.deepEqual(pickStops([stop(-179.999,0,extra)],station(179.999,0)),[]); invalidChecks++;}
const selected=Object.freeze(stop(-179.999,0));
assert.equal(pickStops(Object.freeze([selected]),Object.freeze(station(179.999,0)))[0],selected);
const calls=[];
const result=await stationDepartures(station(179.999,0),{fetch:async(url,options)=>{
  calls.push({url,options});
  if(url.includes('reverse-geocode'))return {ok:true,json:async()=>[selected,stop(-179.998,0,{id:'second'}),stop(-179.9975,0,{id:'third'})]};
  if(new URL(url).searchParams.get('stopId')==='second')throw new Error('Synthetic failure');
  return {ok:true,json:async()=>({stopTimes:[]})};
}});
assert.equal(calls.length,3);assert.equal(result.stops.length,2);
assert.deepEqual(result.stopResults,[{stopId:'candidate',status:'fulfilled'},{stopId:'second',status:'rejected'}]);
assert.deepEqual(result.rows,[]);
console.log(JSON.stringify({status:'PASS',seed:'0xc933103',comparisonAssertions:comparisons,boundaryAssertions:boundaries,invalidFilterAssertions:invalidChecks,immutableInput:true,partialResultRequestCap:true,realProviderFetches:0},null,2));
