import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import * as model from '../../styles/map-model.mjs';

const app = await readFile(new URL('../../styles/app.mjs', import.meta.url), 'utf8');
// Execute the actual request/cache/submission/rendering block, with real DOM
// nodes and model transformations. No provider or browser network is available.
const begin = app.indexOf('// Nominatim allows at most one request a second:');
const end = app.indexOf('\nfrequencyExpiry=installFrequencyExpiry(', begin);
assert.ok(begin >= 0 && end > begin, 'search block delimiters exist');
const source = app.slice(begin, end);
export const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };
export const station = {osm_id:9001, name:'Synthetic station', latitude:51.5, longitude:-0.1, railway:'station'};
export const place = {osm_type:'relation', osm_id:9002, name:'Synthetic town', lat:'51.6', lon:'-0.2', type:'town', display_name:'Synthetic town, Fixture region'};
export const response = (rows=[], status=200) => ({ok:status>=200&&status<300, status, json:async()=>structuredClone(rows)});
export function searchHarness({fetcher=async()=>response(), local=[], language='local'}={}) {
  const dom = new JSDOM('<form id="search-form"><input id="search-input"></form><p id="search-status" hidden></p><ul id="search-results" hidden></ul><div id="controls" hidden></div>');
  const document=dom.window.document, $=id=>document.getElementById(id), calls=[], navigation=[], details=[], timers=new Map();
  let now=1_000_000, serial=0, submit;
  const original=$('search-form').addEventListener.bind($('search-form'));
  $('search-form').addEventListener=(type,fn,...args)=>{if(type==='submit')submit=fn;return original(type,fn,...args);};
  const settings={language}, map={getZoom:()=>14,getCenter:()=>({toArray:()=>[0,0]}),getStyle:()=>({layers:[{id:'station-fixture-names',type:'symbol',source:'fixture','source-layer':'stations'}]}),getSource:()=>({}),querySourceFeatures:()=>structuredClone(local),flyTo:options=>navigation.push({type:'flyTo',options}),fitBounds:(bounds,options)=>navigation.push({type:'fitBounds',bounds,options})};
  const context=vm.createContext({document,$,URL,AbortController,settings,map,ready:Boolean(local.length),majorStationSearchData:null,
    whenReady:fn=>fn(),showDetails:item=>details.push(item),searchResponse:model.searchResponse,searchResults:model.searchResults,tileStations:model.tileStations,drawnStationQueries:model.drawnStationQueries,displayName:model.displayName,
    SEARCH_API:model.SEARCH_API,PLACE_SEARCH_API:model.PLACE_SEARCH_API,matchMedia:()=>({matches:false}),locate:()=>({}),
    textNode:(tag,text,className)=>{const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n;},
    fetch:async(url,options)=>{const copy=new URL(url);assert.ok([model.SEARCH_API,model.PLACE_SEARCH_API].some(api=>copy.href.startsWith(api)));calls.push({url:copy,options});return fetcher(copy,options);},
    Date:class extends Date {static now(){return now;}},
    setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{at:now+ms,fn});return id;},clearTimeout:id=>timers.delete(id),
  });
  vm.runInContext('let searchController, searchPausedUntil=0;\n'+source,context);
  return {dom,calls,settings,navigation,details,
    submit:async(q='Synthetic')=>{$('search-input').value=q;return submit({preventDefault(){}});},
    status:()=>$('search-status').textContent,results:()=>$('search-results'),
    advance:async(ms)=>{const until=now+ms;while(true){const due=[...timers].filter(([,t])=>t.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;const [id,t]=due;now=t.at;timers.delete(id);t.fn();await flush();}now=until;await flush();},
    close:()=>dom.window.close(),
  };
}
