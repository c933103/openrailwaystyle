import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/heritage.yml', import.meta.url), 'utf8');
const builder = readFileSync(new URL('../scripts/build-heritage.mjs', import.meta.url), 'utf8');

// 2026-11-04: four failed heritage runs downloaded 105 MB, each starting again
// from the first region (#330). A failed run now keeps the regions it
// completed for the next run from the same published snapshot.
test('a failed heritage run keeps its completed regions for retries from the same snapshot, with no age limit', () => {
  const restore = workflow.indexOf('actions/cache/restore@v4');
  const build = workflow.indexOf('scripts/build-heritage.mjs');
  const save = workflow.indexOf('actions/cache/save@v4');
  assert.ok(restore > 0 && restore < build && build < save, 'restored before the build, saved after it');
  const snapshotStep = workflow.slice(workflow.indexOf('id: snapshot'), restore);
  assert.match(snapshotStep, /echo "id=\$\(git rev-parse FETCH_HEAD\)" >> "\$GITHUB_OUTPUT"/, 'keyed to the snapshot whose elements the run reads');
  assert.match(snapshotStep, /echo "id=none-\$GITHUB_RUN_ID"/, 'without a snapshot, only the same run shares a cache');
  const restoreStep = workflow.slice(restore, build);
  assert.match(restoreStep, /key: heritage-regions-v(\d+)-\$\{\{ steps\.snapshot\.outputs\.id \}\}\n/);
  assert.match(restoreStep, /restore-keys: heritage-regions-v\d+-\$\{\{ steps\.snapshot\.outputs\.id \}\}-\n/);
  const saveStep = workflow.slice(save, workflow.indexOf('- name:', save));
  assert.match(saveStep, /if: failure\(\)/, 'kept only when the build failed');
  assert.match(saveStep, /path: \.snapshot-cache/);
  assert.match(saveStep, /key: heritage-regions-v\d+-\$\{\{ steps\.snapshot\.outputs\.id \}\}-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/,
    'each attempt saves its own cache: a saved cache cannot change, and a re-run keeps its run id');
  assert.doesNotMatch(workflow, /date -u \+%Y%m|steps\.month/, 'no age limit');
  // The builder's cache files carry its version; the key must follow it.
  const [, keyVersion] = /heritage-regions-v(\d+)-/.exec(workflow);
  const [, builderVersion] = /const VERSION = (\d+);/.exec(builder);
  assert.equal(keyVersion, builderVersion);
  assert.match(builder, /heritage-v\$\{VERSION\}-\$\{box\.join\('_'\)\}\.json/, 'the builder reads the cached region file');
  assert.match(builder, /saved\.query === query/, 'a cached region is used only for the same query');
});
