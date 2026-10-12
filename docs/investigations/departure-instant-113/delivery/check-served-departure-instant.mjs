import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, cp, symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve, join} from 'node:path';
const root = resolve(process.argv[2] || '.');
const out = resolve(process.argv[3] || 'served-departure-instant-verification');
const base = 'https://c933103.github.io/openrailwaystyle/';
const version = '20261012-departure-instant-2';
const commit = 'dea9f68e9d4c585c29ff225c4c052e689dac849b';
await mkdir(join(out, 'styles'), {recursive:true});
await mkdir(join(out, 'tests'), {recursive:true});
await mkdir(join(out, 'scripts'), {recursive:true});
const files = ['index.html', 'app.mjs', 'departures.mjs', 'departures-ui.mjs',
  'map-model.mjs', 'platform-length.mjs', 'axle-load.mjs', 'cjk-font.mjs',
  'elevation.mjs', 'layer-semantics.mjs', 'app.css', 'sw.js', 'map-controls.mjs', 'power-facilities.mjs'];
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
// The test harness is from the accepted repository. All imported application
// modules and worker bytes below are the fetched deployment copies, not substitutes.
const tests = ['departure-instant.test.mjs', 'departure-identity.test.mjs', 'departure-labels.test.mjs',
  'departure-platform.test.mjs', 'departure-availability.test.mjs', 'departures.test.mjs',
  'train-schedule.test.mjs', 'sw-install.test.mjs'];
for (const name of tests) await cp(join(root, 'tests', name), join(out, 'tests', name));
await cp(join(root, 'tests/fixtures'), join(out, 'tests/fixtures'), {recursive:true});
await cp(join(root, 'scripts/browser-libraries.mjs'), join(out, 'scripts/browser-libraries.mjs'));
try { await symlink(join(root, 'node_modules'), join(out, 'node_modules'), 'dir'); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
const run = (name, args, expected) => {
  const result = spawnSync(process.execPath, args, {cwd:out, encoding:'utf8', maxBuffer:16*1024*1024});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return writeFile(join(out, name + '.log'), result.stdout + result.stderr).then(() => {
    if (expected) {
      const data = JSON.parse(result.stdout); expected(data); return data;
    }
    assert.match(result.stdout, /# fail 0|ℹ fail 0/);
    const count = result.stdout.match(/(?:#|ℹ) tests (\d+)/)?.[1];
    return {tests:Number(count), failed:0};
  });
};
const unit = await run('served-unit', ['--experimental-vm-modules', '--test', ...tests.map(name=>join(out,'tests',name))]);
assert.equal(unit.tests, 186);
const envelope = await run('served-envelope', [join(root,'docs/investigations/departure-envelope-112/review/probe.mjs'), out], data=>{
  assert.equal(data.passed,366);assert.equal(data.failed,0);
});
const monotonicity = await run('served-monotonicity', [join(root,'docs/investigations/departure-instant-113/integration/monotonicity-integration.mjs'), join(out,'styles/departures.mjs')], data=>{
  assert.equal(data.trials,12000);assert.deepEqual(data.newlyFormedGroupExamples,[]);
});
const composition = await run('served-composition', [join(root,'docs/investigations/departure-instant-113/integration/composition-probe.mjs'), out], data=>{
  assert.equal(data.passed,14);assert.equal(data.failed,0);
});
const report = {observedAt:new Date().toISOString(),base,commit,version,assets,
  bundle:{bytes:Buffer.byteLength(bundle),sha256:createHash('sha256').update(bundle).digest('hex'),commitPresent:true,versionPresent:true},
  servedUnit:unit,servedEnvelope:{passed:envelope.passed,failed:envelope.failed},servedMonotonicity:monotonicity,servedComposition:composition,
  scope:'First-party GET reads only, redirects rejected. Actual fetched parser, schedule renderer and service-worker bytes executed in synthetic unit/DOM/cache fixtures. No live timetable-provider traffic, native browser launch or service-worker interception claim.'};
await writeFile(join(out,'served-verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
