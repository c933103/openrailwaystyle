import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {captureOsmServiceEvidence, matchTimetablePattern} from '../scripts/timetable-matching.mjs';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const snapshot = '2026-10-05T00:00:00Z', sha = 'a'.repeat(64);
const relation = (changes = {}) => ({type: 'relation', id: 1, version: 2, timestamp: '2026-10-01T00:00:00Z', tags: {route: 'train', ref: 'R', operator: 'Example', 'gtfs:route_id': 'R'}, members: [{type: 'node', ref: 1, role: 'stop'}, {type: 'way', ref: 100, role: ''}, {type: 'node', ref: 2, role: 'stop'}], ...changes});
function fixture() {
  const pattern = {source_route_id: 'R', compiled_route_id: 'R', agency_id: 'A', route_ref: 'R', direction_id: '0', shape_id: null, calls: ['a', 'b'].map(station_id => ({stop_id: station_id, station_id, pickup_type: '0', drop_off_type: '0'}))};
  pattern.id = hash(['feed', sha, pattern]);
  const source = {feed_id: 'feed', sha256: sha, service_date: '2026-10-05', valid_until: 2000000000};
  const bound = {feed_id: 'feed', source_sha256: sha, status: 'verified'};
  return {
    evidence: {schema: 1, status: 'captured', source, patterns: [pattern], observations: [{pattern_id: pattern.id, calendar_state: 'current', valid_until: 2000000000}], stops: []},
    pattern_id: pattern.id,
    context: {feed_id: 'feed', source_sha256: sha, service_date: source.service_date, osm_snapshot: snapshot, review_until: 2000000000, candidate_inventory: 'complete'},
    candidates: [{service_id: 'r1', status: 'verified', eligibility: 'eligible', osm: captureOsmServiceEvidence(relation(), snapshot), eligible_way_ids: [100], route_bindings: [{...bound, route_id: 'R'}], variants: [{id: 'outbound', status: 'verified', direction_id: '0', stations: ['node:1', 'node:2'], section_way_ids: [100]}]}],
    crosswalk: ['a', 'b'].map((station_id, i) => ({...bound, station_id, osm_station_id: `node:${i + 1}`, osm_snapshot: snapshot})),
    now: 1791158400,
  };
}
const status = input => matchTimetablePattern(input).status;

test('offline compiler evidence fixtures and existing-output compatibility', () => {
  const run = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'timetable_evidence_test.py'], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
test('capture retains bounded raw declarations without inventing a feed binding or station equality', () => {
  const input = relation(), before = structuredClone(input), captured = captureOsmServiceEvidence(input, snapshot);
  assert.deepEqual(input, before);
  assert.equal(captured.tags['gtfs:route_id'], 'R');
  assert.equal(captured.tags.route, 'train');
  assert.deepEqual(captured.served_members.map(m => [m.id, m.position]), [['node:1', 0], ['node:2', 2]]);
  assert.equal(captured.feed_id, undefined);
  assert.equal(captureOsmServiceEvidence(relation({version: undefined}), snapshot).status, 'incomplete');
  assert.equal(captureOsmServiceEvidence(relation({tags: {ref: 'x'.repeat(1025)}}), snapshot).status, 'incomplete');
  assert.equal(captureOsmServiceEvidence(relation({members: Array.from({length: 513}, (_, i) => ({type: 'node', ref: i + 1, role: 'stop'}))}), snapshot).status, 'incomplete');
});
test('one reviewed feed-scoped ID, ordered station crosswalk and eligible section can verify identity only', () => {
  const input = fixture(), before = structuredClone(input), match = matchTimetablePattern(input);
  assert.equal(match.status, 'verified');
  assert.equal(match.identity_method, 'feed_scoped_route_id');
  assert.deepEqual(match.section_way_ids, [100]);
  assert.equal(match.frequency_status, 'not_evaluated');
  assert.equal(match.profiles, undefined);
  assert.deepEqual(input, before);
});
test('bare route IDs, cross-feed collisions, geometry-only and names cannot attach data', () => {
  for (const mutate of [x => { x.candidates[0].route_bindings[0].feed_id = 'other'; }, x => { delete x.candidates[0].route_bindings[0].source_sha256; }, x => { x.candidates[0].route_bindings = []; x.candidates[0].geometry = [[24, 60], [24, 60.01]]; }, x => { x.crosswalk = []; }]) {
    const input = fixture(); mutate(input); assert.notEqual(status(input), 'verified');
  }
});
test('fallback requires verified operator, exact ref, served stations and direction', () => {
  const input = fixture(); input.candidates[0].route_bindings = [];
  input.candidates[0].operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'verified'};
  assert.equal(matchTimetablePattern(input).identity_method, 'verified_operator_ref_stops');
  input.candidates[0].operator_binding.agency_id = 'wrong'; assert.notEqual(status(input), 'verified');
  input.candidates[0].operator_binding.agency_id = 'A'; input.candidates[0].operator_binding.status = 'unknown'; assert.equal(status(input), 'missing_evidence');
});
test('ambiguous candidates and conflicting stations fail closed independently of input order', () => {
  let input = fixture(); input.candidates.push(structuredClone(input.candidates[0])); input.candidates[1].service_id = 'r2';
  assert.equal(status(input), 'ambiguous'); input.candidates.reverse(); assert.equal(status(input), 'ambiguous');
  input = fixture(); input.crosswalk.push({...input.crosswalk[0], osm_station_id: 'node:99'}); assert.equal(status(input), 'conflicting');
  input = fixture(); input.candidates.push({...structuredClone(input.candidates[0]), status: 'conflict'}); assert.equal(status(input), 'conflicting');
});
test('missing, future and expired evidence are never converted into a zero-frequency match', () => {
  const cases = [
    [x => { x.evidence.status = 'incomplete'; }, 'missing_evidence'],
    [x => { x.evidence.observations = []; }, 'missing_evidence'],
    [x => { x.evidence.observations[0].calendar_state = 'future'; }, 'missing_evidence'],
    [x => { x.evidence.observations[0].calendar_state = 'expired'; }, 'stale'],
    [x => { x.context.review_until = x.now - 1; }, 'stale'],
    [x => { x.context.candidate_inventory = 'partial'; }, 'missing_evidence'],
    [x => { x.candidates[0].eligibility = 'excluded'; }, 'no_eligible_service'],
    [x => { x.candidates[0].eligibility = 'unknown'; }, 'missing_evidence'],
    [x => { x.candidates[0].route_bindings[0].source_sha256 = 'b'.repeat(64); }, 'stale'],
    [x => { x.crosswalk[0].osm_snapshot = '2026-10-04T00:00:00Z'; }, 'stale'],
  ];
  for (const [mutate, expected] of cases) { const input = fixture(); mutate(input); const output = matchTimetablePattern(input); assert.equal(output.status, expected); assert.equal(output.frequency_status, 'not_evaluated'); assert.equal(output.profiles, undefined); }
});
test('branches, opposing directions, express, short-working and loops require explicit ordered variants', () => {
  for (const stations of [['node:2', 'node:1'], ['node:1'], ['node:1', 'node:3'], ['node:1', 'node:2', 'node:1']]) {
    const input = fixture(); input.candidates[0].variants[0].stations = stations; assert.equal(status(input), 'missing_evidence');
  }
  const input = fixture(); input.candidates[0].variants[0].direction_id = '1'; assert.equal(status(input), 'missing_evidence');
  input.candidates[0].variants[0].direction_id = '0'; input.candidates[0].variants[0].section_way_ids = [101]; assert.equal(status(input), 'missing_evidence');
});
test('a plausible incomplete alternative blocks a seemingly valid first result', () => {
  const input = fixture(); input.candidates.push({...structuredClone(input.candidates[0]), status: 'unknown'});
  assert.equal(status(input), 'missing_evidence'); input.candidates.reverse(); assert.equal(status(input), 'missing_evidence');
});
test('snapshot and content mismatches are rejected; caller inputs remain immutable', () => {
  const input = fixture(); input.evidence.patterns[0].calls.reverse(); assert.equal(status(input), 'conflicting');
  const other = fixture(); other.candidates[0].osm.tags.ref = 'changed'; assert.equal(status(other), 'conflicting');
  const old = fixture(); old.candidates[0].osm = captureOsmServiceEvidence(relation(), '2026-10-04T00:00:00Z'); assert.equal(status(old), 'stale');
});
test('capture and matching remain disconnected from production geometry, publication and renderer', () => {
  for (const path of ['scripts/service-routes.mjs', 'scripts/service-relations.mjs', 'scripts/assemble-global-frequency.mjs', 'scripts/rebuild-service-frequency.mjs', 'scripts/gtfs-service.mjs', 'styles/service-frequency.mjs']) {
    assert.doesNotMatch(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), /timetable-matching|matchTimetablePattern|captureOsmServiceEvidence/);
  }
});

test('Python-produced patterns use the same immutable identity contract in JavaScript', () => {
  const run = spawnSync('python3', ['-c', `
import sys, json, zipfile
sys.path.insert(0, 'tests')
import gtfs_frequency_test as f
case = f.GTFSFrequency()
try:
    path = case.shape_feed()
    with zipfile.ZipFile(path) as z:
        files = {name: z.read(name) for name in z.namelist()}
    lines = files['trips.txt'].decode().splitlines()
    files['trips.txt'] = ('\\n'.join([lines[0] + ',direction_id'] + [line + ',0' for line in lines[1:]]) + '\\n').encode()
    with zipfile.ZipFile(path, 'w') as z:
        for name, data in files.items():
            z.writestr(name, data)
    print(json.dumps(f.compiler.compile_feed(path, f.CONFIG, '2026-10-05', geometry=True, matching_evidence=True)['matching_evidence']))
finally:
    case.doCleanups()
`], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  const input = fixture(), evidence = JSON.parse(run.stdout), pattern = evidence.patterns.find(p => p.calls.map(c => c.station_id).join(',') === 'A,B,C');
  input.evidence = evidence; input.pattern_id = pattern.id;
  input.context = {...input.context, feed_id: evidence.source.feed_id, source_sha256: evidence.source.sha256};
  input.candidates[0].route_bindings = [{feed_id: evidence.source.feed_id, source_sha256: evidence.source.sha256, route_id: 'R', status: 'verified'}];
  input.candidates[0].osm = captureOsmServiceEvidence(relation({members: [...relation().members, {type: 'node', ref: 3, role: 'stop'}]}), snapshot);
  input.candidates[0].variants[0].stations.push('node:3');
  input.crosswalk = ['A', 'B', 'C'].map((station_id, i) => ({feed_id: evidence.source.feed_id, source_sha256: evidence.source.sha256, station_id, osm_station_id: `node:${i + 1}`, osm_snapshot: snapshot, status: 'verified'}));
  assert.equal(status(input), 'verified');
});

test('total candidate work is capped before producing a match or copying sections', () => {
  const input = fixture();
  input.candidates[0].variants = Array.from({length: 128}, (_, i) => ({...input.candidates[0].variants[0], id: `v${i}`, section_way_ids: Array(1000).fill(100)}));
  assert.deepEqual(matchTimetablePattern(input).reasons, ['candidate_work_limit']);
});
test('non-served timepoints cannot supply stop evidence and conditional calls remain explicit', () => {
  const input = fixture(), pattern = input.evidence.patterns[0];
  pattern.calls.splice(1, 0, {stop_id: 'pass', station_id: 'pass', pickup_type: '1', drop_off_type: '1'});
  const update = () => { const {id, ...definition} = pattern; pattern.id = hash(['feed', sha, definition]); input.pattern_id = pattern.id; input.evidence.observations[0].pattern_id = pattern.id; };
  update(); assert.equal(status(input), 'verified');
  pattern.calls[1].pickup_type = '2'; update(); assert.equal(status(input), 'missing_evidence');
});

test('reviewed branch, express, short-working, loop and reverse variants keep only their own sections', () => {
  const variants = [
    {id: 'branch-c', stations: ['node:1', 'node:2', 'node:3'], section_way_ids: [100, 101], direction_id: '0'},
    {id: 'branch-d', stations: ['node:1', 'node:2', 'node:4'], section_way_ids: [100, 102], direction_id: '0'},
    {id: 'express', stations: ['node:1', 'node:3'], section_way_ids: [100, 101], direction_id: '0'},
    {id: 'short', stations: ['node:1', 'node:2'], section_way_ids: [100], direction_id: '0'},
    {id: 'loop', stations: ['node:1', 'node:2', 'node:1'], section_way_ids: [100, 100], direction_id: '0'},
    {id: 'reverse', stations: ['node:3', 'node:2', 'node:1'], section_way_ids: [101, 100], direction_id: '1'},
  ];
  for (const selected of variants) {
    const input = fixture(), pattern = input.evidence.patterns[0];
    pattern.calls = selected.stations.map(station => ({stop_id: station, station_id: station, pickup_type: '0', drop_off_type: '0'}));
    pattern.direction_id = selected.direction_id;
    const {id, ...definition} = pattern;
    pattern.id = hash(['feed', sha, definition]); input.pattern_id = pattern.id; input.evidence.observations[0].pattern_id = pattern.id;
    input.candidates[0].osm = captureOsmServiceEvidence(relation({members: [
      ...[1, 2, 3, 4].map(ref => ({type: 'node', ref, role: 'stop'})),
      ...[100, 101, 102].map(ref => ({type: 'way', ref, role: ''})),
    ]}), snapshot);
    input.candidates[0].eligible_way_ids = [100, 101, 102];
    input.candidates[0].variants = variants.map(variant => ({...variant, status: 'verified'}));
    input.crosswalk = [1, 2, 3, 4].map(ref => ({feed_id: 'feed', source_sha256: sha, station_id: `node:${ref}`, osm_station_id: `node:${ref}`, status: 'verified', osm_snapshot: snapshot}));
    const output = matchTimetablePattern(input);
    assert.equal(output.status, 'verified', selected.id);
    assert.equal(output.variant_id, selected.id);
    assert.deepEqual(output.section_way_ids, selected.section_way_ids);
  }
});

test('deep, oversized and unsupported JSON fields fail closed before canonical hashing or output copying', () => {
  let cursor = {};
  const nested = cursor;
  for (let i = 0; i < 20000; i++) cursor = cursor.more = {};
  for (const mutate of [
    input => { input.evidence.patterns[0].extra = nested; },
    input => { input.evidence.patterns[0].calls[0].extra = nested; },
    input => { input.evidence.patterns[0].shape_id = nested; },
    input => { input.evidence.source.extra = nested; },
    input => { input.candidates[0].osm.extra = nested; },
    input => { input.candidates[0].osm.tags.operator = nested; },
    input => { input.candidates[0].osm.tags.extra = nested; },
    input => { input.candidates[0].osm.served_members[0].extra = nested; },
    input => { input.evidence.patterns[0].route_ref = 'x'.repeat(1000000); },
    input => { input.crosswalk[0].osm_station_id = 'node:' + '1'.repeat(1000000); },
  ]) {
    const input = fixture(); mutate(input);
    const output = matchTimetablePattern(input);
    assert.notEqual(output.status, 'verified');
    assert.ok(JSON.stringify(output).length < 512, 'malformed content is never copied to the result');
  }
});
test('OSM capture bounds raw tag scanning before materializing selected entries', () => {
  const raw = relation({tags: Object.fromEntries(Array.from({length: 100000}, (_, i) => [`unrelated:${i}`, 'ignored']))});
  assert.deepEqual(captureOsmServiceEvidence(raw, snapshot).reasons, ['raw_tag_limit_or_invalid']);
  raw.tags = {operator: {nested: {value: 'not a tag string'}}};
  assert.equal(captureOsmServiceEvidence(raw, snapshot).status, 'incomplete');
});
