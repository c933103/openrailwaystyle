import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {electricitySignalQuery,electricitySignalsGeoJSON} from '../scripts/electricity-signal-data.mjs';
import {buildElectricitySignals,validateElectricitySignalsSnapshot} from '../scripts/build-electricity-signals.mjs';
import {electricitySignalLayers} from '../scripts/style/layers/electricity-signals.mjs';
import {electricitySignalRows,POWER_FACILITY_EXPLANATION,ELECTRICITY_SIGNAL_NOTE} from '../styles/power-facilities.mjs';
import {featureFilter,validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {layerVisibility,annotateLayers} from '../styles/layer-semantics.mjs';
import {osmObject} from '../styles/map-model.mjs';

const node=(id,tags,lon=2,lat=48)=>({type:'node',id,lon,lat,tags:{railway:'signal',...tags}});

test('the query selects signals by the electricity tag alone',()=>{
  assert.equal(electricitySignalQuery([43,-2,50,8]),'[out:json][timeout:240][maxsize:134217728];node(43,-2,50,8)["railway"="signal"]["railway:signal:electricity"]["railway:signal:electricity"!="no"];out body qt;');
  for(const bad of [[0,0,0,0],[-91,0,0,1],[0,0,1],null])assert.throws(()=>electricitySignalQuery(bad),/Invalid electricity-signal bbox/);
});

test('every national value is kept, with electricity attributes only',()=>{
  const data=electricitySignalsGeoJSON({elements:[
    node(1,{'railway:signal:electricity':'FR:end_of_catenary','railway:signal:electricity:type':'end_of_catenary','railway:signal:electricity:form':'sign',ref:'A1','railway:signal:main':'DE-ESO:hp','railway:signal:direction':'forward'}),
    node(2,{'railway:signal:electricity':'PT-RGS:cortar_corrente','railway:signal:electricity:deactivated':'yes'}),
    node(3,{'railway:signal:electricity':'yes'}),
    node(4,{'railway:signal:electricity':'no'}),
    node(5,{'railway:signal:main':'DE-ESO:hp'}),
    {type:'node',id:6,lon:2,lat:48,tags:{railway:'buffer_stop','railway:signal:electricity':'yes'}},
    {type:'way',id:7,tags:{railway:'signal','railway:signal:electricity':'yes'}},
  ]});
  assert.deepEqual(data.features.map(f=>f.id),['node-1','node-2','node-3']);
  const [first,second,third]=data.features.map(f=>f.properties);
  assert.equal(first.electricity_label,'end of catenary');assert.equal(first.ref,'A1');assert.equal(first['railway:signal:direction'],'forward');
  assert.equal(first['railway:signal:main'],undefined,'other signal components are left out');
  assert.equal(first.power_state,'present');assert.equal(second.power_state,'deactivated');
  assert.equal(second.electricity_label,'PT-RGS:cortar corrente','the national value when no function is recorded');
  assert.equal(third.electricity_label,'yes');
  assert.deepEqual(osmObject({source:'electricSignals',properties:first}),{type:'node',id:'1'});
  assert.throws(()=>electricitySignalsGeoJSON({elements:[{type:'node',id:8,tags:{railway:'signal','railway:signal:electricity':'yes'}}]}),/Incomplete electricity signal node-8/);
  assert.throws(()=>electricitySignalsGeoJSON({remark:'runtime error: Query timed out',elements:[]}),/timed out/);
});

test('dots draw only in Power view; deactivated ones follow the planned/former setting; labels follow Labels',()=>{
  const layers=annotateLayers(electricitySignalLayers());
  assert.deepEqual(layers.map(l=>l.id),['electrification-signal-points','electrification-former-signal-points','electrification-signal-labels']);
  const settings={mode:'electrification',labels:true,inactive:true,background:'map'};
  for(const l of layers){assert.equal(l.source,'electricSignals');assert.equal(layerVisibility(l,settings),true,l.id);assert.equal(layerVisibility(l,{...settings,mode:'control'}),false,l.id);}
  assert.equal(layerVisibility(layers[1],{...settings,inactive:false}),false);
  assert.equal(layerVisibility(layers[2],{...settings,labels:false}),false);
  assert.equal(featureFilter(layers[0].filter).filter({zoom:14},{type:1,properties:{power_state:'present'}}),true);
  assert.equal(featureFilter(layers[0].filter).filter({zoom:14},{type:1,properties:{power_state:'deactivated'}}),false);
  assert.deepEqual(validateStyleMin({version:8,glyphs:'https://example.org/{fontstack}/{range}.pbf',sources:{electricSignals:{type:'geojson',data:{type:'FeatureCollection',features:[]}}},layers}),[]);
});

test('details show the recorded electricity function; the help explains the dots',()=>{
  assert.deepEqual(electricitySignalRows({'railway:signal:electricity':'DE-ESO:el2','railway:signal:electricity:type':'power_on','railway:signal:electricity:form':'sign','railway:signal:electricity:frequency':'16.7',power_state:'deactivated',ref:'E7','railway:signal:direction':'backward'}),[
    ['Signal','DE-ESO:el2'],['Function','power on'],['Form','sign'],['Frequency','16.7 Hz'],['Status','Deactivated'],['Reference','E7'],['Facing','backward']]);
  assert.ok(POWER_FACILITY_EXPLANATION.includes(ELECTRICITY_SIGNAL_NOTE));
  assert.match(ELECTRICITY_SIGNAL_NOTE,/not live aspects/);
});

test('the staged builder publishes a complete, validated world snapshot',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'atlas-electricity-signals-'));
  try {
    const options={cache:join(dir,'cache'),output:join(dir,'out'),sleep:async()=>{},log:()=>{}};
    const {manifest}=await buildElectricitySignals({...options,fetcher:async()=>new Response(JSON.stringify({osm3s:{},elements:[node(1,{'railway:signal:electricity':'yes'})]}))});
    const data=JSON.parse(await readFile(join(options.output,'electricity-signals.geojson'),'utf8'));
    assert.equal(data.features.length,1);validateElectricitySignalsSnapshot(data,manifest);
    assert.throws(()=>validateElectricitySignalsSnapshot(data,{...manifest,sha256:'bad'}),/Electricity-signal snapshot digest mismatch/);
    await assert.rejects(buildElectricitySignals({...options,refresh:true,fetcher:async()=>new Response(JSON.stringify({osm3s:{},elements:[]}))}),/Refusing to publish empty worldwide electrification signal data/);
  } finally {await rm(dir,{recursive:true,force:true});}
});
