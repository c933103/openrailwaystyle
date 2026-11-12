import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {STAGES, stageLayoutKey} from '../scripts/download-stages.mjs';
import {quarters} from '../scripts/branch-lines.mjs';
import {buildPowerMethodsFromStore, validatePowerMethodsSnapshot} from '../scripts/build-power-methods.mjs';
import {regionKey} from '../scripts/build-railway-ways.mjs';

// Synthetic responses only.
const response = elements => ({osm3s: {timestamp_osm_base: '2026-10-31T00:00:00Z'}, elements});
const thirdRail = {type: 'way', id: 1, version: 1, tags: {railway: 'subway', electrified: 'rail', voltage: '750'}, geometry: [{lon: 139.7, lat: 35.6}, {lon: 139.71, lat: 35.61}]};

async function store(t, {complete = true, split = false} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'power-store-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const stages = {};
  for (const stage of STAGES) {
    stages[stage.name] = {completed: complete || stage.name !== 'world' ? '2026-10-31T00:00:00Z' : null, leaves: {key: stageLayoutKey(stage), regions: []}};
    await mkdir(join(root, 'store', 'regions', stage.name), {recursive: true});
    for (const [part, {box}] of stage.parts.entries()) {
      const boxes = split && stage.name === 'japan' ? quarters(box) : [box];
      for (const [i, b] of boxes.entries()) await writeFile(join(root, 'store', 'regions', stage.name, `${regionKey({part, box: b})}.json.gz`),
        gzipSync(JSON.stringify({stage: stage.name, part, box: b, response: response(stage.name === 'japan' && i === 0 ? [thirdRail] : [])})));
    }
  }
  await writeFile(join(root, 'store', 'state.json'), JSON.stringify({version: 1, stages, runs: []}));
  return root;
}
const quiet = {log: () => {}};

test('power methods are built from a complete store, with every stage part covered', async t => {
  const root = await store(t, {split: true});
  const {data, manifest} = await buildPowerMethodsFromStore(join(root, 'store'), {output: join(root, 'out'), ...quiet, stagesCoverWorld: true});
  assert.deepEqual(data.features.map(f => f.id), ['way-1']);
  assert.equal(manifest.partition, 'railway-ways-stages');
  assert.equal(manifest.requests, 0);
  assert.equal(manifest.coverage.length, STAGES.reduce((n, s) => n + s.parts.length, 0) + 3, 'Japan in quarters');
  validatePowerMethodsSnapshot(JSON.parse(await readFile(join(root, 'out', 'power-methods.geojson'), 'utf8')),
    JSON.parse(await readFile(join(root, 'out', 'methods-manifest.json'), 'utf8')));
  // Gaps, overlaps and unknown partitions are rejected.
  const gap = {...manifest, coverage: manifest.coverage.slice(1)};
  assert.throws(() => validatePowerMethodsSnapshot(data, gap), /Incomplete worldwide power-method coverage/);
  const japan = STAGES.find(s => s.name === 'japan').parts[0].box;
  const overlap = {...manifest, coverage: [...manifest.coverage, {stage: 'japan', part: 0, bbox: japan, features: 0}]};
  assert.throws(() => validatePowerMethodsSnapshot(data, overlap), /Overlapping or non-partition/);
  assert.throws(() => validatePowerMethodsSnapshot(data, {...manifest, partition: 'other'}), /Unknown power-method coverage partition/);
  assert.throws(() => validatePowerMethodsSnapshot(data, {...manifest, coverage: [...manifest.coverage, {stage: 'nowhere', part: 0, bbox: japan, features: 0}]}), /Invalid power-method stage coverage/);
});

test('an incomplete store publishes nothing, so the download stays in use', async t => {
  const root = await store(t, {complete: false});
  const logs = [];
  assert.equal(await buildPowerMethodsFromStore(join(root, 'store'), {output: join(root, 'out'), log: (...args) => logs.push(args.join(' ')), stagesCoverWorld: true}), undefined);
  await assert.rejects(readFile(join(root, 'out', 'methods-manifest.json')));
  assert.match(logs[0], /incomplete or of an earlier stage layout; not built from the store: world/);
});

test('a world stage last fetched with its earlier boxes is not used for power methods', async t => {
  const root = await store(t);
  const state = JSON.parse(await readFile(join(root, 'store', 'state.json'), 'utf8'));
  state.stages.world.leaves = {key: JSON.stringify([{box: [-35, -20, 37.5, 52]}, {box: [-50, 110, -11, 180]}, {box: [-50, -180, 0, -150]}]), regions: []};
  await writeFile(join(root, 'store', 'state.json'), JSON.stringify(state));
  const logs = [];
  assert.equal(await buildPowerMethodsFromStore(join(root, 'store'), {output: join(root, 'out'), log: (...args) => logs.push(args.join(' '))}), undefined);
  await assert.rejects(readFile(join(root, 'out', 'methods-manifest.json')));
  assert.match(logs[0], /earlier stage layout; not built from the store: world$/);
  // Without any record of its layout, likewise.
  delete state.stages.world.leaves;
  await writeFile(join(root, 'store', 'state.json'), JSON.stringify(state));
  assert.equal(await buildPowerMethodsFromStore(join(root, 'store'), {output: join(root, 'out'), log: () => {}}), undefined);
});

test('while the stages leave parts of the world uncovered, a complete store is not used for power methods', async t => {
  const root = await store(t);
  const logs = [];
  assert.equal(await buildPowerMethodsFromStore(join(root, 'store'), {output: join(root, 'out'), log: (...args) => logs.push(args.join(' ')), stagesCoverWorld: false}), undefined);
  await assert.rejects(readFile(join(root, 'out', 'methods-manifest.json')));
  assert.match(logs[0], /do not cover the whole world/);
  // The stages do cover it, through the rest-of-the-world remainder: a
  // complete store of the current layout is used.
  const {STAGES_COVER_WORLD} = await import('../scripts/download-stages.mjs');
  assert.equal(STAGES_COVER_WORLD, true);
  const built = await buildPowerMethodsFromStore(join(root, 'store'), {output: join(root, 'out'), log: () => {}});
  assert.equal(built.manifest.partition, 'railway-ways-stages');
});

test('the facilities workflow loads the store before it builds the power methods', async () => {
  const workflow = await readFile(new URL('../.github/workflows/traction-facilities.yml', import.meta.url), 'utf8');
  const load = workflow.indexOf('railway-ways-release.mjs load /tmp/railway-ways-store RAILWAY_WAYS_STORE'), build = workflow.indexOf('scripts/build-power-methods.mjs');
  assert.ok(load > 0 && build > load);
});
