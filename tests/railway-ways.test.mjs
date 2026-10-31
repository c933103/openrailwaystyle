import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {STAGES, partSelection} from '../scripts/download-stages.mjs';
import {branchSelect, toFeatures, partQuery as branchQuery} from '../scripts/branch-lines.mjs';
import {serviceSelect, toTable, partQuery as serviceQuery} from '../scripts/service-routes.mjs';
import {powerMethodSelection, powerMethodsGeoJSON, powerMethodQuery} from '../scripts/power-method-data.mjs';
import {railwayWaysQuery, branchView, serviceView, powerView, isBranchWay, isServiceRoute} from '../scripts/railway-ways.mjs';

const part = name => STAGES.find(stage => stage.name === name).parts[0];
const balanced = text => {
  let depth = 0;
  for (const c of text.replace(/"[^"]*"/g, '')) { depth += c === '(' ? 1 : c === ')' ? -1 : 0; if (depth < 0) return false; }
  return depth === 0;
};

test('one query selects the branch lines, the service routes with their track ways, and the power methods of a region', () => {
  const japan = part('japan'), box = japan.box, query = railwayWaysQuery(japan, box);
  const branch = partSelection(japan, box, branchSelect), service = partSelection(japan, box, serviceSelect);
  assert.ok(query.startsWith(`[out:json][timeout:180][maxsize:536870912];${branch.areas}${branch.set}->.b;${service.set}->.r;`));
  assert.ok(query.includes(powerMethodSelection(branch.filters[0], {charging: 'pc', potential: 'pp', result: 'p'})), 'the power selection, inside the same area');
  // The routes as the service query outputs them, then every way once.
  assert.ok(query.endsWith('.r out meta;(way(r.r)[railway~"^(rail|light_rail|subway|tram|monorail|narrow_gauge|funicular)$"];.b;.p;);out meta geom qt;'));
  assert.ok(serviceQuery(japan, box).includes('->.r;.r out meta;way(r.r)[railway~"^(rail|light_rail|subway|tram|monorail|narrow_gauge|funicular)$"];out meta geom qt;'));
  assert.ok(balanced(query));
  assert.equal(query.split('[out:json]').length, 2);
});

test('a part with excluded areas leaves them out of all three selections', () => {
  const china = part('china'), query = railwayWaysQuery(china, china.box);
  const branch = partSelection(china, china.box, branchSelect);
  assert.ok(branch.filters.length > 1);
  assert.ok(query.includes(`${branch.set}->.b;`) && branch.set.includes(' - ('), 'branch lines: as their own query');
  assert.ok(query.includes(`${partSelection(china, china.box, serviceSelect).set}->.r;`), 'service routes: as their own query');
  for (const [i, filter] of branch.filters.slice(1).entries())
    assert.ok(query.includes(powerMethodSelection(filter, {charging: `pc${i}`, potential: `pp${i}`, result: `px${i}`})), 'each excluded area has its own power sets');
  assert.ok(query.includes(`(.pm; - (${branch.filters.slice(1).map((_, i) => `.px${i};`).join('')});)->.p;`));
  assert.ok(balanced(query));
  // Every stage part builds a query.
  for (const stage of STAGES) for (const p of stage.parts) {
    const text = railwayWaysQuery(p, p.box);
    assert.ok(balanced(text), `${stage.name}`);
    // An assignment belongs to the statement it ends: "...)->.x;", never
    // ";->.x" (a statement of its own, which the server rejects).
    assert.doesNotMatch(text.replace(/"[^"]*"/g, ''), /;\s*->/, `${stage.name}: an assignment after a terminated statement`);
  }
});

// A synthetic merged response: no captured provider data.
const geometry = (lon, lat) => [{lon, lat}, {lon: lon + 0.01, lat: lat + 0.01}];
const meta = {version: 3, timestamp: '2026-10-01T00:00:00Z'};
const elements = [
  {type: 'relation', id: 100, ...meta, tags: {type: 'route', route: 'subway', ref: 'M1', name: 'Metro 1', network: 'Metro'},
    members: [{type: 'way', ref: 1, role: ''}, {type: 'way', ref: 2, role: ''}, {type: 'way', ref: 7, role: 'platform'}, {type: 'node', ref: 50, role: 'stop'}]},
  {type: 'relation', id: 101, ...meta, tags: {type: 'route', route: 'train', service: 'long_distance', ref: 'IC'}, members: [{type: 'way', ref: 3, role: ''}]},
  {type: 'relation', id: 102, ...meta, tags: {type: 'route', route: 'train', service: 'commuter', ref: 'S1', name: 'S1', network: 'S'}, members: [{type: 'way', ref: 3, role: ''}]},
  // A subway way (a branch line too), and a rail way only the route uses.
  {type: 'way', id: 1, ...meta, tags: {railway: 'subway', electrified: 'rail', voltage: '750'}, geometry: geometry(139.7, 35.6)},
  {type: 'way', id: 2, ...meta, tags: {railway: 'rail', usage: 'main'}, geometry: geometry(139.8, 35.6)},
  {type: 'way', id: 3, ...meta, tags: {railway: 'rail', usage: 'branch', name: 'Branch'}, geometry: geometry(139.9, 35.6)},
  // A branch siding (service=*) is not a branch line; a platform is not a track.
  {type: 'way', id: 4, ...meta, tags: {railway: 'rail', usage: 'branch', service: 'siding', electrified: 'rail'}, geometry: geometry(140, 35.6)},
  {type: 'way', id: 7, ...meta, tags: {railway: 'platform'}, geometry: geometry(140.1, 35.6)},
  // Power methods alone: a rack railway, a lifecycle-prefixed conductor rail, a charger.
  {type: 'way', id: 5, ...meta, tags: {railway: 'rail', usage: 'tourism', 'railway:traction': 'rack', traction: 'rack'}, geometry: geometry(138, 36)},
  {type: 'way', id: 6, ...meta, tags: {'disused:railway': 'tram', 'disused:electrified': '4th_rail'}, geometry: geometry(138.1, 36)},
  {type: 'node', id: 60, ...meta, lat: 35.5, lon: 139.5, tags: {amenity: 'charging_station', railway: 'yes', train: 'yes'}},
];
const response = {version: 0.6, osm3s: {timestamp_osm_base: '2026-10-31T00:00:00Z'}, elements};
const only = ids => ({...response, elements: elements.filter(e => ids.includes(`${e.type[0]}${e.id}`))});

test('each view is what the dataset\'s own query returns', () => {
  assert.deepEqual(branchView(response).elements.map(e => e.id), [1, 3]);
  assert.deepEqual(toFeatures(branchView(response)), toFeatures(only(['w1', 'w3'])), 'branch lines: rail usage=branch without service=*, and metro');
  // Routes: the metro and the commuter train, not the long-distance train;
  // their member tracks, not the platform or the other ways.
  assert.deepEqual(serviceView(response).elements.map(e => `${e.type[0]}${e.id}`), ['r100', 'r102', 'w1', 'w2', 'w3']);
  assert.deepEqual(toTable(serviceView(response)), toTable(only(['r100', 'r102', 'w1', 'w2', 'w3'])));
  // Power methods: the ways with a means and the charger; nothing else drawn.
  const power = powerMethodsGeoJSON(powerView(response));
  assert.deepEqual(power, powerMethodsGeoJSON(only(['w1', 'w4', 'w5', 'w6', 'n60'])));
  assert.deepEqual(power.features.map(f => f.id).sort(), ['node-60', 'way-1', 'way-4', 'way-5', 'way-6']);
  assert.ok(!powerView(response).elements.some(isServiceRoute), 'route relations are not power elements');
});

test('the element tests mirror the Overpass selections', () => {
  const way = tags => ({type: 'way', id: 1, tags});
  assert.equal(isBranchWay(way({railway: 'narrow_gauge', usage: 'branch'})), true);
  assert.equal(isBranchWay(way({railway: 'rail', usage: 'Branch'})), false, 'Overpass values are case-sensitive');
  assert.equal(isBranchWay(way({railway: 'subway', service: 'yard'})), false);
  assert.equal(isBranchWay(way({railway: 'light_rail', usage: 'branch'})), false);
  assert.equal(isBranchWay({type: 'node', id: 1, tags: {railway: 'subway'}}), false);
  const route = tags => ({type: 'relation', id: 1, tags: {type: 'route', ...tags}});
  for (const value of ['subway', 'light_rail', 'tram', 'monorail']) assert.equal(isServiceRoute(route({route: value})), true, value);
  assert.equal(isServiceRoute(route({route: 'train', service: 'urban'})), true);
  assert.equal(isServiceRoute(route({route: 'train'})), false);
  assert.equal(isServiceRoute(route({route: 'bus'})), false);
  assert.equal(isServiceRoute({type: 'relation', id: 1, tags: {route: 'subway'}}), false, 'type=route is required');
  assert.throws(() => branchView({remark: 'runtime error: Query timed out', elements: []}), /timed out/);
  assert.throws(() => serviceView({}), /Incomplete/);
});

test('the datasets\' own queries are unchanged, so their cached responses stay valid', () => {
  const sha = text => createHash('sha256').update(text).digest('hex');
  // Digests of the query texts before the selections were shared.
  assert.equal(sha(powerMethodQuery([-90, -180, 0, -90])), 'a6e7f4110f6d27ca189e154bdfb1cc2c667568149de9ea874a957992395b674f');
  assert.equal(sha(branchQuery(part('japan'), part('japan').box)), '2f21c22609d18fa5194cbac526fbbe31f8d0cbfc91b87b97949773d92981b0ae');
  assert.equal(sha(serviceQuery(part('japan'), [0, 0, 1, 1])), 'dab972c485ba3671456175b0971456d3d563b8ab6519fa7e1ea4d08e31b9ba15');
  assert.equal(sha(branchQuery(part('china'), part('china').box)), '62091ebd5e7286c60bf892b7071f112ccf8fbc034d0b191198a3c80e1c828317');
  assert.equal(sha(serviceQuery(part('china'), [0, 0, 1, 1])), '69d25326a572efbd5a5c514b9c4b96335e7f58afad97697948ff1f0956aaa5a7');
});
