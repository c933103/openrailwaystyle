import test from 'node:test';
import assert from 'node:assert/strict';
import {departureRows} from '../styles/departures.mjs';

const at = '2026-10-09T12:00:00Z', now = Date.parse(at) - 600_000;
const time = (departure, place = {}, fields = {}) => ({
  mode: 'REGIONAL_RAIL', displayName: 'R', headsign: 'Central',
  tripId: 'trip', routeId: 'route',
  place: {scheduledDeparture: at, departure, ...place}, ...fields,
});
const rows = lists => departureRows(lists, {now});
const permutations = items => items.length < 2 ? [items] : items.flatMap((item, i) =>
  permutations(items.filter((_, j) => j !== i)).map(rest => [item, ...rest]));
const feed = (observations, id) => observations.map(observation => ({
  ...observation, tripId: `${id}-trip`, routeId: `${id}-route`,
}));
const observations = (missingTrack = {}) => [
  time(at, {track: '1'}, {cancelled: true}),
  time('2026-10-09T12:02:00Z', {track: '2'}, {realTime: true}),
  time('2026-10-09T12:05:00Z', missingTrack, {realTime: true}),
];
const assertLivePlatform = (result, platform = '2') => {
  assert.equal(result.length, 1, 'one train remains after combining observations');
  assert.deepEqual({track: result[0].track, departure: result[0].departure,
    live: result[0].live, delay: result[0].delay, cancelled: result[0].cancelled}, {
    track: platform, departure: Date.parse('2026-10-09T12:05:00Z'),
    live: true, delay: 5, cancelled: true,
  });
};

test('a later live time without a platform retains another live observation’s platform', () => {
  const source = observations(), original = structuredClone(source);
  for (const order of permutations(source)) assertLivePlatform(rows([order]));
  assert.deepEqual(source, original, 'combining observations does not mutate provider data');
});

test('live platform survives every two-feed partition and row/list ordering', () => {
  const source = observations();
  for (let singleton = 0; singleton < source.length; singleton++) {
    const pair = source.filter((_, i) => i !== singleton);
    for (const order of permutations(pair)) {
      const lists = [feed([source[singleton]], 'one'), feed(order, 'two')];
      for (const listOrder of permutations(lists)) assertLivePlatform(rows(listOrder));
    }
  }
});

test('a live row’s scheduled platform is not an explicit live platform update', () => {
  const source = observations({scheduledTrack: '1'});
  for (const order of permutations(source)) assertLivePlatform(rows([order]));
  // The scheduled row and latest time first collapse within one board. That
  // result must not turn the fallback platform into a live platform update.
  for (const pair of permutations([source[0], source[2]])) {
    const lists = [feed(pair, 'one'), feed([source[1]], 'two')];
    for (const order of permutations(lists)) assertLivePlatform(rows(order));
  }
});

test('missing, null and empty live platforms allow actual live platform fallback', () => {
  for (const track of [undefined, null, '']) {
    const source = observations({track, scheduledTrack: '1'});
    for (const order of permutations(source)) assertLivePlatform(rows([order]));
    for (const order of permutations([feed([source[0], source[2]], 'one'), feed([source[1]], 'two')])) {
      assertLivePlatform(rows(order));
    }
  }
});

test('scheduled platform remains available when no observation has an actual live platform', () => {
  for (const track of [undefined, null, '']) {
    const source = [
      time(at, {scheduledTrack: '1'}, {tripCancelled: true}),
      time('2026-10-09T12:05:00Z', {track, scheduledTrack: '1'}, {realTime: true}),
    ];
    for (const order of permutations(source)) {
      assertLivePlatform(rows([order]), '1');
      assertLivePlatform(rows(order.map((observation, i) => feed([observation], String(i)))), '1');
    }
  }
});

test('absent platform data stays empty while live time and cancellation are retained', () => {
  const source = [
    time(at, {track: null}, {cancelled: true}),
    time('2026-10-09T12:05:00Z', {track: '', scheduledTrack: null}, {realTime: true}),
  ];
  for (const order of permutations(source)) assertLivePlatform(rows([order]), '');
});

test('the selected live observation retains priority for scheduled-platform fallback', () => {
  const source = [
    time(at, {track: '1'}, {cancelled: true}),
    time('2026-10-09T12:05:00Z', {scheduledTrack: '3'}, {realTime: true}),
  ];
  for (const order of permutations(source)) {
    assertLivePlatform(rows([order]), '3');
    assertLivePlatform(rows(order.map((observation, i) => feed([observation], String(i)))), '3');
  }
});

test('conflicting explicit platforms at one live instant are deterministic across observations and feeds', () => {
  const source = [
    time(at, {track: '1'}, {cancelled: true}),
    ...['2', '4'].map(track => time('2026-10-09T12:05:00Z', {track}, {realTime: true})),
  ];
  const expected = rows([source]);
  assert.ok(['2', '4'].includes(expected[0].track), 'an actual live platform beats the scheduled platform');
  assertLivePlatform(expected, expected[0].track);
  for (const order of permutations(source)) assert.deepEqual(rows([order]), expected);
  for (let singleton = 0; singleton < source.length; singleton++) {
    for (const pair of permutations(source.filter((_, i) => i !== singleton))) {
      const lists = [feed([source[singleton]], 'one'), feed(pair, 'two')];
      for (const order of permutations(lists)) assert.deepEqual(rows(order), expected);
    }
  }
});

test('combining a time-only update does not change the prediction attached to a platform update', () => {
  const firstPlatform = time('2026-10-09T12:02:00Z', {track: '2'}, {realTime: true, cancelled: true});
  const latestTime = time('2026-10-09T12:09:00Z', {}, {realTime: true});
  const secondPlatform = time('2026-10-09T12:05:00Z', {track: '3'}, {realTime: true});
  const check = lists => {
    const result = rows(lists);
    assert.equal(result.length, 1);
    assert.deepEqual({track: result[0].track, departure: result[0].departure,
      live: result[0].live, delay: result[0].delay, cancelled: result[0].cancelled}, {
      track: '3', departure: Date.parse('2026-10-09T12:09:00Z'),
      live: true, delay: 9, cancelled: true,
    });
  };
  for (const order of permutations([firstPlatform, latestTime, secondPlatform])) check([order]);
  for (const pair of permutations([firstPlatform, latestTime])) {
    const lists = [feed(pair, 'one'), feed([secondPlatform], 'two')];
    for (const order of permutations(lists)) check(order);
  }
});
