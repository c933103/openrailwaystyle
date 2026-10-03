#!/usr/bin/env python3
"""Compile a licensed GTFS feed into auditable, directional segment profiles.

The output is timetable data, not an OSM match or straight-line map geometry.
Use an already downloaded ZIP; this command makes no network requests.
"""
import argparse
import csv
from collections import defaultdict
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile
from zoneinfo import ZoneInfo


def seconds(value):
    if not value:
        return None
    match = re.fullmatch(r"(\d+):([0-5]\d):([0-5]\d)", value)
    if not match:
        raise ValueError(f"Invalid GTFS time {value!r}")
    return int(match[1]) * 3600 + int(match[2]) * 60 + int(match[3])


def read(z, name):
    if name not in z.namelist():
        return []
    with z.open(name) as file:
        yield from csv.DictReader(io.TextIOWrapper(file, encoding="utf-8-sig", newline=""))


def rail_type(value):
    number = int(value)
    return number in (0, 1, 2, 5, 7, 12, 1400) or 100 <= number < 200 or 400 <= number < 500 or 900 <= number < 1000


def canonical_routes(routes, trips, times, stops):
    """Consolidate calendar/direction IDs only within a connected service.

    Agency + reference + mode + colour scopes identity. Routes in disconnected
    networks retain separate IDs even when their short names are identical.
    A shared parent station supplies the connection; names alone never do.
    """
    groups, served = defaultdict(list), defaultdict(set)
    for trip_id, trip in trips.items():
        for row in times.get(trip_id, []):
            stop = stops[row['stop_id']]
            served[trip['route_id']].add(stop.get('parent_station', '').strip() or row['stop_id'])
    for key, route in routes.items():
        label = route.get('route_short_name', '').strip() or route.get('route_long_name', '').strip() or key
        groups[(route.get('agency_id', ''), label, route['route_type'], route.get('route_color', ''))].append(key)
    aliases, out = {}, {}
    for members in groups.values():
        parent = {key: key for key in members}
        def find(key):
            while parent[key] != key:
                parent[key] = parent[parent[key]]
                key = parent[key]
            return key
        station_routes = {}
        for key in sorted(members):
            for station in served[key]:
                if station in station_routes:
                    a, b = sorted((find(key), find(station_routes[station])))
                    parent[b] = a
                station_routes[station] = key
        components = defaultdict(list)
        for key in members:
            components[find(key)].append(key)
        for component in components.values():
            ident = min(component)
            out[ident] = {**routes[ident], 'source_route_ids': sorted(component)}
            for key in component:
                aliases[key] = ident
    for trip in trips.values():
        trip['route_id'] = aliases[trip['route_id']]
    return out


def service_start(date, timezone):
    # GTFS measures service times from local noon minus twelve elapsed hours.
    return dt.datetime.combine(date, dt.time(12), timezone).timestamp() - 43200


def local_boundary(date, value, timezone):
    offset = seconds(value)
    naive = dt.datetime.combine(date, dt.time()) + dt.timedelta(seconds=offset)
    candidates = {naive.replace(tzinfo=timezone, fold=fold).timestamp() for fold in (0, 1)
                  if dt.datetime.fromtimestamp(naive.replace(tzinfo=timezone, fold=fold).timestamp(), timezone).replace(tzinfo=None) == naive}
    if len(candidates) != 1:
        raise ValueError("Reference window has an ambiguous or nonexistent DST boundary")
    return candidates.pop()


def compile_feed(path, config, date, geometry=False):
    date = dt.date.fromisoformat(date)
    z = zipfile.ZipFile(path)
    feed = list(read(z, "feed_info.txt"))
    attributions = list(read(z, 'attributions.txt'))
    if feed:
        lo, hi = feed[0].get("feed_start_date"), feed[0].get("feed_end_date")
        if (lo and date.strftime("%Y%m%d") < lo) or (hi and date.strftime("%Y%m%d") > hi):
            raise ValueError("Selected date is outside the feed's validity")
    agencies = {r.get("agency_id") or "single-agency": r for r in read(z, "agency.txt")}
    if not agencies:
        raise ValueError("Missing agency metadata")
    routes = {r["route_id"]: r for r in read(z, "routes.txt") if rail_type(r["route_type"])}
    trips = {r["trip_id"]: r for r in read(z, "trips.txt") if r["route_id"] in routes}
    stops = {r["stop_id"]: r for r in read(z, "stops.txt")}
    calendar = {r["service_id"]: r for r in read(z, "calendar.txt")}
    exceptions = list(read(z, "calendar_dates.txt"))
    if not calendar and not exceptions:
        raise ValueError("No service calendar")
    horizon=max([r['end_date'] for r in calendar.values()]+[r['date'] for r in exceptions])
    if not (feed and feed[0].get('feed_end_date')) and date.strftime('%Y%m%d')>horizon:
        raise ValueError("Selected date is beyond the declared service calendar horizon")
    known_services = set(calendar) | {r["service_id"] for r in exceptions}
    if any(t["service_id"] not in known_services for t in trips.values()):
        raise ValueError("Trip references an absent service calendar")

    days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    times = defaultdict(list)
    # Stream the full table; retain rail trips only, not the bus timetable.
    for row in read(z, "stop_times.txt"):
        if row["trip_id"] in trips:
            times[row["trip_id"]].append(row)
    frequencies = defaultdict(list)
    for row in read(z, "frequencies.txt"):
        if row["trip_id"] in trips:
            frequencies[row["trip_id"]].append(row)
    excluded = {trip_id for trip_id, sequence in times.items() if any(stops[r['stop_id']].get('platform_code') in config.get('exclude_platform_codes', []) for r in sequence)}
    trips = {key: value for key,value in trips.items() if key not in excluded}
    if config.get('canonical_routes'):
        routes = canonical_routes(routes, trips, times, stops)
    # GTFS permits hours beyond 24 (including beyond 48). Include every prior
    # service day that can contribute; one previous day is not sufficient.
    max_time = max((seconds(r.get('departure_time')) or 0 for key in trips for r in times[key]), default=0)
    for key in trips:
        sequence=sorted(times[key],key=lambda row:int(row['stop_sequence']))
        known=[seconds(row.get('departure_time')) for row in sequence if row.get('departure_time')]
        if known and sequence[0].get('departure_time'):
            anchor=max(known)-seconds(sequence[0]['departure_time'])
            max_time=max(max_time,max((seconds(r.get('end_time'))+anchor for r in frequencies[key]),default=0))
    prior_days = max(1, max_time//86400+1)
    if prior_days > 366:
        raise ValueError('Service time exceeds one-year processing budget')
    service_days = [date-dt.timedelta(days=i) for i in range(prior_days+1)]
    active = {}
    for day in service_days:
        value = day.strftime('%Y%m%d')
        ids = {key for key, row in calendar.items() if row['start_date'] <= value <= row['end_date'] and row[days[day.weekday()]] == '1'}
        for row in exceptions:
            if row['date'] == value:
                if row['exception_type'] == '1':
                    ids.add(row['service_id'])
                elif row['exception_type'] == '2':
                    ids.discard(row['service_id'])
                else:
                    raise ValueError('Invalid calendar exception')
        active[day] = ids
    paths = None
    if geometry:
        import importlib.util
        spec = importlib.util.spec_from_file_location("gtfs_shapes", Path(__file__).with_name("gtfs-shapes.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        paths = module.ShapePaths(read(z, "shapes.txt"), trips, times, stops,
                                  {**config, 'rail_route_types': {key: value['route_type'] for key, value in routes.items()}})
    segments = {}
    boundaries = {}
    invalid_sequences, invalid_active = 0, set()

    def station(stop_id):
        if stop_id not in stops:
            raise ValueError("Trip references an absent stop")
        # HSL uses a space in otherwise empty parent_station fields.
        parent = stops[stop_id].get("parent_station", "").strip()
        if parent and parent not in stops:
            raise ValueError("Stop references an absent parent station")
        return parent or stop_id

    for trip_id, trip in sorted(trips.items()):
        route_id = trip["route_id"]
        route = routes[route_id]
        agency_id = route.get("agency_id") or (next(iter(agencies)) if len(agencies) == 1 else None)
        if agency_id not in agencies:
            raise ValueError("Ambiguous route agency")
        timezone = ZoneInfo(agencies[agency_id]["agency_timezone"])
        windows = boundaries.setdefault(agency_id, {key: (local_boundary(date, p["start"], timezone), local_boundary(date, p["end"], timezone)) for key, p in config["profiles"].items()})
        if any(end <= start for start, end in windows.values()):
            raise ValueError("Reference windows must have positive duration")
        sequence = sorted(times.get(trip_id, []), key=lambda row: int(row["stop_sequence"]))
        known_times=[seconds(row.get('departure_time')) for row in sequence if row.get('departure_time')]
        if len(sequence) < 2 or len({r["stop_sequence"] for r in sequence}) != len(sequence) or any(b<a for a,b in zip(known_times,known_times[1:])):
            invalid_sequences += 1
            if any(trip['service_id'] in ids for ids in active.values()):
                invalid_active.add(route_id)
            continue
        first = seconds(sequence[0].get("departure_time"))
        contributions = {}

        def contribution(departure):
            if departure in contributions:
                return contributions[departure]
            counts = {p: 0.0 for p in windows}
            unknown, estimated = set(), set()
            for day in service_days:
                if trip["service_id"] not in active[day]:
                    continue
                origin = service_start(day, timezone)
                if departure is None or (frequencies[trip_id] and first is None):
                    unknown.update(windows)
                    continue
                if not frequencies[trip_id]:
                    timestamp = origin + departure
                    for profile, (start, end) in windows.items():
                        if start <= timestamp < end:
                            counts[profile] += 1
                    continue
                held = []
                for frequency in frequencies[trip_id]:
                    start, end = seconds(frequency["start_time"]), seconds(frequency["end_time"])
                    headway = int(frequency["headway_secs"])
                    exact = frequency.get("exact_times") or "0"
                    if start is None or end is None or end <= start or headway <= 0 or exact not in ("0", "1"):
                        raise ValueError("Invalid frequency interval")
                    if any(start < other_end and end > other_start for other_start, other_end in held):
                        raise ValueError("Overlapping frequency intervals")
                    held.append((start, end))
                    anchor = departure - first
                    if exact == "1":
                        for event in range(start, end, headway):
                            timestamp = origin + event + anchor
                            for profile, (begin, finish) in windows.items():
                                if begin <= timestamp < finish:
                                    counts[profile] += 1
                    else:
                        for profile, (begin, finish) in windows.items():
                            overlap = max(0, min(finish, origin + end + anchor) - max(begin, origin + start + anchor))
                            if overlap:
                                counts[profile] += overlap / headway
                                estimated.add(profile)
            contributions[departure] = counts, unknown, estimated
            return contributions[departure]

        mapped = []
        if paths:
            mapped = paths.segments(trip, sequence)
        else:
            for upstream, downstream in zip(sequence, sequence[1:]):
                a, b = station(upstream["stop_id"]), station(downstream["stop_id"])
                if a != b:
                    lo, hi = sorted((a, b))
                    mapped.append(((route_id, lo, hi), 0 if a == lo else 1, upstream, None))
        for key, direction, upstream, coordinates in mapped:
            segment = segments.setdefault(key, {"route_id": route_id, "agency_id": agency_id,
                     "geometry": coordinates, "stops": list(key[1:]), "expected_directions": set(),
                     "counts": {p: [0.0, 0.0] for p in windows},
                     "unknown": {p: [False, False] for p in windows},
                     "estimated": {p: False for p in windows}})
            segment["expected_directions"].add(direction)
            counts, unknown, estimated = contribution(seconds(upstream.get("departure_time")))
            for profile in windows:
                segment["counts"][profile][direction] += counts[profile]
                segment["unknown"][profile][direction] |= profile in unknown
                segment["estimated"][profile] |= profile in estimated

    incomplete = set(invalid_active)
    if paths:
        for trip_id,trip in trips.items():
            sequence = sorted(times[trip_id],key=lambda r:int(r['stop_sequence']))
            if paths.patterns.get(paths.pattern_key(trip,sequence)) is None and any(trip['service_id'] in ids for ids in active.values()):
                incomplete.add(trip['route_id'])
    output = []
    for key, segment in sorted(segments.items()):
        profiles = {}
        for profile, (start, end) in boundaries[segment["agency_id"]].items():
            rates = [None if d not in segment["expected_directions"] or (segment["unknown"][profile][d] or segment["route_id"] in incomplete) else round(segment["counts"][profile][d] * 3600 / (end-start), 6) for d in (0, 1)]
            required = [rates[d] for d in segment["expected_directions"]]
            display = None if None in required else min(required)
            profiles[profile] = {"forward_tph": rates[0], "backward_tph": rates[1], "display_tph": display,
                                 "quality": "unknown" if display is None else "headway_estimate" if segment["estimated"][profile] else "scheduled"}
        output.append({"route_id": segment["route_id"], "agency_id": segment["agency_id"], "stops": segment["stops"],
                       "expected_directions": sorted(segment["expected_directions"]), "profiles": profiles,
                       **({"geometry": segment["geometry"]} if geometry else {})})
    digest = hashlib.sha256()
    with Path(path).open("rb") as file:
        while chunk := file.read(1_048_576):
            digest.update(chunk)
    source = {**config["source"], "sha256": digest.hexdigest(), "feed_info": feed[0] if feed else {},
              "service_date": date.isoformat(), "day_type": days[date.weekday()], "geometry": "supplied GTFS shapes / matched published railway graph" if geometry and getattr(paths, 'rail', None) else "supplied GTFS shapes" if geometry else "unmatched stop pairs",
              "count_anchor": "departure at the preceding served stop; no inferred pass times",
              "feed_attributions": attributions,
              "geometry_audit": {"withheld_trips": dict(paths.rejected), "routes_with_incomplete_active_geometry": sorted(incomplete), "excluded_replacement_bus_trips": len(excluded), "invalid_rail_stop_sequences": invalid_sequences, "matched_railway_patterns": len(getattr(paths, 'rail_patterns', set()))} if geometry else {}}
    if feed and feed[0].get('feed_end_date'):
        end_date=dt.datetime.strptime(feed[0]['feed_end_date'],'%Y%m%d').date()+dt.timedelta(days=1)
        source['valid_until']=min(dt.datetime.combine(end_date,dt.time(),ZoneInfo(a['agency_timezone'])).timestamp() for a in agencies.values())-.001
    else:
        end_date=max([r['end_date'] for r in calendar.values()]+[r['date'] for r in exceptions])
        end_date=dt.datetime.strptime(end_date,'%Y%m%d').date()+dt.timedelta(days=1)
        source['valid_until']=min(dt.datetime.combine(end_date,dt.time(),ZoneInfo(a['agency_timezone'])).timestamp() for a in agencies.values())-.001
    result = {"schema": 1, "source": source, "profiles": config["profiles"],
            "agencies": list(agencies.values()), "routes": [routes[key] for key in sorted(routes)],
            "stops": [] if geometry else [{"id": key, "name": stops[key]["stop_name"], "lat": float(stops[key]["stop_lat"]), "lon": float(stops[key]["stop_lon"])} for key in sorted({s for row in output for s in row["stops"]})],
            "segments": output}
    if geometry and getattr(paths, 'rail_patterns', {}):
        source['geometry_license'] = 'ODbL-1.0'
        source['geometry_attribution'] = '© OpenStreetMap contributors; matched against an already published branch/metro railway snapshot'
    if geometry and config.get('include_unmapped') and incomplete:
        # Do not hold two national stop-time/graph datasets during the audit
        # pass. The mapped result and its provenance are already finalized.
        del times, frequencies, trips, stops, paths
        audit = compile_feed(path, {**config, 'include_unmapped': False}, date.isoformat(), geometry=False)
        result['unmapped_segments'] = [s for s in audit['segments'] if s['route_id'] in incomplete]
        result['unmapped_stops'] = audit['stops']
    z.close()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip", type=Path)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--geometry", action="store_true", help="Map profiles along supplied rail shapes")
    args = parser.parse_args()
    result = compile_feed(args.zip, json.loads(args.config.read_text()), args.date, geometry=args.geometry)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Compiled {len(result['routes'])} rail routes and {len(result['segments'])} profiles for {args.date}; geometry: {result['source']['geometry']}.")


if __name__ == "__main__":
    main()
