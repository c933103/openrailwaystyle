// Maintenance build only. Derives two things:
// - the Han-character label regions from Natural Earth 1:10m admin-0
//   countries and admin-1 regions (public domain, de facto boundaries);
// - the Chinese naming areas (mainland China, Taiwan, Hong Kong, Macau) from
//   timezone-boundary-builder's time-zone polygons, as packaged by the geo-tz
//   npm module (ODbL, derived from OpenStreetMap). These follow OSM land and
//   territorial-sea boundaries and include every outlying island, such as
//   Matsu, Kinmen and Pratas.
// Usage:
//   node scripts/build-han-region.mjs [admin-0.geojson admin-1.geojson geo-tz-data-dir]
import {readFile, writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import geobuf from 'geobuf';
import Pbf from 'pbf';
import polygonClipping from 'polygon-clipping';
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
// Chinese and Japanese labels may borrow Han names within CJKV.
const CJKV = ['CHN','TWN','HKG','MAC','JPN','KOR','PRK','VNM'];
// Chinese labels only: Singapore, Malaysia and the Russian Far East (the Far
// Eastern Federal District as constituted since 2018).
const CHINESE = ['SGP','MYS'];
const FAR_EAST = ['RU-AMU','RU-BU','RU-CHU','RU-KAM','RU-KHA','RU-MAG','RU-PRI','RU-SA','RU-SAK','RU-YEV','RU-ZAB'];
// Chinese name keys are read differently in mainland China, Taiwan, Hong
// Kong and Macau (see chineseVariantKeys in map-model.mjs).
const CHINESE_AREAS = {'Asia/Shanghai':'CN', 'Asia/Urumqi':'CN', 'Asia/Taipei':'TW', 'Asia/Hong_Kong':'HK', 'Asia/Macau':'MO'};
const GEO_TZ = 'https://registry.npmjs.org/geo-tz/-/geo-tz-8.1.9.tgz';
// Coasts are simplified to about 1 km. Land borders keep about 200 m: border
// towns such as Heihe and Blagoveshchensk face each other across one river.
// Area outlines keep about 1 km, 200 m along the Vietnam and North Korea
// borders, and 30 m around Hong Kong and Macau for crossings such as Lo Wu
// and Gongbei. Elsewhere only the Han-character region decides.
const COAST = 0.01, BORDER = 0.002, FINE = 0.0003; // degrees
const DETAIL = [[FINE,[113.3,21.9,114.6,22.7]], [BORDER,[102,21,108.5,23.6]], [BORDER,[124,39.5,131,43]]];
// Other countries' outlines are kept this far around each zone, so that sea
// within 12 nautical miles goes to the nearest land (see han-region.mjs).
const NEAR = 0.3; // degrees
const load = async (file, name) => JSON.parse(file ? await readFile(file,'utf8') : await (await fetch(NE+name)).text());
const countries = (await load(process.argv[2],'ne_10m_admin_0_countries.geojson')).features;
const regions = (await load(process.argv[3],'ne_10m_admin_1_states_provinces.geojson')).features;
const areas = [
  ...countries.filter(f => f.properties.ADM0_A3 !== 'RUS').map(f => ({id:f.properties.ADM0_A3, geometry:f.geometry})),
  ...regions.filter(f => f.properties.adm0_a3 === 'RUS').map(f => ({id:f.properties.iso_3166_2, geometry:f.geometry})),
];
for (const id of [...CJKV, ...CHINESE, ...FAR_EAST]) if (!areas.some(a => a.id === id)) throw new Error(`Missing ${id}`);
const rings = g => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat(1);
const key = ([x,y]) => `${x.toFixed(6)},${y.toFixed(6)}`;
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length-1] = 1;
  const stack = [[0, points.length-1]];
  while (stack.length) {
    const [a,b] = stack.pop(); const [ax,ay] = points[a], [bx,by] = points[b];
    const dx = bx-ax, dy = by-ay, len = Math.hypot(dx,dy);
    let max = 0, index = -1;
    for (let i = a+1; i < b; i++) {
      const [px,py] = points[i];
      const d = len ? Math.abs(dy*px - dx*py + bx*ay - by*ax)/len : Math.hypot(px-ax,py-ay);
      if (d > max) { max = d; index = i; }
    }
    if (max > tolerance) { keep[index] = 1; stack.push([a,index],[index,b]); }
  }
  return points.filter((_,i)=>keep[i]);
}
// Delta encoding in integer steps (1e-3 degrees unless stated) keeps the
// module compact.
const encode = (line, scale = 1000) => { let px = 0, py = 0; return line.flatMap(([x,y]) => { const X = Math.round(x*scale), Y = Math.round(y*scale), d = [X-px, Y-py]; px = X; py = Y; return d; }); };
const bbox = ring => ring.reduce(([w,s,e,n],[x,y]) => [Math.min(w,x),Math.min(s,y),Math.max(e,x),Math.max(n,y)], [Infinity,Infinity,-Infinity,-Infinity]);
function zone(members) {
  // Vertices shared with an area outside the zone are land borders. Only
  // coastal edges receive the tolerance buffer for reclaimed land and gaps.
  const foreign = new Set(), own = new Set();
  for (const a of areas) for (const ring of rings(a.geometry)) for (const p of ring) (members.includes(a.id) ? own : foreign).add(key(p));
  const polygons = [], boxes = [];
  let points = 0, borders = 0;
  for (const a of areas.filter(a => members.includes(a.id))) for (const ring of rings(a.geometry)) {
    // Split each ring into border and coast runs and simplify each run while
    // keeping its endpoints, so the classification survives simplification.
    const runs = [];
    for (let i = 0; i < ring.length-1; i++) {
      const border = foreign.has(key(ring[i])) && foreign.has(key(ring[i+1]));
      if (!runs.length || runs.at(-1).border !== border) runs.push({border, points:[ring[i]]});
      runs.at(-1).points.push(ring[i+1]);
    }
    const outline = [], spans = [];
    for (const run of runs) {
      const simplified = simplify(run.points, run.border ? BORDER : COAST);
      const start = Math.max(outline.length-1, 0);
      outline.push(...(outline.length ? simplified.slice(1) : simplified));
      if (run.border) { spans.push(start, outline.length-1); borders++; }
    }
    points += outline.length;
    boxes.push(bbox(ring));
    // [delta-encoded outline, [first, last point index of each border run]]
    polygons.push([encode(outline), spans]);
  }
  // Outlines of land outside the zone near it: a point on that land, or at sea
  // nearer to it, is never in the zone.
  const near = ([x,y]) => boxes.some(([w,s,e,n]) => {
    const pad = NEAR/Math.cos(Math.min(85, Math.abs(y))*Math.PI/180);
    return x >= w-pad && x <= e+pad && y >= s-NEAR && y <= n+NEAR;
  });
  const others = [];
  let otherPoints = 0;
  for (const a of areas.filter(a => !members.includes(a.id))) for (const ring of rings(a.geometry)) {
    let run = [];
    const flush = () => { if (run.length > 1) { const line = simplify(run, COAST); others.push(encode(line)); otherPoints += line.length; } run = []; };
    for (let i = 0; i < ring.length-1; i++) {
      // Edges shared with the zone are already its land borders.
      const keep = !(own.has(key(ring[i])) && own.has(key(ring[i+1]))) && (near(ring[i]) || near(ring[i+1]));
      if (!keep) { flush(); continue; }
      if (!run.length) run.push(ring[i]);
      run.push(ring[i+1]);
    }
    flush();
  }
  console.log(`${members.join(' ')}: ${polygons.length} polygons, ${points} points, ${borders} border runs; ${others.length} nearby outside lines, ${otherPoints} points`);
  return [polygons, others];
}

// geo-tz packs time-zone polygons as geobuf quadtree cells: a cell is either
// wholly in listed zones or holds polygons clipped to it.
function untar(bytes) {
  const files = new Map();
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const name = bytes.subarray(offset, offset+100).toString().replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(bytes.subarray(offset+124, offset+136).toString().replace(/\0.*$/s, '').trim() || '0', 8);
    files.set(name, bytes.subarray(offset+512, offset+512+size));
    offset += 512 + Math.ceil(size/512)*512;
  }
  return files;
}
async function timeZoneData(dir) {
  if (dir) return [JSON.parse(await readFile(`${dir}/timezones.geojson.index.json`,'utf8')), await readFile(`${dir}/timezones.geojson.geo.dat`)];
  const files = untar(gunzipSync(Buffer.from(await (await fetch(GEO_TZ)).arrayBuffer())));
  return [JSON.parse(files.get('package/data/timezones.geojson.index.json').toString()), files.get('package/data/timezones.geojson.geo.dat')];
}
// Simplify each run of a ring at the tolerance its location needs.
function detail(ring) {
  const tolerance = ([x,y]) => DETAIL.find(([,[w,s,e,n]]) => x >= w && x <= e && y >= s && y <= n)?.[0] ?? COAST;
  const runs = [];
  for (const p of ring) {
    if (!runs.length || runs.at(-1).tolerance !== tolerance(p)) runs.push({tolerance:tolerance(p), points:runs.length ? [runs.at(-1).points.at(-1)] : []});
    runs.at(-1).points.push(p);
  }
  return runs.flatMap((run, i) => simplify(run.points, run.tolerance).slice(i ? 1 : 0));
}
async function chineseAreas(dir) {
  const [index, data] = await timeZoneData(dir);
  const pieces = Object.fromEntries(Object.values(CHINESE_AREAS).map(code => [code, []]));
  const walk = (node, [w,s,e,n]) => {
    if (!node) return;
    if (node.pos >= 0 && node.len) {
      for (const f of geobuf.decode(new Pbf(data.subarray(node.pos, node.pos+node.len))).features) {
        const code = CHINESE_AREAS[f.properties.tzid], g = f.geometry;
        if (code) pieces[code].push(...(g.type === 'Polygon' ? [g.coordinates] : g.coordinates));
      }
    } else if (Array.isArray(node)) {
      for (const i of node) if (CHINESE_AREAS[index.timezones[i]]) pieces[CHINESE_AREAS[index.timezones[i]]].push([[[w,s],[e,s],[e,n],[w,n],[w,s]]]);
    } else {
      const x = (w+e)/2, y = (s+n)/2;
      walk(node.a, [x,y,e,n]); walk(node.b, [w,y,x,n]); walk(node.c, [w,s,x,y]); walk(node.d, [x,s,e,y]);
    }
  };
  walk(index.lookup, [-179.9999,-89.9999,179.9999,89.9999]);
  const result = {};
  for (const [code, list] of Object.entries(pieces)) {
    if (!list.length) throw new Error(`No time-zone polygons for ${code}`);
    // Union the cells, then store every ring (outer and holes) for even-odd
    // tests; area outlines have no land-border runs.
    const rings = polygonClipping.union(...list.map(p => [p])).flat(1).map(detail).filter(ring => ring.length > 3);
    console.log(`${code}: ${rings.length} rings, ${rings.reduce((n, r) => n + r.length, 0)} points`);
    result[code] = rings.map(ring => [encode(ring, 10000), []]);
  }
  return result;
}
const [cjkv, chinese] = [zone(CJKV), zone([...CHINESE, ...FAR_EAST])];
const chineseAreaOutlines = await chineseAreas(process.argv[4]);
await writeFile(new URL('../styles/han-region-data.mjs', import.meta.url),
  `// Generated by scripts/build-han-region.mjs.\n` +
  `// CJKV and CHINESE: Natural Earth 1:10m admin-0 and admin-1 (public domain),\n` +
  `// delta-encoded 1e-3 degrees: [[outline, border runs]...], [nearby outside lines...].\n` +
  `// ${CJKV.join(', ')}\nexport const CJKV = ${JSON.stringify(cjkv)};\n` +
  `// ${[...CHINESE, ...FAR_EAST].join(', ')}\nexport const CHINESE = ${JSON.stringify(chinese)};\n` +
  `// AREAS: timezone-boundary-builder via geo-tz 8.1.9, © OpenStreetMap contributors,\n` +
  `// ODbL 1.0 (https://opendatacommons.org/licenses/odbl/). Delta-encoded 1e-4 degrees.\n` +
  `// ${Object.entries(CHINESE_AREAS).map(([zone, code]) => `${code} = ${zone}`).join(', ')}\n` +
  `export const AREAS = ${JSON.stringify(chineseAreaOutlines)};\n`);
