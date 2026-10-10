// Source evidence is reconciled before simplification. A source snapshot is
// necessary: moving an OSM node does not increment its parent way's version.
import {createHash} from 'node:crypto';
import {simplify} from './branch-lines.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const time = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().replace(/\.000Z$/, 'Z') : null;
const coord = p => p && Number.isFinite(p.lon) && Number.isFinite(p.lat) && Math.abs(p.lon) <= 180 && Math.abs(p.lat) <= 90 ? [p.lon, p.lat] : null;
const sorted = values => [...new Set(values)].sort();
const refs = values => [...new Map(values.map(value => [JSON.stringify(value), value])).entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 8).map(([, value]) => value);
const round = ([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6];
function linesOf(slots) {
  const parts = [[]];
  for (const point of slots) {
    if (point) parts.at(-1).push(point);
    else if (parts.at(-1).length) parts.push([]);
  }
  return parts.filter(part => part.length > 1).map(part => simplify(part, 0.00005).map(round));
}
function consistentSlots(nodes, slots) {
  const coordinates = new Map(), disputed = new Set();
  nodes.forEach((id, i) => {
    const point = slots[i];
    if (point === false) disputed.add(id);
    if (!point) return;
    const previous = coordinates.get(id);
    if (previous && (previous[0] !== point[0] || previous[1] !== point[1])) disputed.add(id);
    coordinates.set(id, point);
  });
  return slots.map((point, i) => disputed.has(nodes[i]) ? false : point);
}
function ignored(...evidence) {
  return refs(evidence.flatMap(item => item?.ignoredUnverified || []));
}
export function observeGeometry(el, json, source = {}) {
  const snapshot = time(json.osm3s?.timestamp_osm_base), timestamp = time(el.timestamp);
  const version = Number.isSafeInteger(el.version) && el.version > 0 ? el.version : null;
  const nodes = Array.isArray(el.nodes) && el.nodes.every(id => Number.isSafeInteger(id) && id > 0) ? el.nodes.slice() : null;
  const raw = Array.isArray(el.geometry) ? el.geometry.map(coord) : [];
  const malformed = Boolean(nodes && raw.length && nodes.length !== raw.length);
  const certified = Boolean(snapshot && timestamp && Date.parse(timestamp) <= Date.parse(snapshot) && version && nodes?.length >= 2);
  const observation = hash([snapshot, version, timestamp, nodes, raw]);
  const reference = {observation, dataset: 'openstreetmap', ...Object.fromEntries(['endpoint', 'acquired', 'stage', 'pass', 'query'].filter(key => source[key] != null).map(key => [key, source[key]]))};
  if (!certified) return {...legacyGeometry(linesOf(raw), 'unverified_source'), sources: [reference],
    // Preserve source fields even when they are insufficient to prove freshness.
    raw: {snapshot, timestamp, version, nodes, slots: raw}, malformed};
  return {schema: 1, snapshot, timestamp, version, maxVersion: version, maxTimestamp: timestamp, revisionKeys: [hash([version, timestamp, nodes])], nodes,
    // Unaligned geometry cannot establish which node owns any coordinate.
    slots: malformed ? nodes.map(() => null) : consistentSlots(nodes, nodes.map((_, i) => raw[i] || null)),
    malformed, ...(malformed ? {malformedSlots: raw} : {}), topologyConflict: false, sources: [reference]};
}
export function legacyGeometry(lines = [], reason = 'legacy') {
  return {schema: 1, snapshot: null, lines, reasons: [reason], fingerprint: lines.length ? hash(lines) : null, conflict: false, sources: []};
}
export function reconcileGeometry(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (!a.snapshot || !b.snapshot) {
    if (a.snapshot || b.snapshot) {
      const known = a.snapshot ? a : b, unknown = a.snapshot ? b : a;
      // Keep ignored acquisition evidence inspectable without letting it
      // change certified coordinates. Pure legacy storage is not a new query.
      const ignoredUnverified = refs([...ignored(a, b), ...(unknown.reasons?.includes('unverified_source') ? unknown.sources : [])]);
      return {...known, ...(ignoredUnverified.length ? {ignoredUnverified} : {})};
    }
    const conflict = a.conflict || b.conflict || Boolean(a.fingerprint && b.fingerprint && a.fingerprint !== b.fingerprint);
    const key = value => JSON.stringify([value.fingerprint, value.raw || null]);
    const selected = !a.fingerprint && b.fingerprint ? b : a.fingerprint && !b.fingerprint ? a : key(a) <= key(b) ? a : b;
    return {...selected, lines: conflict ? [] : selected.lines, conflict,
      reasons: sorted([...(a.reasons || []), ...(b.reasons || []), ...(conflict ? ['unverified_conflict'] : [])]), sources: refs([...(a.sources || []), ...(b.sources || [])])};
  }
  const maxVersion = Math.max(a.maxVersion, b.maxVersion);
  const ignoredUnverified = ignored(a, b);
  const lineage = {...(ignoredUnverified.length ? {ignoredUnverified} : {}), maxVersion, maxTimestamp: Date.parse(a.maxTimestamp) > Date.parse(b.maxTimestamp) ? a.maxTimestamp : b.maxTimestamp,
    revisionKeys: sorted([...(a.maxVersion === maxVersion ? a.revisionKeys : []), ...(b.maxVersion === maxVersion ? b.revisionKeys : [])]).filter(Boolean)};
  // Only two distinct fingerprints are necessary to retain the contradiction.
  if (lineage.revisionKeys.length > 2) lineage.revisionKeys = [lineage.revisionKeys[0], lineage.revisionKeys.at(-1)];
  if (a.snapshot !== b.snapshot) return {...(Date.parse(a.snapshot) > Date.parse(b.snapshot) ? a : b), ...lineage};
  const topologyA = JSON.stringify([a.version, a.timestamp, a.nodes]), topologyB = JSON.stringify([b.version, b.timestamp, b.nodes]);
  const topologyConflict = a.topologyConflict || b.topologyConflict || topologyA !== topologyB;
  const selected = topologyA <= topologyB ? a : b;
  return {...selected, ...lineage, topologyConflict, malformed: a.malformed || b.malformed,
    ...([a.malformedSlots, b.malformedSlots].some(Boolean) ? {malformedSlots: [a.malformedSlots, b.malformedSlots].filter(Boolean).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))[0]} : {}),
    slots: topologyConflict ? selected.nodes.map(() => null) : consistentSlots(a.nodes, a.slots.map((point, i) => {
      const other = b.slots[i];
      // false is a persistent disputed slot; a duplicate must not heal it.
      if (point === false || other === false) return false;
      if (!point) return other;
      if (!other) return point;
      return point[0] === other[0] && point[1] === other[1] ? point : false;
    })), sources: refs([...(a.sources || []), ...(b.sources || [])])};
}
export function geometryLines(evidence) {
  if (!evidence) return [];
  if (!evidence.snapshot) return evidence.conflict ? evidence.fallbackLines || [] : evidence.lines || [];
  if (evidence.topologyConflict || evidence.version < evidence.maxVersion || Date.parse(evidence.timestamp) < Date.parse(evidence.maxTimestamp) || evidence.revisionKeys.length > 1) return [];
  return linesOf(evidence.slots);
}
export function geometryStatus(evidence) {
  const lines = geometryLines(evidence), reasons = [];
  if (!evidence?.snapshot) {
    reasons.push(...(evidence?.reasons || ['legacy']));
    if (evidence?.fallbackLines?.length) reasons.push('retained_legacy_fallback');
    if (evidence?.malformed) reasons.push('unaligned_geometry');
    if (evidence?.raw?.slots.some(point => !point)) reasons.push('missing_positions');
  }
  else {
    if (evidence.topologyConflict) reasons.push('topology_conflict');
    if (evidence.version < evidence.maxVersion || Date.parse(evidence.timestamp) < Date.parse(evidence.maxTimestamp)) reasons.push('revision_regression');
    if (evidence.revisionKeys.length > 1) reasons.push('revision_topology_conflict');
    if (evidence.slots.includes(false)) reasons.push('coordinate_conflict');
    if (evidence.malformed) reasons.push('unaligned_geometry');
    if (evidence.slots.some(point => !point)) reasons.push('missing_positions');
  }
  const incomplete = reasons.length > 0;
  if (evidence?.ignoredUnverified?.length) reasons.push('ignored_unverified_source');
  const conflict = Boolean(evidence?.conflict || reasons.some(reason => /conflict|regression/.test(reason)));
  return {status: conflict ? 'conflict' : !evidence?.snapshot ? 'unknown' : incomplete ? 'partial' : 'complete',
    drawable: lines.length > 0, ...(evidence?.ignoredUnverified?.length ? {ignoredUnverified: evidence.ignoredUnverified} : {}), snapshot: evidence?.snapshot || null, version: evidence?.version || null,
    expected: (evidence?.nodes || evidence?.raw?.nodes)?.length ?? null, missing: (evidence?.slots || evidence?.raw?.slots)?.flatMap((p, i) => p ? [] : [i]) || [], reasons: sorted(reasons)};
}
