import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTimetableMatcher,bindTimetableSections,summarizeBoundTimetableSections} from '../scripts/timetable-frequency.mjs';
import {addResult,commitStage,toTable,buildTiles as osmTiles,LAYER} from '../scripts/service-routes.mjs';
import {frequencyDetails,frequencyWidth,frequencyAvailability} from '../styles/service-frequency.mjs';
import {operatorBindingIndex} from '../scripts/timetable-operator-bindings.mjs';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import {now,table,feed,operatorBindingsFor} from './fixtures/service-frequency/matching-fixture.mjs';
const apply=(t,feeds)=>{const m=createTimetableMatcher(t,{now});for(const f of feeds)m.addFeed(f);return m.finish();};
const buildTiles=(t,options={})=>osmTiles(t,{...options,now});
const features=tiles=>[...tiles].filter(([k])=>k.startsWith('12/')).flatMap(([,bytes])=>{const layer=new VectorTile(new Pbf(bytes)).layers[LAYER];return Array.from({length:layer.length},(_,i)=>layer.feature(i).properties);});
const operatorFixture=()=>{
 const f=feed();f.agencies[0].agency_name='Metro brand';f.agencies[0].agency_url='https://operator.example.test/';
 return {f,operatorBindings:operatorBindingsFor(f)};
};

test('reviewed operator binding applies actual counts, retains its proof and expires with the assertion',()=>{
 const {f,operatorBindings}=operatorFixture(),before=structuredClone(f),m=createTimetableMatcher(table(),{now,operatorBindings});
 m.addFeed(f);const a=m.finish();assert.equal(a.sections.length,3);assert.equal(a.records[0].profiles.am.rate,10);
 assert.equal(a.records[0].properties.frequency_operator_binding,'fixture-operator');
 assert.deepEqual(JSON.parse(a.records[0].properties.frequency_operator_evidence),['https://operator.example.test/about/']);
 assert.equal(a.records[0].properties.frequency_until,Date.parse('2026-10-13T00:00:00Z')/1000-.001);
 assert.deepEqual(f,before);assert.equal(apply(table(),[f]).sections.length,0,'a brand alone is not an operator assertion');
});

test('operator assertions are feed/revision/agency/declaration scoped, including the original URL fingerprint',()=>{
 const changes=[f=>f.source.id='other-feed',f=>f.source.sha256='b'.repeat(64),f=>{f.agencies[0].agency_id='other';f.routes[0].agency_id='other';},
  f=>f.agencies[0].agency_name='Other brand',f=>f.agencies[0].agency_url='https://other.example.test/',f=>f.agencies[0].agency_url_sha256='0'.repeat(64)];
 for(const change of changes){const {f,operatorBindings}=operatorFixture();change(f);const m=createTimetableMatcher(table(),{now,operatorBindings});m.addFeed(f);assert.equal(m.finish().sections.length,0);}
});
test('operator assertions never bypass mode, reference, path, ambiguity, or duplicate-service checks',()=>{
 for(const change of [f=>f.routes[0].route_type='0',f=>f.routes[0].route_short_name='H',f=>f.segments[2].geometry=[[140,35],[140.01,35]]]){
  const {f,operatorBindings}=operatorFixture();change(f);const m=createTimetableMatcher(table(),{now,operatorBindings});m.addFeed(f);assert.equal(m.finish().sections.length,0);
 }
 const {f,operatorBindings}=operatorFixture(),t=table(),other=structuredClone(t.routes.get('r10'));
 other.key='r20';other.evidence.view.ref='G';other.evidence.view.relation=20;other.evidence.view.key='r20';other.evidence.view.group='another-service';
 t.routes.set('r20',other);for(const w of t.ways.values())w.routes.japan.push('r20');
 const ambiguous=createTimetableMatcher(t,{now,operatorBindings});ambiguous.addFeed(f);const unresolved=ambiguous.finish();assert.equal(unresolved.sections.length,0);assert.equal(unresolved.matching.feeds[0].ambiguousRoutes,1);
 const duplicate=structuredClone(f);duplicate.source.id='other-feed';const duplicateBinding=structuredClone(operatorBindings.bindings[0]);duplicateBinding.id='second-binding';duplicateBinding.feed='other-feed';
 duplicate.source.sha256='b'.repeat(64);duplicateBinding.source_sha256=duplicate.source.sha256;
 const conflict=createTimetableMatcher(table(),{now,operatorBindings:{schema:1,bindings:[operatorBindings.bindings[0],duplicateBinding]}});
 conflict.addFeed(f);conflict.addFeed(duplicate);const rejected=conflict.finish();assert.equal(rejected.sections.length,0);assert.ok(rejected.matching.conflictingSections>0);
});
test('verified duplicate archives count once and retain both operator assertion receipts',()=>{
 const {f,operatorBindings}=operatorFixture(),duplicate=structuredClone(f),second=structuredClone(operatorBindings.bindings[0]);
 duplicate.source.id='other-feed';second.feed=duplicate.source.id;second.id='second-binding';second.evidence=['https://operator.example.test/about;brand/'];
 f.source.input_signature=duplicate.source.input_signature='c'.repeat(64);
 const m=createTimetableMatcher(table(),{now,operatorBindings:{schema:1,bindings:[operatorBindings.bindings[0],second]}});
 m.addFeed(f);m.addFeed(duplicate);const a=m.finish();assert.equal(a.sections.length,3);assert.equal(a.records[0].profiles.am.rate,10);
 assert.equal(a.records[0].properties.frequency_operator_binding,'fixture-operator;second-binding');
 assert.deepEqual(JSON.parse(a.records[0].properties.frequency_operator_evidence),['https://operator.example.test/about/','https://operator.example.test/about;brand/']);
});
test('operator review validity is enforced at both boundaries without restricting independently declared identities',()=>{
 for(const at of ['2026-10-08T23:59:59.999Z','2026-10-13T00:00:00Z']){
  const {f,operatorBindings}=operatorFixture(),m=createTimetableMatcher(table(),{now:Date.parse(at),operatorBindings});m.addFeed(f);assert.equal(m.finish().sections.length,0);
 }
 const {f,operatorBindings}=operatorFixture();f.agencies[0].agency_name='東京メトロ';operatorBindings.bindings[0].agency_name='東京メトロ';
 const direct=createTimetableMatcher(table(),{now,operatorBindings});direct.addFeed(f);const a=direct.finish();
 assert.equal(a.sections.length,3);assert.ok(a.records[0].properties.frequency_until>Date.parse('2026-10-13T00:00:00Z')/1000);assert.equal(a.records[0].properties.frequency_operator_binding,undefined);
});
test('operator context works across scripts and does not infer translations or substrings',()=>{
 for(const operator of ['Transit Authority','Городской транспорт','هيئة النقل']){
  const {f,operatorBindings}=operatorFixture(),t=table();t.routes.get('r10').evidence.view.network=operator;operatorBindings.bindings[0].osm_operators=[operator];
  const m=createTimetableMatcher(t,{now,operatorBindings});m.addFeed(f);assert.equal(m.finish().sections.length,3);
  operatorBindings.bindings[0].osm_operators=['Transit'];const negative=createTimetableMatcher(t,{now,operatorBindings});negative.addFeed(f);assert.equal(negative.finish().sections.length,0);
 }
});
test('malformed, duplicate, oversized or unbounded operator assertions fail before matching',()=>{
 const changes=[d=>d.schema=2,d=>d.extra=true,d=>d.bindings[0].extra=true,d=>d.bindings[0].source_sha256='bad',d=>d.bindings[0].expires='2026-02-30',
  d=>d.bindings[0].checked='2026-13-01',d=>d.bindings[0].expires='2026-10-08',d=>d.bindings[0].expires='2030-10-01',
  d=>d.bindings[0].agency_url='https://user:password@example.test/',d=>d.bindings[0].evidence=['https://example.test/?token=private'],
  d=>d.bindings[0].osm_operators=[''],d=>d.bindings[0].osm_operators=new Array(1),d=>d.bindings[0].agency_name='a'.repeat(513),
  d=>d.bindings.push(structuredClone(d.bindings[0])),d=>{const b=structuredClone(d.bindings[0]);b.id='other';d.bindings.push(b);},d=>d.bindings=new Array(1001)];
 for(const change of changes){const {operatorBindings}=operatorFixture();change(operatorBindings);assert.throws(()=>operatorBindingIndex(operatorBindings),/Invalid reviewed timetable operator bindings/);}
});

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
test('bilingual agency declarations match either complete language name without changing the source',()=>{
 for(const [name,operator] of [['東京メトロ Tokyo Metro','東京メトロ'],['東京メトロ Tokyo Metro','Tokyo Metro'],['Метро Metro Transit','Метро'],['مترو المدينة City Metro','City Metro']]){
  const t=table(),f=feed();t.routes.get('r10').evidence.view.operator=operator;t.routes.get('r10').evidence.view.network='';
  f.agencies[0].agency_name=name;const before=structuredClone(f);const a=apply(t,[f]);
  assert.equal(a.sections.length,3,name+' / '+operator);assert.equal(a.records[0].profiles.am.rate,10);assert.deepEqual(f,before);
 }
});
test('agency language normalization preserves operator, route, mode and spatial boundaries',()=>{
 for(const [name,operator] of [['Other Tokyo Metro','Tokyo Metro'],['東京メトロ Tokyo Metro','Metro'],['東京メトロ Tokyo Metro','Other Metro'],['東京メトロTokyoMetro','東京メトロ']]){
  const t=table(),f=feed();t.routes.get('r10').evidence.view.operator=operator;t.routes.get('r10').evidence.view.network='';f.agencies[0].agency_name=name;
  assert.equal(apply(t,[f]).sections.length,0,name+' / '+operator);
 }
 for(const change of [f=>f.routes[0].route_short_name='H',f=>f.routes[0].route_type='0',f=>f.segments[2].geometry=[[140,35],[140.01,35]]]){
  const f=feed();f.agencies[0].agency_name='東京メトロ Tokyo Metro';change(f);assert.equal(apply(table(),[f]).sections.length,0);
 }
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

test('curved timetable sections keep the whole OSM line orientation and their original edge rates',()=>{
 const curve=[[139.7,35.68],[139.704,35.684],[139.702,35.688],[139.706,35.691]];
 const read=tiles=>[...tiles].filter(([key])=>key.startsWith('12/')).flatMap(([key,bytes])=>{
  const layer=new VectorTile(new Pbf(bytes)).layers[LAYER];return Array.from({length:layer.length},(_,i)=>{const f=layer.feature(i);return {key,rate:f.properties.frequency_am,paths:f.loadGeometry().map(line=>line.map(p=>[p.x,p.y]))};});
 });
 for(const reverse of [false,true]){
  const t=table(),line=reverse?[...curve].reverse():curve;t.ways.get(1).geometry.lines=[line];t.ways.delete(2);t.ways.delete(3);
  const f=feed();f.segments.forEach((s,i)=>s.geometry=line.slice(i,i+2));const variable=structuredClone(f);
  f.segments.forEach(s=>s.profiles=structuredClone(f.segments[0].profiles));
  const before=read(buildTiles(t)),matched=bindTimetableSections(t,apply(t,[f])).sections;
  assert.equal(matched.get(1).length,3);assert.deepEqual(read(buildTiles(t,{timetables:matched})).map(({key,paths})=>({key,paths})),before.map(({key,paths})=>({key,paths})));
  const varying=read(buildTiles(t,{timetables:bindTimetableSections(t,apply(t,[variable])).sections}));
  for(const whole of before){
   assert.equal(whole.paths.length,1);const vertices=whole.paths[0];assert.equal(vertices.length,4);
   for(let edge=0;edge<3;edge++){const rate=[10,7,4][reverse?2-edge:edge],section=varying.find(v=>v.key===whole.key&&v.rate===rate);assert.deepEqual(section.paths,[[vertices[edge],vertices[edge+1]]]);}
  }
 }
});


for(const variant of ['declared','operator-binding'])test(`full GTFS ${variant} calendar-to-publication-to-OSM tile pipeline counts short workings only on their section`,async()=>{
 const {mkdtemp,mkdir,writeFile,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {spawnSync}=await import('node:child_process'),{gzipSync,gunzipSync}=await import('node:zlib');
 const {assemble}=await import('../scripts/assemble-global-frequency.mjs'),{writeTable}=await import('../scripts/service-routes.mjs');
 const root=await mkdtemp(join(tmpdir(),'atlas-matched-frequency-'));
 try{
  const output=join(root,'compiled.json'),run=spawnSync('python3',['tests/fixtures/service-frequency/compile-matching-fixture.py',output,...(variant==='operator-binding'?['--operator-binding']:[])],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const f=JSON.parse(await readFile(output,'utf8')),t=table();
  await mkdir(join(root,'feeds'));await writeFile(join(root,'feeds','jp-metro.json.gz'),gzipSync(JSON.stringify(f)));
  await writeFile(join(root,'osm.ndjson.gz'),gzipSync(writeTable(t)));
  await writeFile(join(root,'inventory-0.json'),JSON.stringify({schema:2,shard:0,shards:1,catalogue_entries:1,catalogue_sha256:'fixture',service_date:f.source.service_date,entries:[{id:f.source.id,status:'compiled',output:'feeds/jp-metro.json.gz',sha256:f.source.sha256,country:'JP'}]}));
  const manifest=await assemble(root,{osmTable:join(root,'osm.ndjson.gz'),now,...(variant==='operator-binding'?{operatorBindings:operatorBindingsFor(f)}:{})});
  assert.equal(manifest.applied_profiles.sections,3);assert.equal(manifest.tiles,0,'no standalone GTFS tiles');
  const artifact=JSON.parse(gunzipSync(await readFile(join(root,'profiles.json.gz'))));
  const rendered=features(buildTiles(t,{timetables:bindTimetableSections(t,artifact).sections}));
  assert.deepEqual([...new Set(rendered.map(p=>p.frequency_am))].sort(),[4,6]);
  assert.ok(rendered.every(p=>p.frequency_overnight===0));
  assert.ok(rendered.every(p=>p.frequency_source==='Offline Metro fixture'));
  if(variant==='operator-binding')assert.ok(rendered.every(p=>p.frequency_operator_binding==='fixture-operator'));
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
test('equal counts across intervals retain the earliest branch expiry on an OSM edge',()=>{
 const t=table(),way=structuredClone(t.ways.get(1));way.id=4;way.geometry.lines=[[[139.7,35.68],[139.72,35.68]]];t.ways.set(4,way);t.routes.get('r10').evidence.eligible.push(4);
 const f=feed();f.segments[1].profiles=structuredClone(f.segments[0].profiles);f.segments[0].valid_until=now/1000-1;
 const artifact=apply(t,[f]);assert.ok(!artifact.sections.some(s=>s.way===4));assert.ok(artifact.sections.some(s=>s.way===2),'the independently current branch remains available');
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

test('actual OSM frequency coverage excludes unavailable and expired section evidence but counts verified zero',()=>{
  const valid={properties:{frequency_until:now/1000+86400},profiles:{am:{rate:0}}};
  const unavailable={properties:{frequency_until:now/1000+86400},profiles:{}};
  const expired={properties:{frequency_until:now/1000-1},profiles:{am:{rate:8}}};
  const hourly={properties:{frequency_until:now/1000+86400},profiles:{h13:{rate:12}}};
  const bound={sections:new Map([
    [1,[{relation:100,record:valid},{relation:101,record:unavailable}]],
    [2,[{relation:102,record:expired}]],
    [3,[{relation:103,record:hourly}]],
  ])};
  assert.deepEqual(summarizeBoundTimetableSections(bound,now),
    {boundWays:3,boundSections:4,appliedWays:2,appliedSections:2,appliedRelations:2});
  assert.equal(summarizeBoundTimetableSections(bound,now+86401*1000).appliedWays,0);
  assert.throws(()=>summarizeBoundTimetableSections({sections:[]},now),/Invalid bound timetable/);
});

test('bound counts agree with the original OSM section identities from a real fixture',()=>{
  const t=table(),artifact=apply(t,[feed()]),bound=bindTimetableSections(t,artifact);
  const before=summarizeBoundTimetableSections(bound,now);
  assert.deepEqual(before,{boundWays:3,boundSections:3,appliedWays:3,appliedSections:3,appliedRelations:1});
  // One section still exists in OSM but has no validated timetable profile.
  const first=bound.sections.values().next().value[0];
  first.record.profiles={};
  const after=summarizeBoundTimetableSections(bound,now);
  assert.equal(after.boundWays,3);
  assert.equal(after.boundSections,3);
  assert.equal(after.appliedWays,2);
  assert.equal(after.appliedSections,2);
});

test('unmatched railway routes retain bounded route-specific identity and path diagnostics',()=>{
  const scenarios=[
    [f=>{f.agencies[0].agency_name='Wrong operator';},'no_osm_service_identity_candidate'],
    [f=>{f.segments[2].geometry=[[140,35],[140.01,35]];},'candidate_path_not_corroborated'],
    [f=>{f.segments=[];},'no_usable_path_segments'],
  ];
  for(const [change,reason] of scenarios){
    const f=feed();change(f);
    const result=apply(table(),[f]),summary=result.matching.feeds[0];
    assert.equal(summary.unmatchedRoutes,1);
    assert.equal(summary.matchingReasons[reason],1);
    assert.equal(summary.unmatchedExamples.length,1);
    assert.equal(summary.unmatchedExamples[0].route_id,f.routes[0].route_id);
    assert.equal(summary.unmatchedExamples[0].reason,reason);
    assert.equal(result.sections.length,0,'diagnostics never authorize a timetable-to-OSM association');
  }
});

test('single-agency unmatched samples use the resolved agency even when the route omits agency_id',()=>{
  for(const missingAgencyRecordId of [false,true]){
    const f=feed(),expected=missingAgencyRecordId?'single-agency':f.agencies[0].agency_id;
    delete f.routes[0].agency_id;
    if(missingAgencyRecordId)delete f.agencies[0].agency_id;
    f.agencies[0].agency_name='Wrong operator';
    const summary=apply(table(),[f]).matching.feeds[0];
    assert.equal(summary.unmatchedRoutes,1);
    assert.equal(summary.unmatchedExamples[0].reason,'no_osm_service_identity_candidate');
    assert.equal(summary.unmatchedExamples[0].agency_id,expected);
  }
});

test('conflicting matches and stale bindings remain unknown in published service tiles',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../styles/service-headways.json',import.meta.url),'utf8'));
 const assertUnknown=(t,bound)=>{
  const rows=features(buildTiles(t,{headways:catalog,timetables:bound.sections}));
  assert.ok(rows.length>0);
  for(const p of rows){
   assert.equal(p.frequency_am,undefined);
   assert.equal(p.frequency_status,'unknown');
   assert.equal(frequencyAvailability(p,'am',now).status,'unknown');
  }
 };
 const t=table(),original=apply(t,[feed()]);
 assert.equal(original.sections.length,3,'positive control has matched sections');
 assert.ok(features(buildTiles(t,{headways:catalog,timetables:bindTimetableSections(t,original).sections})).every(p=>Number.isFinite(p.frequency_am)));
 const f=feed();
 f.routes.push({...f.routes[0],route_id:'other'});
 f.segments.push(...structuredClone(f.segments).map(s=>({...s,route_id:'other'})));
 const conflict=apply(t,[f]);
 assert.equal(conflict.matching.feeds[0].mappedRoutes,2,'both routes matched before conflict withholding');
 assert.equal(conflict.matching.conflictingSections,3);
 assert.equal(conflict.sections.length,0);
 assertUnknown(t,bindTimetableSections(t,conflict));
 const changed=table();changed.routes.get('r10').evidence.view.ref='H';
 const stale=bindTimetableSections(changed,original);
 assert.equal(stale.staleSections,3);
 assert.equal(stale.sections.size,0);
 assertUnknown(changed,stale);
});
