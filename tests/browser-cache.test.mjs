import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cacheOtherOrigins, cacheKey, pruneTileCache} from '../scripts/browser.mjs';

// A Playwright context reduced to what the cache uses: one route whose
// handler is called with fake routes.
function fakeContext() {
  const context = {route: async (match, handler) => { context.match = match; context.handler = handler; }};
  return context;
}
function fakeRoute(url, {method = 'GET', range, network}) {
  const result = {};
  return {result, route: {
    request: () => ({url: () => url, method: () => method, allHeaders: async () => range ? {range} : {}}),
    fetch: async () => { network.calls++; const r = network.respond(url, range); return {status: () => r.status, headers: () => r.headers, body: async () => Buffer.from(r.body)}; },
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
    : url.endsWith('/missing') ? {status: 404, headers: {}, body: ''} : url.endsWith('/error') ? {status: 503, headers: {}, body: 'busy'} : {status: 200, headers: {'content-type': 'application/x-protobuf'}, body: 'tile'}};
  await cacheOtherOrigins(context, directory, {now: () => clock, maxAge: 5000});
  assert.equal(context.match(new URL('https://tiles.example/1/2/3')), true);
  assert.equal(context.match(new URL('http://127.0.0.1:4173/data/x.pbf')), false, 'the site under test is never cached');
  assert.equal(context.match(new URL('data:text/plain,x')), false);

  const call = async (url, options = {}) => { const {route, result} = fakeRoute(url, {...options, network}); await context.handler(route); return result; };
  const first = await call('https://tiles.example/1/2/3');
  assert.equal(first.fulfilled.status, 200);assert.equal(String(first.fulfilled.body), 'tile');
  assert.equal(String((await call('https://tiles.example/1/2/3')).fulfilled.body), 'tile');
  assert.equal(network.calls, 1, 'the second request is served from the cache');

  const ranged = await call('https://tiles.example/archive.pmtiles', {range: 'bytes=0-1'});
  assert.equal(ranged.fulfilled.status, 206);assert.equal(ranged.fulfilled.headers['content-encoding'], undefined, 'the body handed over is already decoded');
  assert.equal(ranged.fulfilled.headers['access-control-allow-origin'], '*');
  await call('https://tiles.example/archive.pmtiles', {range: 'bytes=0-1'});await call('https://tiles.example/archive.pmtiles', {range: 'bytes=2-3'});
  assert.equal(network.calls, 3, 'each byte range is its own entry');

  assert.equal((await call('https://tiles.example/missing')).fulfilled.status, 404);await call('https://tiles.example/missing');
  assert.equal(network.calls, 4, 'an empty tile answer is kept too');
  await call('https://tiles.example/error');await call('https://tiles.example/error');
  assert.equal(network.calls, 6, 'a server error is never kept');
  assert.equal((await call('https://api.example/search', {method: 'POST'})).fallback, true);

  clock += 6000;await call('https://tiles.example/1/2/3');
  assert.equal(network.calls, 7, 'an expired entry is fetched again');
  const entry = JSON.parse(await readFile(join(directory, `${cacheKey('https://tiles.example/1/2/3')}.json`), 'utf8'));
  assert.equal(entry.saved, clock);
  assert.ok((await readdir(directory)).includes('.changed'), 'a run that added entries is marked for saving');
  clock += 3000;
  const pruned = await pruneTileCache(directory, {now: () => clock, maxAge: 5000});
  assert.deepEqual(pruned, {kept: 1, dropped: 3}, 'only the entry refreshed within the age limit is kept');
  assert.deepEqual((await readdir(directory)).filter(name => !name.startsWith('.')).sort(), [`${cacheKey('https://tiles.example/1/2/3')}.body`, `${cacheKey('https://tiles.example/1/2/3')}.json`]);
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

test('the site workflow runs every browser check', async () => {
  const workflow = await readFile(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  const validate = workflow.slice(workflow.indexOf('\n  validate:'), workflow.indexOf('\n  deploy:'));
  for (const name of (await readdir(new URL('../scripts/', import.meta.url))).filter(name => /^check-.*-browser\.mjs$/.test(name)))
    assert.ok(validate.includes(name), `${name} is not run by the validate job`);
});
