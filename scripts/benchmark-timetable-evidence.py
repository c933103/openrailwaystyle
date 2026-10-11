#!/usr/bin/env python3
"""Offline controlled GTFS benchmark; creates synthetic data in a temp directory."""
import argparse
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import resource
import subprocess
import sys
import tempfile
import time
import zipfile


def fixture(path, trips, calls, unique_patterns):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        def rows(name, fields, values):
            with z.open(name, 'w') as target:
                with io.TextIOWrapper(target, encoding='utf-8', newline='') as stream:
                    writer = csv.writer(stream)
                    writer.writerow(fields)
                    writer.writerows(values)
        rows('agency.txt', ['agency_id', 'agency_name', 'agency_timezone'], [('A', 'Controlled benchmark', 'Europe/Helsinki')])
        rows('routes.txt', ['route_id', 'route_type', 'agency_id', 'route_short_name'], [('R', '2', 'A', 'R')])
        rows('stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'], [(f's{i}', f'Station {i}', 60 + i * .001, 24) for i in range(calls)])
        rows('calendar.txt', ['service_id', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'start_date', 'end_date'], [('W', 1, 1, 1, 1, 1, 1, 1, '20260101', '20261231')])
        rows('trips.txt', ['trip_id', 'route_id', 'service_id', 'direction_id', 'shape_id'], ((f't{i}', 'R', 'W', str(i % 2), f'unique{i}' if unique_patterns else '') for i in range(trips)))
        rows('stop_times.txt', ['trip_id', 'stop_id', 'stop_sequence', 'departure_time'],
             ((f't{i}', f's{n if i % 2 == 0 else calls - n - 1}', n, f'{7 + n // 60:02}:{n % 60:02}:00') for i in range(trips) for n in range(calls)))


def child(args):
    spec = importlib.util.spec_from_file_location('compiler', args.compiler)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    profiles = {f'h{hour:02}': {'start': f'{hour:02}:00:00', 'end': f'{hour+1:02}:00:00'} for hour in range(24)}
    profiles.update({'am': {'start': '07:00:00', 'end': '09:00:00'}, 'pm': {'start': '16:00:00', 'end': '19:00:00'}, 'offpeak': {'start': '10:00:00', 'end': '16:00:00'}, 'overnight': {'start': '00:00:00', 'end': '06:00:00'}})
    start = time.perf_counter()
    result = module.compile_feed(args.child, {'source': {'id': 'controlled-fixture'}, 'profiles': profiles}, '2026-10-05', **({'matching_evidence': True} if args.capture else {}))
    sidecar = result.pop('matching_evidence', None)
    elapsed = time.perf_counter() - start
    encode = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
    print(json.dumps({'capture': args.capture, 'seconds': round(elapsed, 3), 'peak_rss_kib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                      'compiled_sha256': hashlib.sha256(encode(result)).hexdigest(),
                      'evidence_bytes': len(encode(sidecar)) if sidecar else 0,
                      'evidence_status': sidecar['status'] if sidecar else 'disabled',
                      'evidence_reasons': sidecar['reasons'] if sidecar else [],
                      'patterns': len(sidecar['patterns']) if sidecar else 0, 'observations': len(sidecar['observations']) if sidecar else 0}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--trips', type=int, default=10000)
    parser.add_argument('--calls', type=int, default=24)
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--unique-patterns', action='store_true')
    parser.add_argument('--compiler', type=Path, default=Path(__file__).with_name('gtfs-frequency.py'))
    parser.add_argument('--baseline-compiler', type=Path)
    parser.add_argument('--child', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--capture', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.child:
        child(args)
        return
    if not 1 <= args.trips <= 100001 or not 2 <= args.calls <= 512 or args.trips * args.calls > 3000000 or not 1 <= args.repeats <= 5:
        parser.error('fixture exceeds controlled benchmark budgets')
    with tempfile.TemporaryDirectory(prefix='atlas-matching-benchmark-') as directory:
        path = Path(directory) / 'synthetic.zip'
        fixture(path, args.trips, args.calls, args.unique_patterns)
        results = []
        for repeat in range(args.repeats):
            for mode, compiler, capture in [('baseline', args.baseline_compiler or args.compiler, False), ('disabled', args.compiler, False), ('enabled', args.compiler, True)]:
                command = [sys.executable, __file__, '--child', str(path), '--compiler', str(compiler)] + (['--capture'] if capture else [])
                run = subprocess.run(command, capture_output=True, text=True, check=True, timeout=300)
                results.append({'repeat': repeat, 'mode': mode, **json.loads(run.stdout)})
        assert len({row['compiled_sha256'] for row in results}) == 1, 'existing compiled output changed'
        print(json.dumps({'synthetic': True, 'trips': args.trips, 'calls': args.calls, 'stop_rows': args.trips * args.calls,
                          'unique_patterns': args.unique_patterns, 'profiles': 28, 'compressed_input_bytes': path.stat().st_size,
                          'python': sys.version.split()[0], 'results': results}, indent=2))


if __name__ == '__main__':
    main()
