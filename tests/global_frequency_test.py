import csv
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

spec=importlib.util.spec_from_file_location('global_frequency',Path(__file__).parent.parent/'scripts/global-service-frequency.py')
pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)


class GlobalFrequency(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)

    def test_discovery_covers_non_latin_names_licences_and_exclusions_without_city_choices(self):
        countries=['DE','JP','BR','EG','NZ','CA','CN','RU','IR','KP']
        rows=[{'filename':c.lower()+'_鉄道.gtfs.zip','source':'https://example.org/'+c+'.zip','country_code':c,'spdx_license_identifier':'CC-BY-4.0'} for c in countries]
        rows.append({'filename':'unknown.gtfs.zip','source':'https://example.org/u.zip','country_code':'US'})
        result=pipeline.discover(rows,{})
        self.assertEqual(len(result),len(rows))
        self.assertEqual({r['country'] for r in result if r['status']=='pending'},set(countries)-pipeline.EXCLUDED)
        self.assertEqual(len({r['id'] for r in result}),len(rows))
        self.assertTrue(all('/' not in r['id'] for r in result))
        self.assertTrue(next(r for r in result if r['country']=='US')['reason'].startswith('redistribution'))

    def archive(self,rail=True):
        data=io.BytesIO()
        with zipfile.ZipFile(data,'w',compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr('routes.txt','route_id,route_type,agency_id,route_short_name\nr,2,a,R\n' if rail else 'route_id,route_type\nb,3\n')
            z.writestr('agency.txt','agency_id,agency_name,agency_timezone\na,National Rail,Etc/UTC\n')
            z.writestr('feed_info.txt','feed_start_date,feed_end_date\n20260101,20261231\n')
            z.writestr('stops.txt','stop_id,stop_name,stop_lat,stop_lon\nA,A,30,31\nB,B,30.01,31\n')
            z.writestr('trips.txt','trip_id,route_id,service_id\nt,r,w\n')
            z.writestr('stop_times.txt','trip_id,stop_sequence,stop_id,departure_time\nt,1,A,08:00:00\nt,2,B,08:10:00\n')
            z.writestr('calendar.txt','service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nw,1,1,1,1,1,1,1,20260101,20261231\n')
            z.writestr('unused-padding.bin',bytes(range(256))*2000)
        return data.getvalue()

    def server(self,data,ranges=True,change=False,last_modified=False):
        held={'requests':[],'conditional_requests':[],'range_validators':[],'etag':None if last_modified else '"one"','last_modified':'Mon, 01 Jun 2026 00:00:00 GMT' if last_modified else None,'data':data}
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                data=held['data']
                range_value=self.headers.get('Range');held['requests'].append(range_value)
                validator=self.headers.get('If-Range');held['range_validators'].append(validator)
                held['conditional_requests'].append((self.headers.get('If-None-Match'),self.headers.get('If-Modified-Since')))
                if held['etag'] and self.headers.get('If-None-Match')==held['etag'] or held['last_modified'] and self.headers.get('If-Modified-Since')==held['last_modified']:
                    self.send_response(304);self.end_headers();return
                if change and len(held['requests'])>1:held['etag']='"two"'
                if ranges and range_value and (not validator or not validator.startswith('W/') and validator in [held['etag'],held['last_modified']]):
                    value=range_value.split('=')[1]
                    if value.startswith('-'):start,end=max(0,len(data)-int(value[1:])),len(data)-1
                    else:start,end=map(int,value.split('-'));end=min(end,len(data)-1)
                    body=data[start:end+1];self.send_response(206);self.send_header('Content-Range',f'bytes {start}-{end}/{len(data)}')
                else:body=data;self.send_response(200)
                self.send_header('Content-Length',str(len(body)))
                if held['etag']:self.send_header('ETag',held['etag'])
                if held['last_modified']:self.send_header('Last-Modified',held['last_modified'])
                self.end_headers();self.wfile.write(body)
            def log_message(self,*args):pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        return 'http://127.0.0.1:'+str(server.server_port)+'/feed.zip',held

    def test_range_inspection_full_fallback_and_revision_changes(self):
        data=self.archive()
        url,held=self.server(data)
        remote=pipeline.RemoteZip(url,1_000_000)
        self.assertIn(b'National',remote.table('agency.txt'))
        self.assertTrue(all(held['requests']))
        self.assertEqual(remote.download(),data)
        url,_=self.server(data,ranges=False)
        self.assertIn(b'route_id',pipeline.RemoteZip(url,1_000_000).table('routes.txt'))
        with self.assertRaisesRegex(ValueError,'budget'):pipeline.RemoteZip(url,100)
        url,_=self.server(data,change=True)
        remote=pipeline.RemoteZip(url,1_000_000)
        with self.assertRaisesRegex(ValueError,'changed'):remote.table('routes.txt')

    def test_bus_filter_and_shapeless_frequency_data_are_real_pipeline_outputs(self):
        cache,output=self.root/'cache',self.root/'out';cache.mkdir()
        row={'filename':'eg_rail.gtfs.zip','source':'https://example.org/feed.zip','country_code':'EG','human_name':'National Rail','spdx_license_identifier':'CC-BY-4.0'}
        entry=pipeline.discover([row],{})[0]
        url,_=self.server(self.archive(rail=False));entry['processed_url']=url
        result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(result['status'],'no_rail');self.assertFalse((cache/'eg_rail.zip').exists())
        url,_=self.server(self.archive());entry['processed_url']=url
        result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(result['status'],'compiled');self.assertEqual(result['mapped_segments'],0);self.assertGreater(result['unmapped_segments'],0)
        import gzip
        with gzip.open(output/result['output'],'rt') as file:feed=json.load(file)
        self.assertEqual(feed['unmapped_segments'][0]['profiles']['am']['display_tph'],.5)
        self.assertIn('National Rail',feed['source']['attribution'])
        retrieved=feed['source']['retrieved']
        result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(result['source']['retrieved'],retrieved)

    def test_weak_etags_use_date_ranges_or_a_bounded_whole_revision(self):
        data=self.archive()
        for date_validator in [False,True]:
            with self.subTest(date_validator=date_validator):
                url,held=self.server(data,last_modified=date_validator)
                held['etag']='W/"one"'
                remote=pipeline.RemoteZip(url,1_000_000)
                self.assertIn(b'National',remote.table('agency.txt'))
                self.assertEqual(remote.download(),data)
                self.assertEqual(remote.etag,'W/"one"')
                self.assertFalse(any(v and v.startswith('W/') for v in held['range_validators']))
                if date_validator:
                    self.assertIn(held['last_modified'],held['range_validators'])
                else:
                    self.assertEqual(held['requests'],['bytes=-65557',None])
        # The fallback retains the same byte budget as a range-capable feed.
        with self.assertRaisesRegex(ValueError,'budget'):
            pipeline.RemoteZip(url,100)

    def test_changed_cached_rail_archive_is_reclassified_when_bus_only(self):
        cache,output=self.root/'cache',self.root/'out';cache.mkdir()
        row={'filename':'eg_rail.gtfs.zip','source':'https://example.org/feed.zip','country_code':'EG','spdx_license_identifier':'CC-BY-4.0'}
        entry=pipeline.discover([row],{})[0]
        entry['processed_url'],held=self.server(self.archive())
        result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(result['status'],'compiled')
        held['data']=self.archive(rail=False);held['etag']='"two"'
        for _ in range(2):
            result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
            self.assertEqual(result['status'],'no_rail')
            self.assertFalse((output/'feeds/eg_rail.json.gz').exists())
        self.assertEqual(json.loads((cache/'eg_rail.meta.json').read_text())['etag'],'"two"')

    def test_last_modified_revalidation_keeps_its_validator_type_across_304_and_200(self):
        cache,output=self.root/'cache',self.root/'out';cache.mkdir()
        row={'filename':'eg_rail.gtfs.zip','source':'https://example.org/feed.zip','country_code':'EG','spdx_license_identifier':'CC-BY-4.0'}
        entry=pipeline.discover([row],{})[0]
        entry['processed_url'],held=self.server(self.archive(),last_modified=True)
        first=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        metadata=json.loads((cache/'eg_rail.meta.json').read_text())
        self.assertIsNone(metadata['etag']);self.assertEqual(metadata['last_modified'],held['last_modified'])
        count=len(held['requests'])
        second=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(len(held['requests']),count+1)
        self.assertEqual(held['conditional_requests'][-1],(None,held['last_modified']))
        self.assertEqual(second['source']['retrieved'],first['source']['retrieved'])
        held['data']=self.archive(rail=False);held['last_modified']='Tue, 02 Jun 2026 00:00:00 GMT'
        for _ in range(2):
            result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
            self.assertEqual(result['status'],'no_rail')
        self.assertEqual(held['conditional_requests'][-1],(None,held['last_modified']))
        self.assertEqual(json.loads((cache/'eg_rail.meta.json').read_text())['last_modified'],held['last_modified'])

    def test_cached_304_response_is_closed_immediately(self):
        from urllib.error import HTTPError
        cache,output=self.root/'cache',self.root/'out';cache.mkdir()
        row={'filename':'eg_rail.gtfs.zip','source':'https://example.org/feed.zip','country_code':'EG','spdx_license_identifier':'CC-BY-4.0'}
        entry=pipeline.discover([row],{})[0]
        entry['processed_url'],_=self.server(self.archive())
        pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        stream=io.BytesIO()
        error=HTTPError(entry['processed_url'],304,'Not Modified',{},stream)
        self.addCleanup(stream.close)
        with patch.object(pipeline,'get',side_effect=error):
            result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(result['status'],'compiled')
        self.assertTrue(stream.closed)

    def test_bus_only_revision_removes_old_output_without_cache_metadata(self):
        cache,output=self.root/'cache',self.root/'out';cache.mkdir()
        row={'filename':'eg_rail.gtfs.zip','source':'https://example.org/feed.zip','country_code':'EG','spdx_license_identifier':'CC-BY-4.0'}
        entry=pipeline.discover([row],{})[0]
        entry['processed_url'],held=self.server(self.archive())
        result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(result['status'],'compiled')
        (cache/'eg_rail.meta.json').unlink();held['data']=self.archive(rail=False)
        result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(result['status'],'no_rail')
        self.assertFalse((output/'feeds/eg_rail.json.gz').exists())

    def test_geometry_timeout_preserves_computed_national_frequencies(self):
        cache,output=self.root/'cache',self.root/'out';cache.mkdir()
        row={'filename':'eg_rail.gtfs.zip','source':'https://example.org/feed.zip','country_code':'EG','spdx_license_identifier':'CC-BY-4.0'}
        entry=pipeline.discover([row],{})[0]
        entry['processed_url'],_=self.server(self.archive())
        compile_feed=pipeline.compiler.compile_feed
        def bounded(path,config,date,geometry=False):
            if geometry:raise TimeoutError('geometry budget')
            return compile_feed(path,config,date,geometry)
        with patch.object(pipeline.compiler,'compile_feed',side_effect=bounded):
            result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        import gzip
        with gzip.open(output/result['output'],'rt') as file:feed=json.load(file)
        self.assertEqual(result['status'],'compiled')
        self.assertEqual(feed['segments'],[])
        self.assertEqual(feed['unmapped_segments'][0]['profiles']['am']['display_tph'],.5)
        self.assertIn('time budget',feed['source']['geometry_audit']['reason'])
        self.assertEqual(len(feed['unmapped_stops']),2)


if __name__=='__main__':unittest.main()
