import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {settings} from '../scripts/data-source.mjs';
import {advancedWatermarks, selectedWatermarks} from '../scripts/extract-pages-handoff.mjs';

const OLD = '2026-11-15T21:22:28Z', NEW = '2026-12-15T21:22:28Z';
const marker = (dataset, osmTimestamp, fields = {}) => JSON.stringify({
  dataset, source: 'extract', schema: 1, complete: true, osmTimestamp, ...fields,
});

test('only selected complete extracts are eligible, including repository overrides', async () => {
  const chosen = settings({lifecycle: 'extract', 'branch-lines': 'overpass', heritage: 'extract'},
    {lifecycle: 'overpass', 'branch-lines': 'extract'});
  const reads = [];
  const result = await selectedWatermarks(chosen, async branch => {
    reads.push(branch);
    return branch === 'branch-lines-extract-data' ? marker('branch-lines', NEW) : marker('heritage', NEW, {complete: false});
  });
  assert.deepEqual(reads.sort(), ['branch-lines-extract-data', 'heritage-extract-data']);
  assert.deepEqual(result, {heritage: null, 'branch-lines': NEW});
});

test('first complete and advancing watermarks trigger; equal, regressed or incomplete do not', () => {
  assert.deepEqual(advancedWatermarks({lifecycle: OLD, 'branch-lines': null}, {lifecycle: NEW, 'branch-lines': OLD}),
    [{id: 'lifecycle', before: OLD, after: NEW}, {id: 'branch-lines', before: null, after: OLD}]);
  assert.deepEqual(advancedWatermarks({lifecycle: OLD}, {lifecycle: OLD}), []);
  assert.deepEqual(advancedWatermarks({lifecycle: NEW}, {lifecycle: OLD}), []);
  assert.deepEqual(advancedWatermarks({lifecycle: OLD}, {lifecycle: null}), []);
});

test('a missing or wrong marker cannot promote a dataset and transport failures fail closed', async () => {
  const chosen = {lifecycle: {source: 'extract'}};
  assert.deepEqual(await selectedWatermarks(chosen, async () => null), {lifecycle: null});
  assert.deepEqual(await selectedWatermarks(chosen, async () => marker('heritage', NEW)), {lifecycle: null});
  await assert.rejects(selectedWatermarks(chosen, async () => { throw new Error('429 fixture'); }), /429 fixture/);
});

test('handoff measures before and after publication and dispatches only from a successful main assembly', () => {
  const workflow = readFileSync(new URL('../.github/workflows/osm-assemble.yml', import.meta.url), 'utf8');
  const before = workflow.indexOf('node scripts/extract-pages-handoff.mjs before');
  const publish = workflow.lastIndexOf('git push --force origin HEAD:lifecycle-extract-data');
  const after = workflow.indexOf('node scripts/extract-pages-handoff.mjs after');
  const dispatch = workflow.indexOf('gh workflow run site.yml --ref main');
  assert.ok(before >= 0 && before < publish && publish < after && after < dispatch);
  assert.match(workflow, /if: github.ref == 'refs\/heads\/main' && needs.assemble.outputs.refresh_pages == 'true'\s+needs: assemble/);
  assert.equal((workflow.match(/actions: write/g) ?? []).length, 1);
  assert.match(workflow.slice(workflow.indexOf('\n  refresh-pages:')), /permissions:\s+actions: write/);
  assert.doesNotMatch(workflow, /uses: actions\/deploy-pages/);
});
