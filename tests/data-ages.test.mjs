import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DATASETS, STALE_AFTER_DAYS, datasetDate, dataAges} from '../scripts/data-ages.mjs';
import {dataAgeRows, staleNotice} from '../styles/data-ages.mjs';

const now = new Date('2026-11-02T12:00:00Z');
const files = map => async path => { const key = Object.keys(map).find(k => path.endsWith(k)); if (key === undefined) throw Object.assign(new Error('missing'), {code: 'ENOENT'}); return map[key]; };

test('the OSM database time is preferred over build times', () => {
  assert.deepEqual(datasetDate({generated: '2026-11-02T04:11:14Z', osmBase: '2026-11-02T04:07:59Z'}), {date: '2026-11-02T04:07:59.000Z', field: 'osmBase'});
  assert.deepEqual(datasetDate({built: '2026-10-30T11:09:50.636Z'}), {date: '2026-10-30T11:09:50.636Z', field: 'built'});
  assert.deepEqual(datasetDate({generated: 'not a date', built: '2026-10-30T00:00:00Z'}), {date: '2026-10-30T00:00:00.000Z', field: 'built'});
  assert.deepEqual(datasetDate({complete: false}), {date: null, field: null});
});

test('a cycle that fetches regions over weeks is dated by its start, a multi-source build by its oldest source', () => {
  // station-points-data and mainline-data manifests, as published on 2026-11-02.
  assert.deepEqual(datasetDate({started: '2026-10-11T09:59:10.212Z', updated: '2026-11-02T16:13:13.924Z'}), {date: '2026-10-11T09:59:10.212Z', field: 'started'});
  assert.deepEqual(datasetDate({sourceDate: '2026-10-23', oldestSource: '2026-10-23T20:20:51.000Z', generated: '2026-10-25T15:15:44.954Z'}), {date: '2026-10-23T20:20:51.000Z', field: 'oldestSource'});
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

test('the page counts the age when it is viewed, so a site that is not rebuilt still shows its data as old', () => {
  const ages = {schema: 1, staleAfterDays: 90, datasets: [
    {label: 'Level crossings', date: '2026-11-01T18:01:42.186Z', stale: false},
    {label: 'Station points', date: null, stale: false},
  ]};
  assert.deepEqual(dataAgeRows(ages, new Date('2026-11-03T12:00:00Z')).map(r => [r.text, r.stale]), [['2026-11-01 (1 day ago)', false], ['not published yet', false]]);
  // The same file, viewed two years later: the build-time flag said "not stale".
  const later = dataAgeRows(ages, new Date('2028-11-03T12:00:00Z'));
  assert.deepEqual(later.map(r => r.stale), [true, false]);
  assert.match(later[0].text, /^2026-11-01 \(732 days ago\)$/);
  assert.match(staleNotice(later, 90), /^One dataset is more than 90 days old: Level crossings\. .*rather than none/);
  assert.equal(staleNotice(dataAgeRows(ages, new Date('2026-11-03T12:00:00Z')), 90), '');
  assert.equal(dataAgeRows({...ages, datasets: [{label: 'x', date: '2026-11-03T11:00:00Z'}]}, new Date('2026-11-03T12:00:00Z'))[0].text, '2026-11-03 (today)');
  assert.throws(() => dataAgeRows({schema: 2, datasets: []}), /Unknown data dates file/);
  assert.throws(() => dataAgeRows(null), /Unknown data dates file/);
});

test('exactly the threshold is not stale; one day more is', () => {
  const at = days => dataAgeRows({schema: 1, staleAfterDays: 90, datasets: [{label: 'x', date: '2026-01-01T00:00:00Z'}]}, new Date(Date.parse('2026-01-01T00:00:00Z') + days * 86400000))[0].stale;
  assert.equal(at(90), false);
  assert.equal(at(91), true);
});

test('site.yml records the data dates after all data is assembled, before the size check; Help and the service worker carry the module', () => {
  const workflow = readFileSync(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  const record = workflow.indexOf('run: node scripts/data-ages.mjs styles'), size = workflow.indexOf('run: node scripts/check-site-size.mjs styles');
  const lastData = Math.max(workflow.indexOf('name: Load worldwide railway signals and energy supplies'), workflow.indexOf('styles/data/station-points/manifest.json'));
  assert.ok(lastData > 0 && record > lastData && size > record);
  const html = readFileSync(new URL('../styles/index.html', import.meta.url), 'utf8');
  assert.match(html, /<a href="#help-data-dates">Data dates<\/a>/);
  assert.match(html, /<table id="data-ages"/);
  assert.match(readFileSync(new URL('../styles/sw.js', import.meta.url), 'utf8'), /'data-ages\.mjs'/);
  assert.match(readFileSync(new URL('../styles/app.mjs', import.meta.url), 'utf8'), /from '\.\/data-ages\.mjs\?v=/);
});

test('every dataset the site deploys with a manifest is listed', () => {
  const workflow = readFileSync(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
  for (const {manifest} of DATASETS) {
    // data/<dataset>/…: traction-data is unpacked whole into data/traction.
    const dir = manifest.split('/').slice(0, 2).join('/');
    assert.ok(manifest === 'data/manifest.json' ? workflow.includes('cp lifecycle-data/manifest.json styles/data/') : workflow.includes(`styles/${dir}`), manifest);
  }
});
