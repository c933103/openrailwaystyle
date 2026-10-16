import test from 'node:test';
import assert from 'node:assert/strict';
import {departureRows, stationDepartures} from '../styles/departures.mjs';
import {departureItem} from '../styles/departures-ui.mjs';
import {JSDOM} from 'jsdom';

const at = '2026-10-16T12:00:00Z', now = Date.parse('2026-10-16T12:10:00Z');
const observation = (id, fields = {}, place = {}) => ({mode:'REGIONAL_RAIL', displayName:'R', headsign:'Central',
  tripId:`trip-${id}`, routeId:`route-${id}`, ...fields,
  place:{scheduledDeparture:at, departure:at, tz:'UTC', stopId:`stop-${id}`, ...place}});
const delayed = (id, fields = {}, place = {}) => observation(id, {realTime:true, ...fields},
  {departure:'2026-10-16T12:14:00Z', track:'4', ...place});
const rows = lists => departureRows(lists, {now, count:100});
const permutations = items => items.length < 2 ? [items] : items.flatMap((item, i) =>
  permutations(items.filter((_, j) => j !== i)).map(rest => [item, ...rest]));
const listOrders = lists => permutations(lists).flatMap(order => order.reduce((variants, list) =>
  variants.flatMap(variant => permutations(list).map(rows => [...variant, rows])), [[]]));
const cancellation = flag => flag === 'place.cancelled' ? observation('a', {}, {cancelled:true}) : observation('a', {[flag]:true});

for (const flag of ['cancelled','tripCancelled','place.cancelled']) test(`expired cross-feed ${flag} survives the delayed train`, () => {
  const cancelled = cancellation(flag), live = delayed('b'), input = [[cancelled], [live]];
  const before = structuredClone(input), expected = {...rows([[live]])[0], cancelled:true};
  for (const lists of listOrders(input)) {
    assert.equal(departureRows(lists, {now:Date.parse('2026-10-16T11:59:00Z')})[0].cancelled, true);
    assert.deepEqual(rows(lists), [expected]);
    assert.deepEqual([expected.live, expected.delay, expected.track, expected.tripId, expected.stopId,
      expected.tripScheduled, expected.tripEvent], [true, 14, '4', 'trip-b', 'stop-b', Date.parse(at), 'departure']);
  }
  assert.deepEqual(input, before, 'source observations are not mutated');
});

test('expired wildcard cannot bridge or cancel distinct upcoming line groups', () => {
  const expired = observation('a', {displayName:'', cancelled:true});
  const live = [delayed('b', {displayName:'R1'}), delayed('c', {displayName:'R2'})];
  const expected = rows(live.map(row => [row]));
  for (const lists of listOrders([[expired], ...live.map(row => [row])])) assert.deepEqual(rows(lists), expected);
  assert.equal(expected.length, 2);
  assert.ok(expected.every(row => !row.cancelled));
});

test('an expired wildcard also cannot bridge distinct known lines when only one is still ahead', () => {
  const expired = observation('a', {displayName:'', cancelled:true});
  const other = observation('c', {displayName:'R2'}), live = delayed('b', {displayName:'R1'});
  for (const lists of listOrders([[expired], [live], [other]])) assert.deepEqual(rows(lists), rows([[live]]));
});

test('an expired observation can cancel an already merged upcoming group without changing it', () => {
  const expired = cancellation('cancelled');
  const live = [delayed('b'), delayed('c', {}, {departure:'2026-10-16T12:16:00Z', track:'7'})];
  const expected = rows(live.map(row => [row])).map(row => ({...row, cancelled:true}));
  for (const lists of listOrders([[expired], ...live.map(row => [row])])) assert.deepEqual(rows(lists), expected);
  assert.equal(expected.length, 1);
  assert.equal(expected[0].delay, 16);
});

test('expired same-list competitors remain ambiguity witnesses before time and destination vetoes', () => {
  const cancelled = cancellation('cancelled'), live = delayed('b');
  for (const competitor of [
    observation('competitor'),
    observation('competitor', {}, {scheduledDeparture:'2026-10-16T12:00:30Z'}),
    observation('competitor', {headsign:'Central Park'}),
    observation('competitor', {headsign:'Central 2'}),
  ]) for (const lists of listOrders([[cancelled, competitor], [live]])) {
    assert.deepEqual(rows(lists), rows([[live]]));
  }
});

test('expired competitors cannot erase an upcoming ambiguity edge and unlock cancellation', () => {
  const live = delayed('u'), competitor = observation('d');
  for (const vetoed of [
    delayed('v', {}, {scheduledDeparture:'2026-10-16T12:00:30Z'}),
    delayed('v', {headsign:'Central Park'}),
    delayed('v', {headsign:'Central 2'}),
  ]) for (const flag of ['cancelled','tripCancelled','place.cancelled']) {
    const expected = rows([[live], [vetoed]]);
    assert.equal(expected.length, 2);
    for (const lists of listOrders([[live], [vetoed, competitor], [cancellation(flag)]])) {
      assert.deepEqual(rows(lists), expected);
    }
  }
});

test('expired competitors cannot hide another known line from a wildcard cancellation', () => {
  const live = delayed('u', {displayName:'R1'}), other = delayed('v', {displayName:'R2'});
  const competitor = observation('d', {displayName:'R2'});
  const expired = observation('c', {displayName:'', cancelled:true});
  const expected = rows([[live], [other]]);
  for (const lists of listOrders([[live], [other, competitor], [expired]])) assert.deepEqual(rows(lists), expected);
});

test('expired-only witnesses also survive added same-list competition', () => {
  const live = delayed('u'), competitor = observation('d'), cancelled = cancellation('cancelled');
  for (const vetoed of [
    observation('e', {}, {scheduledDeparture:'2026-10-16T12:00:30Z'}),
    observation('e', {headsign:'Central Park'}),
    observation('e', {headsign:'Central 2'}),
  ]) for (const lists of listOrders([[live], [vetoed, competitor], [cancelled]])) {
    assert.deepEqual(rows(lists), rows([[live]]));
  }
});

test('upcoming same-list competition and different same-feed identities cannot borrow cancellation', () => {
  const cancelled = cancellation('cancelled'), live = delayed('b'), competitor = delayed('c');
  for (const lists of listOrders([[cancelled], [live, competitor]])) assert.deepEqual(rows(lists), rows([[live, competitor]]));
  for (const list of permutations([cancelled, live])) assert.deepEqual(rows([list]), rows([[live]]));
});

test('expired cancellation retains mode, matching-line, exact-second and destination vetoes', () => {
  const live = delayed('b');
  for (const expired of [
    observation('a', {cancelled:true, mode:'TRAM'}),
    observation('a', {cancelled:true, displayName:'R2'}),
    observation('a', {cancelled:true}, {scheduledDeparture:'2026-10-16T12:00:30Z'}),
    observation('a', {cancelled:true, headsign:'Central Park'}),
    observation('a', {cancelled:true, headsign:'Central 2'}),
    observation('a', {cancelled:true, headsign:''}),
    observation('a', {cancelled:true}, {scheduledDeparture:'invalid'}),
  ]) for (const lists of listOrders([[expired], [live]])) assert.deepEqual(rows(lists), rows([[live]]));
});

test('a vetoed expanded group does not create a new safe-looking cancellation subgroup', () => {
  const live = delayed('b', {headsign:'Terminal 1'});
  const expired = [observation('a', {headsign:'Terminal 1', cancelled:true}), observation('c', {headsign:'Terminal 10'})];
  for (const lists of listOrders([[live], ...expired.map(row => [row])])) assert.deepEqual(rows(lists), rows([[live]]));
});

test('expiry never introduces presentation, prediction or trip identity from non-upcoming rows', () => {
  const live = delayed('b', {displayName:''});
  const expired = observation('a', {cancelled:true, realTime:true, displayName:'Named R', routeColor:'ff0000'}, {track:'9'});
  for (const lists of listOrders([[expired], [live]])) assert.deepEqual(rows(lists), [{...rows([[live]])[0], cancelled:true}]);
  assert.deepEqual(rows([[observation('a')], [live]]), rows([[live]]), 'ordinary expired rows do not enrich the live board');
});

test('fully expired boards stay empty and the existing one-minute cutoff is unchanged', () => {
  for (const lists of listOrders([[cancellation('cancelled')], [observation('b')]])) assert.deepEqual(rows(lists), []);
  const cancelled = cancellation('cancelled');
  assert.equal(departureRows([[cancelled]], {now:Date.parse(at) + 60_000}).length, 1);
  assert.deepEqual(departureRows([[cancelled]], {now:Date.parse(at) + 60_001}), []);
});

test('selected boards preserve cancellation with the same bounded acquisition and abort signal', async () => {
  // Use the normal wall clock: the cancellation is ten minutes old, and only
  // the matching delayed train is still ahead.
  const scheduled = new Date(Date.now() - 600_000).toISOString(), departure = new Date(Date.parse(scheduled) + 840_000).toISOString();
  for (const order of [['a','b'], ['b','a']]) {
    const requests = [], signal = new AbortController().signal;
    const fetch = async (value, options) => {
      const url = new URL(value); requests.push({url, options});
      const body = url.pathname.endsWith('/reverse-geocode') ? order.map(id => ({
        type:'STOP', id, name:'Central', lat:0, lon:0, modes:['REGIONAL_RAIL']})) : {stopTimes:[
        url.searchParams.get('stopId') === 'a' ? observation('a', {cancelled:true}, {scheduledDeparture:scheduled, departure:scheduled})
          : delayed('b', {}, {scheduledDeparture:scheduled, departure})]};
      return {ok:true, json:async () => body};
    };
    const result = await stationDepartures({lat:0, lon:0, names:['Central']}, {fetch, signal});
    assert.equal(result.rows.length, 1);
    assert.deepEqual([result.rows[0].cancelled, result.rows[0].live, result.rows[0].delay, result.rows[0].track], [true,true,14,'4']);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(request => request.options.signal === signal));
    assert.ok(requests.slice(1).every(request => request.url.searchParams.get('n') === '30'));
    assert.deepEqual(result.stopResults.map(row => row.status), ['fulfilled','fulfilled']);
  }
});


test('cancelled board presentation keeps live platform and opens the coherent trip occurrence', async t => {
  const dom = new JSDOM('<ol></ol>'), document = dom.window.document;
  t.after(() => dom.window.close());
  for (const flag of ['cancelled','tripCancelled','place.cancelled']) {
    for (const lists of listOrders([[cancellation(flag)], [delayed('b')]])) {
      const [row] = rows(lists), requests = [], stops = [
        {name:'Unrelated expired feed stop', stopId:'stop-a', scheduledDeparture:Date.parse(at), departure:Date.parse(at), tz:'UTC'},
        {name:'Selected live occurrence', stopId:'stop-b', scheduledDeparture:Date.parse(at), departure:row.departure, tz:'UTC'},
        {name:'Later loop occurrence', stopId:'stop-b', scheduledDeparture:Date.parse(at) + 3_600_000, departure:row.departure + 3_600_000, tz:'UTC'},
      ];
      const response = Promise.withResolvers();
      const item = departureItem(document, row, {load:id => {requests.push(id); return response.promise;}});
      document.querySelector('ol').replaceChildren(item);
      assert.equal(item.querySelector('.departure-status').textContent, 'Cancelled');
      assert.equal(item.querySelector('.departure-time.cancelled').textContent, '12:00');
      assert.equal(item.querySelector('.departure-track').textContent, 'Pl. 4');
      assert.deepEqual(requests, [], 'a cancellation does not prefetch a trip');
      const details = item.querySelector('details');
      const toggle = new Promise(resolve => details.addEventListener('toggle', resolve, {once:true}));
      details.open = true; await toggle;
      assert.deepEqual(requests, ['trip-b']);
      response.resolve(stops); await response.promise;
      assert.equal(item.querySelectorAll('.trip-current-stop').length, 1);
      assert.equal(item.querySelector('.trip-current-stop th').textContent, 'Selected live occurrence');
    }
  }
});
