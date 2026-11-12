import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
const base=process.argv[2];
const moduleAt = path => import(pathToFileURL(`${base}/${path}`).href);
const {stationDepartures, departureRows, plannerLink, TRANSITOUS_SOURCES, RAIL_MODES}=await moduleAt('styles/departures.mjs');
const {departureItem}=await moduleAt('styles/departures-ui.mjs');
const {displayName,osmObject}=await moduleAt('styles/map-model.mjs');
const station={lat:0,lon:0,names:['Central']};
const stop=id=>({type:'STOP',id,name:'Central',lat:0,lon:0,modes:['REGIONAL_RAIL']});
const row={mode:'REGIONAL_RAIL',displayName:'R8',headsign:'Harbour',tripId:'safe-trip',routeId:'safe-route',place:{stopId:'a',departure:'2099-01-01T12:00:00Z',scheduledDeparture:'2099-01-01T12:00:00Z',tz:'UTC'}};
const marker='synthetic private provider payload';
const badBodies=[
  ['empty body',''],['whitespace body',' '],['truncated JSON','{"stopTimes":'],['trailing JSON','{"stopTimes":[]} null'],
  ['null','null'],['false','false'],['true','true'],['zero','0'],['number','12'],['empty string','""'],['string',JSON.stringify(marker)],
  ['array','[]'],['array with row',JSON.stringify([row])],['empty object','{}'],['error object',JSON.stringify({error:marker})],
  ...[null,false,true,0,12,'','[]',marker,{}, {length:0}, {error:marker}].map(value=>[`stopTimes ${JSON.stringify(value)}`,JSON.stringify({stopTimes:value})]),
];
const failures=[]; let passed=0;
async function check(name,fn){try {await fn();passed++;}catch(error){failures.push({name,message:error.message});}}
const decode=body=>new Response(body,{headers:{'content-type':'application/json'}}).json();
function feed({order=['a','b'],body=JSON.stringify({stopTimes:[]}),badIds=['b'],times=[],candidates=order.map(stop),held=false}={}){
 const calls=[],release={},done={};let requested;const started=new Promise(resolve=>{requested=resolve;});
 const gates=Object.fromEntries(order.map(id=>[id,new Promise(resolve=>{release[id]=resolve;})]));
 const completed=Object.fromEntries(order.map(id=>[id,new Promise(resolve=>{done[id]=resolve;})]));
 return {calls,release,completed,started,fetch:async(url,options)=>{
  const parsed=new URL(url);calls.push({url:parsed,signal:options?.signal});
  if(parsed.pathname.endsWith('/reverse-geocode'))return {ok:true,json:async()=>structuredClone(candidates)};
  const id=parsed.searchParams.get('stopId');if(calls.length===3)requested();
  return {ok:true,json:async()=>{if(held)await gates[id];try{return await decode(badIds.includes(id)?body:JSON.stringify({stopTimes:times,unknownExtension:{safe:true}}));}finally{done[id]?.();}}};
 }};
}
for(const [label,body]of badBodies)for(const order of [['a','b'],['b','a']])for(const completion of [['a','b'],['b','a']])for(const times of [[],[row]])await check(`partial ${label} selection=${order} completion=${completion} rows=${times.length}`,async()=>{
 const fixture=feed({order,body,times,held:true,candidates:[...order.map(stop),stop('unselected')]}),signal=new AbortController().signal;
 const promise=stationDepartures(station,{fetch:fixture.fetch,signal});
 await fixture.started;fixture.release[completion[0]]();await fixture.completed[completion[0]];fixture.release[completion[1]]();
 const board=await promise;
 assert.deepEqual(board.stopResults,order.map(id=>({stopId:id,status:id==='b'?'rejected':'fulfilled'})));
 assert.deepEqual(board.rows,departureRows([times]));assert.deepEqual(board.stops,order.map(stop));
 assert.equal(fixture.calls.length,3);assert.ok(fixture.calls.every(c=>c.signal===signal));
 for(const call of fixture.calls.slice(1)){assert.equal(call.url.searchParams.get('n'),'30');assert.equal(call.url.searchParams.get('mode'),[...RAIL_MODES].join(','));}
 assert.ok(!JSON.stringify(board).includes(marker));assert.equal(board.stopResults.some(r=>'reason'in r),false);
});
for(const [label,body]of badBodies)await check(`all malformed ${label}`,async()=>{
 const f=feed({body,badIds:['a','b']});await assert.rejects(stationDepartures(station,{fetch:f.fetch}));assert.equal(f.calls.length,3);
});
for(const times of [[],[row]])await check(`valid array with extension rows=${times.length}`,async()=>{
 const original=structuredClone(times);const f=feed({times,badIds:[]});const result=await stationDepartures(station,{fetch:f.fetch});
 assert.deepEqual(result.rows,departureRows([times,times]));assert.deepEqual(result.stopResults,[{stopId:'a',status:'fulfilled'},{stopId:'b',status:'fulfilled'}]);assert.deepEqual(times,original);
});
const app=await readFile(`${base}/styles/app.mjs`,'utf8');
const renderer=app.slice(app.indexOf('const departureBoards = new Map();'),app.indexOf('// Level-crossing equipment'));
function boardDom(current){
 const dom=new JSDOM('<div id="panel"></div>'),document=dom.window.document,panel=document.querySelector('#panel');let now=1000;
 const settings={language:'en'};
 const context=vm.createContext({document,AbortSignal,departureItem,plannerLink,TRANSITOUS_SOURCES,Date:{now:()=>now},settings,displayName,osmObject,
  stationDepartures:(station,options)=>stationDepartures(station,{...options,fetch:(...args)=>current.value.fetch(...args)}),
  textNode:(tag,text,className='')=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n;}});
 const {showDepartures,departureBoards}=vm.runInContext(`${renderer}\n({showDepartures,departureBoards})`,context);
 const properties={id:'node-88',name:'Central','name:en':'Central','name:ja':'中央'};
 return {dom,panel,departureBoards,advance:ms=>{now+=ms;},show:(lang='en')=>{settings.language=lang;panel.replaceChildren();showDepartures(panel,{properties,geometry:{coordinates:[0,0]}});},settle:async()=>{await Promise.allSettled([...departureBoards.values()].map(b=>b.promise));await new Promise(resolve=>setImmediate(resolve));}};
}
const partial='Some departures could not load. The board may be incomplete.';
for(const [label,body]of badBodies)for(const times of [[],[row]])for(const languages of [['en','ja'],['ja','en']])await check(`DOM cache ${label} rows=${times.length} ${languages}`,async()=>{
 const current={value:feed({body,times})},view=boardDom(current);
 try{
  view.show(languages[0]);await view.settle();assert.equal(view.panel.querySelector('.departure-warning')?.textContent,partial);
  assert.equal(view.panel.querySelectorAll('.departure-list > li').length,times.length);assert.equal(view.panel.querySelectorAll('button').length,0);
  assert.doesNotMatch(view.panel.textContent,/No rail departures|No matching rail timetable stop|No published timetable|synthetic private/);
  const old=current.value;current.value=feed({times,badIds:[]});view.advance(60000);view.show(languages[1]);await view.settle();
  assert.equal(view.panel.querySelector('.departure-warning')?.textContent,partial);assert.equal(old.calls.length,3);assert.equal(current.value.calls.length,0);
  const link=new URL(view.panel.querySelector('.departure-links a').href);assert.equal(link.searchParams.get('fromName'),languages[1]==='ja'?'中央':'Central');
  view.advance(1);assert.equal(current.value.calls.length,0);view.show(languages[1]);await view.settle();
  assert.equal(current.value.calls.length,3);assert.equal(view.panel.querySelector('.departure-warning'),null);
  assert.equal(view.panel.querySelectorAll('.departure-list > li').length,times.length);if(!times.length)assert.match(view.panel.textContent,/No rail departures in the published timetable soon/);
 }finally{view.dom.window.close();}
});
for(const [label,body]of badBodies)await check(`DOM eviction ${label}`,async()=>{
 const current={value:feed({body,badIds:['a','b']})},view=boardDom(current);
 try{
  view.show();await view.settle();assert.equal(view.panel.textContent,'DeparturesDepartures could not load. Try again later.');assert.equal(view.departureBoards.size,0);assert.equal(current.value.calls.length,3);
  view.show('ja');await view.settle();assert.equal(view.panel.textContent,'DeparturesDepartures could not load. Try again later.');assert.equal(current.value.calls.length,6);
  current.value=feed({badIds:[],candidates:[]});view.show('en');await view.settle();assert.match(view.panel.textContent,/No matching rail timetable stop was found within 400 m/);assert.equal(current.value.calls.length,1);
  view.show('ja');await view.settle();assert.equal(current.value.calls.length,1);assert.doesNotMatch(view.panel.textContent,/No rail departures|could not load/);
 }finally{view.dom.window.close();}
});
console.log(JSON.stringify({base,badBodyShapes:badBodies.length,passed,failed:failures.length,failures},null,2));
process.exitCode=failures.length?1:0;
