import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));
const baseline = JSON.parse(await readFile(new URL('./fixtures/style-composition-baseline.json', import.meta.url)));

// Object property order does not affect MapLibre rendering; array order does.
// Only atlas:* metadata may be introduced by this migration. All source URLs,
// filters, expressions, zoom limits, symbol settings and array orders remain
// part of the contract. Empty metadata from adding atlas:* keys is equivalent
// to absent metadata.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (key === 'metadata') {
      const metadata = Object.fromEntries(Object.entries(value.metadata).filter(([name]) => !name.startsWith('atlas:')));
      if (Object.keys(metadata).length) result.metadata = canonical(metadata);
    } else result[key] = canonical(value[key]);
  }
  return result;
}

// New independently tested overlays retain every historical source/layer byte
// and their relative order; their own schema and paint are in power-methods.test.
const addedSources=new Set(['railReference','electricMethods','electricCatenary']);
const addedLayers=new Set(['electrification-conductor-rails','electrification-method-labels','electrification-charging-points','electrification-charging-marks','electrification-charging-names','electrification-former-conductor-rails','electrification-former-method-labels','electrification-former-charging-points','electrification-former-charging-marks','electrification-former-charging-names','electrification-catenary-masts','electrification-catenary-portals','electrification-catenary-references',...['fourth-rails','ground-supply','inductive-supply','linear-motors','rack-traction','cable-traction'].flatMap(id=>[`electrification-${id}`,`electrification-former-${id}`])]);
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function rootContract(value) {
  const {layers, sources, ...root} = structuredClone(value);
  // The migration deliberately corrects the project's description. This
  // prose is not a renderer input; every other non-atlas metadata key stays.
  if (root.metadata) delete root.metadata.description;
  return canonical(root);
}

test('composition preserves root rendering settings and non-atlas metadata', () => {
  assert.deepEqual(rootContract(style), baseline.root);
});

test('composition preserves every source contract, including embedded station data', () => {
  assert.deepEqual(Object.keys(style.sources).filter(id=>!addedSources.has(id)), baseline.sources.map(source => source.id), 'source IDs and their order');
  for (const expected of baseline.sources) {
    assert.equal(digest(style.sources[expected.id]), expected.sha256, `source ${expected.id} differs from the reviewed migration baseline`);
  }
});

test('composition preserves every layer definition and its rendering order', () => {
  assert.deepEqual(style.layers.filter(layer=>layer.source!=='railReference'&&!addedLayers.has(layer.id)).map(layer => layer.id), baseline.layers.map(layer => layer.id), 'layer order controls drawing and symbol priority');
  for (const [index, expected] of baseline.layers.entries()) {
    assert.equal(digest(style.layers.find(layer=>layer.id===expected.id)), expected.sha256, `layer ${expected.id} differs from the reviewed migration baseline`);
  }
});

test('migration guard permits atlas metadata but detects rendering and unrelated metadata changes', () => {
  const original = style.layers.find(layer => layer.id === 'infrastructure-tracks');
  const annotated = structuredClone(original);
  annotated.metadata = {...annotated.metadata, 'atlas:group':'railway', 'atlas:view':['infrastructure']};
  assert.equal(digest(annotated), digest(original));
  annotated.metadata['unrelated:group'] = 'railway';
  assert.notEqual(digest(annotated), digest(original));
  const changed = structuredClone(original);
  changed.paint['line-color'] = '#000000';
  assert.notEqual(digest(changed), digest(original));
  changed.paint = original.paint;
  changed.minzoom = (changed.minzoom ?? 0) + 1;
  assert.notEqual(digest(changed), digest(original));
  const reordered = [...style.layers];
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.notDeepEqual(reordered.map(layer => layer.id), baseline.layers.map(layer => layer.id));
});
