import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {MODES} from '../styles/map-model.mjs';
import {referenceDetailEligible} from '../styles/railway-visibility.mjs';

const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));
for (const mode of MODES) test(`${mode}: reference status follows actual track type filters and zoom limits`, () => {
  const layer = {...style.layers.find(l => l.id === `${mode}-tracks`), layout: {visibility: 'visible'}};
  const filter = featureFilter(layer.filter).filter;
  for (const subclass of ['', 'rail', 'narrow_gauge', 'preserved', 'subway', 'light_rail', 'monorail', 'tram', 'funicular', 'miniature']) {
    for (const zoom of [6.9, 7, 8, 9, 9.99, 10, 10.9]) {
      const eligible = zoom >= layer.minzoom && filter({zoom}, {type: 2, properties: {feature: subclass || 'rail', state: 'present'}});
      assert.equal(referenceDetailEligible({properties: {subclass}}, zoom, layer), eligible, `${subclass || 'rail'} at zoom ${zoom}`);
    }
  }
});

test('reference status respects a track layer being absent, hidden or outside its own zoom range', () => {
  const reference = {properties: {subclass: 'rail'}};
  const layer = {type: 'line', minzoom: 9, maxzoom: 12};
  assert.equal(referenceDetailEligible(reference, 8, layer), false);
  assert.equal(referenceDetailEligible(reference, 9, layer), true);
  assert.equal(referenceDetailEligible(reference, 11.99, layer), true);
  assert.equal(referenceDetailEligible(reference, 12, layer), false);
  assert.equal(referenceDetailEligible(reference, 10, {...layer, layout: {visibility: 'none'}}), false);
  assert.equal(referenceDetailEligible(reference, 10, undefined), false);
});
