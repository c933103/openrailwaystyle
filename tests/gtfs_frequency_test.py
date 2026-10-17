from collections import defaultdict
import csv
import gzip
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('gtfs_frequency',Path(__file__).parent.parent/'scripts/gtfs-frequency.py')
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)
CONFIG = {'source':{'id':'fixture'},'profiles':{'am':{'start':'07:00:00','end':'09:00:00'},'pm':{'start':'15:00:00','end':'18:00:00'},'offpeak':{'start':'13:00:00','end':'14:00:00'}}}


class GTFSFrequency(unittest.TestCase):
    def test_time_padding_preserves_optional_and_extended_hour_values(self):
        for value, expected in [(None, None), ('', None), (' 6:57:00', 25020),
                                ('6:57:00 ', 25020), ('\t24:01:02\t', 86462),
                                (' 103:00:00 ', 370800)]:
            with self.subTest(value=value):
                self.assertEqual(compiler.seconds(value), expected)

    def test_time_padding_does_not_accept_empty_or_malformed_times(self):
        for value in [' ', '\t', '6: 57:00', '6:57: 00', '6:60:00', '6:57:60',
                      '-18:31:25', '+6:57:00', '6:57', 'n/a']:
            with self.subTest(value=value):
                with self.assertRaises(ValueError) as error:
                    compiler.seconds(value)
                self.assertEqual(str(error.exception), f'Invalid GTFS time {value!r}')

    def test_padded_departure_and_frequency_times_preserve_profiles(self):
        patterns = {'t': [('A', '00:00:00'), ('B', '00:30:00'), ('C', '00:40:00')]}
        for exact in ['0', '1']:
            with self.subTest(exact_times=exact):
                frequency = [{'trip_id': 't', 'start_time': '07:00:00',
                              'end_time': '09:00:00', 'headway_secs': '600',
                              'exact_times': exact}]
                path = self.feed(patterns, patterns, frequency)
                before = compiler.compile_feed(path, CONFIG, '2026-10-05')
                with zipfile.ZipFile(path) as z:
                    files = {name: z.read(name) for name in z.namelist()}
                files['frequencies.txt'] = files['frequencies.txt'].replace(
                    b'07:00:00', b' 7:00:00 ').replace(b'09:00:00', b' 9:00:00 ')
                for value in [b'00:00:00', b'00:30:00', b'00:40:00']:
                    files['stop_times.txt'] = files['stop_times.txt'].replace(
                        value, b' ' + value + b' ')
                with zipfile.ZipFile(path, 'w') as z:
                    for name, data in files.items():
                        z.writestr(name, data)
                after = compiler.compile_feed(path, CONFIG, '2026-10-05')
                self.assertEqual(after['segments'], before['segments'])
                self.assertEqual(after['source']['calendar_audit'],
                                 before['source']['calendar_audit'])

    def test_whitespace_only_departure_remains_explicitly_invalid(self):
        patterns = {'t': [('A', '08:00:00'), ('B', '08:10:00')]}
        path = self.feed(patterns, patterns)
        with zipfile.ZipFile(path) as z:
            files = {name: z.read(name) for name in z.namelist()}
        files['stop_times.txt'] = files['stop_times.txt'].replace(b'08:00:00', b' ')
        with zipfile.ZipFile(path, 'w') as z:
            for name, data in files.items():
                z.writestr(name, data)
        # Treating this as an absent value would break max(known) downstream.
        with self.assertRaisesRegex(ValueError, 'Invalid GTFS time'):
            compiler.compile_feed(path, CONFIG, '2026-10-05')

    def test_future_rail_calendars_without_feed_start_are_unknown_not_zero(self):
        patterns={'t':[('A','08:00:00'),('B','08:10:00')]}
        for added in [False,True]:
            with self.subTest(added=added):
                path=self.feed(patterns,patterns)
                with zipfile.ZipFile(path) as z:files={n:z.read(n) for n in z.namelist() if n!='feed_info.txt'}
                files['calendar.txt']=files['calendar.txt'].replace(b'20260101',b'20261101')
                if added:
                    del files['calendar.txt']
                    files['calendar_dates.txt']=b'service_id,date,exception_type\nW,20261101,1\nW,20261001,2\n'
                with zipfile.ZipFile(path,'w') as z:
                    for name,data in files.items():z.writestr(name,data)
                with self.assertRaisesRegex(ValueError,'before.*service calendar'):
                    compiler.compile_feed(path,CONFIG,'2026-10-05')
                # An earlier added rail service extends the lower boundary.
                files['calendar_dates.txt']=b'service_id,date,exception_type\nW,20261001,1\n'
                with zipfile.ZipFile(path,'w') as z:
                    for name,data in files.items():z.writestr(name,data)
                result=compiler.compile_feed(path,CONFIG,'2026-10-01')
                self.assertEqual(result['segments'][0]['profiles']['am']['display_tph'],.5)

    def test_current_pattern_cannot_validate_a_future_branch_after_route_merging(self):
        patterns={'future':[('A','08:00:00'),('B','08:10:00')],'current':[('B','08:00:00'),('C','08:10:00')]}
        for same_route in [False,True]:
            with self.subTest(same_route=same_route):
                path=self.feed(patterns,patterns)
                with zipfile.ZipFile(path) as z:files={n:z.read(n) for n in z.namelist() if n!='feed_info.txt'}
                files['calendar.txt']=files['calendar.txt'].replace(b'20260101',b'20261101')+b'NOW,1,1,1,1,1,1,1,20260101,20261231\n'
                files['routes.txt']=b'route_id,route_type,agency_id,route_short_name\na,2,A,R\n'+(b'' if same_route else b'z,2,A,R\n')
                files['trips.txt']=b'trip_id,route_id,service_id\nfuture,a,W\ncurrent,'+(b'a' if same_route else b'z')+b',NOW\n'
                with zipfile.ZipFile(path,'w') as z:
                    for name,data in files.items():z.writestr(name,data)
                result=compiler.compile_feed(path,{**CONFIG,'canonical_routes':True},'2026-10-05')
                self.assertEqual(len(result['routes']),1)
                segments={tuple(s['stops']):s for s in result['segments']}
                self.assertIsNone(segments[('A','B')]['profiles']['am']['display_tph'])
                self.assertEqual(segments[('B','C')]['profiles']['am']['display_tph'],.5)
                self.assertEqual(result['source']['calendar_audit']['trip_patterns_before_service_start'],1)

    def test_calendar_horizon_retains_multi_day_departures_after_final_service_day(self):
        patterns={'late':[('A','00:00:00'),('B','103:00:00'),('C','103:10:00')]}
        path=self.feed(patterns,patterns)
        with zipfile.ZipFile(path) as z:files={n:z.read(n) for n in z.namelist() if n!='feed_info.txt'}
        files['calendar.txt']=files['calendar.txt'].replace(b'20261231',b'20261001')
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items():z.writestr(name,data)
        result=compiler.compile_feed(path,CONFIG,'2026-10-05')
        segment=next(s for s in result['segments'] if s['stops']==['B','C'])
        self.assertEqual(segment['profiles']['am']['display_tph'],.5)
        boundary=compiler.local_boundary(compiler.dt.date(2026,10,5),'07:00:00',compiler.ZoneInfo('Europe/Helsinki'))
        self.assertAlmostEqual(result['source']['valid_until'],boundary+600-.001,places=3)

    def test_old_long_trip_cannot_extend_a_different_calendar_on_the_same_route(self):
        patterns={'old':[('A','00:00:00'),('B','103:00:00')],'recent':[('B','08:00:00'),('C','08:10:00')]}
        path=self.feed(patterns,patterns)
        with zipfile.ZipFile(path) as z:files={n:z.read(n) for n in z.namelist() if n!='feed_info.txt'}
        files['calendar.txt']=files['calendar.txt'].replace(b'20261231',b'20260920')+b'NEW,1,1,1,1,1,1,1,20260101,20261004\n'
        files['trips.txt']=b'trip_id,route_id,service_id\nold,R,W\nrecent,R,NEW\n'
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items():z.writestr(name,data)
        with self.assertRaisesRegex(ValueError,'every retained rail service calendar horizon'):
            compiler.compile_feed(path,{**CONFIG,'canonical_routes':True},'2026-10-05')

    def test_declared_feed_end_retains_multi_day_departures_and_bounds_service_days(self):
        patterns={'late':[('A','00:00:00'),('B','103:00:00'),('C','103:10:00')]}
        path=self.feed(patterns,patterns)
        with zipfile.ZipFile(path) as z:files={n:z.read(n) for n in z.namelist()}
        # Leave the calendar extending past the metadata's final service day.
        files['feed_info.txt']=files['feed_info.txt'].replace(b'20261231',b'20261001')
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items():z.writestr(name,data)
        result=compiler.compile_feed(path,CONFIG,'2026-10-05')
        segment=next(s for s in result['segments'] if s['stops']==['B','C'])
        self.assertEqual(segment['profiles']['am']['display_tph'],.5)
        # A Monday trip outside feed validity must not contribute at A.
        first=next(s for s in result['segments'] if s['stops']==['A','B'])
        self.assertEqual(first['profiles']['am']['display_tph'],0)
        boundary=compiler.local_boundary(compiler.dt.date(2026,10,5),'07:00:00',compiler.ZoneInfo('Europe/Helsinki'))
        self.assertAlmostEqual(result['source']['valid_until'],boundary+600-.001,places=3)
        with self.assertRaisesRegex(ValueError,'calendar horizon'):
            compiler.compile_feed(path,CONFIG,'2026-10-06')

    def test_obsolete_calendar_without_feed_end_is_not_a_future_zero_frequency(self):
        patterns={'t':[('A','08:00:00'),('B','08:10:00')]}
        path=self.feed(patterns,patterns)
        with zipfile.ZipFile(path) as z:files={n:z.read(n) for n in z.namelist() if n!='feed_info.txt'}
        files['calendar.txt']=files['calendar.txt'].replace(b'20261231',b'20261002')
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items():z.writestr(name,data)
        with self.assertRaisesRegex(ValueError,'calendar horizon'):
            compiler.compile_feed(path,CONFIG,'2026-10-05')

    def test_bus_calendars_and_exceptions_do_not_extend_obsolete_rail_validity(self):
        patterns={'t':[('A','08:00:00'),('B','08:10:00')]}
        for declared_end in [False,True]:
            for bus_calendar in [False,True]:
                with self.subTest(declared_end=declared_end,bus_calendar=bus_calendar):
                    path=self.feed(patterns,patterns)
                    with zipfile.ZipFile(path) as z:files={n:z.read(n) for n in z.namelist() if declared_end or n!='feed_info.txt'}
                    files['calendar.txt']=files['calendar.txt'].replace(b'20261231',b'20261002')
                    if bus_calendar:
                        files['calendar.txt']+=b'BUS,1,1,1,1,1,1,1,20260101,20261231\n'
                    files['calendar_dates.txt']=b'service_id,date,exception_type\nBUS,20261231,1\n'
                    with zipfile.ZipFile(path,'w') as z:
                        for name,data in files.items():z.writestr(name,data)
                    with self.assertRaisesRegex(ValueError,'calendar horizon'):
                        compiler.compile_feed(path,CONFIG,'2026-10-05')

    def test_current_rail_route_does_not_refresh_an_expired_rail_route(self):
        patterns={key:[('A','08:00:00'),('B','08:10:00')] for key in ['old','current']}
        path=self.feed(patterns,patterns)
        with zipfile.ZipFile(path) as z:files={n:z.read(n) for n in z.namelist() if n!='feed_info.txt'}
        files['calendar.txt']=files['calendar.txt'].replace(b'20261231',b'20261002')+b'NEW,1,1,1,1,1,1,1,20260101,20261231\n'
        files['routes.txt']=b'route_id,route_type,agency_id\nold,2,A\ncurrent,2,A\n'
        files['trips.txt']=b'trip_id,route_id,service_id\nold,old,W\ncurrent,current,NEW\n'
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items():z.writestr(name,data)
        result=compiler.compile_feed(path,CONFIG,'2026-10-05')
        for segment in result['segments']:
            self.assertEqual(segment['profiles']['am']['display_tph'],None if segment['route_id']=='old' else .5)
        routes={r['route_id']:r for r in result['routes']}
        now=compiler.local_boundary(compiler.dt.date(2026,10,5),'00:00:00',compiler.ZoneInfo('Europe/Helsinki'))
        self.assertLess(routes['old']['valid_until'],now)
        self.assertGreater(routes['current']['valid_until'],now)
        self.assertEqual(result['source']['calendar_audit']['routes_beyond_service_horizon'],['old'])

    def test_canonical_route_preserves_expired_branch_and_current_branch_validity(self):
        patterns={'old':[('A','08:00:00'),('B','08:10:00')],'current':[('B','08:00:00'),('C','08:10:00')]}
        path=self.feed(patterns,patterns)
        with zipfile.ZipFile(path) as z:files={n:z.read(n) for n in z.namelist() if n!='feed_info.txt'}
        files['calendar.txt']=files['calendar.txt'].replace(b'20261231',b'20261002')+b'NEW,1,1,1,1,1,1,1,20260101,20261231\n'
        files['routes.txt']=b'route_id,route_type,agency_id,route_short_name\na,2,A,R\nz,2,A,R\n'
        files['trips.txt']=b'trip_id,route_id,service_id\nold,a,W\ncurrent,z,NEW\n'
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items():z.writestr(name,data)
        result=compiler.compile_feed(path,{**CONFIG,'canonical_routes':True},'2026-10-05')
        self.assertEqual(len(result['routes']),1)
        self.assertEqual(result['routes'][0]['source_route_ids'],['a','z'])
        now=compiler.local_boundary(compiler.dt.date(2026,10,5),'00:00:00',compiler.ZoneInfo('Europe/Helsinki'))
        segments={tuple(s['stops']):s for s in result['segments']}
        self.assertIsNone(segments[('A','B')]['profiles']['am']['display_tph'])
        self.assertLess(segments[('A','B')]['valid_until'],now)
        self.assertEqual(segments[('B','C')]['profiles']['am']['display_tph'],.5)
        self.assertGreater(segments[('B','C')]['valid_until'],now)
        self.assertGreater(result['routes'][0]['valid_until'],now)
        # The same protection applies to variants already using one route ID.
        files['routes.txt']=b'route_id,route_type,agency_id,route_short_name\na,2,A,R\n'
        files['trips.txt']=b'trip_id,route_id,service_id\nold,a,W\ncurrent,a,NEW\n'
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items():z.writestr(name,data)
        result=compiler.compile_feed(path,{**CONFIG,'canonical_routes':True},'2026-10-05')
        segments={tuple(s['stops']):s for s in result['segments']}
        self.assertIsNone(segments[('A','B')]['profiles']['am']['display_tph'])
        self.assertLess(segments[('A','B')]['valid_until'],now)
        self.assertEqual(segments[('B','C')]['profiles']['am']['display_tph'],.5)
        self.assertGreater(segments[('B','C')]['valid_until'],now)

    def test_inactive_variants_cannot_suppress_current_shared_segments(self):
        for future in [False,True]:
            for reverse in [False,True]:
                for same_route in [False,True]:
                    with self.subTest(future=future,reverse=reverse,same_route=same_route):
                        old=[('A','08:00:00'),('B','08:10:00'),('C','08:20:00')]
                        if reverse:old=[('C','08:00:00'),('B','08:10:00'),('A','08:20:00')]
                        patterns={'inactive':old,'current':[('B','08:00:00'),('C','08:10:00'),('D','08:20:00')]}
                        path=self.feed(patterns,patterns)
                        with zipfile.ZipFile(path) as z:files={n:z.read(n) for n in z.namelist() if n!='feed_info.txt'}
                        if future:files['calendar.txt']=files['calendar.txt'].replace(b'20260101',b'20261101').replace(b'20261231',b'20261130')
                        else:files['calendar.txt']=files['calendar.txt'].replace(b'20261231',b'20261002')
                        files['calendar.txt']+=b'NOW,1,1,1,1,1,1,1,20260101,20261231\n'
                        files['routes.txt']=b'route_id,route_type,agency_id,route_short_name\na,2,A,R\n'+(b'' if same_route else b'z,2,A,R\n')
                        files['trips.txt']=b'trip_id,route_id,service_id\ninactive,a,W\ncurrent,'+(b'a' if same_route else b'z')+b',NOW\n'
                        with zipfile.ZipFile(path,'w') as z:
                            for name,data in files.items():z.writestr(name,data)
                        result=compiler.compile_feed(path,{**CONFIG,'canonical_routes':True},'2026-10-05')
                        segments={tuple(row['stops']):row for row in result['segments']}
                        shared=segments[('B','C')]
                        self.assertEqual(shared['profiles']['am']['display_tph'],.5)
                        self.assertEqual(shared['expected_directions'],[0])
                        self.assertEqual(shared['valid_until'],segments[('C','D')]['valid_until'])
                        self.assertIsNone(segments[('A','B')]['profiles']['am']['display_tph'])
                        self.assertLess(segments[('A','B')]['valid_until'],shared['valid_until'])

    def test_expanded_table_and_row_budgets_are_checked_before_retention(self):
        from unittest.mock import patch
        patterns={'t':[('A','08:00:00'),('B','08:10:00')]}
        path=self.feed(patterns,patterns)
        for name in ['MAX_EXPANDED_BYTES','MAX_TABLE_BYTES','MAX_TABLE_ROWS']:
            with self.subTest(budget=name),patch.object(compiler,name,1):
                with self.assertRaisesRegex(ValueError,'budget'):
                    compiler.compile_feed(path,CONFIG,'2026-10-05')
        with patch.object(compiler,'MAX_TRIP_STOP_ROWS',1):
            with self.assertRaisesRegex(ValueError,'retained stop-row budget'):
                compiler.compile_feed(path,CONFIG,'2026-10-05')

    def test_compressed_row_bomb_fails_in_isolation_and_next_feed_compiles(self):
        import http.server
        import threading
        import contextlib
        from unittest.mock import patch
        module_spec=importlib.util.spec_from_file_location('global_frequency',Path(__file__).parent.parent/'scripts/global-service-frequency.py')
        global_compiler=importlib.util.module_from_spec(module_spec);module_spec.loader.exec_module(global_compiler)
        patterns={'t':[('A','08:00:00'),('B','08:10:00')]}
        good=self.feed(patterns,patterns)
        with zipfile.ZipFile(good) as z:files={name:z.read(name) for name in z.namelist()}
        files['stop_times.txt']=b'trip_id,stop_id,stop_sequence,departure_time\n'+b't,A,1,08:00:00\n'*(compiler.MAX_TRIP_STOP_ROWS+1)
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_DEFLATED) as z:
            for name,data in files.items():z.writestr(name,data)
        bad=buffer.getvalue();valid=good.read_bytes()
        self.assertLess(len(bad),len(files['stop_times.txt'])/20)
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                data=bad if self.path=='/bad.zip' else valid
                self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
            def log_message(self,*args):pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                root=Path(folder);cache=root/'cache';cache.mkdir();output=root/'output'
                url=f'http://127.0.0.1:{server.server_port}'
                def entry(ident):
                    return {'id':ident,'name':ident,'country':'FI','status':'pending','processed_url':url+'/'+ident+'.zip',
                            'catalogue':{'source':url,'spdx_license_identifier':'CC0-1.0'}}
                args=(cache,output,'2026-10-05',None,1_000_000,CONFIG['profiles'])
                # Production's unchanged subprocess entry must reject catalogue
                # loopback even when that catalogue asks for fixture access.
                untrusted = {**entry('good'), 'allow_private': True, 'test_mode': True}
                with self.assertRaises(global_compiler.SourceRetrievalError) as denied:
                    global_compiler.compile_entry_isolated(untrusted,*args,max_seconds=10,max_memory_bytes=256*1024*1024)
                self.assertEqual({item['code'] for item in denied.exception.attempts}, {'unsafe_source_url'})
                # Bootstrap belongs only to this test. Retain a real child process,
                # the real compile_one path, and its memory/time limits; inject only
                # this server's exact port, never an environment/catalogue opt-in.
                run = global_compiler.subprocess.run
                bootstrap = """
import importlib.util, socket, sys
spec = importlib.util.spec_from_file_location('fixture_compiler', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
def fixture_addresses(host, port):
    if host != '127.0.0.1' or port != int(sys.argv[4]):
        raise AssertionError('Unexpected network destination in offline child fixture')
    return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, (host, port))]
module.resolve_public_addresses = fixture_addresses
sys.exit(module.compile_one(sys.argv[2], sys.argv[3]))
"""
                def fixture_child(command, **kwargs):
                    self.assertEqual(command[2], '--compile-one')
                    return run([command[0], '-c', bootstrap, command[1], command[3], command[4],
                                str(server.server_port)], **kwargs)
                with patch.object(global_compiler.subprocess, 'run', side_effect=fixture_child):
                    with self.assertRaisesRegex(RuntimeError,'retained stop-row budget'):
                        global_compiler.compile_entry_isolated(entry('bad'),*args,max_seconds=10,max_memory_bytes=256*1024*1024)
                    result=global_compiler.compile_entry_isolated(entry('good'),*args,max_seconds=10,max_memory_bytes=256*1024*1024)
                self.assertEqual(result['status'],'compiled')
                self.assertTrue((output/result['output']).exists())
        finally:
            server.shutdown();server.server_close();thread.join()

    def test_shape_snap_distances_are_local_even_with_unrelated_latitudes(self):
        spec=importlib.util.spec_from_file_location('shape_paths',Path(__file__).parent.parent/'scripts/gtfs-shapes.py')
        shapes=importlib.util.module_from_spec(spec);spec.loader.exec_module(shapes)
        rows=[{'shape_id':key,'shape_pt_sequence':i,'shape_pt_lon':0,'shape_pt_lat':lat+i*.01} for key,lat in [('north',80),('equator',0)] for i in range(2)]
        trips={key:{'shape_id':key,'route_id':key} for key in ['north','equator']}
        times={key:[{'stop_id':key+str(i),'stop_sequence':i} for i in range(2)] for key in trips}
        stops={key+str(i):{'stop_lon':.01 if key=='north' else .002,'stop_lat':lat+i*.01} for key,lat in [('north',80),('equator',0)] for i in range(2)}
        paths=shapes.ShapePaths(rows,trips,times,stops,{'max_stop_snap_metres':200})
        self.assertIsNotNone(paths.patterns[paths.pattern_key(trips['north'],times['north'])])
        self.assertIsNone(paths.patterns[paths.pattern_key(trips['equator'],times['equator'])])
        self.assertAlmostEqual(paths.distance((0,80),(.01,80)),193.305,places=2)

    def test_antimeridian_shapes_are_short_and_split_at_the_dateline(self):
        spec=importlib.util.spec_from_file_location('shape_paths',Path(__file__).parent.parent/'scripts/gtfs-shapes.py')
        shapes=importlib.util.module_from_spec(spec);spec.loader.exec_module(shapes)
        # About 22 km across the antimeridian, stops on either side.
        rows=[{'shape_id':'fiji','shape_pt_sequence':i,'shape_pt_lon':lon,'shape_pt_lat':-16.5} for i,lon in enumerate([179.9,179.97,-179.97,-179.9])]
        trips={'t':{'shape_id':'fiji','route_id':'r'}}
        times={'t':[{'stop_id':'w','stop_sequence':0},{'stop_id':'e','stop_sequence':1}]}
        stops={'w':{'stop_lon':179.9,'stop_lat':-16.5},'e':{'stop_lon':-179.9,'stop_lat':-16.5}}
        paths=shapes.ShapePaths(rows,trips,times,stops,{'max_stop_snap_metres':200})
        self.assertLess(paths.shapes['fiji']['lengths'][-1],25000)
        self.assertIsNotNone(paths.patterns[paths.pattern_key(trips['t'],times['t'])])
        edges=[geometry for _,_,_,geometry in paths.segments(trips['t'],times['t'])]
        self.assertTrue(edges)
        self.assertTrue(all(-180<=lon<=180 for edge in edges for lon,_ in edge))
        self.assertTrue(all(abs(a[0]-b[0])<1 for a,b in edges),'no edge spans the world')
        self.assertTrue(any(lon==180 for edge in edges for lon,_ in edge) and any(lon==-180 for edge in edges for lon,_ in edge),'split at the dateline')

    def test_opposite_dateline_shapes_share_edges(self):
        spec=importlib.util.spec_from_file_location('shape_paths',Path(__file__).parent.parent/'scripts/gtfs-shapes.py')
        shapes=importlib.util.module_from_spec(spec);spec.loader.exec_module(shapes)
        # Eastbound is densely sampled from the west side; westbound is two
        # vertices from the east side. Both must split into the same edges.
        lines={'east':[179.9,179.95,-179.95,-179.9],'west':[-179.9,179.9]}
        rows=[{'shape_id':key,'shape_pt_sequence':i,'shape_pt_lon':lon,'shape_pt_lat':-16.5} for key,lons in lines.items() for i,lon in enumerate(lons)]
        trips={key:{'shape_id':key,'route_id':'r'} for key in lines}
        stops={'w':{'stop_lon':179.9,'stop_lat':-16.5},'e':{'stop_lon':-179.9,'stop_lat':-16.5}}
        times={'east':[{'stop_id':'w','stop_sequence':0},{'stop_id':'e','stop_sequence':1}],'west':[{'stop_id':'e','stop_sequence':0},{'stop_id':'w','stop_sequence':1}]}
        paths=shapes.ShapePaths(rows,trips,times,stops,{'max_stop_snap_metres':200})
        east={(key,direction) for key,direction,_,_ in paths.segments(trips['east'],times['east'])}
        west={(key,direction) for key,direction,_,_ in paths.segments(trips['west'],times['west'])}
        self.assertEqual({k for k,_ in east},{k for k,_ in west},'one set of shared edges in both directions')
        self.assertTrue(all((k,1-d) in west for k,d in east),'opposite directions on every edge')

    def test_global_rail_modes_exclude_buses_and_aerial_lifts(self):
        for value in [0,1,2,5,7,12,100,109,400,405,900,906,1400]:
            self.assertTrue(compiler.rail_type(str(value)), value)
        for value in [3,4,6,700,714,1000,1300,1302,1500]:
            self.assertFalse(compiler.rail_type(str(value)), value)

    def feed(self, trips, patterns, frequencies=None, exceptions=None, blank=False):
        rows={
          'agency.txt':[{'agency_id':'A','agency_name':'Fixture','agency_timezone':'Europe/Helsinki'}],
          'routes.txt':[{'route_id':'R','route_type':'1','agency_id':'A','route_short_name':'R'}],
          'feed_info.txt':[{'feed_start_date':'20260101','feed_end_date':'20261231'}],
          'stops.txt':[{'stop_id':s,'stop_name':s,'stop_lat':60+i*.01,'stop_lon':24,'parent_station':' '} for i,s in enumerate('ABCD')],
          'calendar.txt':[{'service_id':'W','monday':'1','tuesday':'1','wednesday':'1','thursday':'1','friday':'1','saturday':'0','sunday':'1','start_date':'20260101','end_date':'20261231'}],
          'trips.txt':[{'trip_id':name,'route_id':'R','service_id':'W'} for name in trips],
          'stop_times.txt':[{'trip_id':name,'stop_sequence':i,'stop_id':s,'arrival_time':time,'departure_time':time if not blank or i else ''} for name,pattern in patterns.items() for i,(s,time) in enumerate(pattern)]}
        if frequencies:rows['frequencies.txt']=frequencies
        if exceptions:rows['calendar_dates.txt']=exceptions
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup);path=Path(temp.name)/'feed.zip'
        with zipfile.ZipFile(path,'w') as z:
            for filename,data in rows.items():
                text=io.StringIO();writer=csv.DictWriter(text,fieldnames=list(data[0]));writer.writeheader();writer.writerows(data);z.writestr(filename,text.getvalue())
        return path

    def shape_feed(self, missing=False):
        patterns={'t1':[('A','08:00:00'),('B','08:10:00'),('C','08:20:00')],
                  't2':[('A','08:30:00'),('B','08:40:00'),('D','08:50:00')],
                  't3':[('C','08:00:00'),('B','08:10:00'),('A','08:20:00')],
                  't4':[('D','08:30:00'),('B','08:40:00'),('A','08:50:00')],
                  'express':[('A','08:05:00'),('C','08:25:00')]}
        path=self.feed(patterns,patterns)
        with zipfile.ZipFile(path) as z: files={n:z.read(n) for n in z.namelist()}
        def table(name,rows):
            text=io.StringIO();writer=csv.DictWriter(text,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows);files[name]=text.getvalue().encode()
        stops={'A':(24,60),'B':(24,60.01),'C':(24,60.02),'D':(24.01,60.01)}
        table('stops.txt',[{'stop_id':k,'stop_name':k,'stop_lat':v[1],'stop_lon':v[0]} for k,v in stops.items()])
        shapes={'c':[(24,60),(24,60.01),(24.005,60.015),(24,60.02)],
                'd':[(24,60),(24,60.005),(24,60.01),(24.01,60.01)],
                'cr':[(24,60.02),(24.005,60.015),(24,60.01),(24,60.005),(24,60)],
                'dr':[(24.01,60.01),(24,60.01),(24,60)]}
        table('shapes.txt',[{'shape_id':k,'shape_pt_sequence':i,'shape_pt_lon':v[0],'shape_pt_lat':v[1]} for k,vs in shapes.items() for i,v in enumerate(vs)])
        table('trips.txt',[{'trip_id':k,'route_id':'R','service_id':'W','shape_id':('absent' if missing and k=='express' else {'t1':'c','t2':'d','t3':'cr','t4':'dr','express':'c'}[k])} for k in patterns])
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items():z.writestr(name,data)
        return path

    def mixed_paths_feed(self, patterns, supplied, lines, *, trip_fields=None,
                         exceptions=None, points=None, profiles=None, calendar_rows=None):
        path = self.feed(patterns, patterns, exceptions=exceptions)
        with zipfile.ZipFile(path) as z:
            files = {name: z.read(name) for name in z.namelist()}
        def table(name, rows):
            text = io.StringIO()
            writer = csv.DictWriter(text, fieldnames=list(rows[0]))
            writer.writeheader(); writer.writerows(rows)
            files[name] = text.getvalue().encode()
        points = points or {'A': (24, 60), 'B': (24, 60.01),
                            'C': (24, 60.02), 'D': (24.01, 60.01)}
        table('stops.txt', [{'stop_id': key, 'stop_name': key, 'stop_lon': p[0],
                             'stop_lat': p[1]} for key, p in points.items()])
        route_ids = {'R'} | {fields.get('route_id', 'R') for fields in (trip_fields or {}).values()}
        table('routes.txt', [{'route_id': key, 'route_type': '1', 'agency_id': 'A',
                              'route_short_name': key} for key in sorted(route_ids)])
        table('trips.txt', [{'trip_id': name, 'route_id': 'R', 'service_id': 'W',
                             'shape_id': name if name in supplied else '',
                             **(trip_fields or {}).get(name, {})} for name in patterns])
        if calendar_rows:
            table('calendar.txt', calendar_rows)
        if supplied:
            table('shapes.txt', [{'shape_id': name, 'shape_pt_sequence': i,
                                  'shape_pt_lon': p[0], 'shape_pt_lat': p[1]}
                                 for name, coords in supplied.items() for i, p in enumerate(coords)])
        with zipfile.ZipFile(path, 'w') as z:
            for name, data in files.items(): z.writestr(name, data)
        graph = path.parent / 'graph.ndjson'
        graph.write_text('\n'.join(json.dumps({'type': 'Feature',
            'properties': {'feature': 'subway'},
            'geometry': {'type': 'LineString', 'coordinates': line}}) for line in lines))
        return compiler.compile_feed(path, {**CONFIG, 'rail_graph': str(graph),
            **({'profiles': profiles} if profiles else {})}, '2026-10-05', geometry=True)

    def test_mixed_shape_and_graph_short_workings_share_atomic_intervals(self):
        points = {'A': (24, 60), 'B': (24, 60.01), 'C': (24, 60.02)}
        for reverse in [False, True]:
            for shaped in ['full', 'short']:
                with self.subTest(reverse=reverse, shaped=shaped):
                    stops = {'full': ['A', 'C'], 'short': ['A', 'B']}
                    if reverse: stops = {k: list(reversed(v)) for k, v in stops.items()}
                    patterns = {name: [(s, f'08:{i*10:02}:00') for i, s in enumerate(seq)]
                                for name, seq in stops.items()}
                    result = self.mixed_paths_feed(patterns,
                        {shaped: [points[s] for s in stops[shaped]]},
                        [[points['A'], points['C']]])
                    rows = {tuple(map(tuple, s['geometry'])): s for s in result['segments']}
                    self.assertEqual(set(rows), {(points['A'], points['B']), (points['B'], points['C'])})
                    for edge, expected in [((points['A'], points['B']), 1), ((points['B'], points['C']), .5)]:
                        row = rows[edge]
                        self.assertEqual(row['profiles']['am']['display_tph'], expected)
                        self.assertEqual(row['expected_directions'], [int(reverse)])
                    self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], [])

    def test_mixed_branch_directions_keep_distinct_traversals_and_section_counts(self):
        a, b, c, d = (24, 60), (24, 60.01), (24, 60.02), (24.01, 60.01)
        # Same-time distinct trips must both count. Neither branch receives the trunk total.
        patterns = {name: [(up, '08:00:00'), (down, '08:20:00')]
            for name, up, down in [('shape1', 'A', 'C'), ('shape2', 'A', 'C'),
                ('graph1', 'A', 'D'), ('graph2', 'A', 'D'), ('shape_back', 'C', 'A'), ('graph_back', 'D', 'A')]}
        supplied = {'shape1': [a, c], 'shape2': [a, c], 'shape_back': [c, a]}
        result = self.mixed_paths_feed(patterns, supplied, [[a, b, d]])
        rows = {tuple(map(tuple, s['geometry'])): s['profiles']['am'] for s in result['segments']}
        self.assertEqual(set(rows), {(a, b), (b, c), (b, d)})
        for edge, pair in [((a, b), (2, 1)), ((b, c), (1, .5)), ((b, d), (1, .5))]:
            self.assertEqual((rows[edge]['forward_tph'], rows[edge]['backward_tph']), pair)
            self.assertEqual(rows[edge]['display_tph'], min(pair))

    def test_mixed_paths_preserve_calendar_removals_prior_days_and_anchor_times(self):
        a, b, c = (24, 60), (24, 60.01), (24, 60.02)
        patterns = {'shape': [('A', '01:10:00'), ('C', '01:30:00')],
                    'graph': [('A', '25:10:00'), ('B', '25:20:00')]}
        profiles = {'overnight': {'start': '00:00:00', 'end': '02:00:00'}}
        # Monday's ordinary shape trip is removed. Sunday's delayed graph trip remains.
        result = self.mixed_paths_feed(patterns, {'shape': [a, c]}, [[a, c]],
            exceptions=[{'service_id': 'W', 'date': '20261005', 'exception_type': '2'}], profiles=profiles)
        rows = {tuple(map(tuple, s['geometry'])): s for s in result['segments']}
        self.assertEqual(set(rows), {(a, b), (b, c)})
        self.assertEqual(rows[(a, b)]['profiles']['overnight']['display_tph'], .5)
        self.assertEqual(rows[(b, c)]['profiles']['overnight']['display_tph'], 0)
        # Splitting an express shape never invents an intermediate-stop departure.
        patterns = {'shape': [('A', '07:59:00'), ('C', '08:20:00')],
                    'graph': [('A', '08:10:00'), ('B', '08:20:00')]}
        result = self.mixed_paths_feed(patterns, {'shape': [a, c]}, [[a, c]],
            profiles={'h08': {'start': '08:00:00', 'end': '09:00:00'}})
        rows = {tuple(map(tuple, s['geometry'])): s for s in result['segments']}
        self.assertEqual(rows[(a, b)]['profiles']['h08']['display_tph'], 1)
        self.assertEqual(rows[(b, c)]['profiles']['h08']['display_tph'], 0)

    def test_noncontributing_near_paths_reuse_current_intervals_across_output_windows(self):
        a, b, c = (24, 60), (24, 60.01), (24, 60.02)
        patterns = {'shape': [('A', '07:59:00'), ('C', '08:20:00')],
                    'graph': [('A', '08:10:00'), ('B', '08:20:00')]}
        for with_am in [False, True]:
            with self.subTest(with_am=with_am):
                profiles = {'h08': {'start': '08:00:00', 'end': '09:00:00'}}
                if with_am: profiles['am'] = {'start': '07:00:00', 'end': '09:00:00'}
                result = self.mixed_paths_feed(patterns, {'shape': [a, c]},
                    [[(24.000001, 60), (24.000001, 60.02)]], profiles=profiles)
                self.assertEqual(len(result['segments']), 2)
                for row in result['segments']:
                    expected = 1 if row['geometry'][0][1] == 60 else 0
                    self.assertEqual(row['profiles']['h08']['display_tph'], expected)
                self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], [])

    def test_composed_reconciliation_cannot_drift_beyond_source_tolerance(self):
        points = {'C0': (23.999998, 60), 'C1': (23.999998, 60.010002),
                  'T0': (24.000002, 60), 'T1': (24, 60.010002),
                  'L0': (23.999997, 60), 'L1': (23.999997, 60.009998)}
        for reverse in [False, True]:
            with self.subTest(reverse=reverse):
                stops = {'center': ['C0', 'C1'], 'tilted': ['T0', 'T1'], 'left': ['L0', 'L1']}
                if reverse: stops = {key: list(reversed(value)) for key, value in stops.items()}
                patterns = {key: [(stop, f'08:{i*20:02}:00') for i, stop in enumerate(value)]
                            for key, value in stops.items()}
                result = self.mixed_paths_feed(patterns,
                    {key: [points[stop] for stop in value] for key, value in stops.items()}, [], points=points)
                self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], ['R'])
                self.assertTrue(all(row['profiles']['am']['display_tph'] is None for row in result['segments']))
                tilted = [row['geometry'] for row in result['segments'] if points['T0'] in row['geometry']]
                self.assertEqual(len(tilted), 1)
                self.assertTrue(all(point[0] >= 24 for point in tilted[0]),
                                'the tilted source must not be moved onto the left track')
                spec = importlib.util.spec_from_file_location('bounded_shapes', Path(__file__).parent.parent/'scripts/gtfs-shapes.py')
                module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
                lines = {key: [points[stop] for stop in value] for key, value in stops.items()}
                shape_rows = [{'shape_id': key, 'shape_pt_sequence': i, 'shape_pt_lon': point[0], 'shape_pt_lat': point[1]}
                              for key, line in lines.items() for i, point in enumerate(line)]
                trips = {key: {'route_id': 'R', 'shape_id': key} for key in lines}
                stop_rows = {key: {'stop_lon': point[0], 'stop_lat': point[1]} for key, point in points.items()}
                times = {key: [{'stop_id': stop, 'stop_sequence': i} for i, stop in enumerate(value)] for key, value in stops.items()}
                paths = module.ShapePaths(shape_rows, trips, times, stop_rows, {})
                for key, line in lines.items():
                    for _, _, _, geometry in paths.segments(trips[key], times[key]):
                        self.assertTrue(all(paths.project_segment(point, *line)[1] <= .15 for point in geometry))

    def test_diagonal_source_bounds_use_unrounded_witnesses(self):
        spec = importlib.util.spec_from_file_location('diagonal_shapes', Path(__file__).parent.parent/'scripts/gtfs-shapes.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        starts = [(23.999998, 59.999998), (24.000002, 59.999998), (24.000001, 59.999999)]
        for ends in [[(24.009996, 60.004996), (24.010002, 60.004997), (24.010001, 60.004998)],
                     [(24.000996, 60.000496), (24.001002, 60.000497), (24.001001, 60.000498)]]:
            for reverse in [False, True]:
                with self.subTest(ends=ends, reverse=reverse):
                    lines = {f's{i}': ([end, start] if reverse else [start, end])
                             for i, (start, end) in enumerate(zip(starts, ends))}
                    points = {key+str(i): point for key, line in lines.items() for i, point in enumerate(line)}
                    patterns = {key: [(key+'0', '08:00:00'), (key+'1', '08:20:00')] for key in lines}
                    result = self.mixed_paths_feed(patterns, lines, [], points=points)
                    self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], ['R'])
                    self.assertTrue(all(row['profiles']['am']['display_tph'] is None for row in result['segments']))
                    rows = [{'shape_id': key, 'shape_pt_sequence': i, 'shape_pt_lon': point[0], 'shape_pt_lat': point[1]}
                            for key, line in lines.items() for i, point in enumerate(line)]
                    trips = {key: {'route_id': 'R', 'shape_id': key} for key in lines}
                    stops = {key: {'stop_lon': point[0], 'stop_lat': point[1]} for key, point in points.items()}
                    times = {key: [{'stop_id': key+str(i), 'stop_sequence': i} for i in (0, 1)] for key in lines}
                    paths = module.ShapePaths(rows, trips, times, stops, {})
                    for key, line in lines.items():
                        segments = paths.segments(trips[key], times[key])
                        self.assertTrue(segments)
                        self.assertTrue(all(paths.project_segment(point, *line)[1] <= .15
                                            for _, _, _, geometry in segments for point in geometry))

    def test_clipped_diagonal_paths_remain_within_original_supporting_edges(self):
        spec = importlib.util.spec_from_file_location('clipped_shapes', Path(__file__).parent.parent/'scripts/gtfs-shapes.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        source = {'0': [(24.000003, 60.000001), (24.001004, 60.000503)],
                  '1': [(23.999998, 60), (24.000995, 60.000501)],
                  '2': [(24, 60.000002), (24.001001, 60.000502)],
                  '3': [(24.000002, 60.000001), (24.001003, 60.000502)]}
        served = {'0': [(24.000140, 60.000070), (24.000901, 60.000451)],
                  '1': [(24.000135, 60.000069), (24.000892, 60.000449)],
                  '2': [(24.000137, 60.000070), (24.000898, 60.000450)],
                  '3': [(24.000139, 60.000070), (24.000900, 60.000450)]}
        for reverse in [False, True]:
            for reverse_order in [False, True]:
                with self.subTest(reverse=reverse, reverse_order=reverse_order):
                    keys = list(reversed(source)) if reverse_order else list(source)
                    lines = {key: list(reversed(source[key])) if reverse else source[key] for key in keys}
                    points = {key+str(i): point for key in keys
                              for i, point in enumerate(reversed(served[key]) if reverse else served[key])}
                    rows = [{'shape_id': key, 'shape_pt_sequence': i, 'shape_pt_lon': p[0], 'shape_pt_lat': p[1]}
                            for key, line in lines.items() for i, p in enumerate(line)]
                    trips = {key: {'route_id': 'R', 'shape_id': key} for key in keys}
                    stops = {key: {'stop_lon': p[0], 'stop_lat': p[1]} for key, p in points.items()}
                    times = {key: [{'stop_id': key+str(i), 'stop_sequence': i} for i in (0, 1)] for key in keys}
                    paths = module.ShapePaths(rows, trips, times, stops, {'eligible_trip_ids': {'0', '2'}})
                    for key, line in lines.items():
                        segments = paths.segments(trips[key], times[key])
                        self.assertTrue(segments)
                        self.assertTrue(all(paths.project_segment(p, *line)[1] <= .15
                                            for _, _, _, geometry in segments for p in geometry), key)
                    # Exercise actual contributor eligibility too, including
                    # the noncontributing alignment that exposed the drift.
                    patterns = {key: [(key+'0', '08:00:00' if key in {'0', '2'} else '10:00:00'),
                                      (key+'1', '08:20:00' if key in {'0', '2'} else '10:20:00')] for key in keys}
                    result = self.mixed_paths_feed(patterns, lines, [], points=points)
                    expected = defaultdict(float)
                    for key in keys:
                        for _, _, _, geometry in paths.segments(trips[key], times[key]):
                            expected[tuple(geometry)] += .5 if key in {'0', '2'} else 0
                    self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], [])
                    self.assertEqual({tuple(row['geometry']): row['profiles']['am']['display_tph']
                                      for row in result['segments']}, expected)
    def test_original_supporting_edge_uses_short_dateline_world_copy(self):
        spec = importlib.util.spec_from_file_location('dateline_shapes', Path(__file__).parent.parent/'scripts/gtfs-shapes.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        paths = module.ShapePaths([], {}, {}, {}, {})
        # Canonical support endpoints across the dateline are a short edge,
        # not a chord through the opposite side of the world.
        support = (('shape', 0), ((-179.999, 60), (179.999, 60)))
        self.assertLess(paths.source_error((180, 60), support), 1e-6)
        self.assertGreater(paths.source_error((0, 60), support), 1_000_000)

    def test_noncontributing_alignment_checks_original_edge_and_scopes_its_cache(self):
        spec = importlib.util.spec_from_file_location('alignment_shapes', Path(__file__).parent.parent/'scripts/gtfs-shapes.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        paths = module.ShapePaths([], {}, {}, {}, {})
        a, b = (24.000139, 60.000070), (24.000900, 60.000450)
        candidate = (24.000138, 60.000071)
        original_edge = ((24.000002, 60.000001), (24.001003, 60.000502))
        self.assertLess(paths.distance(a, candidate), .15)
        self.assertGreater(paths.project_segment(candidate, *original_edge)[1], .15)
        def path(support, first=a):
            return lambda: iter([(first, b, 0, support)])
        # Same rounded interval and served witnesses, but distinct supporting
        # edges: an accepted result for the first must not poison the second.
        compatible = (('shape', 0), (candidate, b), (a, b))
        incompatible = (('shape', 1), original_edge, (a, b))
        mapped = paths.align_noncontributing(
            {'compatible': path(compatible), 'incompatible': path(incompatible)},
            {'current': path(compatible, candidate)})
        self.assertEqual(list(mapped['compatible']())[0][:2], (candidate, b))
        self.assertEqual(list(mapped['incompatible']())[0][:2], (a, b))

    def test_half_microdegree_longitude_midpoints_never_shift_source_vertices(self):
        for longitude in [23.999998, 24, -24.000002, -24]:
            for reverse in [False, True]:
                with self.subTest(longitude=longitude, reverse=reverse):
                    points = {'A': (longitude, 60.000002), 'B': (round(longitude+.000001, 6), 60.001003)}
                    order = ['B', 'A'] if reverse else ['A', 'B']
                    result = self.mixed_paths_feed({'shape': [(order[0], '08:00:00'), (order[1], '08:20:00')]},
                        {'shape': [points[key] for key in order]}, [], points=points)
                    self.assertEqual([row['geometry'] for row in result['segments']], [[points['A'], points['B']]])
                    self.assertEqual(result['segments'][0]['profiles']['am']['display_tph'], .5)
                    self.assertEqual(result['segments'][0]['expected_directions'], [int(reverse)])

    def test_mixed_paths_reconcile_near_collinear_endpoints_and_keep_direction(self):
        a, b, c = (24, 60), (24, 60.01), (24, 60.02)
        for offset in [-.000002, -.000001, .000001, .000002]:
            for reverse in [False, True]:
                with self.subTest(offset=offset, reverse=reverse):
                    seq = ['C', 'A'] if reverse else ['A', 'C']
                    short = ['B', 'A'] if reverse else ['A', 'B']
                    patterns = {'shape': [(s, f'08:{i*20:02}:00') for i, s in enumerate(seq)],
                                'graph': [(s, f'08:{i*20:02}:00') for i, s in enumerate(short)]}
                    result = self.mixed_paths_feed(patterns,
                        {'shape': [c, a] if reverse else [a, c]},
                        [[(24+offset, 60), (24+offset, 60.02)]])
                    self.assertEqual(len(result['segments']), 2)
                    rows = sorted(result['segments'], key=lambda row: min(p[1] for p in row['geometry']))
                    self.assertEqual([r['profiles']['am']['display_tph'] for r in rows], [1, .5])
                    self.assertTrue(all(r['expected_directions'] == [int(reverse)] for r in rows))
                    for row in rows:
                        # Canonical coordinates never shift a source vertex past 15 cm.
                        self.assertTrue(all(abs(p[0]-24)*111320*.5 <= .15 for p in row['geometry']))

    def test_mixed_paths_keep_sixteen_centimetre_parallel_tracks_separate(self):
        a, c = (24, 60), (24, 60.02)
        result = self.mixed_paths_feed(
            {'shape': [('A', '08:00:00'), ('C', '08:20:00')],
             'graph': [('A', '08:10:00'), ('B', '08:20:00')]},
            {'shape': [a, c]}, [[(24.000003, 60), (24.000003, 60.02)]])
        self.assertEqual(len(result['segments']), 2)
        self.assertTrue(all(r['profiles']['am']['display_tph'] == .5 for r in result['segments']))
        self.assertTrue(all(r['expected_directions'] == [0] for r in result['segments']))
        self.assertEqual({tuple(p[0] for p in r['geometry']) for r in result['segments']},
                         {(24, 24), (24.000003, 24.000003)})

    def test_near_collinear_cut_does_not_reverse_supplied_shape_direction(self):
        result = self.mixed_paths_feed(
            {'shape': [('A', '08:00:00'), ('C', '08:20:00')],
             'graph': [('A', '08:10:00'), ('B', '08:20:00')]},
            {'shape': [(24, 60), (24, 60.02)]}, [[(24.000001, 60), (24.000001, 60.02)]])
        self.assertTrue(all(row['expected_directions'] == [0] for row in result['segments']))

    def test_near_collinear_partition_does_not_chain_across_parallel_tracks(self):
        a, b, c = (24, 60), (24, 60.01), (24, 60.02)
        e, f = (24.000002, 60), (24.000002, 60.02)
        patterns = {'shape': [('A', '08:00:00'), ('C', '08:20:00')],
                    'shape2': [('E', '08:00:00'), ('F', '08:20:00')],
                    'graph': [('A', '08:10:00'), ('B', '08:20:00')]}
        supplied = {'shape': [a, c], 'shape2': [e, f]}
        def compile(reverse):
            return self.mixed_paths_feed(dict(reversed(list(patterns.items()))) if reverse else patterns,
                dict(reversed(list(supplied.items()))) if reverse else supplied,
                [[(24.000004, 60), (24.000004, 60.02)]],
                points={'A': a, 'B': b, 'C': c, 'E': e, 'F': f})
        first, reordered = compile(False), compile(True)
        self.assertEqual(first['segments'], reordered['segments'])
        self.assertEqual(len(first['segments']), 4)
        # The middle track has two incompatible neighbours. No arbitrary pair
        # is chosen, no transitive snapping occurs, and the route stays unknown.
        rows = {tuple(map(tuple, row['geometry'])): row for row in first['segments']}
        middle = (24.000002, 60.01)
        self.assertEqual(set(rows), {(a, c), (e, middle), (middle, f), ((24.000004, 60), (24.000004, 60.01))})
        self.assertTrue(all(row['profiles']['am']['display_tph'] is None for row in rows.values()))
        self.assertTrue(all(row['expected_directions'] == [0] for row in rows.values()))

    def test_ambiguous_interior_neighbours_never_invent_cross_track_geometry(self):
        points = {'A': (24, 60), 'B': (24, 60.01), 'C': (24, 60.02),
                  'D': (24, 60.03), 'E': (23.999998, 60.01), 'F': (23.999998, 60.02)}
        for reverse in [False, True]:
            for reorder in [False, True]:
                with self.subTest(reverse=reverse, reorder=reorder):
                    stops = {'full': ['A', 'D'], 'left': ['E', 'F'], 'graph': ['B', 'C']}
                    if reverse: stops = {key: list(reversed(value)) for key, value in stops.items()}
                    patterns = {key: [(stop, f'08:{i*20:02}:00') for i, stop in enumerate(value)]
                                for key, value in stops.items()}
                    supplied = {key: [points[stop] for stop in stops[key]] for key in ['full', 'left']}
                    if reorder:
                        patterns = dict(reversed(list(patterns.items())))
                        supplied = dict(reversed(list(supplied.items())))
                    result = self.mixed_paths_feed(patterns, supplied,
                        [[(24.000002, 60), (24.000002, 60.03)]], points=points)
                    for row in result['segments']:
                        a, b = row['geometry']
                        self.assertEqual(a[0], b[0], 'never connect separate tracks at equal progress')
                        self.assertLess(a[1], b[1], 'each interval makes positive progress')
                        self.assertEqual(row['expected_directions'], [int(reverse)])
                    rows = {tuple(map(tuple, row['geometry'])) for row in result['segments']}
                    self.assertIn(((24.000002, 60.01), (24.000002, 60.02)), rows)
                    self.assertIn((points['E'], points['F']), rows)
                    self.assertTrue(all(row['profiles']['am']['display_tph'] is None for row in result['segments']),
                                    'ambiguous shared ownership must not publish a known rate')
                    self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], ['R'])

    def test_distinct_graph_paths_cannot_share_a_mode_wide_geometry_owner(self):
        points = {'A': (24, 60), 'D': (24, 60.03),
                  'E': (23.999998, 60.01), 'F': (23.999998, 60.02),
                  'G': (24.000002, 60.01), 'H': (24.000002, 60.02)}
        expected = {((24, 60), (24, 60.01)), ((24, 60.01), (24, 60.02)),
                    ((24, 60.02), (24, 60.03)), (points['E'], points['F']), (points['G'], points['H'])}
        for reverse in [False, True]:
            for reorder in [False, True]:
                with self.subTest(reverse=reverse, reorder=reorder):
                    stops = {'full': ['A', 'D'], 'left': ['E', 'F'], 'right': ['G', 'H']}
                    if reverse: stops = {key: list(reversed(value)) for key, value in stops.items()}
                    patterns = {key: [(stop, f'08:{i*20:02}:00') for i, stop in enumerate(value)]
                                for key, value in stops.items()}
                    if reorder: patterns = dict(reversed(list(patterns.items())))
                    result = self.mixed_paths_feed(patterns,
                        {'full': [points[stop] for stop in stops['full']]},
                        [[points['E'], points['F']], [points['G'], points['H']]], points=points)
                    rows = {tuple(map(tuple, row['geometry'])): row for row in result['segments']}
                    self.assertEqual(set(rows), expected)
                    self.assertTrue(all(row['expected_directions'] == [int(reverse)] for row in rows.values()))
                    self.assertTrue(all(row['profiles']['am']['display_tph'] is None for row in rows.values()))
                    self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], ['R'])
                    self.assertEqual(result['source']['geometry_audit']['withheld_trips']['ambiguous_shared_geometry'], 3)

    def test_full_and_short_graph_paths_keep_dense_source_continuity(self):
        points = {'A': (24, 60), 'B': (24, 60.01), 'C': (24, 60.000002)}
        line = [points['A'], (24.000001, 60.000001), points['C'], points['B']]
        expected = {tuple(sorted(edge)) for edge in zip(line, line[1:])}
        for reverse in [False, True]:
            with self.subTest(reverse=reverse):
                stops = {'full': ['A', 'B'], 'short': ['A', 'C']}
                if reverse: stops = {key: list(reversed(value)) for key, value in stops.items()}
                patterns = {key: [(stop, f'08:{i*20:02}:00') for i, stop in enumerate(value)]
                            for key, value in stops.items()}
                result = self.mixed_paths_feed(patterns, {}, [line], points=points)
                rows = {tuple(map(tuple, row['geometry'])): row for row in result['segments']}
                self.assertEqual(set(rows), expected)
                for edge, row in rows.items():
                    self.assertEqual(row['profiles']['am']['display_tph'],
                        .5 if edge == (points['C'], points['B']) else 1)
                self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], [])

    def test_adjacent_graph_workings_preserve_a_shared_degree_two_bend(self):
        points = {'A': (24, 59.99), 'M': (24.000001, 60.000001), 'B': (24, 60.01)}
        line = [points['A'], (24, 60), points['M'], (24, 60.000002), points['B']]
        expected = {tuple(sorted(edge)) for edge in zip(line, line[1:])}
        for reverse in [False, True]:
            for reorder in [False, True]:
                with self.subTest(reverse=reverse, reorder=reorder):
                    stops = {'before': ['A', 'M'], 'after': ['M', 'B']}
                    if reverse: stops = {key: list(reversed(value)) for key, value in stops.items()}
                    patterns = {key: [(stop, f'08:{i*20:02}:00') for i, stop in enumerate(value)]
                                for key, value in stops.items()}
                    if reorder: patterns = dict(reversed(list(patterns.items())))
                    result = self.mixed_paths_feed(patterns, {}, [line], points=points)
                    rows = {tuple(map(tuple, row['geometry'])): row for row in result['segments']}
                    self.assertEqual(set(rows), expected)
                    self.assertTrue(all(row['profiles']['am']['display_tph'] == .5 for row in rows.values()))
                    self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], [])

    def test_ambiguous_geometry_withholding_is_active_pattern_and_route_scoped(self):
        points = {'A': (24, 60), 'B': (24, 60.01), 'C': (24, 60.02),
                  'D': (24, 60.03), 'E': (23.999998, 60.01), 'F': (23.999998, 60.02),
                  'G': (25, 60), 'H': (25, 60.01), 'I': (26, 60), 'J': (26, 60.01)}
        patterns = {key: [(a, '08:00:00'), (b, '08:20:00')] for key, a, b in
                    [('full', 'A', 'D'), ('left', 'E', 'F'), ('graph', 'B', 'C'),
                     ('same-route', 'G', 'H'), ('other-route', 'I', 'J')]}
        supplied = {key: [points[a], points[b]] for key, a, b in
                    [('full', 'A', 'D'), ('left', 'E', 'F'), ('same-route', 'G', 'H'), ('other-route', 'I', 'J')]}
        for inactive_date in [None, '20261002', '20261101']:
            with self.subTest(inactive_date=inactive_date):
                fields = {'other-route': {'route_id': 'Q'}}
                if inactive_date:
                    fields.update({key: {'service_id': 'other'} for key in ['full', 'left', 'graph']})
                result = self.mixed_paths_feed(patterns, supplied,
                    [[(24.000002, 60), (24.000002, 60.03)]], points=points,
                    trip_fields=fields, exceptions=([{'service_id': 'other', 'date': inactive_date,
                                                      'exception_type': '1'}] if inactive_date else None))
                rows = {tuple(map(tuple, row['geometry'])): row for row in result['segments']}
                self.assertEqual(rows[(points['I'], points['J'])]['profiles']['am']['display_tph'], .5)
                self.assertEqual(rows[(points['G'], points['H'])]['profiles']['am']['display_tph'], .5 if inactive_date else None)
                audit = result['source']['geometry_audit']
                self.assertEqual(audit['routes_with_incomplete_active_geometry'], [] if inactive_date else ['R'])
                self.assertEqual(audit['withheld_trips'].get('ambiguous_shared_geometry', 0), 0 if inactive_date else 3)

    def test_dense_collinear_vertices_are_not_ambiguous_parallel_tracks(self):
        points = {'A': (24, 60), 'B': (24, 60.01)}
        dense = [(24, 60+i*.000001) for i in range(4)] + [points['B']]
        result = self.mixed_paths_feed({'shape': [('A', '08:00:00'), ('B', '08:20:00')]},
            {'shape': dense}, [], points=points)
        self.assertTrue(result['segments'])
        self.assertTrue(all(row['profiles']['am']['display_tph'] == .5 for row in result['segments']))
        self.assertTrue(all(row['geometry'][0][0] == row['geometry'][1][0] == 24 for row in result['segments']))
        self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], [])

    def test_competing_paths_are_scoped_to_route_and_contributing_calendar(self):
        points = {'A': (24, 60), 'B': (24, 60.01), 'C': (24, 60.02),
                  'D': (24, 60.03), 'E': (23.999998, 60.01), 'F': (23.999998, 60.02)}
        patterns = {'full': [('A', '08:00:00'), ('D', '08:30:00')],
                    'left': [('E', '08:00:00'), ('F', '08:20:00')],
                    'graph': [('B', '08:00:00'), ('C', '08:20:00')]}
        supplied = {'full': [points['A'], points['D']], 'left': [points['E'], points['F']]}
        calendar = {'start_date': '20260101', 'end_date': '20261231',
                    **{day: '1' for day in ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']}}
        cases = [('other-route', {'trip_fields': {'left': {'route_id': 'Q'}, 'graph': {'route_id': 'Q'}}})]
        for date in ['20261002', '20261101']:
            cases.append((date, {'trip_fields': {key: {'service_id': 'other'} for key in ['left', 'graph']},
                'exceptions': [{'service_id': 'other', 'date': date, 'exception_type': '1'}]}))
        for removed in [False, True]:
            cases.append(('removed' if removed else 'inactive-weekday', {
                'trip_fields': {key: {'service_id': 'other'} for key in ['left', 'graph']},
                'calendar_rows': [{'service_id': 'W', **calendar}, {'service_id': 'other', **calendar,
                                  'monday': '1' if removed else '0'}],
                'exceptions': [{'service_id': 'other', 'date': '20261005', 'exception_type': '2'}] if removed else None}))
        for label, options in cases:
            with self.subTest(case=label):
                result = self.mixed_paths_feed(patterns, supplied,
                    [[(24.000002, 60), (24.000002, 60.03)]], points=points, **options)
                current = [row for row in result['segments'] if all(p[0] == 24 for p in row['geometry'])]
                self.assertTrue(current)
                self.assertTrue(all(row['route_id'] == 'R' and row['profiles']['am']['display_tph'] == .5 for row in current))
                self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], [])
                self.assertNotIn('ambiguous_shared_geometry', result['source']['geometry_audit']['withheld_trips'])
        # Sunday's 25-hour workings are still current contributors even when
        # Monday's service is removed; ordinary calendar-day filtering is wrong.
        overnight = {'full': [('A', '01:00:00'), ('D', '01:30:00')],
                     'left': [('E', '25:00:00'), ('F', '25:20:00')],
                     'graph': [('B', '25:00:00'), ('C', '25:20:00')]}
        result = self.mixed_paths_feed(overnight, supplied,
            [[(24.000002, 60), (24.000002, 60.03)]], points=points,
            trip_fields={key: {'service_id': 'other'} for key in ['left', 'graph']},
            calendar_rows=[{'service_id': key, **calendar} for key in ['W', 'other']],
            exceptions=[{'service_id': 'other', 'date': '20261005', 'exception_type': '2'}],
            profiles={'overnight': {'start': '00:00:00', 'end': '02:00:00'}})
        self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], ['R'])
        self.assertTrue(all(row['profiles']['overnight']['display_tph'] is None for row in result['segments']))

    def test_one_dense_bending_polyline_retains_its_geometry_and_known_counts(self):
        points = {'A': (24, 60), 'B': (24, 60.01)}
        line = [(24, 60), (24.000001, 60.000001), (24, 60.000002), (24, 60.01)]
        for reverse in [False, True]:
            shape = list(reversed(line)) if reverse else line
            result = self.mixed_paths_feed({'shape': [('B' if reverse else 'A', '08:00:00'),
                                                     ('A' if reverse else 'B', '08:20:00')]},
                {'shape': shape}, [], points=points)
            expected = {tuple(sorted((a, b))): int(a > b) for a, b in zip(shape, shape[1:])}
            rows = {tuple(map(tuple, row['geometry'])): row for row in result['segments']}
            self.assertEqual(set(rows), set(expected))
            for edge, row in rows.items():
                self.assertEqual(row['profiles']['am']['display_tph'], .5)
                self.assertEqual(row['expected_directions'], [expected[edge]])
            self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], [])

    def test_dense_source_sampling_does_not_make_a_second_path_ambiguous(self):
        points = {'A': (24, 60), 'B': (24, 60.01)}
        line = [(24, 60), (24.000001, 60.000001), (24, 60.000002), (24, 60.01)]
        expected = {tuple(sorted(edge)) for edge in zip(line, line[1:])}
        expected.update({((24, 60), (24, 60.000001)), ((24, 60.000001), (24, 60.000002))})
        for reverse in [False, True]:
            for graph_first in [False, True]:
                with self.subTest(reverse=reverse, graph_first=graph_first):
                    sequence = [('B' if reverse else 'A', '08:00:00'),
                                ('A' if reverse else 'B', '08:20:00')]
                    patterns = {key: sequence for key in (['graph', 'shape'] if graph_first else ['shape', 'graph'])}
                    result = self.mixed_paths_feed(patterns, {'shape': list(reversed(line)) if reverse else line},
                        [[points['A'], points['B']]], points=points)
                    rows = {tuple(map(tuple, row['geometry'])): row for row in result['segments']}
                    self.assertEqual(set(rows), expected)
                    for edge, row in rows.items():
                        # The real bend is retained; only the common remainder
                        # can be one shared geometric measurement.
                        self.assertEqual(row['profiles']['am']['display_tph'],
                            1 if edge == ((24, 60.000002), (24, 60.01)) else .5)
                    self.assertEqual(rows[((24, 60.000002), (24, 60.01))]['expected_directions'], [int(reverse)])
                    self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], [])

    def test_unused_shape_tail_cannot_manufacture_competing_workings(self):
        points = {'A': (24, 60), 'B': (24, 60.01), 'C': (24, 60.02),
                  'D': (24, 60.03), 'E': (23.999998, 60.02), 'F': (23.999998, 60.03)}
        result = self.mixed_paths_feed(
            {'short': [('A', '08:00:00'), ('B', '08:10:00')],
             'left': [('E', '08:00:00'), ('F', '08:10:00')],
             'graph': [('C', '08:00:00'), ('D', '08:10:00')]},
            {'short': [points['A'], points['D']], 'left': [points['E'], points['F']]},
            [[(24.000002, 60), (24.000002, 60.03)]], points=points)
        self.assertTrue(all(row['profiles']['am']['display_tph'] == .5 for row in result['segments']))
        self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], [])

    def test_near_collinear_partition_threshold_uses_local_latitude(self):
        a, b, c = (24, 80), (24, 80.01), (24, 80.02)
        patterns = {'shape': [('A', '08:00:00'), ('C', '08:20:00')],
                    'graph': [('A', '08:10:00'), ('B', '08:20:00')]}
        for offset, shared in [(.000005, True), (.000008, False)]:
            with self.subTest(offset=offset):
                result = self.mixed_paths_feed(patterns, {'shape': [a, c]},
                    [[(24+offset, 80), (24+offset, 80.02)]], points={'A': a, 'B': b, 'C': c})
                self.assertEqual(len(result['segments']), 2)
                rates = sorted(row['profiles']['am']['display_tph'] for row in result['segments'])
                self.assertEqual(rates, [.5, 1] if shared else [.5, .5])
                self.assertTrue(all(row['expected_directions'] == [0] for row in result['segments']))

    def test_mixed_paths_keep_inactive_calendar_variants_out_of_current_counts(self):
        a, b, c = (24, 60), (24, 60.01), (24, 60.02)
        patterns = {'shape': [('A', '08:00:00'), ('C', '08:20:00')],
                    'graph': [('B', '08:10:00'), ('A', '08:20:00')]}
        for date in ['20261002', '20261101']:
            with self.subTest(inactive_date=date):
                result = self.mixed_paths_feed(patterns, {'shape': [a, c]}, [[a, c]],
                    trip_fields={'graph': {'service_id': 'other'}},
                    exceptions=[{'service_id': 'other', 'date': date, 'exception_type': '1'}])
                rows = {tuple(map(tuple, s['geometry'])): s for s in result['segments']}
                self.assertEqual(set(rows), {(a, b), (b, c)})
                self.assertTrue(all(row['expected_directions'] == [0] for row in rows.values()))
                self.assertTrue(all(row['profiles']['am']['display_tph'] == .5 for row in rows.values()))
                self.assertEqual(rows[(a, b)]['valid_until'], rows[(b, c)]['valid_until'])

    def test_mixed_paths_keep_repeated_graph_traversals_and_original_anchors(self):
        a, b, c = (24, 60), (24, 60.01), (24, 60.02)
        patterns = {'shape': [('A', '08:00:00'), ('B', '08:20:00')],
                    'graph': [('A', '08:00:00'), ('C', '08:10:00'),
                              ('A', '08:20:00'), ('C', '08:30:00')]}
        result = self.mixed_paths_feed(patterns, {'shape': [a, b]}, [[a, c]])
        rows = {tuple(map(tuple, s['geometry'])): s['profiles']['am'] for s in result['segments']}
        self.assertEqual(set(rows), {(a, b), (b, c)})
        self.assertEqual((rows[(a, b)]['forward_tph'], rows[(a, b)]['backward_tph']), (1.5, .5))
        self.assertEqual((rows[(b, c)]['forward_tph'], rows[(b, c)]['backward_tph']), (1, .5))

    def test_mixed_paths_never_merge_nearby_parallel_track_or_fabricate_missing_path(self):
        a, b, c = (24, 60), (24, 60.01), (24, 60.02)
        e, f = (24.0001, 60), (24.0001, 60.02)
        patterns = {'shape': [('E', '08:00:00'), ('F', '08:20:00')],
                    'graph': [('A', '08:10:00'), ('B', '08:20:00')]}
        result = self.mixed_paths_feed(patterns, {'shape': [e, f]}, [[a, c]],
            points={'A': a, 'B': b, 'E': e, 'F': f})
        rows = {tuple(map(tuple, s['geometry'])): s for s in result['segments']}
        self.assertEqual(set(rows), {(a, b), (e, f)})
        self.assertTrue(all(row['profiles']['am']['display_tph'] == .5 for row in rows.values()))
        result = self.mixed_paths_feed(patterns, {'shape': [e, f]}, [],
            points={'A': a, 'B': b, 'E': e, 'F': f})
        self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'], ['R'])
        self.assertEqual([s['geometry'] for s in result['segments']], [[e, f]])
        self.assertIsNone(result['segments'][0]['profiles']['am']['display_tph'])

    def test_shape_geometry_branches_express_and_reverse_density(self):
        result=compiler.compile_feed(self.shape_feed(),CONFIG,'2026-10-05',geometry=True)
        trunk=[s for s in result['segments'] if all(p[0]==24 and p[1]<=60.01 for p in s['geometry'])]
        self.assertTrue(trunk)
        # Three forward trains, two reverse trains over the common trunk.
        for segment in trunk:
            self.assertEqual(segment['profiles']['am']['forward_tph'],1.5)
            self.assertEqual(segment['profiles']['am']['backward_tph'],1)
            self.assertEqual(segment['profiles']['am']['display_tph'],1)
        branch=[s for s in result['segments'] if any(p[0]>24.009 for p in s['geometry'])]
        self.assertEqual(len(branch),1)
        self.assertEqual(branch[0]['profiles']['am']['display_tph'],.5)
        self.assertTrue(any((24.005,60.015) in s['geometry'] for s in result['segments']))
        self.assertEqual(result['source']['geometry_audit']['withheld_trips'],{})
        self.assertGreater(result['source']['valid_until'],0)

    def test_missing_shape_does_not_create_chords_or_undercount_route(self):
        result=compiler.compile_feed(self.shape_feed(missing=True),CONFIG,'2026-10-05',geometry=True)
        self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'],['R'])
        self.assertTrue(all(s['profiles']['am']['display_tph'] is None for s in result['segments']))

    def test_shapeless_feed_follows_existing_curved_tracks_and_keeps_unmapped_rates(self):
        path=self.shape_feed()
        with zipfile.ZipFile(path) as z:files={n:z.read(n) for n in z.namelist() if n!='shapes.txt'}
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items():z.writestr(name,data)
        graph=path.parent/'graph.ndjson.gz'
        lines=[[(24,60),(24,60.01),(24.005,60.015),(24,60.02)],[(24,60.01),(24.01,60.01)]]
        with gzip.open(graph,'wt') as file:
            for points in lines:file.write(json.dumps({'type':'Feature','properties':{'feature':'subway','state':'present'},'geometry':{'type':'LineString','coordinates':points}})+'\n')
        config={**CONFIG,'rail_graph':str(graph),'include_unmapped':True}
        result=compiler.compile_feed(path,config,'2026-10-05',geometry=True)
        self.assertTrue(result['segments'])
        self.assertTrue(any((24.005,60.015) in s['geometry'] for s in result['segments']))
        self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'],[])
        self.assertGreater(result['source']['geometry_audit']['matched_railway_patterns'],0)
        # A rail feed cannot be mapped onto metro infrastructure.
        with gzip.open(graph,'wt') as file:
            for points in lines:file.write(json.dumps({'type':'Feature','properties':{'feature':'rail','state':'present'},'geometry':{'type':'LineString','coordinates':points}})+'\n')
        result=compiler.compile_feed(path,config,'2026-10-05',geometry=True)
        self.assertEqual(result['segments'],[])
        self.assertTrue(result['unmapped_segments'])
        self.assertTrue(any(s['profiles']['am']['display_tph'] is not None for s in result['unmapped_segments']))

    def test_hourly_and_overnight_profiles_use_local_time_and_prior_service_days(self):
        patterns={name:[('A',start),('B',end)] for name,start,end in [
            ('late','25:30:00','25:40:00'),('boundary','02:00:00','02:10:00'),
            ('morning','05:00:00','05:10:00'),('evening','23:30:00','23:40:00')]}
        path=self.feed(patterns,patterns)
        with zipfile.ZipFile(path) as z:files={n:z.read(n) for n in z.namelist()}
        files['agency.txt']=files['agency.txt'].replace(b'Europe/Helsinki',b'America/New_York')
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items():z.writestr(name,data)
        profiles=json.loads((Path(__file__).parent.parent/'styles/data-src/frequency-source-rules.json').read_text())['profiles']
        result=compiler.compile_feed(path,{**CONFIG,'profiles':profiles},'2026-10-05')
        rates=result['segments'][0]['profiles']
        self.assertEqual(len(rates),28)
        self.assertEqual(rates['h01']['display_tph'],1) # Sunday's 25:30 is Monday's 01:30.
        self.assertEqual(rates['h02']['display_tph'],1) # 02:00 is excluded from h01.
        self.assertEqual(rates['h05']['display_tph'],1) # 05:00 is excluded from overnight.
        self.assertEqual(rates['h23']['display_tph'],1)
        self.assertEqual(rates['h00']['display_tph'],0)
        self.assertAlmostEqual(rates['overnight']['display_tph'],.4) # Two departures / five hours.

    def test_service_times_over_48_hours_include_older_days(self):
        patterns={'t':[('A','49:00:00'),('B','49:10:00')]}
        path=self.feed(patterns,patterns)
        # Enable Saturday; the Monday 01:00 event belongs to Saturday's trip.
        with zipfile.ZipFile(path) as z:files={n:z.read(n) for n in z.namelist()}
        text=files['calendar.txt'].decode().replace(',1,1,1,1,1,0,1,',',1,1,1,1,1,1,1,')
        files['calendar.txt']=text.encode()
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items():z.writestr(name,data)
        result=compiler.compile_feed(path,{**CONFIG,'profiles':{'early':{'start':'01:00:00','end':'02:00:00'}}},'2026-10-05')
        self.assertEqual(result['segments'][0]['profiles']['early']['display_tph'],1)

    def test_shapeless_modes_sharing_stops_keep_separate_paths_and_unmapped_rates(self):
        patterns={key:[('A','08:00:00'),('B','08:10:00')] for key in ['rail','subway']}
        path=self.feed(patterns,patterns)
        with zipfile.ZipFile(path) as z:files={n:z.read(n) for n in z.namelist()}
        files['routes.txt']=b'route_id,route_type,agency_id\nrail,2,A\nsubway,1,A\n'
        files['trips.txt']=b'trip_id,route_id,service_id\nrail,rail,W\nsubway,subway,W\n'
        with zipfile.ZipFile(path,'w') as z:
            for name,data in files.items():z.writestr(name,data)
        graph=path.parent/'graph.ndjson.gz'
        def write_graph(modes):
            with gzip.open(graph,'wt') as file:
                for mode in modes:
                    midpoint=24.001 if mode=='rail' else 23.999
                    file.write(json.dumps({'type':'Feature','properties':{'feature':mode},'geometry':{'type':'LineString','coordinates':[[24,60],[midpoint,60.005],[24,60.01]]}})+'\n')
        config={**CONFIG,'rail_graph':str(graph),'include_unmapped':True}
        write_graph(['rail','subway'])
        result=compiler.compile_feed(path,config,'2026-10-05',geometry=True)
        self.assertEqual({s['route_id'] for s in result['segments']},{'rail','subway'})
        for mode,midpoint in [('rail',24.001),('subway',23.999)]:
            segments=[s for s in result['segments'] if s['route_id']==mode]
            self.assertTrue(any((midpoint,60.005) in s['geometry'] for s in segments))
            self.assertTrue(all(s['profiles']['am']['display_tph']==.5 for s in segments))
        self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'],[])
        write_graph(['rail'])
        result=compiler.compile_feed(path,config,'2026-10-05',geometry=True)
        self.assertEqual({s['route_id'] for s in result['segments']},{'rail'})
        self.assertEqual(result['source']['geometry_audit']['routes_with_incomplete_active_geometry'],['subway'])
        self.assertEqual({s['route_id'] for s in result['unmapped_segments']},{'subway'})
        self.assertTrue(all(s['profiles']['am']['display_tph']==.5 for s in result['unmapped_segments']))

    def test_long_frequency_template_includes_anchor_delay_in_prior_day_bound(self):
        patterns={'t':[('A','00:00:00'),('B','50:00:00'),('C','50:10:00')]}
        frequency=[{'trip_id':'t','start_time':'00:00:00','end_time':'49:00:00','headway_secs':'3600','exact_times':'1'}]
        config={**CONFIG,'profiles':{'early':{'start':'01:00:00','end':'02:00:00'}}}
        # Friday's instance is removed; Thursday's delayed train is the only event.
        result=compiler.compile_feed(self.feed(patterns,patterns,frequency,exceptions=[{'service_id':'W','date':'20261002','exception_type':'2'}]),config,'2026-10-05')
        segment=next(s for s in result['segments'] if s['stops']==['B','C'])
        self.assertEqual(segment['profiles']['early']['display_tph'],1)

    def test_calendar_route_variants_consolidate_but_disconnected_names_do_not(self):
        routes={key:{'route_id':key,'route_type':'1','agency_id':'A','route_short_name':'1'} for key in ['a','b','other']}
        trips={key:{'route_id':key} for key in routes}
        times={'a':[{'stop_id':'A'},{'stop_id':'B'}],'b':[{'stop_id':'B'},{'stop_id':'C'}],'other':[{'stop_id':'D'},{'stop_id':'E'}]}
        result=compiler.canonical_routes(routes,trips,times,{key:{} for key in 'ABCDE'})
        self.assertEqual(set(result),{'a','other'})
        self.assertEqual(result['a']['source_route_ids'],['a','b'])
        self.assertEqual(trips['b']['route_id'],'a')

    def test_incomplete_single_stop_trip_withholds_affected_route_instead_of_entire_feed(self):
        patterns={'valid':[('A','08:00:00'),('B','08:10:00')],'bad':[('A','08:30:00')]}
        result=compiler.compile_feed(self.feed(patterns,patterns),CONFIG,'2026-10-05')
        self.assertTrue(result['segments'])
        self.assertIsNone(result['segments'][0]['profiles']['am']['display_tph'])

    def test_shared_trunk_branches_and_directions(self):
        patterns={'t1':[('A','08:00:00'),('B','08:10:00'),('C','08:20:00')],
                  't2':[('A','08:30:00'),('B','08:40:00'),('D','08:50:00')],
                  't3':[('C','08:00:00'),('B','08:10:00'),('A','08:20:00')],
                  't4':[('D','08:30:00'),('B','08:40:00'),('A','08:50:00')]}
        result=compiler.compile_feed(self.feed(patterns,patterns),CONFIG,'2026-10-05')
        rates={tuple(s['stops']):s['profiles']['am'] for s in result['segments']}
        self.assertEqual(rates[('A','B')]['display_tph'],1)
        self.assertEqual(rates[('B','C')]['display_tph'],.5)
        self.assertEqual(rates[('B','D')]['display_tph'],.5)
        self.assertEqual(rates[('A','B')]['forward_tph'],1)
        self.assertEqual(rates[('A','B')]['backward_tph'],1)

    def test_frequency_templates_and_anchor_shift(self):
        patterns={'t':[('A','00:00:00'),('B','00:30:00'),('C','00:40:00')]}
        for exact in ['0','1']:
            freq=[{'trip_id':'t','start_time':'07:00:00','end_time':'09:00:00','headway_secs':'600','exact_times':exact}]
            result=compiler.compile_feed(self.feed(patterns,patterns,freq),CONFIG,'2026-10-05')
            rates={tuple(s['stops']):s['profiles']['am'] for s in result['segments']}
            self.assertEqual(rates[('A','B')]['display_tph'],6)
            self.assertEqual(rates[('B','C')]['display_tph'],4.5)
            self.assertEqual(rates[('A','B')]['quality'],'scheduled' if exact=='1' else 'headway_estimate')

    def test_calendar_exception_zero_and_missing_time(self):
        patterns={'t':[('A','08:00:00'),('B','08:10:00')]}
        exceptions=[{'service_id':'W','date':'20261005','exception_type':'2'}]
        result=compiler.compile_feed(self.feed(patterns,patterns,exceptions=exceptions),CONFIG,'2026-10-05')
        self.assertEqual(result['segments'][0]['profiles']['am']['display_tph'],0)
        result=compiler.compile_feed(self.feed(patterns,patterns,blank=True),CONFIG,'2026-10-05')
        self.assertIsNone(result['segments'][0]['profiles']['am']['display_tph'])
        self.assertEqual(result['segments'][0]['profiles']['am']['quality'],'unknown')

    def test_prior_service_day_and_half_open_window(self):
        patterns={'t':[('A','25:00:00'),('B','25:10:00')], 'end':[('A','26:00:00'),('B','26:10:00')]}
        config={**CONFIG,'profiles':{'early':{'start':'01:00:00','end':'02:00:00'}}}
        result=compiler.compile_feed(self.feed(patterns,patterns),config,'2026-10-05')
        self.assertEqual(result['segments'][0]['profiles']['early']['display_tph'],1)

    def test_overlaps_expiry_and_dst_fail_explicitly(self):
        patterns={'t':[('A','00:00:00'),('B','00:10:00')]}
        frequencies=[{'trip_id':'t','start_time':start,'end_time':end,'headway_secs':'600','exact_times':'0'} for start,end in [('07:00:00','09:00:00'),('08:00:00','10:00:00')]]
        with self.assertRaisesRegex(ValueError,'Overlapping'):
            compiler.compile_feed(self.feed(patterns,patterns,frequencies),CONFIG,'2026-10-05')
        with self.assertRaisesRegex(ValueError,'outside'):
            compiler.compile_feed(self.feed(patterns,patterns),CONFIG,'2027-01-01')
        config={**CONFIG,'profiles':{'ambiguous':{'start':'03:30:00','end':'04:30:00'}}}
        with self.assertRaisesRegex(ValueError,'DST'):
            compiler.compile_feed(self.feed(patterns,patterns),config,'2026-10-25')


if __name__=='__main__':unittest.main()
