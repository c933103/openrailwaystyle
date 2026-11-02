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
  assert.deepEqual(usage, {script: 'build-fixture.mjs', bytes: 100015, requests: 3, hosts: {[host]: {bytes: 100015, requests: 3}}});
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
  assert.ok(usage.bytes > 0 && usage.bytes <= 100000, 'only the bytes read');
});

test('a builder that fetches nothing reports zero; one that exits early still reports', async t => {
  assert.deepEqual((await run(t, 'console.log("no requests");')).usage, {script: 'build-fixture.mjs', bytes: 0, requests: 0, hosts: {}});
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
