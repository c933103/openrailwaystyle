import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collect, dayWindow, GUIDANCE, summarize, usageRecords, usageReport} from '../scripts/upstream-usage.mjs';

const line = (usage, time = '2026-11-05T06:00:00.1234567Z') => `${time} OVERPASS_USAGE ${JSON.stringify(usage)}`;
const usage = (hosts, extra = {}) => ({script: 's.mjs', bytes: 0, requests: 0, unread: 0, unmeasured: 0, hosts, ...extra});

test('only the meter lines of a job log are records', () => {
  const log = [
    '2026-11-05T06:00:00.0000000Z ##[group]Run node --import ./scripts/overpass-meter.mjs scripts/build.mjs',
    '2026-11-05T06:00:01.0000000Z echo OVERPASS_USAGE is printed on exit',
    line(usage({'overpass-api.de': {bytes: 1000, requests: 2, skipped: 1}})),
    '2026-11-05T06:00:02.0000000Z `OVERPASS_USAGE {"script":"summary copy","hosts":{}}`',
    '2026-11-05T06:00:03.0000000Z OVERPASS_USAGE {"script":"cut',
    'OVERPASS_USAGE {"script":"no time","hosts":{}}',
    line(usage({'download.geofabrik.de': {bytes: 5, requests: 3}})),
  ].join('\n');
  const records = usageRecords(log);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(r => Object.keys(r.hosts)[0]), ['overpass-api.de', 'download.geofabrik.de']);
});

test('the day totals per host and per workflow, with every job counted once per host', () => {
  const jobs = [
    {workflow: 'Heritage', records: [usage({'overpass-api.de': {bytes: 3e6, requests: 4, skipped: 2}})]},
    {workflow: 'Heritage', records: [usage({'overpass-api.de': {bytes: 1e6, requests: 1}}), usage({'overpass-api.de': {bytes: 1e6, requests: 1}})]},
    {workflow: 'Extracts', records: [usage({'download.geofabrik.de': {bytes: 8e9, requests: 3}, 'overpass-api.de': {bytes: 0, requests: 1}})]},
  ];
  const summary = summarize(jobs);
  assert.deepEqual(summary.hosts['overpass-api.de'], {requests: 7, bytes: 5e6, skipped: 2, jobs: 3});
  assert.deepEqual(summary.hosts['download.geofabrik.de'], {requests: 3, bytes: 8e9, skipped: 0, jobs: 1});
  assert.deepEqual(summary.workflows.map(w => `${w.host} ${w.workflow} ${w.requests} ${w.jobs}`),
    ['download.geofabrik.de Extracts 3 1', 'overpass-api.de Heritage 6 2', 'overpass-api.de Extracts 1 1']);
  const report = usageReport({start: '2026-11-05T05:00:00Z', end: '2026-11-06T05:00:00Z', runs: 4, jobs: 3, unread: [99]}, summary);
  assert.match(report, /\| overpass-api\.de \| 7 \| 5\.0 \| 2 \| 3 \| one-off: 0\.1% of queries, 0\.5% of bytes; regular use: 7%, 50% \|/);
  assert.match(report, /\| download\.geofabrik\.de \| 3 \| 8000\.0 \| 0 \| 1 \| — \|/);
  assert.match(report, /4 workflow runs; 3 jobs with usage lines; 1 job logs could not be read: 99/);
  assert.deepEqual(GUIDANCE['overpass-api.de'].regular, {requests: 100, bytes: 1e7});
});

test('a day runs from 05:00 UTC to 05:00 UTC; by default the one that ended last', () => {
  assert.deepEqual(dayWindow('2026-11-05'), {start: '2026-11-05T05:00:00Z', end: '2026-11-06T05:00:00Z'});
  assert.deepEqual(dayWindow('', new Date('2026-11-09T05:47:00Z')), {start: '2026-11-08T05:00:00Z', end: '2026-11-09T05:00:00Z'});
  // Before 05:00 the day that ended last is the one before: never a day still running.
  assert.deepEqual(dayWindow('', new Date('2026-11-09T04:00:00Z')), {start: '2026-11-07T05:00:00Z', end: '2026-11-08T05:00:00Z'});
  assert.throws(() => dayWindow('2026-13-40'), /Invalid date/);
  assert.throws(() => dayWindow('yesterday'), /Invalid date/);
});

test('every run, every attempt and every job log of the day is read; a log that cannot be read is listed', async () => {
  const asked = [];
  const runs = Array.from({length: 101}, (_, i) => ({id: i + 1, name: i ? 'Other' : 'Heritage'}));
  const fetcher = async url => {
    const path = url.replace('https://api.github.com', '');
    asked.push(path);
    let m;
    if ((m = /\/actions\/runs\?created=([^&]+)&per_page=100&page=(\d+)$/.exec(path))) {
      assert.equal(m[1], '2026-11-05T05:00:00Z..2026-11-06T05:00:00Z');
      return Response.json({workflow_runs: runs.slice((m[2] - 1) * 100, m[2] * 100)});
    }
    if ((m = /\/actions\/runs\/(\d+)\/jobs\?filter=all&per_page=100&page=1$/.exec(path))) {
      const run = Number(m[1]);
      return Response.json({jobs: run === 1 ? [{id: 10, status: 'completed'}, {id: 11, status: 'completed'}, {id: 12, status: 'in_progress'}, {id: 13, status: 'completed', conclusion: 'skipped'}] : run === 2 ? [{id: 20, status: 'completed'}] : []});
    }
    if (path.endsWith('/actions/jobs/10/logs')) return new Response(line(usage({'overpass-api.de': {bytes: 10, requests: 1}})));
    if (path.endsWith('/actions/jobs/11/logs')) return new Response(line(usage({'overpass-api.de': {bytes: 20, requests: 2}}), '2026-11-05T07:00:00Z'));
    if (path.endsWith('/actions/jobs/20/logs')) return new Response('gone', {status: 410});
    throw new Error(`unexpected ${path}`);
  };
  const result = await collect({repo: 'o/r', ...dayWindow('2026-11-05'), fetcher});
  assert.equal(result.runs, 101, 'the second page of runs is read');
  assert.deepEqual(result.jobs.map(j => [j.workflow, j.job]), [['Heritage', 10], ['Heritage', 11]]);
  assert.deepEqual(result.unread, [20]);
  assert.ok(!asked.some(path => path.includes('/jobs/12/')), 'a job still running is not read');
  assert.ok(!asked.some(path => path.includes('/jobs/13/')), 'a skipped job has no log and is not counted as unreadable');
  assert.ok(asked.every(path => !path.includes('jobs?') || path.includes('filter=all')), 're-run attempts are included');
});

test('the workflow runs daily, reads only, and keeps its report', () => {
  const workflow = readFileSync(new URL('../.github/workflows/upstream-usage.yml', import.meta.url), 'utf8');
  assert.match(workflow, /cron: '47 5 \* \* \*'/);
  assert.match(workflow, /permissions:\n  actions: read\n  contents: read\n/);
  assert.doesNotMatch(workflow, /write/);
  assert.doesNotMatch(workflow, /overpass-meter/, 'it asks no data provider');
  assert.match(workflow, /USAGE_DATE: \$\{\{ inputs\.date \}\}/);
  assert.match(workflow, /path: \|\n\s+usage\.md\n\s+usage\.json/);
});
