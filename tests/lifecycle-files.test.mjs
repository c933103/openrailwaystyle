import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {writeLifecycleSnapshot} from '../scripts/lifecycle-files.mjs';

test('the lifecycle snapshot emits MVT v2 and retains line data', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-lifecycle-mvt-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  const data = {type:'FeatureCollection', features:[{
    type:'Feature', id:123,
    properties:{name:'Lifecycle fixture', state:'construction'},
    geometry:{type:'LineString', coordinates:[[100, 10], [100.15, 10.2]]},
  }]};
  const written = await writeLifecycleSnapshot(dir, data, {});
  assert.ok(written > 0);
  const rows = (await readFile(join(dir,'tiles.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(rows.length, written);
  for (const [, , , encoded] of rows) {
    const tile = new VectorTile(new Pbf(gunzipSync(Buffer.from(encoded,'base64'))));
    const layer = tile.layers.lifecycle;
    assert.equal(layer.version, 2);
    assert.equal(layer.extent, 4096);
    assert.ok(layer.length > 0);
    const feature = layer.feature(0);
    assert.equal(feature.type, 2);
    assert.equal(feature.properties.name, 'Lifecycle fixture');
    assert.equal(feature.properties.state, 'construction');
    assert.ok(feature.loadGeometry()[0].length >= 2);
  }
});
