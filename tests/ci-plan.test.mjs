import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {GROUPS, LOCAL_ORM_CHECKS, VALIDATED_CONTEXT, plan, matrix, validatedPull, localReferences, dataDigest, resultKey} from '../scripts/ci-plan.mjs';
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => existsSync(root + file) ? readFileSync(root + file, 'utf8') : null;
const groupsFor = changed => plan(changed, read).groups.map(({group, checks}) => `${group}:${checks.length}`);
const everything = GROUPS.map(({group, checks}) => `${group}:${checks.length}`);

test('every browser check is either in fixture-safe CI or explicitly local-only', () => {
  const checks = readdirSync(root + 'scripts').filter(name => /^check-.*-browser\.mjs$/.test(name)).sort();
  const ci=GROUPS.flatMap(g=>g.checks),local=LOCAL_ORM_CHECKS;
  assert.deepEqual([...ci,...local].sort(),checks);
  assert.equal(new Set([...ci,...local]).size,checks.length,'each browser test belongs to exactly one set');
  assert.ok(GROUPS.some(g=>g.checks.includes('check-orm-fixture-browser.mjs')));
});

test('anything the site is built from runs every check', () => {
  for (const file of ['styles/app.mjs', 'styles/world.style.json', 'package-lock.json', '.github/workflows/site.yml', 'scripts/serve.mjs', 'scripts/browser.mjs', 'scripts/run-browser-checks.mjs', 'scripts/build-browser.mjs', 'scripts/rebuild-service-frequency.mjs', 'scripts/ci-plan.mjs'])
    assert.deepEqual(groupsFor([file]), everything, file);
  assert.deepEqual(groupsFor(null), everything, 'nothing to compare against');
});

test('tests, docs, other pipelines and style sources (checked through the committed style) run no browser checks', () => {
  for (const changed of [['tests/platform-length.test.mjs'], ['docs/data-maintenance.md', 'scripts/build-heritage.mjs', 'scripts/heritage-data.mjs', 'tests/heritage.test.mjs'], ['styles/fonts/README.md'], ['scripts/style/layers/stations.mjs'], ['.github/workflows/heritage.yml']])
    assert.deepEqual(groupsFor(changed), [], changed.join(', '));
});

test('a check, its helpers and its fixtures run only the checks that use them', () => {
  assert.deepEqual(groupsFor(['scripts/check-polar-browser.mjs']), ['context:1']);
  assert.deepEqual(groupsFor(['tests/fixtures/stations-before-density.json']), [],'local-only station density check is not dispatched in public CI');
  for(const check of LOCAL_ORM_CHECKS)assert.deepEqual(groupsFor([`scripts/${check}`]),[],check+' stays local-only');
  const helper = plan(['scripts/click-visible-control.mjs'], read).groups.flatMap(g => g.checks);
  assert.ok(helper.length && helper.every(check => read(`scripts/${check}`).includes('click-visible-control.mjs')), helper.join(', '));
  assert.deepEqual(plan(['scripts/check-world-frequency-browser.mjs'], read).groups, [GROUPS.find(g => g.group === 'frequency')], 'the fixture data is prepared before its check');
});

test('local references cover imports, dynamic imports and files read through new URL, without query strings', () => {
  assert.deepEqual(localReferences(`import a from './a.mjs';import('../styles/b.mjs?v=1');readFile(new URL('../tests/fixtures/c.json',import.meta.url));fetch(\`\${x}/d\`)`, 'scripts/check-x-browser.mjs').sort(),
    ['scripts/a.mjs', 'styles/b.mjs', 'tests/fixtures/c.json']);
});

test('the matrix lists each job with its checks and preparation', () => {
  assert.deepEqual(matrix([{group: 'map', checks: ['check-map-browser.mjs']}, {group: 'frequency', checks: ['check-world-frequency-browser.mjs'], prepare: 'x'}]),
    {include: [{group: 'map', checks: 'check-map-browser.mjs', prepare: ''}, {group: 'frequency', checks: 'check-world-frequency-browser.mjs', prepare: 'x'}]});
});

test('a push reuses a pull request result only for the same code and data, from its newest status', async () => {
  const k1 = resultKey('t1', 'd'.repeat(64)), old = resultKey('t1', 'e'.repeat(64));
  const responses = {
    'commits/m1/pulls': [{number: 7, merged_at: '2026-10-05T00:00:00Z', head: {sha: 'h7'}}, {number: 8, merged_at: null, head: {sha: 'h8'}}],
    'commits/h7/statuses?per_page=100': [{context: VALIDATED_CONTEXT, state: 'success', description: k1}, {context: VALIDATED_CONTEXT, state: 'success', description: old}, {context: 'other', state: 'success', description: k1}],
    'commits/m2/pulls': [{number: 9, merged_at: '2026-10-05T00:00:00Z', head: {sha: 'h9'}}],
    'commits/h9/statuses?per_page=100': [{context: VALIDATED_CONTEXT, state: 'failure', description: k1}, {context: VALIDATED_CONTEXT, state: 'success', description: k1}],
  };
  const requests = [];
  const fetcher = async (url, {headers}) => { requests.push(headers.authorization); const path = url.replace('https://api.github.com/repos/o/r/', ''); return {ok: path in responses, status: path in responses ? 200 : 404, json: async () => responses[path]}; };
  assert.equal(await validatedPull({repo: 'o/r', sha: 'm1', key: k1, token: 'k', fetcher}), 7);
  assert.equal(await validatedPull({repo: 'o/r', sha: 'm1', key: old, token: 'k', fetcher}), null, 'only the newest status counts');
  assert.equal(await validatedPull({repo: 'o/r', sha: 'm1', key: resultKey('t1', 'f'.repeat(64)), token: 'k', fetcher}), null, 'the same code with other data runs the checks');
  assert.equal(await validatedPull({repo: 'o/r', sha: 'm1', key: resultKey('t2', 'd'.repeat(64)), token: 'k', fetcher}), null, 'other code runs the checks');
  assert.equal(await validatedPull({repo: 'o/r', sha: 'm2', key: k1, token: 'k', fetcher}), null, 'a newer failure wins');
  await assert.rejects(validatedPull({repo: 'o/r', sha: 'missing', key: k1, token: 'k', fetcher}), /404/);
  assert.ok(requests.every(value => value === 'Bearer k'));
  assert.ok(resultKey('a'.repeat(40), 'b'.repeat(64)).length <= 140, 'fits a status description');
});

test('the data digest follows every file name and byte of the assembled data', async () => {
  const make = async files => { const dir = await mkdtemp(join(tmpdir(), 'site-data-')); for (const [name, body] of Object.entries(files)) { await mkdir(join(dir, name, '..'), {recursive: true}); await writeFile(join(dir, name), body); } return dataDigest(dir); };
  const base = {'manifest.json': '{}', 'lifecycle/7/1/2.pbf.gz': 'tile', 'heritage/8/1/2.bundle.gz': 'bundle'};
  const digest = await make(base);
  assert.equal(await make(base), digest, 'the same data gives the same digest wherever it is assembled');
  assert.notEqual(await make({...base, 'heritage/8/1/2.bundle.gz': 'bundlf'}), digest, 'a changed byte');
  assert.notEqual(await make({...base, 'heritage/8/1/3.bundle.gz': 'bundle'}), digest, 'an added file');
  const {['manifest.json']: _, ...without} = base;
  assert.notEqual(await make({...without, 'manifest2.json': '{}'}), digest, 'a renamed file');
});
