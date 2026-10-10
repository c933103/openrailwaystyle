// Urban rail services (metro, light rail, tram, monorail and commuter rail
// routes, never individual long-distance trains), from OpenStreetMap route
// relations, kept as a table and cut into static vector tiles that draw each
// route along the tracks it runs on, for the Service view. Fetched region by
// region in the stages of the branch lines (branch-lines.mjs).
// Pure functions; scripts/build-service-routes.mjs does the I/O.
import {observeRelation, legacyRelation, reconcileRelations, mergeRelationParts, acceptedRelation, drawnRelation, relationAllows, relationSummary} from './service-relations.mjs';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import '../styles/pbf-utf8.mjs'; // names beyond U+1FFFF intact
import {observeGeometry, legacyGeometry, reconcileGeometry, geometryLines, geometryStatus} from './service-geometry.mjs';
import {STAGES, fallbackStage, legacyEuropeReady, migrateDownloadStages, partSelection} from './download-stages.mjs';
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
  return `[out:json][timeout:180][maxsize:536870912];${areas}${set}->.r;.r out meta;way(r.r)[railway~"^(rail|light_rail|subway|tram|monorail|narrow_gauge|funicular)$"];out meta geom qt;`;
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
function timetableTags(t){
  const feed=t['gtfs:feed']||t['gtfs:feed_id']||t['gtfs:source']||'',routeIds=String(t['gtfs:route_id']||'').split(';').filter(Boolean);
  const operators=Object.entries(t).filter(([k])=>/^(operator|network):(?:[a-z]{2,3}(?:-[A-Za-z]{2,4})?|short|full)$/.test(k)&&!/:((ref)|(url))$/.test(k)).map(([,v])=>v);
  return feed||routeIds.length||operators.length?{feed,routeIds,operators}:null;
}
export function routeOf(rel) {
  const t = rel.tags || {};
  const label = routeLabel(t.name) || t.ref || '', ref = t.ref || '';
  if (!label) return null;
  const names = Object.fromEntries(Object.entries(t).filter(([k]) => NAME_KEY.test(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, routeLabel(v)]).filter(([, v]) => v));
  const kind = t.route === 'train' ? 'commuter' : t.route;
  // The name stays in the key without a reference or without a network or
  // operator to scope the reference.
  const scope = t.network || t.operator || '';
  return {key: [kind, scope, ref, colour(t.colour), ref && scope ? '' : label].join('|'), kind,
    ref, label, colour: colour(t.colour), network: t.network || '', operator: t.operator || '', relation: rel.id, names, ...(timetableTags(t)?{timetable:timetableTags(t)}:{})};
}

// From an Overpass response: the routes (by key) and the track ways with the
// routes running on them.
export function toTable(json, source = {}) {
  if (json.remark || !Array.isArray(json.elements)) throw new Error(json.remark ? `Overpass: ${json.remark}` : 'Incomplete Overpass response');
  const geometry = new Map(), trackWays = new Set();
  for (const el of json.elements) {
    if (el.type !== 'way') continue;
    trackWays.add(el.id);
    geometry.set(el.id, reconcileGeometry(geometry.get(el.id), observeGeometry(el, json, source)));
  }
  const routes = new Map(), wayRoutes = new Map();
  for (const el of json.elements) {
    if (el.type !== 'relation') continue;
    const route = routeOf(el), key = `r${el.id}`;
    // Retain a current unnamed declaration too: loss of its display tags
    // must not resurrect an older drawable identity.
    const view = route ? {...route, group: route.key, key} : {key, relation: el.id, active: false, label: '', ref: '', names: {}};
    const membership = observeRelation(el, json, source, view, trackWays);
    routes.set(key, mergeRelationParts(routes.get(key), {...view, membership}));
    for (const id of membership.eligible) {
      if (!wayRoutes.has(id)) wayRoutes.set(id, new Set());
      wayRoutes.get(id).add(key);
    }
  }
  // Do not infer track eligibility for unreturned relation members: the
  // query intentionally omits non-track ways, besides platform/stop roles.
  const ways = [...wayRoutes].filter(([id]) => trackWays.has(id)).map(([id, keys]) => ({id, routes: [...keys].sort(), lines: geometryLines(geometry.get(id)), geometry: geometry.get(id)}));
  return {routes: [...routes.values()], ways};
}

// The table keeps, for each way and route (one relation), what each stage
// found: a way's routes by stage and a route (what its relation says) by
// stage. A stage's pass (which
// may span runs) writes into `next`, adding up across its boxes (each
// response lists only the routes selected in its box); when the pass is
// complete, `next` replaces the stage's part (commitStage), or is dropped if
// the refresh looks incomplete (discardStage). Parts other stages found stay
// either way. Until then new relations may draw pending evidence; accepted relations
// keep their accepted declaration and geometry until commit.
export function addResult(table, result, stage) {
  for (const route of result.routes) {
    const previous = table.routes.get(route.key), next = {...(previous?.next || {})};
    next[stage] = mergeRelationParts(next[stage], route);
    table.routes.set(route.key, {...previous, key: route.key, stages: previous?.stages || {}, next});
  }
  for (const way of result.ways) {
    const previous = table.ways.get(way.id), next = {...(previous?.next || {})};
    next[stage] = [...new Set([...(next[stage] || []), ...way.routes])].sort();
    // Accepted evidence is immutable during a pending pass. Each pending
    // frontier accumulates compatible source slots independently of arrival.
    const nextGeometry = {...(previous?.nextGeometry || {})};
    nextGeometry[stage] = reconcileGeometry(nextGeometry[stage], way.geometry || legacyGeometry(way.lines));
    const nextLines = {...(previous?.nextLines || {}), [stage]: geometryLines(nextGeometry[stage])};
    table.ways.set(way.id, {...previous, id: way.id, lines: previous?.lines,
      geometry: previous?.geometry || (previous?.lines ? legacyGeometry(previous.lines) : undefined),
      routes: previous?.routes || {}, next, nextLines, nextGeometry});
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
  const rejected = new Map();
  if (commit) for (const route of table.routes.values()) {
    const accepted = acceptedRelation(route), candidate = route.next[stage]?.membership;
    if (accepted?.snapshot && candidate && !candidate.snapshot) rejected.set(route.key, new Set(accepted.eligible));
  }
  for (const [map, key] of [[table.routes, 'key'], [table.ways, 'id']]) for (const item of [...map.values()]) {
    const part = partOf(item);
    if (map === table.routes && commit) {
      const accepted = acceptedRelation(item);
      item.evidence = reconcileRelations(accepted, item.next[stage]?.membership);
      if (!item.evidence) delete item.evidence;
    }
    if (commit && map === table.ways && rejected.size) {
      // Reject the membership delta along with its unverified declaration.
      // Retain only this stage's previous, still-eligible associations; never
      // borrow old memberships from another stage or revive a superseded way.
      const retained = (part[stage] || []).filter(key => rejected.get(key)?.has(item.id));
      const next = (item.next[stage] || []).filter(key => !rejected.has(key));
      const memberships = [...new Set([...next, ...retained])].sort();
      if (memberships.length) part[stage] = memberships; else delete part[stage];
    } else if (commit) { if (stage in item.next) part[stage] = item.next[stage]; else delete part[stage]; }
    if (map === table.ways) {
      if (item.retiredGeometry) delete item.retiredGeometry[stage];
      const candidate = item.nextGeometry?.[stage] || (item.nextLines?.[stage] ? legacyGeometry(item.nextLines[stage]) : null);
      if (commit && candidate) {
        item.geometry = reconcileGeometry(item.geometry || (item.lines ? legacyGeometry(item.lines) : null), candidate);
        if (!item.geometry.snapshot && item.geometry.conflict && item.lines?.length) item.legacyFallback ||= item.lines;
        if (item.geometry.snapshot) delete item.legacyFallback;
        item.lines = geometryLines({...item.geometry, fallbackLines: item.legacyFallback});
      }
      if (item.nextGeometry) delete item.nextGeometry[stage];
      if (item.nextLines) delete item.nextLines[stage];
    }
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
  state.legacyEurope.serviceStages = [...new Set([...(state.legacyEurope.serviceStages || []), ...retired.map(fallbackStage)])];
  const legacyEligibility = new Map();
  for (const way of table.ways.values()) for (const key of new Set(Object.values(way.routes).flat())) {
    if (!legacyEligibility.has(key)) legacyEligibility.set(key, []);
    legacyEligibility.get(key).push(way.id);
  }
  for (const route of table.routes.values()) {
    if (!retired.some(stage => route.stages[stage] || route.next[stage])) continue;
    const accepted = acceptedRelation(route) || (Object.keys(route.stages).length ? legacyRelation(routeView(route), legacyEligibility.get(route.key) || []) : null);
    for (const stage of retired) {
      const fallback = fallbackStage(stage);
      for (const next of [route.stages[stage], route.next[stage]]) if (next) {
        route.stages[fallback] = mergeRelationParts(route.stages[fallback], next);
      }
      if (stage !== fallback) delete route.stages[stage];
      delete route.next[stage];
    }
    route.evidence = accepted || acceptedRelation(route);
    if (!route.evidence) delete route.evidence;
  }
  for (const way of table.ways.values()) {
    const accepted = way.geometry || (way.lines ? legacyGeometry(way.lines) : null);
    let adopted = null;
    for (const stage of retired) {
      const fallback = fallbackStage(stage);
      const routes = [...(way.routes[stage] || []), ...(way.next[stage] || [])];
      if (routes.length) way.routes[fallback] = [...new Set([...(way.routes[fallback] || []), ...routes])].sort();
      const pending = way.nextGeometry?.[stage] || (way.nextLines?.[stage] ? legacyGeometry(way.nextLines[stage]) : null);
      if (pending) {
        way.retiredGeometry ||= {};
        way.retiredGeometry[fallback] = reconcileGeometry(way.retiredGeometry[fallback], pending);
        adopted = reconcileGeometry(adopted, pending);
      }
      if (stage !== fallback) delete way.routes[stage];
      delete way.next[stage];
      if (way.nextLines) delete way.nextLines[stage];
      if (way.nextGeometry) delete way.nextGeometry[stage];
    }
    // Keep the accepted boundary; retain interrupted provenance separately.
    way.geometry = accepted || adopted;
    if (way.geometry) way.lines = geometryLines(way.geometry);
  }
  return state;
}

export function retireServiceEurope(state, table) {
  if (!state.legacyEurope || !legacyEuropeReady(state)) return;
  const count = (map, fallback) => {
    let total = 0, stale = 0;
    for (const item of map.values()) if (fallback in partOf(item)) {
      total++;
      if (!STAGES.some(stage => stage.name in partOf(item))) stale++;
    }
    return {total, stale};
  };
  const fallbacks = state.legacyEurope.serviceStages || ['europe'];
  for (const fallback of fallbacks) {
    const change = {routes: count(table.routes, fallback), ways: count(table.ways, fallback)};
    if (suspiciousChange(change)) return;
  }
  // An empty committed pass removes only the retired parent's memberships;
  // each new group and every other stage keeps its own geometry and routes.
  for (const fallback of fallbacks) {
    discardStage(table, fallback);
    commitStage(table, fallback);
  }
  delete state.legacyEurope;
}

// What the tiles draw: positive observed rows filtered by one relation frontier.
export const wayRoutes = (way, routes) => [...new Set([...Object.values(way.routes), ...Object.values(way.next)].flat())].filter(key => !routes || (routes.has(key) && relationAllows(routes.get(key), way.id, Object.values(way.routes).some(keys => keys.includes(key))))).sort();
// Tags come from the same frontier that controls membership. Older tables
// without relation evidence retain their legacy lowest-relation fallback.
export function routeView(route) {
  const evidence = drawnRelation(route);
  if (evidence) {const timetable=timetableTags(evidence.tags||{});return timetable?{...evidence.view,timetable}:evidence.view;}
  const parts = Object.values(route.stages).length ? Object.values(route.stages) : Object.values(route.next);
  return parts.reduce((a, b) => (b.relation < a.relation ? b : a));
}
export const routeStages = route => [...new Set([...Object.keys(route.stages), ...Object.keys(route.next)])];

// Pure legacy evidence already has its coordinates in the compatibility
// lines fields. Persist an explicit unknown marker, not a second copy of
// every path and a derived fingerprint; restore that reducer input on read.
const storedGeometry = (evidence, lines) => evidence && !evidence.snapshot && !evidence.raw && !evidence.conflict &&
  evidence.reasons?.length === 1 && evidence.reasons[0] === 'legacy' && !evidence.sources?.length &&
  JSON.stringify(evidence.lines) === JSON.stringify(lines)
  ? {schema: 1, snapshot: null, legacy: true} : evidence;
const storedWay = way => ({...way,
  ...(way.geometry ? {geometry: storedGeometry(way.geometry, way.lines)} : {}),
  ...(way.nextGeometry ? {nextGeometry: Object.fromEntries(Object.entries(way.nextGeometry).map(([stage, evidence]) =>
    [stage, storedGeometry(evidence, way.nextLines?.[stage])]))} : {})});
// The table (NDJSON): routes and ways, with the stages that found them.
export const writeTable = ({routes, ways}) => [
  ...[...routes.values()].sort((a, b) => a.key.localeCompare(b.key)).map(r => JSON.stringify({type: 'route', ...r})),
  ...[...ways.values()].sort((a, b) => a.id - b.id).map(w => JSON.stringify({type: 'way', ...storedWay(w)})),
].join('\n') + '\n';
export function readTable(text) {
  const routes = new Map(), ways = new Map();
  for (const line of text.split('\n')) if (line) {
    const {type, ...item} = JSON.parse(line);
    if (type === 'route') routes.set(item.key, item);
    else {
      if ((!item.geometry || item.geometry.legacy) && item.lines) item.geometry = legacyGeometry(item.lines);
      item.nextGeometry ||= {};
      for (const [stage, lines] of Object.entries(item.nextLines || {}))
        if (!item.nextGeometry[stage] || item.nextGeometry[stage].legacy) item.nextGeometry[stage] = legacyGeometry(lines);
      ways.set(item.id, item);
    }
  }
  return {routes, ways};
}

export function drawnGeometry(way) {
  const accepted = way.geometry ? {...way.geometry, ...(way.legacyFallback ? {fallbackLines: way.legacyFallback} : {})} : (way.lines ? legacyGeometry(way.lines) : null);
  // A certified zero-line frontier is still authoritative. Legacy empty
  // arrays were only absence of evidence and may use a pending fallback.
  if (accepted?.snapshot || geometryLines(accepted).length || accepted?.conflict) return accepted;
  const pending = {...Object.fromEntries(Object.entries(way.nextLines || {}).map(([stage, lines]) => [stage, legacyGeometry(lines)])), ...(way.nextGeometry || {}), ...(way.retiredGeometry || {})};
  return Object.values(pending).reduce(reconcileGeometry, accepted);
}
const drawnLines = way => geometryLines(drawnGeometry(way));
// Schema 2 includes raw internal gaps, source conflicts and unverified
// legacy fallback. Details are bounded here; raw slots stay in the table.
export function geometrySummary({routes, ways}) {
  const drawable = new Set(), missing = new Set(), waysWithoutGeometry = [], partialWays = [], conflictWays = [], unknownWays = [], pendingWays = [], details = [];
  for (const way of [...ways.values()].sort((a, b) => a.id - b.id)) {
    const evidence = drawnGeometry(way), status = geometryStatus(evidence);
    if (!status.drawable) waysWithoutGeometry.push(way.id);
    if (status.status === 'partial') partialWays.push(way.id);
    if (status.status === 'conflict') conflictWays.push(way.id);
    if (status.status === 'unknown') unknownWays.push(way.id);
    const pending = [...Object.values(way.nextGeometry || {}), ...Object.values(way.retiredGeometry || {})].reduce(reconcileGeometry, null);
    // Pending is a transaction state, even when drawing uses that same
    // fallback or its geometry is identical to the accepted frontier.
    if (pending) pendingWays.push(way.id);
    for (const key of wayRoutes(way, routes)) if (routes.has(key)) {
      if (status.drawable) drawable.add(key);
      if (!status.drawable || status.missing.length || ['partial', 'conflict'].includes(status.status)) missing.add(key);
    }
    if ((status.status !== 'complete' || status.ignoredUnverified?.length || pendingWays.at(-1) === way.id) && details.length < 100) details.push({way: way.id,
      relations: wayRoutes(way, routes).filter(key => routes.has(key)).map(key => routeView(routes.get(key)).relation).sort((a, b) => a - b),
      ...status, missing: status.missing.slice(0, 20), missingCount: status.missing.length,
      sources: evidence?.sources || [], ...(pending ? {pending: {...geometryStatus(pending), missing: geometryStatus(pending).missing.slice(0, 20)}} : {})});
  }
  const relationIds = keys => [...keys].map(key => routeView(routes.get(key)).relation).sort((a, b) => a - b);
  return {schema: 2, waysWithoutGeometry, waysWithPartialGeometry: partialWays, waysWithConflicts: conflictWays,
    waysWithUnknownProvenance: unknownWays, waysWithPendingEvidence: pendingWays,
    routeRelationsWithoutGeometry: relationIds([...routes.keys()].filter(key => routeView(routes.get(key)).active !== false && !drawable.has(key))),
    routeRelationsWithPartialGeometry: relationIds([...missing].filter(key => drawable.has(key))), details, relations: relationSummary(routes, ways)};
}
// Relations of one service (the same kind, network, reference and colour…)
// become one route where they share a track or lie within about 10 km of
// each other (the directions and variants of a line); apart, they are the
// like-named routes of different places. Made from the whole table, which
// holds every relation found, in whichever box or stage. Returns relation
// key → the route as drawn: its lowest relation, which gives its link and
// details.
const NEAR = 0.1; // degrees: relations of one service this close are one route
export function serviceRoutes({routes, ways}) {
  const views = new Map([...routes.values()].map(route => [route.key, routeView(route)]).filter(([, view]) => view.active !== false));
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
    const keys = wayRoutes(way, routes).filter(key => views.has(key));
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
    const identities=[first,...rest].map(r=>r.timetable).filter(Boolean);
    if(identities.length){
      const bindings=new Map(),operators=new Set();
      for(const t of identities){
        for(const op of t.operators||[])operators.add(op);
        for(const b of t.bindings||[t])if(b.feed){
          if(!bindings.has(b.feed))bindings.set(b.feed,new Set());
          for(const id of b.routeIds||[])bindings.get(b.feed).add(id);
        }
      }
      const scoped=[...bindings].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([feed,ids])=>({feed,routeIds:[...ids].sort()}));
      view.timetable={bindings:scoped,operators:[...operators].sort(),...(scoped.length===1?scoped[0]:{})};
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
export function buildTiles({routes, ways}, {headways, timetables} = {}) {
  const out = new Map(), sets = [[new Map(), MIN_ZOOM, LOCAL_MIN_ZOOM - 1, r => !LOCAL_KINDS.includes(r.kind)], [new Map(), LOCAL_MIN_ZOOM, MAX_ZOOM, () => true]];
  const service = serviceRoutes({routes, ways});
  for (const way of ways.values()) {
    // A route once, whichever of its relations run here.
    const all = [...new Set(wayRoutes(way, routes).map(key => service.get(key)).filter(Boolean))]
      .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.ref.localeCompare(b.ref, 'en', {numeric: true}) || a.label.localeCompare(b.label));
    const original = drawnLines(way), sections = timetables?.get(way.id);
    // Only split at existing OSM vertices. Timetable shapes never supply a
    // coordinate, route ID, eligibility or offset slot to the renderer.
    const parts=sections?.length ? original.flatMap((line,l)=>{
      // Keep bends in the whole line's direction; records index the original
      // OSM sequence even when the complete line is reversed for offsets.
      const oriented=orient(line),reversed=oriented!==line;
      return oriented.slice(1).map((b,e)=>({lines:[[oriented[e],b]],records:new Map(sections.filter(s=>s.line===l&&s.edge===(reversed?line.length-2-e:e)).map(s=>[s.relation,s.record]))}));
    }) : [{lines:original.map(orient),records:new Map()}];
    for(const {lines,records} of parts){
    if (!lines.length) continue;
    for (const [groups, , , shown] of sets) {
      const list = all.filter(shown);
      const frequency = headways || records.size ? frequencyBundle(list, lines, headways, list.map(r=>records.get(r.relation))) : null;
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
