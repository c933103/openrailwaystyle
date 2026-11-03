import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {EXTRACT_FILTERS, REFINEMENTS, HERITAGE_HISTORIC, expressionsFile, expressionKeys, keyMatches, selectedKey, selectsTag} from '../scripts/extract-filter.mjs';
import {CONVEYING_QUERY, AERIALWAY_QUERY} from '../scripts/conveying-data.mjs';
import {BRANCH_SELECTS} from '../scripts/branch-lines.mjs';
import {SERVICE_SELECTS} from '../scripts/service-routes.mjs';
import {heritageQuery} from '../scripts/heritage-data.mjs';
import {signalQuery, combinedSignalQuery, electricWithDirectionQuery} from '../scripts/signals-data.mjs';
import {electricitySignalQuery} from '../scripts/electricity-signal-data.mjs';
import {stationWorldQuery} from '../scripts/station-acquisition.mjs';
import {regionQuery as crossingQuery} from '../scripts/crossing-data.mjs';
import {powerFacilityQuery} from '../scripts/power-facility-data.mjs';
import {powerMethodQuery} from '../scripts/power-method-data.mjs';
import {STATES} from '../scripts/lifecycle.mjs';

const box = [0, 0, 1, 1];
// The queries of every dataset the extract pipeline is to serve, as the
// builders send them. Three builders keep theirs inside a script that runs on
// import; their selectors are read from the source and pinned below.
const QUERIES = {
  conveying: CONVEYING_QUERY, aerialways: AERIALWAY_QUERY,
  branch: BRANCH_SELECTS.join(''), service: SERVICE_SELECTS.join(''),
  heritage: heritageQuery(box),
  signals: signalQuery(box) + combinedSignalQuery(box) + electricWithDirectionQuery(box) + electricitySignalQuery(box),
  stations: stationWorldQuery(), crossings: crossingQuery(box),
  powerFacilities: powerFacilityQuery(box), powerMethods: powerMethodQuery(box),
  lifecycle: STATES.map(state => `way[railway~"^(${STATES.join('|')})$"];way["${state}:railway"~"^(rail)$"];`).join(''),
  streetRunning: 'way[embedded=yes];way[embedded_rails];',
  loadingGauges: 'way[railway~"^(rail)$"][loading_gauge];',
};
const SETTINGS = /^(out|timeout|maxsize|date|adiff|diff|bbox)(:|$)/;

// The tag keys an Overpass QL text tests, negations left out (a filter that
// selects more is fine).
export function queryKeys(ql) {
  const keys = new Set();
  for (const [, not, quoted, bare] of ql.matchAll(/\[\s*(!)?\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_:]*))\s*(?=[\]=!~,])/g)) {
    const key = quoted ?? bare;
    if (!not && !SETTINGS.test(key)) keys.add(key);
  }
  for (const [, key] of ql.matchAll(/is_tag\("([^"]+)"\)/g)) keys.add(key);
  return keys;
}

test('every key an Overpass query tests is selected by the filter or is a listed refinement', () => {
  const missing = [];
  for (const [dataset, ql] of Object.entries(QUERIES)) {
    const keys = queryKeys(ql);
    assert.ok(keys.size, `${dataset}: no keys found`);
    for (const key of keys) if (!selectedKey(key) && !Object.hasOwn(REFINEMENTS, key)) missing.push(`${dataset}: ${key}`);
  }
  assert.deepEqual(missing, []);
});

test('the primary key of each dataset is selected, not only listed as a refinement', () => {
  for (const key of ['railway', 'disused:railway', 'railway:signal:electricity', 'railway:electricity', 'public_transport', 'conveying', 'highway',
    'aerialway', 'historic', 'protect_class', 'heritage', 'embedded', 'embedded_rails', 'electrified', 'abandoned:electrified', 'propulsion',
    'traction', 'removed:railway:electricity', 'substation', 'transformer', 'landuse', 'frequency', 'usage', 'route', 'train']) {
    assert.ok(selectedKey(key), key);
  }
  assert.equal(selectedKey('building'), false);
  assert.equal(selectedKey('name'), false);
  assert.equal(selectedKey('power'), false, 'power alone would bring every power line; facilities need a railway hint');
});

test('the inline queries of the snapshot, street-running and loading-gauge builders still read as pinned here', () => {
  const source = name => readFileSync(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
  assert.match(source('build-snapshot.mjs'), /way\[railway~"\^\(\$\{STATES\.join\('\|'\)\}\)\$"\]\(\$\{box\}\);`, \.\.\.STATES\.map\(s => `way\["\$\{s\}:railway"~"\^\(\$\{tracks\}\)\$"\]/);
  assert.match(source('build-street-running.mjs'), /\(way\[embedded=yes\];way\[embedded_rails\];\)/);
  assert.match(source('build-loading-gauge-list.mjs'), /way\[railway~"\^\([a-z_|]+\)\$"\]\[loading_gauge\]/);
});

// The power queries match railway hints as whole semicolon-separated tokens
// without case (scripts/power-facility-data.mjs, power-method-data.mjs).
const token = words => new RegExp(`(^|;)\\s*(${words})\\s*(;|$)`, 'i');
// Exhaust every independent ASCII capitalization, including a token embedded
// in semicolon-separated values. This checks the query's case-insensitive
// contract separately from the filter's own wildcard-matching implementation.
const asciiCases = word => [...word].reduce((prefixes, char) =>
  prefixes.flatMap(prefix => [prefix + char, prefix + char.toUpperCase()]), ['']);
test('all ASCII case combinations of railway hints are selected', () => {
  for (const [key, word] of [['usage', 'railway'], ['usage', 'traction'], ['landuse', 'railway']]) {
    const forms = asciiCases(word);
    assert.equal(forms.length, 2 ** word.length);
    for (const form of forms) {
      for (const value of [form, `distribution; ${form} ;industrial`]) {
        assert.ok(token(word).test(value), `${key}=${value} is a hint to the Overpass query`);
        assert.ok(selectsTag(key, value), `${key}=${value} is selected`);
      }
    }
  }
  for (const [key, value] of [['usage', 'transmission'], ['usage', 'distribution'], ['landuse', 'residential'], ['landuse', 'industrial']]) {
    assert.equal(selectsTag(key, value), false, `${key}=${value}: these unrelated values stay out`);
  }
  // Short substrings deliberately select some unrelated values too.
  assert.equal(selectsTag('usage', 'manufacturing'), true);
});

test('heritage values follow the heritage query', () => {
  assert.match(heritageQuery(box), new RegExp(`historic~"\\^\\(${HERITAGE_HISTORIC.join('\\|')}\\)\\$"`));
});

test('key matching follows osmium: a star at either end is a wildcard', () => {
  assert.ok(keyMatches('*:railway', 'disused:railway'));
  assert.ok(!keyMatches('*:railway', 'railway'));
  assert.ok(keyMatches('railway:*', 'railway:signal:direction'));
  assert.ok(keyMatches('*rail*', 'embedded_rails'));
  assert.ok(!keyMatches('railway', 'railway:signal'));
  assert.deepEqual(expressionKeys('w/embedded,embedded_rails'), ['embedded', 'embedded_rails']);
  assert.deepEqual(expressionKeys('nwr/usage=*railway*'), ['usage']);
});

test('the expressions file has one expression per line, each with an object type', () => {
  const lines = expressionsFile().trimEnd().split('\n');
  assert.equal(lines.length, EXTRACT_FILTERS.length);
  for (const line of lines) assert.match(line, /^(n|w|r|nw|nr|wr|nwr)\/[^\s]+$/);
  for (const {use} of EXTRACT_FILTERS) assert.ok(use);
});

// A real osmium run over a synthetic file, where osmium is installed (the
// extract workflow installs it; the site CI does not).
const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('osmium selects what the datasets need and leaves the rest out', {skip: osmium.status !== 0 && 'osmium is not installed'}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'extract-filter-'));
  try {
    const tag = (k, v) => `<tag k="${k}" v="${v}"/>`;
    const node = (id, ...tags) => `<node id="${id}" version="1" lat="0" lon="0">${tags.join('')}</node>`;
    const way = (id, nodes, ...tags) => `<way id="${id}" version="1">${nodes.map(n => `<nd ref="${n}"/>`).join('')}${tags.join('')}</way>`;
    const kept = [
      node(1, tag('railway', 'level_crossing')), node(2, tag('railway', 'signal'), tag('railway:signal:direction', 'forward')),
      node(3, tag('disused:railway', 'station')), node(4, tag('public_transport', 'station'), tag('train', 'yes')),
      node(5, tag('power', 'substation'), tag('substation', 'traction')), node(6, tag('power', 'substation'), tag('usage', 'Distribution;traction')),
      node(7, tag('power', 'transformer'), tag('frequency', '16.7')), node(8, tag('amenity', 'charging_station'), tag('tram', 'yes')),
      node(11, tag('power', 'plant'), tag('usage', 'Railway')), node(12, tag('power', 'substation'), tag('usage', 'TRACTION')),
      node(13, tag('man_made', 'water_tower'), tag('landuse', 'Railway;industrial')),
      node(15, tag('power', 'plant'), tag('usage', 'rAiLwAy')), node(16, tag('power', 'plant'), tag('usage', 'tRaCtIoN')),
      node(17, tag('landuse', 'rAiLwAy;industrial')),
    ];
    // Exercise every ASCII hint casing against real osmium, not only the
    // JavaScript matcher above. These fixtures have no other selecting tag.
    const variants = [['usage', 'railway'], ['usage', 'traction'], ['landuse', 'railway']]
      .flatMap(([key, word]) => asciiCases(word).map(form => [key, `other; ${form} ;industrial`]));
    const variantIds = variants.map((_, index) => 500 + index);
    kept.push(...variants.map(([key, value], index) => node(variantIds[index], tag(key, value))));
    const ways = [
      way(100, [20, 21], tag('railway', 'rail'), tag('usage', 'branch')), way(101, [22, 23], tag('embedded_rails', 'tram')),
      way(102, [24, 25], tag('conveying', 'yes')), way(103, [26, 27], tag('highway', 'elevator')), way(104, [28, 29], tag('aerialway', 'gondola')),
      way(105, [30, 31, 32, 30], tag('historic', 'battlefield')), way(106, [33, 34], tag('abandoned:electrified', 'rail')),
      way(107, [35, 36], tag('railway', 'tram'), tag('propulsion', 'linear_motor')),
    ];
    const dropped = [node(9, tag('power', 'tower')), node(10, tag('name', 'x')), node(14, tag('landuse', 'residential')), way(200, [40, 41], tag('highway', 'primary')),
      way(201, [42, 43], tag('power', 'line'), tag('usage', 'transmission')), way(202, [44, 45, 46, 44], tag('historic', 'memorial'))];
    const plainNodes = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 40, 41, 42, 43, 44, 45, 46].map(id => node(id));
    const relations = '<relation id="300" version="1"><member type="way" ref="100" role=""/>' + tag('type', 'route') + tag('route', 'subway') + '</relation>'
      + '<relation id="301" version="1"><member type="way" ref="200" role=""/>' + tag('type', 'route') + tag('route', 'bus') + '</relation>';
    writeFileSync(join(dir, 'in.osm'), `<?xml version="1.0"?><osm version="0.6">${[...kept, ...dropped.slice(0, 2), ...plainNodes, ...ways, ...dropped.slice(2), relations].join('')}</osm>`);
    writeFileSync(join(dir, 'filter.txt'), expressionsFile());
    const run = spawnSync('osmium', ['tags-filter', join(dir, 'in.osm'), '-e', join(dir, 'filter.txt'), '-f', 'opl', '-o', '-'], {encoding: 'utf8'});
    assert.equal(run.status, 0, run.stderr);
    const ids = new Set(run.stdout.trim().split('\n').map(line => line.split(' ')[0]));
    for (const id of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n11', 'n12', 'n13', 'n15', 'n16', 'n17', 'w100', 'w101', 'w102', 'w103', 'w104', 'w105', 'w106', 'w107', 'r300']) assert.ok(ids.has(id), `${id} kept`);
    for (const id of variantIds) assert.ok(ids.has(`n${id}`), `n${id}: ASCII hint selected by osmium`);
    for (const id of ['n20', 'n21', 'n30', 'n35']) assert.ok(ids.has(id), `${id}: nodes of a selected way are kept`);
    for (const id of ['n9', 'n10', 'n14', 'w200', 'w201', 'w202', 'r301', 'n40', 'n42']) assert.ok(!ids.has(id), `${id} left out`);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
