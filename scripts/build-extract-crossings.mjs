// Level crossings built from the assembled Geofabrik extract
// (scripts/assemble-extracts.mjs) instead of Overpass (#330, step 9):
//   node scripts/build-extract-crossings.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>
// The same table as the Overpass query makes it (regionQuery and parseRows
// in crossing-data.mjs and crossing-rows.mjs), written to the same files
// (crossingFiles). One pass: an OSM file lists nodes before ways, so the
// crossing nodes are known when the railway ways through them are read.
// It writes source.json for the site's source switch
// (scripts/data-source.mjs); complete only when the assembly covers every
// planned region and gap tile.
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkAssembly, coversWorld} from './build-extract-branch-lines.mjs';
import {readElements} from './extract-elements.mjs';
import {KINDS, SEP, TAG_KEYS, crossingFiles, inBox} from './crossing-data.mjs';

// What regionQuery selects: the crossing nodes (.c), and the ways with a
// railway tag through them (way(bn.c)[railway], .w).
export const isCrossing = ({type, tags = {}}) => type === 'node' && Object.hasOwn(KINDS, tags.railway ?? '');
export const isRailwayWay = ({type, tags = {}}) => type === 'way' && tags.railway !== undefined;
// MINOR_TRACKS (crossing-data.mjs), the same four alternatives: a tram,
// light rail, funicular or miniature railway; a planned or former one of
// those (a lifecycle key holding the mode) on a way that is no active
// railway; a service track; street running.
const MINOR_KIND = /^(tram|light_rail|funicular|miniature)$/;
const ACTIVE = /^(rail|narrow_gauge|light_rail|subway|tram|monorail|funicular|miniature)$/;
const LIFECYCLE_KEY = /^(proposed|construction|disused|abandoned|razed|demolished|removed)(:railway)?$/;
export const isMinorTrack = (tags = {}) => MINOR_KIND.test(tags.railway ?? '')
  || !ACTIVE.test(tags.railway ?? '') && Object.entries(tags).some(([key, value]) => LIFECYCLE_KEY.test(key) && MINOR_KIND.test(value))
  || tags.service !== undefined || tags.embedded === 'yes';

// A value as Overpass writes it in CSV (escape_csv in its
// src/overpass_api/output_formats/output_csv.cc, RFC 4180): in double
// quotes, with its own double quotes doubled, when it holds a line break, a
// comma or a double quote. parseRows keeps the quotes, so the Overpass table
// stores `"km 18,145"`; the extract table stores the same.
export const overpassCsvValue = value => /[\n,"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

// A crossing's tags as the CSV rows give them (parseRows): the TAG_KEYS with
// a value, as Overpass writes it; null (unreadable) when a value holds the
// column separator, which shifts the Overpass row's columns.
export function crossingTags(tags = {}) {
  const kept = {};
  for (const key of TAG_KEYS) {
    const value = tags[key];
    if (value === undefined || value === '') continue;
    if (value.includes(SEP)) return null;
    kept[key] = overpassCsvValue(value);
  }
  return kept;
}

// The crossing table (id → [lat, lon, kind, minor, tags]) of the extract.
// A crossing is minor when railway ways pass through it and every one is a
// minor track (node.c(w.mw) less node.c(w.jw)); one with no railway way is
// major, as in the query. The world regions' boxes end below 90° N and
// 180° E (replaceRegion keeps what inBox accepts), so neither does this.
export async function crossingTable(pbf, {read = readElements} = {}) {
  const crossings = new Map(), onMinor = new Set(), onMajor = new Set();
  let ways = 0, outside = 0;
  const counts = await read(pbf, {geometry: false,
    keep: element => isCrossing(element) || isRailwayWay(element),
    onElement: element => {
      if (element.type === 'node') {
        if (ways) throw new Error(`Node ${element.id} after a way: the extract is not sorted`);
        crossings.set(element.id, element);
        return;
      }
      ways++;
      const minor = isMinorTrack(element.tags);
      for (const id of element.nodes) if (crossings.has(id)) (minor ? onMinor : onMajor).add(id);
    }});
  const table = new Map();
  for (const [id, {lat, lon, tags}] of crossings) {
    if (!inBox([-90, -180, 90, 180], lat, lon)) { outside++; continue; }
    table.set(id, [lat, lon, KINDS[tags.railway], onMinor.has(id) && !onMajor.has(id), crossingTags(tags)]);
  }
  return {table, counts: {read: counts.kept, railwayWays: ways, crossings: crossings.size, outsideWorldBoxes: outside}};
}

export async function buildExtractCrossings(pbf, report, out, {read = readElements, now = () => new Date()} = {}) {
  checkAssembly(report);
  const {table, counts} = await crossingTable(pbf, {read});
  const {files, tiles, tileBytes, counts: kinds} = crossingFiles(table);
  await rm(out, {recursive: true, force: true});
  await mkdir(out, {recursive: true});
  for (const [path, data] of files) {
    await mkdir(dirname(join(out, path)), {recursive: true});
    await writeFile(join(out, path), data);
  }
  const complete = coversWorld(report);
  // The fields of the Overpass snapshot's manifest the site reads (tags) and
  // shows, with the assembly's dates as the data's.
  const manifest = {generated: now().toISOString(), complete, tags: true, crossings: table.size, road: kinds.road, pedestrian: kinds.foot, onMinorTracksOnly: kinds.minor,
    tiles, tileBytes, oldestSource: report.oldestTimestamp, newestSource: report.newestTimestamp, source: 'OpenStreetMap via the Geofabrik extracts',
    query: 'node[railway=level_crossing] and node[railway=crossing]; minor: only on tram, light rail, funicular, miniature, service or street-running tracks', license: 'ODbL-1.0',
    description: 'OpenStreetMap railway level crossings (road: railway=level_crossing; pedestrian: railway=crossing). Coverage follows OSM mapping.',
    extract: {index: report.index, regions: report.regions, missingRegions: report.missingRegions, ...counts}};
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(out, 'source.json'), `${JSON.stringify({schema: 1, dataset: 'crossings', source: 'extract', complete, osmTimestamp: report.oldestTimestamp})}\n`);
  return manifest;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [pbf, reportFile, out] = process.argv.slice(2);
  if (!pbf || !reportFile || !out) throw new Error('Usage: build-extract-crossings.mjs <assembled.osm.pbf> <assembled.osm.pbf.json> <output directory>');
  console.log(JSON.stringify(await buildExtractCrossings(pbf, JSON.parse(await readFile(reportFile, 'utf8')), out)));
}
