// Urban rail services (metro, light rail, tram, monorail and commuter rail
// routes, never individual long-distance trains), from OpenStreetMap route
// relations, kept as a table and cut into static vector tiles that draw each
// route along the tracks it runs on, for the Service view. Fetched region by
// region in the stages of the branch lines (branch-lines.mjs).
// Pure functions; scripts/build-service-routes.mjs does the I/O.
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import '../styles/pbf-utf8.mjs'; // names beyond U+1FFFF intact
import {simplify} from './branch-lines.mjs';
import {STAGES, legacyEuropeReady, migrateDownloadStages, partSelection} from './download-stages.mjs';
import {frequencyBundle} from '../styles/service-frequency.mjs';

export const MIN_ZOOM = 7, LOCAL_MIN_ZOOM = 10, MAX_ZOOM = 12, LAYER = 'service_routes';
// Light rail, trams and monorails from zoom 10, as in the other views.
export const LOCAL_KINDS = ['light_rail', 'tram', 'monorail', 'funicular'];

const SELECTS = ['rel[type=route][route~"^(subway|light_rail|tram|monorail)$"]', 'rel[type=route][route=train][service~"^(commuter|urban)$"]'];
const select = filters => SELECTS.map(s => `${s}${filters};`).join('');
// Routes with a member in the box (leaving out countries fetched in earlier
// stages), their tags and members, then the geometry of their track ways.
export function partQuery(part, box) {
  const {areas, set} = partSelection(part, box, select);
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
// or without a network or operator),
// in the same place. routeOf gives that group without the place;
// serviceRoutes adds it, since networks are often named generically
// ("Metro").
export function routeOf(rel) {
  const t = rel.tags || {};
  const label = routeLabel(t.name) || t.ref || '', ref = t.ref || '';
  if (!label) return null;
  const names = Object.fromEntries(Object.entries(t).filter(([k]) => NAME_KEY.test(k)).map(([k, v]) => [k, routeLabel(v)]).filter(([, v]) => v));
  const kind = t.route === 'train' ? 'commuter' : t.route;
  // The name stays in the key without a reference or without a network or
  // operator to scope the reference.
  const scope = t.network || t.operator || '';
  return {key: [kind, scope, ref, colour(t.colour), ref && scope ? '' : label].join('|'), kind,
    ref, label, colour: colour(t.colour), network: t.network || '', operator: t.operator || '', relation: rel.id, names};
}

// From an Overpass response: the routes (by key) and the track ways with the
// routes running on them.
export function toTable(json) {
  if (json.remark || !Array.isArray(json.elements)) throw new Error(json.remark ? `Overpass: ${json.remark}` : 'Incomplete Overpass response');
  const rels = [], geometry = new Map();
  for (const el of json.elements) {
    if (el.type !== 'relation') continue;
    const route = routeOf(el);
    if (route) rels.push({route, ways: (el.members || []).filter(m => m.type === 'way' && !/platform|stop/.test(m.role || '')).map(m => m.ref)});
  }
  for (const el of json.elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const parts = [[]];
    for (const p of el.geometry) {
      if (p && Number.isFinite(p.lon) && Number.isFinite(p.lat)) parts.at(-1).push([p.lon, p.lat]);
      else if (parts.at(-1).length) parts.push([]);
    }
    // Finer than the branch lines (about 5 m): the routes are drawn close up.
    const lines = parts.filter(part => part.length > 1).map(part => simplify(part, 0.00005).map(round));
    if (lines.length) geometry.set(el.id, lines);
  }
  // Each relation is kept on its own, by its id: a response holds only the
  // relations selected in its box, so which relations make up a route is
  // decided from the whole table when the tiles are made (serviceRoutes).
  const routes = new Map(), wayRoutes = new Map();
  for (const rel of rels) {
    const key = `r${rel.route.relation}`;
    routes.set(key, {...rel.route, group: rel.route.key, key});
    for (const id of rel.ways) {
      if (!wayRoutes.has(id)) wayRoutes.set(id, new Set());
      wayRoutes.get(id).add(key);
    }
  }
  const ways = [...wayRoutes].filter(([id]) => geometry.has(id)).map(([id, keys]) => ({id, routes: [...keys].sort(), lines: geometry.get(id)}));
  return {routes: [...routes.values()], ways};
}
const round = ([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6];

// The table keeps, for each way and route (one relation), what each stage
// found: a way's routes by stage and a route (what its relation says) by
// stage. A stage's pass (which
// may span runs) writes into `next`, adding up across its boxes (each
// response lists only the routes selected in its box); when the pass is
// complete, `next` replaces the stage's part (commitStage), or is dropped if
// the refresh looks incomplete (discardStage). Parts other stages found stay
// either way. Until then the tiles draw both.
export function addResult(table, result, stage) {
  for (const route of result.routes) {
    const previous = table.routes.get(route.key), next = {...(previous?.next || {})};
    // The pass's lowest relation, with what that relation says (name,
    // translations, operator…).
    if (!next[stage] || route.relation < next[stage].relation) next[stage] = route;
    table.routes.set(route.key, {key: route.key, stages: previous?.stages || {}, next});
  }
  for (const way of result.ways) {
    const previous = table.ways.get(way.id), next = {...(previous?.next || {})};
    next[stage] = [...new Set([...(next[stage] || []), ...way.routes])].sort();
    // Its geometry too waits for the pass (the committed lines stay drawn).
    table.ways.set(way.id, {id: way.id, lines: previous?.lines, routes: previous?.routes || {}, next, nextLines: {...(previous?.nextLines || {}), [stage]: way.lines}});
  }
}
const partOf = item => item.stages || item.routes;
// How much of the stage's committed part its pass did not find again, of
// that committed part (what the pass newly found does not count, so it
// cannot mask an incomplete response).
// Routes and ways are counted apart: ways shared by many routes stay found
// while some of those routes are missing, so they cannot mask a loss of
// routes. stale and total are the two together.
export function stageChange(table, stage) {
  const count = map => {
    let stale = 0, total = 0;
    for (const item of map.values()) {
      const held = stage in partOf(item);
      if (held) total++;
      if (held && !(stage in item.next)) stale++;
    }
    return {stale, total};
  };
  const routes = count(table.routes), ways = count(table.ways);
  return {stale: routes.stale + ways.stale, total: routes.total + ways.total, routes, ways};
}
// A completed refresh that looks incomplete: it would remove more than a
// fifth of the stage's committed routes, or of its ways (with enough of
// them for the share to mean something).
export const suspiciousChange = ({routes, ways}) =>
  (routes.total >= 20 && routes.stale > routes.total * 0.2) || (ways.total > 100 && ways.stale > ways.total * 0.2);
function settle(table, stage, commit) {
  for (const [map, key] of [[table.routes, 'key'], [table.ways, 'id']]) for (const item of [...map.values()]) {
    const part = partOf(item);
    if (commit) { if (stage in item.next) part[stage] = item.next[stage]; else delete part[stage]; }
    if (item.nextLines?.[stage]) { if (commit) item.lines = item.nextLines[stage]; delete item.nextLines[stage]; }
    delete item.next[stage];
    if (!Object.keys(part).length && !Object.keys(item.next).length) map.delete(item[key]);
  }
}
export const commitStage = (table, stage) => settle(table, stage, true);
export const discardStage = (table, stage) => settle(table, stage, false);
// Merge committed and interrupted parts of changed stages into the retired
// Europe fallback. It stays drawable until the replacement passes succeed.
export function migrateServiceDownloads(state, table) {
  const retired = migrateDownloadStages(state);
  if (!retired || !state.legacyEurope) return state;
  for (const route of table.routes.values()) {
    for (const stage of retired) {
      for (const next of [route.stages[stage], route.next[stage]]) if (next) {
        const old = route.stages.europe;
        if (!old || next.relation < old.relation) route.stages.europe = next;
      }
      if (stage !== 'europe') delete route.stages[stage];
      delete route.next[stage];
    }
  }
  for (const way of table.ways.values()) {
    for (const stage of retired) {
      const routes = [...(way.routes[stage] || []), ...(way.next[stage] || [])];
      if (routes.length) way.routes.europe = [...new Set([...(way.routes.europe || []), ...routes])].sort();
      way.lines ||= way.nextLines?.[stage];
      if (stage !== 'europe') delete way.routes[stage];
      delete way.next[stage];
      if (way.nextLines) delete way.nextLines[stage];
    }
  }
  return state;
}

export function retireServiceEurope(state, table) {
  if (!state.legacyEurope || !legacyEuropeReady(state)) return;
  const count = map => {
    let total = 0, stale = 0;
    for (const item of map.values()) if ('europe' in partOf(item)) {
      total++;
      if (!STAGES.some(stage => stage.name in partOf(item))) stale++;
    }
    return {total, stale};
  };
  const change = {routes: count(table.routes), ways: count(table.ways)};
  if (suspiciousChange(change)) return;
  // An empty committed pass removes only the retired parent's memberships;
  // each new group and every other stage keeps its own geometry and routes.
  discardStage(table, 'europe');
  commitStage(table, 'europe');
  delete state.legacyEurope;
}

// What the tiles draw: committed and in-progress parts together.
const wayRoutes = way => [...new Set([...Object.values(way.routes), ...Object.values(way.next)].flat())].sort();
// A route as drawn: its committed part with the lowest relation, or before
// any is committed, the in-progress one.
export function routeView(route) {
  const parts = Object.values(route.stages).length ? Object.values(route.stages) : Object.values(route.next);
  return parts.reduce((a, b) => (b.relation < a.relation ? b : a));
}
export const routeStages = route => [...new Set([...Object.keys(route.stages), ...Object.keys(route.next)])];

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

const drawnLines = way => way.lines || Object.values(way.nextLines || {})[0] || [];
// Relations of one service (the same kind, network, reference and colour…)
// become one route where they share a track or lie within about 10 km of
// each other (the directions and variants of a line); apart, they are the
// like-named routes of different places. Made from the whole table, which
// holds every relation found, in whichever box or stage. Returns relation
// key → the route as drawn: its lowest relation, which gives its link and
// details.
const NEAR = 0.1; // degrees: relations of one service this close are one route
export function serviceRoutes({routes, ways}) {
  const views = new Map([...routes.values()].map(route => [route.key, routeView(route)]));
  const parent = new Map([...views.keys()].map(key => [key, key])), cells = new Map();
  const find = key => { const p = parent.get(key); if (p === key) return key; const root = find(p); parent.set(key, root); return root; };
  const join = (a, b) => { const [ra, rb] = [find(a), find(b)]; if (ra !== rb) parent.set(ra, rb); };
  const group = key => views.get(key).group ?? key;
  // Each relation's lines as points at most NEAR / 2 apart, filed by cells
  // NEAR wide, so two relations are near where their tracks are (not merely
  // their extents, which overlap for long or diagonal routes far apart).
  const cellOf = (x, y) => `${Math.floor(x / NEAR)},${Math.floor(y / NEAR)}`;
  const file = (key, x, y) => {
    if (!cells.has(key)) cells.set(key, new Map());
    const own = cells.get(key), cell = cellOf(x, y);
    if (!own.has(cell)) own.set(cell, []);
    own.get(cell).push([x, y]);
  };
  for (const way of ways.values()) {
    const keys = wayRoutes(way).filter(key => views.has(key));
    for (const key of keys) for (const line of drawnLines(way)) line.forEach(([x, y], i) => {
      if (i) {
        const [px, py] = line[i - 1], steps = Math.ceil(Math.hypot(x - px, y - py) / (NEAR / 2));
        for (let k = 1; k < steps; k++) file(key, px + (x - px) * k / steps, py + (y - py) * k / steps);
      }
      file(key, x, y);
    });
    for (const same of Map.groupBy(keys, group).values()) for (const key of same.slice(1)) join(same[0], key);
  }
  const near = (a, b) => {
    if (!a || !b) return false;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const points of small.values()) for (const [x, y] of points) {
      const cx = Math.floor(x / NEAR), cy = Math.floor(y / NEAR);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
        for (const [ox, oy] of large.get(`${cx + dx},${cy + dy}`) || []) if (Math.hypot(ox - x, oy - y) <= NEAR) return true;
    }
    return false;
  };
  for (const same of Map.groupBy(views.keys(), group).values())
    for (let i = 0; i < same.length; i++) for (let j = i + 1; j < same.length; j++) if (find(same[i]) !== find(same[j]) && near(cells.get(same[i]), cells.get(same[j]))) join(same[i], same[j]);
  const out = new Map();
  for (const members of Map.groupBy(views.keys(), find).values()) {
    // The lowest relation gives the link and the name; translations and
    // tags it lacks come from the others (lowest first).
    const [first, ...rest] = members.map(key => views.get(key)).sort((a, b) => a.relation - b.relation);
    const view = {...first, names: {...first.names}};
    for (const other of rest) {
      for (const [k, v] of Object.entries(other.names || {})) if (!view.names[k]) view.names[k] = v;
      for (const field of ['network', 'operator', 'colour']) if (!view[field] && other[field]) view[field] = other[field];
    }
    for (const key of members) out.set(key, view);
  }
  return out;
}

// Lines run west to east (or south to north when due north–south), so that
// neighbouring ways mostly share a direction and each route keeps its side
// where routes run side by side (drawn with an offset by their order).
export function orient(line) {
  const [a, b] = [line[0], line.at(-1)];
  return b[0] < a[0] || (b[0] === a[0] && b[1] < a[1]) ? [...line].reverse() : line;
}
const ORDER = {rail:0,commuter: 0, subway: 1, monorail: 2, light_rail: 3, tram: 4,funicular:5};
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
// Only OSM route relations are drawn. Timetable data never adds a line of its
// own: a GTFS route is often an individual train service, and a feed's
// "shapes" can be bare stop-to-stop chords. Frequencies only ever attach to
// these routes (headways).
export function buildTiles({routes, ways}, {headways} = {}) {
  const out = new Map(), sets = [[new Map(), MIN_ZOOM, LOCAL_MIN_ZOOM - 1, r => !LOCAL_KINDS.includes(r.kind)], [new Map(), LOCAL_MIN_ZOOM, MAX_ZOOM, () => true]];
  const service = serviceRoutes({routes, ways});
  for (const way of ways.values()) {
    // A route once, whichever of its relations run here.
    const all = [...new Set(wayRoutes(way).map(key => service.get(key)).filter(Boolean))]
      .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.ref.localeCompare(b.ref, 'en', {numeric: true}) || a.label.localeCompare(b.label));
    const lines = drawnLines(way).map(orient);
    if (!lines.length) continue;
    for (const [groups, , , shown] of sets) {
      const list = all.filter(shown);
      const frequency = headways ? frequencyBundle(list, lines, headways) : null;
      // Names as name and name:xx, as the map's other labels, so they follow
      // the label language.
      list.forEach((route, i) => {
        const properties = {id: `relation-${route.relation}`, name: route.label, ...route.names,
          ref: route.ref, colour: route.colour, kind: route.kind, network: route.network, operator: route.operator, i, n: list.length,
          // Its place across the bundle (−(n−1) … n−1), for its name's offset.
          slot: Math.max(-63, Math.min(63, 2 * i - (list.length - 1)))};
        if (frequency) Object.assign(properties, frequency[i]);
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
