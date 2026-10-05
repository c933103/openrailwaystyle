import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {heritageQuery, heritageFeatures, heritageGeometry, heritageKind, heritageTiles, NAME_KEYS, HERITAGE_LAYER} from '../scripts/heritage-data.mjs';

const way = (id, coordinates, tags) => ({type:'way', id, tags, geometry:coordinates.map(([lon, lat]) => ({lon, lat}))});
const square = (west, south, size) => [[west, south], [west + size, south], [west + size, south + size], [west, south + size], [west, south]];

test('the query asks for areas of every historic kind, with relation members', () => {
  const query = heritageQuery([40, 10, 45, 15]);
  for (const filter of ['historic~"^(archaeological_site|battlefield|district)$"', 'protect_class=22', 'heritage=1']) {
    assert.ok(query.includes(`way[${filter}](40,10,45,15)`), filter);
    assert.ok(query.includes(`rel[${filter}][type~"^(multipolygon|boundary)$"](40,10,45,15)`), filter);
  }
  // "out tags" would drop the relation members that carry the geometry.
  assert.match(query, /;out geom;$/);
});

test('kinds follow the historic tag first, then World Heritage, then the protection class', () => {
  assert.equal(heritageKind({historic:'archaeological_site', heritage:'1'}), 'archaeological_site');
  assert.equal(heritageKind({historic:'district'}), 'historic_district');
  assert.equal(heritageKind({historic:'battlefield'}), 'battlefield');
  assert.equal(heritageKind({heritage:'1', historic:'monument'}), 'world_heritage');
  assert.equal(heritageKind({protect_class:'22'}), 'cultural_protected_area');
});

test('features keep the OSM id, kind and only the names the map can show', () => {
  const [feature] = heritageFeatures({elements:[way(5, square(12, 41, .01), {historic:'archaeological_site', heritage:'1', name:'Forum', 'name:en':'Forum', 'name:zh-Hant':'廣場', 'name:xx':'skip', wikidata:'Q1'})]});
  assert.deepEqual(feature.properties, {id:'w5', kind:'archaeological_site', world_heritage:true, name:'Forum', 'name:en':'Forum', 'name:zh-Hant':'廣場'});
  assert.equal(feature.id, undefined, 'vector tile feature ids must be integers');
  assert.ok(NAME_KEYS.includes('name:ja') && NAME_KEYS.includes('name:zh-Hans') && !NAME_KEYS.includes('name:xx'));
});

test('open ways, nodes and relations without closed rings are skipped', () => {
  const features = heritageFeatures({elements:[
    way(1, [[0, 0], [1, 0], [1, 1], [0, 1]], {historic:'district'}),
    {type:'node', id:2, lat:0, lon:0, tags:{historic:'archaeological_site'}},
    {type:'relation', id:3, tags:{historic:'district'}, members:[{type:'way', role:'outer', geometry:[{lon:0, lat:0}, {lon:1, lat:0}]}]},
  ]});
  assert.deepEqual(features, []);
});

test('an incomplete Overpass response is refused', () => {
  assert.throws(() => heritageFeatures({remark:'runtime error: Query timed out', elements:[]}), /timed out/);
  assert.throws(() => heritageFeatures({}), /no elements/);
});

test('multipolygon rings are joined from member ways and holes go to the part around them', () => {
  const ring = square(0, 0, 1), far = square(5, 5, 1), hole = square(.25, .25, .5);
  const geometry = heritageGeometry({type:'relation', id:9, members:[
    {type:'way', role:'outer', geometry:ring.slice(0, 3).map(([lon, lat]) => ({lon, lat}))},
    {type:'way', role:'outer', geometry:ring.slice(2).map(([lon, lat]) => ({lon, lat}))},
    {type:'way', role:'outer', geometry:far.map(([lon, lat]) => ({lon, lat}))},
    {type:'way', role:'inner', geometry:hole.map(([lon, lat]) => ({lon, lat}))},
    {type:'way', role:'inner', geometry:square(20, 20, 1).map(([lon, lat]) => ({lon, lat}))},
  ]});
  assert.equal(geometry.type, 'MultiPolygon');
  assert.deepEqual(geometry.coordinates.map(polygon => polygon.length), [2, 1], 'one hole in the first part; the stray inner ring is dropped');
  assert.deepEqual(geometry.coordinates[0][1], hole);
});

test('an area across the antimeridian stays one shape', () => {
  const geometry = heritageGeometry(way(7, [[179.5, 0], [-179.5, 0], [-179.5, 1], [179.5, 1], [179.5, 0]], {heritage:'1'}));
  const lons = geometry.coordinates[0].map(([lon]) => lon);
  assert.ok(Math.max(...lons) - Math.min(...lons) < 2, JSON.stringify(lons));
});

test('tiles cover zooms 10 to 12 in one named layer with the feature properties', () => {
  const features = heritageFeatures({elements:[way(5, square(12.48, 41.89, .005), {historic:'archaeological_site', name:'Forum'})]});
  const tiles = heritageTiles(features);
  assert.deepEqual([...new Set([...tiles.keys()].map(key => Number(key.split('/')[0])))].sort(), [10, 11, 12]);
  const key = [...tiles.keys()].find(k => k.startsWith('12/'));
  const layer = new VectorTile(new Pbf(tiles.get(key))).layers[HERITAGE_LAYER];
  assert.equal(layer.length, 1);
  assert.deepEqual(layer.feature(0).properties, {id:'w5', kind:'archaeological_site', name:'Forum'});
  assert.equal(layer.feature(0).type, 3);
});

test('the map reads the snapshot through its own tile protocol, localized and drawn with the basemap', async () => {
  const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url), 'utf8'));
  assert.deepEqual(style.sources.heritageAreas.tiles, ['heritagetiles://{z}/{x}/{y}']);
  const layers = style.layers.filter(layer => layer.source === 'heritageAreas');
  assert.deepEqual(layers.map(layer => layer.id), ['context-constraints-heritage-area', 'context-constraints-heritage-edge', 'context-constraints-heritage-area-label']);
  for (const layer of layers) {
    assert.equal(layer['source-layer'], HERITAGE_LAYER);
    assert.equal(layer.metadata['atlas:base-map'], true);
    assert.deepEqual(layer.metadata['atlas:settings'], ['constraints']);
  }
  assert.equal(layers[2].metadata['atlas:localize'], true);
  const app = await readFile(new URL('../styles/app.mjs', import.meta.url), 'utf8');
  assert.match(app, /\['heritagetiles','heritage'\]/);
  assert.match(app, /heritageAreas\.tiles = \[`heritagetiles:\/\/\{z\}\/\{x\}\/\{y\}\?lang=\$\{settings\.language\}`\]/);
});
