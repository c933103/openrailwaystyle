import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {featureFilter,validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {powerFacility,createPowerFacilityLoader} from '../styles/power-facilities.mjs';
import {powerFacilitiesGeoJSON,powerFacilityQuery,powerFacilityCacheRecordAccepted,powerFacilityCachedResponse} from '../scripts/power-facility-data.mjs';
import {powerFacilityLayers} from '../scripts/style/layers/power-facilities.mjs';
import {annotateLayers,layerVisibility} from '../styles/layer-semantics.mjs';

function candidateSelector(query) {
  // Decode actual QL filters independently of the facility classifier.
  const decode=text=>[...text.matchAll(/nwr(\.(?:hints|potential))?((?:\["(?:[^"\\]|\\.)*"~"(?:[^"\\]|\\.)*",i\])+)(\(-90,-180,0,-90\))?;/g)].map(([,set,filters,bbox])=>({set,bbox,
    filters:[...filters.matchAll(/\[("(?:[^"\\]|\\.)*")~("(?:[^"\\]|\\.)*"),i\]/g)].map(([,key,value])=>({
      key:JSON.parse(key),value:new RegExp(JSON.parse(value).replaceAll('[[:space:]]','\\s'),'i'),
    })),
  }));
  const parts=query.split(')->.hints;');
  const hints=parts.length===2 ? decode(parts[0]) : [],selectors=decode(parts.at(-1));
  const potentialKeys=[...parts.at(-1).matchAll(/is_tag\(("(?:[^"\\]|\\.)*")\)/g)].map(([,key])=>JSON.parse(key));
  const matches=(tags,filters)=>filters.every(({key,value})=>tags[key]!=null&&value.test(tags[key]));
  return {hints,selectors,potentialKeys,selected:tags=>{
    const hinted=hints.some(({filters})=>matches(tags,filters));
    const potential=hinted&&potentialKeys.some(key=>Object.hasOwn(tags,key));
    return selectors.some(({set,filters})=>(!set||(set==='.hints'?hinted:potential))&&matches(tags,filters));
  }};
}

test('power supplies select locomotive facilities without proximity or operator guesses',()=>{
  for(const kind of ['fuel','coaling_facility','water_tower','water_tank','water_crane','power_supply','preheating'])assert.equal(powerFacility({railway:kind}).kind,kind);
  assert.equal(powerFacility({power:'substation',substation:'traction'}).kind,'substation');
  assert.equal(powerFacility({power:'plant',frequency:'16.7'}).kind,'plant');
  assert.equal(powerFacility({power:'generator',frequency:'50;16.67'}).kind,'generator');
  assert.equal(powerFacility({power:'plant',railway:'yes'}).kind,'plant');
  assert.equal(powerFacility({power:'transformer',transformer:'traction',frequency:'50'}).kind,'transformer');
  assert.equal(powerFacility({'railway:electricity':'power_supply'}).kind,'feeder');
  assert.equal(powerFacility({man_made:'storage_tank',content:'water',landuse:'railway'}).kind,'water_tank');
  assert.equal(powerFacility({man_made:'storage_tank',content:'diesel',usage:'railway'}).kind,'fuel_tank');
  for(const tags of [{amenity:'fuel','fuel:diesel':'yes'},{man_made:'water_tower'},
    {man_made:'storage_tank',content:'water'},{power:'substation',substation:'distribution'},
    {power:'plant',frequency:'50'},{power:'generator',frequency:'0'},{power:'plant',operator:'Railway company'}])assert.equal(powerFacility(tags),null,JSON.stringify(tags));
});

test('maintenance selectors include every supported token and lifecycle hint before classification',()=>{
  const query=powerFacilityQuery([-90,-180,0,-90]);
  // Decode the actual QL strings, including escaped regex dots. This checks
  // candidate selection independently of the JS classifier and catches tags
  // that fixture-only transform tests would accept but never download.
  const {selected}=candidateSelector(query);
  for(const tags of [
    {railway:' fuel ; WATER_CRANE '},
    {power:' generator ; converter ',railway:' rail ; yes '},
    {power:'substation',substation:' distribution ; TRACTION '},
    {power:'transformer',transformer:' main ; traction ',frequency:'50'},
    {power:'plant',frequency:'50 ; 16.66'},
    {power:'plant',frequency:'16.666'},
    {power:'plant',frequency:'16.667'},
    {'disused:power':'generator','disused:railway':'yes'},
    {'construction:man_made':'storage_tank','construction:railway':'yes',content:'diesel'},
    {power:'plant',usage:' industrial ; railway '},
    {man_made:'storage_tank',content:'water',landuse:' railway ; industrial '},
  ]) {
    assert.ok(powerFacility(tags),JSON.stringify(tags));
    assert.equal(selected(tags),true,JSON.stringify(tags));
  }
  for(const tags of [{power:'plant',frequency:'16x7'},{power:'transformer',transformer:'main',frequency:'50'},
    {power:'plant',usage:'not_railway'},{railway:'not_fuel'}])assert.equal(selected(tags),false,JSON.stringify(tags));
  for(const prefix of ['', 'construction:', 'proposed:', 'disused:', 'abandoned:', 'razed:', 'demolished:', 'removed:']) {
    for(const tags of [
      {[`${prefix}railway`]:' WATER_CRANE ; fuel '},
      {[`${prefix}railway:electricity`]:' POWER_SUPPLY '},
      {[`${prefix}power`]:' generator ; converter ',substation:' TRACTION '},
      {[`${prefix}power`]:' transformer ',transformer:' traction '},
      {[`${prefix}power`]:' plant ',[`${prefix}railway`]:' rail '},
      {[`${prefix}power`]:' plant ',usage:' railway '},
      {[`${prefix}power`]:' plant ',landuse:' railway '},
      {[`${prefix}power`]:' plant ',frequency:' 16.667 '},
      {[`${prefix}man_made`]:' storage_tank ',[`${prefix}railway`]:' yes ',content:'diesel'},
      {[`${prefix}man_made`]:' water_tower ',landuse:' railway '},
      {[`${prefix}man_made`]:' water_tower ',usage:' traction '},
    ]) {
      assert.ok(powerFacility(tags),JSON.stringify(tags));
      assert.equal(selected(tags),true,JSON.stringify(tags));
    }
  }
  for(const tags of [{'future:railway':'fuel'},{'xdisused:power':'plant',usage:'railway'},
    {'disused:power:extra':'plant',usage:'railway'},{railway:'fuel_stop'},
    {power:'plant',frequency:'16.6667'},{railway:'oil_fuel'}])assert.equal(selected(tags),false,JSON.stringify(tags));
});

test('power/tank filters use only the bounded named hint set, avoiding global primary-tag scans',()=>{
  const query=powerFacilityQuery([-90,-180,0,-90]);
  const {hints,selectors,potentialKeys}=candidateSelector(query);
  assert.equal(query.includes('[~'),false,'all tag keys stay literal');
  assert.equal(hints.length,13,'railway lifecycle hints and five explicit energy/usage hints');
  assert.ok(hints.every(selector=>selector.bbox&&!selector.set),'every hint search is spatially bounded');
  assert.equal(selectors.length,32);
  const local=selectors.filter(selector=>selector.set==='.potential');
  assert.equal(local.length,16);
  assert.ok(local.every(selector=>selector.filters.length===1&&/^(?:(?:construction|proposed|disused|abandoned|razed|demolished|removed):)?(?:power|man_made)$/.test(selector.filters[0].key)));
  assert.deepEqual(potentialKeys,['','construction:','proposed:','disused:','abandoned:','razed:','demolished:','removed:'].flatMap(prefix=>['power','man_made'].map(key=>prefix+key)));
  assert.equal(query.match(/nwr\.hints\(if:/g)?.length,1,'one bounded full-hint tag retrieval precedes local value filters');
  const direct=selectors.filter(selector=>!selector.set);
  assert.equal(direct.length,16);
  assert.ok(direct.every(selector=>selector.bbox&&selector.filters.length===1&&/railway(?::electricity)?$/.test(selector.filters[0].key)));
  assert.match(query,/\[maxsize:134217728\]/,'retain the existing memory cap and let the builder quarter failures');
  assert.equal(query.includes('out count'),false,'diagnostic count objects stay out of production snapshots');
});

test('key-presence prefilter preserves all v6 raw selections and classifier output',()=>{
  const fixture=readFileSync(new URL('./fixtures/power-hints-v6-query.ql',import.meta.url),'utf8');
  const prior=candidateSelector(fixture),current=candidateSelector(powerFacilityQuery([-90,-180,0,-90]));
  const prefixes=['','construction:','proposed:','disused:','abandoned:','razed:','demolished:','removed:'];
  const keys=prefixes.flatMap(prefix=>['power','man_made'].map(key=>prefix+key));
  let compared=0;
  const compare=tags=>{
    assert.equal(current.selected(tags),prior.selected(tags),JSON.stringify(tags));
    const accepted=Boolean(powerFacility(tags));
    assert.equal(current.selected(tags)&&accepted,prior.selected(tags)&&accepted,JSON.stringify(tags));
    compared++;
  };
  const kinds=['plant','generator','transformer','substation','converter','frequency_converter','water_tower','storage_tank','cable','unknown'];
  const hints=[{}, {substation:' distribution ; TRACTION '},{transformer:' traction '},{usage:' industrial ; railway '},
    {landuse:' railway '},{frequency:' 16.667 '},{frequency:'50'},{railway:'yes'},{railway:'fuel'},
    {RAILWAY:'yes'},{usage:'not_railway'},...prefixes.map(prefix=>({[`${prefix}railway`]:' rail ; yes '}))];
  for(const prefix of prefixes)for(const kind of kinds)for(const hint of hints)for(const key of ['power','man_made'])
    compare({[`${prefix}${key}`]:` other ; ${kind.toUpperCase()} `,content:' water ; diesel ',...hint});
  for(const prefix of prefixes)for(const kind of ['fuel','coaling_facility','water_tower','water_tank','water_crane','power_supply','preheating','power_station','substation'])
    compare({[`${prefix}railway`]:` other ; ${kind.toUpperCase()} `});
  assert.equal(compared,3112);
  for(const key of keys)for(const value of ['', ';', 'plant', 'water_tower', 'PLANT', ' other ; plant ', ' power_station ', '\u00a0plant\u00a0', 'pl\u212Ant', 'unknown'])
    for(const hint of [{usage:'railway'}, {railway:'fuel'}, {frequency:'16.7'}, {RAILWAY:'yes'}, {}]) {
      compare({...hint,[key]:value});compare({...hint,[key.toUpperCase()]:value});compare({...hint,[`x${key}`]:value});
    }
  assert.equal(compared,5512);
  const query=powerFacilityQuery([-90,-180,0,-90]);
  assert.equal(query.replace(/nwr\.hints\(if:[^;]*\)->\.potential;/,'').replaceAll('nwr.potential[','nwr.hints['),fixture,
    'only the tautological presence gate and input-set names differ from frozen v6');
});

test('reviewed v6 responses and split routes retain exact same-bbox compatibility and original freshness',()=>{
  const box=[-90,-180,0,-90],query=powerFacilityQuery(box);
  const legacy=readFileSync(new URL('./fixtures/power-hints-v6-query.ql',import.meta.url),'utf8');
  const now=Date.UTC(2026,9,4),options={now,mtimeMs:now-27*86400_000};
  const response={elements:[{type:'node',id:12,lat:34,lon:135,tags:{railway:'fuel'}}]};
  for(const cachedQuery of [query,legacy]) {
    const saved={query:cachedQuery,response},copy=structuredClone(saved);
    assert.equal(powerFacilityCacheRecordAccepted(box,query,{query:cachedQuery},options),true,'split marker follows the same query allowlist');
    assert.equal(powerFacilityCachedResponse(box,query,saved,options),response);
    assert.deepEqual(saved,copy,'acceptance does not migrate or rewrite saved records');
    assert.equal(powerFacilityCachedResponse(box,query,saved,{...options,refresh:true}),undefined);
    assert.equal(powerFacilityCachedResponse(box,query,saved,{...options,mtimeMs:now-28*86400_000}),undefined);
    assert.equal(powerFacilityCachedResponse(box,query,saved,{...options,mtimeMs:NaN}),undefined);
    assert.throws(()=>powerFacilityCachedResponse(box,query,{query:cachedQuery,response:{remark:'runtime error: timed out',elements:[]}},options),/timed out/);
    assert.throws(()=>powerFacilityCachedResponse(box,query,{query:cachedQuery,response:{elements:[{type:'node',id:12,tags:{railway:'fuel'}}]}},options),/Incomplete coordinates/);
  }
  assert.equal(powerFacilityCacheRecordAccepted([45,5.625,50.625,11.25],powerFacilityQuery([45,5.625,50.625,11.25]),{query:legacy},options),false);
  for(const changed of [legacy+' ',legacy.replace('16\\\\.','17\\\\.'),legacy.replace('timeout:240','timeout:300')])
    assert.equal(powerFacilityCacheRecordAccepted(box,query,{query:changed},options),false,'unknown query text never gains version-wide compatibility');
  assert.equal(powerFacilityCacheRecordAccepted(box,query,{version:6,response},options),false);
});

test('future changes to base selectors or the prefilter disable legacy-cache compatibility',async()=>{
  const url=new URL('../scripts/power-facility-data.mjs',import.meta.url);
  const source=readFileSync(url,'utf8').replaceAll("'../styles/power-facilities.mjs'",JSON.stringify(new URL('../styles/power-facilities.mjs',url).href))
    .replaceAll("'../styles/han-region.mjs'",JSON.stringify(new URL('../styles/han-region.mjs',url).href));
  const legacy=readFileSync(new URL('./fixtures/power-hints-v6-query.ql',import.meta.url),'utf8');
  const box=[-90,-180,0,-90],now=Date.UTC(2026,9,4),options={now,mtimeMs:now};
  for(const changed of [source.replace("const SUPPLIES = 'fuel|","const SUPPLIES = 'new_supply|fuel|"),
    source.replace("PREFIXES.flatMap(prefix=>['power','man_made'].map", "PREFIXES.flatMap(prefix=>['power'].map")]) {
    assert.notEqual(changed,source);
    const future=await import(`data:text/javascript;base64,${Buffer.from(changed).toString('base64')}`);
    const query=future.powerFacilityQuery(box);
    assert.equal(future.powerFacilityCacheRecordAccepted(box,query,{query:legacy},options),false,
      'matching a changed generator is insufficient: both approved normalized query digests must match');
    const changedLegacy=query.replace(/nwr\.hints\(if:[^;]*\)->\.potential;/,'').replaceAll('nwr.potential[','nwr.hints[');
    assert.equal(future.powerFacilityCacheRecordAccepted(box,query,{query:changedLegacy},options),false,
      'an unknown prefilter-free form cannot qualify merely by matching the changed base generator');
    assert.equal(future.powerFacilityCacheRecordAccepted(box,query,{query},options),true,'exact future-current query caches remain valid');
  }
});

test('named-set filtering preserves classifier-accepted supplies from the literal-query baseline',()=>{
  // Freeze the prior literal expansion independently of the production query
  // generator, so moving a filter between stages cannot silently lose supplies.
  const prior=candidateSelector(readFileSync(new URL('./fixtures/power-literal-query.ql',import.meta.url),'utf8'));
  const current=candidateSelector(powerFacilityQuery([-90,-180,0,-90]));
  assert.equal(prior.selectors.length,200);
  const prefixes=['','construction:','proposed:','disused:','abandoned:','razed:','demolished:','removed:'];
  const kinds=['plant','generator','transformer','substation','converter','frequency_converter','water_tower','storage_tank','cable','unknown'];
  const hints=[{}, {substation:' distribution ; TRACTION '},{transformer:' traction '},{usage:' industrial ; railway '},
    {landuse:' railway '},{frequency:' 16.667 '},{frequency:'50'},{railway:'yes'},{railway:'fuel'},
    {RAILWAY:'yes'},{usage:'not_railway'},...prefixes.map(prefix=>({[`${prefix}railway`]:' rail ; yes '}))];
  for(const prefix of prefixes)for(const kind of kinds)for(const hint of hints)for(const key of ['power','man_made']) {
    const tags={[`${prefix}${key}`]:` other ; ${kind.toUpperCase()} `,content:' water ; diesel ',...hint};
    const accepted=Boolean(powerFacility(tags));
    assert.equal(current.selected(tags)&&accepted,prior.selected(tags)&&accepted,JSON.stringify(tags));
  }
  for(const prefix of prefixes)for(const kind of ['fuel','coaling_facility','water_tower','water_tank','water_crane','power_supply','preheating','power_station','substation']) {
    const tags={[`${prefix}railway`]:` other ; ${kind.toUpperCase()} `};
    assert.ok(powerFacility(tags));assert.ok(current.selected(tags));assert.ok(prior.selected(tags));
  }
});

test('literal hints and classification reject uppercase-only and irrelevant energy hints',()=>{
  const {selected}=candidateSelector(powerFacilityQuery([-90,-180,0,-90]));
  const tags=[
    {POWER:'plant',usage:'railway'},
    {RAILWAY:'fuel'},
    {'DISUSED:RAILWAY':'water_tower'},
    {power:'plant',RAILWAY:'yes'},
    {MAN_MADE:'storage_tank',content:'diesel',usage:'railway'},
    {power:'substation',SUBSTATION:'traction'},
    {power:'cable','disused:power':'plant',usage:'railway'},
    {power:'plant',usage:'not_railway'},
    {power:'plant',transformer:'traction'},
    {man_made:'water_tower',frequency:'16.7'},
    {man_made:'storage_tank',content:'water',substation:'traction'},
  ];
  for(const id of [0,1,2,3,4,5,7])assert.equal(selected(tags[id]),false,JSON.stringify(tags[id]));
  for(const id of [6,8,9,10])assert.equal(selected(tags[id]),true,'the classifier must discard irrelevant raw hint matches');
  const data=powerFacilitiesGeoJSON({elements:tags.map((tags,id)=>({type:'node',id,lat:0,lon:0,tags}))});
  assert.equal(data.features.length,0);
});

test('snapshot keeps node/way/relation identities and lifecycle instead of claiming former supplies are operating',()=>{
  const data=powerFacilitiesGeoJSON({elements:[
    {type:'node',id:12,lat:34,lon:135,tags:{railway:'fuel'}},
    {type:'way',id:12,center:{lat:35,lon:136},tags:{'disused:railway':'water_tower'}},
    {type:'relation',id:99,center:{lat:36,lon:137},tags:{power:'plant',railway:'yes',name:'Traction plant'}},
    {type:'node',id:11,lat:34,lon:135,tags:{amenity:'fuel'}},
  ]});
  assert.deepEqual(data.features.map(f=>f.id),['node-12','relation-99','way-12']);
  assert.equal(data.features.find(f=>f.id==='way-12').properties.power_state,'disused');
  assert.equal(data.features.find(f=>f.id==='relation-99').properties.osm_type,'relation');
  assert.throws(()=>powerFacilitiesGeoJSON({remark:'runtime error: timed out',elements:[]}),/timed out/);
  assert.match(powerFacilityQuery([-90,-180,0,-90]),/nwr\["railway"/);
  assert.match(powerFacilityQuery([-90,-180,0,-90]),/out body center qt/);
  // Overpass `out tags center` has ids/tags for nodes but no coordinates;
  // silently accepting this output would falsely publish complete coverage.
  assert.throws(()=>powerFacilitiesGeoJSON({elements:[{type:'node',id:12,tags:{railway:'fuel'}}]}),/Incomplete coordinates.*node-12/);
  assert.throws(()=>powerFacilitiesGeoJSON({elements:[{type:'way',id:12,tags:{railway:'water_tower'}}]}),/Incomplete coordinates.*way-12/);
  assert.equal(powerFacilitiesGeoJSON({elements:[{type:'node',id:11,tags:{amenity:'fuel'}}]}).features.length,0,'unrelated facilities stay excluded');
});

test('Power-only facility layers place symbols by actual supply zoom and gate former supplies',()=>{
  const layers=annotateLayers(powerFacilityLayers());
  for(const layer of layers) {
    assert.equal(layerVisibility(layer,{mode:'infrastructure',labels:true,inactive:true}),false,layer.id);
    assert.equal(layerVisibility(layer,{mode:'control',labels:true,inactive:true}),false,layer.id);
    assert.equal(layerVisibility(layer,{mode:'electrification',labels:true,inactive:true}),true,layer.id);
  }
  const point=layers.find(l=>l.id==='electrification-supply-points');
  const filter=featureFilter(point.filter).filter;
  assert.equal(filter({zoom:12},{type:1,properties:{power_state:'present',power_minzoom:13}}),false);
  assert.equal(filter({zoom:13},{type:1,properties:{power_state:'present',power_minzoom:13}}),true);
  assert.equal(filter({zoom:15},{type:1,properties:{power_state:'disused',power_minzoom:13}}),false);
  const former=layers.find(l=>l.id==='electrification-former-supply-points');
  assert.equal(layerVisibility(former,{mode:'electrification',labels:true,inactive:false}),false);
  const names=layers.find(l=>l.id==='electrification-supply-names');
  assert.equal(layerVisibility(names,{mode:'electrification',labels:false,inactive:true}),false);
  const style={version:8,glyphs:'https://example.org/{fontstack}/{range}.pbf',sources:{
    electricFacilities:{type:'geojson',data:{type:'FeatureCollection',features:[]}},
    electricSubstations:{type:'vector',tiles:['https://example.org/{z}/{x}/{y}']},
  },layers};
  assert.deepEqual(validateStyleMin(style),[]);
});

test('supply snapshot loading is lazy, shared and re-localized without downloading again',async()=>{
  let enabled=false,calls=0,currentLanguage='en';const shown=[];
  const map={getSource:()=>({setData:data=>shown.push(data)})};
  const data={type:'FeatureCollection',features:[]};
  const refresh=createPowerFacilityLoader(map,{url:'fixture.geojson',active:()=>enabled,language:()=>currentLanguage,
    localize:(d,language)=>({...d,language}),fetcher:async()=>{calls++;return{ok:true,json:async()=>data};}});
  await refresh();assert.equal(calls,0);
  enabled=true;await Promise.all([refresh(),refresh()]);assert.equal(calls,1);assert.equal(shown.length,1);
  currentLanguage='ja';await refresh();assert.equal(calls,1);assert.equal(shown[1].language,'ja');
  assert.equal(data.language,undefined);
});

test('former railway use does not describe an operating traction supply',()=>{
  for(const state of ['construction','proposed','disused','abandoned','removed']) {
    assert.equal(powerFacility({power:'plant',[`${state}:railway`]:'yes'}).state,state);
    assert.equal(powerFacility({man_made:'storage_tank',content:'water',[`${state}:railway`]:'yes'}).state,state);
  }
  assert.equal(powerFacility({power:'plant','disused:railway':'yes',frequency:'16.7'}).state,'present','independent current traction evidence');
  assert.equal(powerFacility({man_made:'storage_tank',content:'water','disused:railway':'yes',usage:'railway'}).state,'present');
});
