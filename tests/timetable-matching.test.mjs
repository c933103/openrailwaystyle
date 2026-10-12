import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {captureOsmServiceEvidence, matchTimetablePattern} from '../scripts/timetable-matching.mjs';
import {isSupportedTimetableTimezone, timezoneCatalog} from '../scripts/timetable-timezones.mjs';
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

test('resealed served members require the exact roles emitted by capture', () => {
  const allowed = ['stop', 'platform', 'stop_entry_only', 'stop_exit_only', 'platform_entry_only', 'platform_exit_only'];
  const rejected = ['', 'forward', 'backward', 'station', 'stop_entry', 'platform_exit', 'stop_entry_only_extra', 'STOP', 'stop\n', 'stop\0', ' platform'];
  for (const role of [...allowed, ...rejected]) for (const fallback of [false, true]) {
    const input = fixture(), osm = input.candidates[0].osm;
    if (fallback) {
      input.candidates[0].route_bindings = [];
      input.candidates[0].operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'verified'};
    }
    osm.served_members[0].role = role;
    const declaration = Object.fromEntries(['relation_id', 'version', 'timestamp', 'snapshot', 'tags', 'served_members', 'track_members'].map(key => [key, osm[key]]));
    osm.fingerprint = hash(declaration);
    const before = structuredClone(input), output = matchTimetablePattern(input);
    assert.equal(output.status, allowed.includes(role) ? 'verified' : 'missing_evidence', `${JSON.stringify(role)}/${fallback}`);
    if (!allowed.includes(role)) assert.deepEqual(output.reasons, ['invalid_service_members']);
    assert.equal(output.frequency_status, 'not_evaluated');
    assert.deepEqual(input, before, 'validation does not repair the resealed declaration');
  }
  const captured = captureOsmServiceEvidence(relation({members: [...allowed, ...rejected].map((role, index) => ({type: 'node', ref: index + 1, role}))}), snapshot);
  assert.deepEqual(captured.served_members.map(member => member.role), allowed);
});

test('resealed served-member positions preserve strict relation order without deduplicating identities', () => {
  for (const [positions, valid] of [[[0, 1], true], [[0, 9999], true], [[9998, 9999], true], [[0, 0], false], [[9999, 9999], false], [[2, 0], false], [[-1, 2], false], [[0, 10000], false], [[0, 1.5], false]]) for (const fallback of [false, true]) {
    const input = fixture(), osm = input.candidates[0].osm;
    if (fallback) {
      input.candidates[0].route_bindings = [];
      input.candidates[0].operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'verified'};
    }
    osm.served_members.forEach((member, index) => { member.position = positions[index]; });
    osm.fingerprint = hash(Object.fromEntries(['relation_id', 'version', 'timestamp', 'snapshot', 'tags', 'served_members', 'track_members'].map(key => [key, osm[key]])));
    const before = structuredClone(input), output = matchTimetablePattern(input);
    assert.equal(output.status, valid ? 'verified' : 'missing_evidence', `${positions}/${fallback}`);
    if (!valid) assert.deepEqual(output.reasons, ['invalid_service_members']);
    assert.deepEqual(input, before, 'validation never sorts or repairs positions');
  }
  const input = fixture(), osm = input.candidates[0].osm;
  osm.served_members.reverse();
  osm.fingerprint = hash(Object.fromEntries(['relation_id', 'version', 'timestamp', 'snapshot', 'tags', 'served_members', 'track_members'].map(key => [key, osm[key]])));
  assert.equal(status(input), 'missing_evidence', 'swapping records cannot preserve a captured member sequence');
  const repeated = fixture();
  repeated.candidates[0].osm = captureOsmServiceEvidence(relation({members: [...relation().members, {type: 'node', ref: 1, role: 'stop'}]}), snapshot);
  assert.deepEqual(repeated.candidates[0].osm.served_members.map(member => [member.id, member.position]), [['node:1', 0], ['node:2', 2], ['node:1', 3]]);
  assert.equal(status(repeated), 'verified', 'a station identity may genuinely recur at another relation position');
});

test('resealed track members retain collector uniqueness while raw repeated ways remain valid', () => {
  const input = fixture(), osm = input.candidates[0].osm;
  osm.track_members.push(100);
  osm.fingerprint = hash(Object.fromEntries(['relation_id', 'version', 'timestamp', 'snapshot', 'tags', 'served_members', 'track_members'].map(key => [key, osm[key]])));
  const before = structuredClone(input), output = matchTimetablePattern(input);
  assert.equal(output.status, 'missing_evidence');
  assert.deepEqual(output.reasons, ['invalid_service_members']);
  assert.deepEqual(input, before);
  const repeated = fixture();
  repeated.candidates[0].osm = captureOsmServiceEvidence(relation({members: [...relation().members, {type: 'way', ref: 100, role: ''}]}), snapshot);
  assert.deepEqual(repeated.candidates[0].osm.track_members, [100]);
  assert.equal(status(repeated), 'verified');
});

test('resealed served and track members share the raw relation-member cap', () => {
  const input = fixture(), tracks = Array.from({length: 9998}, (_, index) => ({type: 'way', ref: index + 100, role: ''}));
  input.candidates[0].osm = captureOsmServiceEvidence(relation({members: [{type: 'node', ref: 1, role: 'stop'}, ...tracks, {type: 'node', ref: 2, role: 'stop'}]}), snapshot);
  const osm = input.candidates[0].osm;
  assert.equal(osm.served_members.length + osm.track_members.length, 10000);
  assert.equal(status(input), 'verified', 'the complete 10,000-member captured boundary remains valid');
  osm.track_members.push(20000);
  osm.fingerprint = hash(Object.fromEntries(['relation_id', 'version', 'timestamp', 'snapshot', 'tags', 'served_members', 'track_members'].map(key => [key, osm[key]])));
  const before = structuredClone(input), output = matchTimetablePattern(input);
  assert.equal(output.status, 'missing_evidence', 'individually bounded sections cannot represent 10,001 distinct raw slots');
  assert.deepEqual(output.reasons, ['invalid_service_sections']);
  assert.deepEqual(input, before);
});

test('resealed active service dates preserve the collector reference window and strict order', () => {
  const shift = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  for (const reference of ['2026-10-05', '2024-03-01', '0042-03-01']) {
    const oldest = shift(reference, -366), previous = shift(reference, -1);
    const cases = [
      [[], true], [[reference], true], [[oldest, previous, reference], true],
      [Array.from({length: 367}, (_, index) => shift(reference, index - 366)), true],
      [[reference, reference], false], [[reference, previous], false],
      [[shift(reference, 1)], false], [[shift(reference, -367)], false],
      [['9999-12-31'], false],
    ];
    for (const [dates, valid] of cases) for (const placement of ['selected', 'other', 'expired-other']) {
      const input = fixture();
      input.evidence.source.service_date = reference; input.context.service_date = reference;
      input.evidence.observations[0].active_service_dates = [reference];
      if (placement !== 'selected') addOtherSourcePattern(input);
      const row = input.evidence.observations[placement === 'selected' ? 0 : 1];
      row.active_service_dates = [...dates];
      if (placement === 'expired-other') { row.calendar_state = 'expired'; row.valid_until = input.now - 1; }
      sealObservations(input);
      const before = structuredClone(input), output = matchTimetablePattern(input);
      const consistent = placement !== 'expired-other' || !dates.includes(reference);
      assert.equal(output.status, valid && consistent ? 'verified' : 'missing_evidence', `${reference}/${JSON.stringify(dates)}/${placement}`);
      if (valid && !consistent) assert.deepEqual(output.reasons, ['invalid_observation_validity']);
      if (!valid) assert.deepEqual(output.reasons, ['invalid_observation_schema']);
      assert.equal(output.frequency_status, 'not_evaluated');
      assert.deepEqual(input, before, 'date validation neither reorders nor drops observations');
    }
  }
});


test('resealed observation validity cannot exceed the complete source validity', () => {
  const revived = fixture(); addOtherSourcePattern(revived);
  Object.assign(revived.evidence.observations[0], {calendar_state: 'expired', valid_until: revived.now - 1, active_service_dates: ['2026-10-04']});
  sealObservations(revived);
  assert.equal(status(revived), 'stale', 'another current route cannot revive the expired target');
  Object.assign(revived.evidence.observations[0], {calendar_state: 'current', valid_until: revived.evidence.source.valid_until + 1});
  sealObservations(revived);
  assert.deepEqual(matchTimetablePattern(revived).reasons, ['invalid_observation_validity']);
  for (const placement of ['selected', 'other', 'expired-other']) for (const reverse of [false, true]) {
    const input = addOtherSourcePattern(fixture());
    const row = input.evidence.observations[placement === 'selected' ? 0 : 1];
    if (placement === 'expired-other') { row.calendar_state = 'expired'; row.active_service_dates = []; }
    for (const delta of [-1, 0, 0.001, 1, 1e9]) {
      row.valid_until = input.evidence.source.valid_until + delta;
      sealObservations(input);
      if (reverse) input.evidence.observations.reverse();
      const before = structuredClone(input), output = matchTimetablePattern(input);
      assert.equal(output.status, delta <= 0 ? 'verified' : 'missing_evidence', `${placement}/${delta}/${reverse}`);
      if (delta > 0) assert.deepEqual(output.reasons, ['invalid_observation_validity']);
      assert.deepEqual(input, before);
      if (reverse) input.evidence.observations.reverse();
    }
  }
});

test('resealed observation calendar states retain collector reference-day consistency', () => {
  const cases = [
    ['current', 2000000000, [], true],
    ['future', 2000000000, [], true],
    ['expired', 0, [], true],
    ['expired', 1791000000, ['2026-10-04'], true],
    ['future', 2000000000, ['2026-10-04'], false],
    ['expired', 1791000000, ['2026-10-05'], false],
    ['current', 0, [], false],
    ['future', 0, [], false],
    ['expired', 0, ['2026-10-04'], false],
  ];
  for (const [state, until, dates, valid] of cases) {
    const input = fixture(); addOtherSourcePattern(input);
    Object.assign(input.evidence.observations[1], {calendar_state: state, valid_until: until, active_service_dates: dates});
    sealObservations(input);
    const before = structuredClone(input), output = matchTimetablePattern(input);
    assert.equal(output.status, valid ? 'verified' : 'missing_evidence', `${state}/${until}/${dates}`);
    if (!valid) assert.deepEqual(output.reasons, ['invalid_observation_validity']);
    assert.deepEqual(input, before);
  }
});

test('collector historical, overnight and DST observations preserve validity and state semantics', () => {
  const run = spawnSync('python3', ['-c', `
import sys, json, zipfile, datetime as dt
from zoneinfo import ZoneInfo
sys.path.insert(0, 'tests')
import gtfs_frequency_test as f
case = f.GTFSFrequency()
results = []
try:
    for reference in ['1950-10-05', '2024-03-31', '2024-10-27', '2026-10-05']:
        date = dt.date.fromisoformat(reference)
        previous, following = date - dt.timedelta(days=1), date + dt.timedelta(days=1)
        compact = lambda day: day.isoformat().replace('-', '')
        kinds = ['current', 'overnight', 'expired', 'future', 'missing', 'inactive']
        patterns = {kind: [('A', '25:00:00' if kind == 'overnight' else '08:00:00'), ('B', '25:10:00' if kind == 'overnight' else '08:10:00')] for kind in kinds}
        path = case.feed(kinds, patterns)
        with zipfile.ZipFile(path) as z:
            files = {name: z.read(name) for name in z.namelist() if name != 'feed_info.txt'}
        files['trips.txt'] = ('trip_id,route_id,service_id,direction_id,shape_id\\n' + ''.join(f"{kind},R,{'overnight' if kind == 'expired' else kind},0,{kind}\\n" for kind in kinds)).encode()
        bounds = {'current': (previous, following), 'overnight': (previous, previous), 'expired': (previous, previous), 'future': (following, following), 'inactive': (previous, following)}
        files['calendar.txt'] = ('service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\\n' + ''.join(f'{kind},1,1,1,1,1,1,1,{compact(start)},{compact(end)}\\n' for kind, (start, end) in bounds.items())).encode()
        files['calendar_dates.txt'] = ('service_id,date,exception_type\\n' + f'missing,{compact(date)},2\\n' + ''.join(f'inactive,{compact(date-dt.timedelta(days=days))},2\\n' for days in range(4))).encode()
        with zipfile.ZipFile(path, 'w') as z:
            for name, data in files.items(): z.writestr(name, data)
        compiled = f.compiler.compile_feed(path, f.CONFIG, reference, matching_evidence=True)
        results.append({'evidence': compiled['matching_evidence'], 'now': f.compiler.service_start(date, ZoneInfo('Europe/Helsinki'))})
    print(json.dumps(results))
finally:
    case.doCleanups()
`], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  for (const {evidence, now} of JSON.parse(run.stdout)) {
    assert.equal(evidence.status, 'captured');
    const observations = Object.fromEntries(evidence.observations.map(row => [row.trip_id, row]));
    assert.equal(evidence.source.valid_until, Math.max(0, ...evidence.observations.map(row => row.valid_until)));
    for (const row of evidence.observations) assert.ok(row.valid_until <= evidence.source.valid_until);
    assert.equal(observations.overnight.calendar_state, 'current');
    assert.equal(observations.expired.calendar_state, 'expired');
    assert.equal(observations.expired.service_id, observations.overnight.service_id);
    assert.deepEqual(observations.expired.active_service_dates, observations.overnight.active_service_dates, 'same calendar retains dates despite different overnight expiry');
    assert.equal(observations.future.calendar_state, 'future');
    assert.equal(observations.missing.valid_until, 0);
    assert.equal(observations.missing.calendar_state, 'expired');
    assert.deepEqual(observations.missing.active_service_dates, []);
    assert.deepEqual(observations.future.active_service_dates, []);
    assert.deepEqual(observations.inactive.active_service_dates, []);
    assert.equal(observations.inactive.calendar_state, 'current');
    for (const trip of ['current', 'overnight', 'inactive', 'expired', 'future', 'missing']) {
      const input = fixture(), observed = observations[trip], snap = new Date(now * 1000).toISOString();
      const bound = {feed_id: evidence.source.feed_id, source_sha256: evidence.source.sha256, status: 'verified'};
      input.evidence = structuredClone(evidence); input.pattern_id = observed.pattern_id; input.now = now;
      Object.assign(input.context, {feed_id: bound.feed_id, source_sha256: bound.source_sha256, service_date: evidence.source.service_date, osm_snapshot: snap});
      input.candidates[0].osm = captureOsmServiceEvidence(relation({timestamp: snap}), snap);
      input.candidates[0].route_bindings = [{...bound, route_id: 'R'}];
      input.crosswalk = ['A', 'B'].map((station_id, i) => ({...bound, station_id, osm_station_id: `node:${i+1}`, osm_snapshot: snap}));
      const before = structuredClone(input), output = matchTimetablePattern(input);
      const expected = ['expired', 'missing'].includes(trip) ? 'stale' : trip === 'future' ? 'missing_evidence' : now > observed.valid_until ? 'stale' : 'verified';
      assert.equal(output.status, expected, `${evidence.source.service_date}/${trip}`);
      assert.deepEqual(input, before);
    }
  }
});


test('resealed observation timezones require supported case-sensitive IANA names', () => {
  assert.equal(timezoneCatalog.names, 598);
  assert.equal(timezoneCatalog.iana_version, '2026d');
  assert.equal(isSupportedTimetableTimezone('UTC'), true);
  const valid = ['Europe/Helsinki', 'America/New_York', 'Asia/Kathmandu', 'Pacific/Chatham', 'UTC', 'Etc/UTC', 'US/Eastern', 'Etc/GMT+12', 'GMT0', 'EST5EDT'];
  const invalid = ['Not/AZone', 'Europe/Not_A_Zone', '+02:00', '-0130', 'europe/helsinki', 'utc', ' UTC', 'UTC\n', '../UTC', '/etc/localtime', 'localtime', 'posix/Europe/Helsinki', 'z'.repeat(1024)];
  for (const timezone of [...valid, ...invalid]) for (const placement of ['selected', 'other', 'expired-other']) {
    const input = fixture();
    if (placement !== 'selected') addOtherSourcePattern(input);
    // This test isolates zone names; a genuinely different agency may use
    // another zone. Same-agency consistency has its own regression below.
    if (placement !== 'selected') changeOtherAgency(input, 'other-agency');
    const row = input.evidence.observations[placement === 'selected' ? 0 : 1];
    row.timezone = timezone;
    if (placement === 'expired-other') Object.assign(row, {calendar_state: 'expired', valid_until: 0, active_service_dates: []});
    sealObservations(input);
    const before = structuredClone(input), output = matchTimetablePattern(input);
    assert.equal(output.status, valid.includes(timezone) ? 'verified' : 'missing_evidence', `${timezone}/${placement}`);
    if (!valid.includes(timezone)) assert.deepEqual(output.reasons, ['unsupported_observation_timezone']);
    assert.deepEqual(input, before);
  }
  const run = spawnSync('python3', ['-c', 'import json,sys;from zoneinfo import ZoneInfo;[ZoneInfo(z) for z in json.load(sys.stdin)]'], {input: JSON.stringify(valid), encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
});

function changeOtherAgency(input, agency) {
  const pattern = input.evidence.patterns[1], previous = pattern.id;
  pattern.agency_id = agency;
  pattern.source_route_id = `route-${agency}`;
  pattern.compiled_route_id = pattern.source_route_id;
  const {id, ...definition} = pattern;
  pattern.id = hash([input.evidence.source.feed_id, input.evidence.source.sha256, definition]);
  for (const row of input.evidence.observations) if (row.pattern_id === previous) row.pattern_id = pattern.id;
  return sealObservations(input);
}

test('one captured agency cannot claim different observation timezones', () => {
  for (const reverse of [false, true]) {
    const input = addOtherSourcePattern(fixture());
    input.evidence.observations[1].timezone = 'America/New_York'; sealObservations(input);
    if (reverse) input.evidence.observations.reverse();
    assert.deepEqual(matchTimetablePattern(input).reasons, ['inconsistent_agency_timezone']);
    if (reverse) input.evidence.observations.reverse();
    changeOtherAgency(input, 'other-agency');
    assert.equal(status(input), 'verified', 'separate agencies can retain distinct timezones');
  }
});

test('one captured service calendar has consistent active dates across trips', () => {
  for (const reverse of [false, true]) {
    const input = addOtherSourcePattern(fixture());
    input.evidence.observations[1].service_id = input.evidence.observations[0].service_id;
    input.evidence.observations[1].active_service_dates = []; sealObservations(input);
    if (reverse) input.evidence.observations.reverse();
    assert.deepEqual(matchTimetablePattern(input).reasons, ['inconsistent_service_dates']);
    if (reverse) input.evidence.observations.reverse();
    input.evidence.observations[1].service_id = 'another-calendar'; sealObservations(input);
    assert.equal(status(input), 'verified', 'different service calendars can retain different dates');
  }
});

test('source validity retains the collector maximum and historical zero floor', () => {
  const input = fixture(); input.evidence.source.valid_until++;
  assert.deepEqual(matchTimetablePattern(input).reasons, ['source_validity_mismatch']);
  input.evidence.source.valid_until -= 2;
  assert.deepEqual(matchTimetablePattern(input).reasons, ['invalid_observation_validity']);
  const ordinary = addOtherSourcePattern(fixture()); ordinary.evidence.observations[0].valid_until--;
  sealObservations(ordinary);
  assert.equal(status(ordinary), 'verified', 'the maximum may belong to a different pattern');
});


function resealPattern(input, index) {
  const pattern = input.evidence.patterns[index], previous = pattern.id;
  const {id, ...definition} = pattern;
  pattern.id = hash([input.evidence.source.feed_id, input.evidence.source.sha256, definition]);
  if (input.pattern_id === previous) input.pattern_id = pattern.id;
  for (const row of input.evidence.observations) if (row.pattern_id === previous) row.pattern_id = pattern.id;
  return sealObservations(input);
}

test('one source route retains stable agency reference and compiled identity', () => {
  for (const field of ['agency_id', 'route_ref', 'compiled_route_id']) for (const selected of [true, false]) for (const reverse of [false, true]) {
    const input = addOtherSourcePattern(fixture()), index = selected ? 0 : 1;
    input.evidence.patterns[index][field] = field === 'agency_id' ? 'B' : 'Q';
    resealPattern(input, index);
    // Supply an otherwise successful operator/ref path for the altered selected
    // route; an unselected genuine route declaration must still block it.
    const target = input.evidence.patterns[0];
    input.candidates[0].route_bindings = [];
    input.candidates[0].operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: target.agency_id, status: 'verified'};
    input.candidates[0].osm = captureOsmServiceEvidence(relation({tags: {route: 'train', ref: target.route_ref}}), snapshot);
    if (reverse) input.evidence.patterns.reverse();
    const before = structuredClone(input), output = matchTimetablePattern(input);
    assert.deepEqual(output.reasons, ['inconsistent_source_route'], `${field}/${selected}/${reverse}`);
    assert.deepEqual(input, before);
  }
});

test('canonical aliases agree on known Python-stripped refs without guessing missing labels', () => {
  const python = spawnSync('python3', ['-c', 'import json; print(json.dumps([chr(i) for i in range(0x110000) if chr(i).isspace()]))'], {encoding: 'utf8'});
  assert.equal(python.status, 0, python.stderr);
  const spaces = JSON.parse(python.stdout); assert.equal(spaces.length, 29);
  const pairs = [
    ['R', 'Q', false], ['R', ' R ', true], ['R', null, true], [null, 'R', true],
    ['R', ' ', true], [null, null, true], ['R', 'r', false], ['R S', 'R  S', false],
    ['R', '\ufeffR\ufeff', false], ['R', '\u200bR\u200b', false],
    ...spaces.map(space => ['R', `${space}R${space}`, true]),
    ...spaces.map(space => ['R', space, true]),
  ];
  for (const [first, second, valid] of pairs) for (const reverse of [false, true]) {
    const input = addOtherSourcePattern(fixture());
    input.evidence.patterns[0].route_ref = first;
    Object.assign(input.evidence.patterns[1], {source_route_id: 'other', route_ref: second});
    for (let i = 0; i < 2; i++) resealPattern(input, i);
    if (reverse) { input.evidence.patterns.reverse(); input.evidence.observations.reverse(); }
    const before = structuredClone(input), output = matchTimetablePattern(input);
    assert.equal(output.status, valid ? 'verified' : 'missing_evidence', `${JSON.stringify([first, second])}/${reverse}`);
    if (!valid) assert.deepEqual(output.reasons, ['inconsistent_compiled_ref']);
    assert.deepEqual(input, before, 'normalization compares grouping keys without changing raw evidence');
  }
  const separate = addOtherSourcePattern(fixture());
  Object.assign(separate.evidence.patterns[1], {source_route_id: 'other', compiled_route_id: 'other', route_ref: 'Q'}); resealPattern(separate, 1);
  assert.equal(status(separate), 'verified', 'different components retain different refs');
});

test('actual collector preserves blank-label fallback and exact Python reference grouping', () => {
  const run = spawnSync('python3', ['-c', `
import sys,json,zipfile,csv,io
sys.path.insert(0,'tests')
import gtfs_frequency_test as f
cases=[('same',' R ','R','',True),('python-space','\\x1c\\x85R\\x85\\x1f','R','',True),
       ('blank-fallback','','R','R',True),('space-fallback','   ','R','R',True),
       ('both-blank','','','Shared',True),('different','R','Q','',False),
       ('bom','R','\\ufeffR\\ufeff','',False),('zero-width','R','\\u200bR\\u200b','',False),
       ('case','R','r','',False),('interior','R S','R  S','',False)]
output=[]
for label,a,b,long_name,merged in cases:
    case=f.GTFSFrequency()
    try:
        patterns={'one':[('A','08:00:00'),('B','08:10:00')], 'two':[('A','08:00:00'),('B','08:10:00')]}
        path=case.feed(patterns,patterns)
        with zipfile.ZipFile(path) as z: files={name:z.read(name) for name in z.namelist()}
        buffer=io.StringIO();writer=csv.writer(buffer)
        writer.writerow(['route_id','route_type','agency_id','route_short_name','route_long_name'])
        writer.writerows([['a','1','A',a,long_name],['b','1','A',b,long_name]])
        files['routes.txt']=buffer.getvalue().encode()
        files['trips.txt']=b'trip_id,route_id,service_id,direction_id\\none,a,W,0\\ntwo,b,W,0\\n'
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items(): z.writestr(name,data)
        evidence=f.compiler.compile_feed(path,{**f.CONFIG,'canonical_routes':True},'2026-10-05',matching_evidence=True)['matching_evidence']
        output.append([label,merged,evidence])
    finally: case.doCleanups()
print(json.dumps(output))
`], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  for (const [label, merged, evidence] of JSON.parse(run.stdout)) {
    assert.equal(evidence.status, 'captured', label);
    assert.deepEqual(new Set(evidence.patterns.map(p => p.compiled_route_id)), new Set(merged ? ['a'] : ['a', 'b']), label);
    const input = fixture(), selected = evidence.patterns.find(p => p.source_route_id === 'a');
    const bound = {feed_id: evidence.source.feed_id, source_sha256: evidence.source.sha256, status: 'verified'};
    input.evidence = evidence; input.pattern_id = selected.id;
    Object.assign(input.context, {feed_id: bound.feed_id, source_sha256: bound.source_sha256});
    input.candidates[0].route_bindings = [{...bound, route_id: 'a'}];
    input.crosswalk = ['A', 'B'].map((station_id, i) => ({...bound, station_id, osm_station_id: `node:${i + 1}`, osm_snapshot: snapshot}));
    assert.equal(status(input), 'verified', label);
    if (!merged) {
      for (let i = 0; i < evidence.patterns.length; i++) { evidence.patterns[i].compiled_route_id = 'a'; resealPattern(input, i); }
      assert.deepEqual(matchTimetablePattern(input).reasons, ['inconsistent_compiled_ref'], label);
      evidence.patterns.reverse(); evidence.observations.reverse();
      assert.deepEqual(matchTimetablePattern(input).reasons, ['inconsistent_compiled_ref'], `${label}/reverse`);
    }
  }
});

test('one source stop retains one station parent within loops and across patterns', () => {
  for (const placement of ['loop', 'other']) for (const reverse of [false, true]) {
    const input = fixture();
    if (placement === 'other') addOtherSourcePattern(input);
    input.evidence.patterns[0].calls[0] = {stop_id: 'a', station_id: 'p', pickup_type: '0', drop_off_type: '0'};
    if (placement === 'loop') input.evidence.patterns[0].calls[1] = {stop_id: 'a', station_id: 'q', pickup_type: '0', drop_off_type: '0'};
    else input.evidence.patterns[1].calls[0].station_id = 'q';
    for (let i = 0; i < input.evidence.patterns.length; i++) resealPattern(input, i);
    input.crosswalk[0].station_id = 'p';
    if (placement === 'loop') input.crosswalk[1].station_id = 'q';
    if (reverse) input.evidence.patterns.reverse();
    const before = structuredClone(input), output = matchTimetablePattern(input);
    assert.deepEqual(output.reasons, ['inconsistent_stop_parent'], `${placement}/${reverse}`);
    assert.deepEqual(input, before);
  }
});

test('a captured station parent remains a root when also called as a stop', () => {
  for (const cycle of [false, true]) {
    const input = fixture();
    Object.assign(input.evidence.patterns[0].calls[0], {stop_id: 'a', station_id: 'b'});
    Object.assign(input.evidence.patterns[0].calls[1], {stop_id: 'b', station_id: cycle ? 'a' : 'c'});
    resealPattern(input, 0);
    input.crosswalk[0].station_id = 'b'; input.crosswalk[1].station_id = cycle ? 'a' : 'c';
    assert.deepEqual(matchTimetablePattern(input).reasons, ['nested_station_parent']);
  }
});

test('canonical route identities cannot mix agencies or form alias chains', () => {
  for (const kind of ['agency', 'chain', 'cycle']) {
    const input = addOtherSourcePattern(fixture()), other = input.evidence.patterns[1];
    other.source_route_id = 'other';
    if (kind === 'agency') other.agency_id = 'B';
    else {
      input.evidence.patterns[0].compiled_route_id = 'other';
      other.compiled_route_id = kind === 'chain' ? 'third' : 'R';
      resealPattern(input, 0);
    }
    resealPattern(input, 1);
    assert.deepEqual(matchTimetablePattern(input).reasons, [kind === 'agency' ? 'inconsistent_compiled_agency' : 'noncanonical_route_alias'], kind);
  }
});

test('legitimate platform loops root calls and canonical aliases remain distinct', () => {
  const input = fixture(), pattern = input.evidence.patterns[0];
  pattern.calls = [
    {stop_id: 'a', station_id: 'p', pickup_type: '0', drop_off_type: '1'},
    {stop_id: 'p', station_id: 'p', pickup_type: '1', drop_off_type: '0'},
    {stop_id: 'a', station_id: 'p', pickup_type: '0', drop_off_type: '0'},
    {stop_id: 'b', station_id: 'b', pickup_type: '0', drop_off_type: '0'},
  ];
  input.evidence.observations[0].departures = [0, 0, 600, 1200]; resealPattern(input, 0);
  input.candidates[0].osm = captureOsmServiceEvidence(relation({members: [{type: 'node', ref: 1, role: 'stop'}, {type: 'node', ref: 1, role: 'stop'}, {type: 'node', ref: 1, role: 'stop'}, {type: 'node', ref: 2, role: 'stop'}, {type: 'way', ref: 100, role: ''}]}), snapshot);
  input.candidates[0].variants[0].stations = ['node:1', 'node:1', 'node:1', 'node:2'];
  input.crosswalk[0].station_id = 'p';
  addOtherSourcePattern(input);
  input.evidence.patterns[1].source_route_id = 'other';
  input.evidence.patterns[1].route_ref = ' R ';
  input.evidence.patterns[1].direction_id = '1';
  input.evidence.patterns[1].shape_id = 'branch';
  resealPattern(input, 1);
  const before = structuredClone(input);
  assert.equal(status(input), 'verified', 'source aliases can retain different raw refs, directions and shapes');
  assert.deepEqual(input, before, 'repeated served stations are not deduplicated');
  input.evidence.patterns.reverse(); input.evidence.observations.reverse();
  assert.equal(status(input), 'verified');
});


test('actual collector canonical aliases preserve platform loops and root station calls', () => {
  const run = spawnSync('python3', ['-c', `
import sys,json,zipfile
sys.path.insert(0,'tests')
import gtfs_frequency_test as f
case=f.GTFSFrequency()
try:
    patterns={'loop':[('A','08:00:00'),('B','08:10:00'),('A','08:20:00')], 'root':[('P','09:00:00'),('B','09:10:00')]}
    path=case.feed(patterns,patterns)
    with zipfile.ZipFile(path) as z: files={name:z.read(name) for name in z.namelist()}
    files['routes.txt']=b'route_id,route_type,agency_id,route_short_name\\n0,1,A,R\\na,1,A, R \\nb,1,A,R\\n'
    files['trips.txt']=b'trip_id,route_id,service_id,direction_id\\nloop,a,W,0\\nroot,b,W,1\\n'
    files['stops.txt']=b'stop_id,stop_name,stop_lat,stop_lon,parent_station\\nA,Platform,60,24,P\\nB,Station B,60.01,24,\\nP,Root station,60,24,\\n'
    with zipfile.ZipFile(path,'w') as z:
        for name,data in files.items(): z.writestr(name,data)
    print(json.dumps(f.compiler.compile_feed(path,{**f.CONFIG,'canonical_routes':True},'2026-10-05',matching_evidence=True)['matching_evidence']))
finally: case.doCleanups()
`], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  const evidence = JSON.parse(run.stdout);
  assert.equal(evidence.status, 'captured');
  assert.deepEqual(new Set(evidence.patterns.map(p => p.compiled_route_id)), new Set(['a']));
  assert.deepEqual(new Set(evidence.patterns.map(p => p.source_route_id)), new Set(['a', 'b']));
  assert.deepEqual(new Set(evidence.patterns.map(p => p.route_ref)), new Set([' R ', 'R']));
  const input = fixture(), selected = evidence.patterns.find(p => p.source_route_id === 'a');
  const bound = {feed_id: evidence.source.feed_id, source_sha256: evidence.source.sha256, status: 'verified'};
  input.evidence = evidence; input.pattern_id = selected.id;
  Object.assign(input.context, {feed_id: bound.feed_id, source_sha256: bound.source_sha256});
  input.candidates[0].route_bindings = [{...bound, route_id: 'a'}];
  input.candidates[0].osm = captureOsmServiceEvidence(relation({members: [{type: 'node', ref: 1, role: 'stop'}, {type: 'way', ref: 100, role: ''}, {type: 'node', ref: 2, role: 'stop'}, {type: 'node', ref: 1, role: 'stop'}]}), snapshot);
  input.candidates[0].variants[0].stations = ['node:1', 'node:2', 'node:1'];
  input.crosswalk = ['P', 'B'].map((station_id, i) => ({...bound, station_id, osm_station_id: `node:${i + 1}`, osm_snapshot: snapshot}));
  const before = structuredClone(input);
  assert.equal(status(input), 'verified'); assert.deepEqual(input, before);
  input.evidence.patterns.reverse(); input.evidence.observations.reverse();
  assert.equal(status(input), 'verified');
});


test('every compiled target is itself a captured source route', () => {
  for (const other of [false, true]) {
    const input = other ? addOtherSourcePattern(fixture()) : fixture();
    for (let i = 0; i < input.evidence.patterns.length; i++) {
      input.evidence.patterns[i].compiled_route_id = 'ghost'; resealPattern(input, i);
    }
    assert.deepEqual(matchTimetablePattern(input).reasons, ['missing_canonical_route']);
  }
});

test('non-expired observations sharing a calendar cannot mix current and future state', () => {
  for (const reverse of [false, true]) for (const futureIndex of [0, 1]) {
    const input = addOtherSourcePattern(fixture());
    for (const row of input.evidence.observations) { row.service_id = 'W'; row.active_service_dates = []; }
    input.evidence.observations[futureIndex].calendar_state = 'future';
    input.pattern_id = input.evidence.observations[1-futureIndex].pattern_id;
    sealObservations(input);
    if (reverse) input.evidence.observations.reverse();
    const before = structuredClone(input);
    assert.deepEqual(matchTimetablePattern(input).reasons, ['inconsistent_service_future_state']);
    assert.deepEqual(input, before);
  }
});

test('collector expired precedence preserves a future calendar at an overnight feed boundary', () => {
  const run = spawnSync('python3', ['-c', `
import sys,json,zipfile,datetime as dt
from zoneinfo import ZoneInfo
sys.path.insert(0,'tests')
import gtfs_frequency_test as f
case=f.GTFSFrequency()
try:
    patterns={'current':[('A','25:00:00'),('B','25:10:00')], 'future':[('A','25:00:00'),('B','25:10:00')], 'expired':[('A','08:00:00'),('B','08:10:00')]}
    path=case.feed(patterns,patterns)
    with zipfile.ZipFile(path) as z: files={name:z.read(name) for name in z.namelist()}
    files['feed_info.txt']=b'feed_start_date,feed_end_date\\n20260101,20261004\\n'
    files['calendar.txt']=b'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\\nNOW,1,1,1,1,1,1,1,20260101,20261231\\nLATER,1,1,1,1,1,1,1,20261006,20261231\\n'
    files['trips.txt']=b'trip_id,route_id,service_id,direction_id,shape_id\\ncurrent,R,NOW,0,current\\nfuture,R,LATER,0,future\\nexpired,R,LATER,0,expired\\n'
    with zipfile.ZipFile(path,'w') as z:
        for name,data in files.items():z.writestr(name,data)
    evidence=f.compiler.compile_feed(path,f.CONFIG,'2026-10-05',matching_evidence=True)['matching_evidence']
    print(json.dumps({'evidence':evidence,'now':f.compiler.service_start(dt.date(2026,10,5),ZoneInfo('Europe/Helsinki'))}))
finally:case.doCleanups()
`], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  const {evidence, now} = JSON.parse(run.stdout), observations = Object.fromEntries(evidence.observations.map(row => [row.trip_id, row]));
  assert.equal(evidence.status, 'captured');
  assert.equal(observations.future.service_id, observations.expired.service_id);
  assert.equal(observations.future.calendar_state, 'future');
  assert.equal(observations.expired.calendar_state, 'expired');
  assert.deepEqual(observations.future.active_service_dates, []);
  assert.deepEqual(observations.expired.active_service_dates, []);
  const input = fixture(), snap = new Date(now * 1000).toISOString();
  const bound = {feed_id: evidence.source.feed_id, source_sha256: evidence.source.sha256, status: 'verified'};
  input.evidence = evidence; input.pattern_id = observations.current.pattern_id; input.now = now;
  Object.assign(input.context, {feed_id: bound.feed_id, source_sha256: bound.source_sha256, osm_snapshot: snap});
  input.candidates[0].route_bindings = [{...bound, route_id: 'R'}];
  input.candidates[0].osm = captureOsmServiceEvidence(relation({timestamp: snap}), snap);
  input.crosswalk = ['A', 'B'].map((station_id, i) => ({...bound, station_id, osm_station_id: `node:${i+1}`, osm_snapshot: snap}));
  assert.equal(status(input), 'verified', 'expired takes precedence and does not expose the shared future flag');
  input.evidence.observations.reverse();
  assert.equal(status(input), 'verified');
});


test('one service calendar retains a shared end boundary and missing-end marker', () => {
  for (const kind of ['different-boundary', 'missing-end']) for (const reverse of [false, true]) {
    const input = addOtherSourcePattern(fixture());
    for (const row of input.evidence.observations) { row.service_id = 'W'; row.active_service_dates = []; }
    if (kind === 'different-boundary') { input.evidence.observations[0].valid_until += 86400; input.evidence.source.valid_until += 86400; }
    else Object.assign(input.evidence.observations[1], {calendar_state: 'expired', valid_until: 0});
    sealObservations(input); if (reverse) input.evidence.observations.reverse();
    assert.deepEqual(matchTimetablePattern(input).reasons, ['inconsistent_service_end'], `${kind}/${reverse}`);
  }
});

test('shared-calendar expiry state follows increasing trip extent day buckets', () => {
  for (const otherDays of [0, 2]) {
    const input = addOtherSourcePattern(fixture());
    for (const row of input.evidence.observations) { row.service_id = 'W'; row.active_service_dates = []; }
    const current = input.evidence.observations[0], expired = input.evidence.observations[1];
    current.departures = [0, 90000];
    expired.departures = [0, otherDays * 86400 + 600]; expired.calendar_state = 'expired';
    const anchor = input.evidence.source.valid_until - 3 * 86400;
    current.valid_until = anchor + 90000; expired.valid_until = anchor + Math.max(86400, expired.departures[1]);
    input.evidence.source.valid_until = Math.max(current.valid_until, expired.valid_until); sealObservations(input);
    if (otherDays === 0) assert.equal(status(input), 'verified', 'short expired/long current is a valid boundary ordering');
    else assert.deepEqual(matchTimetablePattern(input).reasons, ['inconsistent_service_expiry_state']);
  }
  const equal = addOtherSourcePattern(fixture());
  for (const row of equal.evidence.observations) { row.service_id = 'W'; row.active_service_dates = []; }
  equal.evidence.observations[1].calendar_state = 'expired'; sealObservations(equal);
  assert.deepEqual(matchTimetablePattern(equal).reasons, ['inconsistent_service_expiry_state']);
});

test('canonical aliases choose the minimum captured root and stay station-connected', () => {
  for (const kind of ['nonminimum', 'disconnected']) {
    const input = addOtherSourcePattern(fixture()), other = input.evidence.patterns[1];
    other.source_route_id = 'other';
    if (kind === 'nonminimum') {
      input.evidence.patterns[0].compiled_route_id = 'other'; other.compiled_route_id = 'other'; resealPattern(input, 0);
    } else {
      other.calls = ['c', 'd'].map(stop_id => ({stop_id, station_id: stop_id, pickup_type: '0', drop_off_type: '0'}));
    }
    resealPattern(input, 1);
    assert.deepEqual(matchTimetablePattern(input).reasons, [kind === 'nonminimum' ? 'noncanonical_route_alias' : 'disconnected_canonical_routes']);
  }
});

test('captured UTF-8 identity strings preserve real Unicode and reject lone surrogates', () => {
  for (const [value, valid] of [['R🚆', true], ['𐀀', true], ['é', true], ['\ud800', false], ['\udfff', false], ['x\ud800y', false]]) {
    const input = fixture(); input.evidence.patterns[0].route_ref = value; resealPattern(input, 0);
    assert.equal(status(input), valid ? 'verified' : 'missing_evidence');
  }
});


test('canonical minimum follows Unicode code points rather than UTF-16 units', () => {
  const input = addOtherSourcePattern(fixture()), minimum = '\ue000', larger = '😀';
  input.evidence.patterns[0].source_route_id = minimum;
  input.evidence.patterns[1].source_route_id = larger;
  for (let index = 0; index < 2; index++) { input.evidence.patterns[index].compiled_route_id = minimum; resealPattern(input, index); }
  input.candidates[0].route_bindings[0].route_id = minimum;
  assert.equal(status(input), 'verified');
  for (let index = 0; index < 2; index++) { input.evidence.patterns[index].compiled_route_id = larger; resealPattern(input, index); }
  assert.deepEqual(matchTimetablePattern(input).reasons, ['noncanonical_route_alias']);
});

test('canonical connections include all calls and transitive route bridges', () => {
  const input = fixture();
  input.evidence.patterns[0].source_route_id = 'a'; input.evidence.patterns[0].compiled_route_id = 'a'; resealPattern(input, 0);
  input.candidates[0].route_bindings[0].route_id = 'a';
  for (const [source, stations] of [['b', ['b', 'c']], ['c', ['c', 'd']]]) {
    const pattern = {...structuredClone(input.evidence.patterns[0]), source_route_id: source, shape_id: source,
      calls: stations.map(stop_id => ({stop_id, station_id: stop_id, pickup_type: '1', drop_off_type: '1'}))};
    const {id, ...definition} = pattern; pattern.id = hash(['feed', sha, definition]); input.evidence.patterns.push(pattern);
    input.evidence.observations.push({...structuredClone(input.evidence.observations[0]), id: hash(['feed', sha, source]), trip_id: source, pattern_id: pattern.id});
  }
  sealObservations(input);
  const before = structuredClone(input);
  assert.equal(status(input), 'verified', 'the producer includes nonserved timepoints and transitive connections');
  assert.deepEqual(input, before);
  input.evidence.patterns.reverse(); input.evidence.observations.reverse(); assert.equal(status(input), 'verified');
});


test('resealed validity must already have exact millisecond precision', () => {
  for (const historical of [false, true]) for (const placement of ['selected', 'other']) for (const [fraction, valid] of [[0, true], [0.001, true], [0.002, true], [0.999, true], [0.0004, false], [0.0006, false], [0.0014, false], [0.9999, false]]) {
    const input = fixture(), base = historical ? -600000000 : 2000000000;
    if (historical) {
      const date = '1950-01-01', snap = `${date}T00:00:00Z`;
      input.evidence.source.service_date = date; input.context.service_date = date;
      input.context.osm_snapshot = snap; input.now = Date.parse(snap) / 1000;
      input.evidence.observations[0].active_service_dates = [date];
      input.candidates[0].osm = captureOsmServiceEvidence(relation({timestamp: snap}), snap);
      input.crosswalk.forEach(row => { row.osm_snapshot = snap; });
    }
    input.evidence.observations[0].valid_until = base;
    if (placement === 'other') addOtherSourcePattern(input);
    input.evidence.observations[placement === 'selected' ? 0 : 1].valid_until = base + fraction;
    input.evidence.source.valid_until = Math.max(0, ...input.evidence.observations.map(row => row.valid_until));
    sealObservations(input);
    const before = structuredClone(input), output = matchTimetablePattern(input);
    assert.equal(output.status, valid ? 'verified' : 'missing_evidence', `${historical}/${placement}/${fraction}`);
    if (!valid) assert.deepEqual(output.reasons, ['invalid_observation_validity']);
    assert.deepEqual(input, before, 'sub-millisecond evidence is not rounded or repaired');
  }
});

test('real collector boundary arithmetic round-trips at milliseconds across supported years', () => {
  const run = spawnSync('python3', ['-c', `
import sys,json,datetime as dt
from zoneinfo import ZoneInfo
sys.path.insert(0,'tests')
import gtfs_frequency_test as f
print(json.dumps([f.compiler.service_start(dt.date(year,12,30),ZoneInfo(zone))+extent-.001
    for year in [1,42,1950,2024,2038,9999]
    for zone in ['UTC','Europe/Helsinki','America/New_York','Pacific/Chatham']
    for extent in [86400,90600,365*86400]]))
`], {encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  const values = JSON.parse(run.stdout); assert.equal(values.length, 72);
  for (const value of values) {
    const milliseconds = Math.round(value * 1000);
    assert.equal(Number.isSafeInteger(milliseconds), true);
    assert.equal(milliseconds / 1000, value, String(value));
  }
});

test('raw OSM tags default only when absent and reject explicit malformed values', () => {
  const missing = relation(); delete missing.tags;
  for (const raw of [missing, relation({tags: {}}), relation({tags: Object.create(null)})]) {
    const captured = captureOsmServiceEvidence(raw, snapshot);
    assert.equal(captured.status, 'captured');
    const input = fixture(); input.candidates[0].osm = captured;
    assert.equal(status(input), 'verified', 'a reviewed exact route binding may coexist with genuinely absent tags');
  }
  for (const tags of [null, false, 0, '', undefined, NaN, [], 'not-tags', 1, true]) {
    const raw = relation({tags}), before = structuredClone(raw), captured = captureOsmServiceEvidence(raw, snapshot);
    assert.equal(captured.status, 'incomplete', `${String(tags)}/${typeof tags}`);
    assert.deepEqual(captured.reasons, ['invalid_tags']);
    assert.deepEqual(raw, before);
    const input = fixture(); input.candidates[0].osm = captured;
    assert.equal(status(input), 'missing_evidence', 'an exact binding cannot revive malformed capture');
  }
  const hidden = relation(); Object.defineProperty(hidden, 'tags', {value: null, enumerable: false});
  assert.equal(captureOsmServiceEvidence(hidden, snapshot).status, 'incomplete', 'a present hidden field is not silently replaced');
});

test('current matcher benchmark exercises controlled outcomes and records its own provenance', () => {
  const run = spawnSync(process.execPath, ['scripts/benchmark-timetable-matching.mjs', '--smoke'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 120000,
  });
  assert.equal(run.status, 0, run.stderr || String(run.error));
  const report = JSON.parse(run.stdout);
  assert.equal(report.schema, 1);
  assert.equal(report.synthetic, true);
  assert.equal(report.smoke, true);
  assert.equal(report.node, process.version);
  const sources = ['scripts/timetable-matching.mjs', 'scripts/timetable-timezones.mjs', 'scripts/benchmark-timetable-matching.mjs', 'scripts/gtfs-frequency.py', 'scripts/timetable_evidence.py', 'scripts/benchmark-timetable-evidence.py'];
  assert.deepEqual(Object.keys(report.source_sha256).sort(), [...sources].sort());
  for (const path of sources) {
    const actual = createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex');
    assert.equal(report.source_sha256[path], actual, `fresh report must identify its actual input: ${path}`);
  }
  assert.deepEqual([report.fixture.trips, report.fixture.calls, report.fixture.stop_rows, report.fixture.profiles, report.fixture.patterns, report.fixture.observations], [4, 3, 12, 28, 2, 4]);
  assert.match(report.fixture.sidecar_sha256, /^[a-f0-9]{64}$/);
  assert.ok(report.fixture.sidecar_bytes > 0 && report.fixture.sidecar_bytes < 32 * 1024 * 1024);
  assert.deepEqual(report.results.map(({repeat, mode, status, reason}) => [repeat, mode, status, reason]), [
    [0, 'verified', 'verified', 'reviewed_identity_and_stops'],
    [0, 'unbound', 'missing_evidence', 'missing_service_identity'],
    [0, 'source-limit', 'missing_evidence', 'source_work_limit'],
    [0, 'candidate-limit', 'missing_evidence', 'candidate_work_limit'],
  ]);
  for (const row of report.results) {
    assert.ok(Number.isFinite(row.milliseconds) && row.milliseconds >= 0);
    for (const field of ['rss_before_bytes', 'rss_after_bytes', 'peak_process_rss_kib']) assert.ok(Number.isSafeInteger(row[field]) && row[field] > 0, field);
  }
});

test('matcher benchmark declares the default cohort without a performance run', () => {
  const run = spawnSync(process.execPath, ['scripts/benchmark-timetable-matching.mjs', '--describe'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000,
  });
  assert.equal(run.status, 0, run.stderr || String(run.error));
  assert.deepEqual(JSON.parse(run.stdout), {trips: 10000, calls: 24, repeats: 3});
});

test('matcher benchmark rejects misspelled or extra arguments', () => {
  for (const args of [['--smok'], ['--smoke', 'unexpected'], ['--describe', 'unexpected']]) {
    const run = spawnSync(process.execPath, ['scripts/benchmark-timetable-matching.mjs', ...args], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000,
    });
    assert.equal(run.status, 1, run.stderr || String(run.error));
    assert.match(run.stderr, /Usage: benchmark-timetable-matching/);
    assert.equal(run.stdout, '');
  }
});

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
    [x => { Object.assign(x.evidence.observations[0], {calendar_state: 'future', active_service_dates: []}); }, 'missing_evidence'],
    [x => { Object.assign(x.evidence.observations[0], {calendar_state: 'expired', active_service_dates: []}); }, 'stale'],
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
  input.evidence.observations[0].active_service_dates = ['2026-10-04'];
  const current = {...structuredClone(expired), shape_id: 'current-branch'};
  const {id, ...definition} = current; current.id = hash(['feed', sha, definition]);
  input.evidence.patterns.push(current);
  input.evidence.observations.push({...structuredClone(input.evidence.observations[0]), id: hash(['feed', sha, 'current']), trip_id: 'current', service_id: 'current-calendar', pattern_id: current.id, calendar_state: 'current', valid_until: 2000000000});
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
    alternate.operator_binding = {feed_id: 'feed', agency_id: 'A', source_sha256: change.feed_id === 'other' ? 'b'.repeat(64) : sha, status: 'verified', ...change};
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
    input.crosswalk.push({...input.crosswalk[0], osm_station_id: 'node:99', ...change});
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
    ['absent', null, 'missing_evidence'],
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
  for (let i = 0; i < 11; i++) input.candidates.push({...structuredClone(input.candidates[0]), route_bindings: [], operator_binding: {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'verified'}, osm});
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

test('recognizable current conflicts survive malformed neighboring binding records', () => {
  for (const malformed of [null, {}]) for (const reverse of [false, true]) {
    const input = fixture(), alternate = structuredClone(input.candidates[0]);
    alternate.route_bindings[0].status = 'conflict'; alternate.route_bindings.push(malformed);
    if (reverse) alternate.route_bindings.reverse();
    input.candidates.push(alternate);
    if (reverse) input.candidates.reverse();
    assert.equal(status(input), 'conflicting');
  }
});

test('recognizable scoped operator and station conflicts survive malformed inventory neighbors', () => {
  for (const kind of ['operator', 'station', 'station identities']) for (const reverse of [false, true]) {
    const input = fixture();
    if (kind === 'operator') {
      input.candidates[0].route_bindings.push(null);
      input.candidates[0].operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'conflict'};
      if (reverse) input.candidates[0].route_bindings.reverse();
    } else {
      if (kind === 'station') input.crosswalk[0].status = 'conflict';
      else input.crosswalk.push({...input.crosswalk[0], osm_station_id: 'node:99'});
      input.crosswalk.push(null);
      if (reverse) input.crosswalk.reverse();
    }
    const output = matchTimetablePattern(input);
    assert.equal(output.status, 'conflicting', `${kind}/${reverse}`);
    assert.equal(output.frequency_status, 'not_evaluated');
  }
});

test('an unresolved variant direction cannot disappear beside a verified variant', () => {
  for (const direction of [undefined, null, '', 'both', 0]) for (const reverse of [false, true]) {
    const input = fixture(), alternate = {...structuredClone(input.candidates[0].variants[0]), id: 'unresolved', direction_id: direction};
    input.candidates[0].variants.push(alternate);
    if (reverse) input.candidates[0].variants.reverse();
    assert.equal(status(input), 'missing_evidence');
  }
});

test('timezone-less snapshots are rejected identically across process timezones', () => {
  const input = fixture(), localSnapshot = '2026-10-05T00:00:00';
  input.context.osm_snapshot = localSnapshot;
  input.candidates[0].osm = captureOsmServiceEvidence(relation(), localSnapshot);
  input.crosswalk.forEach(row => { row.osm_snapshot = localSnapshot; });
  const module = new URL('../scripts/timetable-matching.mjs', import.meta.url).href;
  const code = `import {readFileSync} from 'node:fs'; import {matchTimetablePattern} from ${JSON.stringify(module)}; console.log(matchTimetablePattern(JSON.parse(readFileSync(0, 'utf8'))).status);`;
  const outcomes = ['UTC', 'America/Los_Angeles'].map(TZ => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {input: JSON.stringify(input), encoding: 'utf8', env: {...process.env, TZ}});
    assert.equal(run.status, 0, run.stderr);
    return run.stdout.trim();
  });
  assert.deepEqual(outcomes, ['missing_evidence', 'missing_evidence']);
});

function addOtherSourcePattern(input) {
  const other = {...structuredClone(input.evidence.patterns[0]), shape_id: 'other-source-pattern'};
  const {id, ...definition} = other;
  other.id = hash([input.evidence.source.feed_id, input.evidence.source.sha256, definition]);
  input.evidence.patterns.push(other);
  input.evidence.observations.push({...structuredClone(input.evidence.observations[0]), id: hash(['feed', sha, 'other-trip']), trip_id: 'other-trip', service_id: 'other-calendar', pattern_id: other.id});
  return sealObservations(input);
}

test('all source records pass schema and content checks before identity filtering', () => {
  assert.equal(status(addOtherSourcePattern(fixture())), 'verified', 'valid unrelated source records remain usable');
  for (const [mutate, expected] of [
    [x => { x.evidence.patterns.push(null); }, 'missing_evidence'],
    [x => { x.evidence.observations.push(null); }, 'missing_evidence'],
    [x => { x.evidence.patterns[1].source_route_id = {}; }, 'missing_evidence'],
    [x => { x.evidence.patterns[1].shape_id = 'tampered'; }, 'conflicting'],
    [x => { x.evidence.observations[1].calendar_state = 'expired'; }, 'conflicting'],
    [x => { x.evidence.observations[1].pattern_id = 'b'.repeat(64); }, 'missing_evidence'],
    [x => { x.evidence.observations[1].active_service_dates = ['2026-02-30']; }, 'missing_evidence'],
    [x => { x.evidence.observations.pop(); }, 'missing_evidence'],
    [x => { x.pattern_id = 'x'.repeat(1000000); }, 'missing_evidence'],
  ]) {
    const input = addOtherSourcePattern(fixture()); mutate(input);
    assert.equal(status(input), expected);
  }
});

test('complete variant records precede direction and station relevance', () => {
  const changes = [
    [v => { delete v.id; }, 'missing_evidence'],
    [v => { v.extra = 'unsupported'; }, 'missing_evidence'],
    [v => { v.status = 'unknown'; }, 'missing_evidence'],
    [v => { v.status = 'conflict'; }, 'conflicting'],
    [v => { v.stations = [null, 'node:1']; }, 'missing_evidence'],
    [v => { v.stations = ['node:99', 'node:1']; }, 'missing_evidence'],
    [v => { v.section_way_ids = []; }, 'missing_evidence'],
    [v => { v.section_way_ids = [101]; }, 'missing_evidence'],
  ];
  for (const direction of ['0', '1']) for (const reverse of [false, true]) {
    const make = () => {
      const input = fixture();
      input.candidates[0].variants.push({...structuredClone(input.candidates[0].variants[0]), id: 'other', direction_id: direction, stations: ['node:2', 'node:1']});
      return input;
    };
    assert.equal(status(make()), 'verified', `intact nonmatching pattern/direction ${direction}`);
    for (const [mutate, expected] of changes) {
      const input = make(); mutate(input.candidates[0].variants[1]);
      if (reverse) input.candidates[0].variants.reverse();
      assert.equal(status(input), expected, `${direction}/${reverse}`);
    }
  }
});

test('complete candidate schema and integrity precede unrelated identity filtering', () => {
  for (const kind of ['other feed', 'other ref']) for (const reverse of [false, true]) {
    const input = fixture(), other = structuredClone(input.candidates[0]);
    if (kind === 'other feed') other.route_bindings[0].feed_id = 'other';
    else {
      other.route_bindings = [];
      other.operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'verified'};
      other.osm = captureOsmServiceEvidence(relation({tags: {...relation().tags, ref: 'Q'}}), snapshot);
    }
    input.candidates.push(other);
    if (reverse) input.candidates.reverse();
    assert.equal(status(input), 'verified');
    other.variants[0].direction_id = null;
    assert.equal(status(input), 'missing_evidence');
    other.variants[0].direction_id = '0';
    other.osm.tags.ref = 'unbound change';
    assert.equal(status(input), 'conflicting');
  }
});

test('full timestamp grammar rejects ambiguous, rollover and unsupported precision values', () => {
  const valid = ['2026-10-05T00:00:00Z', '2026-10-05T00:00:00.1Z', '2026-10-05T00:00:00.123Z', '2026-10-05T01:00:00+01:00', '2026-10-04T17:00:00-07:00', '2024-02-29T00:00:00Z'];
  const invalid = ['2026-10-05T00:00:00', '2026-10-05T00:00:00Z trailing', '2026-10-05T00:00Z', '2026-10-05 00:00:00Z', '2026-10-05T00:00:00.1234Z', '2026-10-05T00:00:00.123456Z', '2026-02-29T00:00:00Z', '2026-02-30T00:00:00Z', '1900-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-00-05T00:00:00Z', '2026-10-00T00:00:00Z', '2026-10-05T24:00:00Z', '2026-10-05T00:60:00Z', '2026-10-05T00:00:60Z', '2026-10-05T00:00:00+24:00', '2026-10-05T00:00:00+00:60'];
  for (const value of valid) assert.equal(captureOsmServiceEvidence(relation({timestamp: value}), value).status, 'captured', value);
  for (const value of invalid) {
    assert.equal(captureOsmServiceEvidence(relation({timestamp: value}), value).status, 'incomplete', value);
    const input = fixture(); input.context.osm_snapshot = value;
    assert.equal(status(input), 'missing_evidence', value);
  }
});

test('explicit timestamps have identical matching outcomes across process timezones', () => {
  const module = new URL('../scripts/timetable-matching.mjs', import.meta.url).href;
  const code = `import {readFileSync} from 'node:fs'; import {matchTimetablePattern} from ${JSON.stringify(module)}; console.log(matchTimetablePattern(JSON.parse(readFileSync(0, 'utf8'))).status);`;
  for (const value of ['2026-10-05T00:00:00Z', '2026-10-05T00:00:00.123Z', '2026-10-05T01:00:00+01:00', '2026-10-04T17:00:00-07:00']) {
    const input = fixture(); input.context.osm_snapshot = value; input.now++;
    input.candidates[0].osm = captureOsmServiceEvidence(relation(), value);
    input.crosswalk.forEach(row => { row.osm_snapshot = value; });
    for (const TZ of ['UTC', 'America/Los_Angeles']) {
      const run = spawnSync(process.execPath, ['--input-type=module', '-e', code], {input: JSON.stringify(input), encoding: 'utf8', env: {...process.env, TZ}});
      assert.equal(run.status, 0, run.stderr);
      assert.equal(run.stdout.trim(), 'verified', `${value}/${TZ}`);
    }
  }
});

test('all-record source hashing work is capped for patterns and observations', () => {
  const patterns = fixture(), call = {stop_id: 's'.repeat(1024), station_id: 'p'.repeat(1024), pickup_type: '0', drop_off_type: '0'};
  for (let i = 0; i < 17; i++) {
    const definition = {...patterns.evidence.patterns[0], calls: Array(512).fill(call), shape_id: `large${i}`};
    delete definition.id;
    patterns.evidence.patterns.push({...definition, id: hash(['feed', sha, definition])});
  }
  assert.deepEqual(matchTimetablePattern(patterns).reasons, ['source_work_limit']);
  const observations = fixture();
  observations.evidence.observations = Array.from({length: 8000}, (_, i) => {
    const trip_id = 't'.repeat(1000) + i;
    return {...observations.evidence.observations[0], id: hash(['feed', sha, trip_id]), trip_id, service_id: 's'.repeat(1024)};
  });
  sealObservations(observations);
  assert.deepEqual(matchTimetablePattern(observations).reasons, ['source_work_limit']);
});

test('independently validated fallback conflicts survive malformed variants or other candidates', () => {
  for (const sameCandidate of [false, true]) for (const reverse of [false, true]) {
    const input = fixture(), alternate = structuredClone(input.candidates[0]);
    alternate.route_bindings = [];
    alternate.operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'conflict'};
    input.candidates.push(alternate);
    if (sameCandidate) alternate.variants.push(null);
    else input.candidates.push({eligibility: 'unknown'});
    if (reverse) input.candidates.reverse();
    assert.equal(status(input), 'conflicting');
  }
});

test('unreviewed identity assertions cannot establish that a candidate is unrelated', () => {
  for (const field of ['route', 'operator', 'candidate']) for (const reverse of [false, true]) {
    const input = fixture(), other = structuredClone(input.candidates[0]);
    if (field === 'operator') {
      other.route_bindings = [];
      other.operator_binding = {feed_id: 'other', source_sha256: sha, agency_id: 'A', status: 'unknown'};
    } else {
      other.route_bindings[0].feed_id = 'other';
      if (field === 'route') other.route_bindings[0].status = 'unknown';
      else other.status = 'unknown';
    }
    input.candidates.push(other);
    if (reverse) input.candidates.reverse();
    assert.equal(status(input), 'missing_evidence');
  }
});

test('same-feed source pins precede route, agency and unserved-station irrelevance', () => {
  for (const kind of ['route', 'operator', 'station']) for (const reverse of [false, true]) {
    const input = fixture(); let assertion;
    if (kind === 'station') {
      assertion = {...input.crosswalk[0], station_id: 'unserved'};
      input.crosswalk.push(assertion);
    } else {
      const other = structuredClone(input.candidates[0]);
      if (kind === 'route') { other.route_bindings[0].route_id = 'other'; assertion = other.route_bindings[0]; }
      else {
        other.route_bindings = [];
        assertion = other.operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'other', status: 'verified'};
      }
      input.candidates.push(other);
    }
    assert.equal(status(input), 'verified', 'current reviewed unrelated control');
    assertion.source_sha256 = 'b'.repeat(64);
    if (reverse) { input.candidates.reverse(); input.crosswalk.reverse(); }
    assert.equal(status(input), 'stale', `${kind}/${reverse}`);
  }
});

test('current fallback candidate and complete variant conflicts survive malformed variant neighbors', () => {
  for (const field of ['candidate', 'variant']) for (const reverse of [false, true]) {
    const input = fixture(), candidate = input.candidates[0];
    candidate.route_bindings = [];
    candidate.operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'verified'};
    if (field === 'candidate') candidate.status = 'conflict';
    else candidate.variants[0].status = 'conflict';
    assert.equal(status(input), 'conflicting', 'complete conflict control');
    candidate.variants.push(null);
    if (reverse) candidate.variants.reverse();
    assert.equal(status(input), 'conflicting', `${field}/${reverse}`);
  }
});

test('crosswalk lookup keys separate unused mapping state from selected mapping proof', () => {
  for (const [change, selectedStatus] of [
    [{status: 'unknown'}, 'missing_evidence'],
    [{status: 'conflict'}, 'conflicting'],
    [{osm_snapshot: '2026-10-04T00:00:00Z'}, 'stale'],
  ]) for (const selected of [false, true]) for (const reverse of [false, true]) {
    const input = fixture();
    input.crosswalk.push({...input.crosswalk[0], station_id: selected ? 'a' : 'unserved', ...change});
    if (reverse) input.crosswalk.reverse();
    const output = matchTimetablePattern(input);
    assert.equal(output.status, selected ? selectedStatus : 'verified', `${JSON.stringify(change)}/selected=${selected}/reverse=${reverse}`);
    assert.equal(output.frequency_status, 'not_evaluated');
  }
  for (const selected of [false, true]) for (const reverse of [false, true]) {
    const input = fixture();
    input.crosswalk.push({...input.crosswalk[0], station_id: selected ? 'a' : 'unserved', source_sha256: 'b'.repeat(64)});
    if (reverse) input.crosswalk.reverse();
    assert.equal(status(input), 'stale', 'same-feed source revision pins the lookup namespace before key selection');
    input.crosswalk.find(row => row.source_sha256 !== sha).feed_id = 'other';
    assert.equal(status(input), 'verified', 'a different feed has a separate lookup namespace');
  }
});

function diagnosticInventory(field) {
  const input = fixture();
  const alternative = structuredClone(input.candidates[0]);
  input.candidates.push(alternative);
  if (field === 'crosswalk') input.crosswalk.push({...input.crosswalk[0]});
  const rows = field === 'candidates' ? input.candidates : field === 'crosswalk' ? input.crosswalk : alternative[field];
  const row = rows.at(-1);
  return {input, rows, row, replace: value => {
    if (field === 'candidates' || field === 'crosswalk') input[field] = value;
    else alternative[field] = value;
  }};
}

for (const field of ['route_bindings', 'variants', 'candidates', 'crosswalk']) {
  test(`owned current conflicts survive sparse ${field} in either order`, () => {
    for (const reverse of [false, true]) {
      const {input, rows, row} = diagnosticInventory(field);
      row.status = 'conflict';
      assert.equal(status(input), 'conflicting', 'dense current conflict control');
      rows.length++;
      if (reverse) { rows.reverse(); if (rows !== input.candidates) input.candidates.reverse(); }
      assert.equal(status(input), 'conflicting', `${field}/${reverse}`);
    }
  });
}

test('inherited conflict slots cannot establish a negative identity assertion', () => {
  for (const field of ['route_bindings', 'variants', 'candidates', 'crosswalk']) {
    const {input, rows, row} = diagnosticInventory(field);
    row.status = 'conflict';
    const index = rows.length - 1;
    delete rows[index];
    Object.setPrototypeOf(rows, Object.assign(Object.create(Array.prototype), {[index]: row}));
    assert.equal(status(input), 'missing_evidence', field);
  }
});

test('holes always withhold positive matching across diagnostic containers', () => {
  for (const field of ['route_bindings', 'variants', 'candidates', 'crosswalk']) for (const reverse of [false, true]) {
    const {input, rows} = diagnosticInventory(field);
    if (field !== 'candidates') input.candidates.shift();
    rows.length++;
    if (reverse) rows.reverse();
    const output = matchTimetablePattern(input);
    assert.equal(output.status, 'missing_evidence', field);
    assert.equal(output.frequency_status, 'not_evaluated');
  }
  for (const candidates of [new Array(1), [{eligibility: 'excluded'}, ,]]) {
    assert.equal(status({...fixture(), candidates}), 'missing_evidence', 'holes are not explicit exclusions');
  }
});

test('invalid container types and length caps precede negative diagnostic scanning', () => {
  for (const [field, cap] of [['route_bindings', 32], ['variants', 128], ['candidates', 256], ['crosswalk', 1024]]) {
    for (const invalid of [null, {}, 'invalid']) {
      const {input, replace} = diagnosticInventory(field);
      replace(invalid);
      assert.equal(status(input), 'missing_evidence', `${field}/${invalid}`);
    }
    const {input, rows, row} = diagnosticInventory(field);
    row.status = 'conflict';
    rows.length = cap + 1;
    assert.equal(status(input), 'missing_evidence', `${field}/over limit`);
  }
});

test('only plain candidates with owned eligibility can establish explicit exclusions', () => {
  const inherited = Object.create({eligibility: 'excluded'});
  class Unreviewed { constructor() { this.eligibility = 'excluded'; } }
  for (const candidate of [inherited, hiddenField({eligibility: 'excluded'}, 'eligibility'), new Unreviewed(), Object.assign([], {eligibility: 'excluded'}), Object.assign(() => {}, {eligibility: 'excluded'})]) {
    assert.equal(status({...fixture(), candidates: [candidate]}), 'missing_evidence', 'invalid exclusion alone');
    for (const reverse of [false, true]) {
      const input = fixture(); input.candidates.push(candidate);
      if (reverse) input.candidates.reverse();
      const output = matchTimetablePattern(input);
      assert.equal(output.status, 'missing_evidence', 'invalid exclusion beside a valid candidate');
      assert.equal(output.frequency_status, 'not_evaluated');
    }
  }
  for (const candidate of [{eligibility: 'excluded'}, Object.assign(Object.create(null), {eligibility: 'excluded'})]) {
    assert.equal(status({...fixture(), candidates: [candidate]}), 'no_eligible_service', 'explicit own exclusion');
    const input = fixture(); input.candidates.push(candidate);
    assert.equal(status(input), 'verified', 'valid explicit exclusion remains independent');
  }
});

function hiddenField(object, field) {
  Object.defineProperty(object, field, {value: object[field], enumerable: false, writable: true, configurable: true});
  return object;
}
function withPrototypeField(field, value, run) {
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, field);
  try {
    Object.defineProperty(Object.prototype, field, {value, enumerable: false, writable: true, configurable: true});
    return run();
  } finally {
    if (previous) Object.defineProperty(Object.prototype, field, previous);
    else delete Object.prototype[field];
  }
}
for (const container of ['invocation', 'context', 'evidence']) {
  test(`${container} envelope assertions require ordinary owned enumerable fields`, () => {
    const keys = container === 'invocation' ? ['evidence', 'pattern_id', 'context', 'candidates', 'now'] : container === 'context' ? ['feed_id', 'source_sha256', 'service_date', 'osm_snapshot', 'review_until', 'candidate_inventory'] : ['schema', 'status', 'source', 'patterns', 'observations', 'stops'];
    for (const kind of ['inherited', 'hidden']) for (const key of keys) {
      const input = fixture(), value = container === 'invocation' ? input : input[container];
      const changed = kind === 'inherited' ? Object.assign(Object.create({[key]: value[key]}), value) : value;
      if (kind === 'inherited') delete changed[key];
      else hiddenField(changed, key);
      if (container === 'invocation') assert.equal(status(changed), 'missing_evidence', `${kind}/${key}`);
      else { input[container] = changed; assert.equal(status(input), 'missing_evidence', `${kind}/${key}`); }
    }
    const input = fixture();
    if (container === 'invocation') assert.equal(status(Object.assign(Object.create(null), input)), 'verified');
    else { input[container] = Object.assign(Object.create(null), input[container]); assert.equal(status(input), 'verified'); }
  });
}

test('prototype fields cannot supply completeness, capture status or exclusions', () => {
  for (const [container, key] of [['context', 'candidate_inventory'], ['evidence', 'status']]) {
    const input = fixture(), value = input[container][key]; delete input[container][key];
    assert.equal(withPrototypeField(key, value, () => status(input)), 'missing_evidence', key);
  }
  const input = fixture(); input.candidates.push({});
  assert.equal(withPrototypeField('eligibility', 'excluded', () => status(input)), 'missing_evidence');
});

test('raw OSM relation and member assertions cannot come from inherited or hidden fields', () => {
  for (const member of [false, true]) for (const kind of ['inherited', 'hidden']) {
    const raw = relation(), value = member ? raw.members[0] : raw;
    const changed = kind === 'inherited' ? Object.create(value) : hiddenField(value, member ? 'ref' : 'version');
    if (member) raw.members[0] = changed;
    assert.equal(captureOsmServiceEvidence(member ? raw : changed, snapshot).status, 'incomplete', `${member}/${kind}`);
  }
  assert.equal(captureOsmServiceEvidence(Object.assign(Object.create(null), relation()), snapshot).status, 'captured');
});

test('optional ref fallback consumes only enumerable own content-bound tags', () => {
  for (const kind of ['inherited', 'hidden']) {
    const input = fixture(), candidate = input.candidates[0], raw = relation(); delete raw.tags.ref;
    candidate.osm = captureOsmServiceEvidence(raw, snapshot);
    candidate.route_bindings = [];
    candidate.operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: 'verified'};
    assert.equal(status(input), 'missing_evidence', 'no captured ref control');
    if (kind === 'hidden') { Object.defineProperty(candidate.osm.tags, 'ref', {value: 'R'}); assert.equal(status(input), 'missing_evidence'); }
    else assert.equal(withPrototypeField('ref', 'R', () => status(input)), 'missing_evidence');
  }
});

test('partial candidate negative preflight does not consume inherited assertion fields', () => {
  for (const kind of ['inherited', 'hidden']) {
    const input = fixture(), candidate = input.candidates[0];
    candidate.route_bindings[0].status = 'conflict';
    const value = candidate.route_bindings;
    if (kind === 'hidden') { hiddenField(candidate, 'route_bindings'); assert.equal(status(input), 'missing_evidence'); }
    else { delete candidate.route_bindings; assert.equal(withPrototypeField('route_bindings', value, () => status(input)), 'missing_evidence'); }
  }
});

test('unconsumed hidden or inherited optional operator metadata is not hashed or asserted', () => {
  for (const kind of ['inherited', 'hidden']) {
    const input = fixture(), candidate = input.candidates[0];
    let unused = {status: 'conflict'};
    for (let i = 0; i < 10000; i++) unused = {extra: unused};
    if (kind === 'hidden') {
      Object.defineProperty(candidate, 'operator_binding', {value: unused});
      assert.equal(status(input), 'verified', 'exact binding has no consumed operator assertion');
    } else assert.equal(withPrototypeField('operator_binding', unused, () => status(input)), 'verified');
  }
});

test('station conflicts are scoped to current source and requested OSM snapshot', () => {
  for (const state of ['verified', 'conflict', 'unknown']) for (const differentIdentity of [false, true]) for (const reverse of [false, true]) {
    const input = fixture();
    input.crosswalk.push({...input.crosswalk[0], status: state, osm_station_id: differentIdentity ? 'node:99' : 'node:1', osm_snapshot: '2026-10-04T00:00:00Z'});
    if (reverse) input.crosswalk.reverse();
    const output = matchTimetablePattern(input);
    assert.equal(output.status, 'stale', `${state}/${differentIdentity}/${reverse}`);
    assert.deepEqual(output.reasons, ['station_snapshot_mismatch']);
    assert.equal(output.frequency_status, 'not_evaluated');
  }
});

test('current station conflicts retain priority beside stale source or snapshot rows', () => {
  for (const stalePin of ['source', 'snapshot']) for (const differentIdentity of [false, true]) for (const reverse of [false, true]) {
    const input = fixture();
    input.crosswalk[0].status = 'conflict';
    const previous = {...input.crosswalk[0], status: 'verified', osm_station_id: differentIdentity ? 'node:99' : 'node:1'};
    if (stalePin === 'source') previous.source_sha256 = 'b'.repeat(64);
    else previous.osm_snapshot = '2026-10-04T00:00:00Z';
    input.crosswalk.push(previous);
    if (reverse) input.crosswalk.reverse();
    assert.equal(status(input), 'conflicting', `${stalePin}/${reverse}`);
  }
  const input = fixture();
  input.crosswalk.push({...input.crosswalk[0], osm_station_id: 'node:99'});
  assert.equal(status(input), 'conflicting', 'two identities within current pins still conflict');
});

test('old-only station mappings withhold stale while unused same-source mappings remain irrelevant', () => {
  for (const state of ['verified', 'conflict', 'unknown']) for (const differentIdentity of [false, true]) for (const selected of [false, true]) for (const reverse of [false, true]) {
    const input = fixture();
    const previous = {...input.crosswalk[0], status: state, osm_snapshot: '2026-10-04T00:00:00Z', osm_station_id: differentIdentity ? 'node:99' : 'node:1'};
    if (selected) input.crosswalk.shift();
    else previous.station_id = 'unserved';
    input.crosswalk.push(previous);
    if (reverse) input.crosswalk.reverse();
    const output = matchTimetablePattern(input);
    assert.equal(output.status, selected ? 'stale' : 'verified', `${state}/${selected}/${reverse}`);
    assert.equal(output.frequency_status, 'not_evaluated');
  }
});

test('stale operator statuses cannot override their source mismatch beside exact current routes', () => {
  for (const state of ['verified', 'conflict', 'unknown']) for (const refMatches of [false, true]) for (const exact of [false, true]) {
    const input = fixture(), candidate = input.candidates[0];
    candidate.operator_binding = {feed_id: 'feed', source_sha256: 'b'.repeat(64), agency_id: 'A', status: state};
    if (!exact) candidate.route_bindings = [];
    if (!refMatches) candidate.osm = captureOsmServiceEvidence(relation({tags: {route: 'train', ref: 'other'}}), snapshot);
    const output = matchTimetablePattern(input);
    assert.equal(output.status, 'stale', `${state}/ref=${refMatches}/exact=${exact}`);
    assert.deepEqual(output.reasons, ['operator_binding_source_mismatch']);
    assert.equal(output.frequency_status, 'not_evaluated');
    assert.equal(output.profiles, undefined);
  }
});

test('current operator conflicts and independent current conflicts retain priority', () => {
  for (const refMatches of [false, true]) for (const state of ['verified', 'conflict', 'unknown']) {
    const input = fixture(), candidate = input.candidates[0];
    candidate.operator_binding = {feed_id: 'feed', source_sha256: sha, agency_id: 'A', status: state};
    if (!refMatches) candidate.osm = captureOsmServiceEvidence(relation({tags: {route: 'train', ref: 'other'}}), snapshot);
    assert.equal(status(input), {verified: 'verified', conflict: 'conflicting', unknown: 'missing_evidence'}[state], `${state}/${refMatches}`);
  }
  for (const kind of ['route', 'candidate', 'variant', 'station']) for (const reverse of [false, true]) {
    const input = fixture(), candidate = input.candidates[0];
    candidate.operator_binding = {feed_id: 'feed', source_sha256: 'b'.repeat(64), agency_id: 'A', status: 'conflict'};
    if (kind === 'route') candidate.route_bindings[0].status = 'conflict';
    if (kind === 'candidate') candidate.status = 'conflict';
    if (kind === 'variant') candidate.variants[0].status = 'conflict';
    if (kind === 'station') input.crosswalk[0].status = 'conflict';
    const unrelated = structuredClone(fixture().candidates[0]);
    unrelated.service_id = 'other'; unrelated.route_bindings[0].feed_id = 'other';
    input.candidates.push(unrelated);
    if (reverse) input.candidates.reverse();
    assert.equal(status(input), 'conflicting', `${kind}/${reverse}`);
  }
});

test('unrelated operator scopes never manufacture a current operator conflict', () => {
  for (const feed_id of ['feed', 'other']) for (const agency_id of ['A', 'other']) for (const source_sha256 of [sha, 'b'.repeat(64)]) {
    if (feed_id === 'feed' && agency_id === 'A' && source_sha256 === sha) continue;
    const input = fixture();
    input.candidates[0].operator_binding = {feed_id, source_sha256, agency_id, status: 'conflict'};
    assert.equal(status(input), feed_id === 'feed' && source_sha256 !== sha ? 'stale' : 'verified', `${feed_id}/${agency_id}/${source_sha256}`);
  }
});

const observationSemantics = JSON.parse(readFileSync(new URL('./fixtures/service-frequency/timetable-observation-semantics.json', import.meta.url), 'utf8')).cases;
function observationInput(vector) {
  const input = fixture(), pattern = input.evidence.patterns[0], candidate = input.candidates[0];
  pattern.calls = vector.departures.map((_, index) => ({stop_id: `s${index}`, station_id: `s${index}`, pickup_type: '0', drop_off_type: '0'}));
  const {id, ...definition} = pattern;
  pattern.id = hash(['feed', sha, definition]); input.pattern_id = pattern.id;
  Object.assign(input.evidence.observations[0], {pattern_id: pattern.id, departures: [...vector.departures], frequencies: structuredClone(vector.frequencies)});
  candidate.osm = captureOsmServiceEvidence(relation({members: [...pattern.calls.map((_, index) => ({type: 'node', ref: index + 1, role: 'stop'})), {type: 'way', ref: 100, role: ''}]}), snapshot);
  candidate.variants[0].stations = pattern.calls.map((_, index) => `node:${index + 1}`);
  input.crosswalk = pattern.calls.map((call, index) => ({feed_id: 'feed', source_sha256: sha, station_id: call.station_id, osm_station_id: `node:${index + 1}`, status: 'verified', osm_snapshot: snapshot}));
  return sealObservations(input);
}
for (const kind of ['departures', 'frequencies']) test(`resealed observation ${kind} obey the collector's temporal invariants`, () => {
  for (const vector of observationSemantics.filter(value => value.kind === kind)) for (const reverseIntervals of [false, true]) for (const placement of ['selected', 'other', 'expired-other']) for (const reverseObservations of [false, true]) {
    const input = observationInput({...vector, departures: vector.departures.map((_, index) => index * 600), frequencies: []});
    if (placement !== 'selected') addOtherSourcePattern(input);
    const observation = input.evidence.observations[placement === 'selected' ? 0 : 1];
    observation.departures = [...vector.departures]; observation.frequencies = structuredClone(vector.frequencies);
    if (reverseIntervals) observation.frequencies.reverse();
    if (placement === 'expired-other') { observation.calendar_state = 'expired'; observation.valid_until = 0; observation.active_service_dates = []; }
    if (reverseObservations) input.evidence.observations.reverse();
    sealObservations(input);
    const before = structuredClone(input), output = matchTimetablePattern(input);
    assert.equal(output.status, vector.collector_reason ? 'missing_evidence' : 'verified', `${vector.id}/${reverseIntervals}/${placement}/${reverseObservations}`);
    if (vector.collector_reason) assert.deepEqual(output.reasons, ['invalid_observation_schema']);
    assert.equal(output.frequency_status, 'not_evaluated');
    assert.equal(output.profiles, undefined);
    assert.deepEqual(input, before, 'semantic validation never reorders or repairs the supplied evidence');
  }
});

test('temporal semantics retain dense-array and existing observation caps', () => {
  const frequencies = Array.from({length: 128}, (_, index) => ({start: index * 600, end: (index + 1) * 600, headway_secs: 60, exact_times: '0'})).reverse();
  const input = observationInput({departures: Array(512).fill(0), frequencies});
  assert.equal(status(input), 'verified', '512 equal known calls and 128 reverse-ordered adjacent intervals remain supported');
  input.evidence.observations[0].frequencies.push({start: 128 * 600, end: 129 * 600, headway_secs: 60, exact_times: '0'});
  sealObservations(input); assert.equal(status(input), 'missing_evidence', '129 intervals still exceed the cap');
  input.evidence.observations[0].frequencies.pop(); delete input.evidence.observations[0].frequencies[3];
  assert.equal(status(input), 'missing_evidence', 'a frequency hole is not nonoverlapping evidence');
  input.evidence.observations[0].frequencies = [];
  delete input.evidence.observations[0].departures[3];
  assert.equal(status(input), 'missing_evidence', 'a departure hole is not a legitimate unknown null');
});
