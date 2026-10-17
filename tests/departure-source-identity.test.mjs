import test from 'node:test';
import assert from 'node:assert/strict';
import {departureRows, stationDepartures} from '../styles/departures.mjs';
import {departureItem} from '../styles/departures-ui.mjs';
import {JSDOM} from 'jsdom';

const at = '2099-01-01T12:00:00Z', now = Date.parse(at) - 600_000;
const trip = (source, id, date = '20990101', time = '11:00') => `${date}_${time}_${source}_${id}`;
const observation = (tripId, extra = {}, place = {}) => ({mode:'REGIONAL_RAIL', displayName:'R',
  headsign:'Central', tripId, routeId:'unrelated_route', ...extra,
  place:{departure:at, scheduledDeparture:at, stopId:`stop-${tripId}`, tz:'UTC', ...place}});
const rows = (lists, options = {}) => departureRows(lists, {now, count:100, ...options});
const permutations = items => items.length < 2 ? [items] : items.flatMap((item, i) =>
  permutations(items.filter((_, j) => j !== i)).map(rest => [item, ...rest]));

for (const [first, second] of [
  [trip('feed', 'one'), trip('feed', 'two')],
  [trip('feed', 'one'), trip('feed', 'one', '20990101', '11:05')],
  [trip('feed', 'one'), trip('feed', 'one', '20981231', '35:00')],
  [trip('feed-name', '_原始_+&trip'), trip('feed-name', '_原始_+&other')],
]) test(`same-source conflicting trip instances stay distinct: ${second}`, () => {
  const a = observation(first), b = observation(second, {realTime:true, cancelled:true},
    {departure:'2099-01-01T12:04:00Z', track:'9'});
  const input = [[a], [b]], before = structuredClone(input);
  for (const order of permutations(input)) {
    const actual = rows(order);
    assert.equal(actual.length, 2, 'one stop-board list is not necessarily one feed');
    assert.deepEqual(actual, rows([[a, b]]), 'no cancellation, platform, prediction or trip link crosses identities');
  }
  assert.deepEqual(input, before);
});

test('same-source same-instance observations still merge across boards', () => {
  const id = trip('feed', '_one_more'), a = observation(id), b = observation(id, {realTime:true, cancelled:true},
    {departure:'2099-01-01T12:04:00Z', track:'9'});
  for (const order of permutations([[a], [b]])) {
    const actual = rows(order);
    assert.equal(actual.length, 1);
    assert.deepEqual([actual[0].tripId, actual[0].live, actual[0].cancelled, actual[0].delay, actual[0].track],
      [id, true, true, 4, '9']);
  }
});

test('distinct source tags preserve the existing cross-feed reconciliation', () => {
  const a = observation(trip('feed-a', 'same'), {agencyName:'One agency'});
  const b = observation(trip('feed-b', 'same'), {agencyName:'One agency', cancelled:true});
  for (const order of permutations([[a], [b]])) {
    assert.equal(rows(order).length, 1, 'matching route/agency labels do not imply one dataset');
    assert.equal(rows(order)[0].cancelled, true);
  }
});

for (const id of ['', 'opaque-trip', 'feed_trip', '20990101_feed_trip', '20990101_11:00__trip',
  '20990101_11:00_feed_', '20990101_11:99_feed_trip', 'date_11:00_feed_trip',
  '20990230_11:00_feed_trip', '20991301_11:00_feed_trip'])
  test(`unrecognized or absent trip ID supplies no dataset identity: ${JSON.stringify(id)}`, () => {
    const a = observation(id), b = observation(trip('feed', 'other'));
    for (const order of permutations([[a], [b]])) assert.equal(rows(order).length, 1);
  });

test('source conflicts remain ambiguity witnesses instead of unlocking another match', () => {
  const a = observation(trip('feed', 'one')), conflict = observation(trip('feed', 'two'));
  const duplicate = observation(trip('different-feed', 'one'), {cancelled:true});
  for (const left of permutations([conflict, duplicate])) for (const order of permutations([[a], left])) {
    const actual = rows(order);
    assert.equal(actual.length, 3);
    assert.equal(actual.find(row => row.tripId === a.tripId).cancelled, false);
  }
});

test('a same-source conflict rejects the entire connected group without subgroup merging', () => {
  const a = observation(trip('feed', 'one')), b = observation(trip('other', 'one'), {cancelled:true});
  const c = observation(trip('feed', 'two'));
  for (const order of permutations([[a], [b], [c]])) {
    const actual = rows(order);
    assert.equal(actual.length, 3);
    assert.equal(actual.filter(row => row.cancelled).length, 1);
  }
});

test('expired same-source cancellation cannot cancel a distinct delayed trip', () => {
  const a = observation(trip('feed', 'one'), {cancelled:true});
  const b = observation(trip('feed', 'two'), {realTime:true}, {departure:'2099-01-01T12:14:00Z', track:'4'});
  const later = {now:Date.parse('2099-01-01T12:10:00Z')};
  for (const order of permutations([[a], [b]])) assert.deepEqual(rows(order, later), rows([[b]], later));
  for (const cancelledId of [b.tripId, trip('other', 'one')]) {
    const cancelled = {...a, tripId:cancelledId};
    for (const order of permutations([[cancelled], [b]])) {
      assert.deepEqual(rows(order, later), rows([[b]], later).map(row => ({...row, cancelled:true})));
    }
  }
});

test('same-source exact repeats within one board retain observation merging', () => {
  const a = observation(trip('feed', 'one')), b = {...a, cancelled:true};
  for (const order of permutations([a, b])) {
    assert.equal(rows([order]).length, 1);
    assert.equal(rows([order])[0].cancelled, true);
  }
});

test('selected boards preserve same-source trains, request limits and separate schedule links', async () => {
  const a = observation(trip('feed', 'one')), b = observation(trip('feed', 'two'), {cancelled:true}, {track:'9'});
  for (const order of permutations(['a', 'b'])) {
    const requests = [], signal = new AbortController().signal;
    const fetch = async (value, options) => {
      const url = new URL(value); requests.push({url, options});
      const body = url.pathname.endsWith('/reverse-geocode') ? order.map(id => ({
        type:'STOP', id:`feed_${id}`, name:'Central', lat:0, lon:0, modes:['REGIONAL_RAIL']})) :
        {stopTimes:[url.searchParams.get('stopId') === 'feed_a' ? a : b]};
      return {ok:true, json:async () => body};
    };
    const result = await stationDepartures({lat:0, lon:0, names:['Central']}, {fetch, signal});
    assert.equal(result.rows.length, 2);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(request => request.options.signal === signal));
    assert.ok(requests.slice(1).every(request => request.url.searchParams.get('n') === '30'));
    assert.deepEqual(result.stopResults.map(item => item.status), ['fulfilled', 'fulfilled']);
    const dom = new JSDOM('<!doctype html><body></body>'), tripRequests = [];
    for (const row of result.rows) dom.window.document.body.append(departureItem(dom.window.document, row, {
      load:async tripId => {tripRequests.push(tripId); throw new Error('Fixture schedule unavailable');},
    }));
    assert.equal(dom.window.document.querySelectorAll('.departure-trip').length, 2);
    assert.equal(dom.window.document.querySelectorAll('.cancelled').length, 1);
    for (const details of dom.window.document.querySelectorAll('.departure-trip')) {
      details.open = true;
      details.dispatchEvent(new dom.window.Event('toggle'));
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(new Set(tripRequests), new Set([a.tripId, b.tripId]));
    dom.window.close();
  }
});
