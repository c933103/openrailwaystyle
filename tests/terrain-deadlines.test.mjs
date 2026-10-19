import test from 'node:test';
import assert from 'node:assert/strict';
import {terrainTask, sharedTerrainTiles, TERRAIN_TIMEOUT_MS, REPAIR_TIMEOUT_MS} from '../styles/terrain-requests.mjs';
import {createElevation} from '../styles/elevation.mjs';
import {createDemTileLoader} from '../styles/dem-loader.mjs';
import {encodeTerrarium, witnessTiles} from '../styles/dem-repair.mjs';
import {profileHarness} from './helpers/profile-ui-harness.mjs';
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject}; };
const pixel = h => ({size: 1, data: Uint8ClampedArray.from([...encodeTerrarium(h), 255])});
function clocks(t) { t.mock.timers.enable({apis: ['setTimeout']}); return async ms => {t.mock.timers.tick(ms); await flush();}; }
function globals(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {value, writable: true, configurable: true});
    t.after(() => before ? Object.defineProperty(globalThis, key, before) : delete globalThis[key]);
  }
}

test('a deadline settles a non-cooperative loader; late settlement cannot poison a retry', async t => {
  const advance = clocks(t), calls = [];
  const get = sharedTerrainTiles((key, signal) => { const d = deferred(); calls.push({...d, signal}); return d.promise; });
  const old = get('tile'); const failed = assert.rejects(old, /timed out/);
  await flush(); await advance(TERRAIN_TIMEOUT_MS - 1); assert.equal(calls[0].signal.aborted, false);
  await advance(1); await failed; assert.equal(calls[0].signal.aborted, true);
  const fresh = get('tile'); await flush(); assert.equal(calls.length, 2);
  calls[0].resolve(pixel(99)); await flush();
  const shared = get('tile'); await flush(); assert.equal(calls.length, 2, 'old finalizer must not remove the new pending entry');
  calls[1].resolve(pixel(12)); assert.equal((await fresh).data[1], 12); await shared;
  assert.equal((await get('tile')).data[1], 12, 'late old bytes must not enter completed cache');
});

test('cancelling one consumer preserves another; abandoning all removes pending work synchronously', async t => {
  clocks(t); const calls = [];
  const get = sharedTerrainTiles((key, signal) => {const d = deferred(); calls.push({...d, signal}); return d.promise;}, {keep: 1});
  const a = new AbortController(), b = new AbortController();
  const first = get('tile', a.signal), second = get('tile', b.signal);
  const rejectedA = assert.rejects(first, {name: 'AbortError'}), rejectedB = assert.rejects(second, {name: 'AbortError'});
  await flush(); a.abort(); await rejectedA; assert.equal(calls[0].signal.aborted, false);
  b.abort(); const next = get('tile'); await flush(); await rejectedB;
  assert.equal(calls.length, 2); assert.equal(calls[0].signal.aborted, true);
  calls[0].reject(new Error('late rejected transport')); calls[1].resolve(pixel(25));
  assert.equal((await next).data[1], 25); assert.equal((await get('tile')).data[1], 25);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(get('tile', cancelled.signal), {name: 'AbortError'});
});

for (const stall of ['headers', 'body', 'decode']) test(`actual elevation transport bounds stalled ${stall}, releases late resources and recovers`, async t => {
  const advance = clocks(t), blocked = deferred(), calls = [], bitmaps = [];
  let failing = true, cancelledBodies = 0;
  const response = () => ({ok: true, body: {cancel() {cancelledBodies++;}}, blob: () => failing && stall === 'body' ? blocked.promise : Promise.resolve(new Blob(['fixture']))});
  globals(t, {
    fetch: (url, {signal}) => {calls.push({url, signal}); return failing && stall === 'headers' ? blocked.promise : Promise.resolve(response());},
    createImageBitmap: () => {
      const image = {width: 1, height: 1, closed: false, close() {this.closed = true;}}; bitmaps.push(image);
      return failing && stall === 'decode' ? blocked.promise : Promise.resolve(image);
    },
    OffscreenCanvas: class {getContext() {return {drawImage() {}, getImageData: () => ({width: 1, data: pixel(14).data})};}},
  });
  const elevation = createElevation('https://terrain.fixture/{z}/{x}/{y}', {zoom: 2});
  const first = elevation.heights([[1, 1], [2, 2]]); await flush();
  await advance(TERRAIN_TIMEOUT_MS); assert.deepEqual(await first, [null, null]);
  assert.equal(calls[0].signal.aborted, true); assert.equal(calls.length, 1);
  failing = false;
  assert.deepEqual(await elevation.heights([[1, 1]]), [14]); assert.equal(calls.length, 2);
  if (stall === 'headers') blocked.resolve(response());
  if (stall === 'body') blocked.resolve(new Blob(['late']));
  if (stall === 'decode') blocked.resolve(bitmaps[0]);
  await flush();
  assert.ok(bitmaps.every(image => image.closed), 'all finished image bitmaps are closed, including late decodes');
  if (stall === 'headers') assert.equal(cancelledBodies, 1);
  assert.deepEqual(await elevation.heights([[1, 1]]), [14]); assert.equal(calls.length, 2);
});

test('stalled profile tiles settle as explicit gaps and only missing tiles retry', async t => {
  const advance = clocks(t), calls = [];
  let fail = true;
  const terrain = createElevation('fixture/{z}/{x}/{y}', {zoom: 2, load: (url, signal) => {
    calls.push({url, signal}); return fail && url.includes('/3/') ? new Promise(() => {}) : Promise.resolve(pixel(10));
  }});
  const h = profileHarness({heights: terrain.heights}); t.after(h.close);
  const first = h.show('Partial', [[-170, 10], [80, 10]]); await flush();
  assert.match(h.content().textContent, /Finding heights/); await advance(TERRAIN_TIMEOUT_MS); await first;
  assert.match(h.content().textContent, /Incomplete elevation profile/); assert.doesNotMatch(h.content().textContent, /Finding heights/);
  assert.equal(h.content().querySelectorAll('polyline').length, 2);
  fail = false; await h.show('Recovered', [[-170, 10], [80, 10]]);
  assert.doesNotMatch(h.content().textContent, /Incomplete|Finding heights/);
  assert.equal(calls.length, 4, 'three initial tile reads and one explicit missing-tile retry');
});

for (const action of ['close', 'new profile']) test(`profile ${action} aborts old reads and recovery ignores their late completion`, async t => {
  clocks(t); const calls = [];
  const terrain = createElevation('fixture/{z}/{x}/{y}', {zoom: 2, load: (url, signal) => {const d = deferred(); calls.push({...d, signal}); return d.promise;}});
  const h = profileHarness({heights: terrain.heights}); t.after(h.close);
  const old = h.show('Old'); await flush(); assert.equal(calls.length, 1);
  if (action === 'close') h.dismiss();
  const next = h.show('New'); await flush(); await old;
  assert.equal(calls[0].signal.aborted, true); assert.equal(calls.length, 2);
  calls[1].resolve(pixel(20)); await next; const rendered = h.content().textContent;
  calls[0].resolve(pixel(99)); await flush(); assert.equal(h.content().textContent, rendered);
  assert.match(rendered, /New/); assert.doesNotMatch(rendered, /99 m/);
});

test('optional elevation repair has its own total deadline and preserves a usable fine tile', async t => {
  const advance = clocks(t), calls = [];
  const elevation = createElevation('fixture/{z}/{x}/{y}', {load: (url, signal) => {
    calls.push({url, signal}); return url.startsWith('fixture/14/') ? Promise.resolve(pixel(31)) : new Promise(() => {});
  }});
  const result = elevation.heights([[1, 1]]); await flush(); assert.equal(calls.length, 2);
  await advance(REPAIR_TIMEOUT_MS); assert.deepEqual(await result, [31]); assert.equal(calls[1].signal.aborted, true);
  assert.deepEqual(await elevation.heights([[1, 1]]), [31]); assert.equal(calls.length, 2, 'usable completed fine results retain existing caching semantics');
});

function workerFixture(t, fetcher, decode) {
  globals(t, {OffscreenCanvas: class {}});
  return createDemTileLoader({fetcher, decode: decode || (async () => ({pixels: {width: 1, data: pixel(42).data}}))});
}
const workerResponse = blob => ({ok: true, blob: async () => blob, headers: new Headers({'cache-control': 'max-age=60'})});
for (const stall of ['headers', 'body', 'decode']) test(`worker repair-reference stalled ${stall} preserves fine bytes, aborts and retries without negative cache`, async t => {
  const advance = clocks(t), calls = [], blocked = deferred(); let failing = true;
  const main = new Blob(['fine']), coarse = new Blob(['coarse']);
  const getTile = workerFixture(t, (url, {signal}) => {
    calls.push({url, signal}); if (url.includes('/14/')) return Promise.resolve(workerResponse(main));
    if (failing && stall === 'headers') return blocked.promise;
    if (failing && stall === 'body') return Promise.resolve({...workerResponse(coarse), blob: () => blocked.promise});
    return Promise.resolve(workerResponse(coarse));
  }, async blob => blob === coarse && failing && stall === 'decode' ? blocked.promise : {pixels: {width: 1, data: pixel(42).data}});
  const first = getTile('https://terrain.fixture/14/8192/8192.png', new AbortController()); await flush();
  await advance(REPAIR_TIMEOUT_MS); assert.equal((await first).data, main); assert.equal(calls[1].signal.aborted, true);
  failing = false; const second = await getTile('https://terrain.fixture/14/8193/8192.png', new AbortController());
  assert.equal(second.data, main); assert.equal(calls.filter(c => c.url.includes('/12/')).length, 2);
  blocked.resolve(stall === 'headers' ? workerResponse(coarse) : stall === 'body' ? coarse : {pixels: {width: 1, data: pixel(99).data}});
  await flush(); await getTile('https://terrain.fixture/14/8194/8192.png', new AbortController());
  assert.equal(calls.filter(c => c.url.includes('/12/')).length, 2, 'healthy reference stays cached after late old completion');
});

test('worker cancellation of one parent does not abort a shared repair reference needed by another', async t => {
  clocks(t); const blocked = deferred(), calls = [], main = new Blob(['fine']), coarse = new Blob(['coarse']);
  const getTile = workerFixture(t, (url, {signal}) => {
    calls.push({url, signal}); return url.includes('/14/') ? Promise.resolve(workerResponse(main)) : blocked.promise;
  });
  const a = new AbortController(), b = new AbortController();
  const first = getTile('fixture/14/8192/8192.png', a), second = getTile('fixture/14/8193/8192.png', b);
  const rejected = assert.rejects(first, {name: 'AbortError'}); await flush();
  assert.equal(calls.length, 3); a.abort(); await rejected; assert.equal(calls[2].signal.aborted, false);
  blocked.resolve(workerResponse(coarse)); assert.equal((await second).data, main);
});

test('worker finer witness timeout is bounded separately from successful main/coarser reads', async t => {
  const advance = clocks(t), calls = [];
  const data = new Uint8ClampedArray(256 * 256 * 4);
  // A multi-pixel pit shared with the coarse source still needs a finer witness.
  const pit = {'66,158': -322, '65,158': -237, '66,157': -249, '65,157': -191, '65,159': -107};
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++)
    data.set([...encodeTerrarium(pit[`${x},${y}`] ?? 2 + (x + y) % 3), 255], (y * 256 + x) * 4);
  assert.ok(witnessTiles(data, 256, 12, 3347, 1786).tiles.length);
  const main = new Blob(['fine']);
  const getTile = workerFixture(t, (url, {signal}) => {
    calls.push({url, signal}); return url.includes('/13/') ? new Promise(() => {}) : Promise.resolve(workerResponse(main));
  }, async () => ({pixels: {width: 256, data: data.slice()}, context: {putImageData() {}}, canvas: {convertToBlob: async () => main}}));
  const first = getTile('fixture/12/3347/1786.png', new AbortController()); await flush();
  assert.ok(calls.some(c => c.url.includes('/13/'))); await advance(REPAIR_TIMEOUT_MS);
  assert.equal((await first).data, main);
  assert.ok(calls.filter(c => c.url.includes('/13/')).every(c => c.signal.aborted));
});

test('a successful operation clears its timer and parent abort listener', async t => {
  const advance = clocks(t), controller = new AbortController(); let child;
  assert.equal(await terrainTask(signal => {child = signal; return 1;}, {signal: controller.signal}), 1);
  controller.abort(); await advance(TERRAIN_TIMEOUT_MS); assert.equal(child.aborted, false);
});

for (const phase of ['headers', 'body']) test(`worker main ${phase} cannot outlive its deadline or cancellation`, async t => {
  const advance = clocks(t), calls = [];
  const getTile = workerFixture(t, (url, {signal}) => {
    calls.push(signal);
    return phase === 'headers' ? new Promise(() => {}) : Promise.resolve({...workerResponse(new Blob()), blob: () => new Promise(() => {})});
  });
  const timed = getTile('fixture/14/1/1.png', new AbortController());
  const failed = assert.rejects(timed, /timed out/); await flush(); await advance(TERRAIN_TIMEOUT_MS); await failed;
  assert.equal(calls[0].aborted, true);
  const controller = new AbortController(), abandoned = getTile('fixture/14/1/1.png', controller);
  const cancelled = assert.rejects(abandoned, {name: 'AbortError'}); await flush(); controller.abort(); await cancelled;
  assert.equal(calls[1].aborted, true);
});

test('a non-cooperative worker decoder cannot retain a fine tile in pending repair', async t => {
  const advance = clocks(t), signals = [], fine = new Blob(['fine']);
  const getTile = workerFixture(t, async () => workerResponse(fine), (blob, signal) => {signals.push(signal); return new Promise(() => {});});
  const pending = getTile('fixture/14/1/1.png', new AbortController()); await flush(); await advance(REPAIR_TIMEOUT_MS);
  assert.equal((await pending).data, fine); assert.ok(signals.every(signal => signal.aborted));
});
