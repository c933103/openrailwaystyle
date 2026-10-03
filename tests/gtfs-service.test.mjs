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
test('national feeds compact consecutive equal-profile edges while keeping disconnected paths',()=>{
  const expanded=structuredClone(feed),base=expanded.segments[0];
  expanded.segments=[base,{...base,geometry:[[24.01,60.01],[24.02,60.02]]},{...base,geometry:[[25,60],[25.01,60.01]]}];
  const data=timetableFeatures([expanded],now);
  assert.equal(data.local.length,1);assert.equal(data.overview.length,1);
  assert.equal(data.local[0].geometry.type,'MultiLineString');
  assert.deepEqual(data.local[0].geometry.coordinates,[[[24,60],[24.01,60.01],[24.02,60.02]],[[25,60],[25.01,60.01]]]);
  const tiles=buildTiles(readTable(''),{timetable:data});
  assert.ok(tiles.size>0);assert.equal(data.summary[0].availableSegments,3);
});
test('dated multi-region fixtures supply actual mapped rail shapes and profiles',async()=>{
  const {feeds,registry}=await loadTimetableServices(new URL('./fixtures/service-frequency/registry.json',import.meta.url));
  assert.ok(feeds.length>=4);assert.ok(new Set(feeds.map(f=>f.source.region)).size>=3);
  for(const f of feeds){
    assert.ok(f.source.sha256.match(/^[a-f0-9]{64}$/));assert.ok(f.source.valid_until>now/1000);
    assert.ok(f.segments.length>0);assert.ok(f.segments.every(s=>s.geometry?.length>=2));
    assert.ok(f.source.terms_url);assert.ok(f.source.attribution);
    assert.equal(f.source.geometry_audit.routes_with_incomplete_active_geometry.length,0,f.source.id);
  }
  assert.ok(registry.gaps.some(g=>g.region==='Africa'));
});

test('fixture assembly succeeds when the OSM service-data branch supplies no table',async()=>{
  const {mkdtemp,readFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {spawnSync}=await import('node:child_process');
  const directory=await mkdtemp(join(tmpdir(),'atlas-timetable-only-'));
  try {
    const run=spawnSync(process.execPath,['scripts/rebuild-service-frequency.mjs',directory,join(directory,'credits.html'),'--fixtures'],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const index=JSON.parse(await readFile(join(directory,'index.json'),'utf8'));
    assert.ok(index.tiles.length>0,'official paths remain usable without the OSM snapshot');
    const manifest=JSON.parse(await readFile(join(directory,'frequency-manifest.json'),'utf8'));
    assert.equal(manifest.feeds.length,4);assert.ok(manifest.feeds.every(f=>f.mappedRoutes>0));
    assert.match(await readFile(join(directory,'credits.html'),'utf8'),/MassDOT|Auckland Transport/);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('production frequency registry has no city feed fallback',async()=>{
  const {feeds,registry}=await loadTimetableServices();
  assert.equal(feeds.length,0);assert.equal(registry.schema,2);
  assert.match(registry.catalogue,/transitous/);
  assert.match(registry.snapshot,/service-frequency\/manifest/);
});

test('successful revalidation keeps unchanged annual feeds fresh without changing retrieval date',()=>{
  const annual=structuredClone(feed);annual.source.retrieved='2026-01-01';annual.source.checked='2026-10-03';
  assert.equal(timetableFeatures([annual],now).summary[0].routesWithProfiles,1);
  delete annual.source.checked;
  assert.equal(timetableFeatures([annual],now).summary[0].routesWithProfiles,0);
});

test('global route types preserve cable trams, extended monorails and funiculars',()=>{
  for(const [type,kind] of [[2,'rail'],[5,'tram'],[7,'funicular'],[12,'monorail'],[405,'monorail'],[1400,'funicular']]){
    const variant=structuredClone(feed);variant.routes[0].route_type=String(type);
    const features=timetableFeatures([variant],now);
    assert.equal((features.local[0]||features.overview[0]).properties.kind,kind);
  }
});
