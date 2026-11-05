// One OSM file from the regions' working copies (#330, B3): the filtered
// extracts named by the index of the osm-extract release
// (scripts/extract-release.mjs), whatever their dates.
//   node scripts/assemble-extracts.mjs <index.json> <directory of region files> <output.osm.pbf>
// It writes the output and <output>.json, the report.
//
// Rules, in order:
// 1. Deleted in a newer region. Regions refresh independently, so an object
//    can be gone from a newer region and still be in an older neighbour that
//    overlaps it. Where the newer region R and the older region Q were
//    filtered the same way, an object of Q lying wholly inside R's polygon
//    would be in R's file if it still existed with those tags; when R does
//    not have it, it is removed from Q. A node a remaining way of Q still
//    uses is kept. An object reaching outside R stays until its own region
//    refreshes.
// 2. The highest version wins: `osmium merge` keeps one copy of each
//    version, `osmium time-filter` the newest of them.
// 3. Ways whose nodes are missing are counted (`osmium check-refs`) and
//    reported, never silently dropped.
// Nothing is downloaded: the region files come from our own release.
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Runs a command; `lines` receives each line of its output. Exit codes in
// `accept` are not failures (osmium getid exits 1 when some ids are absent;
// check-refs exits 1 when some references are missing).
export function run(command, args, {lines, accept = [0]} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']});
    let stderr = '', stdout = '';
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 1e6) stderr = stderr.slice(-1e5); });
    const reader = lines ? createInterface({input: child.stdout}) : null;
    if (reader) reader.on('line', lines); else child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', code => accept.includes(code) ? resolve({code, stdout, stderr})
      : reject(new Error(`${command} ${args.join(' ')}: exit ${code}: ${stderr.trim().slice(-500)}`)));
  });
}

const bbox = polygon => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const part of polygon) for (const ring of part) for (const [x, y] of ring) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  return [minX, minY, maxX, maxY];
};
const touches = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

// The pairs the deletion rule compares: a newer region with a polygon, an
// older one whose bounds touch it, both made with the same filter. Pairs it
// cannot compare are listed with the reason.
export function comparablePairs(index) {
  const entries = Object.values(index.regions || {});
  const pairs = [], skipped = [];
  for (const newer of entries) for (const older of entries) {
    if (newer === older || !(Date.parse(newer.sourceTimestamp) > Date.parse(older.sourceTimestamp))) continue;
    const polygon = index.polygons?.[newer.region], other = index.polygons?.[older.region];
    if (polygon && other && !touches(bbox(polygon), bbox(other))) continue;
    if (!polygon) { skipped.push({newer: newer.region, older: older.region, reason: 'no polygon for the newer region'}); continue; }
    if (newer.filter !== older.filter) { skipped.push({newer: newer.region, older: older.region, reason: 'made with different filters'}); continue; }
    pairs.push({newer, older});
  }
  return {pairs, skipped};
}

// One OPL line: its object id (n1, w2, r3), and the ids it refers to.
export function parseOpl(line) {
  const fields = line.split(' ');
  const id = fields[0];
  const refs = [];
  for (const field of fields) {
    if (id[0] === 'w' && field[0] === 'N') refs.push(...field.slice(1).split(',').filter(Boolean));
    if (id[0] === 'r' && field[0] === 'M') refs.push(...field.slice(1).split(',').filter(Boolean).map(member => member.slice(0, member.indexOf('@'))));
  }
  return {id, refs};
}

// Of an older region's objects, those wholly inside the newer region's
// polygon. `insideNodes` are its nodes inside the polygon (osmium extract,
// simple strategy, which gives nodes only); `objects` are its ways and
// relations using any of them, with all their references (complete_ways
// strategy, which also brings nodes outside, so its nodes are not used).
export function whollyInside(objects, insideNodes) {
  const inside = new Set(insideNodes);
  for (const o of objects) if (o.id[0] === 'w' && o.refs.length && o.refs.every(ref => inside.has(ref))) inside.add(o.id);
  // A relation of relations: repeat until nothing more is added.
  for (let added = true; added;) {
    added = false;
    for (const o of objects) if (o.id[0] === 'r' && !inside.has(o.id) && o.refs.length && o.refs.every(ref => inside.has(ref))) { inside.add(o.id); added = true; }
  }
  return inside;
}

// The objects to remove from the older region: wholly inside the newer one
// and absent from it, less any node a way that stays still uses.
export function deletions(objects, insideNodes, presentInNewer) {
  const gone = new Set([...whollyInside(objects, insideNodes)].filter(id => !presentInNewer.has(id)));
  for (const o of objects) if (o.id[0] === 'w' && !gone.has(o.id)) for (const ref of o.refs) gone.delete(ref);
  return gone;
}

const regionFile = (dir, entry) => join(dir, entry.asset);

async function oplObjects(args) {
  const objects = [];
  await run('osmium', [...args, '-f', 'opl', '-o', '-'], {lines: line => { if (line) objects.push(parseOpl(line)); }, accept: [0, 1]});
  return objects;
}

export async function assemble(index, dir, output, {work} = {}) {
  const temp = work || await mkdtemp(join(tmpdir(), 'assemble-'));
  const started = performance.now();
  const {pairs, skipped} = comparablePairs(index);
  const removed = new Map();
  for (const {newer, older} of pairs) {
    const polygonFile = join(temp, `${newer.region.replaceAll('/', '--')}.geojson`);
    await writeFile(polygonFile, JSON.stringify({type: 'Feature', properties: {}, geometry: {type: 'MultiPolygon', coordinates: index.polygons[newer.region]}}));
    const nodesPart = join(temp, 'nodes.osm.pbf'), waysPart = join(temp, 'ways.osm.pbf');
    await run('osmium', ['extract', '-p', polygonFile, '-s', 'simple', regionFile(dir, older), '-o', nodesPart, '--overwrite']);
    await run('osmium', ['extract', '-p', polygonFile, '-s', 'complete_ways', regionFile(dir, older), '-o', waysPart, '--overwrite']);
    const insideNodes = (await oplObjects(['cat', '-t', 'node', nodesPart])).map(o => o.id);
    const objects = (await oplObjects(['cat', '-t', 'way', '-t', 'relation', waysPart]));
    const candidates = [...whollyInside(objects, insideNodes)];
    if (!candidates.length) continue;
    const idFile = join(temp, 'ids.txt');
    await writeFile(idFile, `${candidates.join('\n')}\n`);
    const present = new Set((await oplObjects(['getid', regionFile(dir, newer), '-i', idFile])).map(o => o.id));
    const gone = deletions(objects, insideNodes, present);
    if (!gone.size) continue;
    const set = removed.get(older.region) || new Set();
    for (const id of gone) set.add(id);
    removed.set(older.region, set);
  }
  // Each region file with the objects found deleted removed.
  const inputs = [];
  for (const entry of Object.values(index.regions)) {
    const ids = removed.get(entry.region);
    if (!ids) { inputs.push(regionFile(dir, entry)); continue; }
    const idFile = join(temp, 'remove.txt'), pruned = join(temp, `${entry.region.replaceAll('/', '--')}.pruned.osm.pbf`);
    await writeFile(idFile, `${[...ids].join('\n')}\n`);
    await run('osmium', ['removeid', regionFile(dir, entry), '-i', idFile, '-o', pruned, '--overwrite']);
    inputs.push(pruned);
  }
  const merged = join(temp, 'merged.osm.pbf');
  await run('osmium', ['merge', '--with-history', ...inputs, '-o', merged, '--overwrite']);
  await run('osmium', ['time-filter', merged, '-o', output, '--overwrite']);
  const refs = await run('osmium', ['check-refs', output], {accept: [0, 1]});
  // osmium 1.16 prints "Nodes in ways missing: <n>".
  const missing = /Nodes in ways missing: (\d+)/.exec(refs.stderr + refs.stdout);
  const {stdout: info} = await run('osmium', ['fileinfo', '-e', '-j', output]);
  const report = {schema: 1, index: index.generation, regions: Object.keys(index.regions).length,
    oldestTimestamp: index.oldestTimestamp, newestTimestamp: index.newestTimestamp,
    counts: (({nodes, ways, relations}) => ({nodes, ways, relations}))(JSON.parse(info).data.count), bytes: (await stat(output)).size,
    deletions: Object.fromEntries([...removed].map(([region, ids]) => [region, ids.size]).sort()),
    pairsCompared: pairs.length, pairsSkipped: skipped,
    missingNodeRefs: missing ? Number(missing[1]) : null,
    seconds: (performance.now() - started) / 1000};
  await writeFile(`${output}.json`, `${JSON.stringify(report, null, 2)}\n`);
  if (!work) await rm(temp, {recursive: true, force: true});
  return report;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [indexFile, dir, output] = process.argv.slice(2);
  if (!indexFile || !dir || !output) throw new Error('Usage: assemble-extracts.mjs <index.json> <directory> <output.osm.pbf>');
  console.log(JSON.stringify(await assemble(JSON.parse(await readFile(indexFile, 'utf8')), dir, output), null, 2));
}
