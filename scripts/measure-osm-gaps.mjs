// Where the Geofabrik continent extracts leave the world uncovered (#330, B0).
// Read-only measurement, run by `.github/workflows/osm-gaps.yml`:
//   node scripts/measure-osm-gaps.mjs <output directory>
// It reads Geofabrik's region index (`index-v1.json`, with each region's
// boundary polygon) and Natural Earth 1:10m land and minor islands (public
// domain), and writes:
//   gaps.geojson    the world minus the union of the continent polygons;
//   land.geojson    the land inside those gaps, one feature per piece;
//   report.md       areas, extents, the largest land pieces, and the overlaps
//                   between continents (which the extract assembly must
//                   deduplicate).
// Nothing is downloaded from OpenStreetMap and no file is kept beyond the
// run's artifact.
import polygonClipping from 'polygon-clipping';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

// The continent roots `mainline-reference.yml` downloads
// (scripts/acquire-mainline-extract.py REGIONS).
export const CONTINENTS = ['africa', 'antarctica', 'asia', 'australia-oceania', 'central-america',
  'europe', 'north-america', 'south-america'];
const WORLD = [[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]];
const EARTH_RADIUS_KM = 6371.0088;

const asMulti = geometry => {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  throw new Error(`Expected a polygon, got ${geometry?.type}`);
};

// A polygon given past ±180° longitude (a region drawn across the
// antimeridian) is folded back into the world box, so it covers what it covers.
export function normalize(multi) {
  const pieces = [];
  for (const shift of [-360, 0, 360]) {
    const moved = multi.map(polygon => polygon.map(ring => ring.map(([x, y]) => [x + shift, y])));
    pieces.push(...polygonClipping.intersection(moved, WORLD));
  }
  return pieces.length ? polygonClipping.union(...pieces.map(p => [p])) : [];
}

export function continentPolygons(index, ids = CONTINENTS) {
  const byId = new Map((index.features || []).map(feature => [feature.properties?.id, feature]));
  return ids.map(id => {
    const feature = byId.get(id);
    if (!feature) throw new Error(`Geofabrik index has no region ${id}`);
    return {id, polygon: normalize(asMulti(feature.geometry))};
  });
}

// Area on a sphere, in km² (the spherical-excess sum used by turf's area).
const rad = degrees => degrees * Math.PI / 180;
function ringArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    sum += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs(sum * EARTH_RADIUS_KM * EARTH_RADIUS_KM / 2);
}
export const areaKm2 = multi => multi.reduce((total, [outer, ...holes]) =>
  total + ringArea(outer) - holes.reduce((h, ring) => h + ringArea(ring), 0), 0);

// Exact bounds, for choosing cells; extent() rounds them for the report.
function bounds(multi) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const polygon of multi) for (const [x, y] of polygon[0]) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  }
  return [w, s, e, n];
}
export const extent = multi => bounds(multi).map(v => Math.round(v * 1000) / 1000);

// The whole measurement on parsed inputs, so tests use fixtures.
export function measureGaps(index, landFeatures = []) {
  const continents = continentPolygons(index);
  const covered = polygonClipping.union(...continents.map(c => c.polygon));
  const gaps = polygonClipping.difference(WORLD, covered);
  const overlaps = [];
  for (let i = 0; i < continents.length; i++) for (let j = i + 1; j < continents.length; j++) {
    const shared = polygonClipping.intersection(continents[i].polygon, continents[j].polygon);
    if (shared.length) overlaps.push({a: continents[i].id, b: continents[j].id, areaKm2: areaKm2(shared), extent: extent(shared)});
  }
  // Natural Earth land has hundreds of thousands of vertices, so the covered
  // area is cut into 10° cells once, and each land polygon is clipped only
  // against the cells it touches. A cell the continents cover entirely needs
  // no clipping. The pieces are joined again at the end, so an island that
  // crosses a cell edge is one piece.
  const cells = new Map();
  const cell = (cx, cy) => {
    const key = `${cx},${cy}`;
    if (!cells.has(key)) {
      const square = [[[cx, cy], [cx + 10, cy], [cx + 10, cy + 10], [cx, cy + 10], [cx, cy]]];
      const inside = polygonClipping.intersection(covered, square);
      // Full only if nothing of the cell is left uncovered, however small.
      cells.set(key, {square, inside, full: polygonClipping.difference(square, inside).length === 0});
    }
    return cells.get(key);
  };
  const outside = [];
  for (const feature of landFeatures) {
    if (!feature?.geometry) continue;
    for (const polygon of asMulti(feature.geometry)) {
      const [w, s, e, n] = bounds([polygon]);
      for (let cx = Math.floor(w / 10) * 10; cx < e; cx += 10) for (let cy = Math.floor(s / 10) * 10; cy < n; cy += 10) {
        const {square, inside, full} = cell(cx, cy);
        if (full) continue;
        const part = polygonClipping.intersection([polygon], square);
        if (part.length) outside.push(...polygonClipping.difference(part, inside));
      }
    }
  }
  const land = (outside.length ? polygonClipping.union(...outside.map(p => [p])) : [])
    .map(piece => ({polygon: piece, areaKm2: areaKm2([piece]), extent: extent([piece])}))
    .sort((a, b) => b.areaKm2 - a.areaKm2);
  overlaps.sort((a, b) => b.areaKm2 - a.areaKm2);
  return {
    worldKm2: areaKm2([WORLD]),
    coveredKm2: areaKm2(covered),
    gaps: gaps.map(polygon => ({polygon, areaKm2: areaKm2([polygon]), extent: extent([polygon])})).sort((a, b) => b.areaKm2 - a.areaKm2),
    land, overlaps,
  };
}

const km2 = value => Math.round(value).toLocaleString('en');
export function gapReport(result, sources = {}) {
  const landTotal = result.land.reduce((sum, piece) => sum + piece.areaKm2, 0);
  const lines = [
    '# Geofabrik continent coverage gaps',
    '',
    ...Object.entries(sources).map(([name, value]) => `- ${name}: ${value}`),
    `- Continents: ${CONTINENTS.join(', ')}`,
    `- World: ${km2(result.worldKm2)} km²; covered by the continents: ${km2(result.coveredKm2)} km²; uncovered: ${km2(result.worldKm2 - result.coveredKm2)} km²`,
    `- Gap polygons: ${result.gaps.length}; Natural Earth land in the gaps: ${result.land.length} pieces, ${km2(landTotal)} km²`,
    '',
    '## Gap polygons (largest 40)',
    '',
    '| # | km² | Extent (W, S, E, N) |',
    '| ---: | ---: | --- |',
    ...result.gaps.slice(0, 40).map((gap, i) => `| ${i + 1} | ${km2(gap.areaKm2)} | ${gap.extent.join(', ')} |`),
    '',
    '## Land in the gaps (largest 60)',
    '',
    '| # | km² | Extent (W, S, E, N) |',
    '| ---: | ---: | --- |',
    ...result.land.slice(0, 60).map((piece, i) => `| ${i + 1} | ${km2(piece.areaKm2)} | ${piece.extent.join(', ')} |`),
    '',
    '## Overlaps between continents',
    '',
    '| Continents | km² | Extent (W, S, E, N) |',
    '| --- | ---: | --- |',
    ...result.overlaps.map(o => `| ${o.a} / ${o.b} | ${km2(o.areaKm2)} | ${o.extent.join(', ')} |`),
  ];
  return `${lines.join('\n')}\n`;
}

const collection = items => JSON.stringify({type: 'FeatureCollection', features: items.map(({polygon, ...properties}) =>
  ({type: 'Feature', properties, geometry: {type: 'Polygon', coordinates: polygon}}))});

const USER_AGENT = 'RailwayAtlas-coverage/1 (+https://github.com/c933103/openrailwaystyle/issues/330)';
async function getJson(url) {
  const response = await fetch(url, {headers: {'User-Agent': USER_AGENT}, redirect: 'error'});
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const out = process.argv[2];
  if (!out) throw new Error('Usage: measure-osm-gaps.mjs <output directory>');
  const INDEX = 'https://download.geofabrik.de/index-v1.json';
  const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
  const index = await getJson(INDEX);
  const land = [];
  for (const name of ['ne_10m_land.geojson', 'ne_10m_minor_islands.geojson']) land.push(...(await getJson(NE + name)).features);
  const result = measureGaps(index, land);
  const report = gapReport(result, {
    'Measured': new Date().toISOString(),
    'Region index': INDEX,
    'Land': `${NE}{ne_10m_land,ne_10m_minor_islands}.geojson (Natural Earth, public domain)`,
  });
  await mkdir(out, {recursive: true});
  await writeFile(join(out, 'report.md'), report);
  await writeFile(join(out, 'gaps.geojson'), collection(result.gaps));
  await writeFile(join(out, 'land.geojson'), collection(result.land));
  process.stdout.write(report);
}
