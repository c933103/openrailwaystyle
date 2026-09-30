import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import {DETAIL_ZOOM, OVERVIEW_ZOOM, applyChanges, buildTiles, parseCsv, quarters, readTable, regionQuery, replaceRegion, startRegions, writeTable} from '../scripts/crossing-data.mjs';

const csv = rows => rows.map(r => r.join('\t')).join('\n') + '\n1\t\t\tend\n';
const layer = bytes => new VectorTile(new Pbf(bytes)).layers.level_crossings;

test('crossing responses: rows parse; a response without the end marker or with an error page is rejected', () => {
  assert.deepEqual(parseCsv(csv([[5, 22.3, 113.9, 'level_crossing'], [6, 22.4, 114.0, 'crossing']])),
    [{id: 5, lat: 22.3, lon: 113.9, kind: 'road'}, {id: 6, lat: 22.4, lon: 114.0, kind: 'foot'}]);
  assert.deepEqual(parseCsv('1\t\t\tend\n'), []);
  assert.throws(() => parseCsv('5\t22.3\t113.9\tlevel_crossing\n'), /no end marker/);
  assert.throws(() => parseCsv('<?xml version="1.0"?><html><p>runtime error: Query timed out</p></html>'), /error page.*timed out/);
  assert.throws(() => parseCsv(csv([[5, 'x', 113.9, 'level_crossing']])), /Unexpected/);
  assert.match(regionQuery([0, 90, 45, 135]), /node\[railway=level_crossing\]\(0,90,45,135\);node\[railway=crossing\]\(0,90,45,135\);\);out qt;make complete railway="end";out;$/);
  assert.match(regionQuery([0, 90, 45, 135], '2026-09-20T00:00:00Z'), /\[railway=crossing\]\(newer:"2026-09-20T00:00:00Z"\)\(0,90,45,135\)/);
});

test('crossing regions: 45° squares cover the world; a quarter split covers its parent', () => {
  const regions = startRegions();
  assert.equal(regions.length, 32);
  assert.equal(regions.reduce((sum, {box: [s, w, n, e]}) => sum + (n - s) * (e - w), 0), 360 * 180);
  assert.deepEqual(quarters([0, 90, 45, 135]), [[0, 90, 22.5, 112.5], [0, 112.5, 22.5, 135], [22.5, 90, 45, 112.5], [22.5, 112.5, 45, 135]]);
});

test('crossing table: a full region response removes crossings no longer there; changes only add or move', () => {
  const table = new Map([[1, [10, 10, 'road']], [2, [10, 11, 'road']], [3, [50, 10, 'foot']]]);
  replaceRegion(table, [0, 0, 45, 45], [{id: 2, lat: 10, lon: 11.5, kind: 'foot'}, {id: 4, lat: 11, lon: 12, kind: 'road'}]);
  assert.deepEqual([...table].sort((a, b) => a[0] - b[0]), [[2, [10, 11.5, 'foot']], [3, [50, 10, 'foot']], [4, [11, 12, 'road']]], 'crossing 1 was deleted; 3 lies outside');
  applyChanges(table, [{id: 3, lat: 51, lon: 10, kind: 'foot'}]);
  assert.deepEqual(table.get(3), [51, 10, 'foot']);
  assert.equal(table.size, 3);
  assert.deepEqual(readTable(writeTable(table)), table);
});

test('crossing tiles: overview multipoints per kind, crossings on one spot drawn once; detail points keep their node id', () => {
  // Two nodes 1 m apart (both tracks of a line) and one pedestrian crossing.
  const table = new Map([[101, [22.40000, 113.97000, 'road']], [102, [22.40001, 113.97000, 'road']], [103, [22.41, 113.98, 'foot']]]);
  const overview = buildTiles(table, OVERVIEW_ZOOM), detail = buildTiles(table, DETAIL_ZOOM, {detail: true});
  assert.deepEqual([...overview.keys()], ['5/26/13']);
  const o = layer(overview.get('5/26/13'));
  assert.equal(o.length, 2);
  const kinds = Object.fromEntries([0, 1].map(i => [o.feature(i).properties.kind, o.feature(i).loadGeometry().flat().length]));
  assert.deepEqual(kinds, {road: 1, foot: 1});
  assert.equal(detail.size, 1);
  const d = layer([...detail.values()][0]);
  assert.deepEqual([...Array(d.length).keys()].map(i => [d.feature(i).id, d.feature(i).properties.kind]).sort(), [[101, 'road'], [102, 'road'], [103, 'foot']]);
});

test('crossing tiles: a crossing near a tile edge is also drawn in the neighbour, across the antimeridian too', () => {
  // Just east of 180°W: tile x 0 and, within the buffer, the last tile.
  const tiles = buildTiles(new Map([[7, [0.5, -179.9999, 'road']]]), DETAIL_ZOOM, {detail: true});
  assert.deepEqual([...tiles.keys()].sort(), ['9/0/255', '9/511/255']);
  const wrapped = layer(tiles.get('9/511/255')).feature(0).loadGeometry()[0][0];
  assert.ok(wrapped.x > 8192 && wrapped.x < 8192 + 128, 'drawn just beyond the right edge of the last tile');
});

test('style: level crossings from zoom 11 in the Infrastructure view (small ×), detailed × from 15', async () => {
  const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));
  const byId = Object.fromEntries(style.layers.map(l => [l.id, l]));
  assert.equal(byId['infrastructure-crossing-overview'], undefined, 'no crossings before zoom 11');
  assert.equal(byId['infrastructure-crossing-dots'], undefined);
  assert.equal(style.sources.crossingsOverview, undefined);
  assert.deepEqual([byId['infrastructure-crossing-marks'].minzoom, byId['infrastructure-crossing-marks'].maxzoom, byId['infrastructure-crossing-marks'].layout['icon-allow-overlap']], [11, 15, true]);
  assert.equal(byId['infrastructure-level-crossings'].minzoom, 15);
  assert.equal(byId['infrastructure-crossing-marks'].layout.visibility, 'none', 'shown only in the Infrastructure view');
  assert.equal(style.sources.crossingsDetail.minzoom, 9);
});
