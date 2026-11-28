import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = name => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
// The cron entries of a workflow's `schedule`, as [minute, hour, day, month, weekday].
const crons = text => [...text.slice(0, text.indexOf('\njobs:')).matchAll(/- cron: '([^']+)'/g)].map(m => m[1].trim().split(/\s+/));

test('the Geofabrik region extracts refresh monthly, on a day apart from the mainline reference download, and stay runnable by hand', () => {
  const extract = read('osm-extract.yml');
  const schedule = crons(extract);
  assert.equal(schedule.length, 1, 'one monthly run');
  const [minute, hour, day, month, weekday] = schedule[0];
  assert.match(minute, /^\d+$/); assert.match(hour, /^\d+$/);
  assert.match(day, /^\d+$/, 'a fixed day of the month');
  assert.ok(Number(day) >= 1 && Number(day) <= 28, 'a day every month has');
  assert.deepEqual([month, weekday], ['*', '*'], 'every month, whatever the weekday');
  assert.notEqual(minute, '0', 'off the hour, where scheduled runs are delayed most');
  // The mainline reference downloads every Geofabrik continent monthly: not on the same day.
  const mainline = crons(read('mainline-reference.yml'));
  assert.ok(mainline.length, 'the mainline reference has its own monthly schedule');
  for (const [, , mainlineDay] of mainline) assert.notEqual(day, mainlineDay, 'not on the mainline reference day');
  // A scheduled run has no inputs; a run by hand keeps all three.
  for (const input of ['source_date', 'gaps_only', 'region_ids']) assert.match(extract, new RegExp(`\\n  workflow_dispatch:\\n[\\s\\S]*\\n      ${input}:\\n`), input);
  // The rollout assembles after every completed extract run, scheduled or by hand.
  assert.match(read('extract-rollout.yml'), /workflow_run:\n\s+workflows: \[Geofabrik region extracts\]\n\s+types: \[completed\]/);
});
