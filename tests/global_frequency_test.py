import csv
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
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

    def server(self,data,ranges=True,change=False):
        held={'requests':[],'etag':'"one"'}
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                range_value=self.headers.get('Range');held['requests'].append(range_value)
                if self.headers.get('If-None-Match')==held['etag']:
                    self.send_response(304);self.end_headers();return
                if change and len(held['requests'])>1:held['etag']='"two"'
                if ranges and range_value:
                    value=range_value.split('=')[1]
                    if value.startswith('-'):start,end=max(0,len(data)-int(value[1:])),len(data)-1
                    else:start,end=map(int,value.split('-'));end=min(end,len(data)-1)
                    body=data[start:end+1];self.send_response(206);self.send_header('Content-Range',f'bytes {start}-{end}/{len(data)}')
                else:body=data;self.send_response(200)
                self.send_header('Content-Length',str(len(body)));self.send_header('ETag',held['etag']);self.end_headers();self.wfile.write(body)
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


if __name__=='__main__':unittest.main()
