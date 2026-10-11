// Real pinned Paris OSM coverage; synthetic timetable contamination controls.
// No network access or fresh extraction. The archived source is already simplified
// and lacks source/version/node evidence: never upgrade its unknown provenance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, writeFile, mkdir, mkdtemp, cp, symlink, readdir, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname, resolve, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync, gzipSync} from 'node:zlib';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {readTable, LAYER} from './service-routes.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureDirectory = new URL('../tests/fixtures/service-geometry/', import.meta.url);
// Literal references are intentional: the CI browser-dependency closure reads them.
const fixtureParts = [new URL('../tests/fixtures/service-geometry/paris-osm-01.ndjson', import.meta.url),
  new URL('../tests/fixtures/service-geometry/paris-osm-02.ndjson', import.meta.url)];
const assemblyScript = new URL('./assemble-global-frequency.mjs', import.meta.url);
const rebuildScript = new URL('./rebuild-service-frequency.mjs', import.meta.url);
const metadataFile = new URL('../tests/fixtures/service-geometry/paris-metadata.json', import.meta.url);
const adversaryFile = new URL('../tests/fixtures/service-geometry/paris-adversary.json', import.meta.url);
const clockPreload = new URL('./service-geometry-test-clock.mjs', import.meta.url);
export const PARIS_BBOX = [2.15, 48.76, 2.45, 48.95];
export const PARIS_SOURCE = {
  repository: 'https://github.com/c933103/openrailwaystyle', branch: 'service-data',
  commit: 'ba3ffbbfa24cb72d01a07022b526cced30b39cd7', path: 'service-routes.ndjson.gz',
  sha256: 'ac91e3d45e95248261914a2d54c7d110bc9c0bcebf6dca5ea2cd9052b75178bf',
};
export const PARIS_PROBES = [
  {id: 'saint-lazare', label: 'Saint-Lazare · Transilien L', center: [2.32388, 48.87712],
    positive: {point: [2.32388, 48.87712], relationIds: [12142599, 12142600], renderedRelationIds: [12142599], wayIds: [58191909, 58191938], ref: 'L'},
    negativeProbes: [{id: 'saint-lazare-forbidden-chord', point: [2.31988, 48.87737], zooms: [12, 16]},
      {id: 'saint-lazare-regional-chord', point: [2.25, 48.866], zooms: [7, 8, 9, 10, 11]}]},
  {id: 'montparnasse', label: 'Montparnasse · Métro 6', center: [2.31975, 48.84188],
    positive: {point: [2.31975, 48.84188], relationIds: [123912], renderedRelationIds: [123912], wayIds: [677923266], ref: '6'},
    negativeProbes: [{id: 'montparnasse-forbidden-chord', point: [2.31875, 48.83938], zooms: [12, 16]},
      {id: 'montparnasse-regional-chord', point: [2.245, 48.86], zooms: [7, 8, 9, 10, 11]}]},
];
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const inside = ([x, y], [west, south, east, north]) => x >= west && x <= east && y >= south && y <= north;
export function segmentCrossesBox(a, b, box = PARIS_BBOX) {
  let lo = 0, hi = 1;
  for (let axis = 0; axis < 2; axis++) {
    const delta = b[axis] - a[axis], min = box[axis], max = box[axis + 2];
    if (!delta) { if (a[axis] < min || a[axis] > max) return false; }
    else {
      const t = [(min - a[axis]) / delta, (max - a[axis]) / delta].sort((a, b) => a - b);
      lo = Math.max(lo, t[0]); hi = Math.min(hi, t[1]);
      if (lo > hi) return false;
    }
  }
  return true;
}
export function lineIntersectsBox(line, box = PARIS_BBOX) {
  return line.some(point => inside(point, box)) || line.slice(1).some((point, i) => segmentCrossesBox(line[i], point, box));
}
export function selectParisRows(source) {
  const rows = source.trimEnd().split('\n').map(text => ({text, row: JSON.parse(text)}));
  const ways = rows.filter(({row}) => row.type === 'way' &&
    [row.lines || [], ...Object.values(row.nextLines || {})].some(lines => lines.some(line => lineIntersectsBox(line))));
  const keys = new Set(ways.flatMap(({row}) => [...Object.values(row.routes || {}), ...Object.values(row.next || {})].flat()));
  const wanted = new Set(ways.map(({row}) => row.id));
  const selected = rows.filter(({row}) => row.type === 'route' ? keys.has(row.key) : wanted.has(row.id));
  const presentKeys = new Set(selected.filter(({row}) => row.type === 'route').map(({row}) => row.key));
  assert.deepEqual([...keys].filter(key => !presentKeys.has(key)), [], 'every selected membership has its source relation row');
  return {text: selected.map(({text}) => text + '\n').join(''), ways: ways.length, relations: keys.size};
}
export async function extractParisFixture(sourcePath, destination = fileURLToPath(fixtureDirectory)) {
  const bytes = await readFile(sourcePath);
  assert.equal(sha256(bytes), PARIS_SOURCE.sha256, 'only the pinned published snapshot is accepted');
  const selected = selectParisRows(gunzipSync(bytes).toString());
  const parts = [''];
  for (const row of selected.text.trimEnd().split('\n')) {
    if (Buffer.byteLength(parts.at(-1) + row + '\n') > 250000) parts.push('');
    parts[parts.length - 1] += row + '\n';
  }
  assert.equal(parts.length, 2, 'update explicit fixture paths if the pinned extract changes');
  await mkdir(destination, {recursive: true});
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const name = `paris-osm-${String(i + 1).padStart(2, '0')}.ndjson`;
    await writeFile(join(destination, name), parts[i]);
    files.push({path: name, bytes: Buffer.byteLength(parts[i]), sha256: sha256(parts[i])});
  }
  const buildFiles = ['scripts/service-routes.mjs', 'scripts/service-geometry.mjs', 'scripts/service-relations.mjs',
    'scripts/rebuild-service-frequency.mjs', 'scripts/assemble-global-frequency.mjs', 'styles/service-frequency.mjs'];
  const build = {baseline: 'PR #146 dfdc858; source tree 2019bcf',
    files: Object.fromEntries(await Promise.all(buildFiles.map(async path => [path, sha256(await readFile(join(root, path)))])))};
  const metadata = {schema: 1, source: PARIS_SOURCE, bbox: PARIS_BBOX,
    selection: 'Keep complete unchanged way rows if any vertex lies in, or any segment intersects, the closed bbox. Include all route rows referenced by accepted or pending memberships. Preserve input row order.',
    ways: selected.ways, relations: selected.relations, bytes: Buffer.byteLength(selected.text), sha256: sha256(selected.text), files, build,
    provenance: 'Real published OSM-derived legacy simplified lines. Source snapshot time, raw node IDs, way versions and unsimplified geometry are unavailable; completeness remains unknown.',
    attribution: '© OpenStreetMap contributors, ODbL 1.0', license: 'https://www.openstreetmap.org/copyright',
    reproduction: 'node scripts/paris-service-geometry-fixture.mjs --extract /path/to/pinned/service-routes.ndjson.gz',
    limitation: 'Synthetic timetable adversaries are not authentic Normandy SNCF bytes. This fixture does not resolve issue #107 or certify current live OSM coverage.'};
  await writeFile(join(destination, 'paris-metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  return metadata;
}
export async function loadParisFixture() {
  const metadata = JSON.parse(await readFile(metadataFile, 'utf8'));
  const parts = await Promise.all(fixtureParts.map(path => readFile(path, 'utf8')));
  for (let i = 0; i < parts.length; i++) {
    assert.equal(sha256(parts[i]), metadata.files[i].sha256, `pinned Paris part ${i + 1}`);
    assert.equal(Buffer.byteLength(parts[i]), metadata.files[i].bytes);
  }
  const text = parts.join('');
  assert.equal(sha256(text), metadata.sha256);
  return {text, table: readTable(text), metadata};
}
export async function parisAdversaryFeed({expired = false} = {}) {
  const data = JSON.parse(await readFile(adversaryFile, 'utf8'));
  const feed = structuredClone(data.feed);
  if (expired) {
    feed.source.checked = '2000-01-01'; feed.source.valid_until = 946684800;
    feed.source.feed_info.feed_end_date = '20000101';
  }
  return {feed, stopOnlyCandidates: data.stopOnlyCandidates};
}
export function decodeParisTiles(tiles, zoom) {
  const features = [];
  for (const [key, bytes] of [...tiles].sort(([a], [b]) => a.localeCompare(b))) {
    const [z, x, y] = key.split('/').map(Number);
    if (zoom !== undefined && z !== zoom) continue;
    const layer = new VectorTile(new Pbf(bytes)).layers[LAYER];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) features.push({key, ...layer.feature(i).toGeoJSON(x, y, z)});
  }
  return features;
}
export function pointLineDistanceMeters(point, line) {
  const sx = Math.cos(point[1] * Math.PI / 180) * 111320, sy = 111320;
  let distance = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = [(line[i - 1][0] - point[0]) * sx, (line[i - 1][1] - point[1]) * sy];
    const b = [(line[i][0] - point[0]) * sx, (line[i][1] - point[1]) * sy];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy || 1)));
    distance = Math.min(distance, Math.hypot(a[0] + t * dx, a[1] + t * dy));
  }
  return distance;
}
export function featureDistanceMeters(point, features) {
  return Math.min(...features.flatMap(feature =>
    (feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates)
      .map(line => pointLineDistanceMeters(point, line))));
}
export function parisAdversaryFeatures(feed) {
  return feed.segments.filter(segment => segment.geometry?.length >= 2).map((segment, index) => ({
    type: 'Feature', properties: {id: `gtfs:${feed.source.id}:${segment.route_id}`, ref: 'FORBIDDEN',
      name: 'SYNTHETIC forbidden timetable chord', colour: '#ff00ff', kind: 'commuter', network: 'Synthetic audit', operator: 'Synthetic audit', i: 0, n: 1, slot: 0},
    geometry: {type: 'LineString', coordinates: segment.geometry},
  }));
}
export function adversaryTiles(features) {
  const tiles = new Map();
  const index = geojsonvt({type: 'FeatureCollection', features}, {maxZoom: 12, indexMaxZoom: 12, indexMaxPoints: 0, tolerance: 1, extent: 4096, buffer: 64});
  for (const {z, x, y} of index.tileCoords) {
    if (z < 7) continue;
    const tile = index.getTile(z, x, y);
    if (tile?.features.length) tiles.set(`${z}/${x}/${y}`, vtpbf.fromGeojsonVt({[LAYER]: tile}, {version: 2}));
  }
  return tiles;
}
// Inject into the same MVT layer, retaining original integer tile coordinates.
// This is test-only fault injection, never a production output or fixture variant.
export function injectParisAdversaryTiles(tiles, forbiddenTiles = adversaryTiles(parisAdversaryFeatures({
  source: {id: 'synthetic-paris-chords'}, segments: PARIS_PROBES.flatMap(terminal => terminal.negativeProbes.map(probe => {
    const [x, y] = probe.point, length = probe.zooms.includes(7) ? .015 : .001;
    return {route_id: probe.id, geometry: [[x - length, y], [x + length, y]]};
  })),
}))) {
  const result = new Map(tiles);
  for (const [key, forbidden] of forbiddenTiles) {
    const layers = [tiles.get(key), forbidden].filter(Boolean).map(bytes => new VectorTile(new Pbf(bytes)).layers[LAYER]);
    const features = layers.flatMap(layer => Array.from({length: layer.length}, (_, i) => layer.feature(i)));
    result.set(key, Buffer.from(vtpbf.fromVectorTileJs({layers: {[LAYER]: {
      name: LAYER, version: 2, extent: 4096, length: features.length, feature: i => features[i],
    }}})));
  }
  return result;
}
async function exists(path) { try { await stat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function filesUnder(directory) {
  const out = [];
  if (!await exists(directory)) return out;
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(path)); else out.push(path);
  }
  return out;
}
// Both commands execute unchanged production files from the current checkout,
// with all inputs/outputs isolated. No --fixtures shortcut or handmade output.
export async function buildParisAcceptanceVariants({compiledInput, variantClocks = {}, scenario = {}} = {}) {
  const fixture = await loadParisFixture(), workspace = await mkdtemp(join(tmpdir(), 'atlas-paris-acceptance-'));
  const cleanup = () => rm(workspace, {recursive: true, force: true});
  try {
    const variants = [];
    for (const id of ['absent', 'present', 'expired']) {
      const clock = variantClocks[id];
      const clockArgs = clock ? ['--import', fileURLToPath(clockPreload)] : [];
      const commandOptions = {env: {...process.env, ...(clock && {ATLAS_GEOMETRY_TEST_TIME: clock})}};
      const directory = join(workspace, id), service = join(directory, 'styles/data/service-routes');
      const frequency = join(directory, 'styles/data/service-frequency');
      await cp(join(root, 'scripts'), join(directory, 'scripts'), {recursive: true});
      await mkdir(join(directory, 'styles/data-src'), {recursive: true});
      await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
      for (const name of ['service-frequency.mjs', 'pbf-utf8.mjs', 'service-headways.json'])
        await cp(join(root, 'styles', name), join(directory, 'styles', name));
      await mkdir(service, {recursive: true});
      await writeFile(join(service, 'service-routes.ndjson.gz'), gzipSync(fixture.text));
      const staleService = join(service, '6/0/0.pbf.gz');
      const staleIndexed = join(service, '12/0/0.pbf.gz');
      await mkdir(dirname(staleService), {recursive: true}); await mkdir(dirname(staleIndexed), {recursive: true});
      await writeFile(staleService, gzipSync('stale')); await writeFile(staleIndexed, gzipSync('stale'));
      await writeFile(join(service, 'index.json'), JSON.stringify({tiles: ['6/0/0', '12/0/0']}));
      let assemblyManifest = null, assemblyTiles = [], assemblyFiles = [], assemblyLog = '';
      const registry = {schema: 2, feeds: [], gaps: scenario.gaps || [{region: 'Paris acceptance', status: 'Synthetic audit', reason: 'No real timetable claim'}]};
      let inputSha256 = null;
      if (id !== 'absent') {
        const {feed, stopOnlyCandidates = []} = compiledInput || await parisAdversaryFeed({expired: id === 'expired'});
        const output = compiledInput?.output || 'feeds/paris-synthetic.json.gz';
        const inputBytes = compiledInput?.bytes || gzipSync(JSON.stringify(feed));
        inputSha256 = sha256(inputBytes);
        await mkdir(join(frequency, 'feeds'), {recursive: true});
        await writeFile(join(frequency, output), inputBytes);
        await writeFile(join(frequency, 'feeds/stale.json.gz'), gzipSync('stale'));
        await mkdir(join(frequency, 'tiles/12/0'), {recursive: true});
        await writeFile(join(frequency, 'tiles/12/0/0.pbf.gz'), gzipSync('stale standalone timetable line'));
        await writeFile(join(frequency, 'stop-only-candidates.json'), JSON.stringify(stopOnlyCandidates));
        const inventory = {schema: 2, shard: 0, shards: 1, catalogue_sha256: scenario.catalogueSha256 || sha256('synthetic-paris-acceptance'), catalogue_entries: 1,
          service_date: feed.source.service_date, catalogue_url: scenario.catalogueURL || 'https://example.invalid/synthetic-paris-acceptance',
          entries: [{id: feed.source.id, status: 'compiled', output, sha256: feed.source.sha256, country: 'FR'}]};
        await writeFile(join(frequency, 'inventory-0.json'), JSON.stringify(inventory));
        assemblyLog = (await run(process.execPath, [...clockArgs, join(directory, 'scripts', basename(fileURLToPath(assemblyScript))), frequency], {...commandOptions, cwd: directory})).stdout;
        assemblyManifest = JSON.parse(await readFile(join(frequency, 'manifest.json'), 'utf8'));
        assemblyTiles = JSON.parse(await readFile(join(frequency, 'tiles/index.json'), 'utf8')).tiles;
        assemblyFiles = (await filesUnder(join(frequency, 'tiles'))).map(path => path.slice(frequency.length + 1));
        registry.feeds.push({id: feed.source.id, output: `../data/service-frequency/${output}`});
        assert.equal(sha256(await readFile(join(frequency, output))), inputSha256, 'production assembly retains exact compiled input bytes');
        assert.equal(await exists(join(frequency, 'feeds/stale.json.gz')), false, 'assembly prunes orphan feeds');
      }
      await writeFile(join(directory, 'styles/data-src/service-frequency-sources.json'), JSON.stringify(registry));
      const rebuildLog = (await run(process.execPath, [...clockArgs, join(directory, 'scripts', basename(fileURLToPath(rebuildScript))), service, join(directory, 'credits.html')], {...commandOptions, cwd: directory})).stdout;
      if (compiledInput && id !== 'absent') assert.equal(sha256(await readFile(join(frequency, compiledInput.output))), inputSha256, 'production rebuild retains exact historical input bytes');
      const index = JSON.parse(await readFile(join(service, 'index.json'), 'utf8'));
      const tiles = new Map(await Promise.all(index.tiles.map(async key => [key, gunzipSync(await readFile(join(service, key + '.pbf.gz')))])));
      const manifest = JSON.parse(await readFile(join(service, 'frequency-manifest.json'), 'utf8'));
      const outputFiles = (await filesUnder(service)).filter(path => path.endsWith('.pbf.gz')).map(path => path.slice(service.length + 1).replace(/\.pbf\.gz$/, '')).sort();
      variants.push({id, tiles, manifest, assemblyManifest, assemblyTiles, assemblyFiles, outputFiles, inputSha256, clock: clock || null,
        staleOutputsRemoved: !await exists(staleService) && !await exists(staleIndexed), assemblyLog, rebuildLog});
    }
    const {feed, stopOnlyCandidates = []} = compiledInput || await parisAdversaryFeed();
    const runtimeBuild = {commit: process.env.GITHUB_SHA || null, ...(compiledInput ? {compiledInputSha256: sha256(compiledInput.bytes)} : {adversarySha256: sha256(await readFile(adversaryFile))}), files: Object.fromEntries(await Promise.all(Object.keys(fixture.metadata.build.files).map(async path => [path, sha256(await readFile(join(root, path)))])))};
    const forbiddenFeatures = compiledInput ? [] : parisAdversaryFeatures(feed);
    return {metadata: {...fixture.metadata, runtimeBuild}, probes: PARIS_PROBES, variants, forbiddenFeatures,
      forbiddenTiles: adversaryTiles(forbiddenFeatures), stopOnlyCandidates, cleanup, dispose: cleanup, workspace};
  } catch (error) { await cleanup(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv[2], '--extract', 'usage: node scripts/paris-service-geometry-fixture.mjs --extract PINNED_GZIP [OUTPUT_DIR]');
  console.log(JSON.stringify(await extractParisFixture(process.argv[3], process.argv[4]), null, 2));
}
