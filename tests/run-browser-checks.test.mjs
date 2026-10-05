import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArguments, runChecks} from '../scripts/run-browser-checks.mjs';

test('runner arguments take browser checks only, with a concurrency of at least one', () => {
  assert.deepEqual(parseArguments(['--concurrency', '3', '--label', 'maps', 'scripts/check-map-browser.mjs', 'check-polar-browser.mjs']),
    {concurrency: 3, label: 'maps', checks: ['check-map-browser.mjs', 'check-polar-browser.mjs']});
  assert.throws(() => parseArguments(['scripts/serve.mjs']), /Not a browser check/);
  assert.throws(() => parseArguments(['--concurrency', '0']), /at least 1/);
});

test('checks share a browser per slot, all run despite a failure, and a crashed browser is replaced', async () => {
  let launched = 0, running = 0, most = 0;
  const servers = [];
  const launch = async () => { const server = {id: ++launched, exitCode: null, closed: false, wsEndpoint: () => `ws://slot/${server.id}`, process: () => ({exitCode: server.exitCode}), close: async () => { server.closed = true; }}; servers.push(server); return server; };
  const seen = [];
  const run = async (check, endpoint) => {
    running++; most = Math.max(most, running);
    await new Promise(resolve => setTimeout(resolve, 5));
    seen.push([check, endpoint]);
    if (check === 'check-b-browser.mjs') servers.find(s => endpoint.endsWith(`/${s.id}`)).exitCode = 1; // the browser died
    running--;
    return {code: check === 'check-c-browser.mjs' ? 1 : 0};
  };
  const checks = ['a', 'b', 'c', 'd', 'e'].map(x => `check-${x}-browser.mjs`);
  const results = await runChecks(checks, {concurrency: 2, run, launch, log: () => {}});
  assert.deepEqual(results.map(r => [r.check, r.code]), checks.map(c => [c, c === 'check-c-browser.mjs' ? 1 : 0]), 'every check runs; results keep the given order');
  assert.equal(most, 2, 'two at a time');
  assert.equal(launched, 3, 'one browser per slot, plus a replacement for the one that crashed');
  assert.ok(servers.every(s => s.closed), 'every browser is closed at the end');
  assert.equal(new Set(seen.map(([, e]) => e)).size, 3);
});
