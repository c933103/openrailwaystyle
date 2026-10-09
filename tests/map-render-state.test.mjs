import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {captureMapRenderState, readMapRenderState} from '../scripts/map-render-state.mjs';

function fakeMap() {
  return {
    loaded: () => false, areTilesLoaded: () => true, isMoving: () => false, getZoom: () => 9,
    getCanvas: () => ({width: 1365, height: 900}),
    getContainer: () => ({clientWidth: 5460, clientHeight: 3600}), getPixelRatio: () => 0.25,
    getStyle: () => ({sources: {rail: {}, stations: {}}}),
    isSourceLoaded: id => id === 'stations',
    style: {tileManagers: {
      rail: {_inViewTiles: {getAllTiles: () => [{state: 'loaded'}, {state: 'loading'}]}},
      stations: {_inViewTiles: {getAllTiles: () => []}},
    }},
    _styleDirty: false, _sourcesDirty: true, _placementDirty: false, _frameRequest: null, _repaint: false,
    painter: {context: {gl: {isContextLost: () => false, drawingBufferWidth: 1365, drawingBufferHeight: 900}}},
  };
}

test('failure snapshot captures public state and current MapLibre tile managers without mutating the map', async () => {
  const map = fakeMap();
  const before = JSON.stringify(map);
  // Match Playwright serialization: no closed-over imports or local helpers.
  const serialized = (0, eval)(`(${captureMapRenderState.toString()})`);
  const state = await serialized(map);
  assert.equal(state.loaded, false); assert.equal(state.tilesLoaded, true); assert.equal(state.moving, false);
  assert.deepEqual(state.canvas, {width: 1365, height: 900, clientWidth: 5460, clientHeight: 3600, pixelRatio: 0.25});
  assert.deepEqual(state.sources.rail, {loaded: false, tiles: {states: {loaded: 1, loading: 1}, total: 2, truncated: false}});
  assert.deepEqual(state.sources.stations, {loaded: true, tiles: {states: {}, total: 0, truncated: false}});
  assert.equal(state.renderer.sourcesDirty, true); assert.equal(state.renderer.frameScheduled, false);
  assert.equal(state.renderer.contextLost, false); assert.deepEqual(state.unavailable, []);
  assert.equal(JSON.stringify(map), before);
});

test('missing or stale private members never erase public state', async () => {
  for (const style of [undefined, {}, {sourceCaches: {rail: {_tiles: {}}}}, {tileManagers: {rail: {_inViewTiles: {getAllTiles() {throw new Error('changed internals');}}}}}]) {
    const map = fakeMap(); map.style = style; delete map.painter; delete map._frameRequest;
    const state = await captureMapRenderState(map);
    assert.equal(state.zoom, 9); assert.equal(state.tilesLoaded, true);
    assert.equal(state.sources.rail.loaded, false); assert.equal(state.sources.stations.loaded, true);
    assert.equal(state.sources.rail.tiles, null); assert.equal(state.renderer.contextLost, null);
    assert.equal(state.renderer.frameScheduled, null);
    assert.ok(state.unavailable.includes('source:rail:tiles'));
    assert.ok(state.unavailable.includes('contextLost'));
  }
});

test('one failed public source read and hostile private getter preserve independent observations', async () => {
  const map = fakeMap();
  map.isSourceLoaded = id => {if (id === 'rail') throw new Error('source disappeared'); return true;};
  Object.defineProperty(map, 'style', {get() {throw new Error('style disappeared');}});
  const state = await captureMapRenderState(map);
  assert.equal(state.sources.rail.loaded, null); assert.equal(state.sources.stations.loaded, true);
  assert.equal(state.canvas.width, 1365); assert.equal(state.renderer.contextLost, false);
  assert.ok(state.unavailable.includes('source:rail:loaded'));
});

test('missing public style does not collapse the map and canvas snapshot', async () => {
  const map = fakeMap(); map.getStyle = () => {throw new Error('style not ready');};
  const state = await captureMapRenderState(map);
  assert.equal(state.loaded, false); assert.equal(state.canvas.pixelRatio, 0.25);
  assert.deepEqual(state.sources, {}); assert.ok(state.unavailable.includes('sourceIds'));
});

test('source and tile details are bounded and explicitly marked when truncated', async () => {
  const map = fakeMap();
  map.getStyle = () => ({sources: Object.fromEntries(Array.from({length: 201}, (_, i) => [`source${i}`, {}]))});
  map.style = {tileManagers: {source0: {_inViewTiles: {getAllTiles: () => Array.from({length: 2001}, () => ({state: 'loaded'}))}}}};
  const state = await captureMapRenderState(map);
  assert.equal(Object.keys(state.sources).length, 200); assert.equal(state.sourcesTruncated, true);
  assert.deepEqual(state.sources.source0.tiles, {states: {loaded: 2000}, total: 2001, truncated: true});
});

test('page failures and a stalled renderer produce explicit bounded diagnostics', async () => {
  const map = fakeMap();
  assert.equal((await readMapRenderState({evaluate: fn => fn(map)})).zoom, 9);
  assert.deepEqual(await readMapRenderState({evaluate: async () => {throw new Error('execution context lost');}}), {unavailable: ['page evaluation']});
  assert.deepEqual(await readMapRenderState({evaluate: () => {throw new Error('closed page');}}), {unavailable: ['page evaluation']});
  assert.deepEqual(await readMapRenderState({evaluate: () => new Promise(() => {})}, 20), {unavailable: ['page evaluation timed out'], timeout: 20});
});

test('controls retain real idle, all settlement predicates and the original 60-second deadline', async () => {
  const source = await readFile(new URL('../scripts/check-map-controls-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /map\.once\('idle',\(\)=>resolve\(\)\);map\.triggerRepaint\(\)/);
  assert.match(source, /map\.loaded\(\)&&map\.areTilesLoaded\(\)&&!map\.isMoving\(\)/);
  assert.match(source, /canvas\.width===Math\.floor\(container\.clientWidth\*ratio\)&&canvas\.height===Math\.floor\(container\.clientHeight\*ratio\)/);
  assert.match(source, /\},null,\{timeout:60000\}\)/);
  assert.match(source, /map-controls-source-state\.json/);
  assert.doesNotMatch(source, /sourceCaches/);
});

test('diagnostics contain source IDs and whitelisted states, never style data or exception messages', async () => {
  const map = fakeMap();
  const secret = 'https://provider.invalid/tiles?credential=never-log';
  map.getStyle = () => ({sources: {rail: {url: secret}}, layers: [{metadata: secret}]});
  map.style.tileManagers.rail._inViewTiles.getAllTiles = () => [{state: secret}];
  map.isSourceLoaded = () => {throw new Error(secret);};
  const state = await captureMapRenderState(map);
  assert.deepEqual(state.sources.rail.tiles.states, {unknown: 1});
  assert.doesNotMatch(JSON.stringify(state), /provider|credential|never-log/);
});
