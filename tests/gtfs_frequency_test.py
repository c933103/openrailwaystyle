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
