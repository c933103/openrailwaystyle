import test from 'node:test';
import assert from 'node:assert/strict';
import {Measure, climb, lengthKm, formatLength, formatClimb} from '../styles/draw.mjs';
import {createElevation} from '../styles/elevation.mjs';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const route = [[0, 0], [0, 1]];
function harness(heights, units = () => 'metric') {
  const statuses = [], sources = {}, handlers = {};
  const map = {
    on(type, layer, fn) { handlers[type + (typeof layer === 'string' ? ' ' + layer : '')] = fn || layer; },
    getSource: id => sources[id], addSource(id) { sources[id] = {setData(data) { this.data = data; }}; },
    getLayer() {}, addLayer() {}, getCanvas: () => ({style: {}}),
    doubleClickZoom: {enable() {}, disable() {}},
  };
  const measure = new Measure(map, {heights, units, status: s => statuses.push(s)});
  measure.install(); measure.setMode('distance');
  const finish = (points = route) => { for (const [lng, lat] of points) measure.click({lng, lat}); measure.end(); };
  return {measure, finish, statuses, handlers, status: () => statuses.at(-1),
    total: () => sources['atlas-measure'].data.features.find(f => f.properties.kind === 'total')?.properties.label};
}
const unavailable = h => {
  assert.match(h.status(), /End-to-end heights unavailable/);
  assert.doesNotMatch(h.status(), /Finding heights|NaN|Infinity/);
  assert.equal(h.total(), formatLength(lengthKm(route)), 'distance remains available without an invented gradient');
};

for (const values of [[null, null], [null, 20], [20, null], [undefined, 20], [NaN, 20], [20, Infinity], [], null]) {
  test(`settled missing or invalid endpoint heights are unavailable: ${JSON.stringify(values)}`, async () => {
    let calls = 0;
    const h = harness(async () => { calls++; return values; });
    h.finish(); assert.match(h.status(), /Finding heights/); await flush(); unavailable(h);
    for (let i = 0; i < 5; i++) h.measure.refresh();
    await flush(); assert.equal(calls, 1, 'redraws do not poll or retry unavailable heights');
  });
}
for (const synchronous of [false, true]) test(`height loader ${synchronous ? 'throw' : 'rejection'} settles without losing the distance`, async () => {
  const fail = () => { throw new Error('synthetic loader failure'); };
  const h = harness(synchronous ? fail : async () => fail());
  assert.doesNotThrow(() => h.finish()); await flush(); unavailable(h);
});

test('pending is genuine until both endpoint heights settle; healthy labels and units remain unchanged', async () => {
  let resolve, calls = 0, units = 'metric';
  const h = harness(() => { calls++; return new Promise(done => { resolve = done; }); }, () => units);
  h.finish(); await flush(); h.measure.refresh();
  assert.match(h.status(), /Finding heights/); assert.equal(calls, 1);
  resolve([100, 112]); await flush();
  const value = climb(100, 112, lengthKm(route));
  for (const setting of ['metric', 'imperial', 'metric']) {
    units = setting; h.measure.refresh();
    assert.equal(h.total(), `${formatLength(lengthKm(route), units)}\n${formatClimb(value, units)}`);
    assert.match(h.status(), /End to end:/); assert.doesNotMatch(h.status(), /Finding heights|unavailable/);
  }
  assert.equal(calls, 1, 'successful data remains shared across selection/unit redraws');
});

test('actual elevation loader failure and an explicit repeat recover without background retries', async () => {
  let failing = true, requests = 0;
  const elevation = createElevation('https://fixture.invalid/{z}/{x}/{y}', {zoom: 2, load: async () => {
    requests++; if (failing) throw new Error('synthetic tile failure');
    return {size: 1, data: Uint8ClampedArray.from([128, 10, 0, 255])};
  }});
  const h = harness(elevation.heights);
  h.finish(); await flush(); unavailable(h);
  const failedRequests = requests; assert.equal(failedRequests, 2);
  failing = false; h.measure.refresh(); await flush(); assert.equal(requests, failedRequests);
  h.finish(); await flush();
  assert.equal(requests, failedRequests + 2, 'a new completed measurement may retry the two failed tiles');
  assert.match(h.status(), /End to end: ±0 m/); assert.doesNotMatch(h.status(), /Finding heights|unavailable/);
  h.measure.refresh(); await flush(); assert.equal(requests, failedRequests + 2);
});

for (const reset of ['clear', 'mode', 'undo', 'next']) test(`${reset} invalidates pending ownership even when the next measurement has identical endpoints`, async () => {
  const pending = [];
  const h = harness(() => new Promise((resolve, reject) => pending.push({resolve, reject})));
  h.finish(); await flush(); assert.equal(pending.length, 1);
  if (reset === 'clear') { h.measure.clear(); h.finish(); }
  else if (reset === 'mode') { h.measure.setMode('radius'); h.measure.setMode('distance'); h.finish(); }
  else if (reset === 'undo') { h.measure.undo(); h.measure.click({lng: 0, lat: 1}); h.measure.end(); }
  else h.finish();
  await flush(); assert.equal(pending.length, 2);
  pending[0].resolve([100, 999]); await flush();
  assert.match(h.status(), /Finding heights/); assert.doesNotMatch(h.total(), /899/);
  pending[1].resolve([100, 112]); await flush(); assert.match(h.status(), /End to end: \+12 m/);
});

for (const oldFailure of [false, true]) test(`obsolete ${oldFailure ? 'failure' : 'success'} cannot replace a newer completed measurement`, async () => {
  const pending = [];
  const h = harness(() => new Promise((resolve, reject) => pending.push({resolve, reject})));
  h.finish(); await flush(); h.measure.clear(); h.finish(); await flush();
  assert.equal(pending.length, 2); pending[1].resolve([100, 112]); await flush();
  const expected = h.status(), label = h.total(), updates = h.statuses.length;
  if (oldFailure) pending[0].reject(new Error('obsolete failure')); else pending[0].resolve([null, null]);
  await flush(); assert.equal(h.status(), expected); assert.equal(h.total(), label); assert.equal(h.statuses.length, updates);
});

test('healthy sea-level and below-sea-level endpoints remain valid; nonfinite or nonnumeric inputs do not create gradients', () => {
  assert.deepEqual(climb(-10, 0, 1), {rise: 10, gradient: 0.01});
  assert.deepEqual(climb(0, 0, 1), {rise: 0, gradient: 0});
  for (const value of [null, undefined, false, '', '20', NaN, Infinity, -Infinity]) {
    assert.equal(climb(value, 10, 1), null); assert.equal(climb(10, value, 1), null);
  }
  for (const km of [0, -1, NaN, Infinity, '1']) assert.equal(climb(10, 20, km), null);
});

test('without an endpoint loader, measuring distance remains complete without a height status', async () => {
  const h = harness(null); h.finish(); await flush();
  assert.doesNotMatch(h.status(), /Finding heights|unavailable|End to end/);
  assert.equal(h.total(), formatLength(lengthKm(route)));
});

test('clearing before the endpoint task begins does not start obsolete work', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return [100, 112]; });
  h.finish(); h.measure.clear(); await flush();
  assert.equal(calls, 0); assert.equal(h.total(), undefined);
  assert.doesNotMatch(h.status(), /Finding heights|unavailable|End to end/);
});

test('explicit height retry keeps rendered endpoint selection and the finished geometry', async () => {
  const pending = [], h = harness(() => new Promise(resolve => pending.push(resolve)));
  h.finish(); await flush(); pending[0]([null, null]); await flush();
  const map = h.measure.map;
  map.getLayer = id => id === 'measure-point-targets' ? {} : undefined;
  map.queryRenderedFeatures = () => [{properties: {index: 0}}];
  h.measure.click({lng: 0, lat: 0}, {x: 0, y: 0});
  assert.equal(h.measure.selected, 0, 'clicking an existing endpoint still selects it for editing');
  assert.equal(h.measure.ended, true); assert.equal(h.measure.canRetryHeights, true);
  const before = h.measure.collection();
  h.measure.retryHeights(); h.measure.retryHeights(); await flush();
  assert.equal(pending.length, 2, 'repeated retry actions coalesce while pending');
  assert.equal(h.measure.canRetryHeights, false); assert.match(h.status(), /Finding heights/);
  assert.deepEqual(h.measure.collection(), before); assert.equal(h.measure.selected, 0);
  pending[1]([100, 112]); await flush();
  assert.match(h.status(), /End to end: \+12 m/); assert.equal(h.measure.canRetryHeights, false);
  h.measure.retryHeights(); await flush(); assert.equal(pending.length, 2, 'healthy heights are not retried');
});

test('a failed explicit retry returns to unavailable and a cleared measurement cannot retry', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; throw new Error('synthetic failure'); });
  h.finish(); await flush(); unavailable(h); assert.equal(h.measure.canRetryHeights, true);
  h.measure.retryHeights(); await flush(); unavailable(h); assert.equal(calls, 2);
  h.measure.clear(); assert.equal(h.measure.canRetryHeights, false);
  h.measure.retryHeights(); await flush(); assert.equal(calls, 2);
});
