// One day's requests and bytes to each upstream host, summed from the
// OVERPASS_USAGE lines every metered job prints (scripts/overpass-meter.mjs),
// across all workflow runs of the day (#330, B6). Read-only: it asks only
// api.github.com, for the runs, their jobs (every attempt) and the job logs.
//   node scripts/upstream-usage.mjs [YYYY-MM-DD]
// The day runs from 05:00 UTC on that date to 05:00 UTC the next day (the
// window of the daily sums on #330). By default it is the day that ended
// at least 24 hours ago: every job has at most 6 hours, so all of that day's
// jobs have finished. A job still running is listed, and the report marked
// incomplete, never silently left out.
// It writes usage.md and usage.json, and the Markdown to the step summary.
import {appendFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// overpass-api.de's published guidance (wiki "Overpass API", Public Overpass
// API instances): one-off use under 10,000 queries and 1 GB a day; regular
// use a hundredth of that.
export const GUIDANCE = Object.freeze({'overpass-api.de': {oneOff: {requests: 10_000, bytes: 1e9}, regular: {requests: 100, bytes: 1e7}}});

// The usage records in one job log: lines `<time> OVERPASS_USAGE {json}`.
// The step summary's copy and a command echoing the name are not records.
export function usageRecords(log) {
  const records = [];
  for (const line of String(log).split('\n')) {
    const m = /^\d{4}-\d\d-\d\dT[\d:.]+Z OVERPASS_USAGE (\{.*\})\s*$/.exec(line);
    if (!m) continue;
    try {
      const record = JSON.parse(m[1]);
      if (record && typeof record.hosts === 'object') records.push(record);
    } catch { /* a cut line: not counted */ }
  }
  return records;
}

// Totals per host, and per workflow and host.
export function summarize(jobs) {
  const hosts = new Map(), workflows = new Map();
  const add = (map, key, usage) => {
    const total = map.get(key) || {requests: 0, bytes: 0, skipped: 0, jobs: 0};
    total.requests += usage.requests || 0; total.bytes += usage.bytes || 0; total.skipped += usage.skipped || 0;
    map.set(key, total);
    return total;
  };
  for (const job of jobs) for (const record of job.records) for (const [host, usage] of Object.entries(record.hosts)) {
    add(hosts, host, usage);
    add(workflows, `${job.workflow}\u0000${host}`, usage);
  }
  for (const job of jobs) {
    const seen = new Set(job.records.flatMap(r => Object.keys(r.hosts)));
    for (const host of seen) { hosts.get(host).jobs++; workflows.get(`${job.workflow}\u0000${host}`).jobs++; }
  }
  return {
    hosts: Object.fromEntries([...hosts].sort(([a], [b]) => a.localeCompare(b))),
    workflows: [...workflows].map(([key, total]) => { const [workflow, host] = key.split('\u0000'); return {workflow, host, ...total}; })
      .sort((a, b) => a.host.localeCompare(b.host) || b.bytes - a.bytes || a.workflow.localeCompare(b.workflow)),
  };
}

const MB = 1e6;
export function usageReport({start, end, runs, jobs, unread, unfinished = []}, summary) {
  const lines = [`# Upstream usage ${start.slice(0, 16)} → ${end.slice(0, 16)} UTC`, '',
    ...(unfinished.length ? [`**Incomplete:** ${unfinished.length} jobs of this day were still running and are not counted (${unfinished.slice(0, 20).join(', ')}). Run this date again once they finish.`, ''] : []),
    `- ${runs} workflow runs; ${jobs} jobs with usage lines${unread.length ? `; ${unread.length} job logs could not be read: ${unread.slice(0, 20).join(', ')}` : ''}`, '',
    '| Host | Requests | MB | Held back (meter pause) | Jobs | Against the guidance |', '| --- | ---: | ---: | ---: | ---: | --- |'];
  for (const [host, t] of Object.entries(summary.hosts)) {
    const g = GUIDANCE[host];
    const against = g ? `one-off: ${(100 * t.requests / g.oneOff.requests).toFixed(1)}% of queries, ${(100 * t.bytes / g.oneOff.bytes).toFixed(1)}% of bytes; regular use: ${(100 * t.requests / g.regular.requests).toFixed(0)}%, ${(100 * t.bytes / g.regular.bytes).toFixed(0)}%` : '—';
    lines.push(`| ${host} | ${t.requests} | ${(t.bytes / MB).toFixed(1)} | ${t.skipped} | ${t.jobs} | ${against} |`);
  }
  lines.push('', '| Workflow | Host | Requests | MB | Held back | Jobs |', '| --- | --- | ---: | ---: | ---: | ---: |');
  for (const w of summary.workflows) lines.push(`| ${w.workflow} | ${w.host} | ${w.requests} | ${(w.bytes / MB).toFixed(1)} | ${w.skipped} | ${w.jobs} |`);
  lines.push('', 'The meter cannot tell one-off downloads from routine change updates; the workflow rows show which runs the bytes came from.');
  return `${lines.join('\n')}\n`;
}

export function dayWindow(date, now = new Date()) {
  const day = date || new Date(now.getTime() - 53 * 3600_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d\d-\d\d$/.test(day) || !Number.isFinite(Date.parse(day))) throw new Error(`Invalid date ${date}`);
  const start = new Date(`${day}T05:00:00Z`), end = new Date(start.getTime() + 86400_000);
  const iso = date => date.toISOString().replace('.000Z', 'Z');
  return {start: iso(start), end: iso(end)};
}

// A job list page of 30: GitHub answered 502 after about 10 s for page 2
// of a 303-job run at 100 a page, and in about 1.4 s at 30 (2026-11-10).
export const JOBS_PER_PAGE = 30;
export const RETRY_MS = 15_000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A server error (5xx) is asked once more after a pause; anything else, or a
// second failure, stops the sum rather than leave the day short.
async function github(path, {token, fetcher = fetch, text = false, wait = sleep} = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher(`https://api.github.com${path}`, {headers: {Accept: 'application/vnd.github+json', 'User-Agent': 'RailwayAtlas-usage/1', ...(token ? {Authorization: `Bearer ${token}`} : {})}});
    if (response.ok) return text ? response.text() : response.json();
    if (response.status >= 500 && attempt === 0) { await wait(RETRY_MS); continue; }
    throw new Error(`GitHub ${path}: HTTP ${response.status}`);
  }
}

export async function collect({repo, start, end, token, fetcher = fetch, wait = sleep}) {
  const runs = [];
  for (let page = 1; ; page++) {
    const {workflow_runs: batch} = await github(`/repos/${repo}/actions/runs?created=${start}..${end}&per_page=100&page=${page}`, {token, fetcher, wait});
    runs.push(...batch);
    if (batch.length < 100) break;
  }
  const jobs = [], unread = [], unfinished = [];
  for (const run of runs) {
    for (let page = 1; ; page++) {
      const {jobs: batch} = await github(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=all&per_page=${JOBS_PER_PAGE}&page=${page}`, {token, fetcher, wait});
      for (const job of batch) {
        // A skipped job, or one cancelled before its first step, never ran
        // and has no log (HTTP 404); it used nothing.
        if (job.status !== 'completed') { unfinished.push(job.id); continue; }
        if (job.conclusion === 'skipped' || !job.steps?.length) continue;
        try {
          const records = usageRecords(await github(`/repos/${repo}/actions/jobs/${job.id}/logs`, {token, fetcher, text: true, wait}));
          if (records.length) jobs.push({workflow: run.name, run: run.id, job: job.id, records});
        } catch { unread.push(job.id); }
      }
      if (batch.length < JOBS_PER_PAGE) break;
    }
  }
  return {runs: runs.length, jobs, unread, unfinished};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const {start, end} = dayWindow(process.argv[2] || process.env.USAGE_DATE || '');
  const repo = process.env.GITHUB_REPOSITORY || 'c933103/openrailwaystyle';
  const collected = await collect({repo, start, end, token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN});
  const summary = summarize(collected.jobs);
  const markdown = usageReport({start, end, runs: collected.runs, jobs: collected.jobs.length, unread: collected.unread, unfinished: collected.unfinished}, summary);
  await writeFile('usage.md', markdown);
  await writeFile('usage.json', `${JSON.stringify({start, end, complete: !collected.unfinished.length, runs: collected.runs, unread: collected.unread, unfinished: collected.unfinished, ...summary}, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  process.stdout.write(markdown);
}
