// The elements of an assembled extract (scripts/assemble-extracts.mjs) in the
// shape an Overpass `out meta geom` answer gives them, so the builders that
// read stored Overpass answers can read the extracts unchanged (#330, step 9).
//   way:      {type, id, timestamp, version, bounds, nodes, geometry, tags}
//   relation: {type, id, timestamp, version, members, tags}
//   node:     {type, id, timestamp, version, lat, lon, tags}
// as in the sanitized real answers in tests/fixtures/service-geometry.
// Osmium writes each way with its nodes' locations
// (`add-locations-to-ways`, OPL); only tagged nodes are kept, as an Overpass
// answer of ways and relations holds no untagged nodes of its own.
// A way with a node the extract does not hold has no full geometry; it is
// left out and counted, never given a partial line.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

// OPL escapes a character as %<hex code point>%.
export const unescapeOpl = text => text.replace(/%([0-9a-f]+)%/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));

const pairs = text => text ? text.split(',') : [];
function parseTags(text) {
  const tags = {};
  for (const pair of pairs(text)) {
    const at = pair.indexOf('=');
    tags[unescapeOpl(pair.slice(0, at))] = unescapeOpl(pair.slice(at + 1));
  }
  return tags;
}
const TYPES = {n: 'node', w: 'way', r: 'relation'};

// One OPL line as an element; null for a way missing a node location;
// undefined when `accept`, given {type, id, tags} only, turns it down, so
// the geometry of the many ways a build does not want is never made.
export function parseLine(line, accept = () => true) {
  const fields = line.split(' ');
  const type = TYPES[fields[0][0]], id = Number(fields[0].slice(1));
  if (!type || !Number.isSafeInteger(id)) throw new Error(`Not an OPL object line: ${line.slice(0, 80)}`);
  const field = key => fields.find(f => f[0] === key)?.slice(1) ?? '';
  const tags = parseTags(field('T'));
  if (!accept({type, id, tags})) return undefined;
  const element = {type, id, timestamp: field('t'), version: Number(field('v'))};
  if (type === 'node') {
    const lon = Number(field('x')), lat = Number(field('y'));
    if (field('x') === '' || field('y') === '') return null;
    Object.assign(element, {lat, lon});
  } else if (type === 'way') {
    const nodes = [], geometry = [];
    for (const ref of pairs(field('N'))) {
      const m = /^n(\d+)x(-?[\d.]*)y(-?[\d.]*)$/.exec(ref);
      if (!m || m[2] === '' || m[3] === '') return null;
      nodes.push(Number(m[1])); geometry.push({lat: Number(m[3]), lon: Number(m[2])});
    }
    const lats = geometry.map(p => p.lat), lons = geometry.map(p => p.lon);
    Object.assign(element, {bounds: {minlat: Math.min(...lats), minlon: Math.min(...lons), maxlat: Math.max(...lats), maxlon: Math.max(...lons)}, nodes, geometry});
  } else {
    element.members = pairs(field('M')).map(member => {
      const at = member.indexOf('@');
      return {type: TYPES[member[0]], ref: Number(member.slice(1, at)), role: unescapeOpl(member.slice(at + 1))};
    });
  }
  if (Object.keys(tags).length) element.tags = tags;
  return element;
}

// The extract's elements that `keep` accepts, streamed from osmium; resolves
// to the counts. keep decides on {type, id, tags}; onElement receives each
// kept element whole, and should convert it at once rather than hold it:
// a world extract holds millions of ways. Untagged nodes (the nodes of
// ways) are elements too only with untaggedNodes, for a build that needs the
// positions of relation members.
export async function readElements(pbf, {keep = () => true, onElement, untaggedNodes = false, run = spawn} = {}) {
  const child = run('osmium', ['add-locations-to-ways', '--ignore-missing-nodes', ...(untaggedNodes ? ['--keep-untagged-nodes'] : []), pbf, '-f', 'opl', '-o', '-'], {stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  const counts = {read: 0, kept: 0, withoutGeometry: 0};
  for await (const line of createInterface({input: child.stdout, crlfDelay: Infinity})) {
    if (!line) continue;
    counts.read++;
    // keep sees the type and tags first; a way it wants is then made whole.
    const element = parseLine(line, keep);
    if (element === undefined) continue;
    if (element === null) { counts.withoutGeometry++; continue; }
    counts.kept++;
    // A copy: strings parsed from a line can be slices of the whole chunk of
    // osmium's output it arrived in, and a kept tag would hold that chunk
    // for as long as the build keeps the element (measured on the world's
    // 196,342 stations: 2.4 GB of heap kept as read, 211 MB as copies).
    await onElement?.(structuredClone(element));
  }
  const code = await exited;
  if (code !== 0) throw new Error(`osmium add-locations-to-ways failed (${code}): ${stderr.trim().slice(0, 500)}`);
  return counts;
}
