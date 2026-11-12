import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatformLengths, createPlatformTileGeometry} from '../styles/platform-length.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const feature = {properties: {id: 'way-40'}, geometry: {type: 'LineString', coordinates: [[.0015, .002], [.0035, .002]]}};
const seeds = [[16384, 16383]];

// A clipped three-tile line. Only its first visible fragment seeds the real
// measurement; the tile reader discovers both remaining pieces itself.
function fixture({hold = true} = {}) {
  let release;
  const requests = [];
  const geometry = createPlatformTileGeometry({
    tileURL: () => 'https://fixture.invalid/platform/{z}/{x}/{y}',
    fetcher: async url => {
      requests.push(url);
      if (hold && requests.length === 1) await new Promise(resolve => { release = resolve; });
      return {ok: true, status: 200, arrayBuffer: async () => url};
    },
    decode: url => {
      const x = Number(url.split('/').at(-2));
      return [{id: 'way-40', type: 2, extent: 4096,
        geometry: [[[x === 16384 ? 4090 : 0, 100], [x < 16386 ? 4100 : 100, 100]]]}];
    },
  });
  return {geometry, requests, release: () => release()};
}

function view() {
  let zoom = 19, data;
  const loaded = fixture(), signals = [], completed = [], results = [];
  const map = {getZoom: () => zoom, getLayer: () => ({}),
    queryRenderedFeatures: ({layers}) => layers.includes('platform-edges') ? [] : [feature],
    getSource: id => id === 'platformNumbers' ? {setData(value) { data = value; }} : null};
  const lengths = createPlatformLengths(map, {delay: 60000,
    geometry: {async measure(id, tiles, signal) { signals.push(signal); const result = await loaded.geometry.measure(id, tiles, signal); results.push(result); return result; }},
    fetcher: async () => { throw new Error('Reference API must not be needed by this controlled measurement'); },
    onPlatform: (id, result) => completed.push({id, ...result}),
  });
  return {loaded, signals, completed, results, lengths, data: () => data,
    zoomTo(value) { zoom = value; lengths.update(); }};
}

for (const zoom of [17, 18]) test(`zooming from 19 to ${zoom} stops hidden length work and preserves exact resumed output`, async () => {
  const reference = fixture({hold: false});
  const expected = await reference.geometry.measure('way-40', seeds);
  assert.equal(reference.requests.length, 3);
  const current = view();
  try {
    current.lengths.update();
    assert.equal(current.loaded.requests.length, 1);
    current.zoomTo(zoom);
    assert.equal(current.signals[0].aborted, true);
    await tick();
    current.loaded.release();
    await tick();
    assert.equal(current.loaded.requests.length, 1, 'no neighbour request after length display becomes ineligible');
    assert.deepEqual(current.completed, [], 'the cancelled result cannot be cached as a measured platform');
    assert.equal(current.signals.length, 1, 'no replacement measurement below zoom 19');
    current.zoomTo(19);
    await tick();
    assert.equal(current.signals.length, 2, 'intentional cancellation does not impose failure backoff');
    assert.equal(current.signals[1].aborted, false);
    assert.deepEqual(current.results, [expected], 'complete geometry and visited-tile output are unchanged');
    const {tiles, ...properties} = expected;
    assert.deepEqual(current.completed, [{id: 'way-40', ...properties, measured: true}]);
    assert.equal(current.loaded.requests.length, 3, 'the completed first tile is reused on resume');
    assert.deepEqual(current.loaded.requests, reference.requests);
    assert.equal(current.data().features[0].properties.platform_length, expected.length);
  } finally { current.lengths.destroy(); }
});

test('zooming back to 19 before the abort settles resumes the same pending tile without duplicate work', async () => {
  const expected = await fixture({hold: false}).geometry.measure('way-40', seeds);
  const current = view();
  try {
    current.lengths.update();
    current.zoomTo(18);
    current.zoomTo(19);
    assert.equal(current.signals[0].aborted, true);
    await tick();
    assert.equal(current.signals.length, 2);
    assert.equal(current.loaded.requests.length, 1, 'both measurement lifetimes share the unfinished tile');
    current.loaded.release();
    await tick();
    assert.equal(current.loaded.requests.length, 3);
    assert.deepEqual(current.results, [expected], 'complete geometry and visited-tile output are unchanged');
    const {tiles, ...properties} = expected;
    assert.deepEqual(current.completed, [{id: 'way-40', ...properties, measured: true}]);
  } finally { current.lengths.destroy(); }
});

for (const zoom of [19, 20]) test(`eligible zoom ${zoom} keeps the active measurement and complete output`, async () => {
  const expected = await fixture({hold: false}).geometry.measure('way-40', seeds);
  const current = view();
  try {
    current.lengths.update();
    current.zoomTo(zoom);
    assert.equal(current.signals[0].aborted, false);
    current.loaded.release();
    await tick();
    assert.equal(current.signals.length, 1);
    assert.equal(current.loaded.requests.length, 3);
    assert.deepEqual(current.results, [expected], 'complete geometry and visited-tile output are unchanged');
    const {tiles, ...properties} = expected;
    assert.deepEqual(current.completed, [{id: 'way-40', ...properties, measured: true}]);
  } finally { current.lengths.destroy(); }
});
