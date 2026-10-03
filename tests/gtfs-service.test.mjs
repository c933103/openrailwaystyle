import test from 'node:test';
import assert from 'node:assert/strict';
import {timetableFeatures,loadTimetableServices} from '../scripts/gtfs-service.mjs';
import {frequencyDetails} from '../styles/service-frequency.mjs';
import {buildTiles,readTable} from '../scripts/service-routes.mjs';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
const feed={source:{id:'fixture',name:'Fixture Rail',url:'https://example.org/feed.zip',terms_url:'https://example.org/terms',retrieved:'2026-10-03',service_date:'2026-10-05',review_after_days:30,valid_until:1791504000,attribution:'Fixture provider',license:'CC-BY-4.0',feed_info:{}},agencies:[{agency_id:'a',agency_name:'Operator',agency_timezone:'Europe/Helsinki'}],routes:[{route_id:'r',route_short_name:'R',route_long_name:'Rail route',route_type:'1',route_color:'ff0000'}],profiles:{am:{start:'07:00:00',end:'09:00:00'},pm:{start:'16:00:00',end:'18:00:00'},offpeak:{start:'12:00:00',end:'14:00:00'}},segments:[{route_id:'r',agency_id:'a',geometry:[[24,60],[24.01,60.01]],profiles:{am:{display_tph:4,forward_tph:6,backward_tph:4,quality:'scheduled'},pm:{display_tph:3,forward_tph:3,backward_tph:5,quality:'scheduled'},offpeak:{display_tph:0,forward_tph:0,backward_tph:0,quality:'scheduled'}}}]};
const now=Date.parse('2026-10-03');
test('GTFS shapes populate service tiles with no OSM snapshot, date and directional provenance',()=>{
  const data=timetableFeatures([feed],now),tiles=buildTiles(readTable(''),{timetable:data});
  assert.ok(tiles.size>0);
  const bytes=[...tiles.entries()].find(([key])=>key.startsWith('12/'));
  const f=new VectorTile(new Pbf(bytes[1])).layers.service_routes.feature(0).properties;
  assert.equal(f.id,'gtfs:fixture:r');assert.equal(f.kind,'subway');assert.equal(f.frequency_am,4);assert.equal(f.frequency_offpeak,0);assert.equal(f.frequency_credit,'Fixture provider');assert.equal(f.frequency_until,feed.source.valid_until);
  const details=frequencyDetails(f,'am',now);
  assert.match(details,/scheduled.*2026-10-05.*directions 6 \/ 4/);assert.doesNotMatch(details,/undefined|min\)/);
  assert.equal(data.summary[0].routesWithProfiles,1);
  assert.equal(timetableFeatures([feed],feed.source.valid_until*1000+1).summary[0].routesWithProfiles,0);
});
test('local services rebundle independently and shared geometry retains every service',()=>{
  const tram=structuredClone(feed);tram.source.id='other';tram.routes[0].route_type='0';
  const {overview,local}=timetableFeatures([feed,tram],now);
  assert.equal(overview.length,1);assert.equal(overview[0].properties.n,1);
  assert.equal(local.length,2);assert.ok(local.every(f=>f.properties.n===2));
  assert.notEqual(local[0].properties.frequency_offset_am,local[1].properties.frequency_offset_am);
});
test('reviewed multi-region registry supplies actual mapped rail shapes and profiles',async()=>{
  const {feeds,registry}=await loadTimetableServices();
  assert.ok(feeds.length>=4);assert.ok(new Set(feeds.map(f=>f.source.region)).size>=3);
  for(const f of feeds){
    assert.ok(f.source.sha256.match(/^[a-f0-9]{64}$/));assert.ok(f.source.valid_until>now/1000);
    assert.ok(f.segments.length>0);assert.ok(f.segments.every(s=>s.geometry?.length>=2));
    assert.ok(f.source.terms_url);assert.ok(f.source.attribution);
    assert.equal(f.source.geometry_audit.routes_with_incomplete_active_geometry.length,0,f.source.id);
  }
  assert.ok(registry.gaps.some(g=>g.region==='Africa'));
});
