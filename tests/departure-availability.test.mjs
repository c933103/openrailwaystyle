import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {stationDepartures, departureRows, plannerLink, TRANSITOUS_SOURCES} from '../styles/departures.mjs';
import {departureItem} from '../styles/departures-ui.mjs';
import {displayName, osmObject} from '../styles/map-model.mjs';

const station = {lat: 0, lon: 0, names: ['Central']};
const stop = id => ({type: 'STOP', id, name: 'Central', lat: 0, lon: 0, modes: ['REGIONAL_RAIL']});
const observation = {mode: 'REGIONAL_RAIL', displayName: 'R7', headsign: 'Harbour',
  tripId: 'fixture-trip', routeId: 'fixture-route',
  place: {stopId: 'a', departure: '2099-01-01T12:00:00Z', scheduledDeparture: '2099-01-01T12:00:00Z', tz: 'UTC'}};
const failure = new Error('synthetic private error text must not appear in result or UI');
function fixture({order = ['a', 'b'], failed = [], times = [], failureKind = 'network', candidates = order.map(stop), bodies = {}} = {}) {
  const calls = [], before = structuredClone(times);
  return {calls, before, fetch: async (url, options) => {
    calls.push({url: new URL(url), options});
    if (url.includes('/reverse-geocode')) return {ok: true, json: async () => candidates};
    const id = new URL(url).searchParams.get('stopId');
    if (failed.includes(id)) {
      if (failureKind === 'http') return {ok: false, status: 503};
      if (failureKind === 'json') return {ok: true, json: async () => {throw failure;}};
      if (failureKind === 'abort') throw new DOMException('Synthetic abort', 'AbortError');
      throw failure;
    }
    return {ok: true, json: async () => Object.hasOwn(bodies, id) ? bodies[id] : {stopTimes: times}};
  }};
}
const statuses = board => Object.fromEntries(board.stopResults.map(r => [r.stopId, r.status]));

for (const order of [['a', 'b'], ['b', 'a']]) for (const times of [[], [observation]]) {
  test(`partial ${times.length ? 'rows' : 'empty'} preserves safe per-stop outcomes in ${order} order`, async () => {
    for (const failureKind of ['network', 'http', 'json', 'abort']) {
      const feed = fixture({order, times, failed: ['b'], failureKind}), signal = new AbortController().signal;
      const board = await stationDepartures(station, {fetch: feed.fetch, signal});
      assert.deepEqual(board.stops, order.map(stop));
      assert.deepEqual(statuses(board), {a: 'fulfilled', b: 'rejected'});
      assert.deepEqual(board.stopResults.map(r => Object.keys(r)), [['stopId', 'status'], ['stopId', 'status']]);
      assert.deepEqual(board.rows, departureRows([times]));
      assert.deepEqual(times, feed.before, 'source observations stay unchanged');
      assert.equal(JSON.stringify(board).includes(failure.message), false);
      assert.equal(feed.calls.length, 3, 'one lookup and the existing two stop requests, with no retry');
      assert.ok(feed.calls.every(call => call.options.signal === signal));
      assert.ok(feed.calls.slice(1).every(call => call.url.searchParams.get('n') === '30'));
    }
  });
}

test('complete empty and populated results retain both successful stop outcomes', async () => {
  for (const times of [[], [observation]]) {
    const feed = fixture({times});
    const board = await stationDepartures(station, {fetch: feed.fetch});
    assert.deepEqual(statuses(board), {a: 'fulfilled', b: 'fulfilled'});
    assert.deepEqual(board.rows, departureRows([times, times]), 'existing identity reconciliation is unchanged');
  }
});

test('no matching stops, selected-stop limit, and all-failed behavior remain bounded', async () => {
  const none = fixture({order: []});
  assert.deepEqual(await stationDepartures(station, {fetch: none.fetch}), {stops: [], rows: [], stopResults: []});
  assert.equal(none.calls.length, 1);
  const many = fixture({order: ['a', 'b', 'c']});
  assert.equal((await stationDepartures(station, {fetch: many.fetch})).stopResults.length, 2);
  assert.equal(many.calls.length, 3);
  for (const order of [['a', 'b'], ['b', 'a']]) {
    const failed = fixture({order, failed: order});
    await assert.rejects(stationDepartures(station, {fetch: failed.fetch}), error => error === failure);
    assert.equal(failed.calls.length, 3);
  }
});

// Validate the consumed row shape as well as its envelope. Unused provider
// extensions and fields of intentionally excluded modes remain outside it.
const malformedRows = [
  ...[null, undefined, false, true, 0, 1, '', 'synthetic private row', []].map((row, i) => [`scalar row ${i}`, row]),
  ...[false, 0, {}, []].map((mode, i) => [`mode ${i}`, {...observation, mode}]),
  ...['displayName', 'routeShortName', 'tripShortName', 'routeLongName', 'headsign', 'routeId', 'tripId', 'routeColor', 'routeTextColor']
    .flatMap(field => [false, 7, [], {private:'synthetic private'}].map((value, i) => [`${field} ${i}`, {...observation, [field]:value}])),
  ...[false, 7, 'synthetic private', []].map((place, i) => [`place ${i}`, {...observation, place}]),
  ...['departure', 'arrival', 'scheduledDeparture', 'scheduledArrival', 'tz', 'track', 'scheduledTrack', 'stopId']
    .flatMap(field => [false, 7, [], {private:'synthetic private'}].map((value, i) => [`place.${field} ${i}`, {...observation, place:{...observation.place, [field]:value}}])),
  ...[false, 7, 'synthetic private', []].map((tripTo, i) => [`tripTo ${i}`, {...observation, headsign:'', tripTo}]),
  ...[false, 7, [], {private:'synthetic private'}].map((name, i) => [`tripTo.name ${i}`, {...observation, headsign:'', tripTo:{name}}]),
  ...['realTime', 'cancelled', 'tripCancelled'].map(field => [field, {...observation, [field]:'true'}]),
  ['place.cancelled', {...observation, place:{...observation.place, cancelled:'true'}}],
];
const malformedBoards = [
  ['null body', null], ['undefined body', undefined], ['array body', []],
  ['false body', false], ['true body', true], ['zero body', 0], ['number body', 1],
  ['empty string body', ''], ['string body', 'synthetic private provider response'],
  ['missing list', {}], ['undefined list', {stopTimes: undefined}], ['null list', {stopTimes: null}],
  ['false list', {stopTimes: false}], ['true list', {stopTimes: true}],
  ['zero list', {stopTimes: 0}], ['number list', {stopTimes: 1}],
  ['empty string list', {stopTimes: ''}], ['string list', {stopTimes: 'synthetic private provider response'}],
  ['object list', {stopTimes: {private: 'synthetic private provider response'}}],
  ...malformedRows.map(([label, row]) => [`row ${label}`, {stopTimes:[row]}]),
];
const invalidBoardMessage = 'Invalid Transitous stop times response';
for (const [label, body] of malformedBoards) test(`malformed board ${label} rejects before settlement and preserves each healthy sibling`, async () => {
  const single = fixture({order: ['b'], bodies: {b: body}});
  await assert.rejects(stationDepartures(station, {fetch: single.fetch}), error => error.message === invalidBoardMessage);
  assert.equal(single.calls.length, 2);
  for (const order of [['a', 'b'], ['b', 'a']]) for (const times of [[], [observation]]) {
    const feed = fixture({order, times, bodies: {b: body}}), signal = new AbortController().signal;
    const board = await stationDepartures(station, {fetch: feed.fetch, signal});
    assert.deepEqual(board.stops, order.map(stop));
    assert.deepEqual(statuses(board), {a: 'fulfilled', b: 'rejected'});
    assert.deepEqual(board.stopResults.map(r => Object.keys(r)), [['stopId', 'status'], ['stopId', 'status']]);
    assert.deepEqual(board.rows, departureRows([times]), 'malformed siblings never erase healthy rows');
    assert.deepEqual(times, feed.before);
    assert.equal(JSON.stringify(board).includes('synthetic private'), false);
    assert.equal(feed.calls.length, 3, 'same bounded requests, no retries');
    assert.ok(feed.calls.every(call => call.options.signal === signal));
  }
});

test('a malformed row rejects its whole board without leaking earlier parsed rows', async () => {
  for (const rows of [[observation, null], [null, observation]]) for (const order of [['a','b'], ['b','a']]) {
    const feed = fixture({order, bodies:{a:{stopTimes:[]}, b:{stopTimes:rows}}});
    const board = await stationDepartures(station, {fetch:feed.fetch});
    assert.deepEqual(statuses(board), {a:'fulfilled', b:'rejected'});
    assert.deepEqual(board.rows, []);
    assert.equal(feed.calls.length, 3);
    assert.throws(() => departureRows([rows]), {message:invalidBoardMessage});
  }
});

test('valid excluded modes, nullable optional fields, and unused extensions do not fail a board', async () => {
  const optional = Object.fromEntries(['displayName','routeShortName','tripShortName','routeLongName','headsign',
    'routeId','tripId','routeColor','routeTextColor','realTime','cancelled','tripCancelled','tripTo'].map(field => [field,null]));
  for (const times of [[], [{mode:null}], [{mode:''}], [{...observation, place:null}], [{...observation, place:undefined}], [{mode:'BUS'}], [{mode:'FERRY', place:'unused', headsign:{unused:true}}],
    [{mode:'FUTURE_UNSUPPORTED_MODE', extension:{private:'unused'}}],
    [{...observation, ...optional, place:{...observation.place, track:null, tz:null, cancelled:null}, extension:{ignored:true}}],
    [{...observation, tripTo:{unused:'synthetic private'}, extension:{toString:{ignored:true}}}],
    [{...observation, headsign:'', tripTo:{name:'Fallback terminus'}}],
    [{...observation, place:{...observation.place, departure:'invalid date'}}],
  ]) {
    const before = structuredClone(times), feed = fixture({times});
    const board = await stationDepartures(station, {fetch:feed.fetch});
    assert.deepEqual(statuses(board), {a:'fulfilled', b:'fulfilled'});
    assert.deepEqual(board.rows, departureRows([times, times]));
    assert.deepEqual(times, before);
    assert.equal(feed.calls.length, 3);
  }
});

test('valid board envelopes allow empty lists, populated lists, and unused extension fields', async () => {
  for (const times of [[], [observation]]) {
    const body = {stopTimes: times, extension: {ignored: true}}, before = structuredClone(body);
    const feed = fixture({bodies: {a: body, b: body}});
    const board = await stationDepartures(station, {fetch: feed.fetch});
    assert.deepEqual(statuses(board), {a: 'fulfilled', b: 'fulfilled'});
    assert.deepEqual(board.rows, departureRows([times, times]));
    assert.deepEqual(body, before);
    assert.equal(feed.calls.length, 3);
  }
});

test('all malformed boards reject in either selected-stop order with a generic error', async () => {
  for (const order of [['a', 'b'], ['b', 'a']]) for (const [label, body] of malformedBoards) {
    const feed = fixture({order, bodies: {a: body, b: {stopTimes: {error: 'synthetic private'}}}});
    await assert.rejects(stationDepartures(station, {fetch: feed.fetch}), error => error.message === invalidBoardMessage, label);
    assert.equal(feed.calls.length, 3);
  }
});

// Execute the production renderer and cache against a real DOM, with only its
// external dependencies injected. The actual stationDepartures parser is used.
const app = await readFile(new URL('../styles/app.mjs', import.meta.url), 'utf8');
const renderer = app.slice(app.indexOf('const departureBoards = new Map();'), app.indexOf('// Level-crossing equipment'));
function boardDom(feed) {
  const dom = new JSDOM('<div id="panel"></div>'), document = dom.window.document;
  let now = 1000;
  const settings = {language: 'en'};
  const context = vm.createContext({document, AbortSignal, departureItem, plannerLink, TRANSITOUS_SOURCES,
    Date: {now: () => now}, settings, displayName, osmObject,
    stationDepartures: (station, options) => stationDepartures(station, {...options, fetch: (...args) => feed.current.fetch(...args)}),
    textNode: (tag, text, className = '') => {
      const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
    }});
  const {showDepartures, departureBoards} = vm.runInContext(`${renderer}\n({showDepartures, departureBoards})`, context);
  const panel = document.querySelector('#panel');
  return {dom, panel, departureBoards, advance: ms => {now += ms;}, language: value => {settings.language = value;},
    show: (properties = 'Central', extra = {}) => {
      panel.replaceChildren();
      showDepartures(panel, {...extra, properties: typeof properties === 'string' ? {name: properties} : properties, geometry: extra.geometry || {coordinates: [0, 0]}});
    },
    settle: async () => {
      await Promise.allSettled([...departureBoards.values()].map(board => board.promise));
      await new Promise(resolve => setImmediate(resolve));
    }};
}
const partialMessage = 'Some departures could not load. The board may be incomplete.';
test('DOM keeps numeric destination conflicts separate through cached and translated redraws', async () => {
  for (const order of [['a','b'], ['b','a']]) for (const [a, b] of [
    ['Terminal 1','Terminal 10'], ['Central','Central 2'], ['中央1','中央10'],
  ]) {
    const bodies = {a:{stopTimes:[{...observation, tripId:'trip-a', headsign:a}]},
      b:{stopTimes:[{...observation, tripId:'trip-b', headsign:b, cancelled:true}]}};
    const feed = {current:fixture({order, bodies})}, view = boardDom(feed);
    try {
      const station = {id:'numeric-destinations', name:'Central', 'name:en':'Central', 'name:ja':'中央'};
      for (const language of ['en','ja','en']) {
        view.language(language); view.show(station); await view.settle();
        assert.deepEqual(new Set([...view.panel.querySelectorAll('.departure-headsign')].map(node => node.textContent)), new Set([a,b]));
        assert.equal(view.panel.querySelectorAll('.departure-status').length, 1, 'cancellation belongs only to its own train');
        assert.equal(view.panel.querySelector('.departure-status').closest('li').querySelector('.departure-headsign').textContent, b);
        assert.equal(view.panel.querySelectorAll('.departure-warning').length, 0);
        assert.equal(feed.current.calls.length, 3, 'normal redraws do not request another board');
      }
      view.advance(60_001); view.show(station); await view.settle();
      assert.equal(feed.current.calls.length, 6, 'normal expiry permits only the next bounded request set');
      assert.equal(view.panel.querySelectorAll('.departure-list > li').length, 2);
    } finally {view.dom.window.close();}
  }
});
test('DOM retains same-script composite operators only when both aliases are supplied', async () => {
  for (const name of ['München Hbf / Munich', 'München (Munich)']) for (const supplied of [true, false]) {
    const candidates = [{...stop('a'), name:'München Hbf', lat:.001}, {...stop('b'), name, lat:.0011},
      {...stop('wrong'), name:'Munich Park', lat:.0001}];
    const bodies = Object.fromEntries(['a','b','wrong'].map(id => [id, {stopTimes:[{
      ...observation, displayName:id === 'wrong' ? 'WRONG' : `RIGHT-${id}`, tripId:id,
    }]}]));
    const feed = {current:fixture({candidates, bodies})}, view = boardDom(feed);
    try {
      const properties = {name:'München Hbf', ...(supplied ? {'name:en':'Munich'} : {})};
      view.show(properties); await view.settle();
      assert.deepEqual(feed.current.calls.slice(1).map(({url}) => url.searchParams.get('stopId')), supplied ? ['a','b'] : ['a']);
      assert.equal(view.panel.querySelectorAll('.departure-list > li').length, supplied ? 2 : 1);
      assert.doesNotMatch(view.panel.textContent, /WRONG/);
      for (const [i, direction] of ['from','to'].entries()) {
        const url = new URL(view.panel.querySelectorAll('.departure-links a')[i].href);
        assert.equal(url.searchParams.get(`${direction}Place`), 'a');
        assert.equal(url.searchParams.get(`${direction}Name`), supplied ? 'Munich' : 'München Hbf');
      }
      view.show(properties); await view.settle();
      assert.equal(feed.current.calls.length, supplied ? 3 : 2, 'cached reopening preserves the bounded requests');
    } finally {view.dom.window.close();}
  }
});
test('DOM uses only name-compatible board IDs for both journey links and keeps the result cached', async () => {
  const permutations = items => items.length < 2 ? [items] : items.flatMap((item, i) =>
    permutations(items.filter((_, j) => j !== i)).map(rest => [item, ...rest]));
  for (const [name, other] of [['Terminal 1', 'Terminal 10'], ['Central', 'Central Park'], ['中央', '中央公園']]) {
    const candidates = [{...stop('a'), name, lat:.001}, {...stop('b'), name, lat:.0011}, {...stop('wrong'), name:other, lat:.0001}];
    const bodies = Object.fromEntries(['a','b','wrong'].map(id => [id, {stopTimes:[{
      ...observation, displayName:id === 'wrong' ? 'WRONG' : `RIGHT-${id}`, tripId:id,
    }]}]));
    for (const order of permutations(candidates)) {
      const feed = {current:fixture({candidates:order, bodies})}, view = boardDom(feed);
      try {
        view.show(name); await view.settle();
        assert.deepEqual(feed.current.calls.slice(1).map(({url}) => url.searchParams.get('stopId')), ['a','b']);
        assert.equal(feed.current.calls.length, 3);
        assert.equal(view.panel.querySelectorAll('.departure-list > li').length, 2);
        assert.doesNotMatch(view.panel.textContent, /WRONG/);
        const links = [...view.panel.querySelectorAll('.departure-links a')];
        for (const [i, direction] of ['from','to'].entries()) {
          const url = new URL(links[i].href);
          assert.equal(url.searchParams.get(`${direction}Place`), 'a');
          assert.equal(url.searchParams.get(`${direction}Name`), name);
        }
        view.show(name); await view.settle();
        assert.equal(feed.current.calls.length, 3, 'normal reopening reuses the selected boards');
      } finally {view.dom.window.close();}
    }
  }
});
for (const times of [[], [observation]]) test(`DOM caches malformed board plus healthy ${times.length ? 'rows' : 'empty'} as partial until normal expiry`, async () => {
  for (const [label, body] of malformedBoards) for (const order of [['a', 'b'], ['b', 'a']]) {
    const feed = {current: fixture({order, times, bodies: {b: body}})}, view = boardDom(feed);
    try {
      view.show(); await view.settle();
      assert.equal(view.panel.querySelector('.departure-warning')?.textContent, partialMessage, label);
      assert.equal(view.panel.querySelectorAll('.departure-list > li').length, times.length);
      assert.doesNotMatch(view.panel.textContent, /No rail departures|No published timetable|No matching rail timetable stop|synthetic private/);
      assert.equal(view.departureBoards.size, 1);
      assert.equal(view.panel.querySelectorAll('button').length, 0);
      const previous = feed.current;
      feed.current = fixture({times});
      view.advance(60_000); view.show(); await view.settle();
      assert.equal(view.panel.querySelector('.departure-warning')?.textContent, partialMessage);
      assert.equal(previous.calls.length, 3); assert.equal(feed.current.calls.length, 0);
      view.advance(1); view.show(); await view.settle();
      assert.equal(view.panel.querySelector('.departure-warning'), null);
      assert.equal(view.panel.querySelectorAll('.departure-list > li').length, times.length);
      assert.equal(feed.current.calls.length, 3);
      view.show(); await view.settle(); assert.equal(feed.current.calls.length, 3);
    } finally {view.dom.window.close();}
  }
});

test('DOM evicts all malformed boards, shows only the generic loading failure, and recovers on reopening', async () => {
  for (const [label, body] of malformedBoards) {
    const feed = {current: fixture({bodies: {a: body, b: body}})}, view = boardDom(feed);
    try {
      view.show(); await view.settle();
      assert.equal(view.panel.textContent, 'DeparturesDepartures could not load. Try again later.', label);
      assert.equal(view.departureBoards.size, 0);
      assert.equal(feed.current.calls.length, 3);
      feed.current = fixture({times: [observation]});
      view.show(); await view.settle();
      assert.equal(view.panel.querySelector('.departure-warning'), null);
      assert.equal(view.panel.querySelectorAll('.departure-list > li').length, 1);
      assert.equal(feed.current.calls.length, 3);
      view.show(); await view.settle(); assert.equal(feed.current.calls.length, 3);
    } finally {view.dom.window.close();}
  }
});

for (const times of [[], [observation]]) test(`DOM preserves cached partial ${times.length ? 'rows' : 'empty'} and normal expiry establishes recovery`, async () => {
  const feed = {current: fixture({failed: ['b'], times})}, view = boardDom(feed);
  try {
    view.show(); await view.settle();
    assert.equal(view.panel.querySelector('.departure-warning').textContent, partialMessage);
    assert.equal(view.panel.querySelectorAll('.departure-list > li').length, times.length);
    assert.doesNotMatch(view.panel.textContent, /No rail departures|No published timetable|No matching rail timetable stop|synthetic private/);
    assert.equal(view.panel.querySelectorAll('button').length, 0, 'no board retry button added');
    const previous = feed.current;
    feed.current = fixture({times});
    view.advance(60_000); view.show(); await view.settle();
    assert.equal(view.panel.querySelector('.departure-warning').textContent, partialMessage);
    assert.equal(previous.calls.length, 3); assert.equal(feed.current.calls.length, 0);
    view.advance(1); view.show(); await view.settle();
    assert.equal(view.panel.querySelector('.departure-warning'), null);
    assert.equal(view.panel.querySelectorAll('.departure-list > li').length, times.length);
    if (!times.length) assert.match(view.panel.textContent, /No rail departures in the published timetable soon/);
    assert.equal(feed.current.calls.length, 3, 'a normal post-expiry opening loads each selected board once');
    view.show(); await view.settle(); assert.equal(feed.current.calls.length, 3);
  } finally {view.dom.window.close();}
});

test('DOM keeps all-failed rejection, eviction, and no-matching-stop messages', async () => {
  const feed = {current: fixture({failed: ['a', 'b']})}, view = boardDom(feed);
  try {
    view.show(); await view.settle();
    assert.match(view.panel.textContent, /Departures could not load\. Try again later\./);
    assert.doesNotMatch(view.panel.textContent, /No rail departures|No published timetable|No matching rail timetable stop|synthetic private/);
    assert.equal(view.departureBoards.size, 0, 'fully failed requests are evicted as before');
    feed.current = fixture({order: []});
    view.show(); await view.settle();
    assert.match(view.panel.textContent, /No matching rail timetable stop was found within 400 m/);
    assert.equal(feed.current.calls.length, 1);
  } finally {view.dom.window.close();}
});

test('detached DOM results cannot overwrite a newly opened station section', async () => {
  const feed = {current: fixture({failed: ['b'], times: [observation]})}, view = boardDom(feed);
  try {
    view.show(); const detached = view.panel.firstChild;
    view.show(); await view.settle();
    assert.equal(detached.isConnected, false);
    assert.match(detached.textContent, /Loading departures/);
    assert.equal(view.panel.querySelector('.departure-warning').textContent, partialMessage);
    assert.equal(feed.current.calls.length, 3, 'concurrent redraw shares the in-flight result');
  } finally {view.dom.window.close();}
});

for (const times of [[], [observation]]) test(`late partial ${times.length ? 'rows' : 'empty'} cannot replace a newer station result`, async () => {
  let release, started;
  const held = new Promise(resolve => {release = resolve;});
  const requested = new Promise(resolve => {started = resolve;});
  const previous = fixture({failed: ['b'], times});
  const feed = {current: {fetch: async (...args) => {
    const url = new URL(args[0]);
    if (url.pathname.endsWith('/stoptimes') && url.searchParams.get('stopId') === 'b') {
      started(); await held;
    }
    return previous.fetch(...args);
  }}};
  const view = boardDom(feed);
  try {
    view.show('Previous station'); await requested;
    const detached = view.panel.firstChild, previousPromise = [...view.departureBoards.values()][0].promise;
    feed.current = fixture();
    view.show('Newer station');
    const currentPromise = [...view.departureBoards.values()][1].promise;
    await currentPromise; await new Promise(resolve => setImmediate(resolve));
    const currentSection = view.panel.firstChild, currentText = view.panel.textContent;
    assert.match(currentText, /No rail departures in the published timetable soon/);
    assert.equal(detached.isConnected, false);
    release(); await previousPromise; await view.settle();
    assert.equal(view.panel.firstChild, currentSection);
    assert.equal(view.panel.textContent, currentText, 'late status and rows cannot overwrite the newer selection');
    assert.match(detached.textContent, /Loading departures/);
    assert.equal(view.panel.querySelector('.departure-warning'), null);
    assert.equal(previous.calls.length, 3); assert.equal(feed.current.calls.length, 3);
    view.show('Previous station'); await view.settle();
    assert.equal(view.panel.querySelector('.departure-warning').textContent, partialMessage);
    assert.equal(view.panel.querySelectorAll('.departure-list > li').length, times.length);
    assert.equal(previous.calls.length, 3); assert.equal(feed.current.calls.length, 3,
      'reopening the old station uses its own cached partial result');
  } finally {release(); view.dom.window.close();}
});

for (const [from, to] of [['ja', 'en'], ['en', 'ja']]) for (const times of [[], [observation]]) test(`translated ${from} to ${to} redraw preserves cached partial ${times.length ? 'rows' : 'empty'} until normal expiry`, async () => {
  const feed = {current: fixture({failed: ['b'], times})}, view = boardDom(feed);
  const properties = {id: 'node-1', name: 'Central', 'name:en': 'Central', 'name:ja': '中央'};
  try {
    view.language(from); view.show(properties); await view.settle();
    const previous = feed.current;
    assert.equal(view.panel.querySelector('.departure-warning').textContent, partialMessage);
    assert.equal(previous.calls.length, 3);
    feed.current = fixture({times});
    view.language(to); view.show(properties); await view.settle();
    assert.equal(feed.current.calls.length, 0, 'a translated redraw cannot refetch before expiry');
    assert.equal(view.panel.querySelector('.departure-warning').textContent, partialMessage);
    assert.equal(view.panel.querySelectorAll('.departure-list > li').length, times.length);
    view.advance(60_001); view.show(properties); await view.settle();
    assert.equal(feed.current.calls.length, 3);
    assert.equal(view.panel.querySelector('.departure-warning'), null);
  } finally {view.dom.window.close();}
});

for (const [label, first, second] of [
  ['different OSM objects', {properties: {id: 'node-1'}}, {properties: {id: 'node-2'}}],
  ['OSM types with one numeric ID', {properties: {osm_type: 'node', osm_id: 1}}, {properties: {osm_type: 'way', osm_id: 1}}],
  ['feature ID zero', {id: 0}, {id: 1}],
  ['OSM and provider ID namespaces', {properties: {id: 'node-1'}}, {source: 'osm', sourceLayer: 'node', id: '1'}],
  ['source-scoped feature ID', {id: 0, source: 'stations-a'}, {id: 0, source: 'stations-b'}],
  ['source-layer-scoped provider ID', {properties: {id: 'local'}, sourceLayer: 'a'}, {properties: {id: 'local'}, sourceLayer: 'b'}],
  ['nearby points with a tile-local ID', {id: 0}, {id: 0, geometry: {coordinates: [0.000001, 0]}}],
  ['no-ID raw-name fallback', {properties: {name: 'Central'}}, {properties: {name: 'Other'}}],
]) test(`departure cache keeps ${label} distinct`, async () => {
  const feed = {current: fixture({failed: ['b']})}, view = boardDom(feed);
  const show = feature => view.show({name: 'Central', ...feature.properties}, feature);
  try {
    show(first); await view.settle();
    assert.equal(view.panel.querySelector('.departure-warning').textContent, partialMessage);
    feed.current = fixture();
    show(second); await view.settle();
    assert.equal(feed.current.calls.length, 3, 'another station cannot inherit the cached partial result');
    assert.equal(view.panel.querySelector('.departure-warning'), null);
  } finally {view.dom.window.close();}
});

test('cache normalizes explicit OSM identities across source representations and quantized points', async () => {
  const feed = {current: fixture({failed: ['b']})}, view = boardDom(feed);
  try {
    view.show({name: 'Central', id: 'node-1'}, {source: 'stationMajor'}); await view.settle();
    feed.current = fixture();
    view.show({name: '中央', osm_type: 'node', osm_id: 1}, {source: 'stations', geometry: {coordinates: [0.000001, 0]}}); await view.settle();
    assert.equal(feed.current.calls.length, 0);
    assert.equal(view.panel.querySelector('.departure-warning').textContent, partialMessage);
  } finally {view.dom.window.close();}
});

test('no-ID fallback anchors translated redraws to stable raw names', async () => {
  const feed = {current: fixture({failed: ['b']})}, view = boardDom(feed);
  try {
    view.language('ja'); view.show({name: 'Central', localized_name: '中央'}); await view.settle();
    feed.current = fixture();
    view.language('en'); view.show({name: 'Central', localized_name: 'Central'}); await view.settle();
    assert.equal(feed.current.calls.length, 0);
    assert.equal(view.panel.querySelector('.departure-warning').textContent, partialMessage);
  } finally {view.dom.window.close();}
});

test('an unnamed pending failure cannot evict the later named station board', async () => {
  let release, started;
  const held = new Promise(resolve => {release = resolve;});
  const requested = new Promise(resolve => {started = resolve;});
  const previous = fixture({failed: ['a', 'b']});
  const feed = {current: {fetch: async (...args) => {
    if (String(args[0]).includes('/stoptimes')) {started(); await held;}
    return previous.fetch(...args);
  }}};
  const view = boardDom(feed);
  try {
    view.show({id: 'node-1'}); await requested;
    const previousPromise = [...view.departureBoards.values()][0].promise;
    feed.current = fixture();
    view.show({id: 'node-1', name: 'Central'});
    await [...view.departureBoards.values()][1].promise;
    release(); await Promise.allSettled([previousPromise]); await view.settle();
    assert.match(view.panel.textContent, /No rail departures in the published timetable soon/);
    assert.equal(view.departureBoards.size, 1, 'the named result survives old unnamed rejection');
    assert.equal(feed.current.calls.length, 3);
    view.show({id: 'node-1', name: 'Central'}); await view.settle();
    assert.equal(feed.current.calls.length, 3, 'named enrichment has its own retained cache entry');
  } finally {release(); view.dom.window.close();}
});

// A successful lookup can be empty or contain only stops outside the existing
// rail/distance filters. Neither establishes whether a timetable covers the area.
const unmatchedLookups = [
  ['empty', []],
  ['filtered', [
    {...stop('bus'), modes: ['BUS']},
    {...stop('place'), type: 'PLACE'},
    {...stop('far'), lat: 0.01},
    {...stop('coordinates'), lon: '0'},
  ]],
];
const unmatchedMessage = 'No matching rail timetable stop was found within 400 m.';
for (const [label, candidates] of unmatchedLookups) test(`successful ${label} lookup returns no matched stops with one request`, async () => {
  const feed = fixture({candidates}), before = structuredClone(candidates), signal = new AbortController().signal;
  assert.deepEqual(await stationDepartures(station, {fetch: feed.fetch, signal}), {stops: [], rows: [], stopResults: []});
  assert.deepEqual(candidates, before);
  assert.equal(feed.calls.length, 1);
  assert.equal(feed.calls[0].options.signal, signal);
  assert.equal(feed.calls[0].url.pathname, '/api/v1/reverse-geocode');
});

const malformedLookups = [null, {}, {error: 'synthetic private provider response'}, 'synthetic private response', 0, false];
for (const candidates of malformedLookups) test(`malformed top-level lookup ${JSON.stringify(candidates)} rejects instead of inventing an empty match`, async () => {
  const feed = fixture({candidates});
  await assert.rejects(stationDepartures(station, {fetch: feed.fetch}), /Invalid Transitous stop lookup response/);
  assert.equal(feed.calls.length, 1, 'a malformed lookup never starts a board request');
});

for (const [label, candidates] of unmatchedLookups) for (const languages of [['en', 'ja'], ['ja', 'en']])
test(`DOM preserves cached ${label} no-match status through ${languages.join('→')} redraws until normal expiry`, async () => {
  const feed = {current: fixture({candidates})}, view = boardDom(feed);
  const properties = {id: 'node-99', name: 'Central', 'name:en': 'Central', 'name:ja': '中央'};
  try {
    view.language(languages[0]); view.show(properties); await view.settle();
    assert.match(view.panel.textContent, /No matching rail timetable stop was found within 400 m/);
    assert.doesNotMatch(view.panel.textContent, /No published timetable|No rail departures|could not load/);
    assert.equal(view.panel.querySelectorAll('.departure-warning, .departure-list').length, 0);
    const before = feed.current;
    feed.current = fixture({times: [observation]});
    view.show(properties); await view.settle();
    view.advance(60_000); view.language(languages[1]); view.show(properties); await view.settle();
    assert.ok(view.panel.textContent.includes(unmatchedMessage));
    assert.equal(before.calls.length, 1); assert.equal(feed.current.calls.length, 0);
    const link = new URL(view.panel.querySelector('.departure-links a').href);
    assert.equal(link.searchParams.get('fromPlace'), '0,0');
    assert.equal(link.searchParams.get('fromName'), properties[`name:${languages[1]}`]);
    view.advance(1); view.show(properties); await view.settle();
    assert.equal(feed.current.calls.length, 3);
    assert.equal(view.panel.querySelectorAll('.departure-list > li').length, 1);
    assert.ok(!view.panel.textContent.includes(unmatchedMessage));
  } finally {view.dom.window.close();}
});

for (const candidates of malformedLookups) test(`DOM shows a generic lookup failure and permits reopening after ${JSON.stringify(candidates)}`, async () => {
  const feed = {current: fixture({candidates})}, view = boardDom(feed);
  const properties = {id: 'node-99', name: 'Central', 'name:ja': '中央'};
  try {
    view.show(properties); await view.settle();
    assert.equal(view.panel.textContent, 'DeparturesDepartures could not load. Try again later.');
    assert.equal(view.departureBoards.size, 0);
    assert.equal(feed.current.calls.length, 1);
    view.language('ja'); view.show(properties); await view.settle();
    assert.equal(view.panel.textContent, 'DeparturesDepartures could not load. Try again later.');
    assert.equal(feed.current.calls.length, 2, 'normal redraw retries the evicted failure once');
    feed.current = fixture({candidates: []});
    view.show(properties); await view.settle();
    assert.ok(view.panel.textContent.includes(unmatchedMessage));
    assert.equal(feed.current.calls.length, 1);
    view.show(properties); await view.settle();
    assert.equal(feed.current.calls.length, 1, 'a recovered successful lookup is cached normally');
  } finally {view.dom.window.close();}
});

for (const direction of [-1, 1]) for (const failed of [[], ['b']])
test(`DOM displays wrapped station boards and retains cached availability (${direction}, failed=${failed})`, async () => {
  const from = direction * 179.999, candidates = [{...stop('a'), lon:-direction * 179.999},
    {...stop('b'), lon:-direction * 179.9985}, {...stop('c'), lon:-direction * 179.998}];
  const feed = {current:fixture({candidates, failed, times:[observation]})}, view = boardDom(feed);
  const properties = {id:'node-180', name:'Central', 'name:en':'Central', 'name:ja':'中央'};
  const feature = {geometry:{coordinates:[from, 0]}};
  try {
    view.show(properties, feature); await view.settle();
    assert.equal(view.panel.querySelectorAll('.departure-list > li').length, 1);
    assert.match(view.panel.textContent, /R7/);
    assert.doesNotMatch(view.panel.textContent, /No matching rail timetable stop/);
    assert.equal(view.panel.querySelector('.departure-warning')?.textContent ?? null, failed.length ? partialMessage : null);
    assert.deepEqual(feed.current.calls.slice(1).map(({url}) => url.searchParams.get('stopId')), ['a','b']);
    assert.equal(new URL(view.panel.querySelector('.departure-links a').href).searchParams.get('fromPlace'), 'a');
    view.language('ja'); view.show(properties, feature); await view.settle();
    assert.equal(feed.current.calls.length, 3, 'translated reopening reuses the original two-board result');
    assert.equal(view.panel.querySelectorAll('.departure-list > li').length, 1);
    assert.equal(view.panel.querySelector('.departure-warning')?.textContent ?? null, failed.length ? partialMessage : null);
  } finally {view.dom.window.close();}
});
