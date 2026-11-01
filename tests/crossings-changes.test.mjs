import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startRegions, regionKey, updateRegionChanges} from '../scripts/crossing-data.mjs';

const regions = startRegions(), keys = regions.map(r => regionKey(r.box));
const down = box => new Error(`Overpass stayed unavailable for region ${box}`);
const OLD = '2026-10-16T05:24:13Z', NOW = '2026-11-01T00:00:00Z';

test('a region Overpass stayed unavailable for keeps its time; the others advance', async () => {
  const asked = [], warnings = [];
  const result = await updateRegionChanges({regions, since: OLD, startedAt: NOW, warn: (...a) => warnings.push(a.join(' ')),
    fetch: async (region, from) => { asked.push([regionKey(region.box), from]); if (regionKey(region.box) === '0,0,45,45') throw down(region.box); }});
  assert.deepEqual(asked.map(([key]) => key), keys, 'each region once, from the shared time');
  assert.ok(asked.every(([, from]) => from === OLD));
  assert.deepEqual(result.deferred, ['0,0,45,45']);
  assert.equal(result.changes['0,0,45,45'], OLD);
  assert.ok(keys.filter(k => k !== '0,0,45,45').every(k => result.changes[k] === NOW));
  assert.equal(result.since, OLD, 'the oldest time is kept as the table\'s');
  assert.equal(result.from, OLD);
  assert.equal(result.stopped, false);
  assert.match(warnings[0], /0,0,45,45 deferred/);
  // Next run: the deferred region is asked first, from its own time.
  const next = [];
  const again = await updateRegionChanges({regions, changes: result.changes, since: result.since, startedAt: '2026-11-01T06:00:00Z',
    fetch: async (region, from) => { next.push([regionKey(region.box), from]); }});
  assert.deepEqual(next[0], ['0,0,45,45', OLD]);
  assert.ok(next.slice(1).every(([, from]) => from === NOW));
  assert.deepEqual(again.deferred, []);
  assert.equal(again.since, '2026-11-01T06:00:00Z');
});

test('two unavailable regions in a row: the rest wait without a request', async () => {
  const asked = [];
  const result = await updateRegionChanges({regions, since: OLD, startedAt: NOW, warn: () => {},
    fetch: async region => { asked.push(regionKey(region.box)); if (asked.length > 1) throw down(region.box); }});
  assert.equal(asked.length, 3);
  assert.equal(result.stopped, true);
  assert.deepEqual(result.deferred, keys.slice(1));
  assert.equal(result.changes[keys[0]], NOW);
  assert.ok(keys.slice(1).every(k => result.changes[k] === OLD));
  // A success in between resets the count.
  let n = 0;
  const mixed = await updateRegionChanges({regions, since: OLD, startedAt: NOW, warn: () => {},
    fetch: async region => { n++; if (n % 2) throw down(region.box); }});
  assert.equal(mixed.stopped, false);
  assert.equal(mixed.deferred.length, keys.length / 2);
});

test('nothing fetched stops the run; other errors are not deferred', async () => {
  await assert.rejects(updateRegionChanges({regions: regions.slice(0, 1), since: OLD, startedAt: NOW, warn: () => {},
    fetch: async region => { throw down(region.box); }}), /every region; nothing to publish/);
  await assert.rejects(updateRegionChanges({regions, since: OLD, startedAt: NOW,
    fetch: async () => { throw new Error('Download budget exceeded'); }}), /budget/);
  await assert.rejects(updateRegionChanges({regions, since: OLD, startedAt: NOW,
    fetch: async region => { throw new Error(`Could not fetch region ${region.box}`); }}), /Could not fetch/);
});

test('the workflow publishes the other regions\' changes and then ends red for the deferred ones', async () => {
  const workflow = await readFile(new URL('../.github/workflows/crossings.yml', import.meta.url), 'utf8');
  const publish = workflow.indexOf('- name: Publish complete data snapshot'), retry = workflow.indexOf('- name: Retry deferred regions in the next run');
  assert.ok(publish > 0 && retry > publish, 'publish first, then fail');
  assert.match(workflow.slice(retry), /if: steps\.update\.outputs\.deferred != '' && steps\.update\.outputs\.deferred != '0'[\s\S]*exit 1/);
  const builder = await readFile(new URL('../scripts/build-crossings.mjs', import.meta.url), 'utf8');
  assert.match(builder, /`deferred=\$\{deferred\.length\}\\n`/);
});
