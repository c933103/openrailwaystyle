import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import encode from 'vt-pbf';
import {cacheOtherOrigins, cacheKey, pruneTileCache} from '../scripts/browser.mjs';
import {validProviderVectorTile} from '../styles/vector-tile-validation.mjs';

// A Playwright context reduced to what the cache uses: one route whose
// handler is called with fake routes.
function fakeContext() {
  const context = {route: async (match, handler) => { context.match = match; context.handler = handler; }};
  return context;
}
// A miss continues to the network from the browser; the answer it receives
// is what the fake request's response() gives, and what the page sees.
function fakeRoute(url, {method = 'GET', range, network}) {
  const result = {};
  let answer;
  return {result, route: {
    request: () => ({url: () => url, method: () => method, allHeaders: async () => range ? {range} : {},
      response: async () => answer && {status: () => answer.status, allHeaders: async () => answer.headers, body: async () => Buffer.from(answer.body)}}),
    continue: async () => { network.calls++; answer = network.respond(url, range); result.fulfilled = {status: answer.status, headers: answer.headers, body: Buffer.from(answer.body)}; },
    fulfill: async options => { result.fulfilled = options; },
    fallback: async () => { result.fallback = true; },
    abort: async () => { result.aborted = true; },
  }};
}

test('other origins are served from the cache until it expires; the site and non-GET requests are not', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tile-cache-')), context = fakeContext();
  let clock = 1000;
  const network = {calls: 0, respond: (url, range) => range
    ? {status: 206, headers: {'content-range': 'bytes 0-1/4', 'content-encoding': 'gzip', 'access-control-allow-origin': '*'}, body: 'ab'}
    : url.endsWith('/empty') ? {status: 204, headers: {}, body: ''} : url.endsWith('/missing') ? {status: 404, headers: {}, body: ''} : url.endsWith('/error') ? {status: 503, headers: {}, body: 'busy'} : {status: 200, headers: {'content-type': 'application/x-protobuf'}, body: 'tile'}};
  await cacheOtherOrigins(context, directory, {now: () => clock, maxAge: 5000});
  assert.equal(context.match(new URL('https://tiles.example/1/2/3')), true);
  assert.equal(context.match(new URL('http://127.0.0.1:4173/data/x.pbf')), false, 'the site under test is never cached');
  assert.equal(context.match(new URL('data:text/plain,x')), false);

  const call = async (url, options = {}) => { const {route, result} = fakeRoute(url, {...options, network}); await context.handler(route); return result; };
  const first = await call('https://tiles.example/1/2/3');
  assert.equal(first.fulfilled.status, 200);assert.equal(String(first.fulfilled.body), 'tile');
  assert.equal(String((await call('https://tiles.example/1/2/3')).fulfilled.body), 'tile');
  assert.equal(network.calls, 1, 'the second request is served from the cache');

  assert.equal((await call('https://tiles.example/archive.pmtiles', {range: 'bytes=0-1'})).fulfilled.status, 206);
  const ranged = await call('https://tiles.example/archive.pmtiles', {range: 'bytes=0-1'});
  assert.equal(ranged.fulfilled.status, 206);assert.equal(String(ranged.fulfilled.body), 'ab');
  assert.equal(ranged.fulfilled.headers['content-encoding'], undefined, 'a replayed body is already decoded');
  assert.equal(ranged.fulfilled.headers['access-control-allow-origin'], '*');await call('https://tiles.example/archive.pmtiles', {range: 'bytes=2-3'});
  assert.equal(network.calls, 3, 'each byte range is its own entry');

  assert.equal((await call('https://tiles.example/empty')).fulfilled.status, 204);await call('https://tiles.example/empty');
  assert.equal(network.calls, 4, 'an empty tile answer is kept too');
  assert.equal((await call('https://tiles.example/missing')).fulfilled.status, 404);await call('https://tiles.example/missing');
  assert.equal(network.calls, 6, 'a 404, possibly a passing fault, is never kept');
  await call('https://tiles.example/error');await call('https://tiles.example/error');
  assert.equal(network.calls, 8, 'a server error is never kept');
  assert.equal((await call('https://api.example/search', {method: 'POST'})).fallback, true);

  clock += 6000;await call('https://tiles.example/1/2/3');
  assert.equal(network.calls, 9, 'an expired entry is fetched again');
  const entry = JSON.parse(await readFile(join(directory, `${cacheKey('https://tiles.example/1/2/3')}.json`), 'utf8'));
  assert.equal(entry.saved, clock);
  assert.ok((await readdir(directory)).includes('.changed'), 'a run that added entries is marked for saving');
  clock += 3000;
  const pruned = await pruneTileCache(directory, {now: () => clock, maxAge: 5000});
  assert.deepEqual(pruned, {kept: 1, dropped: 3}, 'only the entry refreshed within the age limit is kept');
  assert.deepEqual((await readdir(directory)).filter(name => !name.startsWith('.')).sort(), [`${cacheKey('https://tiles.example/1/2/3')}.body`, `${cacheKey('https://tiles.example/1/2/3')}.json`]);
});

test('malformed HTTP-200 OpenRailwayMap vector tiles are neither replayed nor persisted', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tile-cache-')), context = fakeContext();
  const url = 'https://openrailwaymap.app/railway_line_high/7/104/52';
  const tile = Buffer.from(encode.fromGeojsonVt({railway_line_high: {features: [{
    type: 2, geometry: [[[1, 1], [100, 100]]], tags: {feature: 'rail', state: 'present'},
  }]}}));
  const bad = Buffer.from('temporarily unavailable');
  assert.equal(validProviderVectorTile(url, 200, bad), false);
  assert.equal(validProviderVectorTile(url, 200, tile), true);
  assert.equal(validProviderVectorTile('https://tiles.example/7/104/52', 200, bad), true,
    'only the known provider vector-tile contract is parsed');

  let body = tile;
  const network = {calls: 0, respond: () =>
    ({status: 200, headers: {'content-type': 'application/x-protobuf'}, body})};
  await cacheOtherOrigins(context, directory, {now: () => 1000, maxAge: 5000});
  const call = async target => {
    const {route, result} = fakeRoute(target, {network});
    await context.handler(route);
    return result;
  };

  const key = cacheKey(url), file = join(directory, key);
  await writeFile(`${file}.body`, bad);
  await writeFile(`${file}.json`, JSON.stringify({
    url, range: '', status: 200, headers: {'content-type': 'application/x-protobuf'},
    size: bad.length, saved: 1000,
  }));
  const repaired = await call(url);
  assert.equal(network.calls, 1, 'a poisoned cached provider tile is discarded and refetched');
  assert.deepEqual(Buffer.from(repaired.fulfilled.body), tile);
  await call(url);
  assert.equal(network.calls, 1, 'the valid replacement is cached');

  const badUrl = 'https://openrailwaymap.app/railway_line_high/7/104/53';
  body = bad;
  await call(badUrl); await call(badUrl);
  assert.equal(network.calls, 3, 'a malformed live HTTP-200 provider response is never persisted');
  assert.equal((await readdir(directory)).includes(`${cacheKey(badUrl)}.json`), false);
});

test('a request whose page closes mid-flight fails quietly instead of crashing the check', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tile-cache-')), context = fakeContext();
  await cacheOtherOrigins(context, directory);
  let aborted = false;
  const route = {
    request: () => ({url: () => 'https://tiles.example/closing', method: () => 'GET', allHeaders: async () => ({}),
      response: async () => ({status: () => 200, allHeaders: async () => ({}), body: async () => { throw new Error('response.body: Target page, context or browser has been closed'); }})}),
    continue: async () => {},
    fulfill: async () => { throw new Error('Target page, context or browser has been closed'); },
    fallback: async () => {}, abort: async () => { aborted = true; throw new Error('closed'); },
  };
  await context.handler(route);
  assert.equal(aborted, true);
});

test('every browser check launches through the shared helper', async () => {
  const scripts = (await readdir(new URL('../scripts/', import.meta.url))).filter(name => /^check-.*-browser\.mjs$/.test(name));
  assert.ok(scripts.length >= 16);
  for (const name of scripts) {
    const source = await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
    assert.match(source, /import \{launchBrowser\} from '\.\/browser\.mjs';/, name);
    assert.doesNotMatch(source, /chromium\.launch\(/, name);
  }
});

test('the site workflow plans the browser checks and runs them through the runner', async () => {
  const workflow = await readFile(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  assert.match(workflow, /run: node scripts\/ci-plan\.mjs/);
  assert.match(workflow, /matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.matrix\) \}\}/);
  assert.match(workflow, /node scripts\/run-browser-checks\.mjs --concurrency 1 --label "\$GROUP" \$CHECKS/);
  assert.match(workflow, /BROWSER_TILE_CACHE: \$\{\{ github\.workspace \}\}\/\.browser-tiles/);
  // Every check is named in exactly one job of scripts/ci-plan.mjs (tests/ci-plan.test.mjs).
});
