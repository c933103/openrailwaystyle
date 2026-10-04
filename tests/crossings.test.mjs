import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {DETAIL_ZOOM, OVERVIEW_ZOOM, TAG_KEYS, applyChanges, buildTiles, parseCsv, quarters, readTable, regionQuery, replaceRegion, startRegions, writeTable} from '../scripts/crossing-data.mjs';

const csv = (rows, minor = []) => [...rows, [1, '', '', 'minor'], ...minor, [2, '', '', 'end']].map(r => r.join('\t')).join('\n') + '\n';
const layer = bytes => new VectorTile(new Pbf(bytes)).layers.level_crossings;

test('crossing responses: rows parse, minor after the marker; a response without the markers or with an error page is rejected', () => {
  assert.deepEqual(parseCsv(csv([[5, 22.3, 113.9, 'level_crossing'], [6, 22.4, 114.0, 'crossing']], [[7, 22.5, 114.1, 'level_crossing']])),
    [{id: 5, lat: 22.3, lon: 113.9, kind: 'road', minor: false, tags: {}}, {id: 6, lat: 22.4, lon: 114.0, kind: 'foot', minor: false, tags: {}}, {id: 7, lat: 22.5, lon: 114.1, kind: 'road', minor: true, tags: {}}]);
  assert.deepEqual(parseCsv('1\t\t\tminor\n2\t\t\tend\n'), []);
  assert.throws(() => parseCsv('5\t22.3\t113.9\tlevel_crossing\n'), /no end marker/);
  assert.throws(() => parseCsv('5\t22.3\t113.9\tlevel_crossing\n1\t\t\tend\n'), /no minor marker/);
  assert.throws(() => parseCsv('<?xml version="1.0"?><html><p>runtime error: Query timed out</p></html>'), /error page.*timed out/);
  assert.throws(() => parseCsv(csv([[5, 'x', 113.9, 'level_crossing']])), /Unexpected/);
  assert.match(regionQuery([0, 90, 45, 135]), /node\[railway=level_crossing\]\(0,90,45,135\);node\[railway=crossing\]\(0,90,45,135\);\)->\.c;way\(bn\.c\)\[railway\]->\.w;/);
  assert.ok(regionQuery([0, 90, 45, 135]).includes('way.w[railway!~"^(rail|narrow_gauge|light_rail|subway|tram|monorail|funicular|miniature)$"][~"^(proposed|construction|disused|abandoned|razed|demolished|removed)(:railway)?$"~"^(tram|light_rail|funicular|miniature)$"];'), 'planned and former trams count as minor tracks');
  assert.match(regionQuery([0, 90, 45, 135]), /\.major out qt;make split railway="minor";out;\.minor out qt;make complete railway="end";out;$/);
  assert.match(regionQuery([0, 90, 45, 135], '2026-09-20T00:00:00Z'), /\[railway=crossing\]\(newer:"2026-09-20T00:00:00Z"\)\(0,90,45,135\)/);
  assert.match(regionQuery([0, 90, 45, 135], '2026-09-20T00:00:00Z'), /\[timeout:180\];\(node\[railway=level_crossing\]\(0,90,45,135\);node\[railway=crossing\]\(0,90,45,135\);\)->\.all;way\(bn\.all\)\(newer:"2026-09-20T00:00:00Z"\)->\.cw;\(node.*;node\.all\(w\.cw\);\)->\.c;/, 'crossings on retagged tracks, railway or not any more, are rechecked');
  assert.doesNotMatch(regionQuery([0, 90, 45, 135]), /newer|\.cw/);
});

test('crossing regions: 45° squares cover the world; a quarter split covers its parent', () => {
  const regions = startRegions();
  assert.equal(regions.length, 32);
  assert.equal(regions.reduce((sum, {box: [s, w, n, e]}) => sum + (n - s) * (e - w), 0), 360 * 180);
  assert.deepEqual(quarters([0, 90, 45, 135]), [[0, 90, 22.5, 112.5], [0, 112.5, 22.5, 135], [22.5, 90, 45, 112.5], [22.5, 112.5, 45, 135]]);
});

test('crossing table: a full region response removes crossings no longer there; changes only add or move', () => {
  const table = new Map([[1, [10, 10, 'road', false]], [2, [10, 11, 'road', false]], [3, [50, 10, 'foot', false]]]);
  replaceRegion(table, [0, 0, 45, 45], [{id: 2, lat: 10, lon: 11.5, kind: 'foot', minor: false, tags: {}}, {id: 4, lat: 11, lon: 12, kind: 'road', minor: true, tags: {'crossing:barrier': 'half'}}]);
  assert.deepEqual([...table].sort((a, b) => a[0] - b[0]), [[2, [10, 11.5, 'foot', false, {}]], [3, [50, 10, 'foot', false]], [4, [11, 12, 'road', true, {'crossing:barrier': 'half'}]]], 'crossing 1 was deleted; 3 lies outside');
  applyChanges(table, [{id: 3, lat: 51, lon: 10, kind: 'foot', minor: true, tags: {description: 'a\tb'}}]);
  assert.deepEqual(table.get(3), [51, 10, 'foot', true, {description: 'a\tb'}]);
  assert.equal(table.size, 3);
  assert.deepEqual(readTable(writeTable(table)), table);
});

test('crossing tiles: overview multipoints per kind and minor flag, crossings on one spot drawn once; detail points keep their node id', () => {
  // Two nodes 1 m apart (both tracks of a line), one pedestrian crossing and
  // one on a tram line.
  const table = new Map([[101, [22.40000, 113.97000, 'road', false]], [102, [22.40001, 113.97000, 'road', false]], [103, [22.41, 113.98, 'foot', false]], [104, [22.42, 113.99, 'road', true]]]);
  const overview = buildTiles(table, OVERVIEW_ZOOM), detail = buildTiles(table, DETAIL_ZOOM, {detail: true});
  assert.deepEqual([...overview.keys()], ['5/26/13']);
  const o = layer(overview.get('5/26/13'));
  assert.equal(o.length, 3);
  const kinds = Object.fromEntries([0, 1, 2].map(i => [o.feature(i).properties.kind + (o.feature(i).properties.minor ? '-minor' : ''), o.feature(i).loadGeometry().flat().length]));
  assert.deepEqual(kinds, {road: 1, foot: 1, 'road-minor': 1});
  assert.equal(detail.size, 1);
  const d = layer([...detail.values()][0]);
  assert.deepEqual([...Array(d.length).keys()].map(i => [d.feature(i).id, d.feature(i).properties.kind, d.feature(i).properties.minor ?? false]).sort(), [[101, 'road', false], [102, 'road', false], [103, 'foot', false], [104, 'road', true]]);
});

test('crossing tiles: a crossing near a tile edge is also drawn in the neighbour, across the antimeridian too', () => {
  // Just east of 180°W: tile x 0 and, within the buffer, the last tile.
  const tiles = buildTiles(new Map([[7, [0.5, -179.9999, 'road', false]]]), DETAIL_ZOOM, {detail: true});
  assert.deepEqual([...tiles.keys()].sort(), ['9/0/255', '9/511/255']);
  const wrapped = layer(tiles.get('9/511/255')).feature(0).loadGeometry()[0][0];
  assert.ok(wrapped.x > 8192 && wrapped.x < 8192 + 128, 'drawn just beyond the right edge of the last tile');
});

test('style: crossing dots from zoom 5 in the Infrastructure view (not those on minor tracks), small × from 11, detailed × from 15', async () => {
  const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));
  const byId = Object.fromEntries(style.layers.map(l => [l.id, l]));
  assert.deepEqual([byId['infrastructure-crossing-overview'].minzoom, byId['infrastructure-crossing-overview'].maxzoom], [5, 9]);
  assert.deepEqual([byId['infrastructure-crossing-dots'].minzoom, byId['infrastructure-crossing-dots'].maxzoom], [9, 11]);
  assert.deepEqual([byId['infrastructure-crossing-marks'].minzoom, byId['infrastructure-crossing-marks'].maxzoom, byId['infrastructure-crossing-marks'].layout['icon-allow-overlap']], [11, 15, true]);
  assert.equal(byId['infrastructure-level-crossings'].minzoom, 15);
  for (const id of ['infrastructure-crossing-overview', 'infrastructure-crossing-dots']) {
    const filter = featureFilter(byId[id].filter);
    assert.equal(filter.filter({zoom: 8}, {type: 1, properties: {kind: 'road'}}), true, id);
    assert.equal(filter.filter({zoom: 8}, {type: 1, properties: {kind: 'road', minor: true}}), false, `${id}: tram, light rail and service-track crossings wait for zoom 11`);
  }
  assert.equal(byId['infrastructure-crossing-marks'].filter, undefined, 'every crossing from zoom 11');
  for (const id of ['infrastructure-crossing-overview', 'infrastructure-crossing-dots', 'infrastructure-crossing-marks']) assert.equal(byId[id].layout.visibility, 'none', 'shown only in the Infrastructure view');
  assert.deepEqual([style.sources.crossingsOverview.minzoom, style.sources.crossingsOverview.maxzoom, style.sources.crossingsDetail.minzoom], [5, 5, 9]);
});

test('crossing tags: the query asks for every shown tag; values with tabs or line breaks stay in their row', () => {
  assert.ok(regionQuery([0, 90, 45, 135]).startsWith(`[out:csv(::id,::lat,::lon,railway,${TAG_KEYS.map(key => `"${key}"`).join(',')};false)]`));
  const tagged = (values) => TAG_KEYS.map(key => values[key] ?? '');
  const text = [[5, 22.3, 113.9, 'level_crossing', ...tagged({'crossing:barrier': 'full', 'crossing:light': 'yes', ref: '12'})].join('\t'),
    [6, 22.4, 114.0, 'crossing', ...tagged({name: 'Mill\tLane', description: 'first line\nsecond\tpart'})].join('\t'),
    ['1', '', '', 'minor', ...tagged({})].join('\t'), ['2', '', '', 'end', ...tagged({})].join('\t')].join('\n') + '\n';
  const rows = parseCsv(text);
  assert.deepEqual(rows[0].tags, {'crossing:barrier': 'full', 'crossing:light': 'yes', ref: '12'});
  assert.equal(rows.length, 2, 'a line break inside a value does not start a row');
  assert.equal(rows[1].tags.description.includes('second'), true, 'overflowing text joins the final free-text column');
  assert.throws(() => parseCsv('stray text\n1\t\t\tminor\n2\t\t\tend\n'), /Unexpected/);
  const table = new Map([[5, [22.3, 113.9, 'road', false, rows[0].tags]], [6, [22.4, 114.0, 'foot', true, {name: 'a\tb\nc'}]]]);
  assert.deepEqual(readTable(writeTable(table)), table, 'tags survive the table file, tabs and line breaks included');
  const byId = {};
  for (const tile of buildTiles(table, DETAIL_ZOOM, {detail: true}).values()) { const d = layer(tile); for (let i = 0; i < d.length; i++) byId[d.feature(i).id] = d.feature(i).properties; }
  assert.deepEqual(byId[5], {kind: 'road', 'crossing:barrier': 'full', 'crossing:light': 'yes', ref: '12'}, 'detail tiles carry the tags, so a click needs no request');
  assert.deepEqual(byId[6], {kind: 'foot', minor: true, name: 'a\tb\nc'});
  for (const tile of buildTiles(table, OVERVIEW_ZOOM).values()) for (let i = 0, o = layer(tile); i < o.length; i++) assert.deepEqual(Object.keys(o.feature(i).properties).filter(k => k !== 'minor'), ['kind'], 'overview tiles stay tag-free');
});
