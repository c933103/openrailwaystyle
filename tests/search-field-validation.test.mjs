import test from 'node:test';
import assert from 'node:assert/strict';
import maplibre from 'maplibre-gl';
import {searchResponse} from '../styles/map-model.mjs';
import {searchHarness,station,place,response} from './helpers/search-ui-harness.mjs';

const facility=url=>url.pathname.endsWith('/facility');
for(const key of ['name','name:en','name:zh-Hant','localized_name','atlas_name','int_name','label','ref','railway_ref','railway:ref','station','feature','railway','operator'])test(`malformed facility ${key} cannot render or conceal an incomplete response`,async()=>{
  const bad={...station,osm_id:9005,[key]:{bad:'value'}};
  const h=searchHarness({fetcher:async url=>response(facility(url)?[bad,station]:[place])});
  try {await h.submit();assert.match(h.status(),/^1 railway result, 1 place\. Search incomplete: station search returned invalid results/);assert.match(h.results().textContent,/Synthetic station/);assert.match(h.results().textContent,/Synthetic town/);assert.doesNotMatch(h.results().textContent,/\[object Object\]|Unnamed facility/);} finally {h.close();}
});
for(const dictionary of ['namedetails','extratags'])for(const key of ['name','name:en','ref','operator','train'])test(`malformed nested ${dictionary}.${key} cannot override usable place data`,async()=>{
  const bad={...place,osm_id:9005,name:'Safe outer town',[dictionary]:{[key]:{bad:'value'}}};
  const h=searchHarness({language:'en',fetcher:async url=>response(facility(url)?[station]:[bad,place])});
  try {await h.submit();assert.match(h.status(),/^1 railway result, 1 place\. Search incomplete: place search returned invalid results/);assert.match(h.results().textContent,/Synthetic town/);assert.doesNotMatch(h.results().textContent,/\[object Object\]|Safe outer town/);} finally {h.close();}
});
test('facility operator lists accept strings, reject malformed elements and keep unnamed valid facilities',()=>{
  const valid={...station,name:null,railway_ref:'ABC',operator:['Operator A','Operator B']};
  assert.deepEqual(searchResponse([valid],'facility'),{items:[valid],invalid:0});
  for(const operator of [[{}],[null],[3],[[]]])assert.deepEqual(searchResponse([{...station,operator}],'facility'),{items:[],invalid:1});
});
test('legitimate localized names, null optional fields and namedetails references survive',async()=>{
  const named={...place,namedetails:{name:'原名','name:en':'Named town',ref:'123',old_name:null},extratags:{train:'yes',ref:null}};
  const h=searchHarness({language:'en',fetcher:async url=>response(facility(url)?[{...station,'name:en':'Named station',operator:['Operator A','Operator B'],railway_ref:null,station:null}]:[named])});
  try {await h.submit();assert.equal(h.status(),'1 railway result, 1 place');assert.match(h.results().textContent,/Named station/);assert.match(h.results().textContent,/Operator A, Operator B/);assert.match(h.results().textContent,/Named town/);} finally {h.close();}
});
test('malformed nested names are not cached and recover on explicit resubmission',async()=>{
  let bad=true;
  const h=searchHarness({fetcher:async url=>response(facility(url)?[station]:[{...place,namedetails:{name:bad?{}:'Recovered town'}}])});
  try {await h.submit();assert.match(h.status(),/place search returned invalid results/);bad=false;await h.advance(1000);await h.submit();assert.equal(h.status(),'1 railway result, 1 place');assert.match(h.results().textContent,/Recovered town/);await h.submit();assert.equal(h.calls.filter(c=>!facility(c.url)).length,2);} finally {h.close();}
});
for(const [name,bounds,expected] of [
  ['ordinary',[51,52,-1,0],[[-1,51],[0,52]]],
  ['documented worldwide/dateline extent',[-20,-10,-180,180],[[-180,-20],[180,-10]]],
  ['explicit antimeridian interval',[-20,-10,170,-170],[[170,-20],[190,-10]]],
  ['zero-width longitude',[0,1,0,0],[[0,0],[0,1]]],
])test(`place selection preserves ${name}`,async()=>{
  const h=searchHarness({fetcher:async url=>response(facility(url)?[]:[{...place,boundingbox:bounds.map(String)}])});
  try {await h.submit();h.results().querySelector('button').click();assert.equal(h.navigation[0].type,'fitBounds');const input=Array.from(h.navigation[0].bounds,point=>[...point]);assert.deepEqual(input,[[bounds[2],bounds[0]],[bounds[3],bounds[1]]]);assert.deepEqual(maplibre.LngLatBounds.convert(input).adjustAntiMeridian().toArray(),expected);} finally {h.close();}
});
