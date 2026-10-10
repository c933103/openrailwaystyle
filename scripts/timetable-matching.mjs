// Offline identity contract only. Nothing imports this into map assembly.
// Reviewed bindings/crosswalks are inputs, not facts inferred from equal labels.
import {createHash} from 'node:crypto';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const canonicalText = value => JSON.stringify(canonical(value));
const hashText = text => createHash('sha256').update(text).digest('hex');
const hash = value => hashText(canonicalText(value));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && Buffer.byteLength(value) <= 1024;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
// Existing OSM producers emit seconds or toISOString() millisecond precision.
// Higher precision is explicitly unsupported, never silently truncated.
function instant(value) {
  if (typeof value !== 'string' || value.length > 40) return false;
  const match = /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(Z|[+-](\d\d):(\d\d))$/.exec(value);
  return !!match && calendarDate(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60 && Number(match[4]) < 60 &&
    (match[5] === 'Z' || (Number(match[6]) < 24 && Number(match[7]) < 60)) && Number.isFinite(Date.parse(value));
}
const memberId = member => `${member.type}:${member.ref}`;
// Array iteration helpers skip holes. Require owned entries before any hash,
// equality or candidate selection so an in-process sparse array cannot stand
// in for absent evidence (inherited numeric properties are absent too).
function array(value, max) {
  if (!Array.isArray(value) || value.length > max) return false;
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
  return true;
}
// Negative diagnostics may use complete owned records beside holes, but only
// after checking the container's type and length cap. Density is still required
// independently for every positive path; inherited slots are never evidence.
function ownedEntries(value, max) {
  if (!Array.isArray(value) || value.length > max) return null;
  const entries = [];
  for (let index = 0; index < value.length; index++) if (Object.hasOwn(value, index)) entries.push(value[index]);
  return entries;
}
const positive = value => Number.isSafeInteger(value) && value > 0;
const result = (status, reason, extra = {}) => ({schema: 1, status, reasons: [reason], frequency_status: 'not_evaluated', ...extra});
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);


const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
// Only ordinary JSON fields can establish assertions. Unknown envelope/raw-OSM
// metadata stays unused; inherited or hidden fields never enter a selector.
const ownField = (value, key) => plain(value) && Object.prototype.propertyIsEnumerable.call(value, key);
const ownFields = (value, fields) => plain(value) && fields.every(key => Object.prototype.propertyIsEnumerable.call(value, key));
const readField = (value, key) => ownField(value, key) ? value[key] : undefined;
// Inspect only a bounded exact shape before recursive canonical hashing. Extra
// fields are not silently dropped: they may carry a newer, unsupported schema.
function record(value, fields) {
  if (!plain(value)) return false;
  let count = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key) || !fields.includes(key) || ++count > fields.length) return false;
  }
  return count === fields.length;
}
const nullableId = value => value === null || id(value);
const typedId = value => typeof value === 'string' && value.length <= 32 && /^(node|way|relation):[1-9]\d*$/.test(value) && positive(Number(value.split(':')[1]));
const identityTag = key => /^(type|route|service|name|operator|ref|network|gtfs:[\w:]+)$/.test(key);
function capturedTags(tags) {
  if (!plain(tags)) return false;
  let count = 0;
  for (const key in tags) if (!Object.hasOwn(tags, key) || ++count > 32 || !id(key) || !identityTag(key) || !id(tags[key])) return false;
  return true;
}
const patternFields = ['id', 'source_route_id', 'compiled_route_id', 'agency_id', 'route_ref', 'direction_id', 'shape_id', 'calls'];
const callFields = ['stop_id', 'station_id', 'pickup_type', 'drop_off_type'];
const observationFields = ['id', 'trip_id', 'service_id', 'pattern_id', 'timezone', 'valid_until', 'calendar_state', 'active_service_dates', 'departures', 'frequencies', 'fingerprint'];
const offset = value => Number.isSafeInteger(value) && value >= 0 && value <= 366 * 86400;
const assertionState = value => ['verified', 'conflict', 'unknown'].includes(value);
const routeBinding = row => record(row, ['feed_id', 'source_sha256', 'route_id', 'status']) && id(row.feed_id) && digest(row.source_sha256) && id(row.route_id) && assertionState(row.status);
const operatorBinding = row => record(row, ['feed_id', 'source_sha256', 'agency_id', 'status']) && id(row.feed_id) && digest(row.source_sha256) && id(row.agency_id) && assertionState(row.status);
const stationBinding = row => record(row, ['feed_id', 'source_sha256', 'station_id', 'osm_station_id', 'osm_snapshot', 'status']) && id(row.feed_id) && digest(row.source_sha256) && id(row.station_id) && typedId(row.osm_station_id) && instant(row.osm_snapshot) && assertionState(row.status);
const osmFields = ['schema', 'status', 'reasons', 'relation_id', 'version', 'timestamp', 'snapshot', 'tags', 'served_members', 'track_members', 'fingerprint'];

// Preserve OSM tags and served-member order before a display view discards
// them. This deliberately does not change service-relations' fingerprints or
// classification, and does not fetch stations or declare their equivalence.
export function captureOsmServiceEvidence(relation, snapshot) {
  const incomplete = reason => ({schema: 1, status: 'incomplete', reasons: [reason]});
  if (!ownFields(relation, ['type', 'id', 'version', 'timestamp', 'members']) || relation.type !== 'relation' || !positive(relation.id) || !positive(relation.version) || !instant(relation.timestamp) ||
      !instant(snapshot) || Date.parse(relation.timestamp) > Date.parse(snapshot)) return incomplete('unverified_revision');
  if (!array(relation.members, 10000) || relation.members.some(m => !ownFields(m, ['type', 'ref', 'role']) || !['node', 'way', 'relation'].includes(m.type) || !positive(m.ref) || typeof m.role !== 'string' || m.role.length > 64 || Buffer.byteLength(m.role) > 64)) return incomplete('incomplete_members');
  const rawTags = readField(relation, 'tags') || {}, selected = [];
  if (!plain(rawTags)) return incomplete('invalid_tags');
  let scanned = 0;
  for (const key in rawTags) {
    if (!Object.hasOwn(rawTags, key) || ++scanned > 256 || !id(key)) return incomplete('raw_tag_limit_or_invalid');
    if (!identityTag(key)) continue;
    if (selected.length >= 32 || !id(rawTags[key])) return incomplete('tag_limit_or_invalid');
    selected.push([key, rawTags[key]]);
  }
  const tags = Object.fromEntries(selected.sort(([a], [b]) => a.localeCompare(b)));
  const served_members = relation.members.flatMap((m, position) => /^(stop|platform)(_(entry|exit)_only)?$/.test(m.role) ? [{id: memberId(m), role: m.role, position}] : []);
  if (served_members.length > 512) return incomplete('served_member_limit');
  const track_members = [...new Set(relation.members.filter(m => m.type === 'way' && !/platform|stop/.test(m.role)).map(m => m.ref))];
  const declaration = {relation_id: relation.id, version: relation.version, timestamp: relation.timestamp, snapshot, tags, served_members, track_members};
  return {schema: 1, status: 'captured', reasons: [], ...declaration, fingerprint: hash(declaration)};
}

class WorkLimit extends Error {}
function workBudget(reason) {
  let bytes = 0, references = 0;
  return {
    encode(value) {
      const text = canonicalText(value);
      bytes += Buffer.byteLength(text);
      if (bytes > 16 * 1024 * 1024) throw new WorkLimit(reason);
      return text;
    },
    references(count) {
      references += count;
      if (references > 100000) throw new WorkLimit(reason);
    },
  };
}
function patternSchema(pattern) {
  return record(pattern, patternFields) && digest(pattern.id) && id(pattern.source_route_id) && id(pattern.compiled_route_id) && id(pattern.agency_id) && nullableId(pattern.route_ref) && nullableId(pattern.shape_id) && [null, '0', '1'].includes(pattern.direction_id) && array(pattern.calls, 512) && pattern.calls.length >= 2 &&
    pattern.calls.every(call => record(call, callFields) && id(call.stop_id) && id(call.station_id) && ['0', '1', '2', '3'].includes(call.pickup_type) && ['0', '1', '2', '3'].includes(call.drop_off_type));
}
function observationSchema(row, patterns) {
  return record(row, observationFields) && digest(row.id) && id(row.trip_id) && id(row.service_id) && digest(row.pattern_id) && patterns.has(row.pattern_id) && id(row.timezone) && Number.isFinite(row.valid_until) && ['current', 'future', 'expired'].includes(row.calendar_state) &&
    array(row.active_service_dates, 367) && row.active_service_dates.every(calendarDate) &&
    array(row.departures, 512) && row.departures.length === patterns.get(row.pattern_id).calls.length && row.departures.every(value => value === null || offset(value)) &&
    array(row.frequencies, 128) && row.frequencies.every(frequency => record(frequency, ['start', 'end', 'headway_secs', 'exact_times']) && offset(frequency.start) && offset(frequency.end) && frequency.end > frequency.start && positive(frequency.headway_secs) && ['0', '1'].includes(frequency.exact_times)) && digest(row.fingerprint);
}
function inspectOsm(osm, snapshot, budget) {
  if (!record(osm, osmFields) || osm.schema !== 1 || osm.status !== 'captured' || !array(osm.reasons, 0) || !positive(osm.relation_id) || !positive(osm.version) || !instant(osm.timestamp) || !instant(osm.snapshot) || Date.parse(osm.timestamp) > Date.parse(osm.snapshot) || !capturedTags(osm.tags) || !digest(osm.fingerprint)) return ['missing_evidence', 'missing_osm_declaration'];
  if (!array(osm.served_members, 512) || !array(osm.track_members, 10000)) return ['missing_evidence', 'invalid_service_sections'];
  budget.references(osm.served_members.length + osm.track_members.length);
  if (osm.served_members.some(member => !record(member, ['id', 'role', 'position']) || !typedId(member.id) || typeof member.role !== 'string' || member.role.length > 64 || Buffer.byteLength(member.role) > 64 || !Number.isSafeInteger(member.position) || member.position < 0 || member.position >= 10000) || osm.track_members.some(way => !positive(way))) return ['missing_evidence', 'invalid_service_members'];
  const declaration = Object.fromEntries(['relation_id', 'version', 'timestamp', 'snapshot', 'tags', 'served_members', 'track_members'].map(key => [key, osm[key]]));
  if (hashText(budget.encode(declaration)) !== osm.fingerprint) return ['conflicting', 'osm_fingerprint_mismatch'];
  if (osm.snapshot !== snapshot) return ['stale', 'service_snapshot_mismatch'];
  return null;
}
function variantSchema(variant, budget) {
  if (!record(variant, ['id', 'status', 'direction_id', 'stations', 'section_way_ids']) || !id(variant.id) || !assertionState(variant.status) || !['0', '1'].includes(variant.direction_id) || !array(variant.stations, 512) || variant.stations.length < 2 || !array(variant.section_way_ids, 10000) || !variant.section_way_ids.length) return false;
  budget.references(variant.stations.length + variant.section_way_ids.length);
  return variant.stations.every(typedId) && variant.section_way_ids.every(positive);
}
function candidateSchema(candidate, budget) {
  const fields = ['service_id', 'status', 'eligibility', 'osm', 'eligible_way_ids', 'route_bindings', 'variants'];
  if (ownField(candidate, 'operator_binding')) fields.push('operator_binding');
  if (!record(candidate, fields) || !id(candidate.service_id) || !assertionState(candidate.status) || !['eligible', 'unknown'].includes(candidate.eligibility) || !array(candidate.route_bindings, 32) || candidate.route_bindings.some(row => !routeBinding(row)) || (ownField(candidate, 'operator_binding') && !operatorBinding(candidate.operator_binding))) return ['missing_evidence', 'invalid_candidate'];
  if (!array(candidate.eligible_way_ids, 10000) || !array(candidate.variants, 128)) return ['missing_evidence', 'invalid_service_sections'];
  budget.references(candidate.eligible_way_ids.length);
  if (candidate.eligible_way_ids.some(way => !positive(way))) return ['missing_evidence', 'invalid_service_members'];
  for (const variant of candidate.variants) if (!variantSchema(variant, budget)) return ['missing_evidence', 'invalid_variant'];
  return null;
}
function blockerResult(blockers) {
  const priority = ['conflicting', 'stale', 'missing_evidence'];
  blockers.sort((a, b) => priority.indexOf(a[0]) - priority.indexOf(b[0]) || a[1].localeCompare(b[1]));
  return blockers.length ? result(...blockers[0]) : null;
}

// Validation phases are deliberately separate from relevance and selection.
// Reviewed assertions and content hashes establish consistency, not source truth.
export function matchTimetablePattern(input = {}) {
  try { return matchPattern(input); }
  catch (error) {
    if (error instanceof WorkLimit) return result('missing_evidence', error.message);
    throw error;
  }
}
function matchPattern(input) {
  if (!ownFields(input, ['evidence', 'pattern_id', 'context', 'candidates', 'now'])) return result('missing_evidence', 'invalid_input');
  const {evidence, pattern_id, context, candidates, now} = input;
  if (!digest(pattern_id) || !Number.isFinite(now) || !ownFields(context, ['feed_id', 'source_sha256', 'service_date', 'osm_snapshot', 'review_until', 'candidate_inventory']) || !id(context.feed_id) || !digest(context.source_sha256) || !instant(context.osm_snapshot) || !calendarDate(context.service_date) || !Number.isFinite(context.review_until)) return result('missing_evidence', 'invalid_context');
  if (Date.parse(context.osm_snapshot) / 1000 > now) return result('conflicting', 'future_osm_snapshot');
  if (!ownFields(evidence, ['schema', 'status', 'source', 'patterns', 'observations', 'stops']) || evidence.schema !== 1 || evidence.status !== 'captured' || !array(evidence.patterns, 10000) || !array(evidence.observations, 100000) || !array(evidence.stops, 50000)) return result('missing_evidence', 'capture_incomplete');
  const source = evidence.source;
  if (!record(source, ['feed_id', 'sha256', 'service_date', 'valid_until'])) return result('missing_evidence', 'invalid_source_schema');
  if (source.feed_id !== context.feed_id || source.sha256 !== context.source_sha256 || source.service_date !== context.service_date) return result('conflicting', 'source_context_mismatch');
  if (!Number.isFinite(source.valid_until)) return result('missing_evidence', 'missing_source_validity');
  if (context.candidate_inventory !== 'complete') return result('missing_evidence', 'incomplete_candidate_inventory');
  if (now > Math.min(source.valid_until, context.review_until)) return result('stale', 'source_expired');

  // Check all source content bindings before using any identity field to exclude
  // them. The single source budget covers every canonicalization/hash input.
  const sourceWork = workBudget('source_work_limit'), patterns = new Map(), observationIds = new Set(), observedPatterns = new Set(), selectedObservations = [];
  for (const pattern of evidence.patterns) {
    if (!patternSchema(pattern)) return result('missing_evidence', 'invalid_pattern');
    const {id: ignored, ...definition} = pattern;
    if (patterns.has(pattern.id) || hashText(sourceWork.encode([source.feed_id, source.sha256, definition])) !== pattern.id) return result('conflicting', 'pattern_fingerprint_mismatch');
    patterns.set(pattern.id, pattern);
  }
  for (const observation of evidence.observations) {
    if (!observationSchema(observation, patterns)) return result('missing_evidence', 'invalid_observation_schema');
    const {fingerprint, ...definition} = observation;
    if (observationIds.has(observation.id) || hashText(sourceWork.encode([source.feed_id, source.sha256, observation.trip_id])) !== observation.id || hashText(sourceWork.encode([source.feed_id, source.sha256, source.service_date, definition])) !== fingerprint) return result('conflicting', 'observation_fingerprint_mismatch');
    observationIds.add(observation.id);
    observedPatterns.add(observation.pattern_id);
    if (observation.pattern_id === pattern_id) selectedObservations.push(observation);
  }
  if (observedPatterns.size !== patterns.size) return result('missing_evidence', 'missing_observations');
  const pattern = patterns.get(pattern_id);
  if (!pattern) return result('missing_evidence', 'pattern_identity');
  if (!selectedObservations.length) return result('missing_evidence', 'missing_observations');
  if (!selectedObservations.some(row => row.calendar_state === 'current' && now <= row.valid_until)) return result(selectedObservations.every(row => row.calendar_state === 'expired' || now > row.valid_until) ? 'stale' : 'missing_evidence', 'no_current_observations');
  if (!['0', '1'].includes(pattern.direction_id)) return result('missing_evidence', 'missing_direction');
  const suppliedCandidates = ownedEntries(candidates, 256);
  if (!suppliedCandidates) return result('missing_evidence', 'candidate_or_crosswalk_limit');
  // Explicit exclusion alone needs no match-only schema. No other missing or
  // unknown field can stand in for exclusion.
  const included = suppliedCandidates.filter(candidate => readField(candidate, 'eligibility') !== 'excluded');
  const sparseCandidates = suppliedCandidates.length !== candidates.length;
  if (!included.length) return sparseCandidates ? result('missing_evidence', 'sparse_candidate_inventory') : result('no_eligible_service', 'no_eligible_identity_in_candidates');
  const crosswalk = readField(input, 'crosswalk');
  const suppliedCrosswalk = ownedEntries(crosswalk, 1024);
  if (!suppliedCrosswalk) return result('missing_evidence', 'candidate_or_crosswalk_limit');
  if (pattern.calls.some(call => ['2', '3'].includes(call.pickup_type) || ['2', '3'].includes(call.drop_off_type))) return result('missing_evidence', 'conditional_stop_service');
  const served = pattern.calls.filter(call => call.pickup_type !== '1' || call.drop_off_type !== '1');
  if (served.length < 2) return result('missing_evidence', 'insufficient_served_stops');
  const bound = row => row.feed_id === source.feed_id && row.source_sha256 === source.sha256;
  const servedIds = new Set(served.map(call => call.station_id)), blockers = [], recognizedStations = new Map();
  if (sparseCandidates) blockers.push(['missing_evidence', 'sparse_candidate_inventory']);
  if (suppliedCrosswalk.length !== crosswalk.length) blockers.push(['missing_evidence', 'sparse_station_crosswalk']);

  // Negative diagnostics from individually complete scoped records survive a
  // malformed neighbor. They never authorize positive matching of that input.
  for (const row of suppliedCrosswalk) if (stationBinding(row) && bound(row) && row.osm_snapshot === context.osm_snapshot && servedIds.has(row.station_id)) {
    if (row.status === 'conflict' || (recognizedStations.has(row.station_id) && recognizedStations.get(row.station_id) !== row.osm_station_id)) blockers.push(['conflicting', 'station_crosswalk_conflict']);
    recognizedStations.set(row.station_id, row.osm_station_id);
  }
  for (const candidate of included) {
    const routes = (ownedEntries(readField(candidate, 'route_bindings'), 32) ?? []).filter(row => routeBinding(row) && bound(row) && row.route_id === pattern.source_route_id);
    const operator = readField(candidate, 'operator_binding');
    const sameOperator = operatorBinding(operator) && bound(operator) && operator.agency_id === pattern.agency_id;
    if (routes.some(row => row.status === 'conflict') || (routes.length && (readField(candidate, 'status') === 'conflict' || (sameOperator && operator.status === 'conflict')))) blockers.push(['conflicting', 'service_identity_conflict']);
  }
  const validCrosswalk = suppliedCrosswalk.filter(stationBinding);
  if (validCrosswalk.length !== suppliedCrosswalk.length) blockers.push(['missing_evidence', 'invalid_station_binding']);
  const candidateWork = workBudget('candidate_work_limit'), prepared = [];
  candidateWork.encode(validCrosswalk);
  for (const candidate of included) {
    const schemaProblem = candidateSchema(candidate, candidateWork);
    if (schemaProblem) blockers.push(schemaProblem);
    else candidateWork.encode([candidate.service_id, candidate.status, candidate.eligibility, candidate.route_bindings, readField(candidate, 'operator_binding') ?? null, candidate.eligible_way_ids, candidate.variants]);
    const osmProblem = inspectOsm(readField(candidate, 'osm'), context.osm_snapshot, candidateWork);
    if (osmProblem) blockers.push(osmProblem);
    // An independently complete operator assertion and intact ref can still
    // identify a current conflict beside malformed match-only fields.
    const operator = readField(candidate, 'operator_binding');
    const currentFallback = !osmProblem && operatorBinding(operator) && bound(operator) && operator.agency_id === pattern.agency_id && id(pattern.route_ref) && readField(candidate.osm.tags, 'ref') === pattern.route_ref;
    if (currentFallback && (operator.status === 'conflict' || readField(candidate, 'status') === 'conflict')) blockers.push(['conflicting', 'service_identity_conflict']);
    if (schemaProblem && !osmProblem) {
      const currentExact = (ownedEntries(readField(candidate, 'route_bindings'), 32) ?? []).some(row => routeBinding(row) && bound(row) && row.route_id === pattern.source_route_id);
      if (currentExact || currentFallback) for (const variant of ownedEntries(readField(candidate, 'variants'), 128) ?? []) {
        if (variantSchema(variant, candidateWork) && variant.status === 'conflict') blockers.push(['conflicting', 'variant_identity_conflict']);
      }
    }
    if (schemaProblem || osmProblem) continue;
    const declaredStops = new Set(candidate.osm.served_members.map(member => member.id));
    const declaredWays = new Set(candidate.osm.track_members), eligibleWays = new Set(candidate.eligible_way_ids);
    let invalid = false;
    for (const variant of candidate.variants) {
      if (variant.stations.some(station => !declaredStops.has(station)) || variant.section_way_ids.some(way => !declaredWays.has(way) || !eligibleWays.has(way))) invalid = true;
    }
    if (invalid) { blockers.push(['missing_evidence', 'unverified_pattern_sections']); continue; }
    prepared.push(candidate);
  }

  // Only complete, bounded, content-checked records reach scope filtering.
  // Existing blockers are retained while other valid records contribute
  // negative diagnostics; partial inventories can never produce verification.
  const stations = [];
  if (validCrosswalk.some(row => row.feed_id === source.feed_id && !bound(row))) blockers.push(['stale', 'station_source_mismatch']);
  for (const call of served) {
    const rows = validCrosswalk.filter(row => row.feed_id === source.feed_id && row.station_id === call.station_id);
    if (!rows.length) { blockers.push(['missing_evidence', 'missing_station_crosswalk']); continue; }
    const currentRows = rows.filter(row => bound(row) && row.osm_snapshot === context.osm_snapshot);
    if (rows.some(row => row.source_sha256 !== source.sha256)) blockers.push(['stale', 'station_source_mismatch']);
    if (currentRows.some(row => row.status === 'conflict') || new Set(currentRows.map(row => row.osm_station_id)).size > 1) blockers.push(['conflicting', 'station_crosswalk_conflict']);
    if (rows.some(row => row.osm_snapshot !== context.osm_snapshot)) blockers.push(['stale', 'station_snapshot_mismatch']);
    if (currentRows.some(row => row.status !== 'verified')) blockers.push(['missing_evidence', 'unverified_station_crosswalk']);
    stations.push(currentRows[0]?.osm_station_id);
  }
  let matchCount = 0, selectedMatch = null;
  for (const candidate of prepared) {
    const exact = candidate.route_bindings.filter(row => bound(row) && row.route_id === pattern.source_route_id);
    const previous = candidate.route_bindings.some(row => row.feed_id === source.feed_id && !bound(row));
    const operator = readField(candidate, 'operator_binding');
    const sameOperator = operator?.feed_id === source.feed_id && operator.agency_id === pattern.agency_id;
    const refMatches = id(pattern.route_ref) && readField(candidate.osm.tags, 'ref') === pattern.route_ref;
    const relevantOperator = sameOperator && bound(operator) && (exact.length > 0 || refMatches);
    const fallback = sameOperator && refMatches && bound(operator);
    if (previous) blockers.push(['stale', 'route_binding_source_mismatch']);
    if (operator?.feed_id === source.feed_id && !bound(operator)) blockers.push(['stale', 'operator_binding_source_mismatch']);
    if (!exact.length && !fallback) {
      if (!candidate.route_bindings.length && !operator) blockers.push(['missing_evidence', 'missing_service_identity']);
      else if (candidate.status !== 'verified' || candidate.route_bindings.some(row => row.status !== 'verified') || (operator && operator.status !== 'verified')) blockers.push(['missing_evidence', 'unverified_service_identity']);
      continue;
    }
    if (candidate.status === 'conflict' || exact.some(row => row.status === 'conflict') || (relevantOperator && operator.status === 'conflict')) blockers.push(['conflicting', 'service_identity_conflict']);
    if (candidate.eligibility !== 'eligible' || candidate.status !== 'verified' || exact.some(row => row.status !== 'verified') || (relevantOperator && operator.status !== 'verified')) blockers.push(['missing_evidence', 'unverified_service_identity']);
    // Unreviewed direction/station assertions cannot establish irrelevance.
    if (candidate.variants.some(variant => variant.status === 'conflict')) blockers.push(['conflicting', 'variant_identity_conflict']);
    if (candidate.variants.some(variant => variant.status !== 'verified')) blockers.push(['missing_evidence', 'unverified_variant']);
    const matching = candidate.variants.filter(variant => variant.direction_id === pattern.direction_id && same(variant.stations, stations));
    if (!matching.length) blockers.push(['missing_evidence', 'no_verified_stop_pattern']);
    for (const variant of matching) {
      matchCount++;
      selectedMatch ??= {service_id: candidate.service_id, variant_id: variant.id, section_way_ids: variant.section_way_ids, identity_method: exact.length ? 'feed_scoped_route_id' : 'verified_operator_ref_stops'};
    }
  }
  if (blockers.length) return blockerResult(blockers);
  if (matchCount > 1) return result('ambiguous', 'multiple_verified_variants');
  if (!matchCount) return result('missing_evidence', 'no_verified_service_identity');
  return result('verified', 'reviewed_identity_and_stops', {pattern_id, ...selectedMatch, section_way_ids: [...selectedMatch.section_way_ids], source: {...source}, osm_snapshot: context.osm_snapshot});
}
