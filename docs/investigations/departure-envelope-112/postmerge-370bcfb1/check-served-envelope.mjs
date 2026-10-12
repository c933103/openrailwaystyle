import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve, join} from 'node:path';
const root = resolve(process.argv[2] || '.');
const out = resolve(process.argv[3] || 'served-envelope-verification');
const base = 'https://c933103.github.io/openrailwaystyle/';
const version = '20261011-departure-envelope-1';
const commit = '370bcfb1db684d80520ea43430e1cbb5bdb360dd';
await mkdir(join(out, 'styles'), {recursive:true});
const files = ['index.html', 'app.mjs', 'departures.mjs', 'departures-ui.mjs',
  'map-model.mjs', 'platform-length.mjs', 'axle-load.mjs', 'cjk-font.mjs',
  'elevation.mjs', 'layer-semantics.mjs', 'app.css', 'sw.js'];
const assets = [];
for (const name of files) {
  const path = name === 'index.html' ? '' : name + (name === 'sw.js' ? '' : `?v=${version}`);
  const response = await fetch(base + path, {redirect:'error', signal:AbortSignal.timeout(30_000)});
  assert.equal(response.status, 200, name);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.equals(await readFile(join(root, 'styles', name))), `${name} must match exact accepted merge bytes`);
  await writeFile(join(out, 'styles', name), bytes);
  assets.push({path, status:response.status, bytes:bytes.length,
    sha256:createHash('sha256').update(bytes).digest('hex'), matchesMergedSource:true});
}
const response = await fetch(base + 'vendor/tile-labels.js', {redirect:'error', signal:AbortSignal.timeout(30_000)});
assert.equal(response.status, 200, 'build information bundle');
const bundle = await response.text();
assert.ok(bundle.includes(commit), 'bundle identifies accepted merge commit');
assert.ok(bundle.includes(version), 'bundle identifies corrected asset version');
// Execute the actual fetched parser and renderer with synthetic responses only.
const challenge = spawnSync(process.execPath,
  [join(root, 'docs/investigations/departure-envelope-112/review/probe.mjs'), out], {encoding:'utf8'});
assert.equal(challenge.status, 0, challenge.stderr || challenge.stdout);
const contract = JSON.parse(challenge.stdout);
assert.equal(contract.passed, 366); assert.equal(contract.failed, 0);
const report = {observedAt:new Date().toISOString(), base, commit, version, assets,
  bundle:{bytes:Buffer.byteLength(bundle), sha256:createHash('sha256').update(bundle).digest('hex'), commitPresent:true, versionPresent:true},
  independentContract:{badBodyShapes:contract.badBodyShapes, passed:contract.passed, failed:contract.failed},
  scope:'First-party asset reads only, redirects rejected. Actual served parser/DOM/cache replay with synthetic fixtures; no live timetable-provider traffic or local browser launch.'};
await writeFile(join(out, 'served-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
