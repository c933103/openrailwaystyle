import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestPool} from '../styles/request-pool.mjs';
const tick = () => new Promise(resolve => setImmediate(resolve));
const bytes = n => new Uint8Array([n]).buffer;
const ok = n => ({ok: true, status: 200, arrayBuffer: async () => bytes(n)});

for (const header of ['120', 'Wed, 07 Oct 2026 00:02:00 GMT']) test(`Retry-After ${header} gates same-origin work even after the failed request exhausts its retries`, async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let now = Date.parse('2026-10-07T00:00:00Z');
  const calls = [];
  const pool = createRequestPool({concurrency: 2, perOrigin: 1, timeout: 300000, retries: [], now: () => now,
    fetcher: async url => {
      calls.push(url);
      return url.endsWith('/busy') ? {ok: false, status: 429, headers: {get: () => header}} : ok(8);
    }});
  try {
    await assert.rejects(pool.get('https://rail.example/busy'), error => error.status === 429);
    const next = pool.get('https://rail.example/next');
    await pool.get('https://other.example/unaffected');
    now += 119999; t.mock.timers.tick(119999); await tick();
    assert.equal(calls.includes('https://rail.example/next'), false, 'a cooldown over a minute is not truncated');
    now += 1; t.mock.timers.tick(1); await tick();
    assert.deepEqual(await next, bytes(8));
    assert.deepEqual(calls, ['https://rail.example/busy', 'https://other.example/unaffected', 'https://rail.example/next']);
  } finally {pool.dispose();}
});

for (const cleanup of ['pending', 'throws', 'rejects']) for (const status of [429, 403])
  test(`HTTP ${status} keeps its policy when error-body cleanup ${cleanup}`, async t => {
    t.mock.timers.enable({apis: ['setTimeout']});
    let now = Date.parse('2026-11-07T00:00:00Z'), cancelled = 0;
    const calls = [];
    const pool = createRequestPool({concurrency: 2, perOrigin: 1, timeout: 300000,
      retries: status === 403 ? [1000] : [], now: () => now, fetcher: async url => {
        calls.push(url);
        return url.endsWith('/busy') ? {ok: false, status, headers: {get: () => '120'}, body: {cancel() {
          cancelled++;
          if (cleanup === 'throws') throw new Error('cleanup failed');
          return cleanup === 'rejects' ? Promise.reject(new Error('cleanup failed')) : new Promise(() => {});
        }}} : ok(8);
      }});
    let failure;
    const failed = pool.get('https://rail.example/busy').catch(error => { failure = error; });
    const next = pool.get('https://rail.example/next');
    // Attach a handler before assertions so disposal after a failed oracle
    // cannot turn this bounded negative control into an unhandled rejection.
    const nextResult = next.then(value => ({value}), error => ({error}));
    try {
      await pool.get('https://other.example/unaffected');
      await tick();
      assert.equal(failure?.status, status, 'HTTP policy is settled without waiting for body cleanup');
      assert.equal(cancelled, 1);
      assert.equal(pool.stats().retried, 0, 'terminal 403 and exhausted 429 are never retried');
      if (status === 429) {
        now += 119999; t.mock.timers.tick(119999); await tick();
        assert.equal(calls.includes('https://rail.example/next'), false, 'the complete provider pause survives cleanup');
        now += 1; t.mock.timers.tick(1); await tick();
      }
      assert.deepEqual((await nextResult).value, bytes(8));
      assert.deepEqual(calls, ['https://rail.example/busy', 'https://other.example/unaffected', 'https://rail.example/next']);
    } finally {pool.dispose(); await failed; await nextResult;}
  });
