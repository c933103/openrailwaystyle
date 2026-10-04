import test from 'node:test';
import assert from 'node:assert/strict';
import {featureFilter,validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {powerFacility,createPowerFacilityLoader} from '../styles/power-facilities.mjs';
import {powerFacilitiesGeoJSON,powerFacilityQuery} from '../scripts/power-facility-data.mjs';
import {powerFacilityLayers} from '../scripts/style/layers/power-facilities.mjs';
import {annotateLayers,layerVisibility} from '../styles/layer-semantics.mjs';

function candidateSelector(query) {
  // Decode actual QL filters independently of the facility classifier.
  const selectors=[...query.matchAll(/nwr((?:\[~?"(?:[^"\\]|\\.)*"~"(?:[^"\\]|\\.)*",i\])+)\(-90,-180,0,-90\);/g)].map(([,text])=>
    [...text.matchAll(/\[(~)?("(?:[^"\\]|\\.)*")~("(?:[^"\\]|\\.)*"),i\]/g)].map(([,keyRegex,key,value])=>({
      key:JSON.parse(key),keyRegex:Boolean(keyRegex),value:new RegExp(JSON.parse(value).replaceAll('[[:space:]]','\\s'),'i'),
    })));
  return {selectors,selected:tags=>selectors.some(filters=>filters.every(({key,keyRegex,value})=>
    Object.entries(tags).some(([name,text])=>(keyRegex?new RegExp(key,'i').test(name):name===key)&&value.test(text))))};
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
  const {selectors,selected}=candidateSelector(query);
  assert.equal(selectors.length,11,'eight lifecycle keys share eleven bounded selection rules');
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

test('native key case overfetch does not publish uppercase-only or otherwise unqualified facilities',()=>{
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
    {railway:'\u00a0fuel',POWER:'plant',usage:'railway'},
  ];
  for(const id of [0,1,2,3,4,6])assert.equal(selected(tags[id]),true,JSON.stringify(tags[id]));
  assert.equal(selected(tags[5]),false,'literal-key hint filters keep their original key case');
  const data=powerFacilitiesGeoJSON({elements:tags.map((tags,id)=>({type:'node',id,lat:0,lon:0,tags}))});
  assert.deepEqual(data.features.map(f=>f.id),['node-8']);
  assert.equal(data.features[0].properties.power_kind,'fuel','mixed tags still require a qualifying canonical supply');
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
  assert.match(powerFacilityQuery([-90,-180,0,-90]),/nwr\[~/);
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
