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
        self.assertEqual({r['country'] for r in result if r['status']=='pending'},(set(countries)-pipeline.EXCLUDED)|{'US'})
        self.assertEqual(len({r['id'] for r in result}),len(rows))
        self.assertTrue(all('/' not in r['id'] for r in result))
        us = next(r for r in result if r['country']=='US')
        self.assertEqual(us['status'], 'pending', 'absence of licence metadata is not a prohibition')
        self.assertEqual(us['terms']['state'], 'not_provided')

    def test_source_terms_eligibility_missing_url_only_permitted_denied_and_conflict(self):
        root={'country_code':'BE','source':'https://example.org/feed.zip'}
        cases=[
            ('missing', {}, 'pending', 'not_provided'),
            ('url-only', {'license_url':'https://example.org/terms'}, 'pending', 'linked'),
            ('unknown-spdx', {'spdx_license_identifier':'LicenseRef-New-Operator'}, 'pending', 'identified'),
            ('permitted', {'spdx_license_identifier':'CC-BY-4.0'}, 'pending', 'identified'),
            ('no-derivatives', {'spdx_license_identifier':'CC-BY-ND-4.0'}, 'pending', 'identified'),
            ('derivative-dataset-forbidden', {'create_derived_product':False}, 'pending', 'not_provided'),
            ('noncommercial-unresolved', {'spdx_license_identifier':'CC-BY-NC-4.0'}, 'pending', 'identified')
        ]
        rows=[{**root, **fields, 'filename': name+'.gtfs.zip'} for name,fields,_,_ in cases]
        output={x['id']:x for x in pipeline.discover(rows,{})}
        for name,_,status,rights_state in cases:
            with self.subTest(case=name):
                self.assertEqual(output[name]['status'],status)
                self.assertEqual(output[name]['terms']['state'],rights_state)
        self.assertEqual(output['url-only']['terms']['terms_urls'],['https://example.org/terms'])
        self.assertEqual(output['no-derivatives']['reason_code'],'')
        self.assertFalse(output['no-derivatives']['terms']['prohibitions'])
        # An explicit, source-bound reviewed term can prohibit; another URL cannot
        # accidentally inherit it through a shared filename.
        rule={'sources':{'permitted.gtfs.zip':{
            'expected_source':'https://example.org/feed.zip',
            'license_url':'https://example.org/reviewed-terms',
            'prohibit_frequency_use':True}}}
        result=pipeline.discover([rows[3]],rule)[0]
        self.assertEqual(result['status'],'excluded')
        self.assertIn('end-user timetable-frequency use',result['reason'])
        other=pipeline.discover([{**rows[3],'source':'https://another.example/feed.zip'}],rule)[0]
        self.assertEqual(other['status'],'pending')
        # Catalogue conflicts are visible, not interpreted as a permission
        # ban when neither one actually prohibits the derived-frequency use.
        conflicting={**root,'filename':'conflict.gtfs.zip','rights_evidence':[
            {'origin':'a','spdx':'CC-BY-4.0'},
            {'origin':'b','spdx':'CC0-1.0'}]}
        outcome=pipeline.discover([conflicting],{})[0]
        self.assertEqual(outcome['status'],'pending')
        self.assertTrue(outcome['terms']['conflicting_spdx'])

    def test_missing_direct_url_is_processing_failure_not_licence_exclusion(self):
        feed={'filename':'mdb_123.gtfs.zip','delivery':'direct','country_code':'CA',
              'human_name':'Missing download','source':'','rights_evidence':[]}
        item=pipeline.discover([feed],{})[0]
        self.assertEqual(item['status'],'retry_pending')
        self.assertTrue(item['retry_eligible'])
        self.assertEqual(item['reason_code'],'missing_source_url')

    def test_processing_failures_keep_distinct_codes_and_stages(self):
        observed = [
            (RuntimeError('HTTPError: HTTP Error 404: Not Found'), 'source_http_404', 'retrieval'),
            (RuntimeError('HTTPError: HTTP Error 403: Forbidden'), 'source_access_denied', 'retrieval'),
            (RuntimeError('ValueError: GTFS table stop_times.txt exceeds row budget'), 'table_row_limit', 'parsing'),
            (RuntimeError('ValueError: GTFS table stop_times.txt exceeds expanded byte budget'), 'byte_limit', 'parsing'),
            (RuntimeError('MemoryError: '), 'memory_limit', 'resources'),
            (RuntimeError('ValueError: Selected date is beyond the declared service calendar horizon'),
             'calendar_horizon', 'calendar'),
            (RuntimeError("ValueError: Selected date is outside the feed's validity (beyond the service calendar horizon)"),
             'calendar_horizon', 'calendar'),
            (ValueError('Malformed route reference'), 'compile_error', 'compilation'),
        ]
        for exception, code, stage in observed:
            with self.subTest(code=code, exception=str(exception)):
                self.assertEqual(pipeline.classify_failure(exception), (code, stage))

    def test_processed_404_recovers_from_original_without_excluding_rail(self):
        original, held = self.server(self.archive())
        row={'filename':'jp_rail.gtfs.zip','source':original,'country_code':'JP',
             'spdx_license_identifier':'CC-BY-ND-4.0',
             'lineage':[{'catalogue':'transitous-feeds','source':original}]}
        entry=pipeline.discover([row],{})[0]
        self.assertEqual(entry['status'],'pending')
        processed=entry['processed_url']
        real_get=pipeline.get
        def broken_processed(url, headers=None):
            if url == processed:
                from urllib.error import HTTPError
                raise HTTPError(url, 404, 'Not Found', {}, io.BytesIO())
            return real_get(url,headers)
        cache,output=self.root/'fallback-cache',self.root/'fallback-output'
        cache.mkdir()
        with patch.object(pipeline,'get',side_effect=broken_processed):
            result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(result['status'],'compiled')
        self.assertEqual(result['source']['download_url'],original)
        self.assertEqual(result['source']['recovered_source_errors'][0]['code'],'http_404')
        self.assertTrue(held['requests'], 'the actual original GTFS was downloaded')
        # The successful source is revalidated, not the previously broken proxy.
        with patch.object(pipeline,'get',side_effect=broken_processed):
            same=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(same['status'],'compiled')
        self.assertEqual(same['source']['retrieved'],result['source']['retrieved'])

    def test_all_source_404s_are_recoverable_with_inspectable_attempts(self):
        from urllib.error import HTTPError
        row={'filename':'jp_rail.gtfs.zip','source':'https://operator.example/rail.zip','country_code':'JP'}
        entry=pipeline.discover([row],{})[0]
        cache,output=self.root/'missing-cache',self.root/'missing-output'
        cache.mkdir()
        def only_404(url, headers=None):
            raise HTTPError(url,404,'Not Found',{},io.BytesIO())
        with patch.object(pipeline,'get',side_effect=only_404):
            with self.assertRaises(pipeline.SourceRetrievalError) as context:
                pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(len(context.exception.attempts),2)
        self.assertEqual({x['code'] for x in context.exception.attempts},{'http_404'})
        self.assertEqual(pipeline.classify_failure(context.exception),('source_http_404','retrieval'))
        self.assertFalse((cache/'jp_rail.zip').exists())

    def test_bad_conditional_refresh_keeps_last_good_zip_until_alternative_succeeds(self):
        original, _ = self.server(self.archive())
        row={'filename':'de_rail.gtfs.zip','source':original,'country_code':'DE'}
        entry=pipeline.discover([row],{})[0]
        # First successful version fetched through the processed endpoint.
        entry['processed_url']=original
        cache,output=self.root/'bad-cache',self.root/'bad-output'
        cache.mkdir()
        pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        old=(cache/'de_rail.zip').read_bytes()
        # Conditional 200 responds with broken, non-ZIP bytes. Fall back
        # on the original URL rather than overwriting the good cached ZIP.
        entry['processed_url']='https://broken.example/process.zip'
        meta=json.loads((cache/'de_rail.meta.json').read_text())
        meta['download_url']=entry['processed_url']
        (cache/'de_rail.meta.json').write_text(json.dumps(meta))
        real_get=pipeline.get
        def broken(url, headers=None):
            if url==entry['processed_url']:
                from email.message import Message
                class Response(io.BytesIO):
                    status=200
                    headers={'Content-Length':'10','ETag':'"new"'}
                    def __enter__(self): return self
                    def __exit__(self,*_): self.close()
                return Response(b'not-a-zip')
            return real_get(url,headers)
        with patch.object(pipeline,'get',side_effect=broken):
            result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(result['status'],'compiled')
        self.assertEqual((cache/'de_rail.zip').read_bytes(),old)
        self.assertEqual(result['source']['download_url'],original)

    def test_recent_cached_rail_is_retained_during_outage_without_false_refresh(self):
        from urllib.error import HTTPError
        original,_=self.server(self.archive())
        entry=pipeline.discover([{'filename':'jp_cache.gtfs.zip','source':original,
                                  'country_code':'JP'}],{})[0]
        entry['processed_url']=original
        cache,output=self.root/'offline-cache',self.root/'offline-output'
        cache.mkdir()
        good=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(good['status'],'compiled')
        old_retrieved=good['source']['retrieved']
        old_checked=good['source']['checked']

        def offline(url,headers=None):
            raise HTTPError(url,503,'Service unavailable',{'Retry-After':'120'},io.BytesIO())
        with patch.object(pipeline,'get',side_effect=offline):
            stale=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(stale['status'],'compiled', 'local data may continue within prior validity')
        self.assertTrue(stale['source']['offline_cached'])
        self.assertEqual(stale['source']['retrieved'],old_retrieved)
        self.assertEqual(stale['source']['checked'],old_checked,
                         'an inaccessible publisher has not confirmed freshness')
        self.assertTrue(stale['source']['recovered_source_errors'])

        restored=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(restored['status'],'compiled')
        self.assertFalse(restored['source']['offline_cached'],
                         '304 confirms the cached revision is accessible again')
        self.assertEqual(restored['source']['recovered_source_errors'],[])

    def test_expired_or_mismatched_source_cache_does_not_mask_outage(self):
        from urllib.error import HTTPError
        original,_=self.server(self.archive())
        entry=pipeline.discover([{'filename':'jp_old.gtfs.zip','source':original,'country_code':'JP'}],{})[0]
        entry['processed_url']=original
        cache,output=self.root/'expired-cache',self.root/'expired-output'
        cache.mkdir()
        pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        meta_file=cache/'jp_old.meta.json'
        meta=json.loads(meta_file.read_text())
        def unavailable(url,headers=None):
            raise HTTPError(url,404,'Gone',{},io.BytesIO())
        meta['checked']='2020-01-01'
        meta_file.write_text(json.dumps(meta))
        with patch.object(pipeline,'get',side_effect=unavailable):
            with self.assertRaises(pipeline.SourceRetrievalError):
                pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        meta['checked']=old_date=__import__('datetime').date.today().isoformat()
        meta['download_url']='https://different.example/previous-source.zip'
        meta_file.write_text(json.dumps(meta))
        with patch.object(pipeline,'get',side_effect=unavailable):
            with self.assertRaises(pipeline.SourceRetrievalError):
                pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)

    def test_bounded_retries_respect_publisher_backoff_and_do_not_repeat_404(self):
        from urllib.error import HTTPError
        attempts=[]
        def transient(request, timeout=45):
            attempts.append(request.full_url)
            if len(attempts)<3:
                code=429 if len(attempts)==1 else 503
                raise HTTPError(request.full_url,code,'Temporary',{'Retry-After':'0'},io.BytesIO())
            return io.BytesIO(b'ok')
        with patch.object(pipeline,'urlopen',side_effect=transient), patch.object(pipeline.time,'sleep') as sleep:
            with pipeline.get('https://example.net/rail.zip') as response:
                self.assertEqual(response.read(),b'ok')
        self.assertEqual(len(attempts),3)
        self.assertEqual(sleep.call_count,2)

        def permanent(request, timeout=45):
            attempts.append(request.full_url)
            raise HTTPError(request.full_url,404,'Not Found',{},io.BytesIO())
        attempts.clear()
        with patch.object(pipeline,'urlopen',side_effect=permanent), patch.object(pipeline.time,'sleep') as sleep:
            with self.assertRaises(HTTPError):
                pipeline.get('https://example.net/missing.zip')
        self.assertEqual(len(attempts),1,'retry the alternate feed, not the dead 404 itself')
        sleep.assert_not_called()

        def delayed(request, timeout=45):
            raise HTTPError(request.full_url,429,'Rate Limited',{'Retry-After':'120'},io.BytesIO())
        with patch.object(pipeline,'urlopen',side_effect=delayed), patch.object(pipeline.time,'sleep') as sleep:
            with self.assertRaises(HTTPError):
                pipeline.get('https://example.net/rate-limited.zip')
        sleep.assert_not_called()

    def test_compile_failure_remains_retry_pending_in_durable_inventory(self):
        catalogue=self.root/'input.json';catalogue.write_text(json.dumps([
            {'filename':'jp_rail.gtfs.zip','country_code':'JP',
             'source':'https://operator.example/rail.zip'}]))
        cache,output=self.root/'main-cache',self.root/'main-out'
        errors=[{'url':'https://api.transitous.org/gtfs/jp_rail.gtfs.zip',
                 'code':'http_404','message':'Not found'},
                {'url':'https://operator.example/rail.zip','code':'http_404',
                 'message':'Not found'}]
        from unittest.mock import patch as mock_patch
        with mock_patch('sys.argv',['global-service-frequency.py','--catalogue',str(catalogue),
                                    '--cache',str(cache),'--output',str(output),'--date','2026-10-05']), \
             mock_patch.object(pipeline,'compile_entry_isolated',side_effect=pipeline.SourceRetrievalError(errors)):
            pipeline.main()
        inventory=json.loads((output/'inventory-0.json').read_text())
        self.assertEqual(inventory['counts'],{'retry_pending':1})
        record=inventory['entries'][0]
        self.assertTrue(record['retry_eligible'])
        self.assertEqual(record['reason_code'],'source_http_404')
        self.assertEqual(len(record['source_attempts']),2)
        self.assertEqual(record['next_action'],'repair_or_find_feed_url')

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
