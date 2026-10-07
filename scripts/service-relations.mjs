// A relation declaration is a source snapshot, not a bag of memberships.
// Keep returned railway eligibility separate: a declared, unreturned member
// never becomes drawable just because some other route has its geometry.
import {createHash} from 'node:crypto';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const time = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().replace(/\.000Z$/, 'Z') : null;
const unique = values => [...new Set(values)].sort();
const refs = values => [...new Map(values.map(value => [JSON.stringify(value), value])).entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, 8).map(([, value]) => value);
const tagsOf = tags => Object.fromEntries(Object.entries(tags || {}).filter(([key]) => /^(type|route|service|ref|name|name:[^:]+|colour|network|operator)$/.test(key)).sort(([a], [b]) => a.localeCompare(b)));
export const trackMember = member => member.type === 'way' && typeof member.role === 'string' && !/platform|stop/.test(member.role);
const declarationKey = evidence => hash([evidence.version, evidence.timestamp, evidence.tags, evidence.members]);
export function observeRelation(el, json, source, view, returnedWays) {
  const sourceSnapshot = time(json.osm3s?.timestamp_osm_base), timestamp = time(el.timestamp);
  const version = Number.isSafeInteger(el.version) && el.version > 0 ? el.version : null;
  // Production uses un-clipped `out meta`, separately from way geometry.
  // Missing ref/type (e.g. geometry-only/clipped member shapes), malformed
  // lists and explicitly partial callers cannot establish negative evidence.
  const complete = source.relationMembersComplete !== false && Array.isArray(el.members) && el.members.every(m =>
    m && ['way', 'node', 'relation'].includes(m.type) && Number.isSafeInteger(m.ref) && m.ref > 0 && typeof m.role === 'string');
  const members = Array.isArray(el.members) ? el.members.filter(m => m && ['way', 'node', 'relation'].includes(m.type) && Number.isSafeInteger(m.ref) && m.ref > 0)
    .map(m => ({type: m.type, ref: m.ref, role: typeof m.role === 'string' ? m.role : null})) : null;
  const tags = tagsOf(el.tags), snapshot = sourceSnapshot && timestamp && version && complete && Date.parse(timestamp) <= Date.parse(sourceSnapshot) ? sourceSnapshot : null;
  const eligible = [...new Set((members || []).filter(m => trackMember(m) && returnedWays.has(m.ref)).map(m => m.ref))].sort((a, b) => a - b);
  const fingerprint = hash([tags, members, complete]);
  const reference = {observation: hash([sourceSnapshot, version, timestamp, fingerprint, eligible]), dataset: 'openstreetmap',
    ...Object.fromEntries(['endpoint', 'acquired', 'stage', 'pass', 'query'].filter(key => source[key] != null).map(key => [key, source[key]]))};
  const evidence = {schema: 1, snapshot, sourceSnapshot, version, timestamp, complete, tags, members, eligible, fingerprint, view, sources: [reference], conflict: false};
  return snapshot ? {...evidence, maxVersion: version, maxTimestamp: timestamp, revisionKeys: [declarationKey(evidence)]} : evidence;
}
export function legacyRelation(view, eligible) {
  return {schema: 1, snapshot: null, sourceSnapshot: null, version: null, timestamp: null, complete: false,
    tags: null, members: null, eligible: [...new Set(eligible)].sort((a, b) => a - b), fingerprint: hash(view), view, sources: [], conflict: false, legacy: true};
}
export function reconcileRelations(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (!a.snapshot || !b.snapshot) {
    if (a.snapshot || b.snapshot) {
      const known = a.snapshot ? a : b, unknown = a.snapshot ? b : a;
      const ignoredUnverified = refs([...(a.ignoredUnverified || []), ...(b.ignoredUnverified || []), ...unknown.sources]);
      return {...known, ...(ignoredUnverified.length ? {ignoredUnverified} : {})};
    }
    const key = item => JSON.stringify([item.view, item.fingerprint, item.sourceSnapshot, item.version, item.timestamp]);
    const selected = key(a) <= key(b) ? a : b;
    const conflict = a.conflict || b.conflict || a.fingerprint !== b.fingerprint;
    return {...selected, conflict, eligible: [...new Set([...a.eligible, ...b.eligible])].sort((a, b) => a - b), sources: refs([...a.sources, ...b.sources])};
  }
  const maxVersion = Math.max(a.maxVersion, b.maxVersion), revisionKeys = unique([...(a.maxVersion === maxVersion ? a.revisionKeys : []), ...(b.maxVersion === maxVersion ? b.revisionKeys : [])]);
  const lineage = {maxVersion, maxTimestamp: Date.parse(a.maxTimestamp) > Date.parse(b.maxTimestamp) ? a.maxTimestamp : b.maxTimestamp,
    revisionKeys: revisionKeys.length > 2 ? [revisionKeys[0], revisionKeys.at(-1)] : revisionKeys};
  const ignored = refs([...(a.ignoredUnverified || []), ...(b.ignoredUnverified || [])]);
  if (ignored.length) lineage.ignoredUnverified = ignored;
  if (a.snapshot !== b.snapshot) return {...(Date.parse(a.snapshot) > Date.parse(b.snapshot) ? a : b), ...lineage};
  const conflict = a.conflict || b.conflict || declarationKey(a) !== declarationKey(b);
  const selected = declarationKey(a) <= declarationKey(b) ? a : b;
  return {...selected, ...lineage, conflict, eligible: [...new Set([...a.eligible, ...b.eligible])].sort((a, b) => a - b), sources: refs([...a.sources, ...b.sources])};
}
const statusCache = new WeakMap(), eligibilityCache = new WeakMap();
export function relationStatus(evidence) {
  if (evidence && statusCache.has(evidence)) return statusCache.get(evidence);
  if (!evidence) return {status: 'unknown', snapshot: null, version: null, reasons: ['legacy'], unresolved: []};
  const reasons = [];
  if (!evidence.snapshot) reasons.push(evidence.legacy ? 'retained_legacy_relation' : 'unverified_relation');
  if (!evidence.complete) reasons.push('incomplete_member_declaration');
  if (evidence.conflict) reasons.push('relation_declaration_conflict');
  if (evidence.snapshot && (evidence.version < evidence.maxVersion || Date.parse(evidence.timestamp) < Date.parse(evidence.maxTimestamp))) reasons.push('relation_revision_regression');
  if (evidence.revisionKeys?.length > 1) reasons.push('relation_revision_conflict');
  if (evidence.ignoredUnverified?.length) reasons.push('ignored_unverified_relation');
  const eligible = new Set(evidence.eligible), unresolved = [...new Set((evidence.members || []).filter(m => trackMember(m) && !eligible.has(m.ref)).map(m => m.ref))].sort((a, b) => a - b);
  if (unresolved.length) reasons.push('unresolved_member_eligibility');
  const status = {status: reasons.some(reason => /conflict|regression/.test(reason)) ? 'conflict' : !evidence.snapshot ? 'unknown' : unresolved.length ? 'partial' : 'complete',
    snapshot: evidence.snapshot, version: evidence.version, complete: evidence.complete, reasons, unresolved};
  statusCache.set(evidence, status); eligibilityCache.set(evidence, eligible);
  return status;
}
// Declaration completeness is distinct from whether retained table rows still
// support its positively observed memberships after another stage retires.
export function relationCoverage(evidence, key, ways, stage) {
  const status = relationStatus(evidence);
  const unavailableMemberships = !ways || !evidence || evidence.view.active === false ? [] : evidence.eligible.filter(id => {
    const way = ways.get(id);
    const parts = stage ? [way?.next?.[stage] || []] : [...Object.values(way?.routes || {}), ...Object.values(way?.next || {})];
    return !parts.some(keys => keys.includes(key));
  });
  return {...status, unavailableMemberships, status: unavailableMemberships.length && status.status === 'complete' ? 'partial' : status.status,
    reasons: [...status.reasons, ...(unavailableMemberships.length ? ['retained_membership_unavailable'] : [])]};
}
// Accepted watermarks survive removal of a stage while another holds the
// relation. Pending work is visible only before any accepted declaration.
const frontierCache = new WeakMap();
function frontier(route, parts) {
  const inputs = Object.values(parts || {}).map(part => part.membership).filter(Boolean), cached = frontierCache.get(route);
  if (cached && cached.inputs.length === inputs.length && inputs.every((input, i) => input === cached.inputs[i])) return cached.result;
  const result = inputs.reduce(reconcileRelations, null);
  frontierCache.set(route, {inputs, result});
  return result;
}
export function acceptedRelation(route) {
  return route.evidence || frontier(route, route.stages);
}
export function drawnRelation(route) {
  if (Object.keys(route.stages || {}).length || route.evidence) return acceptedRelation(route);
  return frontier(route, route.next);
}
export function mergeRelationParts(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (!a.membership && !b.membership) return b.relation < a.relation || (b.relation === a.relation && JSON.stringify(b) < JSON.stringify(a)) ? b : a;
  const membership = reconcileRelations(a.membership, b.membership);
  return {...membership.view, membership};
}
export function relationAllows(route, wayId, acceptedMembership = true) {
  const evidence = drawnRelation(route);
  if (!evidence) return !Object.keys(route.stages || {}).length || acceptedMembership;
  const status = relationStatus(evidence);
  return evidence.view.active !== false && status.status !== 'conflict' && eligibilityCache.get(evidence).has(wayId);
}
export function relationSummary(routes, ways) {
  const conflicts = [], unknown = [], unresolved = [], unavailable = [], pending = [], details = [];
  for (const route of [...routes.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const evidence = drawnRelation(route), status = relationCoverage(evidence, route.key, ways);
    const candidate = Object.values(route.next || {}).map(part => part.membership).filter(Boolean).reduce(reconcileRelations, null);
    const relation = evidence?.view.relation ?? Object.values(route.stages)[0]?.relation ?? Object.values(route.next)[0]?.relation;
    if (status.status === 'conflict') conflicts.push(relation);
    if (status.status === 'unknown') unknown.push(relation);
    if (status.unresolved.length) unresolved.push(relation);
    if (status.unavailableMemberships.length) unavailable.push(relation);
    if (candidate && JSON.stringify(candidate) !== JSON.stringify(evidence)) pending.push(relation);
    if ((status.status !== 'complete' || status.reasons.length || pending.at(-1) === relation) && details.length < 100) details.push({relation, ...status,
      unresolved: status.unresolved.slice(0, 20), unresolvedCount: status.unresolved.length, unavailableMemberships: status.unavailableMemberships.slice(0, 20), unavailableMembershipCount: status.unavailableMemberships.length, sources: evidence?.sources || [],
      ...(candidate ? {retainedAccepted: Boolean(route.evidence || Object.keys(route.stages).length), pending: {...relationStatus(candidate), unresolved: relationStatus(candidate).unresolved.slice(0, 20), unresolvedCount: relationStatus(candidate).unresolved.length}} : {})});
  }
  const sorted = values => values.sort((a, b) => a - b);
  return {schema: 1, relationsWithConflicts: sorted(conflicts), relationsWithUnknownProvenance: sorted(unknown),
    relationsWithUnresolvedMembers: sorted(unresolved), relationsWithUnavailableMemberships: sorted(unavailable), relationsWithPendingEvidence: sorted(pending), details};
}
