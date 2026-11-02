import test from 'node:test';
import assert from 'node:assert/strict';
import {DATASETS, STALE_AFTER_DAYS, datasetDate, dataAges} from '../scripts/data-ages.mjs';

const now = new Date('2026-11-02T12:00:00Z');
const files = map => async path => { const key = Object.keys(map).find(k => path.endsWith(k)); if (key === undefined) throw Object.assign(new Error('missing'), {code: 'ENOENT'}); return map[key]; };

test('the OSM database time is preferred over build times', () => {
  assert.deepEqual(datasetDate({generated: '2026-11-02T04:11:14Z', osmBase: '2026-11-02T04:07:59Z'}), {date: '2026-11-02T04:07:59.000Z', field: 'osmBase'});
  assert.deepEqual(datasetDate({built: '2026-10-30T11:09:50.636Z'}), {date: '2026-10-30T11:09:50.636Z', field: 'built'});
  assert.deepEqual(datasetDate({generated: 'not a date', built: '2026-10-30T00:00:00Z'}), {date: '2026-10-30T00:00:00.000Z', field: 'built'});
  assert.deepEqual(datasetDate({complete: false}), {date: null, field: null});
});

test('every dataset is listed; a missing manifest is listed without a date, never guessed', async () => {
  const ages = await dataAges('styles', {now, read: files({'data/manifest.json': '{"built":"2026-10-30T11:09:50Z"}'})});
  assert.deepEqual(ages.datasets.map(d => d.id), DATASETS.map(d => d.id));
  assert.equal(ages.datasets[0].date, '2026-10-30T11:09:50.000Z');
  assert.ok(ages.datasets.slice(1).every(d => d.date === null && d.stale === false));
});

test('data older than the threshold is marked stale, and still listed', async () => {
  const old = new Date(now - (STALE_AFTER_DAYS + 1) * 86400_000).toISOString(), recent = new Date(now - (STALE_AFTER_DAYS - 1) * 86400_000).toISOString();
  const ages = await dataAges('styles', {now, read: files({'data/manifest.json': JSON.stringify({built: old}), 'level-crossings/manifest.json': JSON.stringify({generated: recent})})});
  assert.equal(ages.datasets.find(d => d.id === 'lifecycle').stale, true);
  assert.equal(ages.datasets.find(d => d.id === 'level-crossings').stale, false);
  assert.equal(ages.staleAfterDays, STALE_AFTER_DAYS);
});

test('an unreadable manifest stops the build instead of hiding the dataset', async () => {
  await assert.rejects(dataAges('styles', {now, read: files({'data/manifest.json': '{broken'})}), /data\/manifest\.json/);
});
