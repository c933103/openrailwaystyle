import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import * as crossings from '../scripts/crossing-data.mjs';

const source = await readFile(new URL('../scripts/build-crossings.mjs', import.meta.url), 'utf8');
const regions = crossings.startRegions();
const parent = regions[0].box;
const parentQuery = crossings.regionQuery(parent);
const otherQueries = regions.slice(1).map(({box}) => crossings.regionQuery(box));
const empty = `1${crossings.SEP}${crossings.SEP}${crossings.SEP}minor\n2${crossings.SEP}${crossings.SEP}${crossings.SEP}end\n`;
const response = (status, body) => new Response(body, {status});
// The capacity wording is the diagnostic in job 116771211885, run 38837959156.
// The short fixture is not represented as a complete archived provider body.
const capacity = '# 502 Gateway Timeout\nThis Overpass API server is currently at capacity. All query workers are busy and the request queue is full.';
const html = detail => `<html><head><title>OSM3S Response</title></head><body><p>${detail}</p></body></html>`;

// Execute the actual entrypoint and its real query/parser/region functions.
// Fetch has no network implementation; time is recorded rather than waited.
// Small complete fixtures intentionally stop at the existing 900,000-row guard,
// so these acquisition tests cannot replace or publish a snapshot.
async function run(reply, {byteLength} = {}) {
  const calls = [], sleeps = [], warnings = [], filesystem = [];
  const forbid = name => async (...args) => {
    filesystem.push({name, args});
    throw new Error(`Unexpected fixture filesystem call: ${name}`);
  };
  const context = vm.createContext({
    process:{env:{OVERPASS_URL:'https://overpass.fixture.invalid/api/interpreter'}},
    URL, URLSearchParams,
    Buffer:byteLength ? {byteLength} : Buffer,
    AbortSignal:{timeout:ms => { assert.equal(ms, 240000); return undefined; }},
    setTimeout:(callback, ms) => { sleeps.push(ms); callback(); },
    console:{log:() => {}, warn:(...args) => warnings.push(args.join(' '))},
    fetch:async (url, options) => {
      assert.equal(url, 'https://overpass.fixture.invalid/api/interpreter');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['User-Agent'], 'OpenRailwayAtlas-crossings/1.0 (+https://github.com/c933103/openrailwaystyle)');
      const query = options.body.get('data');
      calls.push(query);
      assert.ok(calls.length <= 50, 'unexpected fixture request loop');
      return reply(query, calls.length);
    },
  });
  const dependencies = {
    'node:fs/promises':Object.fromEntries(['mkdir', 'readFile', 'writeFile', 'rm'].map(name => [name, forbid(name)])),
    'node:zlib':{gzipSync:() => assert.fail('unexpected compression'), gunzipSync:() => assert.fail('unexpected decompression')},
    './crossing-data.mjs':crossings,
  };
  const module = new vm.SourceTextModule(source, {
    context, initializeImportMeta:meta => { meta.url = 'file:///fixture/scripts/build-crossings.mjs'; },
  });
  await module.link(specifier => {
    const values = dependencies[specifier];
    assert.ok(values, `unexpected import ${specifier}`);
    return new vm.SyntheticModule(Object.keys(values), function() {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, {context});
  });
  let error;
  try { await module.evaluate(); } catch (caught) { error = caught; }
  assert.deepEqual(filesystem, [], 'failed or undersized acquisition cannot touch the saved snapshot');
  return {calls, sleeps, warnings, error};
}

function checkAcquired(result, firstQueries, firstSleeps) {
  assert.match(result.error?.message || '', /^Suspiciously few crossings worldwide: 0$/);
  assert.deepEqual(result.calls, [...firstQueries, ...otherQueries]);
  assert.deepEqual(result.sleeps, [...firstSleeps, ...otherQueries.map(() => 10000)]);
}

test('capacity Gateway Timeout retries the same query rather than subdividing', async () => {
  const result = await run((_query, count) => response(count === 1 ? 502 : 200, count === 1 ? capacity : empty));
  checkAcquired(result, [parentQuery, parentQuery], [0, 60000]);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /HTTP 502: # 502 Gateway Timeout/);
});

for (const [name, detail] of [
  ['capacity', 'This Overpass API server is currently at capacity.'],
  ['workers', 'All query workers are busy.'],
  ['queue', 'The request queue is full.'],
  ['case and whitespace', 'THE REQUEST\nQUEUE IS FULL.'],
  ['beyond the log excerpt', `${'Synthetic provider preamble. '.repeat(15)}The request queue is full.`],
]) {
  test(`HTTP 504 ${name} diagnostic takes precedence over Gateway Timeout`, async () => {
    const body = html(`Gateway Timeout. ${detail}`);
    const result = await run((_query, count) => response(count === 1 ? 504 : 200, count === 1 ? body : empty));
    checkAcquired(result, [parentQuery, parentQuery], [0, 60000]);
    assert.ok(result.warnings[0].length <= parent.join(',').length + 1 + 210);
    if (name === 'beyond the log excerpt') assert.doesNotMatch(result.warnings[0], /queue is full/);
  });
}

test('mixed Dispatcher, generic 502 and capacity failures keep the same region and growing delays', async () => {
  const replies = [
    response(504, html('runtime error: open64: 0 Success /osm3s_osm_base Dispatcher_Client::request_read_and_idx::timeout.')),
    response(502, html('502 Bad Gateway nginx/1.22.1')),
    response(502, capacity),
  ];
  const result = await run((_query, count) => replies[count - 1] || response(200, empty));
  checkAcquired(result, Array(4).fill(parentQuery), [0, 60000, 120000, 180000]);
});

for (const [name, status, body] of [
  ['persistent capacity', 502, capacity],
  ['persistent queue full', 504, html('Gateway Timeout. The request queue is full.')],
  ['rate limit', 429, 'Gateway Timeout'],
  ['service unavailable', 503, 'Gateway Timeout'],
  ['generic gateway failure', 502, 'Bad Gateway'],
  ['permanent invalid query', 400, 'parse error: invalid query'],
]) {
  test(`${name} is bounded at five attempts without subdivision or publication`, async () => {
    const result = await run(() => response(status, body));
    assert.match(result.error?.message || '', /^Overpass stayed unavailable for region /);
    assert.deepEqual(result.calls, Array(5).fill(parentQuery));
    assert.deepEqual(result.sleeps, [0, 60000, 120000, 180000, 240000]);
    assert.equal(result.warnings.length, 5);
  });
}

for (const [name, status, body] of [
  ['executed-query HTTP timeout', 504, html('runtime error: Query timed out in "query" at line 1 after 181 seconds.')],
  ['executed-query error page', 200, html('runtime error: Query timed out in "query" at line 1 after 181 seconds.')],
  ['query memory exhaustion', 200, html('runtime error: Query run out of memory using about 2048 MB of RAM.')],
  ['truncated CSV', 200, `1${crossings.SEP}${crossings.SEP}${crossings.SEP}minor\n`],
]) {
  test(`${name} retains bounded spatial subdivision`, async () => {
    const result = await run((_query, count) => response(count === 1 ? status : 200, count === 1 ? body : empty));
    const childQueries = crossings.quarters(parent).map(box => crossings.regionQuery(box));
    checkAcquired(result, [parentQuery, ...childQueries], [0, 10000, 10000, 10000, 10000]);
  });
}

test('repeated genuine query timeout still stops at the existing depth-five limit', async () => {
  const result = await run(() => response(504, html('runtime error: Query timed out in "query" after 181 seconds.')));
  const expected = [];
  let box = parent;
  for (let depth = 0; depth <= 5; depth++) {
    expected.push(crossings.regionQuery(box));
    box = crossings.quarters(box)[0];
  }
  assert.match(result.error?.message || '', /^Could not fetch region /);
  assert.deepEqual(result.calls, expected);
  assert.deepEqual(result.sleeps, [0, 10000, 10000, 10000, 10000, 10000]);
});

test('transport failure retries are bounded without spatial subdivision', async () => {
  const result = await run(() => { throw new TypeError('fetch failed'); });
  assert.match(result.error?.message || '', /^Overpass stayed unavailable for region /);
  assert.deepEqual(result.calls, Array(5).fill(parentQuery));
  assert.deepEqual(result.sleeps, [0, 60000, 120000, 180000, 240000]);
});

test('client timeout retains spatial subdivision', async () => {
  const result = await run((_query, count) => {
    if (count === 1) throw new Error('The operation was aborted due to timeout');
    return response(200, empty);
  });
  checkAcquired(result, [parentQuery, ...crossings.quarters(parent).map(box => crossings.regionQuery(box))], [0, 10000, 10000, 10000, 10000]);
});

test('download budget is checked before overload retry and accumulates failed responses', async () => {
  const result = await run(() => response(502, capacity), {byteLength:() => 100_000_001});
  assert.match(result.error?.message || '', /^Download budget exceeded$/);
  assert.deepEqual(result.calls, [parentQuery, parentQuery]);
  assert.deepEqual(result.sleeps, [0, 60000]);
});
