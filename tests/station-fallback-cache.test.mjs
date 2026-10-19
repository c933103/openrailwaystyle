import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {createStationFallbackState, stationFallbackFilter, stationFallbackMarkersEnabled, stationFallbackNamesEnabled, STATION_FALLBACK_IDS} from '../styles/station-fallback.mjs';
import {createRailProviderRecovery} from '../styles/rail-provider-recovery.mjs';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';

const bounds = (west, east) => ({getWest: () => west, getEast: () => east, getSouth: () => 48, getNorth: () => 49});
const shown = (state, id, coordinate) => featureFilter(stationFallbackFilter(id, state.area(10)))
  .filter({zoom: 10}, {type: 1, properties: {class: 'railway', subclass: 'station', feature: 'station', tier: 3},
    geometry: [[{x: 4096, y: 4096}]]}, coordinate);

test('actual pinned tile cache restores a failed retry on return without a new request or error event', async () => {
  // Execute the real cache, tile identity, retry, removal and restoration paths.
  // Only provider/worker responses and GPU-dependent success bookkeeping are
  // controlled. There is no browser, provider fetch, timer delay or WebGL here.
  const compiled = await build({stdin: {
    contents: "export {TileManager} from './node_modules/maplibre-gl/src/tile/tile_manager.ts'; export {TileCache} from './node_modules/maplibre-gl/src/tile/tile_cache.ts'; export {InViewTiles} from './node_modules/maplibre-gl/src/tile/tile_manager_in_view_tiles.ts'; export {OverscaledTileID} from './node_modules/maplibre-gl/src/tile/tile_id.ts'; export {Tile} from './node_modules/maplibre-gl/src/tile/tile.ts';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts',
  }, bundle: true, write: false, format: 'iife', globalName: 'fixtureMapLibre', platform: 'browser',
  tsconfigRaw: {compilerOptions: {useDefineForClassFields: false}}, loader: {'.glsl': 'text'}});
  const dom = new JSDOM('', {runScripts: 'outside-only', pretendToBeVisual: true});
  dom.window.fetch = () => assert.fail('offline cache regression cannot fetch');
  try {
    dom.window.eval(compiled.outputFiles[0].text);
    const {TileManager, TileCache, InViewTiles, OverscaledTileID, Tile} = dom.window.fixtureMapLibre;
    let viewport = bounds(2, 3), zoom = 10, rejectRetry, loads = 0, errorEvents = 0;
    const timers = new Map(), retryJobs = [];
    const source = {url: 'atlasstation://en/https://openrailwaymap.app/standard_railway_text_stations', maxzoom: 16, tileSize: 512,
      loadTile: async () => { loads++; return new Promise((resolve, reject) => { rejectRetry = reject; }); },
      abortTile: () => {}, unloadTile: tile => tile.unloadVectorData(),
      fire: event => {
        if (event.type === 'error') {
          errorEvents++;
          state.noteError({...event, sourceId: 'stations'});
          recovery.noteError({...event, sourceId: 'stations'});
        }
      },
    };
    const manager = Object.create(TileManager.prototype);
    Object.assign(manager, {_source: source, _inViewTiles: new InViewTiles(), _timers: {},
      _state: {initializeTileState: () => {}}, _outOfViewCache: new TileCache(8, tile => manager._unloadTile(tile))});
    const map = {getSource: id => id === 'stations' ? source : null, getZoom: () => zoom, getBounds: () => viewport,
      getStyle: () => ({layers: [{source: 'stations', minzoom: 8}]}), style: {tileManagers: {stations: manager}},
      refreshTiles: (id, coordinates) => {
        for (const coordinate of coordinates) for (const key of manager.getIds()) {
          const tile = manager.getTileByID(key), c = tile.tileID.canonical;
          if (c.z === coordinate.z && c.x === coordinate.x && c.y === coordinate.y)
            retryJobs.push(manager._reloadTile(key, 'expired'));
        }
      },
    };
    const state = createStationFallbackState(map);
    const recovery = createRailProviderRecovery(map, {setTimer: (fn, delay) => { const key = {};timers.set(key, {fn, delay});return key; },
      clearTimer: key => timers.delete(key)});
    try {
      const id = new OverscaledTileID(10, 0, 10, 518, 352), tile = new Tile(id, 512);
      tile.state = 'errored';tile.uses = 1;manager._inViewTiles.setTile(id.key, tile);
      const healthyID = new OverscaledTileID(10, 0, 10, 519, 352), healthy = new Tile(healthyID, 512);
      healthy.state = 'loaded';healthy.uses = 1;manager._inViewTiles.setTile(healthyID.key, healthy);
      source.fire({type: 'error', tile, error: {status: 503}});
      assert.ok(state.area(10));assert.equal(recovery.hasFailures(), true);
      const [timerKey, timer] = [...timers][0];timers.delete(timerKey);timer.fn();
      assert.equal(tile.state, 'expired');assert.equal(loads, 1);
      viewport = bounds(2.5, 2.8);zoom = 12;
      manager._removeTile(id.key);
      assert.equal(manager._outOfViewCache.get(id), tile, 'an expired retry is genuinely cached by the pinned renderer');
      assert.equal(state.area(12), null);recovery.wake();assert.equal(recovery.hasFailures(), false);
      rejectRetry(Object.assign(new dom.window.Error('controlled retry failure'), {status: 503}));
      await Promise.all(retryJobs);
      assert.equal(tile.state, 'errored');assert.equal(tile.aborted, undefined, 'cache removal did not abort the retry');
      assert.equal(state.area(12), null);assert.equal(recovery.hasFailures(), false);
      const before = {loads, errorEvents};
      viewport = bounds(2, 3);zoom = 10;
      assert.equal(manager._addTile(id), tile, 'return reuses the exact errored object');
      assert.deepEqual({loads, errorEvents}, before, 'cached return has neither a fetch nor an error callback');
      for (const layer of STATION_FALLBACK_IDS) {
        assert.equal(shown(state, layer, id.canonical), true, `${layer}: cached failure restores fallback`);
        assert.equal(shown(state, layer, healthyID.canonical), false, `${layer}: healthy neighbor remains excluded`);
      }
      recovery.wake();assert.equal(recovery.hasFailures(), true, 'existing retry policy resumes when failure is demanded again');
      assert.equal(timers.size, 1);
      tile.state = 'loaded';state.noteSourceData({sourceId: 'stations', tile});recovery.noteSourceData({sourceId: 'stations', tile});
      assert.equal(state.area(10), null);assert.equal(recovery.hasFailures(), false);assert.equal(timers.size, 0);
    } finally { recovery.dispose();manager._outOfViewCache.reset(); }
  } finally { dom.window.close(); }
});

function cacheFixture(status = 503, coordinateOnly = false) {
  let source = {url: 'atlasstation://en/https://openrailwaymap.app/standard_railway_text_stations', maxzoom: 16};
  let tiles = [], viewport = bounds(2, 3), zoom = 10;
  const manager = {getSource: () => source, getIds: () => tiles.map((_, i) => i), getTileByID: i => tiles[i]};
  const filters = new Map(), layouts = new Map(), timers = new Map();
  const map = {getSource: id => id === 'stations' ? source : null, getZoom: () => zoom, getBounds: () => viewport,
    style: {tileManagers: {stations: manager}}, getStyle: () => ({layers: [{source: 'stations', minzoom: 8}]}),
    getLayer: () => true, getFilter: id => filters.get(id), setFilter: (id, value) => filters.set(id, value),
    getLayoutProperty: id => layouts.get(id), setLayoutProperty: (id, key, value) => layouts.set(id, value), queryRenderedFeatures: () => []};
  const state = createStationFallbackState(map), recovery = createRailProviderRecovery(map, {
    setTimer: (fn, delay) => {const key = {};timers.set(key, {fn, delay});return key;}, clearTimer: key => timers.delete(key)});
  const tile = {state: 'errored', tileID: {wrap: 0, canonical: {z: 10, x: 518, y: 352}}};tiles = [tile];
  const event = {sourceId: 'stations', ...(coordinateOnly ? {coord: tile.tileID} : {tile}), error: {status}};
  state.noteError(event);recovery.noteError(event);
  return {map, state, recovery, tile, timers, filters, layouts,
    fail(status, target = tile, sourceId = 'stations') {
      const event = {sourceId, tile: target, error: typeof status === 'number' ? {status} : status};
      state.noteError(event);return recovery.noteError(event);
    },
    source: () => source, replaceSource: () => { source = {...source}; },
    away() { tiles = [];viewport = bounds(20, 21);zoom = 12;assert.equal(state.area(12), null);recovery.wake();assert.equal(recovery.hasFailures(), false); },
    back(next = tile) { tiles = Array.isArray(next) ? next : [next];viewport = bounds(2, 3);zoom = 10; },
    success(tile) { tile.state = 'loaded';state.noteSourceData({sourceId: 'stations', tile});recovery.noteSourceData({sourceId: 'stations', tile}); },
  };
}

for (const coordinateOnly of [false, true]) test(`known ${coordinateOnly ? 'coordinate-bound' : 'tile-object'} failures survive repeated cached returns`, () => {
  const f = cacheFixture(503, coordinateOnly);
  try {
    for (let i = 0; i < 3; i++) {
      f.away();assert.equal(f.timers.size, 0);f.back();
      assert.ok(f.state.area(10));f.recovery.wake();assert.equal(f.recovery.hasFailures(), true);assert.equal(f.timers.size, 1);
    }
    f.success(f.tile);assert.equal(f.state.area(10), null);assert.equal(f.recovery.hasFailures(), false);
  } finally { f.recovery.dispose(); }
});

for (const offscreen of [false, true]) test(`later 403 retires only the same tile's previous 503 retry authority ${offscreen ? 'while cached' : 'while active'}`, () => {
  const f = cacheFixture();
  try {
    if (offscreen) f.away();
    assert.equal(f.fail(403), false);if (offscreen) f.back();
    assert.ok(f.state.area(10), 'nonretryable failure retains station fallback');
    f.recovery.wake();assert.equal(f.recovery.hasFailures(), false);assert.equal(f.timers.size, 0);
    f.away();f.back();f.recovery.wake();assert.equal(f.recovery.hasFailures(), false, 'old retry authority cannot return on a second visit');
    assert.equal(f.fail(503), true, 'a later genuine outage supplies new retry authority');
    assert.equal(f.recovery.hasFailures(), true);assert.equal(f.timers.size, 1);
    f.away();f.back();f.recovery.wake();assert.equal(f.recovery.hasFailures(), true);
  } finally { f.recovery.dispose(); }
});

for (const error of [{status: 400}, {status: 401}, {message: 'Map names returned 403'}, {status: 404}])
  test(`explicit nonretryable status replacement ${JSON.stringify(error)} never resumes cached retries`, () => {
    const f = cacheFixture();
    try {
      f.away();f.fail(error);f.back();assert.ok(f.state.area(10));f.recovery.wake();
      assert.equal(f.recovery.hasFailures(), false);assert.equal(f.timers.size, 0);
    } finally { f.recovery.dispose(); }
  });

test('nonretryable errors on another tile/source cannot retire a cached instance retry', () => {
  const f = cacheFixture();
  try {
    f.away();f.fail(403, {...f.tile, tileID: {...f.tile.tileID, wrap: 1}});f.fail(403, f.tile, 'stationMed');
    f.back();f.recovery.wake();assert.equal(f.recovery.hasFailures(), true);assert.equal(f.timers.size, 1);
  } finally { f.recovery.dispose(); }
});

for (const copiedCoord of [false, true]) test(`coordinate-only 403 retires its active bound retry${copiedCoord ? ' with an equivalent location object' : ''}`, () => {
  const f = cacheFixture(503, true);
  try {
    const coord = copiedCoord ? {...f.tile.tileID, canonical: {...f.tile.tileID.canonical}} : f.tile.tileID;
    const event = {sourceId: 'stations', coord, error: {status: 403}};
    f.state.noteError(event);assert.equal(f.recovery.noteError(event), false);
    assert.ok(f.state.area(10), 'access failure retains fallback');
    assert.equal(f.recovery.hasFailures(), false);assert.equal(f.timers.size, 0);
    for (let i = 0; i < 2; i++) {
      f.away();f.back();f.recovery.wake();assert.equal(f.recovery.hasFailures(), false);assert.equal(f.timers.size, 0);
    }
    assert.equal(f.recovery.noteError({...event, error: {status: 503}}), true);
    assert.equal(f.recovery.hasFailures(), true);assert.equal(f.timers.size, 1);
    f.away();f.back();f.recovery.wake();assert.equal(f.recovery.hasFailures(), true);
  } finally { f.recovery.dispose(); }
});

test('coordinate-only access errors retire only the matching known active world copy', () => {
  const f = cacheFixture(503, true), sibling = {...f.tile, tileID: {...f.tile.tileID, wrap: 1}};
  try {
    f.back([f.tile, sibling]);f.fail(503, sibling);
    f.recovery.noteError({sourceId: 'stations', coord: {...f.tile.tileID}, error: {status: 403}});
    assert.equal(f.recovery.hasFailures(), true, 'independent sibling retry survives');
    f.away();f.back();f.recovery.wake();assert.equal(f.recovery.hasFailures(), false);
    f.away();f.back(sibling);f.recovery.wake();assert.equal(f.recovery.hasFailures(), true);
  } finally { f.recovery.dispose(); }
});

test('unknown, mismatched and ambiguous coordinates cannot retire known retry evidence', () => {
  const f = cacheFixture(503, true), sibling = {...f.tile, tileID: {...f.tile.tileID, wrap: 1}};
  try {
    f.back([f.tile, sibling]);f.fail(503, sibling);
    for (const coord of [{canonical: f.tile.tileID.canonical}, {...f.tile.tileID, wrap: 2},
      {...f.tile.tileID, overscaledZ: 11}, {...f.tile.tileID, key: 'unknown'},
      {...f.tile.tileID, canonical: {...f.tile.tileID.canonical, x: 520}}]) {
      f.recovery.noteError({sourceId: 'stations', coord, error: {status: 403}});
    }
    f.away();f.back();f.recovery.wake();assert.equal(f.recovery.hasFailures(), true);
    f.away();f.back(sibling);f.recovery.wake();assert.equal(f.recovery.hasFailures(), true);
  } finally { f.recovery.dispose(); }
});

test('coordinate-only access errors cannot retire a cached failure through an unobserved replacement', () => {
  const f = cacheFixture(503, true), replacement = {...f.tile, tileID: {...f.tile.tileID}};
  try {
    f.away();f.back(replacement);
    f.recovery.noteError({sourceId: 'stations', coord: replacement.tileID, error: {status: 403}});
    assert.equal(f.recovery.hasFailures(), false);
    f.away();f.back();f.recovery.wake();assert.equal(f.recovery.hasFailures(), true, 'only the previously observed tile retains retry authority');
  } finally { f.recovery.dispose(); }
});

test('coordinate-only replacement also retires an unbound marker left by unavailable inventory', () => {
  const f = cacheFixture(503, true), manager = f.map.style.tileManagers.stations;
  try {
    delete f.map.style.tileManagers.stations;
    f.recovery.noteError({sourceId: 'stations', coord: f.tile.tileID, error: {status: 503}});
    f.map.style.tileManagers.stations = manager;
    f.recovery.noteError({sourceId: 'stations', coord: f.tile.tileID, error: {status: 403}});
    assert.equal(f.recovery.hasFailures(), false);assert.equal(f.timers.size, 0);
    f.away();f.back();f.recovery.wake();assert.equal(f.recovery.hasFailures(), false);
  } finally { f.recovery.dispose(); }
});

test('403 replaces only one of two previously failed world copies at the same coordinate', () => {
  const f = cacheFixture(), other = {...f.tile, tileID: {...f.tile.tileID, wrap: 1}};
  try {
    f.back([f.tile, other]);f.fail(503, other);f.fail(403);
    assert.equal(f.recovery.hasFailures(), true);assert.equal(f.timers.size, 1);
    f.away();f.back();assert.ok(f.state.area(10));f.recovery.wake();assert.equal(f.recovery.hasFailures(), false);
    f.away();f.back(other);f.recovery.wake();assert.equal(f.recovery.hasFailures(), true);
  } finally { f.recovery.dispose(); }
});

test('nonretryable metadata replacement does not clear independent tile retry evidence', () => {
  const f = cacheFixture(403);
  try {
    const metadata = status => f.recovery.noteError({sourceId: 'stations', error: {status}});
    assert.equal(metadata(503), true);assert.equal(f.recovery.hasFailures(), true);
    assert.equal(metadata(403), false);assert.equal(f.recovery.hasFailures(), false);assert.equal(f.timers.size, 0);
    metadata(503);f.fail(503);metadata(403);
    assert.equal(f.recovery.hasFailures(), true);assert.equal(f.timers.size, 1);
    f.fail(403);assert.equal(f.recovery.hasFailures(), false);assert.equal(f.timers.size, 0);
  } finally { f.recovery.dispose(); }
});

test('unknown or aborted errors do not replace cached HTTP failure classification', () => {
  const f = cacheFixture();
  try {
    f.away();f.fail({message: 'unrelated diagnostic'});f.fail({name: 'AbortError', status: 403});
    f.back();f.recovery.wake();assert.equal(f.recovery.hasFailures(), true);
  } finally { f.recovery.dispose(); }
});

for (const terminal of ['loaded', 'unloaded', 'aborted']) test(`${terminal} cached instances cannot resurrect obsolete failure evidence`, () => {
  const f = cacheFixture();
  try {
    f.away();
    if (terminal === 'aborted') f.tile.aborted = true;else f.tile.state = terminal;
    f.state.noteSourceData({sourceId: 'stations', tile: f.tile});f.recovery.noteSourceData({sourceId: 'stations', tile: f.tile});
    f.back();assert.equal(f.state.area(10), null);f.recovery.wake();assert.equal(f.recovery.hasFailures(), false);
    f.tile.state = 'errored';f.tile.aborted = false;
    assert.equal(f.state.area(10), null, 'a fresh failure requires a fresh error after confirmed settlement');
    f.recovery.wake();assert.equal(f.recovery.hasFailures(), false);
  } finally { f.recovery.dispose(); }
});

for (const replacement of ['tile', 'source', 'url']) test(`cache evidence cannot cross ${replacement} replacement`, () => {
  const f = cacheFixture();
  try {
    f.away();
    if (replacement === 'source') f.replaceSource();
    if (replacement === 'url') f.source().url += '?new-generation';
    f.back(replacement === 'tile' ? {...f.tile, tileID: {...f.tile.tileID}} : f.tile);
    assert.equal(f.state.area(10), null);f.recovery.wake();assert.equal(f.recovery.hasFailures(), false);assert.equal(f.timers.size, 0);
  } finally { f.recovery.dispose(); }
});

test('same-source URL replacement clears active as well as cached retry evidence', () => {
  const f = cacheFixture();
  try {
    f.source().url += '?new-generation';assert.equal(f.state.area(10), null);
    f.recovery.wake();assert.equal(f.recovery.hasFailures(), false);assert.equal(f.timers.size, 0);
  } finally { f.recovery.dispose(); }
});

test('an unknown wrapped copy does not inherit failure from a cached tile at the same coordinate', () => {
  const f = cacheFixture();
  try {
    f.away();f.back({...f.tile, tileID: {...f.tile.tileID, wrap: 1}});
    assert.equal(f.state.area(10), null);f.recovery.wake();assert.equal(f.recovery.hasFailures(), false);
    f.back();assert.ok(f.state.area(10));f.recovery.wake();assert.equal(f.recovery.hasFailures(), true);
  } finally { f.recovery.dispose(); }
});

for (const [initialStatus, statusCode, coordinateOnly] of [[403, 403], [503, 503], [503, 403], [403, 503], [503, 403, true], [403, 503, true]])
  test(`actual app restores cached ${initialStatus}→${statusCode}${coordinateOnly ? ' coordinate-only' : ''} markers and current status after error bookkeeping was retired`, async () => {
  const f = cacheFixture(initialStatus, coordinateOnly), dom = new JSDOM('<div id="status"></div>');
  try {
    const text = await readFile(new URL('../styles/app.mjs', import.meta.url), 'utf8');
    const source = text.slice(text.indexOf('function applyStationFallbackState()'), text.indexOf('const unwrap ='));
    assert.ok(source.includes('function updateStatus()'));
    const status = dom.window.document.getElementById('status'), errors = new Map([['stations', {source: f.source(), stationOwned: true}]]);
    const update = new vm.Script(source + '\nupdateStatus;').runInNewContext({
      map: f.map, ready: true, stationWorldActive: false, clickable: [], isClickable: id => id.startsWith('station-'), stationFailures: f.state, railRecovery: f.recovery, errors, status,
      settings: {stations: true, background: 'map', mode: 'infrastructure'},
      stationFallbackFilter, stationFallbackMarkersEnabled, stationFallbackNamesEnabled,
    });
    update();assert.match(status.textContent, /station data unavailable/);
    if (coordinateOnly) {
      const event = {sourceId: 'stations', coord: {...f.tile.tileID}, error: {status: statusCode}};
      f.state.noteError(event);f.recovery.noteError(event);update();
      assert.equal(status.textContent.includes('Retrying failed tiles'), statusCode === 503);
    }
    f.away();update();assert.equal(errors.size, 0);assert.equal(status.classList.contains('error'), false);
    if (!coordinateOnly && initialStatus !== statusCode) f.fail(statusCode);
    // moveend can precede the renderer's cached-tile reactivation. Exercise
    // the actual app's idle subscription after that earlier wake saw no demand.
    f.recovery.wake();assert.equal(f.timers.size, 0);f.back();
    const idleRegistration = text.match(/map\.on\('idle', [\w]+\);/)?.[0];assert.ok(idleRegistration);
    let idle;
    new vm.Script(idleRegistration).runInNewContext({map: {on: (event, handler) => {assert.equal(event, 'idle');idle = handler;}},
      updateStatus: update, wakeRailRecovery: () => {f.recovery.wake();update();}});
    idle();assert.equal(f.timers.size, statusCode === 503 ? 1 : 0);
    assert.equal(errors.size, 0, 'cache restoration needs no synthetic error event');
    assert.equal(status.classList.contains('error'), true);assert.match(status.textContent, /station data unavailable/);
    assert.equal(status.textContent.includes('Retrying failed tiles'), statusCode === 503, '403 does not acquire retry authority');
    for (const id of STATION_FALLBACK_IDS) assert.equal(f.layouts.get(id), 'visible');
    f.success(f.tile);update();assert.equal(status.classList.contains('error'), false);
    for (const id of STATION_FALLBACK_IDS) assert.equal(f.layouts.get(id), 'none');
  } finally { f.recovery.dispose();dom.window.close(); }
});
