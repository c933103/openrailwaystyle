// Maintenance-only Carto detail. Viewer requests static tiles, never Overpass.
import polygonClipping from 'polygon-clipping';
import {CAP_RADIUS, encodeLine, toPolar} from '../styles/polar.mjs';
import {clipToDisc, clipToRect, simplify} from './polar-contours.mjs';

export const DETAIL_SIDE = 4;
export const DETAIL_QUANTUM = 0.001; // 1 m: preserve small polar-station buildings.
export function detailQuery(cap, west, east) {
  const bbox = cap === 'north' ? `85,${west},90,${east}` : `-90,${west},-85,${east}`;
  return `[out:json][timeout:240];(way[highway](${bbox});way[waterway](${bbox});way[building](${bbox});rel[building][type=multipolygon](${bbox});way[aeroway~"^(taxiway|apron)$"](${bbox});nwr[amenity][name](${bbox});nwr[man_made=research_station](${bbox});node[natural=peak][name](${bbox}););out geom;`;
}
export function parseOverpass(text) {
  const data = JSON.parse(text);
  // Overpass can return HTTP 200 and partial elements with a timeout remark.
  if (data.remark || !Array.isArray(data.elements)) throw new Error(`Incomplete polar OSM response: ${data.remark || 'no elements array'}`);
  return data;
}
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const disc = [[Array.from({length: 721}, (_, k) => [CAP_RADIUS * Math.cos(k / 720 * 2 * Math.PI), CAP_RADIUS * Math.sin(k / 720 * 2 * Math.PI)])]];
export function closedRings(members) {
  const lines = members.filter(m => Array.isArray(m.geometry)).map(m => m.geometry.map(p => [p.lon, p.lat])).filter(l => l.length >= 2);
  const out = [];
  while (lines.length) {
    let ring = lines.shift();
    while (!same(ring[0], ring.at(-1))) {
      const k = lines.findIndex(l => same(l[0], ring.at(-1)) || same(l.at(-1), ring.at(-1)));
      if (k < 0) break;
      const [line] = lines.splice(k, 1);
      ring.push(...(same(line[0], ring.at(-1)) ? line : line.reverse()).slice(1));
    }
    if (ring.length >= 4 && same(ring[0], ring.at(-1))) out.push(ring);
  }
  return out;
}
export function featureArea(cap, e) {
  const project = ring => ring.map(p => toPolar(cap, p));
  const outer = e.type === 'way' ? closedRings([e]) : closedRings((e.members || []).filter(m => m.role !== 'inner'));
  const inner = e.type === 'way' ? [] : closedRings((e.members || []).filter(m => m.role === 'inner'));
  if (!outer.length) return [];
  let shape = polygonClipping.union(...outer.map(r => [[project(r)]]));
  if (inner.length) shape = polygonClipping.difference(shape, ...inner.map(r => [[project(r)]]));
  return polygonClipping.intersection(shape, disc);
}
export function detailTiles(cap, elements) {
  const tiles = new Map(), size = 2 * CAP_RADIUS / DETAIL_SIDE;
  const tile = (tx, ty) => {
    const key = `${tx}-${ty}`;
    if (!tiles.has(key)) tiles.set(key, {quantum: DETAIL_QUANTUM, buildings: [], aprons: [], roads: [], paths: [], waterways: [], taxiways: [], places: []});
    return tiles.get(key);
  };
  // Nodes/ways/relations may occur in neighbouring longitude queries.
  const unique = new Map(elements.map(e => [`${e.type}/${e.id}`, e]));
  for (const e of unique.values()) {
    const t = e.tags || {}, project = p => toPolar(cap, [p.lon, p.lat]);
    const polygonKind = t.building && t.building !== 'no' ? 'buildings' : t.aeroway === 'apron' ? 'aprons' : null;
    if (polygonKind) {
      const shape = featureArea(cap, e);
      if (shape.length) for (let ty = 0; ty < DETAIL_SIDE; ty++) for (let tx = 0; tx < DETAIL_SIDE; tx++) {
        const x = -CAP_RADIUS + tx * size, y = -CAP_RADIUS + ty * size;
        const piece = polygonClipping.intersection(shape, [[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]]);
        if (piece.length) tile(tx, ty)[polygonKind].push(...piece.map(rings => rings.map(r => encodeLine(r, DETAIL_QUANTUM))));
      }
    }
    const lineKind = t.highway ? /^(footway|path|cycleway|steps|bridleway)$/.test(t.highway) ? 'paths' : 'roads'
      : t.waterway ? 'waterways' : t.aeroway === 'taxiway' ? 'taxiways' : null;
    if (lineKind && e.type === 'way' && e.geometry?.length >= 2) {
      const lines = clipToDisc([e.geometry.map(project)], CAP_RADIUS).map(l => simplify(l, DETAIL_QUANTUM));
      for (let ty = 0; ty < DETAIL_SIDE; ty++) for (let tx = 0; tx < DETAIL_SIDE; tx++) {
        const x = -CAP_RADIUS + tx * size, y = -CAP_RADIUS + ty * size;
        const pieces = clipToRect(lines, [x, y, x + size, y + size]);
        if (pieces.length) tile(tx, ty)[lineKind].push(...pieces.map(l => encodeLine(l, DETAIL_QUANTUM)));
      }
    }
    if (t.name && (t.amenity || t.man_made === 'research_station' || t.natural === 'peak')) {
      // Use a mapped node or the mean of the mapped geometry for facility labels.
      const geometry = e.type === 'node' ? [e] : e.geometry || (e.members || []).flatMap(m => m.geometry || []);
      if (!geometry.length) continue;
      const points = geometry.map(project), [x, y] = points.reduce(([x,y], p) => [x+p[0]/points.length, y+p[1]/points.length], [0,0]);
      if (Math.hypot(x, y) > CAP_RADIUS) continue;
      const tx = Math.min(DETAIL_SIDE - 1, Math.floor((x + CAP_RADIUS) / size)), ty = Math.min(DETAIL_SIDE - 1, Math.floor((y + CAP_RADIUS) / size));
      const names = Object.fromEntries(Object.entries(t).filter(([k]) => k === 'name' || k.startsWith('name:')));
      tile(tx, ty).places.push({id: `${e.type}/${e.id}`, x, y, place: t.natural === 'peak' ? 'peak' : 'facility', ...names});
    }
  }
  return tiles;
}
