// Authentic archived compiled timetable replay, not raw GTFS acquisition.
// All dates, route records and compressed input bytes remain unchanged.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import Pbf from 'pbf';
import {VectorTile} from '@mapbox/vector-tile';
import vtpbf from 'vt-pbf';
import {LAYER} from './service-routes.mjs';
import {timetableFeatures} from './gtfs-service.mjs';
import {PARIS_PROBES, buildParisAcceptanceVariants, adversaryTiles, sha256} from './paris-service-geometry-fixture.mjs';

const fixtureFile = new URL('../tests/fixtures/service-geometry/normandy-20261005.json.gz', import.meta.url);
const metadataFile = new URL('../tests/fixtures/service-geometry/normandy-metadata.json', import.meta.url);
const probesFile = new URL('../tests/fixtures/service-geometry/normandy-probes.json', import.meta.url);
// Literal paths keep the complete binary/metadata dependency closure in CI.
const archivedTileFiles = [new URL('../tests/fixtures/service-geometry/normandy-20261005-12-2074-1408.pbf.gz', import.meta.url),
  new URL('../tests/fixtures/service-geometry/normandy-20261005-12-2074-1409.pbf.gz', import.meta.url)];
export const NORMANDY_SHA256 = '9de5d10c8f35d51670115e582100ab1212843f76f63ab365afe699e6db22fbff';
export const NORMANDY_JSON_SHA256 = '7e96edecf52cb72663149e2e4385ea51bcc31ea8c438c46558b98042bbd542b0';
export const NORMANDY_CLOCKS = {absent: '2026-10-05T12:00:00Z', present: '2026-10-05T12:00:00Z', expired: '2027-01-07T12:00:00Z'};

export function normandyProbePoint(segment, endpoint, fraction) {
  assert.equal(segment.geometry.length, 2);
  assert.ok(segment.geometry.some(point => JSON.stringify(point) === JSON.stringify(endpoint)));
  const project = ([x, y]) => [(x + 180) / 360, (1 - Math.asinh(Math.tan(y * Math.PI / 180)) / Math.PI) / 2];
  const start = project(endpoint), end = project(segment.geometry.find(point => JSON.stringify(point) !== JSON.stringify(endpoint)));
  const [x, y] = start.map((value, axis) => value + (end[axis] - value) * fraction);
  return [x * 360 - 180, Math.atan(Math.sinh((1 - 2 * y) * Math.PI)) * 180 / Math.PI];
}

export async function loadNormandyFixture() {
  const [bytes, metadataText, probesText] = await Promise.all([readFile(fixtureFile), readFile(metadataFile, 'utf8'), readFile(probesFile, 'utf8')]);
  const metadata = JSON.parse(metadataText), probeMetadata = JSON.parse(probesText);
  assert.equal(bytes.length, 15279, 'bounded pinned historical gzip');
  assert.equal(sha256(bytes), NORMANDY_SHA256);
  const raw = gunzipSync(bytes, {maxOutputLength: 556608});
  assert.equal(raw.length, 556608);
  assert.equal(sha256(raw), NORMANDY_JSON_SHA256, 'exact archived JSON bytes, not a reserialized feed');
  assert.equal(metadata.fixture_compressed_sha256, NORMANDY_SHA256);
  assert.equal(metadata.fixture_expanded_sha256, NORMANDY_JSON_SHA256);
  assert.equal(probeMetadata.compiledSha256, NORMANDY_JSON_SHA256);
  const feed = JSON.parse(raw);
  assert.deepEqual(feed.source, metadata.source, 'complete original attribution, dates and source metadata');
  const archivedTiles = new Map();
  for (let i = 0; i < archivedTileFiles.length; i++) {
    const record = metadata.archived_tiles[i], compressed = await readFile(archivedTileFiles[i]);
    assert.equal(compressed.length, record.compressed_bytes);
    assert.equal(sha256(compressed), record.compressed_sha256);
    const tile = gunzipSync(compressed, {maxOutputLength: 100000});
    assert.equal(tile.length, record.expanded_bytes);
    assert.equal(sha256(tile), record.expanded_sha256);
    archivedTiles.set(record.path.replace(/^tiles\//, '').replace(/\.pbf\.gz$/, ''), tile);
  }
  const probes = probeMetadata.terminals.map(record => {
    const positive = PARIS_PROBES.find(probe => probe.id === record.terminal);
    assert.ok(positive);
    for (const probe of record.negativeProbes) {
      const segment = feed.segments[probe.segmentIndex];
      assert.equal(segment.route_id, probe.routeId);
      assert.deepEqual(probe.point, normandyProbePoint(segment, record.endpoint, probe.fractionFromTerminal), 'probe lies on its authentic projected source segment');
    }
    return {...positive, label: positive.label + ' · historical Normandy', negativeProbes: record.negativeProbes};
  });
  return {bytes, raw, feed, metadata, probeMetadata, probes, archivedTiles};
}

export function archivedNormandyOnlyTiles(archivedTiles, sourceId) {
  const result = new Map();
  for (const [key, bytes] of archivedTiles) {
    const layer = new VectorTile(new Pbf(bytes)).layers[LAYER];
    const features = Array.from({length: layer.length}, (_, i) => layer.feature(i))
      .filter(feature => String(feature.properties.id).startsWith(`gtfs:${sourceId}:`));
    // Preserve archived integer geometry and properties. Only unrelated source
    // records are omitted; the pinned original PBFs are never edited.
    result.set(key, Buffer.from(vtpbf.fromVectorTileJs({layers: {[LAYER]: {
      name: LAYER, version: layer.version, extent: layer.extent, length: features.length, feature: i => features[i],
    }}})));
  }
  return result;
}

export async function buildNormandyAcceptanceVariants() {
  const fixture = await loadNormandyFixture();
  const built = await buildParisAcceptanceVariants({
    compiledInput: {bytes: fixture.bytes, feed: fixture.feed, output: fixture.metadata.archive_member},
    variantClocks: NORMANDY_CLOCKS,
    scenario: {catalogueSha256: sha256(fixture.feed.source.id), catalogueURL: fixture.metadata.workflow_run_url,
      gaps: [{region: 'Paris historical regression', status: 'Archived single-feed replay', reason: 'Authentic October 5 compiled extract; no current coverage claim'}]},
  });
  try {
    const forbiddenFeatures = timetableFeatures([fixture.feed], Date.parse(NORMANDY_CLOCKS.present)).local;
    const forbiddenTiles = adversaryTiles(forbiddenFeatures);
    const archived = archivedNormandyOnlyTiles(fixture.archivedTiles, fixture.feed.source.id);
    for (const [key, bytes] of archived) forbiddenTiles.set(key, bytes);
    return {...built, probes: fixture.probes, forbiddenFeatures, forbiddenTiles,
      metadata: {...built.metadata, normandy: fixture.metadata, probeEvidence: fixture.probeMetadata,
        replayClocks: NORMANDY_CLOCKS,
        mutation: 'Original compiled segment geometry for regional tiles; original archived Normandy PBF records for both z12 terminal tiles and z16 overzoom. No synthetic chord coordinates.'}};
  } catch (error) {await built.dispose(); throw error;}
}
