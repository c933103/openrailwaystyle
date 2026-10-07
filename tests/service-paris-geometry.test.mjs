// Pinned real Paris rail geometry, unchanged production CLI rebuilds, and
// explicitly synthetic timetable adversaries. Not a Normandy feed reproduction.
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildTiles, drawnGeometry, geometrySummary, serviceRoutes} from '../scripts/service-routes.mjs';
import {geometryLines, geometryStatus} from '../scripts/service-geometry.mjs';
import {timetableFeatures} from '../scripts/gtfs-service.mjs';
import {FREQUENCY_PROFILES} from '../styles/service-frequency.mjs';
import {PARIS_BBOX, PARIS_PROBES, PARIS_SOURCE, loadParisFixture, selectParisRows, segmentCrossesBox,
  lineIntersectsBox, buildParisAcceptanceVariants, parisAdversaryFeed, decodeParisTiles, featureDistanceMeters,
  pointLineDistanceMeters, parisAdversaryFeatures, adversaryTiles, injectParisAdversaryTiles, sha256} from '../scripts/paris-service-geometry-fixture.mjs';

const fixture = await loadParisFixture();
const built = await buildParisAcceptanceVariants();
after(() => built.dispose());
const headways = JSON.parse(await readFile(new URL('../styles/service-headways.json', import.meta.url), 'utf8'));
const baseline = built.variants.find(variant => variant.id === 'absent');
const decodedBaseline = decodeParisTiles(baseline.tiles);
const activeProbes = zoom => PARIS_PROBES.flatMap(terminal => terminal.negativeProbes.filter(probe => probe.zooms.includes(zoom)));
function assertNoForbiddenGeometry(tiles) {
  for (let zoom = 7; zoom <= 12; zoom++) {
    const features = decodeParisTiles(tiles, zoom);
    assert.ok(features.length, `native z${zoom} has actual OSM geometry`);
    for (const probe of activeProbes(zoom)) {
      const minimum = zoom < 12 ? 1400 : 200;
      assert.ok(featureDistanceMeters(probe.point, features) > minimum,
        `forbidden geometry at ${probe.id}, z${zoom}; minimum clearance ${minimum}m`);
    }
  }
}

test('Paris source bytes pin all selected full ways and required relation rows, without invented provenance', () => {
  assert.equal(fixture.metadata.source.commit, PARIS_SOURCE.commit);
  assert.equal(fixture.metadata.source.sha256, PARIS_SOURCE.sha256);
  assert.deepEqual(fixture.metadata.bbox, PARIS_BBOX);
  assert.equal(fixture.metadata.ways, 2094);
  assert.equal(fixture.metadata.relations, 119);
  assert.equal(fixture.metadata.sha256, 'fdfaf30b3323e750b5470e721dcced41ed00d3c5d98da9a72e302d68c24a9819');
  assert.equal(fixture.metadata.bytes, 425600);
  assert.ok(fixture.metadata.files.every(part => part.bytes < 300000), 'plaintext parts fit publication limits');
  assert.equal(fixture.table.ways.size, 2094);
  assert.equal(fixture.table.routes.size, 119);
  assert.equal(selectParisRows(fixture.text).text, fixture.text, 're-extraction preserves full unchanged rows and order');
  const summary = geometrySummary(fixture.table);
  assert.equal(summary.waysWithUnknownProvenance.length, 2094);
  for (const way of fixture.table.ways.values()) {
    const evidence = drawnGeometry(way);
    assert.equal(geometryStatus(evidence).status, 'unknown');
    assert.equal(evidence.snapshot, null);
    assert.equal(evidence.nodes, undefined);
    assert.equal(evidence.version, undefined);
    for (const key of [...Object.values(way.routes), ...Object.values(way.next || {})].flat())
      assert.ok(fixture.table.routes.has(key), `way ${way.id} has its real relation row ${key}`);
  }
  assert.match(fixture.metadata.provenance, /legacy simplified/);
  assert.match(fixture.metadata.limitation, /not resolve issue #107/);
});

test('Paris extraction retains a whole crossing way even with no vertex inside, and never joins separate fragments', () => {
  const westEast = [[2.0, 48.85], [2.6, 48.85]];
  assert.equal(lineIntersectsBox(westEast), true);
  assert.equal(segmentCrossesBox([2.0, 48.7], [2.6, 48.7]), false);
  assert.equal(segmentCrossesBox([2.3, 48.7], [2.3, 49.0]), true);
  assert.equal(segmentCrossesBox([2.15, 48.76], [2.15, 48.76]), true);
  const route = {type: 'route', key: 'r1', stages: {A: {relation: 1}}, next: {}};
  const crossing = {type: 'way', id: 1, routes: {A: ['r1']}, next: {}, lines: [westEast]};
  const outsideFragments = {type: 'way', id: 2, routes: {A: ['r1']}, next: {}, lines: [[[2.0, 48.85], [2.1, 48.85]], [[2.5, 48.85], [2.6, 48.85]]]};
  const pendingCrossing = {type: 'way', id: 3, routes: {}, next: {A: ['r1']}, lines: [], nextLines: {A: [westEast]}};
  const input = [route, crossing, outsideFragments, pendingCrossing].map(row => JSON.stringify(row) + '\n').join('');
  const selected = selectParisRows(input);
  assert.deepEqual(selected.text.trim().split('\n').map(JSON.parse), [route, crossing, pendingCrossing]);
  assert.deepEqual(JSON.parse(selected.text.split('\n')[1]).lines, [westEast], 'retain coordinates outside the bbox; do not clip');
});

test('Paris terminal positives retain source ways, real relation identities and raw legacy positions', () => {
  const routes = serviceRoutes(fixture.table);
  for (const terminal of PARIS_PROBES) {
    for (const relation of terminal.positive.relationIds) {
      assert.ok(fixture.table.routes.has(`r${relation}`));
      assert.equal(routes.get(`r${relation}`).ref, terminal.positive.ref);
      assert.ok(terminal.positive.renderedRelationIds.includes(routes.get(`r${relation}`).relation), 'directions may group under the lowest real relation');
    }
    for (const id of terminal.positive.wayIds) {
      const way = fixture.table.ways.get(id);
      assert.ok(way, `${terminal.id} real way ${id}`);
      const memberships = [...Object.values(way.routes)].flat();
      assert.ok(memberships.some(key => terminal.positive.relationIds.includes(Number(key.slice(1)))));
      const distance = Math.min(...geometryLines(drawnGeometry(way)).map(line => pointLineDistanceMeters(terminal.positive.point, line)));
      assert.ok(distance < 12, `positive probe is on real source way ${id}: ${distance}m`);
    }
  }
  assert.deepEqual(geometryLines(drawnGeometry(fixture.table.ways.get(58191909))),
    [[[2.323173, 48.878698], [2.323706, 48.877349], [2.32434, 48.876531]]]);
});

test('Paris synthetic adversaries actually enter compiled inputs, with two-point shapes and geometry-free stop pairs', async () => {
  const {feed, stopOnlyCandidates} = await parisAdversaryFeed();
  const expired = (await parisAdversaryFeed({expired: true})).feed;
  assert.match(feed.source.note, /Synthetic.*not.*authentic Normandy/i);
  assert.equal(feed.routes.length, 8);
  assert.equal(feed.segments.filter(segment => segment.geometry?.length === 2).length, 4);
  assert.equal(feed.segments.filter(segment => !Object.hasOwn(segment, 'geometry')).length, 4);
  assert.equal(stopOnlyCandidates.length, 4);
  const stopIds = new Set(feed.stops.map(stop => stop.id));
  for (const segment of feed.segments.filter(segment => !segment.geometry)) {
    assert.equal(segment.stops.length, 2);
    assert.ok(segment.stops.every(id => stopIds.has(id)), 'actual compiled segment references actual stop coordinates');
    for (const profile of FREQUENCY_PROFILES) assert.ok(segment.profiles[profile].display_tph > 0);
  }
  const current = timetableFeatures([feed], Date.parse('2099-01-02T00:00:00Z'));
  assert.equal(current.summary[0].availableSegments, 4);
  assert.equal(current.summary[0].mappedRoutes, 4);
  assert.equal(current.summary[0].feedRoutes, 8);
  assert.equal(current.summary[0].pathSegments, 8);
  assert.equal(timetableFeatures([expired], Date.parse('2099-01-02T00:00:00Z')).summary[0].availableSegments, 0);
  assert.deepEqual(parisAdversaryFeatures(feed), built.forbiddenFeatures);
});

test('real Paris production assembly/rebuild removes stale outputs and produces zero standalone timetable tiles', () => {
  assert.deepEqual(built.variants.map(variant => variant.id), ['absent', 'present', 'expired']);
  for (const variant of built.variants) {
    assert.ok(variant.staleOutputsRemoved, `${variant.id} prunes stale zoom directories and same-zoom orphan tiles`);
    assert.deepEqual(variant.outputFiles, [...variant.tiles.keys()].sort(), 'no unindexed tile can remain servable');
    assert.equal(variant.manifest.feeds.length, 0, 'unmatched timetables are not credited as applied');
    assert.equal(variant.manifest.tiles, 43);
    assert.equal(variant.manifest.geometry.waysWithUnknownProvenance.length, 2094);
    assert.match(variant.rebuildLog, /cached OSM routes/);
    if (variant.id === 'absent') { assert.equal(variant.assemblyManifest, null); continue; }
    assert.equal(variant.assemblyManifest.tiles, 0);
    assert.deepEqual(variant.assemblyTiles, []);
    assert.deepEqual(variant.assemblyFiles, ['tiles/index.json'], 'obsolete timetable PBFs are physically removed');
    assert.equal(variant.assemblyManifest.feeds[0].mappedRoutes, 4);
    assert.equal(variant.assemblyManifest.feeds[0].pathSegments, 8);
    assert.equal(variant.assemblyManifest.feeds[0].availableSegments, variant.id === 'present' ? 4 : 0);
    assert.equal(variant.manifest.worldwide.catalogue_entries, 1, 'production rebuild consumed actual assembled manifest');
  }
});

test('native z7–12 production tiles retain exact decoded real OSM geometry, identity and n/i slots in every feed state', () => {
  assert.deepEqual([...new Set(decodedBaseline.map(feature => Number(feature.key.split('/')[0])))], [10, 11, 12, 7, 8, 9]);
  const direct = decodeParisTiles(buildTiles(fixture.table, {headways}));
  assert.deepEqual(decodedBaseline, direct, 'real CLI rebuild equals the OSM-only production tile builder');
  assert.ok(decodedBaseline.some(feature => feature.properties.n > 1), 'fixture exercises shared-service slots away from the terminal probes');
  for (const variant of built.variants) {
    const decoded = decodeParisTiles(variant.tiles);
    assert.deepEqual(decoded, decodedBaseline, `${variant.id}: complete decoded coordinates, relation identities and all properties remain unchanged`);
    for (const feature of decoded) {
      const {id, n, i, slot} = feature.properties;
      assert.match(id, /^relation-\d+$/);
      assert.ok(Number.isInteger(n) && n >= 1 && Number.isInteger(i) && i >= 0 && i < n);
      assert.equal(slot, Math.max(-63, Math.min(63, 2 * i - (n - 1))));
      assert.equal(feature.properties.frequency_until, 0, 'unmatched Paris services retain unknown validity');
      assert.equal(feature.properties.frequency_source, undefined);
      for (const profile of FREQUENCY_PROFILES) {
        assert.equal(feature.properties[`frequency_${profile}`], undefined, 'no invented timetable rate');
        assert.equal(feature.properties[`frequency_width_${profile}`], 3.5, 'unknown bundled width');
        assert.equal(feature.properties[`frequency_offset_${profile}`], (i - (n - 1) / 2) * 4, 'stored profile bundle includes the standard 0.5px gap; expired paint uses legacy spacing');
      }
    }
    for (let zoom = 7; zoom <= 12; zoom++) {
      const features = decoded.filter(feature => feature.key.startsWith(`${zoom}/`));
      for (const terminal of PARIS_PROBES) {
        const matching = features.filter(feature => terminal.positive.renderedRelationIds.includes(Number(feature.properties.id.slice('relation-'.length))));
        assert.ok(matching.length, `${variant.id} z${zoom} ${terminal.id}: retained actual relation features`);
        assert.ok(featureDistanceMeters(terminal.positive.point, matching) < 30, `${variant.id} z${zoom} ${terminal.id}: decoded line reaches real source location`);
        const nearest = matching.sort((a, b) => featureDistanceMeters(terminal.positive.point, [a]) - featureDistanceMeters(terminal.positive.point, [b]))[0];
        assert.equal(nearest.properties.ref, terminal.positive.ref);
        assert.equal(nearest.properties.n, 1);
        assert.equal(nearest.properties.i, 0);
      }
    }
    assertNoForbiddenGeometry(variant.tiles);
  }
});

test('Paris negative geometry assertions fail after forbidden chords enter the same production MVT layer', () => {
  const corrupted = injectParisAdversaryTiles(baseline.tiles);
  assert.throws(() => assertNoForbiddenGeometry(corrupted), /forbidden geometry/);
  for (let zoom = 7; zoom <= 12; zoom++) {
    const decoded = decodeParisTiles(corrupted, zoom);
    for (const probe of activeProbes(zoom)) assert.ok(featureDistanceMeters(probe.point, decoded) < 30, `injected ${probe.id} is actually decoded at z${zoom}`);
  }
  const injectedReal = decodeParisTiles(corrupted).filter(feature => !feature.properties.id.startsWith('gtfs:'));
  assert.deepEqual(injectedReal, decodedBaseline, 'mutation preserves all legitimate coordinates and slots');
  // A prefix-only test would miss this: give forbidden geometry a plausible
  // real-relation identity and require the same spatial assertion to reject it.
  const disguised = built.forbiddenFeatures.map(feature => ({...feature, properties: {...feature.properties, id: 'relation-12142599'}}));
  const plausibleIds = injectParisAdversaryTiles(baseline.tiles, adversaryTiles(disguised));
  assert.throws(() => assertNoForbiddenGeometry(plausibleIds), /forbidden geometry/);
});

test('Paris report records both archived baseline hashes and actual currently executing production modules', async () => {
  assert.equal(Object.keys(built.metadata.runtimeBuild.files).length, 6);
  assert.equal(built.metadata.runtimeBuild.adversarySha256, sha256(await readFile(new URL('./fixtures/service-geometry/paris-adversary.json', import.meta.url))));
  for (const [path, actualHash] of Object.entries(built.metadata.runtimeBuild.files)) {
    assert.equal(actualHash, sha256(await readFile(new URL(`../${path}`, import.meta.url))));
    assert.match(fixture.metadata.build.files[path], /^[a-f0-9]{64}$/);
  }
});
