"""Bounded, opt-in identity evidence. Never decides an OSM match or frequency.

This derived sidecar is for controlled offline review, not public feed hosting.
Record limits are independent of the compiler's existing GTFS input budgets.
"""
import hashlib
import json
import math

LIMITS = {
    'bytes': 16 * 1024 * 1024,
    'routes': 10000,
    'patterns': 10000,
    'observations': 100000,
    'stops': 50000,
    'pattern_stops': 512,
    'frequency_intervals': 128,
    'service_days': 367,
    'string_bytes': 1024,
    'source_ids': 100000,
    'source_id_bytes': 4 * 1024 * 1024,
    'offset_seconds': 366 * 86400,
    'safe_integer': 2 ** 53 - 1,
}


class EvidenceUnavailable(ValueError):
    pass


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode('utf-8')


def fingerprint(value):
    return hashlib.sha256(encoded(value)).hexdigest()


def text(value, optional=False):
    if optional and (value is None or value == ''):
        return None
    if not isinstance(value, str) or not value or len(value.encode('utf-8')) > LIMITS['string_bytes']:
        raise EvidenceUnavailable('invalid_or_oversized_string')
    return value


def unavailable(reason):
    # No partially retained records can accidentally become matchable.
    return {'schema': 1, 'status': 'incomplete', 'reasons': [reason],
            'limits': dict(LIMITS), 'patterns': [], 'observations': [], 'stops': []}


def capture_identity(routes, trips):
    """Capture original IDs before the display compiler consolidates routes."""
    if len(routes) > LIMITS['routes'] or len(trips) > LIMITS['observations']:
        return None
    return routes, {key: trip['route_id'] for key, trip in trips.items()}


def build_evidence(source, identity, trips, times, stops, frequencies, active,
                   agencies, seconds, identity_audit_reason=None):
    if identity_audit_reason:
        return unavailable(identity_audit_reason)
    if identity is None:
        return unavailable('identity_record_limit')
    original_routes, route_ids = identity
    patterns, observations, retained_stops = {}, [], {}
    # Reserve envelope space before adding records, including their commas.
    budget = 4096

    def retain(collection, key, record, limit):
        nonlocal budget
        if key is not None and key in collection:
            return
        if len(collection) >= LIMITS[limit]:
            raise EvidenceUnavailable(limit + '_limit')
        size = len(encoded(record)) + 1
        if budget + size > LIMITS['bytes']:
            raise EvidenceUnavailable('byte_limit')
        budget += size
        if key is None:
            collection.append(record)
        else:
            collection[key] = record

    def retain_stop(stop_id):
        if stop_id in retained_stops:
            return retained_stops[stop_id]
        row = stops.get(stop_id)
        if row is None:
            raise EvidenceUnavailable('missing_stop')
        parent = text(row.get('parent_station', '').strip(), optional=True)
        try:
            lat, lon = float(row.get('stop_lat', '')), float(row.get('stop_lon', ''))
        except (TypeError, ValueError):
            raise EvidenceUnavailable('invalid_stop_location') from None
        if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
            raise EvidenceUnavailable('invalid_stop_location')
        record = {'id': text(stop_id), 'parent_station': parent,
                  'name': text(row.get('stop_name'), optional=True), 'lat': lat, 'lon': lon}
        retain(retained_stops, stop_id, record, 'stops')
        return record

    try:
        feed_id = text(source.get('id'))
        digest = text(source.get('sha256'))
        if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise EvidenceUnavailable('invalid_source_fingerprint')
        if len(active) > LIMITS['service_days']:
            raise EvidenceUnavailable('service_days_limit')
        for trip_id in sorted(trips):
            trip = trips[trip_id]
            route_id = route_ids[trip_id]
            route = original_routes[route_id]
            agency_id = route.get('agency_id') or (next(iter(agencies)) if len(agencies) == 1 else None)
            text(agency_id)
            sequence = times.get(trip_id, [])
            if not 2 <= len(sequence) <= LIMITS['pattern_stops']:
                raise EvidenceUnavailable('invalid_or_oversized_stop_sequence')
            sequence = sorted(sequence, key=lambda row: int(row['stop_sequence']))
            if len({int(row['stop_sequence']) for row in sequence}) != len(sequence) or any(int(row['stop_sequence']) < 0 for row in sequence):
                raise EvidenceUnavailable('duplicate_stop_sequence')
            calls = []
            for row in sequence:
                stop_id = row['stop_id']
                stop = retain_stop(stop_id)
                parent = stop['parent_station']
                if parent:
                    station = retain_stop(parent)
                    if station['parent_station']:
                        raise EvidenceUnavailable('nested_parent_station')
                pickup = row.get('pickup_type') or '0'
                drop_off = row.get('drop_off_type') or '0'
                if pickup not in ('0', '1', '2', '3') or drop_off not in ('0', '1', '2', '3'):
                    raise EvidenceUnavailable('invalid_stop_access')
                calls.append({'stop_id': text(stop_id), 'station_id': parent or stop_id,
                              'pickup_type': pickup, 'drop_off_type': drop_off})
            direction = text(trip.get('direction_id'), optional=True)
            if direction not in (None, '0', '1'):
                raise EvidenceUnavailable('invalid_direction_id')
            pattern = {'source_route_id': text(route_id), 'compiled_route_id': text(trip['route_id']),
                       'agency_id': agency_id, 'route_ref': text(route.get('route_short_name'), optional=True),
                       'direction_id': direction, 'shape_id': text(trip.get('shape_id'), optional=True), 'calls': calls}
            pattern_id = fingerprint([feed_id, digest, pattern])
            retain(patterns, pattern_id, {'id': pattern_id, **pattern}, 'patterns')
            intervals = frequencies.get(trip_id, [])
            if len(intervals) > LIMITS['frequency_intervals']:
                raise EvidenceUnavailable('frequency_intervals_limit')
            departures = [seconds(row.get('departure_time')) for row in sequence]
            known = [value for value in departures if value is not None]
            if any(not 0 <= value <= LIMITS['offset_seconds'] for value in known):
                raise EvidenceUnavailable('unsupported_numeric_evidence')
            if any(b < a for a, b in zip(known, known[1:])):
                raise EvidenceUnavailable('nonmonotonic_departures')
            frequency_rows = [{'start': seconds(row.get('start_time')), 'end': seconds(row.get('end_time')),
                               'headway_secs': int(row['headway_secs']), 'exact_times': row.get('exact_times') or '0'}
                              for row in intervals]
            for index, interval in enumerate(frequency_rows):
                if any(value is not None and not 0 <= value <= LIMITS['offset_seconds'] for value in [interval['start'], interval['end']]) or not 0 < interval['headway_secs'] <= LIMITS['safe_integer']:
                    raise EvidenceUnavailable('unsupported_numeric_evidence')
                if interval['start'] is None or interval['end'] is None or interval['end'] <= interval['start'] or interval['headway_secs'] <= 0 or interval['exact_times'] not in ('0', '1'):
                    raise EvidenceUnavailable('invalid_frequency_interval')
                if any(interval['start'] < other['end'] and interval['end'] > other['start'] for other in frequency_rows[:index]):
                    raise EvidenceUnavailable('overlapping_frequency_intervals')
            dates = sorted(day.isoformat() for day, ids in active.items() if trip['service_id'] in ids)
            observation = {'id': fingerprint([feed_id, digest, text(trip_id)]), 'trip_id': trip_id,
                           'service_id': text(trip['service_id']), 'pattern_id': pattern_id,
                           'timezone': text(agencies[agency_id]['agency_timezone']),
                           'valid_until': trip['_calendar_until'],
                           'calendar_state': 'expired' if trip['_calendar_expired'] else 'future' if trip['_calendar_future'] else 'current',
                           'active_service_dates': dates, 'departures': departures, 'frequencies': frequency_rows}
            observation['fingerprint'] = fingerprint([feed_id, digest, source['service_date'], observation])
            retain(observations, None, observation, 'observations')
        result = {'schema': 1, 'status': 'captured', 'reasons': [], 'limits': dict(LIMITS),
                  'source': {'feed_id': feed_id, 'sha256': digest, 'service_date': source['service_date'],
                             'valid_until': source['valid_until']},
                  'patterns': list(patterns.values()), 'observations': observations, 'stops': list(retained_stops.values())}
        # The reserved envelope must remain a hard contract if fields change.
        if len(encoded(result)) > LIMITS['bytes']:
            raise EvidenceUnavailable('byte_limit')
        return result
    except EvidenceUnavailable as error:
        return unavailable(str(error))
    except (KeyError, TypeError, ValueError, OverflowError):
        # Raw provider values and exception text are not diagnostics to publish.
        return unavailable('invalid_identity_evidence')
