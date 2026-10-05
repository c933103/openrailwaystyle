import test from 'node:test';
import assert from 'node:assert/strict';
import {VectorTile} from '@mapbox/vector-tile';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import Pbf from '../styles/pbf-utf8.mjs';
import {localizeTile} from '../styles/tile-labels.mjs';

// BMP, Plane 1 (emoji), Plane 2 (Extensions B and C; 𨋢 is a Hong Kong
// character) and Plane 3 (Extension G).
const names = ['九龍', '😀', '𨋢', '𠮷', '𪜀', '𰀀'];

test('strings beyond U+1FFFF survive a pbf round trip', () => {
  for (const name of names) {
    const out = new Pbf();
    out.writeStringField(1, name);
    let read;
    new Pbf(out.finish()).readFields((tag, _, pbf) => { read = pbf.readString(); });
    assert.equal(read, name, `U+${name.codePointAt(0).toString(16).toUpperCase()}`);
  }
});

test('vt-pbf tiles and relabelled tiles keep names beyond U+1FFFF', () => {
  const features = names.map((name, i) => ({type: 'Feature', properties: {name}, geometry: {type: 'Point', coordinates: [114 + i / 100, 22.3]}}));
  const tile = geojsonvt({type: 'FeatureCollection', features}, {maxZoom: 14, indexMaxZoom: 0}).getTile(0, 0, 0);
  const data = vtpbf.fromGeojsonVt({place: tile}, {version: 2});
  const read = buffer => { const layer = new VectorTile(new Pbf(new Uint8Array(buffer))).layers.place; return Array.from({length: layer.length}, (_, i) => layer.feature(i).properties); };
  assert.deepEqual(read(data).map(p => p.name).sort(), [...names].sort());
  const localized = read(localizeTile(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), 'local', {z: 0, x: 0, y: 0}));
  assert.deepEqual(localized.map(p => p.atlas_name).sort(), [...names].sort());
});
