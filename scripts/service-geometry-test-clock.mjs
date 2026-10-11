// Test-only preload for unchanged production CLI replay. Never imported by the
// application or production commands. Historical input dates remain untouched.
import assert from 'node:assert/strict';
const value = Date.parse(process.env.ATLAS_GEOMETRY_TEST_TIME || '');
assert.ok(Number.isFinite(value), 'service geometry replay requires an explicit pinned clock');
Date.now = () => value;
