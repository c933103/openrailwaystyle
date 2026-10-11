import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {captureOsmServiceEvidence, matchTimetablePattern} from '../scripts/timetable-matching.mjs';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const snapshot = '2026-10-05T00:00:00Z', sha = 'a'.repeat(64);
const relation = (changes = {}) => ({type: 'relation', id: 1, version: 2, timestamp: '2026-10-01T00:00:00Z', tags: {route: 'train', ref: 'R', operator: 'Example', 'gtfs:route_id': 'R'}, members: [{type: 'node', ref: 1, role: 'stop'}, {type: 'way', ref: 100, role: ''}, {type: 'node', ref: 2, role: 'stop'}], ...changes});
function sealObservations(input) {
  for (const observation of input.evidence.observations) {
    const {fingerprint, ...definition} = observation;
    observation.fingerprint = hash([input.evidence.source.feed_id, input.evidence.source.sha256, input.evidence.source.service_date, definition]);
  }
  return input;
}
function fixture() {
  const pattern = {source_route_id: 'R', compiled_route_id: 'R', agency_id: 'A', route_ref: 'R', direction_id: '0', shape_id: null, calls: ['a', 'b'].map(station_id => ({stop_id: station_id, station_id, pickup_type: '0', drop_off_type: '0'}))};
  pattern.id = hash(['feed', sha, pattern]);
  const source = {feed_id: 'feed', sha256: sha, service_date: '2026-10-05', valid_until: 2000000000};
  const bound = {feed_id: 'feed', source_sha256: sha, status: 'verified'};
  return sealObservations({
    evidence: {schema: 1, status: 'captured', source, patterns: [pattern], observations: [{id: hash(['feed', sha, 'trip']), trip_id: 'trip', service_id: 'W', pattern_id: pattern.id, timezone: 'Europe/Helsinki', calendar_state: 'current', valid_until: 2000000000, active_service_dates: ['2026-10-05'], departures: [28800, 29400], frequencies: []}], stops: []},
    pattern_id: pattern.id,
    context: {feed_id: 'feed', source_sha256: sha, service_date: source.service_date, osm_snapshot: snapshot, review_until: 2000000000, candidate_inventory: 'complete'},
    candidates: [{service_id: 'r1', status: 'verified', eligibility: 'eligible', osm: captureOsmServiceEvidence(relation(), snapshot), eligible_way_ids: [100], route_bindings: [{...bound, route_id: 'R'}], variants: [{id: 'outbound', status: 'verified', direction_id: '0', stations: ['node:1', 'node:2'], section_way_ids: [100]}]}],
    crosswalk: ['a', 'b'].map((station_id, i) => ({...bound, station_id, osm_station_id: `node:${i + 1}`, osm_snapshot: snapshot})),
    now: 1791158400,
  });
}
const status = input => matchTimetablePattern(input).status;


for (const reverse of [false, true]) test(`independent same-calendar boundary regression (${reverse})`, () => {
  const input = fixture(), first = input.evidence.observations[0];
  input.evidence.observations.push({...structuredClone(first), trip_id: 'sibling', id: hash(['feed', sha, 'sibling']), valid_until: first.valid_until - 86400});
  if (reverse) input.evidence.observations.reverse();
  sealObservations(input);
  const before = structuredClone(input);
  assert.deepEqual(matchTimetablePattern(input).reasons, ['inconsistent_service_end']);
  assert.deepEqual(input, before);
});

function resealPatterns(input) {
  for (const pattern of input.evidence.patterns) {
    const previous=pattern.id, {id: unused,...definition}=pattern;
    pattern.id=hash([input.evidence.source.feed_id,input.evidence.source.sha256,definition]);
    if(input.pattern_id===previous)input.pattern_id=pattern.id;
    for(const observation of input.evidence.observations)if(observation.pattern_id===previous)observation.pattern_id=pattern.id;
  }
  return sealObservations(input);
}
function realInput(evidence) {
 const input=fixture(); input.evidence=structuredClone(evidence);
 const selected=input.evidence.patterns.find(p=>p.source_route_id==='a');input.pattern_id=selected.id;
 const src=input.evidence.source,bound={feed_id:src.feed_id,source_sha256:src.sha256,status:'verified'};
 const pin=src.service_date+'T00:00:00Z';input.now=Date.parse(pin)/1000;
 Object.assign(input.context,{feed_id:src.feed_id,source_sha256:src.sha256,service_date:src.service_date,osm_snapshot:pin});
 input.candidates[0].route_bindings=[{...bound,route_id:'a'}];
 input.candidates[0].osm=captureOsmServiceEvidence(relation({timestamp:pin}),pin);
 input.crosswalk=selected.calls.map((c,i)=>({...bound,station_id:c.station_id,osm_station_id:`node:${i+1}`,osm_snapshot:pin}));
 return input;
}
const generated = spawnSync('python3', ['tests/fixtures/service-frequency/collector-invariant-controls.py'], {encoding: 'utf8'});
assert.equal(generated.status, 0, generated.stderr);
const real = JSON.parse(generated.stdout);
for (const [label, evidence] of Object.entries(real)) test(`independent real collector control: ${label}`, () => {
  const input = realInput(evidence), before = structuredClone(input);
  assert.equal(matchTimetablePattern(input).status, 'verified');
  assert.deepEqual(input, before);
});
for (const [label, key, reason, mutate] of [
  ['inflated-sibling-validity', 'connected', 'inconsistent_service_end', input => { input.evidence.observations[0].valid_until += 86400; input.evidence.source.valid_until += 86400; }],
  ['contradictory-expired-same-extent', 'inactive', 'inconsistent_service_expiry_state', input => { input.evidence.observations[1].calendar_state = 'expired'; }],
  ['missing-end-on-one-sibling', 'inactive', 'inconsistent_service_end', input => { Object.assign(input.evidence.observations[1], {valid_until: 0, calendar_state: 'expired'}); }],
  ['nonminimum-root', 'connected', 'noncanonical_route_alias', input => { for (const pattern of input.evidence.patterns) pattern.compiled_route_id = 'b'; }],
  ['disconnected-alias', 'disconnected', 'disconnected_canonical_routes', input => { for (const pattern of input.evidence.patterns) pattern.compiled_route_id = 'a'; }],
]) for (const reverse of [false, true]) test(`independent real collector regression: ${label}/${reverse}`, () => {
  const input = realInput(real[key]); mutate(input); resealPatterns(input);
  if (reverse) { input.evidence.patterns.reverse(); input.evidence.observations.reverse(); }
  const before = structuredClone(input);
  assert.deepEqual(matchTimetablePattern(input).reasons, [reason]);
  assert.deepEqual(input, before);
});
