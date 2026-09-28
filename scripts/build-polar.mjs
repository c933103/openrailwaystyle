// Maintenance build only: map data for the polar caps beyond 85.05°, which
// Web Mercator tiles do not reach (styles/polar.mjs). Writes snapshot/polar/:
//   {cap}-{units}-{band}-{tx}-{ty}.json  contour tiles (ETOPO 2022, NOAA, public domain)
//   {cap}-index.json           which contour tiles exist
//   {cap}-features.json        OpenStreetMap water, runways and place names
//   {cap}-relief.png           slopes for the relief shading (ETOPO 2022)
// Elevation is fetched once and kept in .snapshot-cache; OpenStreetMap
// data is re-fetched when older than POLAR_OSM_MAX_AGE_DAYS (default 28).
import {readFile, writeFile, mkdir, stat, rm} from 'node:fs/promises';
import {crc32, deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import polygonClipping from 'polygon-clipping';
import {CAP_RADIUS, POLAR_BANDS, FEET, toPolar, encodeLine, fromPolar} from '../styles/polar.mjs';
import {isolineSegments, joinSegments, clipToDisc, clipToRect, simplify, levels} from './polar-contours.mjs';
const CAPS = ['north', 'south'];
const USER_AGENT = 'OpenRailwayAtlas-snapshot/1.0 (+https://github.com/c933103/openrailwaystyle)';
const ETOPO = 'https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const LON_STRIDE = 10; // every 10th arc-minute of longitude (≤ 1.6 km at 85°)
const STEP = 1.5;      // km between polar grid points
const TOLERANCE = [1.2, 0.6, 0.25]; // km, per zoom band
// Detail stops at the band for equatorial zoom 8 and below: the caps are
// ice and sea, 550 km across, and finer contours there would add megabytes
// for little. The map keeps drawing this band when zoomed further in.
const BANDS = 1;
// Contour tiles per side, per zoom band: the cap square is split so the
// finer bands load only where viewed.
export const TILES_PER_SIDE = [1, 2, 4];
await mkdir('.snapshot-cache', {recursive: true});
// Start afresh, so no tiles of bands no longer prepared are published.
await rm('snapshot/polar', {recursive: true, force: true});
await mkdir('snapshot/polar', {recursive: true});

async function fetchText(url, options = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {...options, headers: {'User-Agent': USER_AGENT, ...options.headers}, signal: AbortSignal.timeout(300000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt >= 3) throw error;
      console.warn(url.slice(0, 80), error.message, '- retrying');
      await new Promise(r => setTimeout(r, 30000 * (attempt + 1)));
    }
  }
}
async function cached(file, maxAgeDays, load) {
  try {
    const info = await stat(file);
    if (Date.now() - info.mtimeMs < maxAgeDays * 86400000) return await readFile(file, 'utf8');
  } catch {}
  try { const text = await load(); await writeFile(file, text); return text; }
  catch (error) {
    try { console.warn('Using the previous copy:', error.message); return await readFile(file, 'utf8'); }
    catch { throw error; }
  }
}

// Elevation: the 300 rows (5°) of ETOPO 2022 nearest each pole, from its
// 1-arc-minute grid (rows run south to north).
async function elevation(cap) {
  const rows = cap === 'south' ? '0:1:299' : '10500:1:10799';
  const text = await cached(`.snapshot-cache/polar-dem-${cap}.txt`, 36500, () =>
    fetchText(`${ETOPO}.ascii?z%5B${rows}%5D%5B0:${LON_STRIDE}:21599%5D`));
  const data = text.slice(text.indexOf('z.z['));
  const values = [];
  for (const line of data.split('\n').slice(1)) {
    if (!line.startsWith('[')) continue;
    values.push(Float32Array.from(line.slice(line.indexOf(',') + 1).split(',').map(Number)));
    if (values.length === 300) break;
  }
  if (values.length !== 300) throw new Error(`Elevation for the ${cap} cap is incomplete`);
  const firstLat = cap === 'south' ? -90 + 1 / 120 : 85 + 1 / 120, lonStep = LON_STRIDE / 60, firstLon = -180 + 1 / 120;
  const cols = values[0].length;
  // Bilinear, wrapping in longitude and holding the edge rows.
  return (lng, lat) => {
    const fi = Math.max(0, Math.min(299, (lat - firstLat) * 60)), i0 = Math.min(298, Math.floor(fi)), ti = fi - i0;
    let fj = ((lng - firstLon) / lonStep) % cols; if (fj < 0) fj += cols;
    const j0 = Math.floor(fj), j1 = (j0 + 1) % cols, tj = fj - j0;
    const row = (r) => values[r][j0] * (1 - tj) + values[r][j1] * tj;
    return row(i0) * (1 - ti) + row(i0 + 1) * ti;
  };
}
function polarGrid(cap, sample) {
  const extent = CAP_RADIUS + 3 * STEP, cols = Math.ceil(2 * extent / STEP) + 1, x0 = -extent, y0 = -extent;
  const values = new Float32Array(cols * cols);
  for (let j = 0; j < cols; j++) for (let i = 0; i < cols; i++) {
    const x = x0 + i * STEP, y = y0 + j * STEP;
    values[j * cols + i] = Math.hypot(x, y) > extent ? NaN : sample(...fromPolar(cap, [x, y]));
  }
  return {values, cols, rows: cols, x0, y0, step: STEP};
}
function contours(grid, units) {
  const scale = units === 'imperial' ? FEET : 1;
  const scaled = {...grid, values: grid.values.map(v => v * scale)};
  let min = Infinity, max = -Infinity;
  for (const v of scaled.values) if (!Number.isNaN(v)) { min = Math.min(min, v); max = Math.max(max, v); }
  return POLAR_BANDS[units].slice(0, BANDS).map((band, index) => {
    const wanted = [
      ...levels(Math.max(min, 0), max, band.land[0]).map(level => [level, band.land[1]]),
      ...levels(min, Math.min(max, 0), band.seabed[0]).filter(level => !band.shelfOnly || level > -200).map(level => [level, band.seabed[1]]),
    ];
    const n = TILES_PER_SIDE[index], size = 2 * CAP_RADIUS / n, tiles = new Map();
    for (const [level, major] of wanted) {
      const joined = clipToDisc(joinSegments(isolineSegments(scaled, level)), CAP_RADIUS).map(line => simplify(line, TOLERANCE[index]));
      for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) {
        const x0 = -CAP_RADIUS + tx * size, y0 = -CAP_RADIUS + ty * size;
        for (const piece of clipToRect(joined, [x0, y0, x0 + size, y0 + size])) {
          const key = `${tx}-${ty}`;
          if (!tiles.has(key)) tiles.set(key, []);
          tiles.get(key).push([level, level % major === 0 ? 1 : 0, ...encodeLine(piece)]);
        }
      }
    }
    return {band: index, from: band.from, n, tiles};
  });
}

// Relief: the slope of the ground (metres per metre) along the polar x and y
// axes, as an RGB PNG over the square around the cap: red for x, green for
// y, each 128 ± 127·√|slope| (slopes beyond 1 held at 1), which keeps gentle
// slopes precise and filters smoothly. Blue is unused.
function png(width, height, rgb) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length), body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc(height * (1 + 3 * width));
  for (let y = 0; y < height; y++) rgb.subarray(y * 3 * width, (y + 1) * 3 * width).forEach((v, i) => { raw[y * (1 + 3 * width) + 1 + i] = v; });
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}
function relief(grid) {
  const {cols, values} = grid, rgb = new Uint8Array(cols * cols * 3).fill(128);
  const at = (i, j) => { const v = values[Math.max(0, Math.min(cols - 1, j)) * cols + Math.max(0, Math.min(cols - 1, i))]; return Number.isNaN(v) ? null : v; };
  const encode = slope => Math.round(128 + 127 * Math.sign(slope) * Math.sqrt(Math.min(1, Math.abs(slope))));
  for (let j = 0; j < cols; j++) for (let i = 0; i < cols; i++) {
    const l = at(i - 1, j), r = at(i + 1, j), d = at(i, j - 1), u = at(i, j + 1), k = 3 * (j * cols + i);
    if (l === null || r === null || d === null || u === null) continue;
    rgb[k] = encode((r - l) / (2000 * STEP)); rgb[k + 1] = encode((u - d) / (2000 * STEP)); rgb[k + 2] = 0;
  }
  return png(cols, cols, rgb);
}

// OpenStreetMap: what the basemap draws elsewhere — water areas, ice
// shelves, runways and place names — clipped to the cap.
const disc = (() => { const ring = []; for (let k = 0; k <= 720; k++) { const a = k / 720 * 2 * Math.PI; ring.push([CAP_RADIUS * Math.cos(a), CAP_RADIUS * Math.sin(a)]); } return [[ring]]; })();
function rings(members) {
  // Join member ways into closed rings.
  const lines = members.map(m => m.geometry.map(p => [p.lon, p.lat])).filter(l => l.length >= 2);
  const out = [];
  while (lines.length) {
    let ring = lines.shift();
    for (let grew = true; grew && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1]);) {
      grew = false;
      for (let k = 0; k < lines.length; k++) {
        const l = lines[k], end = ring.at(-1), same = (a, b) => a[0] === b[0] && a[1] === b[1];
        if (same(l[0], end)) ring = [...ring, ...l.slice(1)];
        else if (same(l.at(-1), end)) ring = [...ring, ...[...l].reverse().slice(1)];
        else continue;
        lines.splice(k, 1); grew = true; break;
      }
    }
    if (ring.length >= 4) out.push(ring);
  }
  return out;
}
async function features(cap) {
  const bbox = cap === 'north' ? '85,-180,90,180' : '-90,-180,-85,180';
  const query = `[out:json][timeout:240];(way[natural=water](${bbox});rel[natural=water][type=multipolygon](${bbox});way["glacier:type"=shelf](${bbox});rel["glacier:type"=shelf][type=multipolygon](${bbox});way[aeroway=runway](${bbox});node[place][name](${bbox}););out geom;`;
  const maxAge = Number(process.env.POLAR_OSM_MAX_AGE_DAYS || 28), version = createHash('sha1').update(query).digest('hex').slice(0, 8);
  const json = JSON.parse(await cached(`.snapshot-cache/polar-osm-${cap}-${version}.json`, maxAge, () => fetchText(OVERPASS, {method: 'POST', body: new URLSearchParams({data: query})})));
  const project = ring => ring.map(([lon, lat]) => toPolar(cap, [lon, lat]));
  // An area as polygons in the polar plane, within the cap: its outer rings
  // less its inner ones.
  const area = e => {
    const outer = e.type === 'way' ? [e.geometry.map(p => [p.lon, p.lat])] : rings((e.members || []).filter(m => m.role !== 'inner' && m.geometry));
    const inner = e.type === 'way' ? [] : rings((e.members || []).filter(m => m.role === 'inner' && m.geometry));
    if (!outer.length) return [];
    let shape = polygonClipping.union(...outer.map(r => [[project(r)]]));
    if (inner.length) shape = polygonClipping.difference(shape, ...inner.map(r => [[project(r)]]));
    return polygonClipping.intersection(shape, disc).map(piece => piece.map(r => encodeLine(simplify(r, 0.02))));
  };
  const water = [], iceShelves = [], runways = [], places = [];
  for (const e of json.elements || []) {
    const t = e.tags || {};
    if (e.type === 'node') {
      const [x, y] = toPolar(cap, [e.lon, e.lat]);
      if (Math.hypot(x, y) > CAP_RADIUS) continue;
      const names = Object.fromEntries(Object.entries(t).filter(([k]) => k === 'name' || k.startsWith('name:')));
      places.push({x: +x.toFixed(2), y: +y.toFixed(2), place: t.place, ...names});
    } else if (t.natural === 'water') {
      water.push(...area(e));
    } else if (t['glacier:type'] === 'shelf') {
      iceShelves.push(...area(e));
    } else if (t.aeroway === 'runway' && e.geometry) {
      for (const line of clipToDisc([project(e.geometry.map(p => [p.lon, p.lat]))], CAP_RADIUS)) runways.push(encodeLine(line));
    }
  }
  return {cap, water, iceShelves, runways, places};
}

for (const cap of CAPS) {
  const grid = polarGrid(cap, await elevation(cap)), index = {cap, radius: CAP_RADIUS, units: {}};
  for (const units of ['metric', 'imperial']) {
    index.units[units] = [];
    for (const band of contours(grid, units)) {
      for (const [key, lines] of band.tiles) await writeFile(`snapshot/polar/${cap}-${units}-${band.band}-${key}.json`, JSON.stringify({lines}));
      index.units[units].push({from: band.from, n: band.n, tiles: [...band.tiles.keys()]});
      console.log(cap, units, 'band', band.band, band.tiles.size, 'tiles,', [...band.tiles.values()].reduce((s, l) => s + l.length, 0), 'lines');
    }
  }
  await writeFile(`snapshot/polar/${cap}-relief.png`, relief(grid));
  index.relief = {x0: grid.x0, step: grid.step, size: grid.cols};
  await writeFile(`snapshot/polar/${cap}-index.json`, JSON.stringify(index));
  try {
    const data = await features(cap);
    await writeFile(`snapshot/polar/${cap}-features.json`, JSON.stringify(data));
    console.log(cap, 'features:', data.water.length, 'water,', data.iceShelves.length, 'ice shelves,', data.runways.length, 'runways,', data.places.length, 'places');
  } catch (error) { console.warn(`OpenStreetMap data for the ${cap} cap unavailable:`, error.message); }
}
