// Exact historical Normandy compiled bytes, production CLI replay, and real
// archived PBF mutation controls. These tests do not inspect raw GTFS shapes.
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildTiles} from '../scripts/service-routes.mjs';
import {timetableFeatures} from '../scripts/gtfs-service.mjs';
import {loadParisFixture, decodeParisTiles, featureDistanceMeters, injectParisAdversaryTiles,
  adversaryTiles, sha256} from '../scripts/paris-service-geometry-fixture.mjs';
import {loadNormandyFixture, buildNormandyAcceptanceVariants, archivedNormandyOnlyTiles,
  NORMANDY_SHA256, NORMANDY_JSON_SHA256, NORMANDY_CLOCKS, normandyProbePoint} from '../scripts/normandy-service-geometry-fixture.mjs';
import {validateGeometryTestFrames} from '../scripts/service-geometry-test-framing.mjs';

const fixture = await loadNormandyFixture(), paris = await loadParisFixture();
const built = await buildNormandyAcceptanceVariants();
after(() => built.dispose());
const baseline = built.variants[0], decodedBaseline = decodeParisTiles(baseline.tiles);
const headways = JSON.parse(await readFile(new URL('../styles/service-headways.json', import.meta.url), 'utf8'));
const allProbes = fixture.probes.flatMap(terminal => terminal.negativeProbes);
const prefix = `gtfs:${fixture.feed.source.id}:`;
// Independent expected publication contract: preserve every original field,
// add the digest of each original URL, and canonicalize the one bare-host URL.
// Do not call the production sanitizer to compute its own expected output.
const publishedSource = structuredClone(fixture.feed.source);
for (const [record, fields] of [
  [publishedSource, ['url', 'processed_url', 'catalogue_url', 'terms_url']],
  [publishedSource.catalogue_attribution, ['license_url', 'source']],
  [publishedSource.catalogue_attribution.rt[0], ['license_url', 'source']],
  [publishedSource.feed_info, ['feed_publisher_url']],
]) for (const field of fields) record[`${field}_sha256`] = sha256(record[field]);
publishedSource.feed_info.feed_publisher_url = 'http://cityway.fr/';
function assertNoNormandyGeometry(tiles) {
  for (const zoom of [9, 12, 16]) {
    const decoded = decodeParisTiles(tiles, Math.min(zoom, 12));
    for (const probe of allProbes.filter(probe => probe.zooms.includes(zoom))) {
      const distance = featureDistanceMeters(probe.point, decoded);
      assert.ok(distance > probe.minimumClearanceMeters,
        `forbidden historical Normandy geometry: ${probe.id}, ${distance}m`);
    }
  }
}

test('Normandy fixture pins exact pre-fix compressed and expanded bytes, source metadata and licence', () => {
  assert.equal(fixture.bytes.length, 15279);
  assert.equal(fixture.raw.length, 556608);
  assert.equal(sha256(fixture.bytes), NORMANDY_SHA256);
  assert.equal(sha256(fixture.raw), NORMANDY_JSON_SHA256);
  assert.equal(fixture.metadata.assembled_artifact.id, 11338486417);
  assert.equal(fixture.metadata.shard_artifact.id, 11337683948);
  assert.equal(fixture.metadata.workflow_run_url, 'https://github.com/c933103/openrailwaystyle/actions/runs/37291043442');
  assert.equal(fixture.metadata.workflow_head_sha, 'c039337f4cb7c7fc3f997521196df758633832d3');
  assert.equal(fixture.metadata.assembled_fixture_byte_identical, true);
  assert.deepEqual(fixture.feed.source, fixture.metadata.source);
  assert.equal(fixture.feed.source.license, 'etalab-2.0');
  assert.equal(fixture.feed.source.service_date, '2026-10-05');
  assert.equal(fixture.feed.source.retrieved, '2026-10-04');
  assert.equal(fixture.feed.source.checked, '2026-10-05');
  assert.equal(fixture.feed.source.feed_info.feed_version, '16291');
  assert.equal(fixture.feed.routes.length, 3);
  assert.equal(fixture.feed.segments.length, 203);
  assert.ok(fixture.feed.segments.every(segment => segment.geometry.length === 2));
  assert.deepEqual(fixture.feed.segments.flatMap((segment, index) =>
    Object.values(segment.profiles).every(profile => profile.display_tph === null) ? [index] : []), [8, 130, 132, 171, 183, 192],
  'six original segments have no available profile; preserve them rather than inventing availability');
  assert.match(fixture.metadata.limitation, /does not establish.*raw GTFS shapes/);
  assert.match(fixture.metadata.evidence_kind, /not the raw GTFS ZIP/);
  assert.equal(built.metadata.runtimeBuild.compiledInputSha256, NORMANDY_SHA256);
});

test('all ten authentic terminal-linked compiled segments have actual source-based probes in every browser frame', () => {
  validateGeometryTestFrames(fixture.probes);
  assert.equal(allProbes.length, 30);
  for (const record of fixture.probeMetadata.terminals) {
    const actualIndices = fixture.feed.segments.flatMap((segment, index) =>
      segment.geometry.some(point => JSON.stringify(point) === JSON.stringify(record.endpoint)) ? [index] : []);
    assert.equal(actualIndices.length, record.terminal === 'saint-lazare' ? 6 : 4);
    for (const zoom of [9, 12, 16]) {
      const probes = record.negativeProbes.filter(probe => probe.zooms.includes(zoom));
      assert.deepEqual(probes.map(probe => probe.segmentIndex), actualIndices, 'every actual terminal chord is covered, without substitute geometry');
      for (const probe of probes) {
        const segment = fixture.feed.segments[probe.segmentIndex];
        assert.equal(probe.routeId, segment.route_id);
        assert.deepEqual(probe.point, normandyProbePoint(segment, record.endpoint, probe.fractionFromTerminal));
      }
    }
  }
  assertNoNormandyGeometry(baseline.tiles);
});

test('historical published PBFs directly contain six and four original Normandy features with preserved geometry and properties', () => {
  const selected = archivedNormandyOnlyTiles(fixture.archivedTiles, fixture.feed.source.id);
  for (const [index, record] of fixture.metadata.archived_tiles.entries()) {
    const key = record.path.replace(/^tiles\//, '').replace(/\.pbf\.gz$/, '');
    const original = decodeParisTiles(new Map([[key, fixture.archivedTiles.get(key)]]))
      .filter(feature => feature.properties.id.startsWith(prefix));
    const filtered = decodeParisTiles(new Map([[key, selected.get(key)]]));
    assert.equal(original.length, index === 0 ? 6 : 4);
    assert.equal(original.length, record.normandy_features);
    assert.deepEqual(filtered, original, 'fault injection preserves exact archived integer geometry and all original properties');
    assert.ok(original.every(feature => feature.properties.frequency_source === fixture.feed.source.name));
    assert.ok(original.some(feature => feature.properties.name === 'Paris - Deauville'));
    for (const probe of fixture.probes[index].negativeProbes.filter(probe => probe.zooms.includes(12))) {
      const near = original.filter(feature => featureDistanceMeters(probe.point, [feature]) < 2);
      assert.equal(near.length, 1, `${probe.id}: independently identifies one actual published chord`);
    }
  }
});

test('unchanged production assembly and rebuild replay authentic present and expired bytes under a pinned test clock', () => {
  assert.deepEqual(built.variants.map(variant => variant.id), ['absent', 'present', 'expired']);
  for (const variant of built.variants) {
    assert.equal(variant.clock, NORMANDY_CLOCKS[variant.id]);
    assert.ok(variant.staleOutputsRemoved, 'stale zooms and orphan tile files are physically removed');
    assert.deepEqual(variant.outputFiles, [...variant.tiles.keys()].sort());
    assert.equal(variant.manifest.tiles, 43);
    assert.deepEqual(variant.manifest.feeds, [], 'unmatched authentic timetable is never credited as applied');
    assert.match(variant.rebuildLog, /cached OSM routes/);
    if (variant.id === 'absent') {
      assert.equal(variant.inputSha256, null);
      assert.equal(variant.assemblyManifest, null);
      continue;
    }
    assert.equal(variant.inputSha256, NORMANDY_SHA256, 'present and expired use identical original gzip bytes');
    assert.equal(variant.assemblyManifest.tiles, 0);
    assert.deepEqual(variant.assemblyTiles, []);
    assert.deepEqual(variant.assemblyFiles, ['tiles/index.json'], 'obsolete standalone timetable tiles are physically removed');
    const [summary] = variant.assemblyManifest.feeds;
    assert.equal(variant.assemblyManifest.feeds.length, 1);
    assert.equal(summary.feedRoutes, 3);
    assert.equal(summary.mappedRoutes, 2);
    assert.equal(summary.pathSegments, 203);
    assert.equal(summary.availableSegments, variant.id === 'present' ? 197 : 0, 'all 203 original segments are replayed; six have no available profile');
    assert.deepEqual(summary.source, publishedSource,
      'published source preserves the original metadata with exact safe display URLs and original-URL hashes');
    for (const field of ['retrieved', 'checked', 'service_date', 'valid_until'])
      assert.equal(summary.source[field], fixture.feed.source[field],
        `real original ${field} is never rewritten to simulate expiry`);
    assert.equal(variant.manifest.worldwide.catalogue_entries, 1);
  }
});

test('all 203 historical segments add zero decoded geometry, identities, rates or n/i slots at native zooms 7–12', () => {
  assert.deepEqual(decodeParisTiles(buildTiles(paris.table, {headways})), decodedBaseline);
  for (const variant of built.variants) {
    const decoded = decodeParisTiles(variant.tiles);
    assert.deepEqual(decoded, decodedBaseline, `${variant.id}: all coordinates, real relation identities, properties and n/i slots are identical`);
    assert.deepEqual([...variant.tiles.keys()], [...baseline.tiles.keys()]);
    for (const [key, bytes] of variant.tiles) assert.ok(bytes.equals(baseline.tiles.get(key)), `${variant.id} ${key}: exact MVT bytes unchanged`);
    assert.ok(decoded.every(feature => /^relation-\d+$/.test(feature.properties.id)));
    assertNoNormandyGeometry(variant.tiles);
    for (let zoom = 7; zoom <= 12; zoom++) {
      const features = decoded.filter(feature => feature.key.startsWith(`${zoom}/`));
      assert.ok(features.length);
      for (const terminal of fixture.probes) {
        const matching = features.filter(feature => terminal.positive.renderedRelationIds.includes(Number(feature.properties.id.slice('relation-'.length))));
        assert.ok(matching.length, `${terminal.id} z${zoom}: real OSM identity retained`);
        assert.ok(featureDistanceMeters(terminal.positive.point, matching) < 30, `${terminal.id} z${zoom}: actual positive OSM line retained`);
      }
    }
  }
  for (const state of ['present', 'expired']) {
    const timetable = timetableFeatures([fixture.feed], Date.parse(NORMANDY_CLOCKS[state]));
    assert.equal(timetable.summary[0].pathSegments, 203);
    assert.equal(timetable.summary[0].availableSegments, state === 'present' ? 197 : 0);
    assert.deepEqual(decodeParisTiles(buildTiles(paris.table, {headways, timetable})), decodedBaseline,
      'legacy direct builder input also cannot leak any original compiled path');
  }
});

test('same-source historical mutations are spatially rejected on every actual terminal chord, including plausible OSM identities', () => {
  const corrupted = injectParisAdversaryTiles(baseline.tiles, built.forbiddenTiles);
  assert.throws(() => assertNoNormandyGeometry(corrupted), /forbidden historical Normandy geometry/);
  for (const probe of allProbes) {
    const zoom = Math.min(probe.zooms[0], 12), features = decodeParisTiles(corrupted, zoom);
    assert.ok(featureDistanceMeters(probe.point, features.filter(feature => feature.properties.id.startsWith(prefix))) < 8,
      `${probe.id}: actual historical mutation must reach this specific spatial probe`);
  }
  for (const bytes of corrupted.values()) {
    assert.ok(Buffer.isBuffer(bytes));
    assert.ok(Buffer.from(bytes.toString('base64'), 'base64').equals(bytes));
  }
  assert.deepEqual(decodeParisTiles(corrupted).filter(feature => !feature.properties.id.startsWith(prefix)), decodedBaseline,
    'historical mutation retains every legitimate feature, coordinate and slot');
  // The geometry assertion must not rely on GTFS-prefixed IDs. Only identity
  // changes in this additional sensitivity control; actual source paths remain.
  const disguised = built.forbiddenFeatures.map(feature => ({...feature, properties: {...feature.properties, id: 'relation-12142599'}}));
  assert.throws(() => assertNoNormandyGeometry(injectParisAdversaryTiles(baseline.tiles, adversaryTiles(disguised))), /forbidden historical Normandy geometry/);
});
