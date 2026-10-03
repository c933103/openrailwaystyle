import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {chooseName} from '../styles/map-model.mjs';

const app=await readFile(new URL('../styles/app.mjs',import.meta.url),'utf8');
const begin=app.indexOf('const OSM_API='),end=app.indexOf('function applySettings()',begin);
assert.ok(begin>=0&&end>begin);
const day=86400000,key='node/895371274',cacheKey='atlas_major_station_osm_names_v2';
const metadata={type:'FeatureCollection',features:[{type:'Feature',id:'Q54451',geometry:{type:'Point',coordinates:[-73.993,40.750]},properties:{osm_type:'node',osm_id:'895371274',id:'node-895371274',wikidata:'Q54451',tier:3,feature:'station',name:'Maintenance note only','name:en':'Do not display this',atlas_han:'none'}}]};
const response=tags=>({ok:true,status:200,json:async()=>({elements:[{type:'node',id:895371274,tags}]})});
const settle=async condition=>{const until=Date.now()+1000;while(Date.now()<until){if(condition())return;await new Promise(resolve=>setTimeout(resolve,0));}assert.ok(condition(),'asynchronous name state settled');};
async function harness(fetcher,cache){
 let clock=20*day,zoom=3;
 const stored=new Map(cache?[[cacheKey,JSON.stringify(cache)]]:[]),calls=[];
 const makeSource=()=>({writes:0,setData(data){this.data=data;this.writes++;}});
 let source=makeSource();
 const settings={stations:true,background:'map',language:'en'};
 const context=vm.createContext({URL,AbortController,setTimeout,clearTimeout,Date:{now:()=>clock},console:{warn(){}},chooseName,settings,ready:true,assetVersion:'test',map:{getZoom:()=>zoom,getSource:id=>id==='stationMajor'?source:null},localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,value)=>stored.set(k,value)},fetch:async(url,options)=>{calls.push(String(url));return fetcher(url,options);}});
 const module=new vm.SourceTextModule(app.slice(begin,end)+`\nexport {majorStationNameTags,updateMajorStations};\nexport const seed=data=>{majorStationData=data;};\nexport const busy=()=>Boolean(majorStationNamesPromise);\nexport const search=()=>majorStationSearchData;`,{context,initializeImportMeta:meta=>{meta.url='https://example.test/app.mjs';}});
 await module.link(()=>{throw new Error('Unexpected loader import');});await module.evaluate();
 const api=module.namespace;api.seed(structuredClone(metadata));
 return{load:()=>api.majorStationNameTags(metadata,{timeout:100}),update:()=>api.updateMajorStations(),busy:api.busy,search:api.search,settings,calls,source:()=>source,replaceSource:()=>{source=makeSource();},zoom:value=>{zoom=value;},advance:ms=>{clock+=ms;},cache:()=>JSON.parse(stored.get(cacheKey)||'null')};
}

for(const hidden of ['zoom','stations','satellite'])test(`a refresh completed while hidden by ${hidden} reapplies labels and search on return`,async()=>{
 let defer=false,release;
 const h=await harness(()=>defer?new Promise(resolve=>{release=()=>resolve(response({name:'Updated local','name:en':'Updated English'}));}):response({name:'Old local','name:en':'Old English'}));
 h.update();await settle(()=>h.source().writes===1&&!h.busy());
 assert.equal(h.search().features[0].properties.atlas_name,'Old English');
 h.advance(8*day);defer=true;h.update();await settle(()=>Boolean(release));
 if(hidden==='zoom')h.zoom(8);else if(hidden==='stations')h.settings.stations=false;else h.settings.background='satellite';
 h.update();release();await settle(()=>!h.busy());
 assert.equal(h.source().writes,1,'no hidden source write');
 assert.equal(h.search().features[0].properties.atlas_name,'Old English','hidden completion does not replace search prematurely');
 if(hidden==='zoom')h.zoom(3);else if(hidden==='stations')h.settings.stations=true;else h.settings.background='map';
 h.update();await settle(()=>h.source().writes===2&&!h.busy());
 assert.equal(h.source().data.features[0].properties.atlas_name,'Updated English');
 assert.equal(h.search().features[0].properties.atlas_name,'Updated English');
 assert.equal(h.calls.length,2,'returning uses the successful fresh OSM cache, not another request');
});

test('OSM annotations cannot enter language fallback or cached translation fields',async()=>{
 const h=await harness(()=>response({name:'Mapped Station','name:en':'Mapped Station','name:etymology':'Происхождение','name:pronunciation':'発音','name:signed':'no','name:source':'Survey','name:en:pronunciation':'annotation'}));
 const names=await h.load(),tags=names[key];
 assert.equal(chooseName({...tags,atlas_han:'cjkv'},'ru'),'Mapped Station');
 assert.equal(chooseName({...tags,atlas_han:'cjkv'},'ja'),'Mapped Station');
 for(const tag of ['name:etymology','name:pronunciation','name:signed','name:source','name:en:pronunciation']){
  assert.equal(tag in tags,false,tag);assert.equal(tag in h.cache().records[key].tags,false,tag);
 }
});

test('cached semantic fields are discarded without invalidating valid language names',async()=>{
 const h=await harness(()=>{throw new Error('fresh names must not fetch');},{version:2,records:{[key]:{fetchedAt:20*day,tags:{name:'Cached Station','name:etymology':'Происхождение','name:signed':123}}}});
 const tags=(await h.load())[key];
 assert.equal(tags.name,'Cached Station');
 assert.equal('name:etymology' in tags,false);assert.equal('name:signed' in tags,false);
 assert.equal(chooseName(tags,'ru'),'Cached Station');assert.equal(h.calls.length,0);
});

test('language/script/region variants and explicitly supported legacy names survive filtering',async()=>{
 const translations={'name:en':'English','name:zh-Hant':'Recorded Traditional','name:zh-Hant-HK':'Recorded regional','name:yue':'Recorded Cantonese','name:sr-Latn':'Recorded Latin','name:ja_kana':'Recorded kana','name:ko-Hani':'Recorded Hanja','name:vi-Hani':'Recorded Nom','name:ko:hanja':'Legacy Hanja','name:vi:nom':'Legacy Nom'};
 const h=await harness(()=>response({name:'Local',...translations,'name:etymology:wikidata':'Q1'}));
 const tags=(await h.load())[key];
 for(const [tag,value] of Object.entries(translations))assert.equal(tags[tag],value,tag);
 assert.equal('name:etymology:wikidata' in tags,false);
});

test('an in-flight refresh applies only to the replacement source and latest language',async()=>{
 let defer=false,release;
 const tags={name:'Native','name:en':'English','name:de':'Deutsch'};
 const h=await harness(()=>defer?new Promise(resolve=>{release=()=>resolve(response(tags));}):response(tags));
 h.update();await settle(()=>h.source().writes===1&&!h.busy());
 const old=h.source();h.advance(8*day);defer=true;h.update();await settle(()=>Boolean(release));
 h.settings.language='de';h.replaceSource();h.update();release();
 await settle(()=>h.source().writes===1&&!h.busy());
 assert.equal(old.writes,1,'old source cannot receive late data');
 assert.equal(h.source().data.features[0].properties.atlas_name,'Deutsch');
 assert.equal(h.search().features[0].properties.atlas_name,'Deutsch');
 assert.equal(h.calls.length,2,'latest source shares the already running request');
});
