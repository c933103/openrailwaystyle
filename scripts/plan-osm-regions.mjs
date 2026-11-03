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
// - Geofabrik lists some "special" children that combine siblings (for
//   example a region made of several countries). A child that is mostly
//   (AGGREGATE_SHARE) covered by its smaller siblings is such an aggregate
//   and is not used: the smaller siblings are.
// - A region over the limit without usable children is kept, marked
//   `oversized`, so the plan never drops land; the extract job reports it.
// - The remainder is the world minus the union of the planned regions: the
//   continents' gaps (B0) plus any split gap. It is never dropped: the
//   extract pipeline covers it from Overpass (B0b). Each split also reports
//   its own gap (the parent minus the children used), so a split that loses
//   land is visible.
import polygonClipping from 'polygon-clipping';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {CONTINENTS, normalize, areaKm2, extent} from './measure-osm-gaps.mjs';

export const MAX_REGION_BYTES = 8 * 1024 ** 3;
export const AGGREGATE_SHARE = 0.9;
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

// The children of a region worth downloading: aggregates of smaller
// siblings are left out.
export function usableChildren(regions, parentId) {
  const children = [...regions.values()].filter(region => region.parent === parentId && region.pbf)
    .sort((a, b) => a.areaKm2 - b.areaKm2 || a.id.localeCompare(b.id));
  const kept = [];
  for (const child of children) {
    const smaller = children.filter(other => other !== child && other.areaKm2 < child.areaKm2);
    const covered = smaller.length && child.areaKm2 > 0
      ? areaKm2(polygonClipping.intersection(child.polygon, polygonClipping.union(...smaller.map(s => s.polygon)))) / child.areaKm2 : 0;
    if (covered < AGGREGATE_SHARE) kept.push(child);
  }
  return kept;
}

// sizeOf(region) resolves to the PBF size in bytes.
// urlOf(region) is the file the plan records (default: the index's URL).
export async function planRegions(index, sizeOf, {maxBytes = MAX_REGION_BYTES, urlOf = region => region.pbf} = {}) {
  const regions = indexRegions(index);
  for (const id of CONTINENTS) if (!regions.has(id)) throw new Error(`Geofabrik index has no region ${id}`);
  const chosen = new Map(), splits = [];
  const visit = async (region, depth) => {
    const bytes = await sizeOf(region);
    if (!Number.isSafeInteger(bytes) || bytes <= 0) throw new Error(`No size for ${region.id}`);
    if (bytes <= maxBytes) { chosen.set(region.id, {region, bytes, oversized: false, depth}); return; }
    const children = usableChildren(regions, region.id);
    if (!children.length) { chosen.set(region.id, {region, bytes, oversized: true, depth}); return; }
    const gap = polygonClipping.difference(region.polygon, polygonClipping.union(...children.map(child => child.polygon)));
    splits.push({id: region.id, bytes, children: children.map(child => child.id), gapKm2: areaKm2(gap), gapExtent: gap.length ? extent(gap) : null});
    for (const child of children) if (!chosen.has(child.id)) await visit(child, depth + 1);
  };
  for (const id of CONTINENTS) await visit(regions.get(id), 0);
  const planned = [...chosen.values()].sort((a, b) => a.region.id.localeCompare(b.region.id));
  const covered = polygonClipping.union(...planned.map(entry => entry.region.polygon));
  const remainder = polygonClipping.difference(WORLD, covered);
  return {
    maxBytes, splits,
    regions: planned.map(({region, bytes, oversized, depth}) => ({id: region.id, parent: region.parent, url: urlOf(region), bytes, oversized, depth})),
    remainder: remainder.map(polygon => ({polygon, areaKm2: areaKm2([polygon]), extent: extent([polygon])})).sort((a, b) => b.areaKm2 - a.areaKm2),
    coveredKm2: areaKm2(covered), worldKm2: areaKm2([WORLD]),
  };
}

const GiB = 1024 ** 3, km2 = value => Math.round(value).toLocaleString('en');
export function planReport(plan, sources = {}) {
  const largest = plan.regions.reduce((max, r) => Math.max(max, r.bytes), 0);
  const total = plan.regions.reduce((sum, r) => sum + r.bytes, 0);
  const lines = [
    '# Extract region plan', '',
    ...Object.entries(sources).map(([name, value]) => `- ${name}: ${value}`),
    `- Limit per region: ${(plan.maxBytes / GiB).toFixed(1)} GiB`,
    `- Regions: ${plan.regions.length}; total ${(total / GiB).toFixed(2)} GiB; largest ${(largest / GiB).toFixed(2)} GiB; over the limit: ${plan.regions.filter(r => r.oversized).map(r => r.id).join(', ') || 'none'}`,
    `- Covered: ${km2(plan.coveredKm2)} km² of ${km2(plan.worldKm2)} km²; remainder (covered from Overpass): ${km2(plan.worldKm2 - plan.coveredKm2)} km² in ${plan.remainder.length} polygons`,
    '', '| Region | Parent | GiB |', '| --- | --- | ---: |',
    ...plan.regions.map(r => `| ${r.id}${r.oversized ? ' (over the limit)' : ''} | ${r.parent ?? '—'} | ${(r.bytes / GiB).toFixed(2)} |`),
    '', '## Splits', '', '| Region | GiB | Children used | Gap left by the split, km² | Gap extent |', '| --- | ---: | ---: | ---: | --- |',
    ...plan.splits.map(sp => `| ${sp.id} | ${(sp.bytes / GiB).toFixed(2)} | ${sp.children.length} | ${km2(sp.gapKm2)} | ${sp.gapExtent ? sp.gapExtent.join(', ') : '—'} |`),
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
  // One HEAD request per region the plan looks at, one at a time.
  const sizeOf = async region => {
    const bytes = await headSize(urlOf(region));
    await new Promise(resolve => setTimeout(resolve, 200));
    return bytes;
  };
  const plan = {sourceDate: date, ...await planRegions(index, sizeOf, {urlOf})};
  await mkdir(out, {recursive: true});
  await writeFile(join(out, 'plan.json'), `${JSON.stringify(plan)}\n`);
  const report = planReport(plan, {Measured: new Date().toISOString(), 'Region index': INDEX, 'Source date': `${date} (dated Geofabrik files)`});
  await writeFile(join(out, 'plan.md'), report);
  process.stdout.write(report);
}
