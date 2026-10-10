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
