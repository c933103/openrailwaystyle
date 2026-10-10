import test from 'node:test';
import assert from 'node:assert/strict';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import {serviceGeometryBrowserFixtures} from '../scripts/service-geometry-browser-fixture.mjs';
import {FREQUENCY_PROFILES} from '../styles/service-frequency.mjs';

const fixtures = serviceGeometryBrowserFixtures();
function decoded(fixture) {
  const result = [];
  for (const [key, bytes] of fixture.tiles) {
    const [z, x, y] = key.split('/').map(Number);
    if (z !== 12) continue;
    const layer = new VectorTile(new Pbf(bytes)).layers.service_routes;
    for (let i = 0; i < layer.length; i++) result.push(layer.feature(i).toGeoJSON(x, y, z));
  }
  return result;
}

test('browser geometry fixtures exercise native and overscaled views with every frequency profile', () => {
  assert.equal(fixtures.length, 16);
  assert.deepEqual([...new Set(fixtures.map(f => f.zoom))], [12, 16]);
  for (const fixture of fixtures) {
    const features = decoded(fixture);
    if (fixture.name === 'unavailable') {
      assert.equal(features.length, 0);
      continue;
    }
    assert.deepEqual([...new Set(features.map(f => f.properties.ref))].sort(), ['1', '2']);
    for (const {properties} of features) {
      assert.equal(properties.n, 2);
      assert.equal(properties.i, Number(properties.ref) - 1);
      for (const profile of FREQUENCY_PROFILES) {
        assert.ok(Number.isFinite(properties[`frequency_width_${profile}`]), `${fixture.id}: ${profile} width`);
        assert.ok(Number.isFinite(properties[`frequency_offset_${profile}`]), `${fixture.id}: ${profile} offset`);
        assert.ok(properties[`frequency_${profile}`] > 0, `${fixture.id}: ${profile} source rate`);
      }
    }
  }
});

test('browser pixel probes agree with generated tile geometry, including withheld gaps', () => {
  for (const fixture of fixtures) {
    const features = decoded(fixture);
    for (let segment = 0; segment < 4; segment++) {
      const a = fixture.points[segment], b = fixture.points[segment + 1], x = (a[0] + b[0]) / 2;
      const refs = new Set();
      for (const feature of features) {
        const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
        if (lines.some(line => line.slice(1).some((p, i) =>
          Math.min(p[0], line[i][0]) < x && Math.max(p[0], line[i][0]) > x && Math.abs(p[1] - a[1]) < .0001))) {
          refs.add(feature.properties.ref);
        }
      }
      assert.deepEqual([...refs].sort(), fixture.expected[segment] ? ['1', '2'] : [], `${fixture.id}: segment ${segment}`);
    }
  }
});

test('geometry browser fixtures include genuinely absent frequency properties for unknown-mode picking', () => {
  for (const fixture of serviceGeometryBrowserFixtures()) {
    assert.ok(fixture.unknownTiles instanceof Map);
    for (const [key, bytes] of fixture.unknownTiles) {
      if (!key.startsWith('12/')) continue;
      const layer = new VectorTile(new Pbf(bytes)).layers.service_routes;
      for (let i=0;i<layer.length;i++) {
        const properties=layer.feature(i).properties;
        assert.equal(properties.n,2);
        assert.equal(Object.keys(properties).some(key=>key.startsWith('frequency_')),false);
      }
    }
  }
});
