import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimetableMatcher,bindTimetableSections} from '../scripts/timetable-frequency.mjs';
import {addResult,commitStage,toTable,buildTiles,LAYER} from '../scripts/service-routes.mjs';
import {frequencyDetails,frequencyWidth} from '../styles/service-frequency.mjs';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import {now,table,feed} from './fixtures/service-frequency/matching-fixture.mjs';
const apply=(t,feeds)=>{const m=createTimetableMatcher(t,{now});for(const f of feeds)m.addFeed(f);return m.finish();};
const features=tiles=>[...tiles].filter(([k])=>k.startsWith('12/')).flatMap(([,bytes])=>{const layer=new VectorTile(new Pbf(bytes)).layers[LAYER];return Array.from({length:layer.length},(_,i)=>layer.feature(i).properties);});

test('Ginza-style OSM service gets actual per-section timetable counts, hourly widths and original OSM identity',()=>{
 const t=table(),artifact=apply(t,[feed()]),bound=bindTimetableSections(t,artifact);
 assert.equal(artifact.sections.length,3);assert.equal(artifact.feeds.length,1);assert.equal(bound.staleSections,0);
 const f=features(buildTiles(t,{timetables:bound.sections}));
 assert.deepEqual([...new Set(f.map(p=>p.frequency_am))].sort((a,b)=>a-b),[4,7,10]);
 assert.ok(f.every(p=>p.id==='relation-10'&&p.frequency_h08===18&&p.frequency_width_h08===frequencyWidth(18)));
 assert.match(frequencyDetails(f[0],'am',now),/scheduled.*2026-10-12.*directions/);
 assert.ok(f.every(p=>p.frequency_timezone==='Asia/Tokyo'));
});
test('matching requires operator context, service identity, rail kind and complete path coverage',()=>{
 for(const change of [f=>f.agencies[0].agency_name='Other operator',f=>{f.routes[0].route_short_name='H';f.routes[0].route_long_name='Other line';},f=>f.routes[0].route_type='0',f=>f.segments[2].geometry=[[140,35],[140.01,35]]]){
  const f=feed();change(f);const a=apply(table(),[f]);assert.equal(a.sections.length,0);assert.equal(a.matching.feeds[0].unmatchedRoutes,1);
 }
});
test('metadata normalization preserves script, permits typography, and never matches an empty operator',()=>{
 const f=feed();f.agencies[0].agency_name=' 東京 メトロ ';f.routes[0].route_short_name='Ｇ';assert.equal(apply(table(),[f]).sections.length,3);
 f.agencies[0].agency_name='';assert.equal(apply(table(),[f]).sections.length,0);
});
test('duplicate feeds agree without doubling trains; conflicting observations are withheld',()=>{
 const a=feed(),b=feed();b.source.id='second';a.source.input_signature=b.source.input_signature='c'.repeat(64);
 const agreed=apply(table(),[a,b]);assert.equal(agreed.records[0].profiles.am.rate,10);assert.equal(agreed.records[0].properties.frequency_sources,'jp-metro;second');
 b.segments[0].profiles.am={forward_tph:30,backward_tph:30,display_tph:30,quality:'scheduled'};
 const conflict=apply(table(),[a,b]);assert.equal(conflict.sections.length,2);assert.equal(conflict.matching.conflictingSections,1);
});
test('same-feed distinct route records are ambiguous even when counts agree',()=>{
 const f=feed();f.routes.push({...f.routes[0],route_id:'other'});f.segments.push(...structuredClone(f.segments).map(s=>({...s,route_id:'other'})));
 assert.equal(apply(table(),[f]).sections.length,0);
});
test('unknown directions remain unknown, and a verified zero is retained',()=>{
 const f=feed();f.segments[0].profiles.am={forward_tph:null,backward_tph:12,display_tph:null,quality:'unknown'};
 f.segments[1].profiles.am={forward_tph:0,backward_tph:0,display_tph:0,quality:'scheduled'};
 const artifact=apply(table(),[f]),rows=bindTimetableSections(table(),artifact).sections;
 assert.equal(rows.get(1)[0].record.profiles.am,undefined);assert.equal(rows.get(2)[0].record.profiles.am.rate,0);
});
test('feed, route and branch expiry are enforced independently',()=>{
 for(const scope of ['source','route','segment']){
  const f=feed();(scope==='source'?f.source:scope==='route'?f.routes[0]:f.segments[1]).valid_until=now/1000-1;
  assert.equal(apply(table(),[f]).sections.length,scope==='segment'?2:0);
 }
 const f=feed();f.source.checked='2026-01-01';assert.equal(apply(table(),[f]).sections.length,0);
});
test('changed geometry, identity and memberships cannot reuse previously applied rates',()=>{
 const original=table(),artifact=apply(original,[feed()]);
 for(const change of [t=>t.ways.get(1).geometry.lines[0][0][1]+=.001,t=>t.routes.get('r10').evidence.view.ref='H',t=>t.ways.get(1).routes.japan=[]]){
  const t=table();change(t);const result=bindTimetableSections(t,artifact);assert.ok(result.staleSections>0);assert.equal(result.sections.has(1),false);
 }
});
test('timetables add no geometry or eligible services; OSM coordinate sequences remain identical',()=>{
 const t=table(),before=features(buildTiles(t)),artifact=apply(t,[feed()]);
 const after=features(buildTiles(t,{timetables:bindTimetableSections(t,artifact).sections}));
 assert.deepEqual([...new Set(after.map(p=>p.id))],[...new Set(before.map(p=>p.id))]);
 assert.equal(apply({routes:new Map(),ways:new Map()},[feed()]).sections.length,0);
 const paths=tiles=>[...tiles].filter(([k])=>k.startsWith('12/')).flatMap(([key,bytes])=>{const l=new VectorTile(new Pbf(bytes)).layers[LAYER];return Array.from({length:l.length},(_,i)=>[key,l.feature(i).loadGeometry().map(line=>line.map(p=>[p.x,p.y]))]);});
 const vertices=tiles=>[...new Set(paths(tiles).flatMap(([,ls])=>ls.flat()).map(p=>JSON.stringify(p)))].sort();
 assert.deepEqual(vertices(buildTiles(t,{timetables:bindTimetableSections(t,artifact).sections})),vertices(buildTiles(t)));
});


test('full GTFS calendar-to-publication-to-OSM tile pipeline counts short workings only on their section',async()=>{
 const {mkdtemp,mkdir,writeFile,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {spawnSync}=await import('node:child_process'),{gzipSync,gunzipSync}=await import('node:zlib');
 const {assemble}=await import('../scripts/assemble-global-frequency.mjs'),{writeTable}=await import('../scripts/service-routes.mjs');
 const root=await mkdtemp(join(tmpdir(),'atlas-matched-frequency-'));
 try{
  const output=join(root,'compiled.json'),run=spawnSync('python3',['tests/fixtures/service-frequency/compile-matching-fixture.py',output],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const f=JSON.parse(await readFile(output,'utf8')),t=table();
  await mkdir(join(root,'feeds'));await writeFile(join(root,'feeds','jp-metro.json.gz'),gzipSync(JSON.stringify(f)));
  await writeFile(join(root,'osm.ndjson.gz'),gzipSync(writeTable(t)));
  await writeFile(join(root,'inventory-0.json'),JSON.stringify({schema:2,shard:0,shards:1,catalogue_entries:1,catalogue_sha256:'fixture',service_date:f.source.service_date,entries:[{id:f.source.id,status:'compiled',output:'feeds/jp-metro.json.gz',sha256:f.source.sha256,country:'JP'}]}));
  const manifest=await assemble(root,{osmTable:join(root,'osm.ndjson.gz'),now});
  assert.equal(manifest.applied_profiles.sections,3);assert.equal(manifest.tiles,0,'no standalone GTFS tiles');
  const artifact=JSON.parse(gunzipSync(await readFile(join(root,'profiles.json.gz'))));
  const rendered=features(buildTiles(t,{timetables:bindTimetableSections(t,artifact).sections}));
  assert.deepEqual([...new Set(rendered.map(p=>p.frequency_am))].sort(),[4,6]);
  assert.ok(rendered.every(p=>p.frequency_overnight===0));
  assert.ok(rendered.every(p=>p.frequency_source==='Offline Metro fixture'));
  assert.match(JSON.stringify(artifact.feeds),new RegExp(f.source.sha256));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('short workings do not leak beyond their terminus or onto crossing track',()=>{
 const t=table(),f=feed();f.segments=f.segments.slice(0,1);
 t.ways.get(1).geometry.lines[0][1][0]+=.0001; // 9 m beyond the served terminus
 assert.equal(apply(t,[f]).sections.length,0);
 const crossing=table(),base=crossing.ways.get(1);
 crossing.ways.set(4,{...structuredClone(base),id:4,geometry:{...structuredClone(base.geometry),lines:[[[139.705,35.6798],[139.705,35.6802]]]}});
 crossing.routes.get('r10').evidence.eligible.push(4);
 assert.ok(!apply(crossing,[feed()]).sections.some(s=>s.way===4));
});
test('feed-context GTFS IDs can bind renamed routes but unscoped IDs cannot',()=>{
 const t=table(),f=feed();f.agencies[0].agency_name='Renamed operator';f.routes[0].route_short_name='New';f.routes[0].route_long_name='New name';
 t.routes.get('r10').evidence.view.timetable={feed:'jp-metro',routeIds:['ginza']};
 assert.equal(apply(t,[f]).sections.length,3);
 t.routes.get('r10').evidence.view.timetable.feed='another-feed';assert.equal(apply(t,[f]).sections.length,0);
});
test('an expired duplicate cannot invalidate a current measurement',()=>{
 const a=feed(),b=feed();b.source.id='old';b.source.checked='2026-01-01';b.segments[0].profiles.am.forward_tph=900;
 assert.equal(apply(table(),[a,b]).sections.length,3);
});
test('published sections reject duplicate rows and malformed rates',()=>{
 const a=apply(table(),[feed()]);
 const duplicate=structuredClone(a);duplicate.sections.push(duplicate.sections[0]);assert.throws(()=>bindTimetableSections(table(),duplicate),/Duplicate/);
 const invalid=structuredClone(a);invalid.records[0].profiles.am.rate=-1;assert.throws(()=>bindTimetableSections(table(),invalid),/Invalid timetable rate/);
});

test('a matching name cannot override a contradictory declared reference',()=>{
 const f=feed();f.routes[0].route_short_name='H';assert.equal(apply(table(),[f]).sections.length,0);
});
test('agency ID abbreviations require matching declared name initials; light rail remains compatible',()=>{
 const t=table(),f=feed();t.routes.get('r10').evidence.view.network='HSL';f.agencies[0].agency_id='HSL';f.routes[0].agency_id='HSL';f.agencies[0].agency_name='Helsingin seudun liikenne';
 assert.equal(apply(t,[f]).sections.length,3);
 f.agencies[0].agency_name='Other company';assert.equal(apply(t,[f]).sections.length,0);
 f.agencies[0].agency_name='Helsingin seudun liikenne';f.routes[0].route_type='0';t.routes.get('r10').evidence.view.kind='light_rail';assert.equal(apply(t,[f]).sections.length,3);
});
test('equal AM counts cannot hide conflicting hours or agency timezones',()=>{
 for(const change of [f=>f.segments[0].profiles.h08={forward_tph:99,backward_tph:99,display_tph:99,quality:'scheduled'},f=>f.agencies[0].agency_timezone='Europe/London']){
  const a=feed(),b=feed();a.source.input_signature=b.source.input_signature='c'.repeat(64);b.source.id='second';change(b);const artifact=apply(table(),[a,b]);assert.ok(artifact.matching.conflictingSections>0);
 }
});

test('reference punctuation preserves distinct service identities',()=>{
 const t=table(),f=feed();t.routes.get('r10').evidence.view.ref='G-1';f.routes[0].route_short_name='G1';
 assert.equal(apply(t,[f]).sections.length,0);f.routes[0].route_short_name='G-1';assert.equal(apply(t,[f]).sections.length,3);
});

test('equal rates do not establish duplicate trains across different source archives or compilations',()=>{
 for(const change of [f=>f.source.sha256='b'.repeat(64),f=>f.source.input_signature='d'.repeat(64),f=>delete f.source.input_signature,f=>f.routes[0].source_route_ids=['unrelated-original-route']]){
  const a=feed(),b=feed();a.source.input_signature=b.source.input_signature='c'.repeat(64);b.source.id='second';change(b);
  const result=apply(table(),[a,b]);assert.equal(result.sections.length,0);assert.equal(result.matching.conflictingSections,3);assert.equal(result.feeds.length,0);
 }
});

test('a short tail across a rate boundary cannot borrow the midpoint profile',()=>{
 const t=table(),way=structuredClone(t.ways.get(1));way.id=4;way.geometry.lines=[[[139.70985,35.68],[139.71005,35.68]]];t.ways.set(4,way);t.routes.get('r10').evidence.eligible.push(4);
 assert.ok(!apply(t,[feed()]).sections.some(s=>s.way===4));
});
test('a narrow interior rate interval cannot fall between spatial samples',()=>{
 const t=table(),way=structuredClone(t.ways.get(1));way.id=4;way.geometry.lines=[[[139.705,35.68],[139.707,35.68]]];t.ways.set(4,way);t.routes.get('r10').evidence.eligible.push(4);
 const f=feed(),base=f.segments.shift(),middle=structuredClone(base);middle.geometry=[[139.7059,35.68],[139.70595,35.68]];middle.profiles.am={forward_tph:12,backward_tph:12,display_tph:12,quality:'scheduled'};
 f.segments.unshift({...base,geometry:[[139.70595,35.68],[139.71,35.68]]},middle,{...base,geometry:[[139.7,35.68],[139.7059,35.68]]});
 assert.ok(!apply(t,[f]).sections.some(s=>s.way===4));
});
test('secondary grouped relations retain localized operators and feed-scoped route IDs',()=>{
 const add=(t,id,tags)=>{
  const extra={type:'relation',id,tags:{route:'subway',ref:'G',name:'銀座線',network:'東京メトロ',colour:'#f39700',...tags},members:[1,2,3].map(ref=>({type:'way',ref,role:''}))};
  const ways=[...t.ways.values()].map(w=>({type:'way',id:w.id,geometry:w.geometry.lines[0].map(([lon,lat])=>({lon,lat}))}));
  addResult(t,toTable({elements:[extra,...ways]}),'extra-'+id);commitStage(t,'extra-'+id);
 };
 const t=table(),f=feed();f.agencies[0].agency_name='English Metro';
 add(t,11,{'network:en':'English Metro'});assert.equal(apply(t,[f]).sections.length,3);
 const bound=table();f.agencies[0].agency_name='Renamed operator';
 add(bound,11,{'gtfs:feed':'jp-metro','gtfs:route_id':'ginza'});add(bound,12,{'gtfs:feed':'other-feed','gtfs:route_id':'unrelated'});
 assert.equal(apply(bound,[f]).sections.length,3);
 f.source.id='other-feed';assert.equal(apply(bound,[f]).sections.length,0,'route IDs never cross their feed namespace');
});
