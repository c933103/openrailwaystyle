import test from 'node:test';
import assert from 'node:assert/strict';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {signalQuery, signalFeature, signalFeatures, buildSignalTiles, SIGNAL_ZOOM, SIGNAL_OVERVIEW_ZOOM} from '../scripts/signals-data.mjs';
import {composeStyle} from '../scripts/style/compose-style.mjs';
import {layerVisibility} from '../styles/layer-semantics.mjs';
import {osmObject} from '../styles/map-model.mjs';

// Provider evidence: hiddewie/OpenRailwayMap-vector import/openrailwaymap.lua
// imports the raw direction tag; import/sql/signal_features.sql.mjs excludes
// NULL signal_direction from signal_direction_view and joins that table in
// railway_signals_view. No direction tag is needed for a neutral location dot.
const node = (tags = {}, overrides = {}) => ({type:'node', id:123, lat:51.5, lon:-0.1, tags:{railway:'signal', ref:'S12', ...tags}, ...overrides});

test('the worldwide supplement covers precisely signal nodes the direction-dependent provider omits', () => {
  assert.match(signalQuery([-90,-180,-45,-135]), /node\[railway=signal\]\[!"railway:signal:direction"\]\(-90,-180,-45,-135\)/);
  assert.equal(signalFeature(node()).properties.ref, 'S12');
  for (const direction of ['forward', 'backward', 'both', '', 'invalid']) assert.equal(signalFeature(node({'railway:signal:direction':direction})), null, `non-NULL provider direction ${direction}`);
  assert.equal(signalFeature(node({railway:'buffer_stop'})), null);
  assert.equal(signalFeature(node({}, {type:'way'})), null);
  assert.throws(() => signalFeature(node({}, {lat:undefined})), /Incomplete railway signal node/);
  assert.throws(() => signalFeatures({elements:[], remark:'runtime error: timed out'}), /timed out/);
  assert.throws(() => signalFeatures({}), /Incomplete signal response/);
});

test('undirected signals retain references, components and deactivated state for the shared infobox', () => {
  const feature = signalFeature(node({'railway:signal:main':'GB:main', 'railway:signal:distant':'GB:distant', 'railway:signal:distant:deactivated':'yes', name:'South signal'}));
  assert.deepEqual(feature.properties, {id:123, railway:'signal', ref:'S12', caption:'South signal', category0:'main', category1:'distant', deactivated1:true});
  assert.equal(feature.properties.azimuth, undefined, 'no track direction is invented');
  assert.deepEqual(osmObject({source:'railwaySignalSupplement', properties:feature.properties}), {type:'node',id:'123'});
  assert.deepEqual(osmObject({source:'railwaySignalSupplementOverview', properties:feature.properties}), {type:'node',id:'123'});
});

test('stored vector tiles retain node identities, precise street-zoom positions and wrap buffers', () => {
  const feature = signalFeature(node()), tiles = buildSignalTiles([feature]);
  assert.ok(tiles.size);
  for (const [key, bytes] of tiles) {
    const [z,x,y] = key.split('/').map(Number), layer = new VectorTile(new Pbf(bytes)).layers.railway_signals;
    assert.equal(z, SIGNAL_ZOOM);
    const point = layer.feature(0), result = point.toGeoJSON(x,y,z);
    assert.equal(point.id, 123);
    assert.equal(point.properties.railway, 'signal');
    // Native z16 quantization stays below a tenth of a metre, including at
    // maximum zoom where native z12 rounding would noticeably shift the dot.
    assert.ok(Math.abs(result.geometry.coordinates[0] - feature.geometry.coordinates[0]) < 0.0000007);
    assert.ok(Math.abs(result.geometry.coordinates[1] - feature.geometry.coordinates[1]) < 0.0000007);
  }
  assert.ok([...buildSignalTiles([feature], SIGNAL_OVERVIEW_ZOOM).keys()].every(key => key.startsWith(`${SIGNAL_OVERVIEW_ZOOM}/`)));
  const wrap = buildSignalTiles([signalFeature(node({}, {lon:179.999999,lat:0}))]);
  assert.ok([...wrap.keys()].some(key => key.split('/')[1] === '0'));
  assert.ok([...wrap.keys()].some(key => key.split('/')[1] === String(2 ** SIGNAL_ZOOM - 1)));
});

test('provider and undirected signals use identical markers in Infrastructure and Train control', () => {
  const style = composeStyle({majorStationData:{type:'FeatureCollection',features:[]}, curatedFilter:['==',['get','id'],'']});
  const markers = style.layers.filter(layer => layer.id.startsWith('infrastructure-signal-'));
  assert.equal(style.sources.railwaySignals.minzoom, 13);
  assert.equal(style.sources.railwaySignalSupplementOverview.maxzoom, SIGNAL_OVERVIEW_ZOOM);
  assert.equal(style.sources.railwaySignalSupplement.maxzoom, SIGNAL_ZOOM);
  assert.equal(markers.length, 5);
  for (const layer of markers) {
    for (const mode of ['infrastructure','control']) {
      assert.equal(layerVisibility(layer, {mode, background:'map', labels:true}), true, `${mode} ${layer.id}`);
      assert.equal(layerVisibility(layer, {mode, background:'map', labels:false}), layer.type !== 'symbol');
    }
    assert.equal(layerVisibility(layer, {mode:'speed',background:'map',labels:true}), false);
    const {filter} = featureFilter(layer.filter);
    assert.equal(filter({zoom:19}, {type:1,properties:{railway:'signal'}}), true, 'direction and known icon category do not gate a location dot');
    assert.equal(filter({zoom:19}, {type:1,properties:{railway:'buffer_stop'}}), false);
  }
  const provider = markers.find(layer => layer.id === 'infrastructure-signal-points');
  const supplement = markers.find(layer => layer.id === 'infrastructure-signal-supplement-points');
  assert.deepEqual(supplement.paint, provider.paint);
});
