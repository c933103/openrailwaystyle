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
  for (const [mutate, expected] of cases) { const input = fixture(); mutate(input); sealObservations(input); const output = matchTimetablePattern(input); assert.equal(output.status, expected); assert.equal(output.frequency_status, 'not_evaluated'); assert.equal(output.profiles, undefined); }
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
  input.evidence.observations[0].departures = [28800, 29100, 29400];
  const update = () => { const {id, ...definition} = pattern; pattern.id = hash(['feed', sha, definition]); input.pattern_id = pattern.id; input.evidence.observations[0].pattern_id = pattern.id; sealObservations(input); };
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
    pattern.id = hash(['feed', sha, definition]); input.pattern_id = pattern.id; input.evidence.observations[0].pattern_id = pattern.id; input.evidence.observations[0].departures = pattern.calls.map((_, i) => 28800 + i * 600); sealObservations(input);
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

test('a current observation cannot be relinked to revive an expired pattern', () => {
  const input = fixture(), expired = input.evidence.patterns[0];
  input.evidence.observations[0].calendar_state = 'expired';
  input.evidence.observations[0].valid_until = input.now - 1;
  const current = {...structuredClone(expired), shape_id: 'current-branch'};
  const {id, ...definition} = current; current.id = hash(['feed', sha, definition]);
  input.evidence.patterns.push(current);
  input.evidence.observations.push({...structuredClone(input.evidence.observations[0]), id: hash(['feed', sha, 'current']), trip_id: 'current', pattern_id: current.id, calendar_state: 'current', valid_until: 2000000000});
  sealObservations(input);
  assert.equal(status(input), 'stale');
  input.evidence.observations[1].pattern_id = expired.id;
  assert.equal(status(input), 'conflicting', 'relinking cannot revive the expired pattern');
});

test('observation calendar, source-trip identity and bounded complete schema are checked before use', () => {
  for (const mutate of [
    input => { input.evidence.observations[0].valid_until++; },
    input => { input.evidence.observations[0].calendar_state = 'expired'; },
    input => { input.evidence.observations[0].trip_id = 'different'; },
  ]) { const input = fixture(); mutate(input); assert.equal(status(input), 'conflicting'); }
  for (const mutate of [
    input => { input.evidence.observations[0].extra = {nested: {value: 'unsupported'}}; },
    input => { input.evidence.observations[0].departures = Array(513).fill(0); },
    input => { input.evidence.observations[0].active_service_dates = Array(368).fill('2026-10-05'); },
    input => { input.evidence.observations[0].timezone = {nested: 'unsupported'}; },
  ]) { const input = fixture(); mutate(input); assert.equal(status(input), 'missing_evidence'); }
});

test('a stale plausible operator fallback blocks a valid exact candidate', () => {
  const input = fixture();
  const alternate = structuredClone(input.candidates[0]);
  alternate.service_id = 'r-alternate';
  alternate.route_bindings = [];
  alternate.operator_binding = {feed_id: 'feed', source_sha256: 'b'.repeat(64), agency_id: 'A', status: 'verified'};
  input.candidates.push(alternate);
  assert.equal(status(input), 'stale');
  input.candidates.reverse();
  assert.equal(status(input), 'stale', 'candidate order cannot hide the stale alternative');
});

test('a differently scoped operator assertion is not a stale same-feed alternative', () => {
  for (const change of [{feed_id: 'different-feed'}, {agency_id: 'different-agency'}]) {
    const input = fixture(), alternate = structuredClone(input.candidates[0]);
    alternate.route_bindings = [];
    alternate.operator_binding = {feed_id: 'feed', agency_id: 'A', source_sha256: 'b'.repeat(64), status: 'verified', ...change};
    input.candidates.push(alternate);
    assert.equal(status(input), 'verified');
  }
});

test('stale same-feed station alternatives cannot be filtered out of a complete crosswalk', () => {
  const input = fixture();
  input.crosswalk.push({...input.crosswalk[0], source_sha256: 'b'.repeat(64), osm_station_id: 'node:99'});
  assert.equal(status(input), 'stale');
  input.crosswalk.reverse();
  assert.equal(status(input), 'stale');
});

test('crosswalk alternatives belonging to a different feed or unserved station remain separate', () => {
  for (const change of [{feed_id: 'other'}, {station_id: 'unserved'}]) {
    const input = fixture();
    input.crosswalk.push({...input.crosswalk[0], source_sha256: 'b'.repeat(64), osm_station_id: 'node:99', ...change});
    assert.equal(status(input), 'verified');
  }
});

test('explicitly excluded candidates need no match-only schema or station crosswalk', () => {
  for (const excluded of [{eligibility: 'excluded'}, {eligibility: 'excluded', route_bindings: 'irrelevant-invalid'}]) {
    const input = fixture();
    input.candidates.push(excluded);
    assert.equal(status(input), 'verified');
    input.candidates = [excluded];
    delete input.crosswalk;
    assert.equal(status(input), 'no_eligible_service');
  }
  const empty = fixture(); empty.candidates = []; delete empty.crosswalk;
  assert.equal(status(empty), 'no_eligible_service');
});

test('unknown eligibility and incomplete candidate coverage are not treated as exclusion', () => {
  const input = fixture(); input.candidates.push({eligibility: 'unknown'});
  assert.equal(status(input), 'missing_evidence');
  input.candidates = [{eligibility: 'excluded'}]; input.context.candidate_inventory = 'partial';
  assert.equal(status(input), 'missing_evidence');
});

test('a current conflicting operator assertion blocks an exact binding on the same candidate', () => {
  const input = fixture();
  input.candidates[0].operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'conflict'};
  assert.equal(status(input), 'conflicting');
});

test('operator assertion absence, uncertainty and unrelated scope remain distinct beside exact bindings', () => {
  assert.equal(status(fixture()), 'verified', 'absence is not a conflicting assertion');
  for (const state of ['unknown', undefined]) {
    const input = fixture(); input.candidates[0].operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: state};
    assert.equal(status(input), 'missing_evidence');
  }
  for (const scope of [{feed_id: 'other', agency_id: 'A'}, {feed_id: 'feed', agency_id: 'other'}]) {
    const input = fixture(); input.candidates[0].operator_binding = {...scope, source_sha256: sha, status: 'conflict'};
    assert.equal(status(input), 'verified');
  }
  const noRef = fixture(), pattern = noRef.evidence.patterns[0];
  pattern.route_ref = null;
  const {id, ...definition} = pattern; pattern.id = hash(['feed', sha, definition]);
  noRef.pattern_id = pattern.id; noRef.evidence.observations[0].pattern_id = pattern.id; sealObservations(noRef);
  noRef.candidates[0].operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'conflict'};
  assert.equal(status(noRef), 'conflicting', 'an exact binding establishes relevance without a ref guess');
});

test('sparse station sequences cannot verify a variant with no declared stations', () => {
  const input = fixture();
  input.candidates[0].variants[0].stations = Array(2);
  assert.equal(status(input), 'missing_evidence');
});

test('all nested bounded arrays reject holes before hashing, equality or selection', () => {
  const paths = [
    'evidence.patterns', 'evidence.observations', 'evidence.stops',
    'evidence.patterns.0.calls', 'evidence.observations.0.active_service_dates',
    'evidence.observations.0.departures', 'evidence.observations.0.frequencies',
    'candidates', 'crosswalk', 'candidates.0.route_bindings',
    'candidates.0.osm.served_members', 'candidates.0.osm.track_members',
    'candidates.0.eligible_way_ids', 'candidates.0.variants',
    'candidates.0.variants.0.stations', 'candidates.0.variants.0.section_way_ids',
  ];
  for (const path of paths) {
    const input = fixture(), values = path.split('.').reduce((value, key) => value[key], input);
    assert.equal(status(input), 'verified', `${path}: dense control`);
    values.length++;
    assert.equal(status(input), 'missing_evidence', `${path}: sparse`);
    const nullInput = fixture(), keys = path.split('.'), key = keys.pop();
    keys.reduce((value, key) => value[key], nullInput)[key] = null;
    assert.equal(status(nullInput), 'missing_evidence', `${path}: null array`);
  }
  const inherited = fixture(), stations = inherited.candidates[0].variants[0].stations;
  const prototype = Object.create(Array.prototype);
  prototype[0] = stations[0];
  delete stations[0];
  Object.setPrototypeOf(stations, prototype);
  assert.equal(status(inherited), 'missing_evidence', 'an inherited station is not owned evidence');
  assert.equal(captureOsmServiceEvidence(relation(), snapshot).status, 'captured');
  assert.equal(captureOsmServiceEvidence(relation({members: Array(3)}), snapshot).status, 'incomplete');
  assert.equal(captureOsmServiceEvidence(relation({members: null}), snapshot).status, 'incomplete');
});

test('explicit null evidence entries stay invalid while unknown departure times remain representable', () => {
  for (const mutate of [
    x => { x.evidence.patterns[0].calls[0] = null; },
    x => { x.evidence.observations[0].active_service_dates[0] = null; },
    x => { x.evidence.observations[0].frequencies = [null]; },
    x => { x.candidates[0] = null; },
    x => { x.candidates[0].osm.served_members[0] = null; },
    x => { x.candidates[0].osm.track_members[0] = null; },
    x => { x.candidates[0].eligible_way_ids[0] = null; },
    x => { x.candidates[0].variants[0] = null; },
    x => { x.candidates[0].variants[0].stations[0] = null; },
    x => { x.candidates[0].variants[0].section_way_ids[0] = null; },
  ]) {
    const input = fixture(); mutate(input);
    assert.equal(status(input), 'missing_evidence');
  }
  assert.equal(captureOsmServiceEvidence(relation({members: [null]}), snapshot).status, 'incomplete');
  const unknown = fixture();
  unknown.evidence.observations[0].departures[0] = null;
  sealObservations(unknown);
  assert.equal(status(unknown), 'verified', 'identity can verify without manufacturing a departure or frequency');
  assert.equal(matchTimetablePattern(unknown).frequency_status, 'not_evaluated');
});

test('route and operator assertion matrix preserves blockers, exclusions and order independence', () => {
  const states = [
    ['current', {}, 'ambiguous'],
    ['stale', {source_sha256: 'b'.repeat(64)}, 'stale'],
    ['conflicting', {status: 'conflict'}, 'conflicting'],
    ['missing', {status: undefined}, 'missing_evidence'],
    ['unrelated', {feed_id: 'other'}, 'verified'],
    ['absent', null, 'verified'],
  ];
  for (const kind of ['route', 'operator']) for (const [label, change, expected] of states) {
    for (const excluded of [false, true]) for (const reverse of [false, true]) {
      const input = fixture(), alternate = structuredClone(input.candidates[0]);
      alternate.service_id = 'alternative';
      if (kind === 'operator') {
        alternate.route_bindings = [];
        if (change !== null) alternate.operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'verified', ...change};
      } else alternate.route_bindings = change === null ? [] : [{...alternate.route_bindings[0], ...change}];
      if (excluded) alternate.eligibility = 'excluded';
      input.candidates.push(alternate);
      if (reverse) input.candidates.reverse();
      const output = matchTimetablePattern(input);
      assert.equal(output.status, excluded ? 'verified' : expected, `${kind}/${label}/excluded=${excluded}/reverse=${reverse}`);
      assert.equal(output.frequency_status, 'not_evaluated');
      assert.equal(output.profiles, undefined);
    }
  }
});

test('station assertion matrix keeps relevant alternatives distinct from unrelated or absent evidence', () => {
  const states = [
    ['current', {}, 'verified'],
    ['stale source', {source_sha256: 'b'.repeat(64)}, 'stale'],
    ['stale snapshot', {osm_snapshot: '2026-10-04T00:00:00Z'}, 'stale'],
    ['conflicting', {status: 'conflict'}, 'conflicting'],
    ['different station', {osm_station_id: 'node:99'}, 'conflicting'],
    ['missing status', {status: undefined}, 'missing_evidence'],
    ['excluded is not station proof', {status: 'excluded'}, 'missing_evidence'],
    ['unrelated feed', {feed_id: 'other'}, 'verified'],
    ['unserved station', {station_id: 'other'}, 'verified'],
  ];
  for (const [label, change, expected] of states) for (const reverse of [false, true]) {
    const input = fixture();
    input.crosswalk.push({...input.crosswalk[0], ...change});
    input.candidates.push({eligibility: 'excluded'});
    if (reverse) { input.crosswalk.reverse(); input.candidates.reverse(); }
    const output = matchTimetablePattern(input);
    assert.equal(output.status, expected, `${label}/reverse=${reverse}`);
    assert.equal(output.frequency_status, 'not_evaluated');
  }
  const absent = fixture(); absent.crosswalk.shift();
  assert.equal(status(absent), 'missing_evidence');
});

test('conflicting, stale and missing candidate blockers have stable precedence in either order', () => {
  for (const [left, right, expected] of [
    ['conflict', 'stale', 'conflicting'],
    ['conflict', 'unknown', 'conflicting'],
    ['stale', 'unknown', 'stale'],
  ]) for (const reverse of [false, true]) {
    const input = fixture();
    for (const state of [left, right]) {
      const alternate = structuredClone(input.candidates[0]);
      alternate.service_id = `alternative-${state}`;
      if (state === 'stale') alternate.route_bindings[0].source_sha256 = 'b'.repeat(64);
      else alternate.route_bindings[0].status = state;
      input.candidates.push(alternate);
    }
    if (reverse) input.candidates.reverse();
    const output = matchTimetablePattern(input);
    assert.equal(output.status, expected, `${left}/${right}/reverse=${reverse}`);
    assert.equal(output.frequency_status, 'not_evaluated');
  }
});

test('operator alternative relevance cannot rely on a damaged or missing OSM declaration', () => {
  for (const change of ['ref', 'missing']) for (const reverse of [false, true]) {
    const input = fixture(), alternate = structuredClone(input.candidates[0]);
    alternate.service_id = 'alternative'; alternate.route_bindings = [];
    alternate.operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'verified'};
    input.candidates.push(alternate);
    assert.equal(status(input), 'ambiguous', 'both intact candidates are plausible');
    if (change === 'ref') alternate.osm.tags.ref = 'Q';
    else delete alternate.osm;
    if (reverse) input.candidates.reverse();
    assert.equal(status(input), change === 'ref' ? 'conflicting' : 'missing_evidence', `${change}/${reverse}`);
  }
});

test('only intact current nonmatching refs can exclude same-scope operator alternatives', () => {
  for (const reverse of [false, true]) {
    const input = fixture(), alternate = structuredClone(input.candidates[0]);
    alternate.route_bindings = []; alternate.service_id = 'different-ref';
    alternate.operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'verified'};
    alternate.osm = captureOsmServiceEvidence(relation({tags: {...relation().tags, ref: 'Q'}}), snapshot);
    input.candidates.push(alternate);
    if (reverse) input.candidates.reverse();
    assert.equal(status(input), 'verified', 'a valid current different ref is unrelated');
    alternate.osm = captureOsmServiceEvidence(relation({tags: {...relation().tags, ref: 'Q'}}), '2026-10-04T00:00:00Z');
    assert.equal(status(input), 'stale', 'an old declaration cannot establish current irrelevance');
  }
});

test('OSM work for same-operator alternatives is bounded even when every intact ref differs', () => {
  const input = fixture();
  const osm = captureOsmServiceEvidence(relation({tags: {...relation().tags, ref: 'Q'}, members: Array.from({length: 10000}, (_, i) => ({type: 'way', ref: i + 1, role: ''}))}), snapshot);
  for (let i = 0; i < 11; i++) input.candidates.push({eligibility: 'eligible', route_bindings: [], operator_binding: {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'verified'}, osm});
  assert.deepEqual(matchTimetablePattern(input).reasons, ['candidate_work_limit']);
});

test('consumer numeric boundaries preserve supported integers and reject unsupported offsets', () => {
  const maximum = 366 * 86400;
  for (const [field, value, expected] of [
    ['headway_secs', Number.MAX_SAFE_INTEGER, 'verified'],
    ['headway_secs', Number.MAX_SAFE_INTEGER + 1, 'missing_evidence'],
    ['start', maximum - 1, 'verified'],
    ['start', maximum, 'missing_evidence'],
    ['end', maximum, 'verified'],
    ['end', maximum + 1, 'missing_evidence'],
    ['departure', 0, 'verified'],
    ['departure', maximum, 'verified'],
    ['departure', maximum + 1, 'missing_evidence'],
  ]) {
    const input = fixture(), observation = input.evidence.observations[0];
    observation.departures = [null, field === 'departure' ? value : 600];
    observation.frequencies = [{start: 0, end: maximum, headway_secs: 600, exact_times: '0'}];
    if (field !== 'departure') observation.frequencies[0][field] = value;
    sealObservations(input);
    const output = matchTimetablePattern(input);
    assert.equal(output.status, expected, `${field}/${value}`);
    assert.equal(output.frequency_status, 'not_evaluated');
  }
});

test('dense route binding inventories cannot silently discard malformed entries', () => {
  for (const malformed of [null, {}]) for (const reverse of [false, true]) {
    const input = fixture(); input.candidates[0].route_bindings.push(malformed);
    if (reverse) input.candidates[0].route_bindings.reverse();
    assert.equal(status(input), 'missing_evidence');
  }
});

test('binding inventories validate every bounded record before scope filtering', () => {
  for (const malformed of [null, {}, {feed_id: 'other'}, {...fixture().crosswalk[0], extra: 'unsupported'}]) {
    const input = fixture(); input.crosswalk.push(malformed);
    assert.equal(status(input), 'missing_evidence', 'malformed crosswalk rows cannot disappear');
  }
  for (const malformed of [null, {}, {feed_id: 'other'}]) {
    const input = fixture(); input.candidates[0].operator_binding = malformed;
    assert.equal(status(input), 'missing_evidence', 'malformed operator evidence is not absent');
    input.candidates[0].eligibility = 'excluded';
    assert.equal(status(input), 'no_eligible_service', 'explicit exclusions still need no match-only fields');
  }
  const oversized = fixture();
  oversized.candidates[0].route_bindings.push({feed_id: 'other', source_sha256: sha, route_id: 'x'.repeat(1025), status: 'verified'});
  assert.equal(status(oversized), 'missing_evidence');
});

test('current conflicts outrank stale assertions whether grouped together or in separate candidates', () => {
  for (const grouped of [false, true]) for (const reverse of [false, true]) {
    const input = fixture();
    input.candidates[0].route_bindings[0].status = 'conflict';
    const other = grouped ? input.candidates[0] : structuredClone(input.candidates[0]);
    if (!grouped) { other.route_bindings = []; input.candidates.push(other); }
    other.operator_binding = {feed_id: 'feed', source_sha256: 'b'.repeat(64), agency_id: 'A', status: 'verified'};
    if (reverse) input.candidates.reverse();
    assert.equal(status(input), 'conflicting', `grouped=${grouped}/reverse=${reverse}`);
  }
});

test('current route, operator and station conflicts retain priority over grouped stale assertions', () => {
  for (const kind of ['route', 'operator', 'station']) for (const reverse of [false, true]) {
    const input = fixture(), candidate = input.candidates[0];
    if (kind === 'route') {
      candidate.route_bindings[0].status = 'conflict';
      candidate.route_bindings.push({...candidate.route_bindings[0], status: 'verified', source_sha256: 'b'.repeat(64)});
      if (reverse) candidate.route_bindings.reverse();
    } else if (kind === 'operator') {
      candidate.route_bindings[0].source_sha256 = 'b'.repeat(64);
      candidate.operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'conflict'};
      input.candidates.push(structuredClone(fixture().candidates[0]));
      if (reverse) input.candidates.reverse();
    } else {
      input.crosswalk[0].status = 'conflict';
      input.crosswalk.push({...input.crosswalk[0], status: 'verified', source_sha256: 'b'.repeat(64)});
      if (reverse) input.crosswalk.reverse();
    }
    const output = matchTimetablePattern(input);
    assert.equal(output.status, 'conflicting', `${kind}/${reverse}`);
    assert.equal(output.frequency_status, 'not_evaluated');
  }
});
