import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
const root = process.argv[2] || process.cwd();
const predecessor = JSON.parse(gunzipSync(await readFile(`${root}/tests/fixtures/departure-unmatched-predecessor.json.gz`)));
assert.equal(predecessor.commit,'c35d21dcf3dabe7499cd11ebd3d4f04127806b23');
const previousBytes=Buffer.from(predecessor.files['departures.mjs'].text);
assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${previousBytes.length}\0`),previousBytes])).digest('hex'),'1e914c5c75042ec4544c81e493731b1077d0dfba');
const baseline = await import(`data:text/javascript;base64,${previousBytes.toString('base64')}`);
const candidate = await import(pathToFileURL(`${root}/styles/departures.mjs`));
const station = {lat:0,lon:0,names:['Central']};
const s=(id, metres, extra={})=>({type:'STOP',id,name:'Central',lat:0,lon:metres/6371000*180/Math.PI,modes:['REGIONAL_RAIL'],...extra});
const cases=[[],[s('399',399.999)],[s('401',400.001)],[s('bus',0,{modes:['BUS']})],[s('bad-coord',0,{lat:'0'})],[s('closest',1,{name:'Elsewhere'}),s('named',399)],[s('a',10),s('b',20),s('c',30)],[s('a',10,{name:'Other'}),s('b',20,{name:'Elsewhere'}),s('c',30,{name:'Away'})]];
let tested=0;
for (const original of cases) for (const candidates of [original,[...original].reverse()]) {
 const before=structuredClone(candidates), calls=[],signal=new AbortController().signal;
 const expected=baseline.pickStops(candidates,station);
 const result=await candidate.stationDepartures(station,{signal,fetch:async(url,options)=>{calls.push({url:new URL(url),options});return{ok:true,json:async()=>url.includes('reverse-geocode')?candidates:{stopTimes:[]}}}});
 assert.deepEqual(result.stops,expected);assert.deepEqual(result.rows,[]);assert.equal(result.stopResults.length,expected.length);assert.deepEqual(candidates,before);assert.equal(calls.length,1+expected.length);assert.ok(calls.length<=3);assert.ok(calls.every(c=>c.options.signal===signal));assert.ok(calls.slice(1).every(c=>c.url.searchParams.get('n')==='30'));tested++;
}
for(const value of [undefined,null,false,true,0,17,'private-fixture-payload',{}, {error:'private-fixture-payload'}]) {
 let calls=0;
 await assert.rejects(candidate.stationDepartures(station,{fetch:async()=>{calls++;return {ok:true,json:async()=>value}}}),error=>error.message==='Invalid Transitous stop lookup response'&&!error.message.includes('private-fixture-payload'));
 assert.equal(calls,1);tested++;
}
for(const failure of ['network','http','json']){
 let calls=0;const marker=new Error('private-fixture-payload');
 await assert.rejects(candidate.stationDepartures(station,{fetch:async()=>{calls++;if(failure==='network')throw marker;return {ok:failure!=='http',status:503,json:async()=>{throw marker}}}}),error=>failure==='http'?/503/.test(error.message):error===marker);
 assert.equal(calls,1);tested++;
}
for(const failed of [[],['a'],['b'],['a','b']]) for (const order of [['a','b'],['b','a']]){
 let calls=0;const marker=new Error('failure');const run=()=>candidate.stationDepartures(station,{fetch:async url=>{calls++;if(url.includes('reverse-geocode'))return {ok:true,json:async()=>order.map(id=>s(id,0))};if(failed.includes(new URL(url).searchParams.get('stopId')))throw marker;return {ok:true,json:async()=>({stopTimes:[]})}}});
 if(failed.length===2)await assert.rejects(run(),error=>error===marker);else{const board=await run();assert.deepEqual(board.stopResults,order.map(id=>({stopId:id,status:failed.includes(id)?'rejected':'fulfilled'})));assert.deepEqual(board.rows,[])}
 assert.equal(calls,3);tested++;
}
console.log(JSON.stringify({status:'PASS',cases:tested,scope:'matching/399.999–400.001m boundary/two-stop cap/request parameters and signal/input immutability/non-array rejection/error identity/partial and all-failed controls',candidateSha256:createHash('sha256').update(await readFile(`${root}/styles/departures.mjs`)).digest('hex')},null,2));
