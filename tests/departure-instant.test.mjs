import test from 'node:test';
import assert from 'node:assert/strict';
import {departureRows, stationDepartures} from '../styles/departures.mjs';

const at = '2099-01-01T12:00:00Z', now = Date.parse(at) - 600_000;
const observation = (scheduled = at, fields = {}) => ({mode: 'TRAM', displayName: 'T1', headsign: 'Central',
  tripId: 'feed-a_trip', routeId: 'feed-a_route',
  place: {scheduledDeparture: scheduled, departure: scheduled, stopId: 'feed-a_stop'}, ...fields});
const rows = lists => departureRows(lists, {now, count: 100});
const orders = (a, b) => [[[a], [b]], [[b], [a]]];

for (const mode of ['TRAM', 'SUBWAY', 'REGIONAL_RAIL']) {
  for (const difference of [1, 500, 1000, 30_000, 59_999]) {
    test(`${mode}: cross-list schedules ${difference} ms apart remain distinct within one minute`, () => {
      const first = observation(at, {mode});
      const later = observation(new Date(Date.parse(at) + difference).toISOString(), {
        mode, tripId: 'feed-b_trip', routeId: 'feed-b_route'});
      for (const lists of orders(first, later)) {
        const result = rows(lists);
        assert.equal(result.length, 2);
        assert.deepEqual(result.map(row => row.scheduled), [Date.parse(at), Date.parse(at) + difference]);
        assert.deepEqual(result.map(row => row.tripId), ['feed-a_trip', 'feed-b_trip']);
      }
    });
  }
}

for (const equivalent of ['2099-01-01T13:00:00+01:00', '2099-01-01T07:00:00-05:00',
  '2099-01-01T21:00:00.000+09:00', '2099-01-01T12:00:00.000Z']) {
  test(`equal scheduled instant merges across offset/precision spelling: ${equivalent}`, () => {
    const first = observation();
    const second = observation(equivalent, {tripId: 'feed-b_trip', routeId: 'feed-b_route',
      headsign: '(Local) Central', realTime: true, cancelled: true,
      place: {scheduledDeparture: equivalent, departure: '2099-01-01T12:04:00Z', stopId: 'feed-b_stop', track: '4'}});
    for (const lists of orders(first, second)) {
      const result = rows(lists);
      assert.equal(result.length, 1);
      assert.deepEqual([result[0].scheduled, result[0].live, result[0].delay, result[0].track, result[0].cancelled],
        [Date.parse(at), true, 4, '4', true]);
    }
  });
}

test('different schedules cannot transfer cancellation, delay, platform or trip linkage at one live instant', () => {
  const first = observation();
  const second = observation('2099-01-01T12:00:30Z', {tripId: 'feed-b_trip', cancelled: true, realTime: true,
    place: {scheduledDeparture: '2099-01-01T12:00:30Z', departure: at, stopId: 'feed-b_stop', track: '9'}});
  const expected = rows([[first], [second]]);
  for (const lists of orders(first, second)) {
    const result = rows(lists);
    assert.equal(result.length, 2);
    assert.deepEqual(result, expected);
    const a = result.find(row => row.tripId === first.tripId), b = result.find(row => row.tripId === second.tripId);
    assert.deepEqual([a.cancelled, a.live, a.track, a.stopId], [false, false, '', 'feed-a_stop']);
    assert.deepEqual([b.cancelled, b.live, b.track, b.stopId], [true, true, '9', 'feed-b_stop']);
  }
});

test('invalid scheduled timestamps never authorize a cross-list merge', () => {
  for (const invalid of ['', 'not-a-date']) {
    const first = observation(at, {place: {scheduledDeparture: invalid, departure: at}});
    const second = {...first, tripId: 'feed-b_trip'};
    for (const lists of orders(first, second)) assert.equal(rows(lists).length, 2);
  }
});

test('missing schedule preserves existing actual-time fallback with exact instant comparisons', () => {
  for (const absent of [undefined, null]) {
    const first = observation(at, {place: {scheduledDeparture: absent, departure: at}});
    const equal = observation(at, {tripId: 'feed-b_trip', place: {departure: '2099-01-01T13:00:00+01:00'}});
    const later = {...equal, place: {departure: '2099-01-01T12:00:30Z'}};
    for (const lists of orders(first, equal)) assert.equal(rows(lists).length, 1);
    for (const lists of orders(first, later)) assert.equal(rows(lists).length, 2);
  }
});

test('missing or invalid actual timestamps still drop unusable rows', () => {
  for (const departure of [undefined, null, '', 'not-a-date']) {
    const invalid = observation(at, {place: {scheduledDeparture: at, departure}});
    assert.equal(rows([[observation()], [invalid]]).length, 1);
  }
});

test('arrival-only observations use their exact scheduled instant', () => {
  const arrival = scheduled => observation(at, {place: {scheduledArrival: scheduled, arrival: scheduled}});
  assert.equal(rows([[arrival(at)], [arrival('2099-01-01T13:00:00+01:00')]]).length, 1);
  assert.equal(rows([[arrival(at)], [arrival('2099-01-01T12:00:30Z')]]).length, 2);
});

test('exact instants preserve simultaneous ambiguity and other existing cross-feed guards', () => {
  const first = observation(), second = observation(at, {tripId: 'feed-a_second'});
  const other = observation(at, {tripId: 'feed-b_trip'});
  for (const list of [[first, second], [second, first]]) for (const lists of [[list, [other]], [[other], list]]) {
    assert.equal(rows(lists).length, 3, 'another feed cannot select one simultaneous train');
  }
  for (const other of [observation(at, {mode: 'REGIONAL_RAIL'}), observation(at, {displayName: 'T2'}),
    observation(at, {headsign: ''}), observation(at, {headsign: 'Airport'})]) {
    for (const lists of orders(first, other)) assert.equal(rows(lists).length, 2);
  }
});

test('selected stop-board acquisition preserves two same-minute trains and bounded requests', async () => {
  for (const order of [['a', 'b'], ['b', 'a']]) {
    const requests = [];
    const fetch = async value => {
      const url = new URL(value); requests.push(url);
      const body = url.pathname.endsWith('/reverse-geocode') ? order.map(id => ({
        type: 'STOP', id, name: 'Central', lat: 0, lon: 0, modes: ['TRAM']})) : {stopTimes: [
        url.searchParams.get('stopId') === 'a' ? observation() : observation('2099-01-01T12:00:30Z', {tripId: 'feed-b_trip'})]};
      return {ok: true, json: async () => body};
    };
    const result = await stationDepartures({lat: 0, lon: 0, names: ['Central']}, {fetch});
    assert.equal(result.rows.length, 2);
    assert.deepEqual(result.rows.map(row => row.scheduled), [Date.parse(at), Date.parse(at) + 30_000]);
    assert.equal(requests.length, 3);
    assert.deepEqual(result.stopResults.map(row => row.status), ['fulfilled', 'fulfilled']);
  }
});

test('equal nonzero milliseconds and service dates are compared as absolute instants', () => {
  assert.equal(rows([[observation('2099-01-01T12:00:00.123Z')],
    [observation('2099-01-01T21:00:00.123+09:00')]]).length, 1);
  assert.equal(rows([[observation(at)], [observation('2099-01-02T12:00:00Z')]]).length, 2);
});

test('shared IDs remain available without overriding conflicting stop-event times', () => {
  const first = observation(), later = observation('2099-01-01T12:00:30Z');
  for (const lists of orders(first, later)) {
    const result = rows(lists);
    assert.equal(result.length, 2, 'one trip can visit a nearby or repeated stop at a different time');
    assert.ok(result.every(row => row.tripId === 'feed-a_trip' && row.stopId === 'feed-a_stop'));
    assert.deepEqual(result.map(row => row.tripScheduled), [Date.parse(at), Date.parse(at) + 30_000]);
  }
  assert.equal(rows([[first], [structuredClone(first)]]).length, 1, 'equal-instant shared identities still merge');
});

test('a precision-conflicting competitor still blocks cancellation transfer to another train', () => {
  const first = observation(at, {tripId: 'trip-a'});
  const competitor = observation('2099-01-01T12:00:30Z', {tripId: 'trip-b'});
  const conflicting = observation(at, {tripId: 'trip-b', cancelled: true});
  for (const list of [[first, competitor], [competitor, first]]) {
    for (const lists of [[list, [conflicting]], [[conflicting], list]]) {
      const result = rows(lists);
      assert.equal(result.length, 3, 'the old minute-level ambiguity must not become a new exact-time match');
      assert.equal(result.find(row => row.tripId === 'trip-a').cancelled, false);
      assert.equal(result.filter(row => row.cancelled).length, 1);
      assert.equal(result.find(row => row.cancelled).tripId, 'trip-b');
    }
  }
});

test('a multi-board ambiguous group does not split into newly mergeable exact-time components', () => {
  const first = observation(at, {tripId: 'trip-a', headsign: 'Central'});
  const second = observation('2099-01-01T12:00:30Z', {tripId: 'trip-b', headsign: 'West Airport'});
  const bridge = observation(at, {tripId: 'trip-c', headsign: 'Central West'});
  const other = observation(at, {tripId: 'trip-d', headsign: 'West', cancelled: true});
  const lists = [[first, second], [bridge], [other]];
  for (const order of [lists, [lists[2], lists[1], lists[0]], [lists[1], lists[0], lists[2]]]) {
    const result = rows(order);
    assert.equal(result.length, 4);
    assert.equal(result.find(row => row.tripId === 'trip-a').cancelled, false);
  }
});
