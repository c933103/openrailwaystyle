import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {observeGeometry, geometryLines, geometryStatus} from '../scripts/service-geometry.mjs';
import {partQuery} from '../scripts/service-routes.mjs';

test('service metadata: successful configured-endpoint fixture preserves raw nodes before simplification', async () => {
  const text = await readFile(new URL('./fixtures/service-geometry/overpass-meta-way-4853887.json', import.meta.url), 'utf8');
  const json = JSON.parse(text), way = json.elements[0], observed = observeGeometry(way, json);
  assert.equal(json.generator, 'Overpass API 0.7.62.11 87bfad18');
  assert.equal(observed.snapshot, '2026-10-07T02:32:36Z');
  assert.equal(observed.version, 38); assert.equal(observed.timestamp, '2026-01-04T04:25:23Z');
  assert.equal(observed.nodes.length, 31); assert.equal(observed.slots.length, 31);
  assert.deepEqual(observed.nodes, way.nodes);
  assert.deepEqual(observed.slots, way.geometry.map(({lon, lat}) => [lon, lat]));
  assert.equal(geometryStatus(observed).status, 'complete');
  assert.deepEqual(geometryStatus(observed).missing, []);
  assert.deepEqual(geometryLines(observed).map(line => line.length), [7]);
  assert.doesNotMatch(text, /"(?:user|uid|changeset)"\s*:/);
  const query = partQuery({area:'ISO3166-1=JP'}, [20,122,46,154]);
  assert.match(query, /way\(r\.r\)\[railway~/);
  assert.match(query, /out meta geom qt;/);
  assert.doesNotMatch(query, /out skel geom/);
});

test('service metadata: legacy persistence labels unknown provenance without duplicating coordinates', async () => {
  const {readTable, writeTable, drawnGeometry} = await import('../scripts/service-routes.mjs');
  const lines = [[[139,35],[139.01,35.01]]], text = JSON.stringify({type:'way',id:1,lines,routes:{A:['r1']},next:{},nextLines:{B:lines}})+'\n';
  const original = readTable(text), stored = writeTable(original), serialized = JSON.parse(stored);
  assert.deepEqual(serialized.geometry,{schema:1,snapshot:null,legacy:true});
  assert.deepEqual(serialized.nextGeometry.B,{schema:1,snapshot:null,legacy:true});
  const restored=readTable(stored);
  assert.deepEqual(geometryLines(drawnGeometry(restored.ways.get(1))),lines);
  assert.equal(geometryStatus(drawnGeometry(restored.ways.get(1))).status,'unknown');
  assert.equal(writeTable(restored),stored);
});
