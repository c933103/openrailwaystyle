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


// Augmented diffs over crossings and the railway ways through them; synthetic.
import * as crossingData from '../scripts/crossing-data.mjs';
import {readFileSync} from 'node:fs';
const osmXml = actions => `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="Overpass API">\n<meta osm_base="2026-11-01T05:00:00Z"/>\n${actions}\n</osm>\n`;
const xmlNode = (id, tags = {railway: 'level_crossing'}) => `<node id="${id}" lat="1" lon="1" version="2">${Object.entries(tags).map(([k, v]) => `<tag k="${k}" v="${v}"/>`).join('')}</node>`;
const xmlWay = (id, nodes) => `<way id="${id}" version="2">${nodes.map(n => `<nd ref="${n}"/>`).join('')}<tag k="railway" v="rail"/></way>`;

test('a crossing\'s changes, and those of the railway ways through it, deletions included, mark what to read again', () => {
  const {timestamp, deleted, affected, recheck} = crossingData.crossingChanges(osmXml([
    '<action type="delete"><old>' + xmlNode(1) + '</old><new><node id="1" visible="false"/></new></action>',
    '<action type="delete"><old>' + xmlNode(2) + '</old><new><node id="2" visible="true"/></new></action>',
    `<action type="modify"><old>${xmlNode(3)}</old><new>${xmlNode(3, {railway: 'crossing'})}</new></action>`,
    `<action type="create">${xmlNode(4)}</action>`,
    // A way deleted through crossings 5 and 1: its old nodes; a way rerouted from 6 to 7.
    `<action type="delete"><old>${xmlWay(50, [5, 1])}</old><new><way id="50" visible="false"/></new></action>`,
    `<action type="modify"><old>${xmlWay(51, [6])}</old><new>${xmlWay(51, [7])}</new></action>`,
  ].join('\n')));
  assert.equal(timestamp, '2026-11-01T05:00:00Z');
  assert.deepEqual(deleted, [1], 'deleted from OSM');
  assert.deepEqual(affected, [2, 3, 4, 5, 6, 7], 'a deleted node is not read again');
  assert.deepEqual(recheck, [2], 'left the selection: moved away or retagged, read again before removing');
  const query = crossingData.crossingChangesQuery([0, 0, 45, 45], '2026-10-01T00:00:00Z');
  assert.equal(query, '[out:xml][timeout:180][maxsize:268435456][adiff:"2026-10-01T00:00:00Z"];(node[railway=level_crossing](0,0,45,45);node[railway=crossing](0,0,45,45);)->.c;(.c;way(bn.c)[railway];);out meta;');
  // The rows of given ids: the same minor logic and markers as a region query.
  const rows = crossingData.crossingRowsQuery([3, 4]), region = crossingData.regionQuery([0, 0, 45, 45]);
  assert.ok(rows.includes('node(id:3,4)[railway~"^(level_crossing|crossing)$"]->.c;'));
  assert.equal(rows.slice(rows.indexOf('->.c;')), region.slice(region.indexOf('->.c;')));
  assert.throws(() => crossingData.crossingRowsQuery([]), /Invalid/);
  assert.throws(() => crossingData.crossingChangesQuery([0, 0, 1, 1], 'yesterday'), /Invalid/);
});

async function changeRun(t, extra = {}) {
  const {mkdtemp, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os');
  const {join} = await import('node:path');
  const zlib = await import('node:zlib');
  const vm = (await import('node:vm')).default;
  const checkpoints = await import('../scripts/crossing-checkpoint.mjs');
  const previous = await mkdtemp(join(tmpdir(), 'crossing-changes-'));
  t.after(() => rm(previous, {recursive: true, force: true}));
  const since = '2026-10-01T00:00:00Z', roots = crossingData.startRegions();
  await writeFile(join(previous, 'regions.json'), JSON.stringify({version: 3, since, regions: roots.map(r => ({...r, fetched: since})), ...extra, reply: undefined}));
  await writeFile(join(previous, 'crossings.tsv.gz'), zlib.gzipSync('1\t-80\t-170\troad\t\n2\t-80\t-169\troad\t\n'));
  const SEP = crossingData.SEP, calls = [];
  const csv = rows => rows.map(r => r.join(SEP)).join('\n') + `\n${SEP}${SEP}${SEP}minor\n${SEP}${SEP}${SEP}end\n`;
  const source = readFileSync(new URL('../scripts/build-crossings.mjs', import.meta.url), 'utf8');
  const fs = await import('node:fs/promises');
  const context = vm.createContext({
    process: {env: {OVERPASS_URL: 'https://overpass.fixture.invalid/api/interpreter', PREVIOUS_DATA: previous}},
    URL, URLSearchParams, Buffer, AbortSignal: {timeout: () => undefined},
    console: {log() {}, warn() {}}, setTimeout: callback => callback(),
    fetch: async (url, request) => {
      const query = request.body.get('data'); calls.push(query);
      assert.ok(calls.length <= 40);
      // The first region: crossing 1 deleted, a way through crossing 2 changed.
      if (extra.reply) { const answer = extra.reply(query, roots, since); if (answer) return answer; }
      if (query === crossingData.crossingChangesQuery(roots[0].box, since)) return new Response(osmXml([
        '<action type="delete"><old/><new><node id="1" visible="false"/></new></action>',
        `<action type="modify"><old>${xmlWay(60, [2])}</old><new>${xmlWay(60, [2, 3])}</new></action>`].join('\n')));
      if (query.startsWith('[out:csv')) return new Response(csv([[2, -80, -169, 'level_crossing']]));
      return new Response(osmXml(''));
    },
  });
  const dependencies = {'node:fs/promises': {...fs, rm: async () => { throw new Error('no output expected'); }}, 'node:zlib': zlib,
    './crossing-data.mjs': crossingData, './crossing-checkpoint.mjs': checkpoints};
  const module = new vm.SourceTextModule(source, {context, initializeImportMeta: meta => { meta.url = 'file:///fixture/scripts/build-crossings.mjs'; }});
  await module.link(specifier => {
    const values = dependencies[specifier]; assert.ok(values, specifier);
    return new vm.SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, {context});
  });
  let error;
  try { await module.evaluate(); } catch (caught) { error = caught; }
  return {error, calls, roots, since};
}

test('the builder applies a region\'s changes and reads the affected crossings again, with no scheduled full download', async t => {
  const {error, calls, roots, since} = await changeRun(t, {extraction: crossingData.crossingExtraction()});
  // The tiny fixture stops at the worldwide size guard, before any output.
  assert.match(error?.message || '', /Suspiciously few crossings worldwide: 1/, 'crossing 1 removed, crossing 2 kept');
  assert.equal(calls[0], crossingData.crossingChangesQuery(roots[0].box, since));
  assert.equal(calls[1], crossingData.crossingRowsQuery([2, 3]), 'the crossings on the changed way, read again');
  assert.deepEqual(calls.slice(2), roots.slice(1).map(r => crossingData.crossingChangesQuery(r.box, since)), 'every other region\'s changes; nothing downloaded in full');
});

test('a table made by another query or row code, or kept by the earlier change query, is rebuilt in full once', async t => {
  const other = await changeRun(t, {extraction: 'another'});
  assert.equal(other.calls[0], crossingData.regionQuery(other.roots[0].box), 'a full download, no change request');
  const legacy = await changeRun(t);
  assert.equal(legacy.calls[0], crossingData.regionQuery(legacy.roots[0].box), 'no recorded extraction: rebuilt, since the earlier changes missed deletions');
  assert.equal(crossingData.crossingExtraction(), crossingData.crossingExtraction());
  const workflow = readFileSync(new URL('../.github/workflows/crossings.yml', import.meta.url), 'utf8');
  assert.match(workflow, /saved\.version === 3 && saved\.extraction === crossingExtraction\(\)/, 'the workflow decides as the builder');
  const builder = readFileSync(new URL('../scripts/build-crossings.mjs', import.meta.url), 'utf8');
  assert.match(builder, /JSON\.stringify\(\{version: VERSION, extraction, since:/);
});

test('a crossing that left a region is read again: kept if it is still a crossing elsewhere, removed if not', async t => {
  const extraction = crossingData.crossingExtraction();
  for (const [stillCrossing, expected] of [[true, /worldwide: 2/], [false, /worldwide: 1/]]) {
    const {error, calls, roots, since} = await changeRun(t, {extraction, reply: (query, roots, since) => {
      if (query === crossingData.crossingChangesQuery(roots[0].box, since))
        return new Response(osmXml('<action type="delete"><old/><new><node id="2" visible="true"/></new></action>'));
      if (query === crossingData.crossingRowsQuery([2]))
        return new Response(stillCrossing ? `2${crossingData.SEP}10${crossingData.SEP}10${crossingData.SEP}level_crossing\n${crossingData.SEP}${crossingData.SEP}${crossingData.SEP}minor\n${crossingData.SEP}${crossingData.SEP}${crossingData.SEP}end\n`
          : `${crossingData.SEP}${crossingData.SEP}${crossingData.SEP}minor\n${crossingData.SEP}${crossingData.SEP}${crossingData.SEP}end\n`);
      return null;
    }});
    assert.equal(calls[1], crossingData.crossingRowsQuery([2]), 'read again by id');
    assert.match(error?.message || '', expected, stillCrossing ? 'moved into another region: kept' : 'no crossing any more: removed');
  }
});
