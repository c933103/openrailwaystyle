import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseLine, readElements, unescapeOpl} from '../scripts/extract-elements.mjs';

const fixture = async name => JSON.parse(await readFile(new URL(`./fixtures/service-geometry/${name}`, import.meta.url), 'utf8')).elements[0];
const xml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const tagXml = tags => Object.entries(tags || {}).map(([k, v]) => `<tag k="${xml(k)}" v="${xml(v)}"/>`).join('');

test('OPL lines become Overpass elements: ways with nodes, geometry and bounds, relations with members, tagged nodes', () => {
  assert.deepEqual(parseLine('w10 v3 dV c0 t2026-10-02T00:00:00Z i0 u Trailway=rail,name=x%20%y%2c%z%3d%w Nn1x11.5y48.1,n2x11.6y48.2'), {
    type: 'way', id: 10, timestamp: '2026-10-02T00:00:00Z', version: 3,
    bounds: {minlat: 48.1, minlon: 11.5, maxlat: 48.2, maxlon: 11.6}, nodes: [1, 2],
    geometry: [{lat: 48.1, lon: 11.5}, {lat: 48.2, lon: 11.6}], tags: {railway: 'rail', name: 'x y,z=w'}});
  assert.deepEqual(parseLine('r100 v1 dV c0 t2026-10-03T00:00:00Z i0 u Ttype=route,route=tram Mw10@,n2@stop%20%entry'), {
    type: 'relation', id: 100, timestamp: '2026-10-03T00:00:00Z', version: 1,
    members: [{type: 'way', ref: 10, role: ''}, {type: 'node', ref: 2, role: 'stop entry'}], tags: {type: 'route', route: 'tram'}});
  assert.deepEqual(parseLine('n2 v1 dV c0 t2026-10-01T00:00:00Z i0 u Trailway=charging_station x11.6 y-48.2'),
    {type: 'node', id: 2, timestamp: '2026-10-01T00:00:00Z', version: 1, lat: -48.2, lon: 11.6, tags: {railway: 'charging_station'}});
  // A way whose node the extract lacks has no full line: left out, never partial.
  assert.equal(parseLine('w10 v3 dV c0 t2026-10-02T00:00:00Z i0 u Trailway=rail Nn1x11.5y48.1,n9xy'), null);
  assert.equal(parseLine('w11 v1 dV c0 t2026-10-02T00:00:00Z i0 u T Nn1x11.5y48.1').tags, undefined, 'no tags, no tags field');
  assert.equal(unescapeOpl('a%20%b%1f600%'), 'a b😀');
  assert.throws(() => parseLine('x1 v1'), /Not an OPL object line/);
  // A selection that turns an element down on its type and tags alone gets
  // no element: the geometry of the ways a build does not want is never made.
  const seen = [];
  assert.equal(parseLine('w10 v3 dV c0 t2026-10-02T00:00:00Z i0 u Trailway=rail Nn1x11.5y48.1,n9xy', e => { seen.push(e); return false; }), undefined);
  assert.deepEqual(seen, [{type: 'way', id: 10, tags: {railway: 'rail'}}]);
});

const osmium = spawnSync('osmium', ['--version'], {encoding: 'utf8'});
test('with osmium, a real Overpass way and route relation come back field for field', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-elements-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const way = await fixture('overpass-meta-way-4853887.json'), relation = await fixture('overpass-meta-relation-10003040.json');
  // The extract holds the way's nodes (untagged) and the two elements, with
  // their versions and times; the relation's other members are elsewhere.
  const nodes = way.nodes.map((id, i) => `<node id="${id}" version="1" timestamp="2026-01-01T00:00:00Z" lat="${way.geometry[i].lat}" lon="${way.geometry[i].lon}"/>`).join('');
  await writeFile(join(dir, 'in.osm'), `<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">${nodes}`
    + `<way id="${way.id}" version="${way.version}" timestamp="${way.timestamp}">${way.nodes.map(n => `<nd ref="${n}"/>`).join('')}${tagXml(way.tags)}</way>`
    + `<relation id="${relation.id}" version="${relation.version}" timestamp="${relation.timestamp}">${relation.members.map(m => `<member type="${m.type}" ref="${m.ref}" role="${xml(m.role)}"/>`).join('')}${tagXml(relation.tags)}</relation></osm>`);
  assert.equal(spawnSync('osmium', ['cat', join(dir, 'in.osm'), '-o', join(dir, 'in.osm.pbf')]).status, 0);
  const got = [];
  const counts = await readElements(join(dir, 'in.osm.pbf'), {onElement: e => got.push(e)});
  assert.deepEqual(got, [way, relation], 'the same fields and values as Overpass gave');
  assert.deepEqual(counts, {read: 2, kept: 2, withoutGeometry: 0}, 'untagged nodes are not elements of their own');
  const none = await readElements(join(dir, 'in.osm.pbf'), {keep: e => e.type === 'node', onElement: () => assert.fail('nothing kept')});
  assert.deepEqual(none, {read: 2, kept: 0, withoutGeometry: 0});
  // A selection keeps only what it accepts.
  const ways = [];
  await readElements(join(dir, 'in.osm.pbf'), {keep: e => e.type === 'way', onElement: e => ways.push(e.id)});
  assert.deepEqual(ways, [way.id]);
});

test('a way with a node the extract lacks is counted and left out; the rest of the extract still reads', {skip: osmium.status !== 0 && 'osmium is not installed'}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'extract-elements-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await writeFile(join(dir, 'in.osm'), '<?xml version="1.0" encoding="UTF-8"?><osm version="0.6">'
    + '<node id="1" version="1" timestamp="2026-01-01T00:00:00Z" lat="48.1" lon="11.5"/><node id="2" version="1" timestamp="2026-01-01T00:00:00Z" lat="48.2" lon="11.6"/>'
    + '<way id="10" version="1" timestamp="2026-01-01T00:00:00Z"><nd ref="1"/><nd ref="9"/><tag k="railway" v="rail"/></way>'
    + '<way id="11" version="1" timestamp="2026-01-01T00:00:00Z"><nd ref="1"/><nd ref="2"/><tag k="railway" v="rail"/></way></osm>');
  assert.equal(spawnSync('osmium', ['cat', join(dir, 'in.osm'), '-o', join(dir, 'in.osm.pbf')]).status, 0);
  const ids = [];
  assert.deepEqual(await readElements(join(dir, 'in.osm.pbf'), {onElement: e => ids.push(e.id)}), {read: 2, kept: 1, withoutGeometry: 1});
  assert.deepEqual(ids, [11]);
});

test('a failing osmium fails the read instead of returning a short list', {skip: osmium.status !== 0 && 'osmium is not installed'}, async () => {
  await assert.rejects(readElements('/nonexistent/extract.osm.pbf'), /osmium add-locations-to-ways failed/);
});

test('a kept element holds only its own data, not the chunk of output it arrived in', async () => {
  const {setFlagsFromString} = await import('node:v8');
  const {runInNewContext} = await import('node:vm');
  const {PassThrough} = await import('node:stream');
  const {EventEmitter} = await import('node:events');
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc');
  // 400 chunks of about 256 KB, as a pipe delivers them, each with one kept
  // node among untagged padding.
  const padding = 'n1 v1 dV c0 t2026-01-01T00:00:00Z i0 u T x1 y1\n'.repeat(5500);
  const run = () => {
    const child = new EventEmitter(), stdout = new PassThrough(), stderr = new PassThrough();
    Object.assign(child, {stdout, stderr});
    (async () => {
      for (let i = 0; i < 400; i++) {
        stdout.write(`${padding}n${1000 + i} v1 dV c0 t2026-01-01T00:00:00Z i0 u Trailway=signal,name=Signal%20%${i} x11.5 y48.1\n`);
        await new Promise(resolve => setImmediate(resolve));
      }
      stdout.end(); stderr.end();
      child.emit('close', 0);
    })();
    return child;
  };
  gc();
  const before = process.memoryUsage().heapUsed;
  const kept = [];
  await readElements('x', {keep: e => e.type === 'node' && e.tags?.railway === 'signal', onElement: e => kept.push(e), run});
  gc();
  const held = process.memoryUsage().heapUsed - before;
  assert.equal(kept.length, 400);
  assert.deepEqual(kept[7].tags, {railway: 'signal', name: 'Signal 7'});
  // The chunks total about 100 MB; 400 small elements are well under 10 MB.
  assert.ok(held < 10e6, `${Math.round(held / 1e6)} MB held for 400 elements`);
});
