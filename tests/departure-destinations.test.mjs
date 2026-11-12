import test from 'node:test';
import assert from 'node:assert/strict';
import {departureRows, stationDepartures} from '../styles/departures.mjs';

const at = '2099-01-01T12:00:00Z', now = Date.parse(at) - 600_000;
const observation = (headsign, id = 'a', fields = {}) => ({mode:'REGIONAL_RAIL', displayName:'R',
  tripId:`trip-${id}`, routeId:`route-${id}`, headsign,
  place:{departure:at, scheduledDeparture:at, stopId:`stop-${id}`, tz:'UTC'}, ...fields});
const rows = lists => departureRows(lists, {now, count:100});
const orders = (a, b) => [[[a], [b]], [[b], [a]]];

const conflicting = [
  ['Terminal 1', 'Terminal 10'], ['Central', 'Central 2'], ['中央1', '中央10'],
  ['Terminal 1', 'Terminal 1-1'], ['Terminal 1', 'Terminal 1/2'],
  ['Terminal 1', 'Terminal 1.1'], ['Terminal 1', 'Terminal 1 − 1'],
  ['航廈１', '航廈１０'], ['محطة ١', 'محطة ١٠'],
  ['Terminal Ⅳ', 'Terminal ⅣⅢ'], ['Terminal 1', 'Terminal 1 / 第2航廈'],
];
for (const [a, b] of conflicting) test(`different numeric destinations remain separate: ${a} / ${b}`, () => {
  const first = observation(a), second = observation(b, 'b');
  const before = structuredClone([first, second]);
  for (const lists of orders(first, second)) {
    const result = rows(lists);
    assert.equal(result.length, 2);
    assert.deepEqual(new Set(result.map(row => row.headsign)), new Set([a, b]));
    assert.deepEqual(new Set(result.map(row => row.tripId)), new Set(['trip-a', 'trip-b']));
  }
  assert.deepEqual([first, second], before, 'observations are not changed');
});

for (const [a, b] of [
  ['Terminal 1', '(Local) Terminal 1'], ['Terminal 1', '第1航廈 Terminal 1'],
  ['Terminal 1', 'Terminal 1 / 第１航廈'], ['Terminal 1-2', '(Local) Terminal 1-2'],
  ['桜木町', '(普通 Local) 桜木町 Sakuragichō'], ['Central', '(Local) Central'],
]) test(`compatible numeric components and existing multilingual duplicates still merge: ${a} / ${b}`, () => {
  for (const lists of orders(observation(a), observation(b, 'b'))) assert.equal(rows(lists).length, 1);
});

test('numeric conflict cannot transfer cancellation, platform, prediction or trip identity', () => {
  const first = observation('Terminal 1');
  const second = observation('Terminal 10', 'b', {realTime:true, cancelled:true,
    place:{departure:'2099-01-01T12:04:00Z', scheduledDeparture:at, stopId:'stop-b', track:'9'}});
  for (const lists of orders(first, second)) {
    const result = rows(lists);
    assert.equal(result.length, 2);
    const a = result.find(row => row.tripId === 'trip-a'), b = result.find(row => row.tripId === 'trip-b');
    assert.deepEqual([a.live, a.cancelled, a.track, a.stopId, a.departure], [false, false, '', 'stop-a', Date.parse(at)]);
    assert.deepEqual([b.live, b.cancelled, b.track, b.stopId, b.delay], [true, true, '9', 'stop-b', 4]);
  }
});

test('numeric veto does not remove competitors from the original ambiguity graph', () => {
  const first = observation('Terminal 1', 'a'), competitor = observation('Terminal 10', 'b');
  const other = observation('Terminal 1', 'c', {cancelled:true});
  for (const list of [[first, competitor], [competitor, first]]) {
    for (const lists of [[list, [other]], [[other], list]]) {
      const result = rows(lists);
      assert.equal(result.length, 3, 'a formerly ambiguous match must not become a new merge');
      assert.equal(result.find(row => row.tripId === 'trip-a').cancelled, false);
      assert.equal(result.filter(row => row.cancelled).length, 1);
    }
  }
});

test('a numeric-conflicting multi-board group is rejected whole, without new subgroup matches', () => {
  const lists = [[observation('Terminal 1', 'a')], [observation('Terminal 10', 'b')],
    [observation('(Local) Terminal 10', 'c', {cancelled:true})]];
  for (const order of [lists, [...lists].reverse(), [lists[1], lists[0], lists[2]]]) {
    const result = rows(order);
    assert.equal(result.length, 3);
    assert.equal(result.find(row => row.tripId === 'trip-a').cancelled, false);
  }
});

test('same-board exact repeats and compatible groups retain live observations', () => {
  const first = observation('Terminal 1'), live = {...first, realTime:true,
    place:{...first.place, departure:'2099-01-01T12:03:00Z', track:'4'}};
  const other = observation('(Local) Terminal 1', 'b');
  for (const lists of [[[first, live], [other]], [[other], [live, first]]]) {
    const result = rows(lists);
    assert.equal(result.length, 1);
    assert.deepEqual([result[0].live, result[0].track, result[0].delay], [true, '4', 3]);
  }
});

test('selected stop boards retain both numbered destinations with normal request and outcome limits', async () => {
  for (const order of [['a', 'b'], ['b', 'a']]) {
    const requests = [], signal = new AbortController().signal;
    const fetch = async (value, options) => {
      const url = new URL(value); requests.push({url, options});
      const body = url.pathname.endsWith('/reverse-geocode') ? order.map(id => ({
        type:'STOP', id, name:'Central', lat:0, lon:0, modes:['REGIONAL_RAIL']})) : {stopTimes:[
        observation(url.searchParams.get('stopId') === 'a' ? 'Terminal 1' : 'Terminal 10', url.searchParams.get('stopId'))]};
      return {ok:true, json:async () => body};
    };
    const result = await stationDepartures({lat:0, lon:0, names:['Central']}, {fetch, signal});
    assert.equal(result.rows.length, 2);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(request => request.options.signal === signal));
    assert.ok(requests.slice(1).every(request => request.url.searchParams.get('n') === '30'));
    assert.deepEqual(result.stopResults.map(row => row.status), ['fulfilled', 'fulfilled']);
  }
});

// Destination text is identity evidence too, even when neither name has numbers.
const lexicalConflicts = [
  ['Central', 'Central Park'], ['Central', 'CentralPark'], ['York', 'New York'],
  ['中央', '中央公園'], ['東京', '新東京'], ['さいたま', 'さいたま新都心'],
  ['서울', '서울숲'], ['Москва', 'Москва Сити'], ['محطة', 'محطة الشمال'],
  ['Central', 'Central (North)'], ['Central', 'Central / Park'],
  ['Central', '(North) Central'], ['Central', '(Local Park) Central'],
  ['中央', '(North) 中央'], ['Central', 'Central (北)'], ['Central', 'Central北'],
  ['中央', '中央 A'], ['Central', 'Central 北'], ['中央', '中央 North'],
  ['Central', '中央 Central'], ['Москва', 'Москва Moscow'],
  ['中央 Central', '中央 Central Park'], ['中央 Central', '中央公園 Central'],
];
for (const [a, b] of lexicalConflicts) test(`distinct lexical destinations keep their own train state: ${a} / ${b}`, () => {
  const first = observation(a, 'a', {place:{departure:at, scheduledDeparture:at, stopId:'stop-a', track:'2'}});
  const second = observation(b, 'b', {realTime:true, cancelled:true,
    place:{departure:'2099-01-01T12:04:00Z', scheduledDeparture:at, stopId:'stop-b', track:'9'}});
  const before = structuredClone([first, second]);
  const expected = [...rows([[first]]), ...rows([[second]])];
  for (const lists of orders(first, second)) assert.deepEqual(rows(lists), expected);
  assert.deepEqual([first, second], before, 'destination checks do not mutate observations');
});

for (const [a, b] of [
  ['大宮', '(普通) 大宮'],
  ['桜木町', '桜木町 Sakuragichō'], ['Sakuragichō', '桜木町 Sakuragichō'],
  ['桜木町', 'Sakuragichō / 桜木町'], ['桜木町', '(Local) 桜木町 Sakuragichō'],
  ['桜木町', '（普通 Local） 桜木町 Sakuragichō'],
]) test(`complete multilingual components and recognized service labels remain compatible: ${a} / ${b}`, () => {
  const first = observation(a), second = observation(b, 'b', {cancelled:true, realTime:true,
    place:{departure:'2099-01-01T12:03:00Z', scheduledDeparture:at, stopId:'stop-b', track:'7'}});
  for (const lists of orders(first, second)) {
    const result = rows(lists);
    assert.equal(result.length, 1);
    assert.deepEqual([result[0].cancelled, result[0].live, result[0].delay, result[0].track], [true, true, 3, '7']);
  }
});

test('lexical conflicts cannot remove a competing train from the original ambiguity graph', () => {
  const first = observation('Central', 'a'), competitor = observation('Central Park', 'b');
  const other = observation('Central', 'c', {cancelled:true});
  for (const list of [[first, competitor], [competitor, first]]) for (const lists of [[list, [other]], [[other], list]]) {
    const result = rows(lists);
    assert.equal(result.length, 3, 'the veto must not create a formerly ambiguous merge');
    assert.equal(result.find(row => row.tripId === 'trip-a').cancelled, false);
  }
});

const permutations = items => items.length < 2 ? [items] : items.flatMap((item, i) =>
  permutations(items.filter((_, j) => i !== j)).map(rest => [item, ...rest]));
for (const names of [
  ['Central', 'Central Park', '(Local) Central Park'],
  ['中央', '中央 Central', '中央 Central Park'],
  ['Central', '中央 Central', '中央公園 Central'],
  ['桜木町', '桜木町 Sakuragichō', '桜木町 Sakuragichō North'],
  ['Central', 'Central (北)', '(Local) Central (北)'],
]) test(`a lexical conflict vetoes the entire connected group: ${names.join(' / ')}`, () => {
  const lists = names.map((name, i) => [observation(name, String(i), {cancelled:i === 2})]);
  for (const order of permutations(lists)) {
    const result = rows(order);
    assert.equal(result.length, 3, 'no safe-looking subgroup may merge after a conflict');
    assert.deepEqual(result.filter(row => row.cancelled).map(row => row.tripId), ['trip-2']);
  }
});

test('selected boards keep lexical destinations separate with normal bounded acquisition', async () => {
  for (const order of [['a','b'], ['b','a']]) for (const [a, b] of lexicalConflicts) {
    const requests = [];
    const fetch = async value => {
      const url = new URL(value); requests.push(url);
      const id = url.searchParams.get('stopId');
      return {ok:true, json:async () => url.pathname.endsWith('/reverse-geocode') ? order.map(id => ({
        type:'STOP', id, name:'Central', lat:0, lon:0, modes:['REGIONAL_RAIL']})) : {
          stopTimes:[observation(id === 'a' ? a : b, id, {cancelled:id === 'b'})]}};
    };
    const result = await stationDepartures({lat:0, lon:0, names:['Central']}, {fetch});
    assert.equal(result.rows.length, 2);
    assert.equal(requests.length, 3);
    assert.deepEqual(result.stopResults.map(row => row.status), ['fulfilled','fulfilled']);
  }
});


test('destination veto preserves standalone baseline coercion of malformed headsigns', async () => {
  // Row validation has a separate correction. This veto must not introduce a
  // new exception that loses a healthy sibling board on the standalone base.
  for (const headsign of [123, true, {name:'Central'}]) {
    const malformed = observation(headsign);
    const healthy = observation('Harbour', 'b');
    try {
      assert.equal(rows([[malformed]]).length, 1);
      for (const lists of orders(malformed, healthy)) {
        const result = rows(lists);
        assert.equal(result.length, 2);
        assert.equal(result.find(row => row.tripId === 'trip-b').headsign, 'Harbour');
      }
    } catch (error) {
      // The separate consumed-row validator may reject this input explicitly;
      // a new incidental TypeError from destination matching is never valid.
      assert.equal(error.message, 'Invalid Transitous stop times response');
    }
    const fetch = async value => {
      const url = new URL(value);
      return {ok:true, json:async () => url.pathname.endsWith('/reverse-geocode') ? ['a','b'].map(id => ({
        type:'STOP', id, name:'Central', lat:0, lon:0, modes:['REGIONAL_RAIL']})) : {
          stopTimes:[url.searchParams.get('stopId') === 'a' ? malformed : healthy]}};
    };
    const result = await stationDepartures({lat:0, lon:0, names:['Central']}, {fetch});
    assert.equal(result.rows.find(row => row.tripId === 'trip-b').headsign, 'Harbour');
    assert.equal(result.stopResults.find(row => row.stopId === 'b').status, 'fulfilled');
  }
});
