// Offline identity contract only. Nothing imports this into map assembly.
// Reviewed bindings/crosswalks are inputs, not facts inferred from equal labels.
import {createHash} from 'node:crypto';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const canonicalText = value => JSON.stringify(canonical(value));
const hashText = text => createHash('sha256').update(text).digest('hex');
const hash = value => hashText(canonicalText(value));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 && Buffer.byteLength(value) <= 1024;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const instant = value => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const memberId = member => `${member.type}:${member.ref}`;
const array = (value, max) => Array.isArray(value) && value.length <= max;
const positive = value => Number.isSafeInteger(value) && value > 0;
const result = (status, reason, extra = {}) => ({schema: 1, status, reasons: [reason], frequency_status: 'not_evaluated', ...extra});
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);


const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
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
const osmFields = ['schema', 'status', 'reasons', 'relation_id', 'version', 'timestamp', 'snapshot', 'tags', 'served_members', 'track_members', 'fingerprint'];

// Preserve OSM tags and served-member order before a display view discards
// them. This deliberately does not change service-relations' fingerprints or
// classification, and does not fetch stations or declare their equivalence.
export function captureOsmServiceEvidence(relation, snapshot) {
  const incomplete = reason => ({schema: 1, status: 'incomplete', reasons: [reason]});
  if (relation?.type !== 'relation' || !positive(relation?.id) || !positive(relation.version) || !instant(relation.timestamp) ||
      !instant(snapshot) || Date.parse(relation.timestamp) > Date.parse(snapshot)) return incomplete('unverified_revision');
  if (!array(relation.members, 10000) || relation.members.some(m => !m || !['node', 'way', 'relation'].includes(m.type) || !positive(m.ref) || typeof m.role !== 'string' || m.role.length > 64 || Buffer.byteLength(m.role) > 64)) return incomplete('incomplete_members');
  const rawTags = relation.tags || {}, selected = [];
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

// This checks a reviewed assertion's exact pins, never accepts a route_id or
// station name on its own, and never supplies a number for unavailable data.
// A verified result identifies one explicitly reviewed section/direction
// variant. It is not permission to attach an entire GTFS route's aggregate.
export function matchTimetablePattern(input = {}) {
  const {evidence, pattern_id, context, candidates, crosswalk, now} = input ?? {};
  if (!Number.isFinite(now) || !context || !id(context.feed_id) || !digest(context.source_sha256) ||
      !instant(context.osm_snapshot) || typeof context.service_date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(context.service_date) || !Number.isFinite(context.review_until)) return result('missing_evidence', 'invalid_context');
  if (Date.parse(context.osm_snapshot) / 1000 > now) return result('conflicting', 'future_osm_snapshot');
  if (evidence?.schema !== 1 || evidence.status !== 'captured' || !array(evidence.patterns, 10000) ||
      !array(evidence.observations, 100000) || !array(evidence.stops, 50000)) return result('missing_evidence', 'capture_incomplete');
  const source = evidence.source;
  if (!record(source, ['feed_id', 'sha256', 'service_date', 'valid_until'])) return result('missing_evidence', 'invalid_source_schema');
  if (!source || source.feed_id !== context.feed_id || source.sha256 !== context.source_sha256 || source.service_date !== context.service_date) return result('conflicting', 'source_context_mismatch');
  if (!Number.isFinite(source.valid_until)) return result('missing_evidence', 'missing_source_validity');
  if (context.candidate_inventory !== 'complete') return result('missing_evidence', 'incomplete_candidate_inventory');
  if (now > Math.min(source.valid_until, context.review_until)) return result('stale', 'source_expired');
  const patterns = evidence.patterns.filter(p => p?.id === pattern_id);
  if (patterns.length !== 1) return result(patterns.length ? 'conflicting' : 'missing_evidence', 'pattern_identity');
  const pattern = patterns[0];
  if (!record(pattern, patternFields) || !id(pattern.source_route_id) || !id(pattern.compiled_route_id) || !id(pattern.agency_id) || !nullableId(pattern.route_ref) || !nullableId(pattern.shape_id) || ![null, '0', '1'].includes(pattern.direction_id) || !array(pattern.calls, 512) || pattern.calls.length < 2 ||
      pattern.calls.some(call => !record(call, callFields) || !id(call.stop_id) || !id(call.station_id) || !['0', '1', '2', '3'].includes(call.pickup_type) || !['0', '1', '2', '3'].includes(call.drop_off_type))) return result('missing_evidence', 'invalid_pattern');
  const {id: ignored, ...definition} = pattern;
  if (!digest(pattern.id) || hash([source.feed_id, source.sha256, definition]) !== pattern.id) return result('conflicting', 'pattern_fingerprint_mismatch');
  const observations = evidence.observations.filter(row => row?.pattern_id === pattern_id);
  if (!observations.length) return result('missing_evidence', 'missing_observations');
  let observationBytes = 0;
  const observationIds = new Set();
  for (const observation of observations) {
    if (!record(observation, observationFields) || !digest(observation.id) || !id(observation.trip_id) || !id(observation.service_id) ||
        !id(observation.timezone) || !Number.isFinite(observation.valid_until) || !['current', 'future', 'expired'].includes(observation.calendar_state) ||
        !array(observation.active_service_dates, 367) || observation.active_service_dates.some(day => typeof day !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(day)) ||
        !array(observation.departures, 512) || observation.departures.length !== pattern.calls.length || observation.departures.some(value => value !== null && !offset(value)) ||
        !array(observation.frequencies, 128) || observation.frequencies.some(row => !record(row, ['start', 'end', 'headway_secs', 'exact_times']) || !offset(row.start) || !offset(row.end) || row.end <= row.start || !positive(row.headway_secs) || !['0', '1'].includes(row.exact_times)) ||
        !digest(observation.fingerprint)) return result('missing_evidence', 'invalid_observation_schema');
    const {fingerprint, ...definition} = observation;
    const encoded = canonicalText([source.feed_id, source.sha256, source.service_date, definition]);
    observationBytes += Buffer.byteLength(encoded);
    if (observationBytes > 16 * 1024 * 1024) return result('missing_evidence', 'observation_work_limit');
    if (observationIds.has(observation.id) || observation.id !== hash([source.feed_id, source.sha256, observation.trip_id]) || hashText(encoded) !== fingerprint) return result('conflicting', 'observation_fingerprint_mismatch');
    observationIds.add(observation.id);
  }
  if (!observations.some(row => row.calendar_state === 'current' && Number.isFinite(row.valid_until) && now <= row.valid_until)) return result(observations.every(row => row.calendar_state === 'expired' || now > row.valid_until) ? 'stale' : 'missing_evidence', 'no_current_observations');
  if (!['0', '1'].includes(pattern.direction_id)) return result('missing_evidence', 'missing_direction');
  if (!array(candidates, 256)) return result('missing_evidence', 'candidate_or_crosswalk_limit');
  if (candidates.every(candidate => candidate?.eligibility === 'excluded')) return result('no_eligible_service', 'no_eligible_identity_in_candidates');
  if (!array(crosswalk, 1024)) return result('missing_evidence', 'candidate_or_crosswalk_limit');
  const bound = row => row && row.feed_id === source.feed_id && row.source_sha256 === source.sha256;
  if (pattern.calls.some(call => ['2', '3'].includes(call.pickup_type) || ['2', '3'].includes(call.drop_off_type))) return result('missing_evidence', 'conditional_stop_service');
  const served = pattern.calls.filter(call => call.pickup_type !== '1' || call.drop_off_type !== '1');
  if (served.length < 2) return result('missing_evidence', 'insufficient_served_stops');
  const stations = [];
  for (const call of served) {
    const rows = crosswalk.filter(row => row?.feed_id === source.feed_id && row.station_id === call.station_id);
    if (rows.some(row => row.source_sha256 !== source.sha256)) return result('stale', 'station_source_mismatch');
    if (!rows.length) return result('missing_evidence', 'missing_station_crosswalk');
    if (rows.some(row => row.status === 'conflict') || new Set(rows.map(row => row.osm_station_id)).size !== 1) return result('conflicting', 'station_crosswalk_conflict');
    if (rows.some(row => row.osm_snapshot !== context.osm_snapshot)) return result('stale', 'station_snapshot_mismatch');
    if (rows.some(row => row.status !== 'verified' || !typedId(row.osm_station_id))) return result('missing_evidence', 'unverified_station_crosswalk');
    stations.push(rows[0].osm_station_id);
  }
  let matchCount = 0, selectedMatch = null, work = 0;
  const blockers = [];
  let eligible = 0;
  for (const candidate of candidates) {
    if (candidate?.eligibility === 'excluded') continue;
    if (!candidate || !array(candidate.route_bindings, 32)) { blockers.push(['missing_evidence', 'invalid_candidate']); continue; }
    const previous = candidate.route_bindings.some(row => row && row.feed_id === source.feed_id && row.route_id === pattern.source_route_id && row.source_sha256 !== source.sha256);
    if (previous && candidate.eligibility !== 'excluded') { blockers.push(['stale', 'route_binding_source_mismatch']); continue; }
    const exact = candidate.route_bindings.filter(row => bound(row) && row.route_id === pattern.source_route_id);
    const sameOperator = candidate.operator_binding?.feed_id === source.feed_id && candidate.operator_binding.agency_id === pattern.agency_id;
    const refMatches = id(pattern.route_ref) && candidate.osm?.tags?.ref === pattern.route_ref;
    const relevantOperator = sameOperator && (exact.length > 0 || refMatches);
    if (relevantOperator && candidate.operator_binding.source_sha256 !== source.sha256) { blockers.push(['stale', 'operator_binding_source_mismatch']); continue; }
    const fallback = sameOperator && refMatches && bound(candidate.operator_binding);
    if (!exact.length && !fallback) continue;
    if (candidate.eligibility !== 'eligible') { blockers.push(['missing_evidence', 'unverified_eligibility']); continue; }
    eligible++;
    if (candidate.status === 'conflict' || exact.some(row => row.status === 'conflict') || (relevantOperator && candidate.operator_binding.status === 'conflict')) { blockers.push(['conflicting', 'service_identity_conflict']); continue; }
    if (candidate.status !== 'verified' || exact.some(row => row.status !== 'verified') || (relevantOperator && candidate.operator_binding.status !== 'verified')) { blockers.push(['missing_evidence', 'unverified_service_identity']); continue; }
    const osm = candidate.osm;
    if (!record(osm, osmFields) || osm?.status !== 'captured' || !array(osm.reasons, 0) || !positive(osm.relation_id) || !positive(osm.version) || !instant(osm.timestamp) || !instant(osm.snapshot) || Date.parse(osm.timestamp) > Date.parse(osm.snapshot) || !capturedTags(osm.tags) || !digest(osm.fingerprint) || !id(candidate.service_id)) { blockers.push(['missing_evidence', 'missing_osm_declaration']); continue; }
    if (!array(osm.served_members, 512) || !array(osm.track_members, 10000) || !array(candidate.eligible_way_ids, 10000) || !array(candidate.variants, 128)) { blockers.push(['missing_evidence', 'invalid_service_sections']); continue; }
    if (osm.served_members.some(member => !record(member, ['id', 'role', 'position']) || !typedId(member.id) || typeof member.role !== 'string' || member.role.length > 64 || !Number.isSafeInteger(member.position) || member.position < 0 || member.position >= 10000) || osm.track_members.some(way => !positive(way)) || candidate.eligible_way_ids.some(way => !positive(way))) { blockers.push(['missing_evidence', 'invalid_service_members']); continue; }
    const declaration = Object.fromEntries(['relation_id', 'version', 'timestamp', 'snapshot', 'tags', 'served_members', 'track_members'].map(key => [key, osm[key]]));
    if (osm.schema !== 1 || hash(declaration) !== osm.fingerprint) { blockers.push(['conflicting', 'osm_fingerprint_mismatch']); continue; }
    if (osm.snapshot !== context.osm_snapshot) { blockers.push(['stale', 'service_snapshot_mismatch']); continue; }
    work += osm.served_members.length + osm.track_members.length + candidate.eligible_way_ids.length;
    for (const variant of candidate.variants) {
      if (!variant || !array(variant.stations, 512) || !array(variant.section_way_ids, 10000)) { blockers.push(['missing_evidence', 'invalid_variant']); continue; }
      work += variant.stations.length + variant.section_way_ids.length;
    }
    if (work > 100000) return result('missing_evidence', 'candidate_work_limit');
    const declaredStops = new Set(osm.served_members.map(m => m.id));
    const eligibleWays = new Set(candidate.eligible_way_ids), declaredWays = new Set(osm.track_members);
    const matchingVariants = candidate.variants.filter(v => v && v.direction_id === pattern.direction_id && array(v.stations, 512) && same(v.stations, stations));
    if (!matchingVariants.length) { blockers.push(['missing_evidence', 'no_verified_stop_pattern']); continue; }
    for (const variant of matchingVariants) {
      if (variant.status !== 'verified' || !id(variant.id) || !array(variant.section_way_ids, 10000) || !variant.section_way_ids.length ||
          variant.stations.some(station => !declaredStops.has(station)) ||
          variant.section_way_ids.some(way => !positive(way) || !declaredWays.has(way) || !eligibleWays.has(way))) { blockers.push(['missing_evidence', 'unverified_pattern_sections']); continue; }
      matchCount++;
      selectedMatch ??= {service_id: candidate.service_id, variant_id: variant.id, section_way_ids: variant.section_way_ids, identity_method: exact.length ? 'feed_scoped_route_id' : 'verified_operator_ref_stops'};
    }
  }
  // Never choose the first candidate, including when another plausible
  // candidate is stale, incomplete or conflicts with the same source route.
  if (blockers.length) {
    const priority = ['conflicting', 'stale', 'missing_evidence'];
    blockers.sort((a, b) => priority.indexOf(a[0]) - priority.indexOf(b[0]) || a[1].localeCompare(b[1]));
    return result(...blockers[0]);
  }
  if (matchCount > 1) return result('ambiguous', 'multiple_verified_variants');
  if (!matchCount) return candidates.some(candidate => candidate?.eligibility !== 'excluded')
    ? result('missing_evidence', eligible ? 'no_verified_variant' : 'no_verified_service_identity')
    : result('no_eligible_service', 'no_eligible_identity_in_candidates');
  return result('verified', 'reviewed_identity_and_stops', {pattern_id, ...selectedMatch, section_way_ids: [...selectedMatch.section_way_ids], source: {...source}, osm_snapshot: context.osm_snapshot});
}
