// The parts of the world no planned Geofabrik region covers (the plan's
// remainder, scripts/plan-osm-regions.mjs), cut into tiles that one Overpass
// request each can ask for (#330, B0b). A tile is a box of the shared region
// tree (scripts/world-regions.mjs) and the remainder's outer rings inside it.
// Holes (islands a region covers) are not cut out: asking for them again only
// brings objects the assembly already has, kept once.
//   node scripts/gap-tiles.mjs <plan.json> <gaps.json>
import {readFile, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import polygonClipping from 'polygon-clipping';
import {areaKm2} from './measure-osm-gaps.mjs';
import {quarters, worldRegions} from './world-regions.mjs';

// A tile with more vertices than this is cut into its quarters, so a `poly:`
// filter stays short; no polygon is ever simplified, so no area is lost.
export const MAX_VERTICES = 200;
export const MAX_DEPTH = 6;
export const START_SIZE = 45;

const boxPolygon = ([s, w, n, e]) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const vertices = multi => multi.reduce((sum, [outer]) => sum + outer.length - 1, 0);
// The outer rings only: holes are asked for too (see above).
const outerOnly = multi => multi.map(([outer]) => [outer]);

export function gapTiles(remainder, {maxVertices = MAX_VERTICES, maxDepth = MAX_DEPTH, startSize = START_SIZE} = {}) {
  const gaps = (remainder || []).map(part => part.polygon);
  if (!gaps.length) return [];
  const tiles = [];
  const visit = (box, depth) => {
    const inside = polygonClipping.intersection(gaps, boxPolygon(box));
    if (!inside.length || areaKm2(inside) <= 0) return;
    const polygon = outerOnly(inside);
    if (vertices(polygon) > maxVertices && depth < maxDepth) { for (const part of quarters(box)) visit(part, depth + 1); return; }
    tiles.push({key: box.join('_'), box, polygon, areaKm2: areaKm2(inside)});
  };
  for (const box of worldRegions(startSize)) visit(box, 0);
  return tiles;
}

// Overpass `poly:` takes "lat lon lat lon …" around one ring, without the
// closing point.
export const polyFilter = ring => `poly:"${ring.slice(0, -1).map(([lon, lat]) => `${+lat.toFixed(7)} ${+lon.toFixed(7)}`).join(' ')}"`;

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [planFile, out] = process.argv.slice(2);
  if (!planFile || !out) throw new Error('Usage: gap-tiles.mjs <plan.json> <gaps.json>');
  const plan = JSON.parse(await readFile(planFile, 'utf8'));
  const tiles = gapTiles(plan.remainder);
  await writeFile(out, `${JSON.stringify({sourceDate: plan.sourceDate, tiles})}\n`);
  console.log(`${tiles.length} gap tiles, ${Math.round(tiles.reduce((sum, t) => sum + t.areaKm2, 0)).toLocaleString('en')} km²`);
}
