// Replay the actual browser fixture's shared row through its cache-clock steps.
// This uses production row filtering without opening a browser or any URL.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import vm from 'node:vm';
const root = resolve(process.argv[2] || '.');
const browserFile = resolve(process.argv[3] || `${root}/scripts/check-departures-browser.mjs`);
const source = await readFile(browserFile, 'utf8');
const {departureRows} = await import(pathToFileURL(`${root}/styles/departures.mjs`));
const start = Date.parse('2026-10-12T00:00:00Z');
const rowStart = source.indexOf('const row = {mode:');
const rowEnd = source.indexOf('\n      for (const order', rowStart);
assert.ok(rowStart > 0 && rowEnd > rowStart);
const stopStart = source.indexOf('const stop=(name,stopId,extra={})=>');
const stopEnd = source.indexOf('\n', stopStart);
assert.ok(stopStart > 0 && stopEnd > stopStart);
const row = vm.runInNewContext(`${source.slice(stopStart, stopEnd)}\n${source.slice(rowStart, rowEnd)}\nrow`, {
  at: new Date(start + 600_000).toISOString(),
});
// Existing partial cases: 2 orders × 2 states. Existing unmatched cases: 2.
// New malformed cases: 7 envelopes × 2 orders × 2 states. Each advances 60,001 ms.
const advances = 2 * 2 + 2 + 7 * 2 * 2;
const failures = [];
for (let step = 0; step <= advances; step++) {
  const now = start + step * 60_001;
  if (departureRows([[row]], {now}).length !== 1) failures.push({step, now: new Date(now).toISOString()});
}
console.log(JSON.stringify({advances, checks: advances + 1, rowDeparture: row.place.departure,
  passed: advances + 1 - failures.length, failed: failures.length, failures}, null, 2));
assert.equal(failures.length, 0, 'the reusable healthy row must survive the complete cache-expiry fixture clock');
