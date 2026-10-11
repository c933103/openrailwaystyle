import test from 'node:test';
import assert from 'node:assert/strict';
import {departureRows} from '../styles/departures.mjs';

const at = '2026-10-09T12:00:00Z', now = Date.parse(at) - 600_000;
const time = fields => ({mode: 'REGIONAL_RAIL', displayName: 'R', headsign: 'Central',
  place: {scheduledDeparture: at, departure: at, tz: 'UTC'}, ...fields});
const rows = lists => departureRows(lists, {now, count: 100});
const permutations = items => items.length < 2 ? [items] : items.flatMap((item, i) =>
  permutations(items.filter((_, j) => j !== i)).map(rest => [item, ...rest]));

for (const [field, values] of [
  ['tripId', ['trip-a', 'trip-b']], ['routeId', ['route-a', 'route-b']],
  ['tripShortName', ['101', '102']], ['routeLongName', ['North route', 'South route']],
  ['mode', ['REGIONAL_RAIL', 'SUBWAY']],
]) test(`same-list ${field} distinguishes simultaneous services`, () => {
  for (const valuesInOrder of permutations(values)) {
    assert.equal(rows([valuesInOrder.map(value => time({[field]: value}))]).length, 2);
  }
});

test('resolved destination fallback distinguishes services without a headsign', () => {
  const services = ['Central', 'Airport'].map(name => time({headsign: null, tripTo: {name}}));
  for (const order of permutations(services)) assert.deepEqual(rows([order]).map(r => r.headsign).sort(), ['Airport', 'Central']);
});

test('tuple identity cannot collide through delimiter-bearing names and IDs', () => {
  const first = time({displayName: 'A|B', headsign: 'C', routeId: 'x|y', tripId: 'z'});
  const second = time({displayName: 'A', headsign: 'B|C', routeId: 'x', tripId: 'y|z'});
  assert.equal(rows([[first, second]]).length, 2);
});

test('exact repeats and equivalent missing optional fields merge', () => {
  const original = time({displayName: null, routeShortName: null, routeLongName: null,
    tripShortName: null, headsign: null, tripTo: null, routeId: null, tripId: null});
  assert.equal(rows([[original, structuredClone(original)]]).length, 1);
  assert.equal(rows([[time({}), time({tripId: null, routeId: null, tripShortName: null})]]).length, 1);
  assert.equal(rows([[time({tripId: 'known'}), time({tripId: null})]]).length, 2, 'missing identity is not a wildcard');
});

test('one exact train retains live data and any cancellation in every observation order', () => {
  const scheduled = time({tripId: 'trip', routeId: 'route'});
  const live = {...scheduled, realTime: true, place: {...scheduled.place, departure: '2026-10-09T12:04:00Z', track: '4'}};
  const cancelled = {...scheduled, tripCancelled: true};
  const expected = rows([[live, scheduled, cancelled]]);
  assert.equal(expected.length, 1);
  assert.deepEqual([expected[0].live, expected[0].delay, expected[0].track, expected[0].cancelled], [true, 4, '4', true]);
  for (const order of permutations([scheduled, live, cancelled])) assert.deepEqual(rows([order]), expected);
  assert.equal(scheduled.realTime, undefined, 'input is not mutated');
});

test('all cancellation flags survive repeated observations', () => {
  for (const cancelled of [time({cancelled: true}), time({tripCancelled: true}), time({place: {scheduledDeparture: at, departure: at, cancelled: true}})]) {
    for (const order of permutations([time({}), cancelled])) assert.equal(rows([order])[0].cancelled, true);
  }
});

test('an old scheduled cancellation survives when the exact train is still delayed ahead', () => {
  const cancelled = time({tripId: 'trip', cancelled: true});
  const live = time({tripId: 'trip', realTime: true, place: {scheduledDeparture: at, departure: '2026-10-09T12:14:00Z'}});
  for (const order of permutations([cancelled, live])) {
    const result = departureRows([order], {now: Date.parse('2026-10-09T12:10:00Z')});
    assert.equal(result.length, 1);
    assert.deepEqual([result[0].live, result[0].delay, result[0].cancelled], [true, 14, true]);
  }
  assert.deepEqual(departureRows([[cancelled]], {now: Date.parse('2026-10-09T12:10:00Z')}), [], 'expired trains remain hidden');
});

test('conflicting live predictions use a stable conservative time, not input order as freshness', () => {
  const observations = ['2026-10-09T12:01:00Z', '2026-10-09T12:05:00Z'].map(departure =>
    time({realTime: true, place: {scheduledDeparture: at, departure}}));
  const expected = rows([observations]);
  assert.equal(expected.length, 1);
  assert.equal(expected[0].delay, 5);
  for (const order of permutations(observations)) {
    assert.deepEqual(rows([order]), expected);
    assert.deepEqual(rows(order.map(observation => [observation])), expected);
  }
});

test('same-list matching uses exact scheduled instants rather than a minute bucket', () => {
  const later = time({place: {scheduledDeparture: '2026-10-09T12:00:30Z', departure: '2026-10-09T12:00:30Z'}});
  assert.equal(rows([[time({}), later]]).length, 2);
  assert.equal(rows([[time({mode: 'SUBWAY'}), time({mode: 'METRO'})]]).length, 1, 'mode aliases in one family');
});

test('null optional values and missing places retain existing filtering and arrival fallback', () => {
  assert.deepEqual(rows([[time({place: null}), time({mode: null})]]), []);
  const arrival = time({headsign: null, tripTo: null, place: {departure: null, arrival: at, scheduledDeparture: null, scheduledArrival: at, track: null, scheduledTrack: '2'}});
  const result = rows([[arrival, structuredClone(arrival)]]);
  assert.equal(result.length, 1);
  assert.deepEqual([result[0].headsign, result[0].track, result[0].scheduled], ['', '2', Date.parse(at)]);
});

test('unknown scheduled times do not collapse different actual departures', () => {
  const services = ['2026-10-09T12:00:00Z', '2026-10-09T12:05:00Z'].map(departure =>
    time({place: {scheduledDeparture: 'invalid', departure}}));
  assert.equal(rows([services]).length, 2);
  assert.equal(rows([[services[0], structuredClone(services[0])]]).length, 1);
});

test('identity distinctions retain cross-list ambiguity under row and list permutations', () => {
  const first = [time({tripId: 'a'}), time({tripId: 'b'})];
  const second = [time({tripId: 'external'})];
  const expected = rows([first, second]);
  assert.equal(expected.length, 3, 'another feed cannot choose either simultaneous train');
  for (const order of permutations(first)) for (const lists of permutations([order, second])) assert.deepEqual(rows(lists), expected);
});

test('genuine cross-list merges and mode-family boundaries remain unchanged', () => {
  assert.equal(rows([[time({tripId: 'a', routeId: 'a'})], [time({tripId: 'b', routeId: 'b'})]]).length, 1);
  assert.equal(rows([[time({mode: 'SUBURBAN'})], [time({mode: 'REGIONAL_RAIL'})]]).length, 1);
  assert.equal(rows([[time({mode: 'TRAM'})], [time({mode: 'REGIONAL_RAIL'})]]).length, 2);
  assert.equal(rows([[time({headsign: ''})], [time({headsign: ''})]]).length, 2);
  assert.equal(rows([[time({displayName: 'R1'})], [time({displayName: 'R2'})]]).length, 2);
});

test('equal-time distinct outputs and a limited board are stable under permutation', () => {
  const services = [time({routeId: 'a', headsign: 'West'}), time({routeId: 'b', headsign: 'East'}), time({mode: 'TRAM', headsign: 'Central'})];
  const expected = departureRows([services], {now, count: 2});
  for (const order of permutations(services)) {
    assert.deepEqual(departureRows([order], {now, count: 2}), expected);
    assert.deepEqual(departureRows(order.map(x => [x]), {now, count: 2}), expected);
  }
});
