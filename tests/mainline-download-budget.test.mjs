import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('actual PBF download enforces and identifies byte/time bounds through EOF', () => {
  const result = spawnSync('python', ['tests/fixtures/mainline-download-budget.py'],
    {encoding: 'utf8', timeout: 30000});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 9 tests/);
});
