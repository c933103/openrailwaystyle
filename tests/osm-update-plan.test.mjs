import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {OSM_UPDATES, OSM_UPDATE_PATHS, dueUpdates, lastDueTime, builderChanged} from '../scripts/osm-update-plan.mjs';

const workflows = new URL('../.github/workflows/', import.meta.url);
const ids = runs => runs.map(r => r.id);
const at = iso => new Date(iso);
const ran = started => ({started, sha: 'a'.repeat(40)});
// 2026-11-02 is a Monday; 2026-11-01 a Sunday.

test('weekly and monthly due times are the latest boundary at or before now', () => {
  const lifecycle = OSM_UPDATES.find(e => e.id === 'lifecycle').due, heritage = OSM_UPDATES.find(e => e.id === 'heritage').due;
  assert.equal(lastDueTime(lifecycle, at('2026-11-02T03:23:00Z')).toISOString(), '2026-11-02T03:00:00.000Z');
  assert.equal(lastDueTime(lifecycle, at('2026-11-02T02:59:00Z')).toISOString(), '2026-10-30T03:00:00.000Z', 'before Monday 03:00 the Friday boundary applies');
  assert.equal(lastDueTime(lifecycle, at('2026-11-05T12:00:00Z')).toISOString(), '2026-11-02T03:00:00.000Z');
  assert.equal(lastDueTime(heritage, at('2026-11-03T21:23:00Z')).toISOString(), '2026-11-03T21:00:00.000Z');
  assert.equal(lastDueTime(heritage, at('2026-11-03T15:23:00Z')).toISOString(), '2026-10-03T21:00:00.000Z');
  assert.equal(lastDueTime(heritage, at('2026-01-02T00:00:00Z')).toISOString(), '2025-12-03T21:00:00.000Z', 'crosses the year');
  assert.equal(lastDueTime({every: true}, at('2026-11-02T03:23:00Z')), null);
});

test('a dataset runs once per due time, and a late or skipped run is caught up', () => {
  const recent = Object.fromEntries(OSM_UPDATES.map(e => [e.id, ran('2026-11-02T03:30:00Z')]));
  // Monday 09:23: weekly and monthly work already done since their boundary.
  assert.deepEqual(ids(dueUpdates(at('2026-11-02T09:23:00Z'), recent)), ['station-points', 'branch-lines', 'service-routes', 'traction']);
  // Monday 03:23 with Friday's lifecycle run done: lifecycle is due again.
  assert.deepEqual(ids(dueUpdates(at('2026-11-02T03:23:00Z'), {...recent, lifecycle: ran('2026-10-30T03:40:00Z')})).slice(0, 1), ['lifecycle']);
  // Sunday's run was skipped: Monday's first run still does the Sunday work.
  const missed = {...recent, crossings: ran('2026-10-25T04:00:00Z'), 'street-running': ran('2026-10-25T04:30:00Z')};
  assert.deepEqual(ids(dueUpdates(at('2026-11-02T09:23:00Z'), missed)), ['crossings', 'street-running', 'station-points', 'branch-lines', 'service-routes', 'traction']);
  // Never run: due.
  assert.ok(ids(dueUpdates(at('2026-11-02T09:23:00Z'), {})).includes('heritage'));
  // A changed builder runs its dataset outside its due time, in run order.
  assert.deepEqual(ids(dueUpdates(at('2026-11-02T09:23:00Z'), recent, {rebuilt: ['heritage', 'conveying']})),
    ['conveying', 'heritage', 'station-points', 'branch-lines', 'service-routes', 'traction']);
});

test('a builder counts as changed only when its own files differ since the last successful run', () => {
  const old = '1'.repeat(40), head = '2'.repeat(40), calls = [];
  const git = (missing, files) => (...args) => {
    calls.push(args.join(' '));
    if (args[0] === 'cat-file' && missing) throw new Error('missing');
    if (args[0] === 'fetch' && missing === 'unreachable') throw new Error('fetch failed');
    return args[0] === 'diff' ? files : '';
  };
  assert.equal(builderChanged(head, head, ['a.mjs'], git(false, 'a.mjs\n')), false, 'same commit: nothing to compare');
  assert.equal(builderChanged(old, head, ['a.mjs'], git(false, '')), false);
  assert.equal(builderChanged(old, head, ['a.mjs'], git(false, 'a.mjs\n')), true);
  assert.ok(calls.at(-1).endsWith('-- a.mjs'), 'the diff is limited to the builder files');
  calls.length = 0;
  assert.equal(builderChanged(old, head, ['a.mjs'], git(true, 'a.mjs\n')), true);
  assert.deepEqual(calls.slice(0, 2), [`cat-file -e ${old}^{commit}`, `fetch --depth=1 origin ${old}`], 'a commit missing from the shallow checkout is fetched alone');
  assert.throws(() => builderChanged(old, head, ['a.mjs'], git('unreachable', '')), /fetch failed/, 'an unreachable commit fails the plan instead of guessing');
  assert.throws(() => builderChanged('bad', head, ['a.mjs'], git(false, '')), /Invalid commit/);
});

test('manual runs choose one dataset or all, in run order, with lifecycle refresh input', () => {
  const now = at('2026-11-04T12:00:00Z');
  assert.deepEqual(dueUpdates(now, {}, {only: 'lifecycle'}), [{id: 'lifecycle', workflow: 'snapshot.yml', inputs: 'refresh=true'}]);
  assert.deepEqual(ids(dueUpdates(now, {}, {only: 'all'})), OSM_UPDATES.map(e => e.id));
  assert.throws(() => dueUpdates(now, {}, {only: 'nonexistent'}), /Unknown dataset/);
  assert.throws(() => dueUpdates(new Date('x'), {}), /Invalid time/);
});

test('the scheduler is the only schedule for these Overpass workflows, and starts each one by dispatch', async () => {
  const scheduler = await readFile(new URL('osm-updates.yml', workflows), 'utf8');
  assert.match(scheduler, /cron: '23 3-23\/6 \* \* \*'/);
  assert.match(scheduler, /group: osm-updates\n\s+cancel-in-progress: false/);
  assert.match(scheduler, /max-parallel: 1\n\s+fail-fast: false/, 'one at a time; a failure does not stop the rest');
  // The slot is released only when GitHub reports the dataset run completed;
  // a failed status request is retried, never read as the end of the run.
  assert.doesNotMatch(scheduler, /gh run watch/);
  assert.match(scheduler, /state=\$\(gh run view "\$run" --json status,conclusion [^\n]*\) \|\| state=''/);
  assert.match(scheduler, /case "\$state" in completed\\ \*\) break;; esac/);
  assert.match(scheduler, /gh run cancel "\$run"/, 'near the time limit the run is cancelled, and still waited for');
  assert.match(scheduler, /\[ "\$conclusion" = success \]/);
  const options = /options: \[([^\]]+)\]/.exec(scheduler)[1].split(',').map(s => s.trim());
  assert.deepEqual(options, ['due', 'all', ...OSM_UPDATES.map(e => e.id)]);
  const push = /  push:\n    branches: \[main\]\n    paths:\n((?:      - .+\n)+)/.exec(scheduler)[1].trim().split('\n').map(line => line.replace(/^\s*- /, ''));
  assert.deepEqual(push, OSM_UPDATE_PATHS, 'a builder change on main starts the scheduler');
  for (const path of ['styles/map-model.mjs', '.github/workflows/aerialways.yml'])
    assert.ok(!OSM_UPDATE_PATHS.includes(path), `${path} changes too often, or only its own timing, to re-download a dataset`);
  const files = new Set(await readdir(workflows));
  for (const {workflow} of OSM_UPDATES) {
    assert.ok(files.has(workflow), workflow);
    const source = await readFile(new URL(workflow, workflows), 'utf8');
    const triggers = source.split(/^permissions:/m)[0];
    assert.doesNotMatch(triggers, /^\s+schedule:/m, `${workflow} must not keep its own schedule`);
    assert.doesNotMatch(triggers, /^\s+push:/m, `${workflow} must not start itself on a push, in parallel with the scheduler`);
    assert.match(triggers, /^  workflow_dispatch:/m, `${workflow} must accept the scheduler's dispatch`);
  }
  const snapshot = await readFile(new URL('snapshot.yml', workflows), 'utf8');
  assert.match(snapshot, /if: github\.event_name == 'schedule' \|\| inputs\.refresh/, 'the dispatched lifecycle run still renews the oldest regions');
});

test('last-run lookup takes the latest successful run of any trigger, and fails on API errors', async t => {
  const {latestRun} = await import('../scripts/osm-update-plan.mjs');
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = {url: String(url), options};
    return {ok: true, json: async () => ({workflow_runs: [
      {event: 'push', run_started_at: '2026-11-02T10:00:00Z', head_sha: 'b'.repeat(40)},
      {event: 'workflow_dispatch', run_started_at: '2026-11-02T03:30:00Z', head_sha: 'c'.repeat(40)}]})};
  };
  assert.deepEqual(await latestRun('o/r', 'token', 'heritage.yml'), {started: '2026-11-02T10:00:00Z', sha: 'b'.repeat(40)}, 'a rebuild after a builder change refreshed the data too');
  assert.match(seen.url, /\/repos\/o\/r\/actions\/workflows\/heritage\.yml\/runs\?branch=main&status=success/);
  assert.equal(seen.options.redirect, 'error');
  globalThis.fetch = async () => ({ok: true, json: async () => ({workflow_runs: []})});
  assert.equal(await latestRun('o/r', 'token', 'heritage.yml'), undefined, 'never succeeded: due');
  globalThis.fetch = async () => ({ok: false, status: 502});
  await assert.rejects(latestRun('o/r', 'token', 'heritage.yml'), /HTTP 502/, 'an API failure fails the plan rather than skipping or running everything');
  globalThis.fetch = async () => ({ok: true, json: async () => ({})});
  await assert.rejects(latestRun('o/r', 'token', 'heritage.yml'), /invalid run list/);
});

test('traction runs every six hours but republishes and redeploys only when its data changed', async () => {
  const workflow = await readFile(new URL('traction-facilities.yml', workflows), 'utf8');
  const publish = workflow.split('- name: Publish validated static facility data')[1].split('- name: Redeploy')[0];
  assert.match(publish, /id: publish/);
  assert.match(publish, /diff -rq -x '\*manifest\.json' \/tmp\/traction-previous\/power power && diff -rq -x '\*manifest\.json' \/tmp\/traction-previous\/signals signals/,
    'only build times in the manifests may differ for an unchanged result');
  assert.match(publish, /echo "changed=false" >> "\$GITHUB_OUTPUT"\n\s+exit 0/);
  assert.ok(publish.indexOf('changed=false') < publish.indexOf('git push --force'), 'an unchanged result is not pushed');
  assert.match(workflow, /- name: Redeploy the site with the new facilities\n\s+if: github\.ref == 'refs\/heads\/main' && steps\.publish\.outputs\.changed == 'true'/);
});
