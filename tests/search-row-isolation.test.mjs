import test from 'node:test';
import assert from 'node:assert/strict';
import {searchResponse,searchResults} from '../styles/map-model.mjs';
import {searchHarness,station,place,response,flush} from './helpers/search-ui-harness.mjs';

const facility = url => url.pathname.endsWith('/facility');
const badRows = [null, false, 4, 'unexpected row', [], {}, {name:'No location'}];
for (const [source, good] of [['station', station], ['place', place]]) {
  for (const bad of badRows) test(`search preserves valid ${source} rows beside ${JSON.stringify(bad)}`, () => {
    const result = searchResults(source === 'station' ? [bad,good,bad] : [station], source === 'place' ? [bad,good,bad] : [place]);
    assert.deepEqual(result.rail.map(row => row.osm_id), [station.osm_id]);
    assert.deepEqual(result.places.map(row => row.osm_id), [place.osm_id]);
  });
}
for (const field of ['lat','lon']) for (const value of [null,'','  ',false,true,[],[1],{},'Infinity','NaN','0x10']) test(`search rejects invalid geocoder ${field} ${JSON.stringify(value)}`, () => {
  const result = searchResults([], [{...place,[field]:value}]);
  assert.deepEqual(result, {rail:[],places:[]});
});
for (const [lat,lon] of [[90.1,0],[-90.1,0],[0,180.1],[0,-180.1]]) test(`search rejects out-of-range location ${lat},${lon}`, () => {
  assert.deepEqual(searchResponse([{...station,latitude:lat,longitude:lon}], 'facility'), {items:[],invalid:1});
  assert.deepEqual(searchResults([],[{...place,lat:String(lat),lon:String(lon)}]), {rail:[],places:[]});
});
test('search preserves actual zero, coordinate boundaries and decimal strings', () => {
  for (const [lat,lon] of [[0,0],[90,180],[-90,-180],[' 51.6 ',' -0.2 '],['.5','1e2']]) {
    const result = searchResults([], [{...place,lat,lon}]);
    assert.deepEqual(result.places.map(row => [row.latitude,row.longitude]), [[Number(lat),Number(lon)]]);
  }
});
for (const source of ['station','place']) test(`actual search UI isolates invalid ${source} rows and reports incomplete results`, async () => {
  const h = searchHarness({fetcher:async url => response(facility(url) ? (source==='station' ? [null,station] : [station]) : (source==='place' ? [place,null] : [place]))});
  try {
    await h.submit();
    assert.match(h.status(), /^1 railway result, 1 place\. Search incomplete:/);
    assert.match(h.status(), new RegExp(`${source} search returned invalid results`));
    assert.match(h.results().textContent, /Synthetic station/);
    assert.match(h.results().textContent, /Synthetic town/);
    assert.equal(h.results().hidden,false);
    assert.equal(h.calls.length,2);
  } finally { h.close(); }
});
test('invalid-only successful responses cannot establish a complete no-match search',async()=>{
  const h=searchHarness({fetcher:async()=>response([null])});
  try {await h.submit();assert.match(h.status(),/^No matches from the available sources\. Search incomplete:/);assert.match(h.status(),/station search returned invalid results/);assert.match(h.status(),/place search returned invalid results/);assert.equal(h.results().hidden,true);} finally {h.close();}
});
test('partial-invalid place responses are not cached and can recover on explicit resubmission',async()=>{
  let malformed=true;
  const h=searchHarness({fetcher:async url=>response(facility(url)?[station]:malformed?[place,null]:[place])});
  try {
    await h.submit();assert.match(h.status(),/place search returned invalid results/);
    malformed=false;await h.advance(1000);await h.submit();assert.equal(h.status(),'1 railway result, 1 place');
    await h.submit();assert.equal(h.calls.filter(call=>!facility(call.url)).length,2,'healthy retry is cached, invalid response is not');
  } finally {h.close();}
});
test('newer complete search cannot be replaced by late malformed results',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const h=searchHarness({fetcher:async url=>url.searchParams.get('q')==='Older'?pending:response(facility(url)?[station]:[place])});
  try {const old=h.submit('Older');await flush();const latest=h.submit('Latest');await h.advance(1000);await latest;release(response([null]));await old;assert.equal(h.status(),'1 railway result, 1 place');assert.match(h.results().textContent,/Synthetic town/);} finally {h.close();}
});

test('drawn local stations retain their world-copy positions during reconciliation',()=>{
  const copied={...station,longitude:360.1};
  assert.deepEqual(searchResults([copied],[]).rail,[copied]);
  assert.deepEqual(searchResponse([copied],'facility'),{items:[],invalid:1},'external coordinates remain range-checked');
});
for(const key of ['name','display_name','category','type','addresstype','namedetails','extratags'])test(`invalid place field ${key} cannot discard a healthy sibling`,()=>{
  const value=['namedetails','extratags'].includes(key)?[]:17;
  assert.deepEqual(searchResponse([{...place,[key]:value},place],'place').invalid,1);
  assert.deepEqual(searchResults([],[{...place,[key]:value},place]).places.map(row=>row.osm_id),[place.osm_id]);
});
for(const category of ['__proto__','constructor','toString','unrecognized'])test(`unknown geocoder category ${category} stays an ordinary place`,()=>{
  assert.deepEqual(searchResults([],[{...place,category}]).places.map(row=>row.osm_id),[place.osm_id]);
});
test('invalid optional place bounds fall back to the valid point without rejecting the row',()=>{
  for(const boundingbox of [null,{},[],['',1,0,1],[null,1,0,1],[-91,1,0,1],[0,1,0,181],[1,0,0,1],[0,1,0,1,2]]) {
    const result=searchResponse([{...place,boundingbox}],'place');
    assert.equal(result.invalid,0);assert.equal(Object.hasOwn(result.items[0],'boundingbox'),false);
    assert.equal(searchResults([],result.items).places[0].boundingbox,undefined);
  }
  assert.deepEqual(searchResponse([{...place,boundingbox:['0','1','2','3']}],'place').items[0].boundingbox,[0,1,2,3]);
});
test('invalid rows and unavailable sources retain their separate truthful status',async()=>{
  for(const failed of ['station','place']){
    const h=searchHarness({fetcher:async url=>facility(url)===(failed==='station')?response([],503):response([null,facility(url)?station:place])});
    try {await h.submit();assert.match(h.status(),new RegExp(`${failed} search unavailable`));assert.match(h.status(),new RegExp(`${failed==='station'?'place':'station'} search returned invalid results`));assert.equal(h.results().hidden,false);} finally {h.close();}
  }
});
test('drawn fallback survives invalid remote rows and invalid-only geocoder coordinates',async()=>{
  const local={type:'Feature',geometry:{type:'Point',coordinates:[-.1,51.5]},properties:{id:'node-9003',name:'Synthetic local station',feature:'station'}};
  const h=searchHarness({local:[local],fetcher:async url=>response(facility(url)?[null]:[{...place,lat:null,lon:''}])});
  try {await h.submit();assert.match(h.results().textContent,/Synthetic local station/);assert.doesNotMatch(h.results().textContent,/Synthetic town/);assert.match(h.status(),/^1 railway result, 0 places\. Search incomplete:/);} finally {h.close();}
});

test('healthy selections still navigate and dismiss results after invalid siblings',async()=>{
  const h=searchHarness({fetcher:async url=>response(facility(url)?[null,station]:[null,{...place,boundingbox:['','1','0','1']}])});
  try {
    await h.submit();h.results().querySelector('button').click();
    assert.equal(h.navigation[0].type,'flyTo');assert.deepEqual([...h.navigation[0].options.center],[station.longitude,station.latitude]);
    assert.equal(h.details.length,1);assert.equal(h.results().hidden,true);
    await h.advance(1000);await h.submit();h.results().querySelectorAll('button')[1].click();
    assert.equal(h.navigation[1].type,'flyTo');assert.deepEqual([...h.navigation[1].options.center],[-.2,51.6]);
    assert.equal(h.results().hidden,true);
  } finally {h.close();}
});
test('healthy place bounds still fit the selected area',async()=>{
  const h=searchHarness({fetcher:async url=>response(facility(url)?[]:[{...place,boundingbox:['51','52','-1','0']}])});
  try {await h.submit();h.results().querySelector('button').click();assert.equal(h.navigation[0].type,'fitBounds');assert.deepEqual(Array.from(h.navigation[0].bounds,point=>[...point]),[[-1,51],[0,52]]);} finally {h.close();}
});
