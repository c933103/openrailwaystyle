import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {pickStops as patched, stationDepartures, plannerLink} from '../../../styles/departures.mjs';
const cwd=new URL('../../../',import.meta.url), ref='b5a73c3aa03498259c2fd531b9644d52ae94db69';
const source=execFileSync('git',['show',`${ref}:styles/departures.mjs`],{cwd,encoding:'utf8'});
const {pickStops:before}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const stop=(name,id,lat)=>({type:'STOP',name,id,lat,lon:0,modes:['REGIONAL_RAIL']});
const scenarios=[
 {finding:'R1',name:'JR 東京',candidates:[stop('JR 東京','right-a',.001),stop('JR 東京','right-b',.0011),stop('JR 神田','wrong',.0001)],expected:['right-a','right-b']},
 {finding:'R2',name:'Central',candidates:[stop('Central','main',.001),stop('Central (Platform A)','platform-a',.0011),stop('Unrelated','other',.0001)],expected:['main','platform-a']},
 {finding:'R4',name:'東京 1 Tōkyō',candidates:[stop('東京 1 Tōkyō','exact',.001),stop('東京 1Tōkyō','equivalent',.0011),stop('Unrelated','other',.0001)],expected:['exact','equivalent']},
 {finding:'R5',name:'Central',candidates:[stop('Central (Platform 1/2)','combined',.001),stop('Central (Track 2-3)','range',.0011),stop('Unrelated','other',.0001)],expected:['combined','range']},
 {finding:'R3',name:'東京',candidates:[stop('東京','native',.001),stop('東京 (Tōkyō) Station','bilingual',.0011),stop('Unrelated','other',.0001)],expected:['native','bilingual']},
];
const permutations=items=>items.length<2?[items]:items.flatMap((item,i)=>permutations(items.filter((_,j)=>j!==i)).map(rest=>[item,...rest]));
for(const item of scenarios){
 const station={lat:0,lon:0,names:[item.name]};
 for(const order of permutations(item.candidates)) assert.deepEqual(before(order,station).map(s=>s.id),item.expected,'baseline accepted only the expected records');
 const actual=patched(item.candidates,station).map(s=>s.id);
 assert.deepEqual(actual,item.expected,'review finding is repaired');
 console.log(JSON.stringify({finding:item.finding,station:item.name,expected:item.expected,baseline:before(item.candidates,station).map(s=>s.id),patched:actual}));
 for(const order of permutations(item.candidates)) assert.deepEqual(patched(order,station).map(s=>s.id),actual,'all six candidate permutations agree');
}
const item=scenarios[0], requests=[];
const board=await stationDepartures({lat:0,lon:0,names:[item.name]},{fetch:async href=>{
 const url=new URL(href);requests.push(url);return {ok:true,json:async()=>url.pathname.endsWith('/reverse-geocode')?item.candidates:{stopTimes:[]}};
}});
assert.equal(requests.length,3);
console.log(JSON.stringify({finding:'R1 integration',boardIds:board.stops.map(s=>s.id),requestIds:requests.slice(1).map(u=>u.searchParams.get('stopId')),journeyIds:['from','to'].map(direction=>new URL(plannerLink(direction,board.stops[0].id,item.name)).searchParams.get(`${direction}Place`))}));

let checks=0;
for (const prefix of ['Terminal', '中央', 'Central ', 'Терминал ', 'Αποβάθρα ']) {
 for(let n=1;n<=15;n++) for(let m=1;m<=15;m++) {
  if(n===m) continue;
  const name=prefix+n, other=prefix+m;
  const candidates=[stop(name,'a',.001),stop(name,'b',.0011),stop(other,'wrong',.0001)];
  assert.deepEqual(patched(candidates,{lat:0,lon:0,names:[name]}).map(s=>s.id),['a','b']);
  checks++;
 }
}
console.log(JSON.stringify({numericBoundaryChecks:checks,result:'passed'}));
