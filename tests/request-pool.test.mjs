import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestPool} from '../styles/request-pool.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; };
const bytes = n => new Uint8Array([n]).buffer;
const ok = n => ({ok: true, status: 200, arrayBuffer: async () => bytes(n), json: async () => ({n})});
const bad = status => ({ok: false, status, headers: {get: () => null}});

test('a request burst obeys global and per-origin limits without dropping requested tiles', async () => {
  const calls = [];
  const pool = createRequestPool({concurrency: 3, perOrigin: 2, retries: [], fetcher: (url, {signal}) => {
    const work = deferred(); calls.push({url, signal, ...work}); return work.promise;
  }});
  try {
    const pending = Array.from({length: 12}, (_, i) => pool.get(`https://${i < 8 ? 'rail' : 'fonts'}.example/${i}`));
    const done = Promise.all(pending);
    await tick();
    assert.equal(calls.length, 3); assert.equal(calls.filter(c => c.url.includes('rail.example')).length, 2);
    let released = 0;
    while (released < 12) {
      const batch = calls.slice(released); assert.ok(batch.length);
      for (const call of batch) { call.resolve(ok(released++)); }
      await tick();
      assert.ok(pool.stats().active <= 3);
    }
    assert.equal((await done).length, 12);
    assert.equal(pool.stats().peak, 3); assert.equal(pool.stats().started, 12);
    console.log('REQUEST_POOL_BURST', JSON.stringify(pool.stats()));
  } finally { pool.dispose(); }
});

test('concurrent readers share bytes; cancelling one does not cancel the other', async () => {
  let sent = 0, transportSignal;
  const work = deferred();
  const pool = createRequestPool({fetcher: (url, {signal}) => {sent++; transportSignal = signal; return work.promise;}});
  const a = new AbortController(), b = new AbortController();
  try {
    const first = pool.get('https://rail.example/7/1/1', a.signal);
    const second = pool.get('https://rail.example/7/1/1', b.signal);
    const cancelled = assert.rejects(first, {name: 'AbortError'});
    a.abort(); await cancelled;
    assert.equal(transportSignal.aborted, false);
    work.resolve(ok(7));
    assert.deepEqual(await second, bytes(7));
    assert.deepEqual(await pool.get('https://rail.example/7/1/1'), bytes(7));
    assert.equal(sent, 1); assert.equal(pool.stats().coalesced, 1); assert.equal(pool.stats().cacheHits, 1);
  } finally {pool.dispose();}
});

test('obsolete queued tiles are cancelled before any HTTP request', async () => {
  const first = deferred(), calls = [];
  const pool = createRequestPool({concurrency: 1, perOrigin: 1, fetcher: url => {calls.push(url); return calls.length === 1 ? first.promise : Promise.resolve(ok(2));}});
  const controller = new AbortController();
  try {
    const visible = pool.get('https://rail.example/visible');
    const obsolete = pool.get('https://rail.example/obsolete', controller.signal);
    const rejected = assert.rejects(obsolete, {name: 'AbortError'});
    controller.abort(); await rejected;
    first.resolve(ok(1)); await visible; await tick();
    assert.deepEqual(calls, ['https://rail.example/visible']);
  } finally {pool.dispose();}
});

test('foreground tiles go ahead of queued derived work; same-URL demand is promoted', async () => {
  const first = deferred(), calls = [];
  const pool = createRequestPool({concurrency: 1, perOrigin: 1, fetcher: url => {calls.push(url); return calls.length === 1 ? first.promise : Promise.resolve(ok(2));}});
  try {
    const requests = [pool.get('https://rail.example/start'), pool.get('https://rail.example/count', undefined, {priority: 2}),
      pool.get('https://rail.example/shared', undefined, {priority: 2}), pool.get('https://rail.example/shared')];
    first.resolve(ok(1)); await Promise.all(requests);
    assert.deepEqual(calls.map(c => c.split('/').at(-1)), ['start', 'shared', 'count']);
  } finally {pool.dispose();}
});

for (const status of [408, 429, 503, 520]) test(`HTTP ${status} is retried once; only recovered bytes are cached`, async () => {
  let count = 0;
  const pool = createRequestPool({retries: [0], fetcher: async () => ++count === 1 ? bad(status) : ok(9)});
  try {
    assert.deepEqual(await pool.get('https://rail.example/tile'), bytes(9));
    assert.deepEqual(await pool.get('https://rail.example/tile'), bytes(9));
    assert.equal(count, 2); assert.equal(pool.stats().retried, 1);
  } finally {pool.dispose();}
});

for (const status of [403, 404]) test(`HTTP ${status} is not retried or cached as an empty tile`, async () => {
  let count = 0;
  const pool = createRequestPool({retries: [0], fetcher: async () => {count++; return bad(status);}});
  try {
    await assert.rejects(pool.get('https://rail.example/tile'), error => error.status === status);
    await assert.rejects(pool.get('https://rail.example/tile'), error => error.status === status);
    assert.equal(count, 2); assert.equal(pool.stats().retried, 0);
  } finally {pool.dispose();}
});

test('a hung body times out; its late result cannot poison the successful retry', async () => {
  const oldBody = deferred(); let count = 0;
  const pool = createRequestPool({timeout: 15, retries: [0], fetcher: async () => ++count === 1
    ? {ok: true, arrayBuffer: () => oldBody.promise} : ok(2)});
  try {
    assert.deepEqual(await pool.get('https://rail.example/tile'), bytes(2));
    oldBody.resolve(bytes(1)); await tick();
    assert.deepEqual(await pool.get('https://rail.example/tile'), bytes(2));
    assert.equal(count, 2);
  } finally {pool.dispose();}
});

test('queue waiting does not spend the transport timeout', async () => {
  const start = deferred();
  const pool = createRequestPool({concurrency: 1, timeout: 25, retries: [], fetcher: url => url.endsWith('start') ? start.promise : Promise.resolve(ok(3))});
  try {
    const first = pool.get('https://rail.example/start');
    const second = pool.get('https://rail.example/next');
    const timeout = assert.rejects(first, {name: 'TimeoutError'});
    await timeout;
    assert.deepEqual(await second, bytes(3));
  } finally {pool.dispose();}
});

test('JSON and binary reads cannot collide; invalid JSON and disposal remain failures', async () => {
  const pool = createRequestPool({retries: [], fetcher: async url => url.endsWith('bad')
    ? {ok: true, json: async () => {throw new SyntaxError('Invalid JSON');}} : ok(4)});
  assert.deepEqual(await pool.get('https://rail.example/x', undefined, {json: true}), {n: 4});
  assert.deepEqual(await pool.get('https://rail.example/x'), bytes(4));
  await assert.rejects(pool.get('https://rail.example/bad', undefined, {json: true}), SyntaxError);
  pool.dispose(); await assert.rejects(pool.get('https://rail.example/x'), {name: 'AbortError'});
});
