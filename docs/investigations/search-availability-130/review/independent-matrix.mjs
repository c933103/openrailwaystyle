import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{'candidate-root':{type:'string'},'predecessor-root':{type:'string'}},allowPositionals:false});
assert.ok(values['candidate-root']&&values['predecessor-root'], 'Usage: node independent-matrix.mjs --candidate-root <root> --predecessor-root <root>');
const helper=root=>pathToFileURL(resolve(root,'tests/helpers/search-ui-harness.mjs')).href;
const [candidate,previous]=await Promise.all([import(helper(values['candidate-root'])),import(helper(values['predecessor-root']))]);
const isFacility=url=>url.pathname.endsWith('/facility');
const local={type:'Feature',geometry:{type:'Point',coordinates:[-.1,51.5]},properties:{id:'node-9003',name:'Synthetic local station',feature:'station'}};
const output=[];
for(const [version,api] of [['predecessor',previous],['candidate',candidate]]) {
 for(const [name,stationState,placeState,drawn] of [
  ['complete-empty','empty','empty',[]],['partial-empty-station','failed','empty',[]],['partial-empty-place','empty','failed',[]],
  ['healthy-place-survives','failed','row',[]],['healthy-station-survives','row','failed',[]],['total-outage','failed','failed',[]],
  ['local-survives-total-outage','failed','failed',[local]],['place-only-timeout','row','timeout',[]]
 ]) {
  const h=api.searchHarness({local:drawn,fetcher:async(url,{signal})=>{
   const isStation=isFacility(url),state=isStation?stationState:placeState;
   if(state==='timeout')return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('synthetic timeout')),{once:true}));
   return api.response(state==='row'?[isStation?api.station:api.place]:[],state==='failed'?503:200);
  }});
  try {
   const pending=h.submit();await api.flush();if(placeState==='timeout')await h.advance(8000);await pending;
   const result={version,case:name,status:h.status(),hidden:h.results().hidden,rows:h.results().querySelectorAll('button').length,calls:h.calls.length};
   output.push(result);
   if(version==='candidate'&&name.startsWith('partial-empty'))assert.match(result.status,/^No matches from the available sources\. Search incomplete:/);
   if(version==='candidate'&&name==='place-only-timeout'){assert.equal(result.status,'1 railway result, 0 places. Search incomplete: place search unavailable.');assert.equal(result.rows,1);}
  } finally {h.close();}
 }
}
await writeFile(new URL('independent-matrix.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
