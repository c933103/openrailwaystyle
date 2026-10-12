import test from 'node:test';
import assert from 'node:assert/strict';
import {pickStops, stationDepartures} from '../styles/departures.mjs';

const stop = (name, id, lat = .001, modes = ['REGIONAL_RAIL']) => ({type:'STOP', name, id, lat, lon:0, modes});
const station = names => ({lat:0, lon:0, names});
const permutations = items => items.length < 2 ? [items] : items.flatMap((item, i) =>
  permutations(items.filter((_, j) => j !== i)).map(rest => [item, ...rest]));
const ambiguous = [
  ['Terminal 1', 'Terminal 10'], ['Terminal 10', 'Terminal 1'],
  ['Terminal1', 'Terminal10'], ['Central', 'Central Park'], ['Central', 'CentralPark'],
  ['Central Park', 'Central'], ['中央', '中央公園'], ['中央公園', '中央'],
  ['中央', '新中央'], ['中央', '中央まえ'], ['Central', 'Central (North)'],
  ['Terminal 1', 'Terminal 11 (Platform 2)'], ['Terminal １', 'Terminal １０'],
  ['JR 東京', 'JR 神田'], ['東京 JR', '神田 JR'], ['JR 東京', 'JR 東京前'],
];
for (const [name, other] of ambiguous) test(`complete stop name ${name} excludes ${other} before distance and cap`, () => {
  const candidates = [stop(name, 'right-a'), stop(name, 'right-b', .0011), stop(other, 'wrong', .0001)];
  const before = structuredClone(candidates);
  for (const order of permutations(candidates)) {
    assert.deepEqual(pickStops(order, station([name])).map(s => s.id), ['right-a', 'right-b']);
    assert.deepEqual(pickStops(order, station([name]), 1).map(s => s.id), ['right-a']);
  }
  assert.deepEqual(candidates, before, 'candidate records are not mutated');
});

for (const [names, first, second] of [
  [['東京'], '東京', '東京 Tōkyō'],
  [['東京 Tōkyō'], '東京', 'Tōkyō'],
  [['Tōkyō (東京)'], '東京駅', 'Tōkyō'],
  [['東京'], '東京', '東京 (Tōkyō)'],
  [['東京'], '東京', '東京 (Tōkyō) Station'],
  [['JR 東京'], '東京 Tōkyō', '東京 JR'],
  [['東京 1 Tōkyō'], '東京 1 Tōkyō', '東京 1Tōkyō'],
  [['Москва'], 'Москва', 'Москва Moskva'],
  [['Αθήνα Athína'], 'Αθήνα', 'Athína'],
  [['München Hbf', 'Munich'], 'München Bahnhof', 'Munich Station'],
  [['Austin Station'], 'Austin', 'AUSTIN'],
  [['Gare de Lyon'], 'de Lyon', 'Gare de Lyon'],
  [['Terminal 1'], 'Terminal１', 'Terminal 1 (Platform 2)'],
  [['Central'], 'Central - Track 3a', 'Central (Gleis 10)'],
  [['Central'], 'Central (Platform A)', 'Central - Track B1'],
  [['Central'], 'Central (Platform 1/2)', 'Central - Track 2-3'],
  [['中央駅'], '中央', '中央 (2番線)'],
]) test(`complete aliases and station/platform normalization: ${names.join(' / ')}`, () => {
  const candidates = [stop(first, 'operator-a'), stop(second, 'operator-b', .0011), stop('Unrelated', 'wrong', .0001)];
  for (const order of permutations(candidates)) assert.deepEqual(pickStops(order, station(names)).map(s => s.id), ['operator-a', 'operator-b']);
});

test('mixed-script names do not turn a same-script prefix or a bare number into an alias', () => {
  for (const [name, other] of [['中央', '中央公園 Chūō Kōen'], ['Central', 'Central 1'], ['Terminal', 'Terminal 1']]) {
    assert.deepEqual(pickStops([stop(other, 'wrong', .0001), stop(name, 'right')], station([name])).map(s => s.id), ['right']);
  }
});

test('rail modes, 400 m radius, cap, and unmatched nearest fallback are unchanged', () => {
  const candidates = [stop('Central', 'bus', 0, ['BUS']), stop('Central', 'far', .004),
    stop('Central', 'inside', .0035, ['SUBWAY']), stop('Central', 'near', .001, ['HIGHSPEED_RAIL']),
    stop('Unrelated', 'nearest', .0001), {...stop('Central', 'place'), type:'PLACE'},
    {...stop('Central', 'no-location'), lat:null}];
  assert.deepEqual(pickStops(candidates, station(['Central'])).map(s => s.id), ['near', 'inside']);
  for (const names of [[], ['No match'], ['', null]]) {
    assert.deepEqual(pickStops(candidates, station(names)).map(s => s.id), ['nearest', 'near']);
  }
});

for (const [name, other] of [['Terminal 1', 'Terminal 10'], ['Central', 'Central Park'], ['中央', '中央公園']]) {
  test(`stationDepartures requests only the correct ${name} boards in every candidate order`, async () => {
    const candidates = [stop(name, 'right-a'), stop(name, 'right-b', .0011), stop(other, 'wrong', .0001)];
    for (const order of permutations(candidates)) {
      const calls = [], signal = new AbortController().signal;
      const board = await stationDepartures(station([name]), {signal, fetch:async (url, options) => {
        calls.push(new URL(url)); assert.equal(options.signal, signal);
        const id = new URL(url).searchParams.get('stopId');
        return {ok:true, json:async () => id === null ? order : {stopTimes:[{
          mode:'REGIONAL_RAIL', displayName:id === 'wrong' ? 'WRONG' : `RIGHT-${id}`,
          headsign:'Fixture terminus', tripId:id,
          place:{departure:'2099-01-01T12:00:00Z', scheduledDeparture:'2099-01-01T12:00:00Z', tz:'UTC'},
        }]}};
      }});
      assert.deepEqual(board.stops.map(s => s.id), ['right-a', 'right-b']);
      assert.deepEqual(board.stopResults, ['right-a', 'right-b'].map(stopId => ({stopId, status:'fulfilled'})));
      assert.deepEqual(board.rows.map(row => row.line).sort(), ['RIGHT-right-a', 'RIGHT-right-b']);
      assert.equal(calls.length, 3);
      assert.deepEqual(calls.slice(1).map(url => url.searchParams.get('stopId')), ['right-a', 'right-b']);
      assert.ok(calls.slice(1).every(url => url.searchParams.get('n') === '30'));
    }
  });
}
