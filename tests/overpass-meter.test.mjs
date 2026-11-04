import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';

// A local fixture server only: no provider is asked.
const meter = new URL('../scripts/overpass-meter.mjs', import.meta.url).pathname;
async function serve(t) {
  const server = createServer((request, response) => {
    if (request.url === '/big') { response.end('x'.repeat(100000)); return; }
    if (request.url === '/empty') { response.statusCode = 204; response.end(); return; }
    if (request.url === '/busy') { response.statusCode = 503; response.end('b'.repeat(10000)); return; }
    if (request.url === '/chunked') { response.statusCode = 503; response.write('c'.repeat(5000)); response.end('c'.repeat(5000)); return; }
    response.end('{"elements":[]}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
async function run(t, code, env = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'overpass-meter-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const script = join(dir, 'build-fixture.mjs'), summary = join(dir, 'summary.md');
  await writeFile(script, code);
  const result = await promisify(execFile)(process.execPath, ['--import', meter, script], {env: {...process.env, GITHUB_STEP_SUMMARY: summary, ...env}})
    .catch(error => error);
  const line = String(result.stdout).split('\n').find(l => l.startsWith('OVERPASS_USAGE '));
  return {result, usage: line && JSON.parse(line.slice('OVERPASS_USAGE '.length)), summary: await readFile(summary, 'utf8').catch(() => '')};
}

test('the meter counts each host\'s requests and the bytes read, and the builder sees the same responses', async t => {
  const base = await serve(t), host = new URL(base).host;
  const {usage, summary, result} = await run(t, `
    const a = await fetch('${base}/big'); const text = await a.text();
    if (text.length !== 100000 || a.status !== 200 || a.url !== '${base}/big' || a.headers.get('content-length') !== '100000') throw new Error('changed response');
    const b = await fetch(new Request('${base}/json', {method: 'POST', body: 'data=x'}));
    if ((await b.json()).elements.length !== 0) throw new Error('changed JSON');
    const c = await fetch('${base}/empty'); if (c.status !== 204) throw new Error('changed status');
  `);
  assert.equal(result.code ?? 0, 0, String(result.stderr));
  assert.deepEqual(usage, {script: 'build-fixture.mjs', bytes: 100015, requests: 3, unread: 0, unmeasured: 0, hosts: {[host]: {bytes: 100015, requests: 3}}});
  assert.match(summary, /^`OVERPASS_USAGE \{.*"bytes":100015/);
});

test('a failing or cancelling builder still reports what it read', async t => {
  const base = await serve(t);
  const {usage, result} = await run(t, `
    const response = await fetch('${base}/big');
    const reader = response.body.getReader(); const {value} = await reader.read(); await reader.cancel();
    if (!value.byteLength) throw new Error('no chunk');
    throw new Error('builder failed');
  `);
  assert.notEqual(result.code ?? 0, 0, 'the builder\'s own failure stands');
  assert.match(String(result.stderr), /builder failed/);
  assert.equal(usage.requests, 1);
  assert.equal(usage.bytes, 100000, 'the bytes read and the rest of the declared length');
  assert.deepEqual([usage.unread, usage.unmeasured], [1, 0]);
});

test('a builder that fetches nothing reports zero; one that exits early still reports', async t => {
  assert.deepEqual((await run(t, 'console.log("no requests");')).usage, {script: 'build-fixture.mjs', bytes: 0, requests: 0, unread: 0, unmeasured: 0, hosts: {}});
  const base = await serve(t);
  const early = await run(t, `await (await fetch('${base}/json')).text(); process.exit(3);`);
  assert.equal(early.result.code, 3);
  assert.equal(early.usage.bytes, 15);
});

test('every builder step of the OSM update workflows loads the meter', () => {
  const workflows = ['snapshot', 'crossings', 'street-running', 'conveying', 'aerialways', 'heritage', 'station-points',
    'railway-ways', 'branch-lines', 'service-routes', 'traction-facilities'];
  let steps = 0;
  for (const name of workflows) {
    const text = readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8');
    for (const line of text.split('\n').filter(l => /\bnode\b.*\sscripts\/build-[\w-]+\.mjs/.test(l))) {
      steps++;
      assert.match(line, /\bnode --import \.\/scripts\/overpass-meter\.mjs (?:--[^ ]+ )*scripts\/build-/, `${name}.yml: ${line.trim()}`);
    }
  }
  assert.ok(steps >= 37, `found ${steps} builder steps`);
});

test('an error body the builder rejects unread counts by its declared length; one without a length is reported unmeasured', async t => {
  const base = await serve(t);
  const {usage} = await run(t, `
    for (let attempt = 0; attempt < 2; attempt++) { const r = await fetch('${base}/busy'); if (r.ok) throw new Error('fixture'); }
    const r = await fetch('${base}/chunked'); if (r.headers.get('content-length') !== null) throw new Error('fixture has a length');
  `);
  assert.equal(usage.requests, 3);
  assert.equal(usage.bytes, 20000, 'two unread 10,000-byte error bodies');
  assert.deepEqual([usage.unread, usage.unmeasured], [3, 1], 'the chunked body has no declared length: a lower bound');
});

// A host that accepts connections and drops them, so fetch rejects with
// "fetch failed" as when Overpass is unreachable; /answer is answered 503.
async function dropping(t) {
  let received = 0;
  const server = createServer((request, response) => {
    received++;
    if (request.url.startsWith('/answer')) { response.statusCode = 503; response.end('busy'); } else request.socket.destroy();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return {base: `http://127.0.0.1:${server.address().port}`, received: () => received};
}
const ASK = base => `
  const outcomes = [], pause = ms => new Promise(r => setTimeout(r, ms));
  const ask = async path => {
    try { const r = await fetch('${base}' + path); await r.text(); outcomes.push(r.status); }
    catch (error) { outcomes.push(error.name + (error.cause?.message?.startsWith('not sent') ? ' skipped' : ' failed') + ': ' + error.message); }
  };`;
const outcomesOf = result => JSON.parse(String(result.stdout).split('\n').find(l => l.startsWith('OUTCOMES ')).slice(9));
const FAILED = 'TypeError failed: fetch failed', SKIPPED = 'TypeError skipped: fetch failed';

test('after three unanswered requests in a row a host is not asked again during the cooldown', async t => {
  const down = await dropping(t), other = await serve(t);
  const {usage, result} = await run(t, `${ASK(down.base)}
    for (let i = 0; i < 6; i++) await ask('/q');
    const ok = await fetch('${other}/'); await ok.text();
    console.log('OUTCOMES ' + JSON.stringify(outcomes));
  `);
  assert.equal(result.code ?? 0, 0, String(result.stderr));
  // A skipped request fails exactly as a dead connection does, so every
  // builder keeps its data and asks again, as it does in an outage.
  assert.deepEqual(outcomesOf(result), [FAILED, FAILED, FAILED, SKIPPED, SKIPPED, SKIPPED]);
  assert.equal(down.received(), 3, 'only three requests reached the host');
  assert.deepEqual(usage.hosts[new URL(down.base).host], {bytes: 0, requests: 3, skipped: 3});
  assert.equal(usage.skipped, 3);
  assert.deepEqual(usage.hosts[new URL(other).host], {bytes: 15, requests: 1}, 'another host is not affected');
});

test('after the cooldown one request goes through; a failure pauses again, an answer (even 503) ends the pause', async t => {
  const down = await dropping(t);
  const {usage, result} = await run(t, `${ASK(down.base)}
    for (let i = 0; i < 4; i++) await ask('/q');   // 3 failed, then skipped
    await pause(400); await ask('/q');             // probe fails: a new pause
    await ask('/answer');                          // skipped
    await pause(400); await ask('/answer');        // probe answered 503: the pause ends
    await ask('/q'); await ask('/q');              // asked again: 2 failures
    await ask('/answer');                          // answered: count back to 0
    for (let i = 0; i < 4; i++) await ask('/q');   // 3 failed, then skipped
    console.log('OUTCOMES ' + JSON.stringify(outcomes));
  `, {OVERPASS_COOLDOWN_MS: '300'});
  assert.equal(result.code ?? 0, 0, String(result.stderr));
  assert.deepEqual(outcomesOf(result), [FAILED, FAILED, FAILED, SKIPPED, FAILED, SKIPPED, 503, FAILED, FAILED, 503, FAILED, FAILED, FAILED, SKIPPED]);
  assert.equal(down.received(), 11);
  assert.equal(usage.hosts[new URL(down.base).host].skipped, 3);
});

test('a request the builder aborts itself does not count as the host failing', async t => {
  const down = await dropping(t), slow = createServer(() => {});
  await new Promise(resolve => slow.listen(0, '127.0.0.1', resolve));
  t.after(() => slow.close());
  const slowBase = `http://127.0.0.1:${slow.address().port}`;
  const {result} = await run(t, `${ASK(slowBase)}
    for (let i = 0; i < 4; i++) {
      const controller = new AbortController(); setTimeout(() => controller.abort(), 50);
      try { await fetch('${slowBase}/', {signal: controller.signal}); outcomes.push('answered'); } catch (error) { outcomes.push(error.name); }
    }
    for (let i = 0; i < 2; i++) { try { await fetch('${slowBase}/', {signal: AbortSignal.timeout(50)}); } catch (error) { outcomes.push(error.name); } }
    console.log('OUTCOMES ' + JSON.stringify(outcomes));
  `);
  assert.equal(result.code ?? 0, 0, String(result.stderr));
  assert.deepEqual(outcomesOf(result), ['AbortError', 'AbortError', 'AbortError', 'AbortError', 'TimeoutError', 'TimeoutError'],
    'own aborts never pause the host; timeouts count but two are under the limit');
  void down;
});

test('every builder still decides to split only on a request that was sent', async () => {
  const {COOLDOWN_MS} = await import('../scripts/overpass-meter.mjs');
  const {HERITAGE_RETRY_DELAYS, heritageFailure} = await import('../scripts/heritage-data.mjs');
  const {OVERPASS_RETRY_MINUTES} = await import('../scripts/overpass-errors.mjs');
  // Heritage splits only on a query too large; its last retry still comes
  // HERITAGE_RETRY_DELAYS.at(-1) after the previous request, past the pause,
  // so that last attempt is a request actually sent.
  assert.ok(HERITAGE_RETRY_DELAYS.at(-1) >= COOLDOWN_MS);
  assert.equal(heritageFailure(new Error('Network: fetch failed'), HERITAGE_RETRY_DELAYS.length, 0), 'fail', 'never a split');
  assert.ok(OVERPASS_RETRY_MINUTES[0] * 60_000 >= COOLDOWN_MS);
  // A skipped request reads as a network failure, never as a size limit.
  assert.equal(heritageFailure(new Error('Network: fetch failed'), 0, 0), 'retry');
  for (const source of ['build-crossings.mjs', 'build-power-facilities.mjs', 'build-signals.mjs'].map(f => readFileSync(new URL(`../scripts/${f}`, import.meta.url), 'utf8'))) {
    for (const [, pattern, flags] of source.matchAll(/\/((?:[^/\n\\]|\\.)*(?:timed\? \?out|timeout)(?:[^/\n\\]|\\.)*)\/([gimsuy]*)/g))
      assert.ok(!new RegExp(pattern, flags).test('fetch failed'), pattern);
  }
});
