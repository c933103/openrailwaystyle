// Urban rail services (metro, light rail, tram, monorail and commuter rail
// routes, never individual long-distance trains), from OpenStreetMap route
// relations, kept as a table and cut into static vector tiles that draw each
// route along the tracks it runs on, for the Service view. Fetched region by
// region in the stages of the branch lines (branch-lines.mjs).
// Pure functions; scripts/build-service-routes.mjs does the I/O.
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {simplify} from './branch-lines.mjs';

export const MIN_ZOOM = 7, LOCAL_MIN_ZOOM = 10, MAX_ZOOM = 12, LAYER = 'service_routes';
// Light rail, trams and monorails from zoom 10, as in the other views.
export const LOCAL_KINDS = ['light_rail', 'tram', 'monorail'];

const areaFilter = spec => { const [key, value] = spec.split('='); return `area["${key}"="${value}"]`; };
const SELECTS = ['rel[type=route][route~"^(subway|light_rail|tram|monorail)$"]', 'rel[type=route][route=train][service~"^(commuter|urban)$"]'];
const select = filters => SELECTS.map(s => `${s}${filters};`).join('');
// Routes with a member in the box (leaving out countries fetched in earlier
// stages), their tags and members, then the geometry of their track ways.
export function partQuery(part, box) {
  const bbox = `(${box.join(',')})`, specs = [part.area, ...(part.exclude || [])].filter(Boolean);
  const areas = specs.map((spec, i) => `${areaFilter(spec)}->.a${i};`).join('');
  const main = select(`${part.area ? '(area.a0)' : ''}${bbox}`);
  const excluded = (part.exclude || []).map((_, i) => select(`(area.a${i + (part.area ? 1 : 0)})${bbox}`)).join('');
  const set = excluded ? `((${main}); - (${excluded});)` : `(${main})`;
  return `[out:json][timeout:180][maxsize:536870912];${areas}${set}->.r;.r out body;way(r.r)[railway~"^(rail|light_rail|subway|tram|monorail|narrow_gauge|funicular)$"];out skel geom qt;`;
}

const colour = value => {
  const v = String(value || '').trim();
  if (/^#?[0-9a-f]{6}$/i.test(v)) return ('#' + v.replace('#', '')).toLowerCase();
  if (/^#?[0-9a-f]{3}$/i.test(v)) return ('#' + v.replace('#', '').replace(/./g, c => c + c)).toLowerCase();
  return /^[a-z]+$/i.test(v) ? v.toLowerCase() : '';
};
// A route's name without its direction ("(Southbound)", ": A → B").
export function routeLabel(name) {
  let label = String(name || '').trim();
  label = label.replace(/\s*[(（][^()（）]*(→|->|=>|⇒|bound|方向|行)[^()（）]*[)）]\s*$/i, '')
    .replace(/\s*[(（](上|下|上り|下り|上行|下行|内回り|外回り|inbound|outbound)[)）]/gi, '');
  const colon = label.search(/[:：]/);
  if (colon > 0 && /→|->|=>|⇒|↔|<->/.test(label.slice(colon))) label = label.slice(0, colon);
  label = label.replace(/\s*(→|->|=>|⇒).*$/, '');
  return label.trim();
}
const NAME_KEY = /^name:[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
// The same service in each direction (and in variants) is one route: the
// same kind, network, reference and colour (and name, without a reference
// or without a network).
export function routeOf(rel) {
  const t = rel.tags || {};
  const label = routeLabel(t.name) || t.ref || '', ref = t.ref || '';
  if (!label) return null;
  const names = Object.fromEntries(Object.entries(t).filter(([k]) => NAME_KEY.test(k)).map(([k, v]) => [k, routeLabel(v)]).filter(([, v]) => v));
  // Without a network or operator, a bare reference ("1") says nothing of
  // the city: the name tells such routes apart.
  const network = t.network || t.operator || '', kind = t.route === 'train' ? 'commuter' : t.route;
  return {key: [kind, network, ref, colour(t.colour), ref && network ? '' : label].join('|'), kind,
    ref, label, colour: colour(t.colour), network: t.network || '', operator: t.operator || '', relation: rel.id, names};
}

// From an Overpass response: the routes (by key) and the track ways with the
// routes running on them.
export function toTable(json) {
  if (json.remark || !Array.isArray(json.elements)) throw new Error(json.remark ? `Overpass: ${json.remark}` : 'Incomplete Overpass response');
  const routes = new Map(), wayRoutes = new Map(), ways = [];
  for (const el of json.elements) {
    if (el.type !== 'relation') continue;
    const route = routeOf(el);
    if (!route) continue;
    // The first relation of a route gives its link (the lowest id, so it is stable).
    const known = routes.get(route.key);
    if (!known || route.relation < known.relation) routes.set(route.key, route);
    for (const m of el.members || []) if (m.type === 'way' && !/platform|stop/.test(m.role || '')) {
      if (!wayRoutes.has(m.ref)) wayRoutes.set(m.ref, new Set());
      wayRoutes.get(m.ref).add(route.key);
    }
  }
  for (const el of json.elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || !wayRoutes.has(el.id)) continue;
    const parts = [[]];
    for (const p of el.geometry) {
      if (p && Number.isFinite(p.lon) && Number.isFinite(p.lat)) parts.at(-1).push([p.lon, p.lat]);
      else if (parts.at(-1).length) parts.push([]);
    }
    // Finer than the branch lines (about 5 m): the routes are drawn close up.
    const lines = parts.filter(part => part.length > 1).map(part => simplify(part, 0.00005).map(round));
    if (lines.length) ways.push({id: el.id, routes: [...wayRoutes.get(el.id)].sort(), lines});
  }
  return {routes: [...routes.values()], ways};
}
const round = ([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6];

// The table keeps, for each way and route, what each stage found: a way's
// routes by stage (each response lists only the routes selected in its box,
// so within a stage's pass they add up) and the stages that found a route.
// A stage's refresh replaces only its own part, so routes another stage
// found on a shared way stay. seen: the `w:<id>`/`r:<key>` met so far in the
// stage's current pass.
export function addResult(table, result, stage, seen) {
  for (const route of result.routes) {
    const previous = table.routes.get(route.key);
    table.routes.set(route.key, {...route, relation: Math.min(previous?.relation ?? Infinity, route.relation),
      stages: [...new Set([...(previous?.stages || []), stage])].sort()});
    seen.add(`r:${route.key}`);
  }
  for (const way of result.ways) {
    const previous = table.ways.get(way.id), byStage = {...(previous?.routes || {})};
    byStage[stage] = [...new Set([...(seen.has(`w:${way.id}`) ? byStage[stage] || [] : []), ...way.routes])].sort();
    table.ways.set(way.id, {id: way.id, lines: way.lines, routes: byStage});
    seen.add(`w:${way.id}`);
  }
}
// What a complete pass of the stage no longer found: its routes and its
// part of each way. Returns [kind, key] pairs.
export const staleItems = (table, stage, seen) => [
  ...[...table.routes.values()].filter(r => r.stages.includes(stage) && !seen.has(`r:${r.key}`)).map(r => ['r', r.key]),
  ...[...table.ways.values()].filter(w => w.routes[stage] && !seen.has(`w:${w.id}`)).map(w => ['w', w.id]),
];
export const stageItems = (table, stage) => [...table.routes.values()].filter(r => r.stages.includes(stage)).length + [...table.ways.values()].filter(w => w.routes[stage]).length;
// Drops the stage's part of those items; an item no stage holds goes.
export function removeStale(table, stage, items) {
  for (const [kind, key] of items) {
    const map = kind === 'r' ? table.routes : table.ways, item = map.get(key);
    if (kind === 'r') item.stages = item.stages.filter(s => s !== stage); else delete item.routes[stage];
    if (kind === 'r' ? !item.stages.length : !Object.keys(item.routes).length) map.delete(key);
  }
}
const wayRoutes = way => [...new Set(Object.values(way.routes).flat())].sort();

// The table (NDJSON): routes and ways, with the stages that found them.
export const writeTable = ({routes, ways}) => [
  ...[...routes.values()].sort((a, b) => a.key.localeCompare(b.key)).map(r => JSON.stringify({type: 'route', ...r})),
  ...[...ways.values()].sort((a, b) => a.id - b.id).map(w => JSON.stringify({type: 'way', ...w})),
].join('\n') + '\n';
export function readTable(text) {
  const routes = new Map(), ways = new Map();
  for (const line of text.split('\n')) if (line) {
    const {type, ...item} = JSON.parse(line);
    if (type === 'route') routes.set(item.key, item); else ways.set(item.id, item);
  }
  return {routes, ways};
}

// Lines run west to east (or south to north when due north–south), so that
// neighbouring ways mostly share a direction and each route keeps its side
// where routes run side by side (drawn with an offset by their order).
export function orient(line) {
  const [a, b] = [line[0], line.at(-1)];
  return b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]) ? [...line].reverse() : line;
}
const ORDER = {commuter: 0, subway: 1, monorail: 2, light_rail: 3, tram: 4};
// Joins lines where one ends at the point the next starts (never reversing
// one, which would put its route on the other side).
export function joinLines(lines) {
  const key = ([x, y]) => `${x},${y}`, chains = lines.map(line => [...line]), byStart = new Map();
  chains.forEach((chain, i) => { const k = key(chain[0]); if (!byStart.has(k)) byStart.set(k, []); byStart.get(k).push(i); });
  const used = new Set(), starts = new Set(chains.map(c => key(c.at(-1))));
  const out = [];
  // Chains that nothing leads into go first, so each is followed from its start.
  const order = [...chains.keys()].sort((a, b) => Number(starts.has(key(chains[a][0]))) - Number(starts.has(key(chains[b][0]))));
  for (const i of order) {
    if (used.has(i)) continue;
    used.add(i);
    const line = [...chains[i]];
    for (;;) {
      const next = (byStart.get(key(line.at(-1))) || []).find(j => !used.has(j));
      if (next === undefined) break;
      used.add(next); line.push(...chains[next].slice(1));
    }
    out.push(line);
  }
  return out;
}
// Tiles: Map 'z/x/y' → encoded bytes (layer service_routes), one feature per
// route on each way: its label, colour, kind and place (i of n) among the
// routes drawn on that way (at zooms 7–9 metro and commuter routes only;
// from zoom 10 all of them).
export function buildTiles({routes, ways}) {
  const out = new Map(), sets = [[new Map(), MIN_ZOOM, LOCAL_MIN_ZOOM - 1, r => !LOCAL_KINDS.includes(r.kind)], [new Map(), LOCAL_MIN_ZOOM, MAX_ZOOM, () => true]];
  for (const way of ways.values()) {
    const all = wayRoutes(way).map(key => routes.get(key)).filter(Boolean)
      .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.ref.localeCompare(b.ref, 'en', {numeric: true}) || a.label.localeCompare(b.label));
    const lines = way.lines.map(orient);
    for (const [groups, , , shown] of sets) {
      const list = all.filter(shown);
      // Names as name and name:xx, as the map's other labels, so they follow
      // the label language.
      list.forEach((route, i) => {
        const properties = {id: `relation-${route.relation}`, name: route.label, ...route.names,
          ref: route.ref, colour: route.colour, kind: route.kind, network: route.network, operator: route.operator, i, n: list.length};
        const key = JSON.stringify(properties);
        if (!groups.has(key)) groups.set(key, {properties, lines: []});
        groups.get(key).lines.push(...lines);
      });
    }
  }
  for (const set of sets) {
    const [groups, minZoom, maxZoom] = set;
    // Consecutive ways with the same route in the same place become one
    // line, long enough for its name.
    const features = [...groups.values()].map(({properties, lines}) => {
      const joined = joinLines(lines);
      return {type: 'Feature', properties, geometry: joined.length === 1 ? {type: 'LineString', coordinates: joined[0]} : {type: 'MultiLineString', coordinates: joined}};
    });
    const index = geojsonvt({type: 'FeatureCollection', features}, {maxZoom, indexMaxZoom: maxZoom, indexMaxPoints: 0, tolerance: 1, extent: 4096, buffer: 64});
    for (const {z, x, y} of index.tileCoords) {
      if (z < minZoom) continue;
      const tile = index.getTile(z, x, y);
      if (tile?.features.length) out.set(`${z}/${x}/${y}`, vtpbf.fromGeojsonVt({[LAYER]: tile}, {version: 2}));
    }
  }
  return out;
}
