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
    return number in (0, 1, 2) or 100 <= number < 200 or 400 <= number < 500 or 900 <= number < 1000


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


def compile_feed(path, config, date):
    date = dt.date.fromisoformat(date)
    previous = date - dt.timedelta(days=1)
    z = zipfile.ZipFile(path)
    feed = list(read(z, "feed_info.txt"))
    if feed:
        lo, hi = feed[0].get("feed_start_date"), feed[0].get("feed_end_date")
        if (lo and date.strftime("%Y%m%d") < lo) or (hi and date.strftime("%Y%m%d") > hi):
            raise ValueError("Selected date is outside the feed's validity")
    agencies = {r["agency_id"]: r for r in read(z, "agency.txt")}
    if not agencies:
        raise ValueError("Missing agency metadata")
    routes = {r["route_id"]: r for r in read(z, "routes.txt") if rail_type(r["route_type"])}
    trips = {r["trip_id"]: r for r in read(z, "trips.txt") if r["route_id"] in routes}
    stops = {r["stop_id"]: r for r in read(z, "stops.txt")}
    calendar = {r["service_id"]: r for r in read(z, "calendar.txt")}
    exceptions = list(read(z, "calendar_dates.txt"))
    if not calendar and not exceptions:
        raise ValueError("No service calendar")
    known_services = set(calendar) | {r["service_id"] for r in exceptions}
    if any(t["service_id"] not in known_services for t in trips.values()):
        raise ValueError("Trip references an absent service calendar")

    active = {}
    days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    for day in (previous, date):
        value = day.strftime("%Y%m%d")
        ids = {key for key, row in calendar.items() if row["start_date"] <= value <= row["end_date"] and row[days[day.weekday()]] == "1"}
        for row in exceptions:
            if row["date"] == value:
                if row["exception_type"] == "1":
                    ids.add(row["service_id"])
                elif row["exception_type"] == "2":
                    ids.discard(row["service_id"])
                else:
                    raise ValueError("Invalid calendar exception")
        active[day] = ids

    times = defaultdict(list)
    # Stream the full table; retain rail trips only, not the bus timetable.
    for row in read(z, "stop_times.txt"):
        if row["trip_id"] in trips:
            times[row["trip_id"]].append(row)
    frequencies = defaultdict(list)
    for row in read(z, "frequencies.txt"):
        if row["trip_id"] in trips:
            frequencies[row["trip_id"]].append(row)
    segments = {}
    boundaries = {}

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
        if len(sequence) < 2 or len({r["stop_sequence"] for r in sequence}) != len(sequence):
            raise ValueError("Missing or duplicate rail stop sequence")
        first = seconds(sequence[0].get("departure_time"))
        seen = set()
        for upstream, downstream in zip(sequence, sequence[1:]):
            a, b = station(upstream["stop_id"]), station(downstream["stop_id"])
            if a == b:
                continue
            lo, hi = sorted((a, b))
            direction = 0 if a == lo else 1
            key = (route_id, lo, hi)
            if (key, direction) in seen:
                continue
            seen.add((key, direction))
            segment = segments.setdefault(key, {"route_id": route_id, "agency_id": agency_id,
                     "stops": [lo, hi], "expected_directions": set(),
                     "counts": {p: [0.0, 0.0] for p in windows},
                     "unknown": {p: [False, False] for p in windows},
                     "estimated": {p: False for p in windows}})
            segment["expected_directions"].add(direction)
            departure = seconds(upstream.get("departure_time"))
            for day in (previous, date):
                if trip["service_id"] not in active[day]:
                    continue
                origin = service_start(day, timezone)
                if departure is None or (frequencies[trip_id] and first is None):
                    for profile in windows:
                        segment["unknown"][profile][direction] = True
                    continue
                if not frequencies[trip_id]:
                    timestamp = origin + departure
                    for profile, (start, end) in windows.items():
                        if start <= timestamp < end:
                            segment["counts"][profile][direction] += 1
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
                                    segment["counts"][profile][direction] += 1
                    else:
                        for profile, (begin, finish) in windows.items():
                            overlap = max(0, min(finish, origin + end + anchor) - max(begin, origin + start + anchor))
                            if overlap:
                                segment["counts"][profile][direction] += overlap / headway
                                segment["estimated"][profile] = True

    output = []
    for key, segment in sorted(segments.items()):
        profiles = {}
        for profile, (start, end) in boundaries[segment["agency_id"]].items():
            rates = [None if d not in segment["expected_directions"] or segment["unknown"][profile][d] else round(segment["counts"][profile][d] * 3600 / (end-start), 6) for d in (0, 1)]
            required = [rates[d] for d in segment["expected_directions"]]
            display = None if None in required else min(required)
            profiles[profile] = {"forward_tph": rates[0], "backward_tph": rates[1], "display_tph": display,
                                 "quality": "unknown" if display is None else "headway_estimate" if segment["estimated"][profile] else "scheduled"}
        output.append({"route_id": segment["route_id"], "agency_id": segment["agency_id"], "stops": segment["stops"],
                       "expected_directions": sorted(segment["expected_directions"]), "profiles": profiles})
    digest = hashlib.sha256()
    with Path(path).open("rb") as file:
        while chunk := file.read(1_048_576):
            digest.update(chunk)
    source = {**config["source"], "sha256": digest.hexdigest(), "feed_info": feed[0] if feed else {},
              "service_date": date.isoformat(), "day_type": days[date.weekday()], "osm_matching": "pending"}
    return {"schema": 1, "source": source, "profiles": config["profiles"],
            "agencies": list(agencies.values()), "routes": [routes[key] for key in sorted(routes)],
            "stops": [{"id": key, "name": stops[key]["stop_name"], "lat": float(stops[key]["stop_lat"]), "lon": float(stops[key]["stop_lon"])} for key in sorted({s for row in output for s in row["stops"]})],
            "segments": output}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip", type=Path)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = compile_feed(args.zip, json.loads(args.config.read_text()), args.date)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Compiled {len(result['routes'])} rail routes and {len(result['segments'])} directional stop-pair profiles for {args.date}; OSM matching remains explicit, pending.")


if __name__ == "__main__":
    main()
