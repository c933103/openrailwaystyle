import test from 'node:test';
import assert from 'node:assert/strict';
import {createResponseCache} from '../scripts/browser-response-cache.mjs';
import {fetchLoopbackNoRedirect, localOrmAuditTarget} from '../scripts/browser-policy.mjs';
import {createServer} from 'node:http';
import {once} from 'node:events';

const url = 'http://127.0.0.1:4174/standard_railway_text_stations_low/4/8/5.pbf';
const tile = Buffer.from([0, 1, 127, 128, 255]);
const response = (status = 200, body = tile, headers = {}) => ({
  status: () => status, headers: () => headers, body: async () => body,
});
const route = (fetch, address = url) => [address, fetch];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};

test('concurrent before/after maps share one fetch and body read, then replay identical bytes', async () => {
  const cached = createResponseCache(), body = deferred();
  let fetches = 0, reads = 0;
  const request = route(async () => {
    fetches++;
    return {...response(), body: () => { reads++; return body.promise; }};
  });
  const before = cached(...request), after = cached(...request);
  assert.equal(before, after, 'the in-flight response is shared');
  await Promise.resolve();await Promise.resolve();
  assert.equal(fetches, 1);assert.equal(reads, 1);
  body.resolve(tile);
  const answers = await Promise.all([before, after]);
  assert.deepEqual(answers[0].body, tile);
  assert.equal(answers[0], answers[1]);
  assert.equal(await cached(...request), answers[0], 'later comparisons reuse the same successful snapshot');
  assert.equal(fetches, 1);assert.equal(reads, 1);
});

for (const status of [404, 429, 503, 520]) test(`HTTP ${status} is passed through, then a fresh HTTP 200 is retained`, async () => {
  const cached = createResponseCache(), failed = deferred();
  let fetches = 0;
  const request = route(() => ++fetches === 1 ? failed.promise : Promise.resolve(response()));
  const before = cached(...request), after = cached(...request);
  failed.resolve(response(status, Buffer.from('provider unavailable')));
  const results = await Promise.all([before, after]);
  assert.equal(fetches, 1, 'even a failed in-flight request is coalesced');
  assert.equal(results[0].status, status);
  assert.equal(results[0].body.toString(), 'provider unavailable', 'no synthetic empty tile hides the failure');
  assert.equal(results[0], results[1]);
  const recovered = await cached(...request);
  assert.equal(recovered.status, 200);assert.deepEqual(recovered.body, tile);
  assert.equal(await cached(...request), recovered);
  assert.equal(fetches, 2, 'the retry reaches the provider once, then becomes the shared baseline');
});

for (const failure of ['fetch', 'body', 'synchronous fetch']) test(`${failure} rejection is shared and evicted before a successful retry`, async () => {
  const cached = createResponseCache(), error = new Error(`${failure} unavailable`);
  let fetches = 0;
  const request = route(() => {
    if (++fetches > 1) return Promise.resolve(response());
    if (failure === 'synchronous fetch') throw error;
    if (failure === 'fetch') return Promise.reject(error);
    return Promise.resolve({...response(), body: async () => { throw error; }});
  });
  const before = cached(...request), after = cached(...request);
  const results = await Promise.allSettled([before, after]);
  assert.equal(fetches, 1);
  for (const result of results) { assert.equal(result.status, 'rejected');assert.equal(result.reason, error); }
  // Start recovery before a delayed old consumer handles its failure. Its
  // cleanup must not evict the new successful response.
  const recovered = await cached(...request);
  await assert.rejects(after, candidate => candidate === error);
  assert.equal(recovered.status, 200);assert.deepEqual(recovered.body, tile);
  assert.equal(await cached(...request), recovered);assert.equal(fetches, 2);
});

for (const status of [200, 204, 206]) test(`HTTP ${status} keeps legitimate empty/partial tiles and replay-safe headers`, async () => {
  const cached = createResponseCache(), body = status === 204 ? Buffer.alloc(0) : tile;
  let fetches = 0;
  const headers = {'Content-Encoding': 'gzip', 'content-length': '99', 'transfer-encoding': 'chunked', connection: 'keep-alive', 'set-cookie': 'session=x', 'content-type': 'application/x-protobuf', 'access-control-allow-origin': '*', ...(status === 206 && {'content-range': 'bytes 0-4/10'})};
  const request = route(async () => { fetches++;return response(status, body, headers); });
  const first = await cached(...request), second = await cached(...request);
  assert.equal(first, second);assert.equal(first.status, status);assert.deepEqual(first.body, body);assert.equal(fetches, 1);
  assert.deepEqual(first.headers, {'content-type': 'application/x-protobuf', 'access-control-allow-origin': '*', ...(status === 206 && {'content-range': 'bytes 0-4/10'})});
});

test('permanent failure reaches the provider on each retry and remains visible', async () => {
  const cached = createResponseCache();let fetches = 0;
  const request = route(async () => { fetches++;return response(520, Buffer.from('still unavailable')); });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await cached(...request);
    assert.equal(result.status, 520);assert.equal(result.body.toString(), 'still unavailable');assert.equal(fetches, attempt);
  }
});

test('URLs and comparison contexts are isolated, and a consumer failure does not discard valid bytes', async () => {
  const cached = createResponseCache();let fetches = 0;
  const fetch = async () => { fetches++;return response(); }, request = route(fetch);
  const good = await cached(...request);
  await assert.rejects(async () => { await cached(...request);throw new Error('route.fulfill: page closed'); }, /page closed/);
  assert.equal(await cached(...request), good);assert.equal(fetches, 1);
  await cached(...route(fetch, url.replace('_low/', '_med/')));assert.equal(fetches, 2);
  await createResponseCache()(...request);assert.equal(fetches, 3);
});

const mirror = 'http://127.0.0.1:4174/';
const publicUrl = 'https://tiles.openrailwaymap.app/standard_railway_text_stations_low/4/8/5.pbf';
function localComparison(fetch, cache = createResponseCache()) {
  return original => {
    const target = localOrmAuditTarget(original, mirror);
    return cache(target, () => fetchLoopbackNoRedirect({fetch}, target, mirror));
  };
}

test('public aliases and advertised local URLs share only the validated loopback target', async () => {
  const calls = [], cached = localComparison(async options => { calls.push(options);return response(); });
  const before = cached(publicUrl), after = cached(url);
  assert.equal(before, after);
  assert.deepEqual((await before).body, tile);
  assert.deepEqual(calls, [{url, maxRedirects: 0}]);
  for (const unsafe of ['https://tiles.example/tile', 'https://127.0.0.1/tile', 'http://user:pass@127.0.0.1/tile'])
    assert.throws(() => cached(unsafe), /only from loopback/);
  assert.equal(calls.length, 1, 'invalid targets cannot invoke the loader, even after a cache hit');
});

test('the guarded loader rejects redirects and a later attempt can recover', async () => {
  const calls = [], cached = localComparison(async options => {
    calls.push(options);
    return calls.length === 1 ? response(302, Buffer.from('redirect'), {location: 'https://provider.invalid/tile'}) : response();
  });
  const before = cached(publicUrl), after = cached(url);
  await assert.rejects(before, /redirected/);
  await assert.rejects(after, /redirected/);
  assert.equal(calls.length, 1);
  const recovered = await cached(url);
  assert.deepEqual(recovered.body, tile);
  assert.equal(await cached(publicUrl), recovered);
  assert.deepEqual(calls, [{url, maxRedirects: 0}, {url, maxRedirects: 0}]);
});

test('cached TileJSON retains sanitization and a rejected template is not retained', async () => {
  const metadata = mirror + 'standard_railway_text_stations_low/';
  let fetches = 0;
  const cached = localComparison(async () => {
    const tiles = ++fetches === 1 ? ['https://provider.invalid/{z}/{x}/{y}.pbf']
      : ['https://tiles.openrailwaymap.app/standard_railway_text_stations_low/{z}/{x}/{y}.pbf'];
    return response(200, Buffer.from(JSON.stringify({tiles})), {'content-type': 'application/json'});
  });
  await assert.rejects(cached(metadata), /non-loopback tile URL/);
  const recovered = await cached(metadata);
  assert.deepEqual(JSON.parse(recovered.body), {tiles: [mirror + 'standard_railway_text_stations_low/{z}/{x}/{y}.pbf']});
  assert.equal(await cached(metadata), recovered);
  assert.equal(fetches, 2);
});

test('a fresh comparison reads changed fixture bytes while the current comparison stays stable', async () => {
  let body = tile, fetches = 0;
  const fetch = async () => { fetches++;return response(200, body); };
  const first = localComparison(fetch);
  const original = await first(url);
  body = Buffer.from('changed local fixture');
  assert.equal(await first(url), original);
  assert.deepEqual((await localComparison(fetch)(url)).body, body);
  assert.equal(fetches, 2);
});

test('a controlled HTTP loopback server recovers without retaining its transient failure', async t => {
  let requests = 0;
  const server = createServer((_request, reply) => {
    requests++;
    reply.writeHead(requests === 1 ? 503 : 200, {'content-type': 'application/x-protobuf'});
    reply.end(requests === 1 ? 'temporarily unavailable' : tile);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const target = `http://127.0.0.1:${server.address().port}/standard_railway_text_stations_low/4/8/5.pbf`;
  const cached = localComparison(async options => {
    assert.equal(options.url, target);
    assert.equal(options.maxRedirects, 0);
    const fetched = await fetch(options.url, {redirect: 'manual'});
    return {status: () => fetched.status, headers: () => Object.fromEntries(fetched.headers), body: async () => Buffer.from(await fetched.arrayBuffer())};
  });
  const before = cached(target), after = cached(target);
  assert.equal(before, after);
  assert.equal((await before).status, 503);
  assert.equal(requests, 1);
  const recovered = await cached(target);
  assert.equal(recovered.status, 200);
  assert.deepEqual(recovered.body, tile);
  assert.equal(await cached(target), recovered);
  assert.equal(requests, 2);
});
