import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DATASETS, checkMarker, envLines, envName, extractBranch, parseConfig, resolve, summary} from '../scripts/data-source.mjs';

const marker = (id, extra = {}) => JSON.stringify({schema: 1, dataset: id, source: 'extract', complete: true, osmTimestamp: '2026-11-07T21:21:36Z', ...extra});
// A remote where `branches` maps branch → source.json text (or an Error).
const remote = (branches = {}, status = {}) => {
  const asked = [];
  return {asked,
    lsRemote: async branch => { asked.push(branch); return status[branch] ?? (branch in branches ? 0 : 2); },
    readMarker: async branch => { const text = branches[branch]; if (text instanceof Error) throw text; return text; }};
};
const pick = (choices, id) => choices.find(c => c.id === id);

test('with no configuration every dataset uses its Overpass branch, and nothing else is looked up', async () => {
  const r = remote();
  const choices = await resolve(parseConfig(''), r);
  assert.deepEqual(choices.map(c => [c.id, c.source, c.branch]), DATASETS.map(d => [d.id, 'overpass', d.overpassBranch]));
  assert.deepEqual(r.asked, []);
  assert.deepEqual(parseConfig(undefined), {});
  assert.deepEqual(parseConfig('  '), {});
});

test('a dataset set to extract takes its extract branch only when it is there and marked complete', async () => {
  const config = parseConfig('{"heritage":"extract","conveying":"extract","crossings":"extract","branch-lines":"extract","traction":"overpass"}');
  const r = remote({
    'heritage-extract-data': marker('heritage'),
    'conveying-extract-data': marker('conveying', {complete: false}),
    'branch-lines-extract-data': new Error('fatal: path source.json does not exist'),
  }, {'crossings-extract-data': 128});
  const choices = await resolve(config, r);
  assert.deepEqual(pick(choices, 'heritage'), {id: 'heritage', configured: 'extract', source: 'extract', branch: 'heritage-extract-data', reason: 'configured', osmTimestamp: '2026-11-07T21:21:36Z'});
  assert.deepEqual([pick(choices, 'conveying').source, pick(choices, 'conveying').branch], ['overpass', 'conveying-data']);
  assert.match(pick(choices, 'conveying').reason, /^fell back: conveying-extract-data: its build is not complete$/);
  assert.match(pick(choices, 'crossings').reason, /^fell back: looking up crossings-extract-data failed \(git exit 128\)$/);
  assert.equal(pick(choices, 'crossings').branch, 'crossing-data');
  assert.match(pick(choices, 'branch-lines').reason, /^fell back: branch-lines-extract-data has no readable source.json \(fatal: path source.json does not exist\)$/);
  assert.equal(pick(choices, 'traction').reason, 'configured');
  assert.deepEqual(r.asked.sort(), ['branch-lines-extract-data', 'conveying-extract-data', 'crossings-extract-data', 'heritage-extract-data'], 'only datasets set to extract are looked up');
  // No extract branch at all: the drill's case.
  const none = await resolve(parseConfig('{"aerialways":"extract"}'), remote());
  assert.deepEqual([pick(none, 'aerialways').branch, pick(none, 'aerialways').reason], ['aerialway-data', 'fell back: no branch aerialways-extract-data']);
});

test('a marker counts only for its own dataset, from the extract builder, complete, with an OSM time', () => {
  assert.equal(checkMarker(marker('heritage'), 'heritage'), null);
  for (const [text, reason] of [
    ['not json', /not JSON/],
    ['null', /not an object/],
    [marker('heritage', {schema: 2}), /schema 2/],
    [marker('conveying'), /is for "conveying"/],
    [marker('heritage', {source: 'overpass'}), /source "overpass"/],
    [marker('heritage', {complete: 'yes'}), /not complete/],
    [marker('heritage', {osmTimestamp: '2026-11-07'}), /osmTimestamp/],
    [marker('heritage', {osmTimestamp: '2026-13-45T25:00:00Z'}), /osmTimestamp/],
  ]) assert.match(checkMarker(text, 'heritage'), reason, text);
});

test('a configuration naming an unknown dataset or source fails instead of being ignored', () => {
  assert.throws(() => parseConfig('{"heritages":"extract"}'), /unknown dataset "heritages"/);
  assert.throws(() => parseConfig('{"heritage":"geofabrik"}'), /sets heritage to "geofabrik"/);
  assert.throws(() => parseConfig('["heritage"]'), /JSON object/);
  assert.throws(() => parseConfig('extract'), /not JSON/);
  assert.throws(() => parseConfig('null'), /JSON object/);
});

test('the environment lines and the summary name every dataset and every fallback', async () => {
  const choices = await resolve(parseConfig('{"street-running":"extract"}'), remote());
  const lines = envLines(choices).trim().split('\n');
  assert.equal(lines.length, DATASETS.length);
  assert.ok(lines.includes('DATA_BRANCH_STREET_RUNNING=street-data'));
  assert.ok(lines.includes('DATA_BRANCH_LIFECYCLE=rail-data'));
  assert.equal(envName('service-routes'), 'DATA_BRANCH_SERVICE_ROUTES');
  assert.equal(extractBranch('axle-load'), 'axle-load-extract-data');
  const text = summary(choices);
  assert.match(text, /\*\*1 dataset\(s\) fell back to Overpass\.\*\*/);
  assert.match(text, /\| street-running \| extract \| overpass \| `street-data` \| fell back: no branch street-running-extract-data \|/);
  assert.doesNotMatch(summary(await resolve({}, remote())), /fell back/);
});

test('the site stages every dataset from the branch the resolver chose', () => {
  const workflow = readFileSync(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  const job = workflow.slice(workflow.indexOf('\n  validate:\n'), workflow.indexOf('\n  browser:\n'));
  const resolver = job.indexOf('node scripts/data-source.mjs resolve');
  assert.ok(resolver > job.indexOf('npm ci'), 'after the install');
  assert.match(job, /DATA_SOURCES: \$\{\{ vars\.DATA_SOURCES \}\}\n\s+run: node scripts\/data-source\.mjs resolve/);
  // Every command that reads a data branch comes after the resolver and names
  // no Overpass branch itself.
  const commands = job.split('\n').filter(line => !line.trim().startsWith('#'));
  for (const {overpassBranch} of DATASETS) {
    assert.ok(!commands.some(line => new RegExp(`(origin|ref:|refs/heads/)\\s*${overpassBranch}\\b`).test(line)), `${overpassBranch} is still named in the validate job`);
  }
  const used = new Set(job.match(/DATA_BRANCH_[A-Z_]+/g));
  assert.deepEqual([...used].sort(), DATASETS.map(d => envName(d.id)).sort(), 'every dataset is staged from its variable, and no other variable is used');
  for (const name of used) assert.ok(job.indexOf(name) > resolver, `${name} is read after the resolver runs`);
});
