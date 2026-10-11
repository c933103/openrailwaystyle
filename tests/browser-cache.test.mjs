import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import encode from 'vt-pbf';
import {cacheOtherOrigins, cacheKey, pruneTileCache, isPublicOrm, localOrmTarget, isolatePublicOrm} from '../scripts/browser.mjs';
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
  assert.equal(context.match(new URL('https://openrailwaymap.app/railway_line_high')), false,
    'public railway provider must never be routed into the generic seven-day cache');
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

test('provider tile validation remains strict but public tiles bypass even a poisoned browser cache', async () => {
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
  assert.equal(context.match(new URL(url)), false, 'public tiles never enter the cache route');
  assert.equal((await call(url)).fallback, true, 'defensive handler also yields to the public-host guard');
  assert.equal(network.calls, 0, 'even a poisoned historical entry must not trigger a public refetch');
  assert.deepEqual(await readFile(`${file}.body`), bad, 'excluded historical entry is never replayed or rewritten');
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
    if(name==='check-deployed-fixture-browser.mjs'){
      // This orchestration check delegates both URL cases to the guarded checker.
      assert.match(source,/new URL\('\.\/check-orm-fixture-browser\.mjs',import.meta.url\)/);
      assert.match(source,/spawn\(process.execPath,\[check\]/);
    }else if(name==='check-normandy-service-geometry-browser.mjs'){
      assert.match(source,/from '\.\/check-paris-service-geometry-browser\.mjs'/,name);
      assert.match(source,/await checkParisServiceGeometryBrowser\(/,name);
      assert.ok(scripts.includes('check-paris-service-geometry-browser.mjs'),
        'delegated Paris checker is checked for its shared helper import');
    }else assert.match(source, /import \{launchBrowser\} from '\.\/browser\.mjs';/, name);
    assert.doesNotMatch(source, /chromium\.launch\(/, name);
  }
});

test('the site workflow plans the browser checks and runs them through the runner', async () => {
  const workflow = await readFile(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  assert.match(workflow, /run: node scripts\/ci-plan\.mjs/);
  assert.match(workflow, /matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.matrix\) \}\}/);
  assert.match(workflow, /node scripts\/run-browser-checks\.mjs --concurrency 1 --label "\$GROUP" \$CHECKS/);
  assert.doesNotMatch(workflow, /BROWSER_TILE_CACHE|Restore browser tile cache|Save browser tile cache/);
  // Every check is named in exactly one job of scripts/ci-plan.mjs (tests/ci-plan.test.mjs).
});

test('public railway-provider host matching is exact and separate from the .org search API', () => {
  for(const url of ['https://openrailwaymap.app/railway_line_high','https://a.openrailwaymap.app/standard_railway_line_low'])
    assert.ok(isPublicOrm(url),url);
  for(const url of ['https://api.openrailwaymap.org/v2/facility','https://openrailwaymap.app.example.net/x',
      'http://evil-openrailwaymap.app.example/x','data:text/plain,openrailwaymap.app'])
    assert.equal(isPublicOrm(url),false,url);
});

test('only loopback local provider URLs are accepted for automated geographic checks', () => {
  const original='https://openrailwaymap.app/railway_line_high?lang=ja';
  assert.equal(localOrmTarget(original,'http://127.0.0.1:4174/root/'),
    'http://127.0.0.1:4174/root/railway_line_high?lang=ja');
  assert.equal(localOrmTarget(original,'http://localhost:4174'), 'http://localhost:4174/railway_line_high?lang=ja');
  assert.equal(localOrmTarget(original,undefined),null);
  for (const invalid of ['https://localhost:4174','https://public.example','http://mirror.example',
      'http://127.0.0.1:4174/?remote=1','http://test:secret@localhost:4000/'])
    assert.throws(()=>localOrmTarget(original,invalid),/loopback|local HTTP/);
  assert.throws(()=>localOrmTarget('https://api.openrailwaymap.org/v2/facility','http://localhost:4174'),
    /Only openrailwaymap.app URLs/);
});

test('automated OpenRailwayMap routing aborts unfixed public requests without fetching', async () => {
  const context=fakeContext(), warnings=[];
  await isolatePublicOrm(context,{mirror:null,warn:text=>warnings.push(text)});
  assert.ok(context.match(new URL('https://openrailwaymap.app/railway_line_high')));
  assert.equal(context.match(new URL('https://api.openrailwaymap.org/v2/facility')),false);
  let calls=0,aborted;
  await context.handler({
    request:()=>({url:()=> 'https://openrailwaymap.app/standard_railway_line_low'}),
    abort:async reason=>{calls++;aborted=reason;},
    fetch:async()=>{throw Error('must never be reached');},
  });
  assert.equal(calls,1);
  assert.equal(aborted,'blockedbyclient');
  assert.equal(warnings.length,1);
});

test('CI uses a synthetic railway fixture rather than the provider-dependent globe/map audit', async () => {
  const workflow=await readFile(new URL('../.github/workflows/site.yml',import.meta.url),'utf8');
  assert.doesNotMatch(workflow,/browser-tiles-v2-no-public-orm/);
  assert.match(workflow,/run: node scripts\/check-orm-fixture-browser\.mjs/);
  assert.doesNotMatch(workflow,/run: node scripts\/check-map-browser\.mjs/);
  assert.doesNotMatch(workflow,/run: node scripts\/check-planning-browser\.mjs/);
  assert.doesNotMatch(workflow,/run: node scripts\/check-context-browser\.mjs/);
});
