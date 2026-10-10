import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile, mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {createResponseCache} from '../scripts/browser-response-cache.mjs';
import {createRequestPool} from '../styles/request-pool.mjs';
import {measureStationDensity, resetStationSources, stationFailureCount} from '../scripts/station-density-comparison.mjs';
import {fetchLoopbackNoRedirect, localOrmAuditTarget} from '../scripts/browser-policy.mjs';

const url = 'http://127.0.0.1:4174/standard_railway_text_stations_low/4/8/5.pbf';
const response = (status = 200, bytes = 'shared fixture') => ({
  status: () => status, headers: () => ({}), body: async () => Buffer.from(bytes),
});
const changed = {dataType: 'source', sourceDataType: 'content', sourceDataChanged: true};

test('the actual audit initializes reused invalidation evidence before clean runs and browser-launch failures', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'station-density-evidence-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const artifact = join(directory, 'browser-review/stations-desktop-density-invalidated.json');
  await mkdir(join(directory, 'browser-review'));
  const source = await readFile(new URL('../scripts/check-major-stations-browser.mjs', import.meta.url), 'utf8');
  const start = Math.min(source.indexOf("await mkdir('browser-review'"), source.indexOf('const browser=await launchBrowser'));
  const end = source.indexOf('try{for', start);assert.ok(start > 0 && end > start);
  const initialize = new vm.Script(`(async()=>{${source.slice(start, end)}})()`);
  for (const failLaunch of [false, true, false]) {
    await writeFile(artifact, JSON.stringify([{region: 'previous run', attempt: 2}]));
    const run = initialize.runInNewContext({
      mkdir: (path, options) => mkdir(join(directory, path), options),
      writeFile: (path, ...args) => writeFile(join(directory, path), ...args),
      launchBrowser: async () => {
        assert.deepEqual(JSON.parse(await readFile(artifact, 'utf8')), [], 'clear old evidence before launching');
        if (failLaunch) throw new Error('controlled browser launch failure');
        return {};
      },
    });
    if (failLaunch) await assert.rejects(run, /controlled browser launch failure/);else await run;
    assert.deepEqual(JSON.parse(await readFile(artifact, 'utf8')), [], 'a clean run needs no discard callback to clear old records');
  }
});

function pageFixture({mode = 'normal', tiles = false} = {}) {
  const events = new EventEmitter();
  const retained = new Map(), calls = [], sources = {}, definitions = {};
  for (const id of ['stationLow', 'stationMed']) {
    const source = new EventEmitter();sources[id] = source;
    definitions[id] = tiles ? {tiles: [url]} : {url: url + '/' + id};
    const update = value => {
      calls.push({id, value});
      queueMicrotask(() => {
        if (mode === 'noop') return;
        if (mode === 'error') { source.emit('error', {error: new Error('fixture reset error')});return; }
        if (mode === 'unrelated') { source.emit('data', {...changed, sourceDataChanged: false});return; }
        retained.clear();source.emit('data', changed);
      });
    };
    source.setUrl = update;source.setTiles = update;
  }
  return {retained, calls, sources, definitions, on: events.on.bind(events), emit: events.emit.bind(events), getStyle: () => ({sources: definitions}), getSource: id => sources[id]};
}

function comparison(statuses, order = ['before', 'after']) {
  const cache = createResponseCache(), pages = {before: pageFixture(), after: pageFixture()}, discarded = [];
  let fetches = 0, resets = 0, measurements = 0;
  const fetch = async () => {
    const next = statuses[Math.min(fetches++, statuses.length - 1)];
    if (next instanceof Error) throw next;
    return response(next);
  };
  const count = async page => {
    if (!page.retained.has(url)) page.retained.set(url, await cache(url, fetch));
    return 10 + (page.retained.get(url).status === 200 ? 5 : 0);
  };
  const reset = async () => { resets++;await Promise.all(Object.values(pages).map(page => resetStationSources(page))); };
  const measure = async () => {
    measurements++;
    const counts = {};
    for (const side of order) counts[side] = await count(pages[side]);
    return counts;
  };
  const options = {failureCount: () => cache.failureCount() + Object.values(pages).reduce((sum, page) => sum + stationFailureCount(page), 0), reset, measure, onDiscard: row => discarded.push(row)};
  return {cache, pages, options, discarded, fetch, counts: () => ({fetches, resets, measurements})};
}

for (const order of [['before', 'after'], ['after', 'before']]) test(`sequential ${order.join('/')} recovery discards the biased pair and refreshes both page caches`, async () => {
  const control = comparison([503, 200], order);
  const biased = await control.options.measure();
  assert.equal(biased[order[0]], 10);assert.equal(biased[order[1]], 15);
  const fixture = comparison([503, 200], order);
  const result = await measureStationDensity(fixture.options);
  assert.deepEqual(result, {before: 15, after: 15});
  assert.deepEqual(fixture.counts(), {fetches: 2, resets: 2, measurements: 2});
  assert.equal(fixture.discarded.length, 1);
  assert.equal(fixture.discarded[0].counts[order[0]], 10);
  assert.equal(fixture.discarded[0].counts[order[1]], 15);
  assert.equal(fixture.discarded[0].afterFailures, 1);
  for (const page of Object.values(fixture.pages)) {
    assert.equal(page.calls.length, 4, 'both station sources reset on both attempts');
    assert.equal(page.retained.get(url).body.toString(), 'shared fixture');
  }
});

test('a failure before the counted viewport cannot leave retained missing tiles on either page', async () => {
  const fixture = comparison([200]);
  const failed = await fixture.cache(url, async () => response(503));
  fixture.pages.before.retained.set(url, failed);
  fixture.pages.after.retained.set(url, response());
  assert.equal(fixture.cache.failureCount(), 1);
  assert.deepEqual(await measureStationDensity(fixture.options), {before: 15, after: 15});
  assert.deepEqual(fixture.counts(), {fetches: 1, resets: 1, measurements: 1});
  assert.equal(fixture.discarded.length, 0, 'the initial paired reset cleared the earlier error');
});

test('a rejected first-side fetch retries the complete pair once, not just its next consumer', async () => {
  const fixture = comparison([new Error('controlled body/fetch failure'), 200]);
  assert.deepEqual(await measureStationDensity(fixture.options), {before: 15, after: 15});
  assert.deepEqual(fixture.counts(), {fetches: 2, resets: 2, measurements: 2});
  assert.equal(fixture.discarded[0].measurementError, true);
});

test('persistent station failure is bounded and never produces an accepted density pair', async () => {
  const fixture = comparison([503]);
  await assert.rejects(measureStationDensity(fixture.options), /two paired attempts/);
  assert.deepEqual(fixture.counts(), {fetches: 4, resets: 2, measurements: 2});
  assert.deepEqual(fixture.discarded.map(row => row.attempt), [1, 2]);
});

test('discarded attempt evidence is saved before retrying and before reporting exhaustion', async () => {
  const fixture = comparison([503]), saved = [];
  await assert.rejects(measureStationDensity({...fixture.options, onDiscard: async row => {
    await new Promise(resolve => setTimeout(resolve, 5));saved.push(row);
  }}), /two paired attempts/);
  assert.deepEqual(saved.map(row => row.attempt), [1, 2]);
  assert.ok(saved.every(row => row.counts.before === 10 && row.counts.after === 10));
});

test('alternating recovery and failure outside the counted viewport invalidates an otherwise equal second pair', async () => {
  const fixture = comparison([503, 200]);
  let attempt = 0;
  const measure = async () => {
    const result = await fixture.options.measure();
    if (++attempt === 2) await fixture.cache(url + '?outside-current-viewport', async () => response(503));
    return result;
  };
  await assert.rejects(measureStationDensity({...fixture.options, measure}), /unequal inputs were discarded/);
  assert.equal(fixture.discarded.length, 2);
  assert.deepEqual(fixture.discarded[1].counts, {before: 15, after: 15});
  assert.deepEqual(fixture.counts(), {fetches: 2, resets: 2, measurements: 2});
});

test('a failure triggered while resetting is observed before either count can be accepted', async () => {
  const fixture = comparison([200]);
  let attempts = 0;
  const reset = async () => {
    await fixture.options.reset();
    if (++attempts === 1) await fixture.cache(url + '?reset-metadata', async () => response(503));
  };
  assert.deepEqual(await measureStationDensity({...fixture.options, reset}), {before: 15, after: 15});
  assert.equal(fixture.discarded.length, 1);
  assert.equal(fixture.counts().resets, 2);
});

test('unrelated measurement errors do not trigger a new retry or conceal the original error', async () => {
  const error = new Error('unrelated assertion');let resets = 0;
  await assert.rejects(measureStationDensity({failureCount: () => 0, reset: async () => { resets++; }, measure: async () => { throw error; }}), value => value === error);
  assert.equal(resets, 1);
});

test('a page-local protocol failure with no network request still discards both counts', async () => {
  const fixture = comparison([200]);let attempt = 0;
  const measure = async () => {
    if (++attempt === 1) {
      fixture.pages.before.retained.set(url, {status: 503, body: Buffer.from('page-local error')});
      fixture.pages.before.emit('error', {sourceId: 'stationLow', error: new Error('page-local protocol error')});
    }
    return fixture.options.measure();
  };
  assert.deepEqual(await measureStationDensity({...fixture.options, measure}), {before: 15, after: 15});
  assert.equal(fixture.cache.failureCount(), 0, 'no transport/cache failure is needed to detect this case');
  assert.equal(fixture.discarded.length, 1);
  assert.deepEqual(fixture.discarded[0].counts, {before: 10, after: 15});
  assert.deepEqual(fixture.counts(), {fetches: 1, resets: 2, measurements: 2});
});

test('persistent page-local protocol failure cannot pass the second paired attempt', async () => {
  const fixture = comparison([200]);
  const measure = async () => {
    fixture.pages.before.retained.set(url, {status: 503});
    fixture.pages.before.emit('error', {sourceId: 'stationLow', error: new Error('page-local protocol error')});
    return fixture.options.measure();
  };
  await assert.rejects(measureStationDensity({...fixture.options, measure}), /two paired attempts/);
  assert.equal(fixture.cache.failureCount(), 0);assert.equal(fixture.discarded.length, 2);
  assert.equal(fixture.counts().resets, 2);
});

test('page failure counters persist across resets, exclude deliberate aborts, and are installed once', async () => {
  const page = pageFixture();
  await resetStationSources(page);await resetStationSources(page);
  for (const event of [
    {sourceId: 'stationLow', error: {name: 'AbortError', message: 'cancelled'}},
    {sourceId: 'stationMed', error: {message: 'AbortError'}},
    {sourceId: 'unrelated', error: new Error('another source')},
  ]) page.emit('error', event);
  assert.equal(stationFailureCount(page), 0);
  page.emit('error', {sourceId: 'stationMed', error: new Error('decoding or protocol failure')});
  assert.equal(stationFailureCount(page), 1);
  await resetStationSources(page);assert.equal(stationFailureCount(page), 1);
  page.emit('error', {sourceId: 'stationLow', error: new Error('later failure')});
  assert.equal(stationFailureCount(page), 2);
});

for (const mode of ['noop', 'unrelated']) test(`${mode} source setters fail closed without counting retained renderer tiles`, async () => {
  const page = pageFixture({mode});let measurements = 0;
  page.retained.set(url, response(200, 'old retained bytes'));
  await assert.rejects(measureStationDensity({failureCount: () => 0, reset: () => resetStationSources(page, {timeout: 10}), measure: async () => { measurements++;return {before: 1, after: 1}; }}), /did not confirm reset/);
  assert.equal(measurements, 0);
  for (const source of Object.values(page.sources)) {
    assert.equal(source.listenerCount('data'), 0);assert.equal(source.listenerCount('error'), 0);
  }
});

test('public setters retain identical URL/tiles definitions and wait for both reset receipts', async () => {
  for (const tiles of [false, true]) {
    const page = pageFixture({tiles});
    const definitions = structuredClone(page.definitions);
    await resetStationSources(page);
    assert.deepEqual(page.definitions, definitions);
    assert.deepEqual(page.calls.map(call => call.value), Object.values(definitions).map(value => value.url || value.tiles));
    if (tiles) assert.notEqual(page.calls[0].value, page.definitions.stationLow.tiles, 'do not mutate the style definition array');
    for (const source of Object.values(page.sources)) assert.equal(source.listenerCount('data'), 0);
  }
});

test('source errors and unsupported reset APIs fail closed', async () => {
  await assert.rejects(resetStationSources(pageFixture({mode: 'error'})), /fixture reset error/);
  const page = pageFixture();delete page.sources.stationLow.setUrl;
  await assert.rejects(resetStationSources(page), /cannot be reset/);
  assert.equal(page.calls.length, 0, 'validate both reset APIs before touching either source');
});

test('failure generations count shared failed attempts once and survive successful recovery', async () => {
  const cache = createResponseCache();
  const pending = cache(url, async () => response(503));
  assert.equal(cache(url, async () => response()), pending);
  await pending;assert.equal(cache.failureCount(), 1);
  await cache(url, async () => response());assert.equal(cache.failureCount(), 1);
  await assert.rejects(cache(url + '/other', async () => { throw new Error('transport'); }), /transport/);
  assert.equal(cache.failureCount(), 2);
});

test('the actual station route also invalidates target-validation and per-page fulfill failures', async () => {
  const source = await readFile(new URL('../scripts/check-major-stations-browser.mjs', import.meta.url), 'utf8');
  const start = source.indexOf(' const stationResponse=createResponseCache();');
  const end = source.indexOf(' // Match the other WebGL', start);
  assert.ok(start > 0 && end > start);
  assert.match(source, /return stationResponse\.failureCount\(\)\+stationRouteFailures\+pageFailures\.reduce/);
  let handler, fetches = 0, aborts = 0;
  const failures = await vm.runInNewContext(`(async()=>{${source.slice(start, end)};return ()=>stationResponse.failureCount()+stationRouteFailures;})()`, {
    context: {route: async (_pattern, value) => { handler = value; }}, createResponseCache,
    fetchLoopbackNoRedirect, localOrmAuditTarget, console: {error() {}},
  });
  const route = target => ({request: () => ({url: () => target}),
    fetch: async () => { fetches++;return response(); }, fulfill: async () => { throw new Error('one page failed to receive the body'); },
    abort: async () => { aborts++; },
  });
  await handler(route('https://unapproved.invalid/standard_railway_text_stations_low/4/8/5.pbf'));
  assert.equal(failures(), 1);assert.equal(fetches, 0);
  await handler(route(url));assert.equal(failures(), 2);assert.equal(fetches, 1);
  const recovered = route(url);recovered.fulfill = async () => {};
  await handler(recovered);assert.equal(failures(), 2);assert.equal(fetches, 1);
  assert.equal(aborts, 2);
});

test('pinned MapLibre resets identical source definitions and revalidates retained loaded/errored tiles on both pages', async () => {
  // Execute the installed source and tile-manager implementations, not a model
  // of their setters. Only metadata fetches and worker tile decoding are faked;
  // no provider request, browser launch or WebGL rendering is involved.
  const compiled = await build({stdin: {
    contents: "export {VectorTileSource} from './node_modules/maplibre-gl/src/source/vector_tile_source.ts'; export {TileManager} from './node_modules/maplibre-gl/src/tile/tile_manager.ts'; export {RequestManager} from './node_modules/maplibre-gl/src/util/request_manager.ts';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts',
  }, bundle: true, write: false, format: 'iife', globalName: 'fixtureMapLibre', platform: 'browser', tsconfigRaw: {compilerOptions: {useDefineForClassFields: false}}, loader: {'.glsl': 'text'}});
  const dom = new JSDOM('', {runScripts: 'outside-only', pretendToBeVisual: true});
  Object.assign(dom.window, {TextEncoder, TextDecoder, Request, Response, AbortController});
  const metadataReads = [];
  dom.window.fetch = async request => {
    assert.ok(request.url.startsWith('http://127.0.0.1:4174/'), 'metadata remains a controlled loopback fixture');
    metadataReads.push(request.url);
    return new Response(JSON.stringify({tiles: [url.replace('/4/8/5', '/{z}/{x}/{y}')]}), {headers: {'content-type': 'application/json'}});
  };
  try {
    dom.window.eval(compiled.outputFiles[0].text);
    const {VectorTileSource, TileManager, RequestManager} = dom.window.fixtureMapLibre;
    for (const inlineTiles of [false, true]) {
      const cache = createResponseCache(), pages = [], managers = [], loads = [];
      let release, fetches = 0;
      const workerGate = new Promise(resolve => { release = resolve; });
      for (const side of ['before', 'after']) {
        const sources = {}, definitions = {};
        for (const id of ['stationLow', 'stationMed']) {
          const definition = inlineTiles ? {tiles: [url]} : {url: `http://127.0.0.1:4174/${id}`};
          definitions[id] = definition;
          const source = new VectorTileSource(id, definition, {}, undefined);sources[id] = source;
          await new Promise((resolve, reject) => {
            const loaded = event => {
              if (event.sourceDataType === 'content') { source.off('data', loaded);resolve(); }
            };
            source.on('data', loaded);source.on('error', event => reject(event.error));
            source.onAdd({_requestManager: new RequestManager(), _ownerWindow: dom.window});
          });
          const retained = new Map([
            ['loaded', {state: 'loaded', bytes: `${side}:stale loaded bytes`}],
            ['errored', {state: 'errored', bytes: `${side}:stale missing tile`}],
          ]), outOfView = new Map([['old viewport', 'stale cached bytes']]);
          const manager = Object.create(TileManager.prototype);
          Object.assign(manager, {
            _source: source, _sourceLoaded: true, _sourceErrored: false, _updated: true,
            _inViewTiles: {getAllIds: () => [...retained.keys()], getTileById: key => retained.get(key), getAllTiles: () => [...retained.values()]},
            _outOfViewCache: {reset: () => outOfView.clear()},
            _loadTile: (tile, key) => {
              const pending = (async () => {
                await workerGate;
                const current = await cache(`${id}/${key}`, async () => { fetches++;return response(200, 'recovered shared bytes'); });
                tile.bytes = current.body.toString();tile.state = 'loaded';
              })();
              loads.push(pending);return pending;
            },
          });
          source.on('data', event => manager._dataHandler(event));
          managers.push({manager, retained, outOfView});
        }
        const events = new EventEmitter();
        pages.push({on: events.on.bind(events), getStyle: () => ({sources: definitions}), getSource: id => sources[id]});
      }
      const readsBefore = metadataReads.length;
      await Promise.all(pages.map(page => resetStationSources(page)));
      if (!inlineTiles) assert.equal(metadataReads.length - readsBefore, 4, 'identical URLs still reload metadata on both pages');
      for (const {manager, retained, outOfView} of managers) {
        assert.equal(outOfView.size, 0, 'old viewport cache is invalidated too');
        assert.equal(manager.loaded(), false, 'retained rendered bytes cannot satisfy the existing isSourceLoaded wait');
        for (const tile of retained.values()) assert.equal(tile.state, 'expired', 'loaded and errored tiles both require revalidation');
      }
      release();await Promise.all(loads);
      assert.equal(fetches, 4, 'two pages share one successful response per source and tile');
      for (const {manager, retained} of managers) {
        assert.equal(manager.loaded(), true);
        for (const tile of retained.values()) assert.equal(tile.bytes, 'recovered shared bytes');
      }
    }
  } finally { dom.window.close(); }
});

test('actual pinned source, tile-manager and style event bubbling attributes pool/decoder failures to the map', async () => {
  const compiled = await build({stdin: {
    contents: "export {Style} from './node_modules/maplibre-gl/src/style/style.ts'; export {Evented} from './node_modules/maplibre-gl/src/util/evented.ts'; export {RequestManager} from './node_modules/maplibre-gl/src/util/request_manager.ts';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts',
  }, bundle: true, write: false, format: 'iife', globalName: 'fixtureLibrary', platform: 'browser',
  // Match the pinned distribution: type-only fields must not overwrite the
  // ErrorEvent.error value assigned by its Event superclass constructor.
  tsconfigRaw: {compilerOptions: {useDefineForClassFields: false}}, loader: {'.glsl': 'text'}});
  const dom = new JSDOM('', {runScripts: 'outside-only', pretendToBeVisual: true});
  Object.assign(dom.window, {TextEncoder, TextDecoder, Request, Response, AbortController});
  dom.window.fetch = () => assert.fail('inline metadata never needs a network request');
  let reads = 0;
  const pool = createRequestPool({retries: [], fetcher: async () => { reads++;return new Response(new Uint8Array([1, 2, 3])); }});
  try {
    dom.window.eval(compiled.outputFiles[0].text);
    const {Style, Evented, RequestManager} = dom.window.fixtureLibrary;
    const map = new Evented(), style = Object.create(Style.prototype), definitions = {};
    Object.assign(style, {_loaded: true, tileManagers: {}, dispatcher: {}, map, _validate: () => false});
    Object.assign(map, {style, _ownerWindow: dom.window, _requestManager: new RequestManager(),
      getStyle: () => ({sources: definitions}), getSource: id => style.tileManagers[id].getSource()});
    style.setEventedParent(map);
    const events = [];
    map.on('error', event => events.push({sourceId: event.sourceId, message: event.error.message, name: event.error.name, tileState: event.tile?.state}));
    for (const id of ['stationLow', 'stationMed']) {
      definitions[id] = {type: 'vector', tiles: [url]};
      style.addSource(id, definitions[id]);
    }
    await resetStationSources(map, {timeout: 1000});
    const low = style.tileManagers.stationLow;
    low.getSource().loadTile = () => pool.get(url, undefined, {validate: () => false});
    await low._loadTile({state: 'loaded'}, 'pool-validation', 'expired');
    assert.equal(reads, 1);
    assert.equal(events[0].sourceId, 'stationLow');
    assert.match(events[0].message, /Provider returned an invalid vector tile/);
    assert.equal(events[0].tileState, 'errored');
    assert.equal(stationFailureCount(map), 1);
    const med = style.tileManagers.stationMed;
    med.getSource().loadTile = async () => { throw new dom.window.Error('controlled worker decoder rejection'); };
    await med._loadTile({state: 'loaded'}, 'decoder', 'expired');
    assert.equal(events[1].sourceId, 'stationMed');assert.match(events[1].message, /decoder/);
    assert.equal(stationFailureCount(map), 2);
    med.getSource().loadTile = async () => { const error = new dom.window.Error('cancelled');error.name = 'AbortError';throw error; };
    await med._loadTile({state: 'loaded'}, 'deliberate-abort', 'expired');
    assert.equal(events[2].sourceId, 'stationMed');assert.equal(events[2].name, 'AbortError');
    assert.equal(stationFailureCount(map), 2, 'a deliberate abort remains excluded after real event bubbling');
  } finally { pool.dispose();dom.window.close(); }
});
