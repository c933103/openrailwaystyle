// Which Geofabrik files the extract pipeline downloads (#330, B1). One plan
// for every dataset: a region is kept whole when its PBF is at most
// MAX_REGION_BYTES (so one GitHub runner, 14 GB of disk, can download and
// filter it); otherwise the plan descends to the region's children. Run by
// `.github/workflows/osm-gaps.yml`:
//   node scripts/plan-osm-regions.mjs <output directory>
// It writes plan.json (the regions with URL, size and parent, and the
// remainder) and plan.md, a report.
//
// Rules:
// - The eight continents are the roots (scripts/measure-osm-gaps.mjs).
// - Coverage is judged on land: Natural Earth land on a 0.1° grid
//   (scripts/land-raster.mjs). Geofabrik's polygons carry sea buffers of
//   different widths, so their areas do not show what land they cover.
// - Geofabrik lists some "special" children that combine siblings (us,
//   us-west, alps, ...). Siblings are taken from the most land down; one whose
//   land lies at least AGGREGATE_SHARE inside the siblings still kept is such
//   an aggregate and is not used. A dropped one no longer counts as cover, so
//   of two identical regions exactly one is kept.
// - A region over the limit without usable children is kept, marked
//   `oversized`, and the plan is invalid; the land is never dropped.
// - Gap filling: land no planned region covers (a split can lose a country
//   Geofabrik lists elsewhere, such as russia) is filled greedily from any
//   other region in the index, the one adding the most uncovered land first,
//   descended like the roots when over the limit. A region whose own land is
//   already at least AGGREGATE_SHARE covered, or that adds under
//   MIN_FILL_CELLS land cells, is not used.
// - The remainder is the world minus the union of the planned regions. It is
//   never dropped: the extract pipeline covers it from Overpass (B0b). Its
//   land is reported, and land above MAX_REMAINDER_LAND_KM2 makes the plan
//   invalid: Overpass carries small islands, not countries.
// - An invalid plan is still written, with `valid: false` and its problems,
//   and the command fails, so nothing downstream takes it.
import polygonClipping from 'polygon-clipping';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CONTINENTS, normalize, areaKm2, extent} from './measure-osm-gaps.mjs';
import {landRaster, landCells, cellsKm2, cellCorner} from './land-raster.mjs';

export const MAX_REGION_BYTES = 8 * 1024 ** 3;
export const AGGREGATE_SHARE = 0.9;
export const MIN_FILL_CELLS = 100;
export const MAX_REMAINDER_LAND_KM2 = 50_000;
export const OVERLAP_WARN_SHARE = 0.01;
const WORLD = [[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]];

const asMulti = geometry => geometry?.type === 'Polygon' ? [geometry.coordinates]
  : geometry?.type === 'MultiPolygon' ? geometry.coordinates : (() => { throw new Error(`Expected a polygon, got ${geometry?.type}`); })();

export function indexRegions(index) {
  const regions = new Map();
  for (const feature of index.features || []) {
    const {id, parent = null, urls = {}} = feature.properties || {};
    if (!id || !feature.geometry) continue;
    const polygon = normalize(asMulti(feature.geometry));
    regions.set(id, {id, parent, pbf: urls.pbf || null, polygon, areaKm2: areaKm2(polygon)});
  }
  return regions;
}

const cellsOf = (region, land) => region.cells ??= landCells(region.polygon, land);

// The children of a region worth downloading: aggregates of their siblings
// are left out.
export function usableChildren(regions, parentId, land) {
  if (!land) throw new Error('usableChildren needs a land raster');
  const children = [...regions.values()].filter(region => region.parent === parentId && region.pbf);
  const count = new Uint16Array(land.length);
  for (const child of children) for (const cell of cellsOf(child, land)) count[cell]++;
  const dropped = new Set();
  for (const child of [...children].sort((a, b) => cellsOf(b, land).length - cellsOf(a, land).length || a.id.localeCompare(b.id))) {
    const cells = cellsOf(child, land);
    // A child with no land cell gives 0/0, never at least the share: kept.
    let covered = 0;
    for (const cell of cells) if (count[cell] > 1) covered++;
    if (covered / cells.length >= AGGREGATE_SHARE) {
      dropped.add(child.id);
      for (const cell of cells) count[cell]--;
    }
  }
  return children.filter(child => !dropped.has(child.id)).sort((a, b) => a.areaKm2 - b.areaKm2 || a.id.localeCompare(b.id));
}

// The remainder's land, summed per 10° tile (largest first).
function landTiles(cells) {
  const tiles = new Map();
  for (const cell of cells) {
    const [x, y] = cellCorner(cell), key = `${Math.floor(x / 10) * 10},${Math.floor(y / 10) * 10}`;
    tiles.set(key, (tiles.get(key) ?? 0) + cellsKm2([cell]));
  }
  return [...tiles].map(([key, km2]) => { const [w, s] = key.split(',').map(Number); return {extent: [w, s, w + 10, s + 10], landKm2: km2}; })
    .sort((a, b) => b.landKm2 - a.landKm2 || a.extent[0] - b.extent[0] || a.extent[1] - b.extent[1]);
}

// sizeOf(region) resolves to the PBF size in bytes; land is landRaster().
// urlOf(region) is the file the plan records (default: the index's URL).
export async function planRegions(index, sizeOf, {land, maxBytes = MAX_REGION_BYTES, urlOf = region => region.pbf,
  minFillCells = MIN_FILL_CELLS, maxRemainderLandKm2 = MAX_REMAINDER_LAND_KM2} = {}) {
  if (!land) throw new Error('planRegions needs a land raster');
  const regions = indexRegions(index);
  for (const id of CONTINENTS) if (!regions.has(id)) throw new Error(`Geofabrik index has no region ${id}`);
  const chosen = new Map(), splits = [], split = new Set(), sizes = new Map();
  const visit = async (region, depth, via) => {
    const bytes = await sizeOf(region);
    if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`No size for ${region.id}`);
    sizes.set(region.id, bytes);
    if (bytes <= maxBytes) { chosen.set(region.id, {region, bytes, oversized: false, depth, via}); return; }
    const children = usableChildren(regions, region.id, land);
    if (!children.length) { chosen.set(region.id, {region, bytes, oversized: true, depth, via}); return; }
    split.add(region.id);
    const gap = polygonClipping.difference(region.polygon, polygonClipping.union(...children.map(child => child.polygon)));
    const inChildren = new Set(children.flatMap(child => [...cellsOf(child, land)]));
    const gapLand = [...cellsOf(region, land)].filter(cell => !inChildren.has(cell));
    splits.push({id: region.id, bytes, children: children.map(child => child.id), gapKm2: areaKm2(gap), gapLandKm2: cellsKm2(gapLand), gapExtent: gap.length ? extent(gap) : null});
    for (const child of children) if (!chosen.has(child.id)) await visit(child, depth + 1, via);
  };
  for (const id of CONTINENTS) await visit(regions.get(id), 0, 'descent');

  // Gap filling, from any region in the index.
  const cover = new Uint16Array(land.length);
  const addCover = region => { for (const cell of cellsOf(region, land)) cover[cell]++; };
  for (const {region} of chosen.values()) addCover(region);
  const fills = [];
  for (;;) {
    let best = null, bestGain = 0;
    for (const region of regions.values()) {
      if (!region.pbf || CONTINENTS.includes(region.id) || split.has(region.id) || chosen.has(region.id)) continue;
      const cells = cellsOf(region, land);
      let gain = 0;
      for (const cell of cells) if (!cover[cell]) gain++;
      if (gain < minFillCells || (cells.length - gain) / cells.length >= AGGREGATE_SHARE) continue;
      if (gain > bestGain || (gain === bestGain && region.id < best.id)) { best = region; bestGain = gain; }
    }
    if (!best) break;
    const before = new Set(chosen.keys());
    const gained = [...cellsOf(best, land)].filter(cell => !cover[cell]);
    await visit(best, 0, 'gap-fill');
    fills.push({id: best.id, landKm2: cellsKm2(gained)});
    for (const [id, {region}] of chosen) if (!before.has(id)) addCover(region);
  }

  const planned = [...chosen.values()].sort((a, b) => a.region.id.localeCompare(b.region.id));
  const covered = polygonClipping.union(...planned.map(entry => entry.region.polygon));
  const remainder = polygonClipping.difference(WORLD, covered);
  const remainderCells = [];
  for (let cell = 0; cell < land.length; cell++) if (land[cell] && !cover[cell]) remainderCells.push(cell);
  const remainderLandKm2 = cellsKm2(remainderCells);
  const overlaps = [];
  for (const {region} of planned) {
    const cells = cellsOf(region, land);
    let shared = 0;
    for (const cell of cells) if (cover[cell] > 1) shared++;
    if (cells.length && shared / cells.length > OVERLAP_WARN_SHARE) overlaps.push({id: region.id, share: shared / cells.length});
  }
  const problems = [
    ...planned.filter(entry => entry.oversized).map(entry => `${entry.region.id} is over the limit and cannot be split`),
    ...(remainderLandKm2 > maxRemainderLandKm2 ? [`remainder land ${Math.round(remainderLandKm2)} km² is over ${maxRemainderLandKm2} km²`] : []),
  ];
  return {
    valid: problems.length === 0, problems, maxBytes, splits, fills, overlaps,
    continentsBytes: CONTINENTS.reduce((sum, id) => sum + (sizes.get(id) ?? 0), 0),
    // The polygon goes with each region to the working copies' index: the
    // assembly decides with it whether a newer region would hold an object
    // (scripts/assemble-extracts.mjs).
    regions: planned.map(({region, bytes, oversized, depth, via}) => ({id: region.id, parent: region.parent, url: urlOf(region), bytes, oversized, depth, via,
      landKm2: cellsKm2(cellsOf(region, land)), polygon: region.polygon})),
    remainder: remainder.map(polygon => ({polygon, areaKm2: areaKm2([polygon]), extent: extent([polygon])})).sort((a, b) => b.areaKm2 - a.areaKm2),
    remainderLand: {km2: remainderLandKm2, tiles: landTiles(remainderCells).slice(0, 40)},
    coveredKm2: areaKm2(covered), worldKm2: areaKm2([WORLD]),
  };
}

const GiB = 1024 ** 3, km2 = value => Math.round(value).toLocaleString('en');
export function planReport(plan, sources = {}) {
  const largest = plan.regions.reduce((max, r) => Math.max(max, r.bytes), 0);
  const total = plan.regions.reduce((sum, r) => sum + r.bytes, 0);
  const lines = [
    '# Extract region plan', '',
    ...(plan.valid ? [] : ['**Not usable:** ' + plan.problems.join('; ') + '.', '']),
    ...Object.entries(sources).map(([name, value]) => `- ${name}: ${value}`),
    `- Limit per region: ${(plan.maxBytes / GiB).toFixed(1)} GiB`,
    `- Regions: ${plan.regions.length}; total ${(total / GiB).toFixed(2)} GiB (the eight continent files: ${(plan.continentsBytes / GiB).toFixed(2)} GiB); largest ${(largest / GiB).toFixed(2)} GiB; over the limit: ${plan.regions.filter(r => r.oversized).map(r => r.id).join(', ') || 'none'}`,
    `- Covered: ${km2(plan.coveredKm2)} km² of ${km2(plan.worldKm2)} km²; remainder (covered from Overpass): ${km2(plan.worldKm2 - plan.coveredKm2)} km² in ${plan.remainder.length} polygons, of which land ${km2(plan.remainderLand.km2)} km²`,
    `- Gap fills: ${plan.fills.map(f => `${f.id} (${km2(f.landKm2)} km² of land)`).join(', ') || 'none'}`,
    `- Regions sharing over ${Math.round(OVERLAP_WARN_SHARE * 100)}% of their land with another planned region: ${plan.overlaps.map(o => `${o.id} ${(o.share * 100).toFixed(1)}%`).join(', ') || 'none'}`,
    '', '| Region | Parent | Via | GiB | Land km² |', '| --- | --- | --- | ---: | ---: |',
    ...plan.regions.map(r => `| ${r.id}${r.oversized ? ' (over the limit)' : ''} | ${r.parent ?? '—'} | ${r.via} | ${(r.bytes / GiB).toFixed(2)} | ${km2(r.landKm2)} |`),
    '', '## Splits', '', '| Region | GiB | Children used | Gap left by the split, km² | Of which land, km² | Gap extent |', '| --- | ---: | ---: | ---: | ---: | --- |',
    ...plan.splits.map(sp => `| ${sp.id} | ${(sp.bytes / GiB).toFixed(2)} | ${sp.children.length} | ${km2(sp.gapKm2)} | ${km2(sp.gapLandKm2)} | ${sp.gapExtent ? sp.gapExtent.join(', ') : '—'} |`),
    '', '## Remainder land by 10° tile (largest 40)', '', '| Tile (W, S, E, N) | Land km² |', '| --- | ---: |',
    ...plan.remainderLand.tiles.map(t => `| ${t.extent.join(', ')} | ${km2(t.landKm2)} |`),
  ];
  return `${lines.join('\n')}\n`;
}

const USER_AGENT = 'RailwayAtlas-coverage/1 (+https://github.com/c933103/openrailwaystyle/issues/330)';
export const SIZE_HOST = 'download.geofabrik.de';

// The plan asks for dated files, as `mainline-reference.yml` does: Geofabrik
// serves `<region>-YYMMDD.osm.pbf` directly, while a `-latest` URL redirects,
// for the largest files to outside mirrors. Geofabrik keeps the daily dated
// files for about a week, so the default date is two days ago (UTC), the
// mainline default.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function defaultSourceDate(now = new Date()) {
  return new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10);
}
export function datedUrl(latestUrl, date, {now = new Date()} = {}) {
  if (!ISO_DATE.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error(`Invalid source date ${date}`);
  if (date > now.toISOString().slice(0, 10)) throw new Error(`Future source date ${date}`);
  const url = new URL(latestUrl);
  if (url.protocol !== 'https:' || url.host !== SIZE_HOST || !url.pathname.endsWith('-latest.osm.pbf')) throw new Error(`Not a Geofabrik -latest PBF: ${latestUrl}`);
  url.pathname = url.pathname.replace(/-latest\.osm\.pbf$/, `-${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}.osm.pbf`);
  return url.href;
}

// The size of a dated Geofabrik file from one HEAD request. Only HTTPS on
// download.geofabrik.de is asked, and any redirect, a non-OK status or a
// missing Content-Length stops the plan.
export async function headSize(url, {fetcher = fetch, userAgent = USER_AGENT} = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.host !== SIZE_HOST) throw new Error(`Refusing ${target.href}: only https://${SIZE_HOST}/ is asked`);
  const response = await fetcher(target.href, {method: 'HEAD', headers: {'User-Agent': userAgent}, redirect: 'manual'});
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${target.href}: unexpected redirect (HTTP ${response.status}) to ${response.headers.get('location') ?? 'no location'}; only the dated file on ${SIZE_HOST} is asked`);
  }
  if (!response.ok) throw new Error(`${target.href}: HTTP ${response.status}`);
  const bytes = Number(response.headers.get('content-length'));
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`${target.href}: no Content-Length`);
  return bytes;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const out = process.argv[2];
  if (!out) throw new Error('Usage: plan-osm-regions.mjs <output directory> [YYYY-MM-DD]');
  const date = process.argv[3] || defaultSourceDate();
  const urlOf = region => datedUrl(region.pbf, date);
  datedUrl(`https://${SIZE_HOST}/check-latest.osm.pbf`, date); // a bad date stops before any request
  const INDEX = 'https://download.geofabrik.de/index-v1.json';
  const response = await fetch(INDEX, {headers: {'User-Agent': USER_AGENT}, redirect: 'error'});
  if (!response.ok) throw new Error(`${INDEX}: HTTP ${response.status}`);
  const index = await response.json();
  // Natural Earth 1:10m land and minor islands (public domain), as
  // measure-osm-gaps.mjs reads them.
  const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
  const landFeatures = [];
  for (const name of ['ne_10m_land.geojson', 'ne_10m_minor_islands.geojson']) {
    const reply = await fetch(NE + name, {headers: {'User-Agent': USER_AGENT}, redirect: 'error'});
    if (!reply.ok) throw new Error(`${NE + name}: HTTP ${reply.status}`);
    landFeatures.push(...(await reply.json()).features);
  }
  const land = landRaster(landFeatures);
  // One HEAD request per region the plan looks at, one at a time.
  const sizeOf = async region => {
    const bytes = await headSize(urlOf(region));
    await new Promise(resolve => setTimeout(resolve, 200));
    return bytes;
  };
  const plan = {sourceDate: date, ...await planRegions(index, sizeOf, {land, urlOf})};
  await mkdir(out, {recursive: true});
  await writeFile(join(out, 'plan.json'), `${JSON.stringify(plan)}\n`);
  const report = planReport(plan, {Measured: new Date().toISOString(), 'Region index': INDEX, 'Source date': `${date} (dated Geofabrik files)`});
  await writeFile(join(out, 'plan.md'), report);
  process.stdout.write(report);
  if (!plan.valid) {
    for (const problem of plan.problems) console.log(`::error::Region plan: ${problem}`);
    process.exitCode = 1;
  }
}
