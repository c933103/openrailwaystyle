import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=process.argv[2],{stationDepartures}=await import(pathToFileURL(`${root}/styles/departures.mjs`).href);
const at='2099-01-01T12:00:00Z',later='2099-01-01T12:00:30Z';
const row=(tripId,at,cancelled=false)=>({mode:'TRAM',displayName:'T',headsign:'Central',tripId,cancelled,place:{scheduledDeparture:at,departure:at,stopId:'s'}});
const stop=id=>({type:'STOP',id,name:'Central',lat:0,lon:0,modes:['TRAM']});
let checks=0;
for(const order of [['a','b'],['b','a']])for(const malformed of [null,{},[],{stopTimes:null},{stopTimes:false},{stopTimes:{}}]){
 const calls=[],signal=new AbortController().signal;
 const board=await stationDepartures({lat:0,lon:0,names:['Central']},{signal,fetch:async(url,options)=>{
  const u=new URL(url);calls.push({u,signal:options.signal});
  return {ok:true,json:async()=>u.pathname.endsWith('/reverse-geocode')?order.map(stop):u.searchParams.get('stopId')==='a'?{stopTimes:[row('a',at),row('b',later,true)]}:malformed};
 }});
 assert.equal(board.rows.length,2);assert.equal(board.rows.find(r=>r.tripId==='a').cancelled,false);assert.equal(board.rows.find(r=>r.tripId==='b').cancelled,true);
 assert.deepEqual(board.stopResults,order.map(stopId=>({stopId,status:stopId==='a'?'fulfilled':'rejected'})));
 assert.equal(calls.length,3);assert.ok(calls.every(c=>c.signal===signal));checks++;
}
for(const order of [['a','b'],['b','a']]){
 const board=await stationDepartures({lat:0,lon:0,names:['Central']},{fetch:async url=>{
  const u=new URL(url);return {ok:true,json:async()=>u.pathname.endsWith('/reverse-geocode')?order.map(stop):{stopTimes:[u.searchParams.get('stopId')==='a'?row('a',at):row('b',later,true)]}};
 }});
 assert.equal(board.rows.length,2);assert.equal(board.rows.find(r=>r.tripId==='a').cancelled,false);assert.ok(board.stopResults.every(r=>r.status==='fulfilled'));checks++;
}
console.log(JSON.stringify({checks,passed:checks,failed:0,scope:'Envelope validation and exact-instant preservation compose correctly with retained status, cancellation isolation and bounded requests.'},null,2));
