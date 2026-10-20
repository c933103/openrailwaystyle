import test from 'node:test';
import assert from 'node:assert/strict';
import {departureRows} from '../styles/departures.mjs';
const at='2099-01-01T12:00:00Z', now=Date.parse(at)-600000;
const a={mode:'REGIONAL_RAIL',displayName:'R',headsign:'Central',routeId:'feed_route',tripId:'20990101_11:00_feed_trip-one',place:{stopId:'feed_stop',departure:at,scheduledDeparture:at,tz:'UTC'}};
const b={...a,headsign:'中央',realTime:true,place:{...a.place,departure:'2099-01-01T12:14:00Z',track:'9'}};
const rows=(x,y,options={})=>departureRows([[x],[y]],{now,...options});
test('same dated trip and boarding event merge despite translated labels, both orders',()=>{
 for(const [x,y] of [[a,b],[b,a]]){
  const r=rows(x,y);assert.equal(r.length,1);assert.equal(r[0].delay,14);assert.equal(r[0].track,'9');assert.equal(r[0].tripId,a.tripId);
 }
});
test('same event cancellation survives its expired translated observation',()=>{
 for(const [x,y] of [[{...a,cancelled:true},b],[b,{...a,cancelled:true}]]){
  const r=rows(x,y,{now:Date.parse('2099-01-01T12:10:00Z')});assert.equal(r.length,1);assert.equal(r[0].cancelled,true);assert.equal(r[0].delay,14);
 }
});
for(const [name,extra,place] of [
 ['different trip',{tripId:'20990101_11:00_feed_trip-two'},{}],
 ['different date',{tripId:'20981231_35:00_feed_trip-one'},{}],
 ['unknown ID',{tripId:'opaque'},{}],
 ['different route',{routeId:'other_route'},{}],
 ['different stop',{}, {stopId:'other_stop'}],
 ['missing stop',{}, {stopId:''}],
 ['repeated stop later',{}, {scheduledDeparture:'2099-01-01T12:01:00Z'}],
 ['arrival event',{}, {scheduledDeparture:undefined,scheduledArrival:at}],
 ['different mode',{mode:'TRAM'},{}],
]) test(`presentation-independent identity rejects ${name}`,()=>{
 const c={...b,...extra,place:{...b.place,...place}};
 for(const [x,y] of [[a,c],[c,a]]) assert.equal(rows(x,y).length,2);
});
test('opposite directions remain separate even with matching dated ID and labels',()=>{
 const x={...a,directionId:0},y={...b,headsign:'Central',directionId:1};
 for(const [l,r] of [[x,y],[y,x]])assert.equal(rows(l,r).length,2);
});
test('same-event evidence cannot erase an ambiguous third observation',()=>{
 const c={...a,tripId:'20990101_11:00_feed_trip-two'};
 for(const lists of [[[a],[b,c]],[[b,c],[a]],[[a],[c,b]],[[c,b],[a]]]) assert.equal(departureRows(lists,{now}).length,3);
});
test('translated route labels do not block same-event cancellation borrowing',()=>{
 const old={...a,displayName:'鉄道',tripCancelled:true};
 const live={...b,displayName:'Railway'};
 for(const lists of [[[old],[live]],[[live],[old]]]){
  const result=departureRows(lists,{now:Date.parse('2099-01-01T12:10:00Z')});
  assert.equal(result.length,1); assert.equal(result[0].cancelled,true);
  assert.equal(result[0].track,'9'); assert.equal(result[0].tripScheduled,Date.parse(at));
  assert.equal(result[0].tripEvent,'departure');
 }
});
test('same-list direction conflicts never collapse in exact-key deduplication',()=>{
 const x={...a,directionId:0},y={...a,directionId:1};
 for(const list of [[x,y],[y,x]]) assert.equal(departureRows([list],{now}).length,2);
});
for(const tripId of ['20990230_11:00_feed_trip','20991301_11:00_feed_trip','opaque'])
 test(`unrecognized dated trip supplies no shortcut: ${tripId}`,()=>{
  assert.equal(rows({...a,tripId},{...b,tripId}).length,2);
 });
for(const routeId of ['',undefined]) test(`missing route supplies no shortcut: ${routeId}`,()=>{
 assert.equal(rows({...a,routeId},{...b,routeId}).length,2);
});
test('place cancellation can cross expiry without mutating inputs',()=>{
 const x={...a,place:{...a.place,cancelled:true}};
 const lists=[[x],[b]],before=JSON.stringify(lists);
 const result=departureRows(lists,{now:Date.parse('2099-01-01T12:10:00Z')});
 assert.equal(result[0].cancelled,true); assert.equal(JSON.stringify(lists),before);
 assert.equal('routeId' in result[0],false); assert.equal('directionId' in result[0],false);
});
test('invalid consumed direction fields reject the board',()=>{
 for(const directionId of [{},[],false,1.5,Infinity])
  assert.throws(()=>departureRows([[{...a,directionId}]],{now}),/Invalid Transitous/);
});
test('a translated pair does not authorize a mixed-feed group override',()=>{
 const third={...a,tripId:'20990101_11:00_other_trip'};
 for(const lists of [[[a],[b],[third]],[[third],[b],[a]],[[b],[a],[third]]])
  assert.equal(departureRows(lists,{now}).length,3);
});
test('equivalent scalar direction representations retain same-list cancellation',()=>{
 const x={...a,directionId:0,cancelled:true},y={...a,directionId:'0',realTime:true,place:{...a.place,departure:b.place.departure}};
 for(const list of [[x,y],[y,x]]){
  const result=departureRows([list],{now:Date.parse('2099-01-01T12:10:00Z')});
  assert.equal(result.length,1); assert.equal(result[0].cancelled,true);assert.equal(result[0].delay,14);
 }
});
test('a missing-direction bridge cannot hide a known direction conflict',()=>{
 const x={...a,directionId:0},y={...a,directionId:1},z={...a};
 for(const list of [[x,y,z],[x,z,y],[y,x,z],[y,z,x],[z,x,y],[z,y,x]])
  assert.equal(departureRows(list.map(r=>[r]),{now}).length,3);
});
test('same-list boarding stops and event types remain distinguishable',()=>{
 for(const place of [{...a.place,stopId:'other_stop'},{...a.place,scheduledDeparture:undefined,scheduledArrival:at}])
  assert.equal(departureRows([[a,{...a,place}]],{now}).length,2);
});
