import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {departureRows} from '../styles/departures.mjs';
import {departureItem, renderSchedule} from '../styles/departures-ui.mjs';

const at = '2026-10-11T12:00:00Z', now = Date.parse(at) - 60_000;
const time = fields => ({mode: 'REGIONAL_RAIL', headsign: 'Central',
  place: {departure: at, scheduledDeparture: at, stopId: 'stop', tz: 'UTC'}, ...fields});
const rows = lists => departureRows(lists, {now, count: 100});

for (const number of ['8913771', '20022891', '1', '42', '00123', '８９１３７７１', '٨٩١٣٧٧١']) {
  test(`bare numeric label ${number} is not a line name, regardless of route ID or fallback copies`, () => {
    for (const routeId of [undefined, 'unrelated-route', `route_${number}`]) {
      for (const routeLongName of [undefined, null, '', ' \t ', number]) {
        const input = time({routeId, routeShortName: number, routeLongName,
          displayName: ` ${number} `, tripShortName: number});
        assert.equal(rows([[input]])[0].line, '', JSON.stringify({routeId, routeLongName}));
      }
    }
  });
}

test('display and short-name fallbacks keep meaningful public text and train labels', () => {
  for (const [fields, expected] of [
    [{displayName: '8913771', routeShortName: 'R7'}, 'R7'],
    [{displayName: 'Express', routeShortName: '8913771'}, 'Express'],
    [{routeShortName: '8913771', tripShortName: '2223A'}, '2223A'],
    [{displayName: ' \t ', routeShortName: ' JK '}, 'JK'],
    [{displayName: 'RE3'}, 'RE3'],
    [{displayName: 'Nozomi 1'}, 'Nozomi 1'],
    [{routeShortName: '8913771', routeId: 'route_8913771', routeLongName: 'Keihin-Tohoku Line'}, 'Keihin-Tohoku Line'],
    [{displayName: '1', routeShortName: '1', routeLongName: 'Central Line'}, '1'],
    [{routeShortName: '1', routeLongName: 'Central Line'}, '1'],
    [{displayName: '8913771'}, ''],
    [{}, ''],
  ]) assert.equal(rows([[time(fields)]])[0].line, expected, JSON.stringify(fields));
});

test('hidden numeric labels retain raw exact identity and do not mutate input observations', () => {
  const input = ['1', '2'].map(routeShortName => time({routeShortName}));
  const before = structuredClone(input);
  assert.deepEqual(rows([input]).map(row => row.line), ['', '']);
  assert.equal(rows([[input[0], structuredClone(input[0])]]).length, 1, 'an exact repeat still merges');
  assert.deepEqual(input, before);
});

test('hiding a numeric line label does not introduce new cross-feed wildcard matches', () => {
  for (const other of ['2', 'R']) {
    const a = time({routeShortName: '1'}), b = time({routeShortName: other});
    const forward = rows([[a], [b]]);
    assert.equal(forward.length, 2, 'distinct raw labels stay distinct');
    assert.deepEqual(rows([[b], [a]]), forward, 'input order cannot change the result');
  }
  const same = time({routeShortName: '1'});
  assert.equal(rows([[same], [structuredClone(same)]]).length, 1, 'existing compatible numeric labels still merge');
});

test('known opaque-ID duplicates still reconcile and retain their trip and destination fallback', () => {
  const opaque = time({routeId: 'feed_8913771', routeShortName: '8913771', displayName: '8913771',
    tripId: 'trip_8913771', headsign: null, tripTo: {name: '桜木町'}, realTime: true,
    place: {departure: '2026-10-11T12:02:00Z', scheduledDeparture: at, stopId: 'opaque-stop', track: '3'}});
  const named = time({displayName: 'JK', headsign: '(普通 Local) 桜木町 Sakuragichō'});
  const result = rows([[opaque], [named]]);
  assert.equal(result.length, 1);
  const row = result[0];
  assert.deepEqual([row.line, row.headsign, row.tripId, row.stopId, row.tripScheduled, row.tripEvent, row.live, row.delay, row.track],
    ['JK', named.headsign, 'trip_8913771', 'opaque-stop', Date.parse(at), 'departure', true, 2, '3']);
  assert.deepEqual(rows([[named], [opaque]]), result);
});

test('the board and schedule caption never reintroduce a hidden numeric line label', () => {
  const dom = new JSDOM('<div></div>'), document = dom.window.document;
  try {
    const row = rows([[time({displayName: '20022891', routeShortName: '20022891',
      tripShortName: '20022891', tripId: 'trip_20022891'})]])[0];
    const item = departureItem(document, row, {load: () => assert.fail('schedule is lazy')});
    assert.equal(item.querySelector('.departure-line').textContent, 'regional rail');
    const container = document.querySelector('div');
    renderSchedule(container, [], row);
    assert.equal(container.querySelector('caption').textContent, 'Train → Central');
    assert.equal(row.tripId, 'trip_20022891', 'the actual trip reference remains usable');
    assert.equal('matchingLine' in row, false, 'private matching evidence is not a display field');
  } finally { dom.window.close(); }
});
