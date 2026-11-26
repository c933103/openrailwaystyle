import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DATASETS, SOURCES_FILE, checkMarker, envLines, envName, extractBranch, parseConfig, parseDrill, parseFile, resolve, settings, summary} from '../scripts/data-source.mjs';

const marker = (id, extra = {}) => JSON.stringify({schema: 1, dataset: id, source: 'extract', complete: true, osmTimestamp: '2026-11-07T21:21:36Z', ...extra});
// A remote where `branches` maps branch → source.json text (or an Error).
const remote = (branches = {}, status = {}) => {
  const asked = [];
  return {asked,
    lsRemote: async branch => { asked.push(branch); return status[branch] ?? (branch in branches ? 0 : 2); },
    readMarker: async branch => { const text = branches[branch]; if (text instanceof Error) throw text; return text; }};
};
const pick = (choices, id) => choices.find(c => c.id === id);
// A file naming every dataset, on Overpass unless `extract` names it.
const fileText = (...extract) => JSON.stringify(Object.fromEntries(DATASETS.map(d => [d.id, extract.includes(d.id) ? 'extract' : 'overpass'])));
const fromVariable = text => settings({}, parseConfig(text));

test('with every dataset on Overpass, each uses its Overpass branch and nothing else is looked up', async () => {
  const r = remote();
  const choices = await resolve(settings(parseFile(fileText())), r);
  assert.deepEqual(choices.map(c => [c.id, c.source, c.branch]), DATASETS.map(d => [d.id, 'overpass', d.overpassBranch]));
  assert.deepEqual(r.asked, []);
  assert.deepEqual(parseConfig(undefined), {});
  assert.deepEqual(parseConfig('  '), {});
});

test('a dataset set to extract takes its extract branch only when it is there and marked complete', async () => {
  const config = fromVariable('{"heritage":"extract","conveying":"extract","crossings":"extract","branch-lines":"extract","traction":"overpass"}');
  const r = remote({
    'heritage-extract-data': marker('heritage'),
    'conveying-extract-data': marker('conveying', {complete: false}),
    'branch-lines-extract-data': new Error('fatal: path source.json does not exist'),
  }, {'crossings-extract-data': 128});
  const choices = await resolve(config, r);
  assert.deepEqual(pick(choices, 'heritage'), {id: 'heritage', configured: 'extract', setBy: 'variable', source: 'extract', branch: 'heritage-extract-data', reason: 'configured', osmTimestamp: '2026-11-07T21:21:36Z'});
  assert.deepEqual([pick(choices, 'conveying').source, pick(choices, 'conveying').branch], ['overpass', 'conveying-data']);
  assert.match(pick(choices, 'conveying').reason, /^fell back: conveying-extract-data: its build is not complete$/);
  assert.match(pick(choices, 'crossings').reason, /^fell back: looking up crossings-extract-data failed \(git exit 128\)$/);
  assert.equal(pick(choices, 'crossings').branch, 'crossing-data');
  assert.match(pick(choices, 'branch-lines').reason, /^fell back: branch-lines-extract-data has no readable source.json \(fatal: path source.json does not exist\)$/);
  assert.equal(pick(choices, 'traction').reason, 'configured');
  assert.deepEqual(r.asked.sort(), ['branch-lines-extract-data', 'conveying-extract-data', 'crossings-extract-data', 'heritage-extract-data'], 'only datasets set to extract are looked up');
  // No extract branch at all.
  const none = await resolve(fromVariable('{"aerialways":"extract"}'), remote());
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
  const choices = await resolve(fromVariable('{"street-running":"extract"}'), remote());
  const lines = envLines(choices).trim().split('\n');
  assert.equal(lines.length, DATASETS.length);
  assert.ok(lines.includes('DATA_BRANCH_STREET_RUNNING=street-data'));
  assert.ok(lines.includes('DATA_BRANCH_LIFECYCLE=rail-data'));
  assert.equal(envName('service-routes'), 'DATA_BRANCH_SERVICE_ROUTES');
  assert.equal(extractBranch('axle-load'), 'axle-load-extract-data');
  const text = summary(choices);
  assert.match(text, /\*\*1 dataset\(s\) fell back to Overpass\.\*\*/);
  assert.match(text, /\| street-running \| extract \| variable \| overpass \| `street-data` \| fell back: no branch street-running-extract-data \|/);
  assert.doesNotMatch(summary(await resolve({}, remote())), /fell back/);
});

test('the site stages every dataset from the branch the resolver chose', () => {
  const workflow = readFileSync(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  const job = workflow.slice(workflow.indexOf('\n  validate:\n'), workflow.indexOf('\n  browser:\n'));
  const resolver = job.indexOf('node scripts/data-source.mjs resolve');
  assert.ok(resolver > job.indexOf('npm ci'), 'after the install');
  assert.match(job, /DATA_SOURCES: \$\{\{ vars\.DATA_SOURCES \}\}\n\s+DATA_SOURCES_DRILL: \$\{\{ inputs\.drill \}\}\n\s+run: node scripts\/data-source\.mjs resolve/);
  // The drill is a dispatch input only: a push or pull request never sets it.
  const dispatch = workflow.slice(workflow.indexOf('\n  workflow_dispatch:\n'), workflow.indexOf('\npermissions:'));
  assert.match(dispatch, /\n {6}drill:\n[\s\S]*required: false\n\s+default: ''/);
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

test('the checked-in choice names every dataset and puts each on Overpass until a reviewed change moves it', async () => {
  const text = readFileSync(SOURCES_FILE, 'utf8');
  const file = parseFile(text);
  assert.deepEqual(Object.keys(file), DATASETS.map(d => d.id), 'every dataset, in the resolver\'s order');
  // Each switch to "extract" is its own pull request; this one moves none.
  assert.deepEqual(Object.values(file), DATASETS.map(() => 'overpass'));
  const choices = await resolve(settings(file), remote());
  assert.ok(choices.every(c => c.setBy === 'file' && c.source === 'overpass' && c.reason === 'configured'));
});

test('the checked-in choice must be a JSON object naming every known dataset with a known source', () => {
  assert.throws(() => parseFile(''), /scripts\/data-sources\.json is empty/);
  assert.throws(() => parseFile('{"heritage":"extract"}'), /must name every dataset; missing: lifecycle, traction,/);
  const all = JSON.parse(fileText());
  assert.throws(() => parseFile(JSON.stringify({...all, heritages: 'extract'})), /scripts\/data-sources\.json names an unknown dataset "heritages"/);
  assert.throws(() => parseFile(JSON.stringify({...all, heritage: 'geofabrik'})), /scripts\/data-sources\.json sets heritage to "geofabrik"/);
  assert.throws(() => parseFile('[]'), /JSON object/);
  assert.throws(() => parseFile('{'), /scripts\/data-sources\.json is not JSON/);
  assert.deepEqual(parseFile(fileText('heritage')).heritage, 'extract');
});

test('the variable overrides the file only for the datasets it names', async () => {
  const file = parseFile(fileText('heritage', 'conveying'));
  const chosen = settings(file, parseConfig('{"heritage":"overpass","crossings":"extract"}'));
  assert.deepEqual(chosen.heritage, {source: 'overpass', setBy: 'variable'}, 'an emergency switch back');
  assert.deepEqual(chosen.crossings, {source: 'extract', setBy: 'variable'});
  assert.deepEqual(chosen.conveying, {source: 'extract', setBy: 'file'});
  assert.deepEqual(chosen.lifecycle, {source: 'overpass', setBy: 'file'});
  assert.deepEqual(settings(file, parseConfig('')), settings(file), 'an unset variable changes nothing');
  const choices = await resolve(chosen, remote({'conveying-extract-data': marker('conveying'), 'heritage-extract-data': marker('heritage')}));
  assert.deepEqual([pick(choices, 'heritage').source, pick(choices, 'heritage').setBy], ['overpass', 'variable']);
  assert.deepEqual([pick(choices, 'conveying').branch, pick(choices, 'conveying').setBy], ['conveying-extract-data', 'file']);
});

test('a drill makes a complete extract branch fall back for that run only, and refuses a drill that would show nothing', async () => {
  const chosen = settings(parseFile(fileText('street-running', 'heritage')));
  const r = remote({'street-running-extract-data': marker('street-running'), 'heritage-extract-data': marker('heritage')});
  const drill = parseDrill('["street-running"]', chosen);
  const choices = await resolve(chosen, r, drill);
  assert.deepEqual(pick(choices, 'street-running'), {id: 'street-running', configured: 'extract', setBy: 'file', source: 'overpass', branch: 'street-data', reason: 'fell back: drill: street-running-extract-data treated as unusable for this run'});
  assert.equal(pick(choices, 'heritage').branch, 'heritage-extract-data', 'datasets not in the drill are unaffected');
  assert.ok(envLines(choices).includes('DATA_BRANCH_STREET_RUNNING=street-data\n'), 'the staging steps take the Overpass branch');
  assert.match(summary(choices), /\*\*1 dataset\(s\) fell back to Overpass\.\*\*/);
  // Without the drill the same branches are used.
  assert.equal(pick(await resolve(chosen, r), 'street-running').branch, 'street-running-extract-data');
  assert.deepEqual(parseDrill('', chosen), []);
  assert.deepEqual(parseDrill(undefined, chosen), []);
  assert.throws(() => parseDrill('["lifecycle"]', chosen), /names lifecycle, which is set to overpass; a drill needs a dataset set to extract/);
  assert.throws(() => parseDrill('["streets"]', chosen), /unknown dataset "streets"/);
  assert.throws(() => parseDrill('[]', chosen), /nonempty JSON list/);
  assert.throws(() => parseDrill('"street-running"', chosen), /nonempty JSON list/);
  assert.throws(() => parseDrill('[street-running]', chosen), /DATA_SOURCES_DRILL is not JSON/);
});

test('the resolver run by site.yml reads the checked-in file, the variable and the drill, and stops on a bad one before staging', () => {
  const run = (env, script = new URL('../scripts/data-source.mjs', import.meta.url).pathname) => {
    const dir = mkdtempSync(join(tmpdir(), 'data-source-'));
    const githubEnv = join(dir, 'env');
    const result = spawnSync(process.execPath, [script, 'resolve'],
      {encoding: 'utf8', env: {PATH: process.env.PATH, RUNNER_TEMP: dir, GITHUB_ENV: githubEnv, ...env}});
    let written = '';
    try { written = readFileSync(githubEnv, 'utf8'); } catch {}
    return {...result, written};
  };
  // Every dataset on Overpass: no branch is looked up, so this needs no remote.
  const plain = run({});
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /\| heritage \| overpass \| file \| overpass \| `heritage-data` \| configured \|/);
  assert.equal(plain.written.trim().split('\n').length, DATASETS.length);
  const override = run({DATA_SOURCES: '{"heritage":"overpass"}'});
  assert.equal(override.status, 0, override.stderr);
  assert.match(override.stdout, /\| heritage \| overpass \| variable \|/);
  for (const [env, message] of [
    [{DATA_SOURCES: '{"heritages":"extract"}'}, /DATA_SOURCES names an unknown dataset "heritages"/],
    [{DATA_SOURCES_DRILL: '["heritage"]'}, /names heritage, which is set to overpass/],
    [{DATA_SOURCES_DRILL: 'heritage'}, /DATA_SOURCES_DRILL is not JSON/],
  ]) {
    const failed = run(env);
    assert.notEqual(failed.status, 0, JSON.stringify(env));
    assert.match(failed.stderr, message);
    assert.equal(failed.written, '', 'nothing is handed to the staging steps');
  }
  // A drill: the script beside a file that sets street running to extract.
  // A drilled dataset is not looked up, so this needs no remote either.
  const copy = mkdtempSync(join(tmpdir(), 'data-source-drill-'));
  copyFileSync(new URL('../scripts/data-source.mjs', import.meta.url), join(copy, 'data-source.mjs'));
  writeFileSync(join(copy, 'data-sources.json'), fileText('street-running'));
  const drilled = run({DATA_SOURCES_DRILL: '["street-running"]'}, join(copy, 'data-source.mjs'));
  assert.equal(drilled.status, 0, drilled.stderr);
  assert.match(drilled.stdout, /\| street-running \| extract \| file \| overpass \| `street-data` \| fell back: drill: street-running-extract-data treated as unusable for this run \|/);
  assert.ok(drilled.written.includes('DATA_BRANCH_STREET_RUNNING=street-data\n'));
});
