import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import zipfile

import gtfs_frequency_test as fixtures

spec = importlib.util.spec_from_file_location('evidence', Path(__file__).parent.parent / 'scripts/timetable_evidence.py')
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)
compiler = fixtures.compiler


class TimetableEvidence(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.GTFSFrequency()
        self.addCleanup(self.fixture.doCleanups)

    def rewrite(self, path, changes):
        with zipfile.ZipFile(path) as z:
            files = {name: z.read(name) for name in z.namelist()}
        files.update(changes(files))
        with zipfile.ZipFile(path, 'w') as z:
            for name, data in files.items():
                z.writestr(name, data)
        return path

    def compile(self, path, config=fixtures.CONFIG, geometry=False):
        baseline = compiler.compile_feed(path, config, '2026-10-05', geometry=geometry)
        captured = compiler.compile_feed(path, config, '2026-10-05', geometry=geometry, matching_evidence=True)
        sidecar = captured.pop('matching_evidence')
        self.assertEqual(captured, baseline, 'evidence capture cannot alter any existing compiled field')
        self.assertNotIn('matching_evidence', baseline)
        return sidecar, baseline

    def test_shape_build_retains_actual_served_stops_and_patterns(self):
        sidecar, baseline = self.compile(self.fixture.shape_feed(), geometry=True)
        self.assertEqual(sidecar['status'], 'captured')
        self.assertEqual(baseline['stops'], [])
        self.assertEqual(len(sidecar['patterns']), 5)
        self.assertEqual(len(sidecar['observations']), 5)
        patterns = {tuple(c['station_id'] for c in p['calls']) for p in sidecar['patterns']}
        self.assertEqual(patterns, {('A', 'B', 'C'), ('A', 'B', 'D'), ('C', 'B', 'A'), ('D', 'B', 'A'), ('A', 'C')})
        self.assertEqual({s['id'] for s in sidecar['stops']}, set('ABCD'))
        self.assertEqual(sidecar['source']['sha256'], baseline['source']['sha256'])

    def test_original_route_ids_survive_canonicalization(self):
        path = self.fixture.feed(['first', 'second'], {'first': [('A', '08:00:00'), ('B', '08:10:00')], 'second': [('B', '08:20:00'), ('C', '08:30:00')]})
        self.rewrite(path, lambda _: {'routes.txt': b'route_id,route_type,agency_id,route_short_name\na,1,A,R\nb,1,A,R\n',
                                     'trips.txt': b'trip_id,route_id,service_id,direction_id\nfirst,a,W,0\nsecond,b,W,1\n'})
        sidecar, baseline = self.compile(path, {**fixtures.CONFIG, 'canonical_routes': True})
        self.assertEqual(len(baseline['routes']), 1)
        self.assertEqual({p['source_route_id'] for p in sidecar['patterns']}, {'a', 'b'})
        self.assertEqual({p['compiled_route_id'] for p in sidecar['patterns']}, {'a'})
        self.assertEqual({p['direction_id'] for p in sidecar['patterns']}, {'0', '1'})

    def test_parent_platform_identity_and_loop_multiplicity_survive(self):
        path = self.fixture.feed(['t'], {'t': [('A', '08:00:00'), ('B', '08:10:00'), ('A', '08:20:00')]})
        self.rewrite(path, lambda _: {'stops.txt': b'stop_id,stop_name,stop_lat,stop_lon,parent_station\nA,Platform A,60,24,P\nB,Station B,60.01,24,\nP,Parent A,60,24,\n'})
        sidecar, _ = self.compile(path)
        self.assertEqual([c['stop_id'] for c in sidecar['patterns'][0]['calls']], ['A', 'B', 'A'])
        self.assertEqual([c['station_id'] for c in sidecar['patterns'][0]['calls']], ['P', 'B', 'P'])
        self.assertEqual({s['id'] for s in sidecar['stops']}, {'A', 'B', 'P'})

    def test_identical_simultaneous_trains_are_distinct_observations(self):
        pattern = [('A', '08:00:00'), ('B', '08:10:00')]
        path = self.fixture.feed(['one', 'two'], {'one': pattern, 'two': pattern})
        sidecar, _ = self.compile(path)
        self.assertEqual(len(sidecar['patterns']), 1)
        self.assertEqual(len({o['id'] for o in sidecar['observations']}), 2)
        first = json.dumps(sidecar, sort_keys=True)
        self.assertEqual(json.dumps(self.compile(path)[0], sort_keys=True), first)
        other, _ = self.compile(path, {**fixtures.CONFIG, 'source': {'id': 'another-feed'}})
        self.assertTrue({o['id'] for o in sidecar['observations']}.isdisjoint(o['id'] for o in other['observations']))

    def test_calendars_unknown_times_zero_and_extended_hours_remain_distinct(self):
        for blank, removed in [(False, False), (True, False), (False, True)]:
            with self.subTest(blank=blank, removed=removed):
                patterns = {'t': [('A', '25:00:00'), ('B', '25:10:00')]}
                path = self.fixture.feed(patterns, patterns, blank=blank, exceptions=[{'service_id': 'W', 'date': '20261004', 'exception_type': '2'}] if removed else None)
                config = {**fixtures.CONFIG, 'profiles': {f'h{i:02}': {'start': f'{i:02}:00:00', 'end': f'{i+1:02}:00:00'} for i in range(24)}}
                config['profiles'].update(fixtures.CONFIG['profiles'])
                config['profiles']['overnight'] = {'start': '00:00:00', 'end': '06:00:00'}
                sidecar, baseline = self.compile(path, config)
                self.assertEqual(len(baseline['profiles']), 28)
                obs = sidecar['observations'][0]
                self.assertEqual(obs['departures'][0], None if blank else 90000)
                self.assertEqual('2026-10-04' in obs['active_service_dates'], not removed)
                rate = baseline['segments'][0]['profiles']['h01']['display_tph']
                self.assertEqual(rate, None if blank else 0 if removed else 1)
                self.assertEqual(obs['timezone'], 'Europe/Helsinki')

    def test_frequency_templates_are_not_expanded_or_coalesced(self):
        patterns = {'t': [('A', '00:00:00'), ('B', '00:10:00')]}
        for exact in ['0', '1']:
            path = self.fixture.feed(patterns, patterns, [{'trip_id': 't', 'start_time': '07:00:00', 'end_time': '09:00:00', 'headway_secs': '60', 'exact_times': exact}])
            sidecar, _ = self.compile(path)
            self.assertEqual(len(sidecar['observations']), 1)
            self.assertEqual(sidecar['observations'][0]['frequencies'], [{'start': 25200, 'end': 32400, 'headway_secs': 60, 'exact_times': exact}])

    def test_duplicate_ids_incomplete_sequences_and_long_ids_fail_closed(self):
        for kind in ['trip', 'stop', 'route', 'agency', 'calendar', 'single', 'long']:
            patterns = {'t': [('A', '08:00:00'), ('B', '08:10:00')]}
            path = self.fixture.feed(patterns, patterns)
            if kind in ['trip', 'stop', 'route', 'agency', 'calendar']:
                filename = {'trip': 'trips.txt', 'stop': 'stops.txt', 'route': 'routes.txt', 'agency': 'agency.txt', 'calendar': 'calendar.txt'}[kind]
                self.rewrite(path, lambda files: {filename: files[filename] + files[filename].splitlines(keepends=True)[1]})
            elif kind == 'single':
                self.rewrite(path, lambda files: {'stop_times.txt': b'\n'.join(files['stop_times.txt'].splitlines()[:2]) + b'\n'})
            else:
                self.rewrite(path, lambda files: {'trips.txt': files['trips.txt'].replace(b't,R', b'x' * 1025 + b',R'), 'stop_times.txt': files['stop_times.txt'].replace(b't,', b'x' * 1025 + b',')})
            sidecar, _ = self.compile(path)
            self.assertEqual(sidecar['status'], 'incomplete', kind)
            for key in ['patterns', 'observations', 'stops']:
                self.assertEqual(sidecar[key], [])

    def test_hard_limits_discard_all_partial_evidence_without_affecting_compilation(self):
        path = self.fixture.shape_feed()
        for key, value in [('bytes', 4200), ('patterns', 1), ('observations', 1), ('stops', 1), ('pattern_stops', 2), ('routes', 0), ('service_days', 0), ('string_bytes', 2)]:
            # The compiler loads a fresh module, so inject the limit in its loader.
            original = importlib.util.module_from_spec
            def limited(spec):
                module = original(spec)
                if spec.name == 'timetable_evidence':
                    loader = spec.loader.exec_module
                    def execute(target):
                        loader(target)
                        target.LIMITS = {**target.LIMITS, key: value}
                    spec.loader.exec_module = execute
                return module
            with self.subTest(limit=key), patch.object(importlib.util, 'module_from_spec', side_effect=limited):
                sidecar, _ = self.compile(path, geometry=True)
                self.assertEqual(sidecar['status'], 'incomplete')
                self.assertEqual(sidecar['patterns'], [])
                self.assertEqual(sidecar['observations'], [])
                self.assertEqual(sidecar['stops'], [])

    def test_catalogue_config_cannot_enable_evidence_capture(self):
        path = self.fixture.shape_feed()
        result = compiler.compile_feed(path, {**fixtures.CONFIG, 'matching_evidence': True}, '2026-10-05', geometry=True)
        self.assertNotIn('matching_evidence', result)


if __name__ == '__main__':
    unittest.main()
