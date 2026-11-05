import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/heritage.yml', import.meta.url), 'utf8');
const builder = readFileSync(new URL('../scripts/build-heritage.mjs', import.meta.url), 'utf8');

// 2026-11-04: four failed heritage runs downloaded 105 MB, each starting again
// from the first region (#330). A failed run now keeps the regions it
// completed for the next run of the same month.
test('a failed heritage run keeps its completed regions for the next run of the month', () => {
  const restore = workflow.indexOf('actions/cache/restore@v4');
  const build = workflow.indexOf('scripts/build-heritage.mjs');
  const save = workflow.indexOf('actions/cache/save@v4');
  assert.ok(restore > 0 && restore < build && build < save, 'restored before the build, saved after it');
  const saveStep = workflow.slice(save, workflow.indexOf('- name:', save));
  assert.match(saveStep, /if: failure\(\)/, 'kept only when the build failed');
  assert.match(saveStep, /path: \.snapshot-cache/);
  assert.match(saveStep, /key: \$\{\{ steps\.month\.outputs\.key \}\}-\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /key=heritage-regions-v(\d+)-\$\(date -u \+%Y%m\)/, 'scoped to the month');
  assert.match(workflow.slice(restore, build), /restore-keys: \$\{\{ steps\.month\.outputs\.key \}\}-/);
  // The builder's cache files carry its version; the key must follow it.
  const [, keyVersion] = /heritage-regions-v(\d+)-/.exec(workflow);
  const [, builderVersion] = /const VERSION = (\d+);/.exec(builder);
  assert.equal(keyVersion, builderVersion);
  assert.match(builder, /heritage-v\$\{VERSION\}-\$\{box\.join\('_'\)\}\.json/, 'the builder reads the cached region file');
  assert.match(builder, /saved\.query === query/, 'a cached region is used only for the same query');
});
