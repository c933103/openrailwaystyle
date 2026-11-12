// Station points built from the assembled Geofabrik extract
// (scripts/assemble-extracts.mjs) instead of Overpass (#330, step 9):
//   node scripts/build-extract-station-points.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>
// The same selection as the Overpass query (stationRegionQuery), the same
// elements as a cycle keeps them (stationElement), the same conversion
// (stationRecords) and tiles (stationOverviewData). Overpass gives a way or
// relation its `out center`; here the centre is computed the way Overpass
// computes it (osm-centre.mjs), so the same elements give the same records.
// Two passes, since an OSM file lists relations last: the stations, then the
// station relations' member nodes and ways, for their centres. The members
// are first cut out of the extract by osmium (getid with their ways' nodes),
// so the second pass reads a few thousand objects, not every node.
// It writes source.json for the site's source switch
// (scripts/data-source.mjs); complete only when the assembly covers every
// planned region and gap tile.
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {checkAssembly, coversWorld} from './build-extract-branch-lines.mjs';
import {readElements} from './extract-elements.mjs';
import {overpassCentre} from './osm-centre.mjs';
import {stationElement, stationRecords} from './station-acquisition.mjs';
import {stationOverviewData} from './station-overview.mjs';

const MODES = ['train', 'subway', 'light_rail', 'tram', 'monorail', 'funicular'];
// What stationRegionQuery selects, element by element.
export const isStationElement = ({tags = {}}) => /^(station|halt|tram_stop)$/.test(tags.railway ?? '')
  || tags.public_transport === 'station' && MODES.some(mode => tags[mode] === 'yes');

// The extract cut to the given objects and the nodes of its ways; resolves
// to the file and a function that removes it.
export async function osmiumSubset(pbf, ids) {
  const dir = await mkdtemp(join(tmpdir(), 'station-members-'));
  await writeFile(join(dir, 'ids.txt'), `${ids.join('\n')}\n`);
  await promisify(execFile)('osmium', ['getid', '--add-referenced', '--id-file', join(dir, 'ids.txt'), pbf, '-o', join(dir, 'members.osm.pbf')], {maxBuffer: 16 << 20})
    .catch(error => { if (error.code !== 1) throw error; }); // 1: some ids are not in the file
  return {file: join(dir, 'members.osm.pbf'), remove: () => rm(dir, {recursive: true, force: true})};
}

// The kept elements, each way and relation with its centre: `read` is called
// once, and once more, on the members `subset` cuts out, when there are
// station relations.
export async function stationElements(pbf, {read = readElements, subset = osmiumSubset} = {}) {
  const elements = [], relations = [], memberNodes = new Set(), memberWays = new Set();
  const first = await read(pbf, {keep: isStationElement, onElement: element => {
    if (element.type === 'node') elements.push(stationElement(element));
    else if (element.type === 'way') elements.push(stationElement({...element, center: overpassCentre(element.geometry)}));
    else {
      relations.push(element);
      for (const m of element.members || []) (m.type === 'node' ? memberNodes : m.type === 'way' ? memberWays : new Set()).add(m.ref);
    }
  }});
  const points = new Map();
  let second = {read: 0, kept: 0, withoutGeometry: 0};
  if (relations.length) {
    const members = await subset(pbf, [...[...memberNodes].map(id => `n${id}`), ...[...memberWays].map(id => `w${id}`)]);
    try {
      second = await read(members.file, {untaggedNodes: true,
        keep: e => e.type === 'node' ? memberNodes.has(e.id) : e.type === 'way' && memberWays.has(e.id),
        onElement: e => points.set(`${e.type}${e.id}`, e.type === 'node' ? [{lat: e.lat, lon: e.lon}] : e.geometry)});
    } finally { await members.remove(); }
  }
  const withoutCentre = [];
  for (const relation of relations) {
    const center = overpassCentre((relation.members || []).flatMap(m => points.get(`${m.type}${m.ref}`) || []));
    // A relation none of whose members the extract holds has no centre;
    // Overpass would give one, so it is counted, not guessed.
    if (!center) { withoutCentre.push(relation.id); continue; }
    elements.push(stationElement({...relation, center}));
  }
  return {elements, counts: {read: first.kept, relations: relations.length, memberNodes: memberNodes.size, memberWays: memberWays.size,
    membersRead: second.kept, waysWithoutGeometry: first.withoutGeometry + second.withoutGeometry, relationsWithoutCentre: withoutCentre}};
}

export async function buildExtractStationPoints(pbf, report, out, {read = readElements, subset = osmiumSubset, now = () => new Date()} = {}) {
  checkAssembly(report);
  const {elements, counts} = await stationElements(pbf, {read, subset});
  const records = stationRecords(elements);
  const tiles = stationOverviewData(records);
  await rm(out, {recursive: true, force: true});
  await mkdir(out, {recursive: true});
  for (const [path, bytes] of tiles.archives) {
    await mkdir(dirname(join(out, path)), {recursive: true});
    await writeFile(join(out, path), bytes);
  }
  await writeFile(join(out, 'index.json'), `${JSON.stringify(tiles.index)}\n`);
  await writeFile(join(out, 'stations.json.gz'), gzipSync(JSON.stringify(records), {level: 6}));
  const complete = coversWorld(report);
  // The fields the site checks of a station snapshot (site.yml), with the
  // assembly's regions as the completed ones.
  const manifest = {...tiles.manifest, complete, source: 'OpenStreetMap via the Geofabrik extracts', license: 'ODbL-1.0',
    pendingRegions: complete ? 0 : (report.missingRegions?.length ?? null), completedRegions: report.regions,
    generated: now().toISOString(), updated: report.oldestTimestamp, oldestSource: report.oldestTimestamp, newestSource: report.newestTimestamp,
    elements: elements.length, extract: {index: report.index, regions: report.regions, missingRegions: report.missingRegions, ...counts}};
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(out, 'source.json'), `${JSON.stringify({schema: 1, dataset: 'station-points', source: 'extract', complete, osmTimestamp: report.oldestTimestamp})}\n`);
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [pbf, reportFile, out] = process.argv.slice(2);
  if (!pbf || !reportFile || !out) throw new Error('Usage: build-extract-station-points.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>');
  console.log(JSON.stringify(await buildExtractStationPoints(pbf, JSON.parse(await readFile(reportFile, 'utf8')), out)));
}
