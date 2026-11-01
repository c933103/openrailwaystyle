// Worldwide level crossings (OSM railway=level_crossing and railway=crossing
// nodes), kept as a table and cut into static vector tiles, so the
// Infrastructure view can show them from zoom 5 without the provider's
// street-zoom tiles. Pure functions; scripts/build-crossings.mjs does the I/O.
import vtpbf from 'vt-pbf';
import '../styles/pbf-utf8.mjs'; // names beyond U+1FFFF intact
import {CROSSING_TAGS} from '../styles/crossing-tags.mjs';
import {parseAdiff} from './overpass-adiff.mjs';

export const TAG_KEYS = CROSSING_TAGS.map(([key]) => key);

// Overview tiles: every crossing as one multipoint per kind and tile, for map
// zooms 5–8 (a z5 tile at 8192 units places a point within about 150 m,
// under a pixel up to zoom 8). Detail tiles: one point per crossing with its
// OSM id, for zooms 9–14 (z9 at 8192 units: about 10 m).
export const OVERVIEW_ZOOM = 5, DETAIL_ZOOM = 9, EXTENT = 8192;
// Points this close to a tile edge are also written to the neighbour, so a
// dot is not cut off at the edge (in tile units: about 8 pixels).
const BUFFER = 128;
export const KINDS = {level_crossing: 'road', crossing: 'foot'};

// Start regions: 45° squares; a region that times out is split into quarters
// and the split is remembered (regions.json).
export function startRegions() {
  const regions = [];
  for (let s = -90; s < 90; s += 45) for (let w = -180; w < 180; w += 45) regions.push({box: [s, w, s + 45, w + 45]});
  return regions;
}
export const quarters = ([s, w, n, e]) => {
  const lat = (s + n) / 2, lon = (w + e) / 2;
  return [[s, w, lat, lon], [s, lon, lat, e], [lat, w, n, lon], [lat, lon, n, e]];
};
export const inBox = ([s, w, n, e], lat, lon) => lat >= s && lat < n && lon >= w && lon < e;

// Tracks whose crossings wait for street zooms: trams, light rail,
// funiculars, miniature railways, service tracks (sidings, yards, spurs) and
// street running, operating or planned/former (lifecycle mode tags as
// scripts/lifecycle.mjs reads them). A crossing is minor when every railway
// through it is one.
const MINOR_KINDS = '"^(tram|light_rail|funicular|miniature)$"';
const LIFECYCLE_KEYS = '"^(proposed|construction|disused|abandoned|razed|demolished|removed)(:railway)?$"';
const ACTIVE = '"^(rail|narrow_gauge|light_rail|subway|tram|monorail|funicular|miniature)$"';
export const MINOR_TRACKS = `(way.w[railway~${MINOR_KINDS}];way.w[railway!~${ACTIVE}][~${LIFECYCLE_KEYS}~${MINOR_KINDS}];way.w[service];way.w[embedded=yes];)`;
// From the crossing set .c: the major crossings, the "minor" marker row, the
// minor crossings (only on minor tracks), then the end marker row.
const CROSSING_ROWS = `->.c;way(bn.c)[railway]->.w;${MINOR_TRACKS}->.mw;(.w; - .mw;)->.jw;node.c(w.mw)->.m;node.c(w.jw)->.j;(.m; - .j;)->.minor;(.c; - .minor;)->.major;`
  + '.major out qt;make split railway="minor";out;.minor out qt;make complete railway="end";out;';
// A region in full, as CSV. Its changes come from crossingChangesQuery.
export function regionQuery(box) {
  // CSV output carries no error remarks: a final marker row, written only
  // when the query ran to the end, shows the response is complete. A marker
  // row (railway "minor") separates the major crossings from the minor ones.
  const columns = ['::id', '::lat', '::lon', 'railway', ...TAG_KEYS.map(key => `"${key}"`)].join(',');
  return `[out:csv(${columns};false;"${SEP}")][timeout:180];(node[railway=level_crossing](${box.join(',')});node[railway=crossing](${box.join(',')});)` +
    CROSSING_ROWS;
}

// Changes by augmented diff (scripts/overpass-adiff.mjs): the crossings of a
// region and the railway ways through them, as they changed since `since`.
// A crossing deleted or no longer tagged as one is reported deleted; every
// crossing created or changed, and every node of a way that changed or was
// deleted (before and after), may have a new row or minor flag and is read
// again with crossingRowsQuery. A way deleted through a crossing is seen
// this way too, so no periodic full download is needed to correct it.
export function crossingChangesQuery(box, since) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(since || '')) throw new Error('Invalid crossing change start');
  const bbox = `(${box.join(',')})`;
  return `[out:xml][timeout:180][maxsize:268435456][adiff:"${since}"];(node[railway=level_crossing]${bbox};node[railway=crossing]${bbox};)->.c;(.c;way(bn.c)[railway];);out meta;`;
}
export function crossingChanges(xml) {
  const {timestamp, actions} = parseAdiff(xml), deleted = new Set(), affected = new Set();
  for (const action of actions) {
    const element = action.new;
    if (element.type === 'node') (action.type === 'delete' ? deleted : affected).add(element.id);
    if (element.type === 'way') for (const state of [action.old, action.new]) for (const id of state?.nodes || []) affected.add(id);
  }
  for (const id of deleted) affected.delete(id);
  return {timestamp, deleted: [...deleted], affected: [...affected].sort((a, b) => a - b)};
}
// The rows of the given nodes that are crossings, as regionQuery gives them:
// the same columns, minor flag and markers.
export function crossingRowsQuery(ids) {
  if (!ids.length || !ids.every(id => Number.isSafeInteger(id) && id > 0)) throw new Error('Invalid crossing node ids');
  const columns = ['::id', '::lat', '::lon', 'railway', ...TAG_KEYS.map(key => `"${key}"`)].join(',');
  return `[out:csv(${columns};false;"${SEP}")][timeout:180];node(id:${ids.join(',')})[railway~"^(level_crossing|crossing)$"]` + CROSSING_ROWS;
}
// Overpass CSV rows: id, lat, lon, railway, then TAG_KEYS, no header: the
// major crossings, the "minor" marker row, the minor crossings, then the end
// marker row. Overpass does not escape values, and OSM tag values may hold
// tabs and line breaks, so columns are separated by the unit separator
// (U+001F), which editors treat as invalid in tags: a line that does not
// start a row continues the previous value, line break included. A row with
// extra columns (a separator inside a value) keeps its position and kind,
// with its tags marked unreadable (null) rather than shifted.
export const SEP = '\u001f';
const ROW_START = new RegExp(`^\\d+${SEP}[-\\d.]+${SEP}[-\\d.]+${SEP}`), MARKER = new RegExp(`^\\d*${SEP}${SEP}${SEP}(minor|end)(${SEP}|$)`);
export function parseCsv(text) {
  if (/^\s*</.test(text)) throw new Error(`Overpass returned an error page: ${text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}`);
  const lines = [];
  for (const line of text.split('\n')) {
    // Starting a row consumes its preceding record delimiter. Only continuation
    // lines restore an LF, including trailing LFs in the final tag value.
    if (ROW_START.test(line) || MARKER.test(line)) lines.push(line);
    else if (lines.length && !MARKER.test(lines.at(-1))) lines[lines.length - 1] += `\n${line}`;
    else if (line.trim()) throw new Error(`Unexpected Overpass row: ${line.slice(0, 120)}`);
  }
  if (lines.pop()?.split(SEP)[3]?.trim() !== 'end') throw new Error('Incomplete Overpass response (no end marker)');
  const rows = [];
  let minor = false;
  for (const line of lines) {
    const [id, lat, lon, railway, ...values] = line.split(SEP);
    if (railway?.trim() === 'minor' && !minor) { minor = true; continue; }
    const kind = KINDS[railway?.trim()], position = [Number(id), Number(lat), Number(lon)];
    if (!kind || !position.every(Number.isFinite)) throw new Error(`Unexpected Overpass row: ${line.slice(0, 120)}`);
    let tags = null;
    if (values.length <= TAG_KEYS.length) {
      tags = {};
      TAG_KEYS.forEach((key, i) => { const value = values[i]; if (value) tags[key] = value; });
    }
    rows.push({id: position[0], lat: position[1], lon: position[2], kind, minor, tags});
  }
  if (!minor) throw new Error('Incomplete Overpass response (no minor marker)');
  return rows;
}

// The table: id → [lat, lon, kind, minor, tags (null: unreadable)]. A full region response replaces every
// crossing inside the region (so deleted and retagged nodes go); a change
// response only adds or moves crossings.
export function replaceRegion(table, box, rows) {
  for (const [id, [lat, lon]] of table) if (inBox(box, lat, lon)) table.delete(id);
  for (const row of rows) if (inBox(box, row.lat, row.lon)) table.set(row.id, [row.lat, row.lon, row.kind, row.minor, row.tags === undefined ? {} : row.tags]);
}
// The changes of each top-level region, from that region's own time
// (`changes`, keyed by its box; `since` for one not yet recorded), oldest
// first. A region the server stayed unavailable for keeps its time and is
// asked again next run; every other region's changes still count. After two
// such regions in a row the server is taken to be down and the rest wait too.
export const UNAVAILABLE = /^Overpass stayed unavailable for region /;
export const regionKey = box => box.join(',');
export async function updateRegionChanges({regions, changes = {}, since, startedAt, fetch, warn = console.warn}) {
  const order = regions.map(region => ({region, since: changes[regionKey(region.box)] || since}))
    .sort((a, b) => a.since.localeCompare(b.since));
  const next = {}, deferred = [];
  let unavailable = 0;
  for (const {region, since: from} of order) {
    const key = regionKey(region.box);
    next[key] = from;
    if (unavailable >= 2) { deferred.push(key); continue; }
    try {
      await fetch(region, from);
      next[key] = startedAt;
      unavailable = 0;
    } catch (error) {
      if (!UNAVAILABLE.test(error.message)) throw error;
      warn(`Changes for ${key} deferred to the next run:`, error.message);
      deferred.push(key);
      unavailable++;
    }
  }
  if (deferred.length === order.length) throw new Error('Overpass stayed unavailable for every region; nothing to publish');
  return {changes: next, deferred, stopped: unavailable >= 2, from: order[0]?.since, since: Object.values(next).sort()[0]};
}
export function applyChanges(table, rows) {
  for (const row of rows) table.set(row.id, [row.lat, row.lon, row.kind, row.minor, row.tags === undefined ? {} : row.tags]);
}
export function writeTable(table) {
  const lines = [];
  // Tags as JSON, which escapes tabs and line breaks.
  for (const [id, [lat, lon, kind, minor, tags = {}]] of [...table].sort((a, b) => a[0] - b[0]))
    lines.push(`${id}\t${lat}\t${lon}\t${kind}\t${minor ? 'minor' : ''}${tags === null || Object.keys(tags).length ? `\t${JSON.stringify(tags)}` : ''}`);
  return lines.join('\n') + '\n';
}
export function readTable(text) {
  const table = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const [id, lat, lon, kind, minor, tags] = line.split('\t');
    table.set(Number(id), [Number(lat), Number(lon), kind, minor === 'minor', tags ? JSON.parse(tags) : {}]);
  }
  return table;
}

function tilePosition(lat, lon, z) {
  const n = 2 ** z, clamped = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  return [(lon + 180) / 360 * n, (1 - Math.asinh(Math.tan(clamped)) / Math.PI) / 2 * n];
}
// Interleave the bits of x and y (Morton order): neighbouring points follow
// each other, which keeps the delta-encoded multipoints small.
function morton(x, y) {
  let key = 0;
  for (let bit = 0; bit < 14; bit++) key += (((x >> bit) & 1) * 2 ** (2 * bit)) + (((y >> bit) & 1) * 2 ** (2 * bit + 1));
  return key;
}
// Returns Map 'z/x/y' → encoded tile bytes (layer level_crossings; property
// kind: road or foot; minor: true on minor tracks only; detail tiles also
// carry the node id and its TAG_KEYS tags, or tags_unreadable).
export function buildTiles(table, z, {detail = false} = {}) {
  const n = 2 ** z, tiles = new Map();
  const add = (x, y, point) => {
    // Columns wrap at the antimeridian; rows end at the poles.
    if (y < 0 || y >= n) return;
    const key = `${z}/${(x + n) % n}/${y}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key).push(point);
  };
  for (const [id, [lat, lon, kind, minor, tags]] of table) {
    const [fx, fy] = tilePosition(lat, lon, z), tx = Math.floor(fx), ty = Math.floor(fy);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = Math.round((fx - tx - dx) * EXTENT), y = Math.round((fy - ty - dy) * EXTENT);
      if (x >= -BUFFER && x <= EXTENT + BUFFER && y >= -BUFFER && y <= EXTENT + BUFFER) add(tx + dx, ty + dy, {id, kind, minor, tags, x, y});
    }
  }
  const out = new Map();
  for (const [key, points] of tiles) {
    let features;
    if (detail) {
      features = points.sort((a, b) => morton(a.x + BUFFER, a.y + BUFFER) - morton(b.x + BUFFER, b.y + BUFFER))
        .map(p => ({type: 1, id: p.id, geometry: [[p.x, p.y]], tags: {...(p.tags === null ? {tags_unreadable: true} : p.tags), kind: p.kind, ...(p.minor ? {minor: true} : {})}}));
    } else {
      features = [];
      for (const kind of ['road', 'foot']) for (const minor of [false, true]) {
        // Crossings on the same spot (both tracks of a line) draw one dot.
        const seen = new Map();
        for (const p of points) if (p.kind === kind && !!p.minor === minor) seen.set(`${p.x},${p.y}`, [p.x, p.y]);
        if (seen.size) features.push({type: 1, geometry: [...seen.values()].sort((a, b) => morton(a[0] + BUFFER, a[1] + BUFFER) - morton(b[0] + BUFFER, b[1] + BUFFER)), tags: minor ? {kind, minor: true} : {kind}});
      }
    }
    out.set(key, vtpbf.fromGeojsonVt({level_crossings: {features}}, {version: 2, extent: EXTENT}));
  }
  return out;
}
