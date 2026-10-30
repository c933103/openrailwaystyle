import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {powerFacilityName,powerFacilityEnergyRows,POWER_FACILITY_LEGEND,POWER_FACILITY_EXPLANATION} from '../styles/power-facilities.mjs';
import {powerFacilitiesGeoJSON} from '../scripts/power-facility-data.mjs';

const rows=properties=>Object.fromEntries(powerFacilityEnergyRows(properties));
test('facility labels preserve the same servicing meaning for snapshot and provider points',()=>{
 for(const [kind,label] of [['fuel','Train refuelling point'],['coaling_facility','Steam engine coaling'],['fuel_tank','Railway fuel tank']]){
  assert.equal(powerFacilityName({power_kind:kind}),label);
  assert.equal(powerFacilityName({feature:kind}),label);
  assert.equal(powerFacilityName({feature:`general/${kind}`,type:'facility'}),label);
 }
 assert.equal(powerFacilityName({power_kind:'unknown'}),'Railway energy supply');
 assert.equal(powerFacilityName({feature:'unrecognized'}),'Railway energy supply');
});
test('generation sources never substitute for train fuel or suppress another source',()=>{
 for(const source of ['hydro','solar','wind','coal','gas','diesel']){
  assert.deepEqual(rows({'plant:source':source,'generator:source':'other'}),{'Plant energy source':source,'Generator energy source':'other'});
  assert.deepEqual(rows({fuel:'hydrogen','plant:source':source,content:'diesel'}),{'Recorded supplies':'hydrogen','Fuel tag':'hydrogen','Plant energy source':source,'Stored contents':'diesel'});
 }
 assert.deepEqual(rows({content:'diesel'}),{'Stored contents':'diesel'});
 assert.deepEqual(rows({}),{});
});
test('supply projection preserves missing, multiple, negative and conflicting evidence',()=>{
 assert.deepEqual(rows({power_kind:'fuel'}),{'Recorded supplies':'Not recorded'});
 assert.deepEqual(rows({feature:'general/fuel'}),{'Recorded supplies':'Not recorded'});
 assert.deepEqual(rows({'disused:railway':'fuel'}),{'Recorded supplies':'Not recorded'});
 assert.deepEqual(rows({fuel:'diesel; hydrogen','fuel:diesel':'yes','fuel:adblue':'yes'}),{'Recorded supplies':'diesel, hydrogen, adblue','Fuel tag':'diesel; hydrogen','Fuel tags':'fuel:adblue=yes; fuel:diesel=yes'});
 for(const flag of ['yes','no','unknown'])assert.deepEqual(rows({power_kind:'fuel',fuel:flag,'fuel:diesel':'yes'}),{'Recorded supplies':'diesel','Fuel tag':flag,'Fuel tags':'fuel:diesel=yes'});
 assert.deepEqual(rows({power_kind:'fuel',fuel:'diesel','fuel:diesel':'no','fuel:hydrogen':'unknown'}),{'Recorded supplies':'diesel','Fuel tag':'diesel','Fuel tags':'fuel:diesel=no; fuel:hydrogen=unknown'});
 assert.deepEqual(rows({power_kind:'fuel',fuel:'  ','fuel:diesel':'no'}),{'Recorded supplies':'Not recorded','Fuel tags':'fuel:diesel=no'});
 assert.deepEqual(rows({'fuel:hydrogen':' YES '}),{'Recorded supplies':'hydrogen','Fuel tags':'fuel:hydrogen= YES '});
 assert.deepEqual(rows({'fuel:diesel:payment':'yes'}),{'Fuel tags':'fuel:diesel:payment=yes'});
});
test('point presentation keeps exact source tags and mapped snapshot properties',()=>{
 const tags={railway:'fuel',fuel:'no','fuel:diesel':'yes','plant:source':'solar',content:'water'};
 const data=powerFacilitiesGeoJSON({elements:[{type:'node',id:7,lon:0,lat:0,tags}]});
 const p=data.features[0].properties,before=structuredClone(p);
 assert.equal(p.power_mark,'F');assert.equal(p.power_group,'fuel');assert.equal(p.power_state,'present');
 assert.equal(rows(p)['Recorded supplies'],'diesel');assert.equal(rows(p)['Plant energy source'],'solar');
 for(const [key,value] of Object.entries(tags))assert.equal(p[key],value);
 assert.deepEqual(p,before,'display projection never rewrites source evidence');
});
test('static and runtime help stay aligned with the point legend categories and coverage limits',()=>{
 const html=readFileSync(new URL('../styles/index.html',import.meta.url),'utf8');
 assert.equal(html.match(/<p id="help-power">([^<]*)<\/p>/)?.[1],POWER_FACILITY_EXPLANATION);
 for(const {label} of POWER_FACILITY_LEGEND)assert.ok(POWER_FACILITY_EXPLANATION.includes(label),label);
 assert.match(POWER_FACILITY_EXPLANATION,/storage alone does not establish/);
 assert.match(POWER_FACILITY_EXPLANATION,/whole electricity grid.*not yet/);
 assert.match(POWER_FACILITY_EXPLANATION,/Missing markers do not establish an absence/);
});
test('railway-use water storage does not claim steam servicing without an explicit facility tag',()=>{
 for(const [kind,storage,label] of [['water_tank','storage_tank','Railway water tank'],['water_tower','water_tower','Railway water tower']]){
  for(const prefix of ['', 'disused:', 'construction:']){
   const storageTags={[prefix+'man_made']:storage,content:'water',usage:'railway'};
   const features=powerFacilitiesGeoJSON({elements:[{type:'way',id:71,center:{lon:0,lat:0},tags:storageTags}]}).features;
   assert.equal(features.length,1);assert.equal(features[0].properties.power_kind,kind);
   assert.equal(features[0].properties.power_mark,'W');
   assert.equal(powerFacilityName(features[0].properties),label);
   assert.equal(powerFacilityName({...features[0].properties,[prefix+'railway']:kind}),`Steam locomotive water ${kind==='water_tank'?'tank':'tower'}`);
  }
  assert.equal(powerFacilityName({power_kind:kind}),`Steam locomotive water ${kind==='water_tank'?'tank':'tower'}`,'legacy category-only snapshots keep their specific source classification');
  assert.equal(powerFacilityName({feature:`general/${kind}`}),`Steam locomotive water ${kind==='water_tank'?'tank':'tower'}`,'provider facility classifications remain specific');
 }
});
test('non-fuel additives and unknown supplies are recorded without calling them fuel types',()=>{
 for(const supply of ['adblue','diesel_exhaust_fluid','deicing','additive','unfamiliar_supply']){
  const result=rows({power_kind:'fuel',[`fuel:${supply}`]:'yes'});
  assert.equal(result['Recorded supplies'],supply);
  assert.equal(result['Fuel type'],undefined);
  assert.equal(result['Fuel tags'],`fuel:${supply}=yes`);
 }
 assert.deepEqual(rows({fuel:'diesel;adblue','fuel:hydrogen':'yes'}),{'Recorded supplies':'diesel, adblue, hydrogen','Fuel tag':'diesel;adblue','Fuel tags':'fuel:hydrogen=yes'});
});
