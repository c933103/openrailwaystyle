import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pickStops, stationDepartures, plannerLink} from '../../../../styles/departures.mjs';
const cwd=new URL('../../../../',import.meta.url), ref='d252a702de3cdd322e2f5c0a9bb4e5db3a37d079';
const source=execFileSync('git',['show',`${ref}:styles/departures.mjs`],{cwd,encoding:'utf8'});
const {pickStops:before}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const stop=(name,id,lat=.001)=>({type:'STOP',name,id,lat,lon:0,modes:['REGIONAL_RAIL']});
const station=names=>({lat:0,lon:0,names});
const permutations=items=>items.length<2?[items]:items.flatMap((item,i)=>permutations(items.filter((_,j)=>j!==i)).map(rest=>[item,...rest]));
for(const composite of ['München Hbf / Munich','München (Munich)']) {
 const candidates=[stop('München Hbf','a'),stop(composite,'b',.0011),stop('Munich Park','wrong',.0001)];
 for(const names of [['München Hbf','Munich'],['München Hbf']]) {
  const previous=before(candidates,station(names)).map(s=>s.id), actual=pickStops(candidates,station(names)).map(s=>s.id);
  assert.deepEqual(previous,['a']);assert.deepEqual(actual,names.length===2?['a','b']:['a']);
  console.log(JSON.stringify({composite,names,previous,actual}));
 }
}
let positiveChecks=0,negativeChecks=0;
for(const [a,b] of [['München Hbf','Munich'],['Praha','Prague'],['København','Copenhagen'],['Москва','Московский'],['東京','とうきょう'],['Terminal 1','Terminal One']]) {
 for(const composite of [`${a} / ${b}`,`${b} / ${a}`,`${a} (${b})`,`${b} (${a})`,`${a}／${b}`,`${a}（${b}）`,`${a} / ${b} (Track B1)`]) {
  for(const names of [[a,b],[b,a]]) {
   const candidates=[stop(a,'exact'),stop(composite,'composite',.0011),stop(`${b}${b}`,'wrong',.0001)];
   for(const order of permutations(candidates)){assert.deepEqual(pickStops(order,station(names)).map(s=>s.id),['exact','composite']);positiveChecks++;}
  }
  for(const names of [[a],[b]]) {
   const candidates=[stop(names[0],'exact-a'),stop(names[0],'exact-b',.0011),stop(composite,'not-proven',.0001)];
   for(const order of permutations(candidates)){assert.deepEqual(pickStops(order,station(names)).map(s=>s.id),['exact-a','exact-b']);negativeChecks++;}
  }
 }
}
for(const [names,candidate] of [
 [['München Hbf','Munich'],'München / Munich Park'],
 [['Terminal 1'],'Terminal 1 / Terminal 10'],
 [['Central'],'Central (North)'],[['中央'],'中央 / 中央公園'],
 [['JR 東京'],'JR (神田)'],[['JR 東京','Other'],'JR / Other'],
 [['Alpha / Beta','Gamma'],'Alpha / Gamma'],
 [['München Hbf','Munich'],'München / Munich / Other'],
 [['München Hbf','Munich'],'München (Munich) Park'],
]) {
 const candidates=[stop(names[0],'exact-a'),stop(names[0],'exact-b',.0011),stop(candidate,'wrong',.0001)];
 for(const order of permutations(candidates)){assert.deepEqual(pickStops(order,station(names)).map(s=>s.id),['exact-a','exact-b']);negativeChecks++;}
}
// Composite first by distance remains bounded and supplies both planner IDs.
for(const names of [['München Hbf','Munich'],['München Hbf']]) {
 const candidates=[stop('München Hbf','exact',.0011),stop('München (Munich)','composite',.001),stop('Munich Park','wrong',.0001)],calls=[];
 const board=await stationDepartures(station(names),{fetch:async href=>{const url=new URL(href);calls.push(url);return {ok:true,json:async()=>url.pathname.endsWith('/reverse-geocode')?candidates:{stopTimes:[]}};}});
 const expected=names.length===2?['composite','exact']:['exact'];
 assert.deepEqual(board.stops.map(s=>s.id),expected);assert.deepEqual(calls.slice(1).map(u=>u.searchParams.get('stopId')),expected);assert.equal(calls.length,expected.length+1);
 for(const direction of ['from','to'])assert.equal(new URL(plannerLink(direction,board.stops[0].id,names[0])).searchParams.get(`${direction}Place`),expected[0]);
}
console.log(JSON.stringify({positiveChecks,negativeChecks,totalChecks:positiveChecks+negativeChecks,requestPlannerScenarios:2,result:'passed'}));
