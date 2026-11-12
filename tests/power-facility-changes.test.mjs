import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseAdiff, applyElementChanges, requireGeometry, adiffQuery} from '../scripts/overpass-adiff.mjs';
import {powerFacilityQuery, powerFacilitiesGeoJSON, powerFacilityChangesSince, POWER_FACILITY_UPDATE_EVERY} from '../scripts/power-facility-data.mjs';

// Synthetic responses and augmented diffs; no captured provider data.
const box = [-90, -180, 0, -90], query = powerFacilityQuery(box), DAY = 86400000;
const ring = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]].map(([lon, lat]) => ({lon, lat}));
const hole = [[.2, .2], [.2, .4], [.4, .4], [.4, .2], [.2, .2]].map(([lon, lat]) => ({lon, lat}));
const nds = points => points.map(({lat, lon}, i) => `<nd ref="${i + 1}" lat="${lat}" lon="${lon}"/>`).join('');
const osm = actions => `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="Overpass API">\n<meta osm_base="2026-11-01T05:00:00Z"/>\n${actions}\n</osm>\n`;

test('a relation\'s member ways come with their points, node members with their position', () => {
  const {upserts} = parseAdiff(osm(`<action type="create"><relation id="9" version="1"><bounds minlat="0" minlon="0" maxlat="1" maxlon="1"/>`
    + `<member type="way" ref="1" role="outer">${ring.map(p => `<nd lat="${p.lat}" lon="${p.lon}"/>`).join('')}</member>`
    + `<member type="way" ref="2" role="inner">${hole.map(p => `<nd lat="${p.lat}" lon="${p.lon}"/>`).join('')}</member>`
    + '<member type="node" ref="3" role="label" lat="0.5" lon="0.5"/>'
    + '<tag k="type" v="multipolygon"/><tag k="power" v="substation"/><tag k="railway" v="yes"/></relation></action>'));
  const [relation] = upserts;
  assert.deepEqual(relation.members.map(m => [m.type, m.ref, m.role, m.geometry?.length ?? null, m.lat ?? null]),
    [['way', 1, 'outer', 5, null], ['way', 2, 'inner', 5, null], ['node', 3, 'label', null, 0.5]]);
  assert.deepEqual(relation.members[0].geometry, ring);
  // The same shape as the full download's JSON gives.
  const full = {type: 'relation', id: 9, tags: relation.tags, members: [{type: 'way', ref: 1, role: 'outer', geometry: ring}, {type: 'way', ref: 2, role: 'inner', geometry: hole}]};
  assert.deepEqual(powerFacilitiesGeoJSON({elements: upserts}).features[0].geometry, powerFacilitiesGeoJSON({elements: [full]}).features[0].geometry);
});

test('a changed way or relation without its geometry is refused, never drawn as a point', () => {
  assert.throws(() => requireGeometry([{type: 'way', id: 1, tags: {}}]), /way 1 without geometry/);
  assert.throws(() => requireGeometry([{type: 'relation', id: 2, members: [{type: 'way', ref: 1, role: 'outer'}]}]), /relation 2/);
  assert.doesNotThrow(() => requireGeometry([{type: 'node', id: 3, lat: 0, lon: 0}, {type: 'way', id: 4, geometry: ring}]));
});

test('a cached region takes its changes once a week, by element, as a full download would give it', () => {
  const now = Date.parse('2026-11-01T06:00:00Z');
  const saved = {query, response: {osm3s: {timestamp_osm_base: '2026-10-20T00:00:00Z'}, elements: [
    {type: 'node', id: 12, lat: -34, lon: -135, tags: {railway: 'fuel'}},
    {type: 'node', id: 13, lat: -35, lon: -136, tags: {railway: 'water_tower'}},
    {type: 'way', id: 14, geometry: ring.map(p => ({lat: p.lat - 40, lon: p.lon - 140})), tags: {power: 'substation', railway: 'yes'}},
  ]}};
  assert.equal(powerFacilityChangesSince(box, query, saved, {mtimeMs: now - 8 * DAY, now}), '2026-10-20T00:00:00Z');
  assert.equal(powerFacilityChangesSince(box, query, saved, {mtimeMs: now - 2 * DAY, now}), null, 'updated this week');
  assert.equal(powerFacilityChangesSince(box, query, saved, {mtimeMs: now - 400 * DAY, now}), '2026-10-20T00:00:00Z', 'no age limit');
  assert.equal(powerFacilityChangesSince(box, query, {...saved, query: query + ' '}, {mtimeMs: now - 8 * DAY, now}), null, 'another query');
  assert.equal(POWER_FACILITY_UPDATE_EVERY, 7 * DAY);
  assert.match(adiffQuery(query, '2026-10-20T00:00:00Z'), /\[adiff:"2026-10-20T00:00:00Z"\];[\s\S]*out meta geom qt;$/);
  // A deleted fuel point, a moved water tower, a new substation way.
  const changes = parseAdiff(osm([
    '<action type="delete"><old/><new><node id="12" visible="false"/></new></action>',
    '<action type="modify"><old/><new><node id="13" lat="-35.5" lon="-136" version="2"><tag k="railway" v="water_tower"/></node></new></action>',
    `<action type="create"><way id="15" version="1">${nds(ring.map(p => ({lat: p.lat - 50, lon: p.lon - 150})))}<tag k="power" v="substation"/><tag k="railway" v="yes"/></way></action>`,
  ].join('\n')));
  const updated = powerFacilitiesGeoJSON({elements: applyElementChanges(saved.response.elements, {...changes, upserts: requireGeometry(changes.upserts)})});
  const full = powerFacilitiesGeoJSON({elements: [
    {type: 'node', id: 13, lat: -35.5, lon: -136, tags: {railway: 'water_tower'}}, saved.response.elements[2],
    {type: 'way', id: 15, geometry: ring.map(p => ({lat: p.lat - 50, lon: p.lon - 150})), tags: {power: 'substation', railway: 'yes'}},
  ]});
  assert.deepEqual(updated, full);
});

test('the builder asks for a week-old region\'s changes, or another query\'s difference, through updateElements', () => {
  const source = readFileSync(new URL('../scripts/build-power-facilities.mjs', import.meta.url), 'utf8');
  assert.match(source, /if\(json\)\{since=powerFacilityChangesSince\(box,query,saved,\{mtimeMs:info\.mtimeMs\}\);stored=saved;\}/);
  assert.match(source, /updateElements\(\{elements:stored\.response\.elements,since,previousQuery:stored\.query,query,\n\s*pick:element=>requireGeometry\(\[element\]\)\[0\]/);
  // A failure keeps a response of the current query; the budget still stops the run.
  assert.match(source, /if\(failure&&\/budget exceeded\/\.test\(failure\.message\)\)throw failure;/);
  assert.match(source, /\} else if\(stored\.query!==query\) json=undefined;/);
  // Behaviour: tests/power-facility-builder.test.mjs.
});
