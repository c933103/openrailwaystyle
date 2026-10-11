import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {stationDepartures, departureRows, plannerLink, TRANSITOUS_SOURCES} from '../styles/departures.mjs';
import {departureItem} from '../styles/departures-ui.mjs';

const station = {lat: 0, lon: 0, names: ['Central']};
const stop = id => ({type: 'STOP', id, name: 'Central', lat: 0, lon: 0, modes: ['REGIONAL_RAIL']});
const observation = {mode: 'REGIONAL_RAIL', displayName: 'R7', headsign: 'Harbour',
  tripId: 'fixture-trip', routeId: 'fixture-route',
  place: {stopId: 'a', departure: '2099-01-01T12:00:00Z', scheduledDeparture: '2099-01-01T12:00:00Z', tz: 'UTC'}};
const failure = new Error('synthetic private error text must not appear in result or UI');
function fixture({order = ['a', 'b'], failed = [], times = [], failureKind = 'network'} = {}) {
  const calls = [], before = structuredClone(times);
  return {calls, before, fetch: async (url, options) => {
    calls.push({url: new URL(url), options});
    if (url.includes('/reverse-geocode')) return {ok: true, json: async () => order.map(stop)};
    const id = new URL(url).searchParams.get('stopId');
    if (failed.includes(id)) {
      if (failureKind === 'http') return {ok: false, status: 503};
      if (failureKind === 'json') return {ok: true, json: async () => {throw failure;}};
      if (failureKind === 'abort') throw new DOMException('Synthetic abort', 'AbortError');
      throw failure;
    }
    return {ok: true, json: async () => ({stopTimes: times})};
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

// Execute the production renderer and cache against a real DOM, with only its
// external dependencies injected. The actual stationDepartures parser is used.
const app = await readFile(new URL('../styles/app.mjs', import.meta.url), 'utf8');
const renderer = app.slice(app.indexOf('const departureBoards = new Map();'), app.indexOf('// Level-crossing equipment'));
function boardDom(feed) {
  const dom = new JSDOM('<div id="panel"></div>'), document = dom.window.document;
  let now = 1000;
  const context = vm.createContext({document, AbortSignal, departureItem, plannerLink, TRANSITOUS_SOURCES,
    Date: {now: () => now}, settings: {language: 'en'}, displayName: p => p.name,
    stationDepartures: (station, options) => stationDepartures(station, {...options, fetch: (...args) => feed.current.fetch(...args)}),
    textNode: (tag, text, className = '') => {
      const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
    }});
  const {showDepartures, departureBoards} = vm.runInContext(`${renderer}\n({showDepartures, departureBoards})`, context);
  const panel = document.querySelector('#panel');
  return {dom, panel, departureBoards, advance: ms => {now += ms;},
    show: (name = 'Central') => {
      panel.replaceChildren();
      showDepartures(panel, {properties: {name}, geometry: {coordinates: [0, 0]}});
    },
    settle: async () => {
      await Promise.allSettled([...departureBoards.values()].map(board => board.promise));
      await new Promise(resolve => setImmediate(resolve));
    }};
}
const partialMessage = 'Some departures could not load. The board may be incomplete.';
for (const times of [[], [observation]]) test(`DOM preserves cached partial ${times.length ? 'rows' : 'empty'} and normal expiry establishes recovery`, async () => {
  const feed = {current: fixture({failed: ['b'], times})}, view = boardDom(feed);
  try {
    view.show(); await view.settle();
    assert.equal(view.panel.querySelector('.departure-warning').textContent, partialMessage);
    assert.equal(view.panel.querySelectorAll('.departure-list > li').length, times.length);
    assert.doesNotMatch(view.panel.textContent, /No rail departures|No published timetable|synthetic private/);
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
    assert.doesNotMatch(view.panel.textContent, /No rail departures|No published timetable|synthetic private/);
    assert.equal(view.departureBoards.size, 0, 'fully failed requests are evicted as before');
    feed.current = fixture({order: []});
    view.show(); await view.settle();
    assert.match(view.panel.textContent, /No published timetable covers this station/);
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
