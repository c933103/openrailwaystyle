import csv
import gzip
import importlib.util
import io
import json
import socket
import struct
import sys
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
        self.fixture_ports = set()
        def fixture_addresses(host, port):
            # Only this test instance's registered servers can use real sockets.
            # Catalogue values cannot enable fixture access in production.
            if host != '127.0.0.1' or port not in self.fixture_ports:
                raise AssertionError('Unexpected network destination in offline fixture')
            return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, (host, port))]
        self.enterContext(patch.object(pipeline, 'resolve_public_addresses', side_effect=fixture_addresses))

    def test_reference_alias_non_timetable_and_unknown_do_not_duplicate_acquisition(self):
        url, held = self.server(self.archive(), ranges=False)
        registry = pipeline.registry
        index = {'state': 'available', 'by_id': {
            'static': [{'feed': {'id': 'static', 'spec': 'gtfs', 'urls': {'static_current': url}},
                        'url': 'https://github.test/pinned/static.json', 'pointer': '/feeds/0', 'blob_sha': 'a'*40}],
            'gbfs': [{'feed': {'id': 'gbfs', 'spec': 'gbfs', 'urls': {'gbfs_auto_discovery': 'https://never-query.test/gbfs'}},
                      'url': 'https://github.test/pinned/gbfs.json', 'pointer': '/feeds/0', 'blob_sha': 'b'*40}]}}
        definitions = [('xx', {'name': name, 'type': 'transitland-atlas', 'transitland-atlas-id': ident, 'skip': True},
                        'https://github.test/pinned/xx.json') for name, ident in [('reference', 'static'), ('bikes', 'gbfs'), ('unknown', 'missing')]]
        rows, _ = registry.build_catalogue([], definitions, [{'id': 'owner', 'data_type': 'gtfs', 'urls.direct_download': url}], 'c'*40, index)
        entries = pipeline.discover(rows, {})
        standalone_rows = registry.build_catalogue([], definitions[:1], [], 'c'*40, index)[0]
        standalone = pipeline.discover(standalone_rows, {})[0]
        standalone['processed_url'] = 'https://never-query.test/invented.gtfs.zip'
        self.assertEqual(pipeline.source_candidates(standalone), [url], 'a stale processed URL cannot bypass explicit absent-file evidence')
        self.assertEqual({e['id']: e['status'] for e in entries}, {'mdb_owner': 'pending', 'xx_reference': 'source_alias', 'xx_bikes': 'non_timetable', 'xx_unknown': 'retry_pending'})
        for entry in entries:
            if entry['status'] == 'pending': continue
            self.assertEqual(pipeline.source_candidates(entry), [])
            self.assertEqual(entry['processed_url'], '')
            with patch.object(pipeline, 'get', side_effect=AssertionError('No request permitted')):
                with self.assertRaisesRegex(ValueError, 'not acquisition eligible'):
                    pipeline.compile_entry(entry, self.root/'cache', self.root/'out', '2026-10-05', None, 1_000_000, pipeline.PROFILES)
        source = self.root/'catalogue.json'; source.write_text(json.dumps(rows))
        calls = []
        def compile_fixture(entry, cache, output, date, graph, max_bytes, profiles, *args):
            calls.append(entry['id'])
            return pipeline.compile_entry(entry, cache, output, date, graph, max_bytes, profiles)
        with patch.object(pipeline, 'compile_entry_isolated', side_effect=compile_fixture):
            for shard in range(2):
                argv = ['global-service-frequency.py', '--catalogue', str(source), '--cache', str(self.root/'cache'),
                        '--output', str(self.root/'out'), '--date', '2026-10-05', '--shards', '2', '--shard', str(shard)]
                with patch.object(sys, 'argv', argv), patch('sys.stdout', new_callable=io.StringIO): pipeline.main()
        self.assertEqual(calls, ['mdb_owner'])
        self.assertTrue(held['requests'])
        outputs = list((self.root/'out'/'feeds').glob('*.json.gz'))
        self.assertEqual([p.name for p in outputs], ['mdb_owner.json.gz'])
        all_entries = [e for i in range(2) for e in json.loads((self.root/'out'/f'inventory-{i}.json').read_text())['entries']]
        self.assertEqual(len(all_entries), 4)
        self.assertEqual(next(e for e in all_entries if e['id'] == 'xx_reference')['status'], 'source_alias')
        import os, subprocess
        # Merge real cross-shard outcomes; this acquisition fixture intentionally
        # supplies no OSM graph, so it makes no map-geometry coverage claim.
        program = "import{mergeInventories}from'./scripts/assemble-global-frequency.mjs';import{readFileSync}from'node:fs';const root=process.argv[1];console.log(JSON.stringify(mergeInventories([0,1].map(i=>JSON.parse(readFileSync(root+'/inventory-'+i+'.json','utf8')))).counts))"
        assembly = subprocess.run([os.environ.get('ATLAS_TEST_NODE', 'node'), '--input-type=module', '-e', program, str(self.root/'out')], cwd=pipeline.ROOT, capture_output=True, text=True)
        self.assertEqual(assembly.returncode, 0, assembly.stdout+assembly.stderr)
        self.assertEqual(json.loads(assembly.stdout), {'compiled': 1, 'non_timetable': 1, 'source_alias': 1, 'retry_pending': 1})

    def test_malformed_resolution_and_alias_targets_fail_closed(self):
        base = {'filename': 'x.gtfs.zip', 'source': 'https://operator.test/feed', 'delivery': 'direct', 'lineage': [{'catalogue': 'mobility-database', 'id': 'known'}]}
        for value in [[], 'schedule', {'schema': 2}, {'schema': 1, 'state': 'schedule', 'specs': ['gbfs'], 'declarations': []}, {'schema': 1, 'state': 'non_timetable_format', 'specs': ['gtfs'], 'declarations': []},
                      {'schema': 1, 'state': 'schedule', 'specs': ['gtfs'], 'declarations': [], 'processed_filename': '../escape.zip'}]:
            with self.subTest(value=value):
                entry = pipeline.discover([{**base, 'source_resolution': value}], {})[0]
                self.assertEqual(entry['reason_code'], 'unresolved_source_reference')
                self.assertEqual(pipeline.source_candidates(entry), [])
        state = {'schema': 1, 'state': 'schedule', 'specs': ['gtfs'], 'declarations': [],
                 'processed_filename': None, 'acquisition_alias_of': 'missing', 'alias_source_sha256': 'a'*64}
        entry = pipeline.discover([{**base, 'source_resolution': state}], {})[0]
        self.assertEqual(entry['reason_code'], 'ambiguous_source_reference')
        self.assertEqual(pipeline.source_candidates(entry), [])

    def test_reference_alias_requires_compatible_owner_policy_and_full_candidate_set(self):
        url = 'https://public.test/feed.zip'
        index = {'state': 'available', 'by_id': {'static': [{'feed': {'id': 'static', 'spec': 'gtfs', 'urls': {'static_current': url}},
            'url': 'https://github.test/pin/data.json', 'pointer': '/feeds/0', 'blob_sha': 'a'*40}]}}
        definition = ('xx', {'name': 'reference', 'type': 'transitland-atlas', 'transitland-atlas-id': 'static', 'skip': True}, 'https://github.test/pin/xx.json')
        rows = pipeline.registry.build_catalogue([], [definition], [{'id': 'owner', 'data_type': 'gtfs', 'urls.direct_download': url, 'location.country_code': 'CN'}], 'b'*40, index)[0]
        entries = {e['id']: e for e in pipeline.discover(rows, {})}
        self.assertEqual(entries['mdb_owner']['reason_code'], 'provider_policy')
        self.assertEqual(entries['xx_reference']['reason_code'], 'ambiguous_source_reference')
        self.assertIn('incompatible acquisition policy', entries['xx_reference']['reason'])
        self.assertEqual(pipeline.source_candidates(entries['xx_reference']), [])
        ordinary = ('xx', {'name': 'reference', 'type': 'http', 'url': 'https://independent.test/rail.zip'}, 'https://github.test/pin/xx.json')
        rows = pipeline.registry.build_catalogue([], [ordinary, definition], [{'id': 'owner', 'data_type': 'gtfs', 'urls.direct_download': url}], 'b'*40, index)[0]
        entry = next(e for e in pipeline.discover(rows, {}) if e['id'] == 'xx_reference')
        self.assertEqual(entry['status'], 'pending')
        self.assertIn('https://independent.test/rail.zip', pipeline.source_candidates(entry))
        self.assertEqual(entry['processed_url'], pipeline.PROCESSED+'xx_reference.gtfs.zip')
        self.assertIsNone(entry['catalogue']['source_resolution']['acquisition_alias_of'])

    def test_retry_after_receipts_survive_two_runs_without_early_requests(self):
        from email.utils import formatdate
        from urllib.error import HTTPError
        start=1791536400.0
        for hint,delay in [('120',120),(formatdate(start+3600,usegmt=True),3600),('31536000',31536000)]:
            with self.subTest(hint=hint):
                clock=[start];cache=self.root/('retry-'+str(delay))
                url='https://operator.example/feed.zip?selector=fixture-value'
                def unavailable(request,**kwargs):
                    raise HTTPError(request.full_url,429,'Ignore echoed private text',{'Retry-After':hint},io.BytesIO())
                with patch.object(pipeline.time,'time',side_effect=lambda:clock[0]), \
                     patch.object(pipeline.time,'sleep') as sleep, \
                     patch.object(pipeline,'urlopen',side_effect=unavailable) as request:
                    with self.assertRaises(HTTPError):
                        pipeline.get(url,retry_state=pipeline.retry.RetryAfterCache(cache))
                    self.assertEqual(request.call_count,1)
                    clock[0]+=delay-1
                    with self.assertRaises(pipeline.retry.RetryAfterDeferred) as caught:
                        pipeline.get(url,retry_state=pipeline.retry.RetryAfterCache(cache))
                    self.assertEqual(caught.exception.not_before,start+delay)
                    self.assertEqual(request.call_count,1)
                    sleep.assert_not_called()
                receipt=next((cache/'retry-after').glob('*.json'))
                raw=receipt.read_text();self.assertNotIn('fixture-value',raw);self.assertNotIn('operator.example',raw)
                clock[0]=start+delay
                with patch.object(pipeline.time,'time',side_effect=lambda:clock[0]), \
                     patch.object(pipeline,'urlopen',return_value=io.BytesIO(b'ok')) as request:
                    with pipeline.get(url,retry_state=pipeline.retry.RetryAfterCache(cache)) as response:
                        self.assertEqual(response.read(),b'ok')
                    request.assert_called_once()
                self.assertFalse(receipt.exists())

    def test_retry_after_last_attempt_is_remembered_but_404_and_bad_hints_are_not(self):
        from urllib.error import HTTPError
        clock=[1791536400.0];cache=self.root/'last-attempt';url='https://operator.example/feed.zip'
        calls=[]
        def unavailable(request,**kwargs):
            calls.append(clock[0])
            raise HTTPError(request.full_url,503,'Unavailable',{'Retry-After':'120'} if len(calls)==3 else {},io.BytesIO())
        with patch.object(pipeline.time,'time',side_effect=lambda:clock[0]), \
             patch.object(pipeline.time,'sleep',side_effect=lambda delay:clock.__setitem__(0,clock[0]+delay)), \
             patch.object(pipeline,'urlopen',side_effect=unavailable):
            with self.assertRaises(HTTPError):pipeline.get(url,retry_state=pipeline.retry.RetryAfterCache(cache))
            with self.assertRaises(pipeline.retry.RetryAfterDeferred):
                pipeline.get(url,retry_state=pipeline.retry.RetryAfterCache(cache))
        self.assertEqual(len(calls),3)
        for code,hint,count in [(404,'120',1),(503,'invalid',3),(503,'0',3),
                                (503,'Thu, 01 Jan 1970 00:00:00 GMT',3)]:
            with self.subTest(code=code,hint=hint):
                other=self.root/('no-hold-'+str(code)+'-'+str(len(hint)))
                def response(request,**kwargs):
                    raise HTTPError(request.full_url,code,'Failure',{'Retry-After':hint},io.BytesIO())
                with patch.object(pipeline,'urlopen',side_effect=response) as request, patch.object(pipeline.time,'sleep'):
                    for _ in range(2):
                        with self.assertRaises(HTTPError):pipeline.get(url,retry_state=pipeline.retry.RetryAfterCache(other))
                self.assertEqual(request.call_count,2*count)
                self.assertFalse(list(other.glob('retry-after/*.json')))

    def test_retry_receipt_corruption_versions_and_query_identities_cannot_freeze_sources(self):
        cache=pipeline.retry.RetryAfterCache(self.root/'receipt-cache',clock=lambda:1000)
        first='https://operator.example/feed.zip?feed=fixture-first'
        second=first.replace('fixture-first','fixture-second')
        cache.record(first,503,1000,1120)
        cache.check(second)
        self.assertNotEqual(cache.path(first),cache.path(second))
        original=json.loads(cache.path(first).read_text())
        invalid=['not-json','[]','['*1500+']'*1500,json.dumps({**original,'schema':True}),json.dumps({**original,'schema':999}),
                 json.dumps({**original,'url_sha256':'0'*64}),json.dumps({**original,'status':200}),
                 json.dumps({**original,'observed_at':2000}),json.dumps({**original,'not_before':float('inf')}),
                 json.dumps({**original,'not_before':10**400}),
                 json.dumps({**original,'rollback_anchor':2000}),json.dumps({**original,'extra':'fixture-secret'}),
                 'x'*(pipeline.retry.MAX_RECEIPT_BYTES+1)]
        for value in invalid:
            with self.subTest(value=value[:40]):
                cache.path(first).write_text(value)
                cache.check(first)
                self.assertFalse(cache.path(first).exists())
        self.assertEqual(cache.metrics['invalid_receipts'],len(invalid))
        # Compiler/source-policy implementation signatures are not endpoint
        # identities: an upgrade must not erase a known provider deadline.
        cache.write(first,original)
        with patch.object(pipeline,'file_hash',return_value='new-compiler-version'):
            with self.assertRaises(pipeline.retry.RetryAfterDeferred):cache.check(first)

    def test_retry_receipt_reads_are_byte_bounded_and_io_errors_are_distinct(self):
        url='https://operator.example/feed.zip'
        state=pipeline.retry.RetryAfterCache(self.root/'bounded-retry',clock=lambda:1000)
        state.record(url,503,1000,1120)
        # The on-disk stat is small; bytes available when opened can be larger.
        # An unbounded read or a stat-only guard must fail this sensitivity test.
        sizes=[]
        class LimitedRead(io.BytesIO):
            def read(self,size=-1):
                sizes.append(size)
                self_size=pipeline.retry.MAX_RECEIPT_BYTES+1
                if size != self_size:
                    raise AssertionError('Receipt read must enforce its byte limit')
                return super().read(size)
        stream=LimitedRead(b'x'*(pipeline.retry.MAX_RECEIPT_BYTES+100))
        with patch.object(Path,'open',return_value=stream):state.check(url)
        self.assertEqual(sizes,[pipeline.retry.MAX_RECEIPT_BYTES+1])
        self.assertTrue(stream.closed)
        self.assertEqual(state.metrics['invalid_receipts'],1)
        self.assertFalse(state.path(url).exists())
        state.record(url,503,1000,1120)
        with patch.object(Path,'open',side_effect=PermissionError('fixture I/O failure')):
            with self.assertRaises(PermissionError):state.check(url)
        self.assertEqual(state.metrics['invalid_receipts'],1,'I/O errors are not corrupt receipt content')
        self.assertTrue(state.path(url).exists())

    def test_retry_clock_rollback_reanchors_conservatively_and_recovers(self):
        url='https://operator.example/feed.zip';clock=[1000]
        cache=pipeline.retry.RetryAfterCache(self.root/'rollback',clock=lambda:clock[0])
        cache.record(url,503,1000,1120)
        clock[0]=100
        with self.assertRaises(pipeline.retry.RetryAfterDeferred) as caught:cache.check(url)
        self.assertEqual(caught.exception.not_before,220)
        clock[0]=219
        # A new process must retain the anchor, not restart the full delay.
        restored=pipeline.retry.RetryAfterCache(self.root/'rollback',clock=lambda:clock[0])
        with self.assertRaises(pipeline.retry.RetryAfterDeferred):restored.check(url)
        clock[0]=220;restored.check(url);self.assertFalse(cache.path(url).exists())
        cache.record(url,503,1000,1120);clock[0]=100
        with self.assertRaises(pipeline.retry.RetryAfterDeferred):cache.check(url)
        clock[0]=1010
        with self.assertRaises(pipeline.retry.RetryAfterDeferred) as caught:cache.check(url)
        self.assertEqual(caught.exception.not_before,1120,'clock recovery must preserve the original absolute deadline')
        clock[0]=1120;cache.check(url)
        cache.record(url,503,1000,1120);clock[0]=float('nan')
        with self.assertRaisesRegex(ValueError,'clock'):cache.check(url)
        # Even a consistent but far-future observation cannot silently freeze
        # this clock until that date. It conservatively waits the full duration.
        cache.record(url,503,10**12,10**12+120);clock[0]=1000
        with self.assertRaises(pipeline.retry.RetryAfterDeferred) as caught:cache.check(url)
        self.assertEqual(caught.exception.not_before,1120)
        clock[0]=1120;cache.check(url);self.assertFalse(cache.path(url).exists())
        # A small rollback can conservatively wait longer as the clock crosses
        # the original observation; it must still expire at the original bound.
        cache.record(url,503,1000,1120);clock[0]=990
        with self.assertRaises(pipeline.retry.RetryAfterDeferred) as caught:cache.check(url)
        self.assertEqual(caught.exception.not_before,1110)
        clock[0]=1110
        with self.assertRaises(pipeline.retry.RetryAfterDeferred) as caught:cache.check(url)
        self.assertEqual(caught.exception.not_before,1120)
        clock[0]=1120;cache.check(url);self.assertFalse(cache.path(url).exists())

    def test_retry_after_short_dates_with_cache_wait_exactly_and_clear_on_success(self):
        from email.utils import formatdate
        from urllib.error import HTTPError
        clock=[1791536400.0];deadline=clock[0]+5;calls=[]
        state=pipeline.retry.RetryAfterCache(self.root/'short-retry',clock=lambda:clock[0])
        def response(request,**kwargs):
            calls.append(clock[0])
            if len(calls)==1:
                raise HTTPError(request.full_url,503,'Unavailable',{'Retry-After':formatdate(deadline,usegmt=True)},io.BytesIO())
            return io.BytesIO(b'ok')
        with patch.object(pipeline,'urlopen',side_effect=response), \
             patch.object(pipeline.time,'time',side_effect=lambda:clock[0]), \
             patch.object(pipeline.time,'sleep',side_effect=lambda delay:clock.__setitem__(0,clock[0]+delay)):
            with pipeline.get('https://operator.example/feed.zip',retry_state=state) as result:
                self.assertEqual(result.read(),b'ok')
        self.assertEqual(calls,[deadline-5,deadline])
        self.assertFalse(list(state.directory.glob('*.json')))

    def test_unrepresentable_retry_after_is_reported_without_shortening_or_retries(self):
        from urllib.error import HTTPError
        for hint,error_type in [('9'*400,HTTPError),('9'*5000,HTTPError)]:
            with self.subTest(digits=len(hint)):
                state=pipeline.retry.RetryAfterCache(self.root/('huge-hint-'+str(len(hint))))
                response=HTTPError('https://operator.example/feed.zip',503,'Failure',
                                   {'Retry-After':hint},io.BytesIO())
                with patch.object(pipeline,'urlopen',side_effect=response) as request, \
                     patch.object(pipeline.time,'sleep') as sleep:
                    with self.assertRaises(error_type):
                        pipeline.get(response.url,retry_state=state)
                response.close()
                request.assert_called_once();sleep.assert_not_called()
                self.assertEqual(state.metrics['unpersistable_hints'],1)
                self.assertFalse(list(state.directory.glob('*.json')))

    def test_retry_cache_io_failures_close_transport_resources(self):
        from urllib.error import HTTPError
        url='https://operator.example/feed.zip';state=pipeline.retry.RetryAfterCache(self.root/'io-retry')
        stream=io.BytesIO();error=HTTPError(url,503,'Unavailable',{'Retry-After':'120'},stream)
        with patch.object(pipeline,'urlopen',side_effect=error) as request, \
             patch.object(state,'record',side_effect=OSError('fixture write failure')):
            with self.assertRaises(OSError):pipeline.get(url,retry_state=state)
        self.assertTrue(stream.closed);request.assert_called_once()
        response=io.BytesIO(b'ok')
        with patch.object(pipeline,'urlopen',return_value=response), \
             patch.object(state,'clear',side_effect=OSError('fixture clear failure')):
            with self.assertRaises(OSError):pipeline.get(url,retry_state=state)
        self.assertTrue(response.closed)

    def test_retry_receipts_cannot_override_source_policy_or_signed_access_holds(self):
        from contextlib import redirect_stdout
        state=pipeline.retry.RetryAfterCache(self.root/'held-retry')
        rows=[]
        for ident in ['3146','3147']:
            url='https://fixture.blob.core.windows.net/'+ident+'.zip?sv=fixture-version&se=fixture-expiry&sp=rl&sr=c&sig=fixture-signature'
            state.record(url,503,1000,2000)
            with patch.object(pipeline,'urlopen') as request:
                with self.assertRaises(pipeline.UnsafeSourceURL):pipeline.get(url,retry_state=state)
            request.assert_not_called()
            rows.append({'filename':'mdb_mdb-'+ident+'.gtfs.zip','delivery':'direct','country_code':'NZ','source':url})
        catalogue=self.root/'held.json';catalogue.write_text(json.dumps(rows))
        argv=['frequency','--catalogue',str(catalogue),'--cache',str(self.root/'held-retry'),
              '--output',str(self.root/'held-out'),'--date','2026-10-05']
        with patch.object(sys,'argv',argv), patch.object(pipeline,'compile_entry_isolated') as compile_entry, redirect_stdout(io.StringIO()):
            pipeline.main()
        compile_entry.assert_not_called()
        records=json.loads((self.root/'held-out/inventory-0.json').read_text())['entries']
        self.assertEqual(len(records),2)
        self.assertTrue(all(r['status']=='retry_pending' and r['reason_code']=='source_access_review' for r in records))
        ordinary='https://operator.example/feed.zip';state.record(ordinary,503,1000,2000)
        def denied(url):raise pipeline.SourcePolicyError('fixture policy exclusion')
        with patch.object(pipeline,'urlopen') as request:
            with self.assertRaises(pipeline.SourcePolicyError):pipeline.get(ordinary,policy=denied,retry_state=state)
        request.assert_not_called()

    def test_retry_pause_allows_compiler_fixes_from_valid_cache_without_refresh(self):
        url,held=self.server(self.archive());cache,output=self.root/'cached-retry',self.root/'cached-out';cache.mkdir()
        entry=pipeline.discover([{'filename':'ca_retry.gtfs.zip','delivery':'direct','country_code':'CA','source':url}],{})[0]
        first=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(first['acquisition_metrics']['http_requests'],len(held['requests']))
        clock=[1791536400.0];held['retry_after']='120'
        with patch.object(pipeline.time,'time',side_effect=lambda:clock[0]):
            paused=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
            self.assertTrue(paused['source']['offline_cached'])
            count=len(held['requests'])
            with patch.object(pipeline,'file_hash',return_value='new-compiler-signature'), \
                 patch.object(pipeline.compiler,'compile_feed',wraps=pipeline.compiler.compile_feed) as compile_feed:
                again=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
            self.assertEqual([call.kwargs.get('geometry') for call in compile_feed.call_args_list],[True,False],
                             'the fixture recompiles geometry, then its existing unmatched-pair audit')
            self.assertEqual(len(held['requests']),count)
            self.assertEqual(again['status'],'compiled')
            self.assertEqual(again['source']['checked'],first['source']['checked'])
            self.assertEqual(again['source']['retrieved'],first['source']['retrieved'])
            self.assertEqual(again['acquisition_metrics'].get('http_requests',0),0)
            self.assertEqual(again['acquisition_metrics']['offline_archive_uses'],1)
            self.assertGreater(again['acquisition_metrics']['deferred_requests'],0)
            clock[0]+=120;held.pop('retry_after')
            restored=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
            self.assertFalse(restored['source']['offline_cached'])
            self.assertEqual(restored['acquisition_metrics']['http_requests'],1)
            self.assertEqual(restored['acquisition_metrics']['conditional_not_modified'],1)

    def test_retry_pause_still_tries_alternates_and_reports_retriable_inventory(self):
        from contextlib import redirect_stdout
        blocked,held=self.server(self.archive());held['retry_after']='120'
        good,_=self.server(self.archive());cache=self.root/'alternate-retry';cache.mkdir()
        entry=pipeline.discover([{'filename':'ca_retry.gtfs.zip','country_code':'CA','source':good}],{})[0]
        entry['processed_url']=blocked
        first=pipeline.compile_entry(entry,cache,self.root/'alt-out','2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(first['status'],'compiled')
        count=len(held['requests'])
        direct=pipeline.discover([{'filename':'ca_direct.gtfs.zip','country_code':'CA','delivery':'direct','source':blocked}],{})[0]
        with self.assertRaises(pipeline.SourceRetrievalError) as caught:
            pipeline.compile_entry(direct,cache,self.root/'direct-out','2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(len(held['requests']),count)
        self.assertEqual(pipeline.classify_failure(caught.exception),('source_retry_after','retrieval'))
        catalogue=self.root/'retry-inventory.json';catalogue.write_text(json.dumps([direct['catalogue']]))
        argv=['frequency','--catalogue',str(catalogue),'--cache',str(cache),'--output',str(self.root/'inventory-out'),'--date','2026-10-05']
        with patch.object(sys,'argv',argv), patch.object(pipeline,'compile_entry_isolated',side_effect=caught.exception), redirect_stdout(io.StringIO()):
            pipeline.main()
        result=json.loads((self.root/'inventory-out/inventory-0.json').read_text())['entries'][0]
        self.assertEqual(result['status'],'retry_pending');self.assertTrue(result['retry_eligible'])
        self.assertEqual(result['reason_code'],'source_retry_after')
        self.assertGreater(result['acquisition_metrics']['deferred_requests'],0)

    def test_retry_receipt_and_metrics_survive_real_compile_children(self):
        import time
        cache=self.root/'child-retry';url='https://operator.example/feed.zip?selector=fixture-child-value'
        entry=pipeline.discover([{'filename':'ca_child.gtfs.zip','delivery':'direct',
                                 'country_code':'CA','source':url}],{})[0]
        state=pipeline.retry.RetryAfterCache(cache)
        start=time.time();state.record(url,503,start,start+3600)
        for _ in range(2):
            # These real child processes share only files, not mocks or state.
            # The receipt must prevent even DNS/HTTP acquisition of the source.
            with self.assertRaises(pipeline.SourceRetrievalError) as caught:
                pipeline.compile_entry_isolated(entry,cache,self.root/'child-out',
                                                '2026-10-05',None,1_000_000,pipeline.PROFILES)
            error=caught.exception
            self.assertEqual(pipeline.classify_failure(error),('source_retry_after','retrieval'))
            self.assertEqual(error.acquisition_metrics,{'deferred_requests':1})
            self.assertNotIn('fixture-child-value',json.dumps(error.attempts))
            self.assertNotIn('fixture-child-value',str(error))
            self.assertEqual(error.attempts[0]['retry_after_not_before'],start+3600)
            self.assertTrue(state.path(url).exists())

    def test_retry_receipts_cover_range_full_download_and_redirect_targets(self):
        from urllib.error import HTTPError
        for operation in ['table','download']:
            with self.subTest(operation=operation):
                url,held=self.server(self.archive());cache=self.root/('range-retry-'+operation)
                state=pipeline.retry.RetryAfterCache(cache)
                remote=pipeline.RemoteZip(url,1_000_000,retry_state=state)
                held['retry_after']='120'
                with self.assertRaises(HTTPError):
                    remote.table('routes.txt') if operation=='table' else remote.download()
                count=len(held['requests'])
                with self.assertRaises(pipeline.retry.RetryAfterDeferred):
                    pipeline.RemoteZip(url,1_000_000,retry_state=pipeline.retry.RetryAfterCache(cache))
                self.assertEqual(len(held['requests']),count)
        target,target_state=self.server(self.archive());target_state['retry_after']='120'
        original,original_state=self.server(self.archive());original_state['redirect']=target
        cache=self.root/'redirect-retry'
        with self.assertRaises(HTTPError):pipeline.get(original,retry_state=pipeline.retry.RetryAfterCache(cache))
        counts=(len(original_state['requests']),len(target_state['requests']))
        with self.assertRaises(pipeline.retry.RetryAfterDeferred):
            pipeline.get(original,retry_state=pipeline.retry.RetryAfterCache(cache))
        self.assertEqual((len(original_state['requests']),len(target_state['requests'])),counts)
        # An unseen redirect source can be contacted, but its held target cannot.
        alias,alias_state=self.server(self.archive());alias_state['redirect']=target
        with self.assertRaises(pipeline.retry.RetryAfterDeferred):
            pipeline.get(alias,retry_state=pipeline.retry.RetryAfterCache(cache))
        self.assertEqual(len(alias_state['requests']),1)
        self.assertEqual(len(target_state['requests']),counts[1])
        with self.assertRaises(pipeline.retry.RetryAfterDeferred):
            pipeline.get(alias,retry_state=pipeline.retry.RetryAfterCache(cache))
        self.assertEqual(len(alias_state['requests']),1,'the newly learned redirect alias also retains its deadline')

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

    def test_signed_access_records_remain_pending_and_never_become_acquisition_candidates(self):
        signed='https://fixture.blob.core.windows.net/feed.zip?sv=fixture-version&se=fixture-expiry&sp=rl&sr=c&sig=fixture-signature'
        rows=[{'filename':'nz_signed.gtfs.zip','source':signed,'country_code':'NZ','delivery':'direct'},
              {'filename':'nz_public.gtfs.zip','source':'https://operator.example/feed.zip?rid=public-selector','country_code':'NZ','delivery':'direct'}]
        discovered=pipeline.discover(rows,{})
        signed_entry=next(item for item in discovered if item['id']=='nz_signed')
        self.assertEqual(signed_entry['status'],'retry_pending')
        self.assertEqual(signed_entry['reason_code'],'source_access_review')
        self.assertTrue(signed_entry['retry_eligible'])
        self.assertFalse(signed_entry['terms']['prohibitions'])
        self.assertEqual(pipeline.source_candidates(signed_entry),[])
        self.assertEqual(pipeline.source_candidates({'catalogue':rows[0],'processed_url':signed}),[],'legacy raw catalogue cannot bypass the acquisition pause')
        public_entry=next(item for item in discovered if item['id']=='nz_public')
        self.assertEqual(public_entry['status'],'pending')
        self.assertEqual(pipeline.source_candidates(public_entry),[rows[1]['source']])
        with patch.object(pipeline,'resolve_public_addresses') as resolve:
            with self.assertRaises(pipeline.UnsafeSourceURL):pipeline.get(signed)
        resolve.assert_not_called()
        self.assertNotIn('fixture-signature',json.dumps(discovered))

    def test_untrusted_audit_hash_and_long_query_cannot_unpause_source_access(self):
        sources=['https://fixture-user:fixture-password@operator.example/feed',
            'https://fixture.blob.core.windows.net/feed?sig=fixture-signature&sv=x&se=y&sp=r&sr=b&'+'&'.join('p'+str(i)+'=v' for i in range(130))]
        for source in sources:
            entry=pipeline.discover([{'filename':'test.gtfs.zip','source':source,'source_sha256':'a'*64,
                                      'country_code':'NZ','delivery':'direct','lineage':None,'access_review':[None]}],{})[0]
            self.assertEqual(entry['status'],'retry_pending')
            self.assertEqual(entry['reason_code'],'source_access_review')
            self.assertEqual(pipeline.source_candidates(entry),[])
            with self.assertRaises(pipeline.UnsafeSourceURL):pipeline.parse_acquisition_url(source)
        invalid=pipeline.discover([{'filename':'bad.gtfs.zip','source':{},'lineage':3,'delivery':'direct'}, {'filename':None}],{})
        self.assertEqual(len(invalid),1)
        self.assertEqual(invalid[0]['reason_code'],'missing_source_url')

    def test_source_failure_evidence_redacts_credentials_query_values_and_fragments(self):
        from urllib.error import HTTPError
        from urllib.parse import parse_qsl,urlparse
        target='https://fixture-user:fixture-password@operator.example/feed.zip?api_key=fixture-key&mode=fixture-mode#fixture-fragment'
        error=HTTPError(target,503,'Failure echoed '+target,{},io.BytesIO())
        attempt=pipeline.source_attempt(target,error)
        url=urlparse(attempt['url'])
        self.assertEqual(url.hostname,'operator.example')
        self.assertEqual(url.path,'/feed.zip')
        self.assertIsNone(url.username)
        self.assertEqual(parse_qsl(url.query),[('api_key','[redacted]'),('mode','[redacted]')])
        self.assertEqual(url.fragment,'')
        failure=pipeline.SourceRetrievalError([attempt],unsafe_urls=[target])
        evidence=json.dumps(failure.attempts)+str(failure)
        for value in ['fixture-user','fixture-password','fixture-key','fixture-mode','fixture-fragment']:
            self.assertNotIn(value,evidence)
        self.assertEqual(failure._unsafe_urls,{target},'raw identity stays in memory only for cache rejection')
        self.assertEqual(attempt['message'],'HTTP 503')

    def test_redacted_query_urls_keep_distinct_cache_identities_and_migrate_legacy_metadata(self):
        base,held=self.server(self.archive())
        first_url,second_url=base+'?feed=fixture-first',base+'?feed=fixture-second'
        cache,output=self.root/'query-cache',self.root/'query-output';cache.mkdir()
        def entry(url):
            value=pipeline.discover([{'filename':'ca_query.gtfs.zip','source':url,
                                     'country_code':'CA','delivery':'direct'}],{})[0]
            return value
        result=pipeline.compile_entry(entry(first_url),cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(result['status'],'compiled')
        meta_path=cache/'ca_query.meta.json';meta=json.loads(meta_path.read_text())
        self.assertNotIn('fixture-first',meta_path.read_text())
        self.assertEqual(meta['download_url_sha256'],pipeline.source_url_fingerprint(first_url))
        self.assertEqual(pipeline.redacted_source_url(first_url),pipeline.redacted_source_url(second_url))
        self.assertNotEqual(pipeline.source_url_fingerprint(first_url),pipeline.source_url_fingerprint(second_url))
        self.assertTrue(pipeline.valid_cached_archive(cache/'ca_query.zip',meta,[first_url]))
        self.assertFalse(pipeline.valid_cached_archive(cache/'ca_query.zip',meta,[second_url]))
        # Legacy private cache identity is accepted only against the same full
        # current URL, and rewritten without its query value after revalidation.
        meta['download_url']=first_url;meta.pop('download_url_sha256');meta_path.write_text(json.dumps(meta))
        same=pipeline.compile_entry(entry(first_url),cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(same['status'],'compiled')
        self.assertNotIn('fixture-first',meta_path.read_text())
        self.assertEqual(same['source']['download_url_sha256'],pipeline.source_url_fingerprint(first_url))
        # A different query with the same path must not reuse the old validator.
        before=len(held['conditional_requests']);held['data']=self.archive(rail=False)
        changed=pipeline.compile_entry(entry(second_url),cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(changed['status'],'no_rail')
        self.assertTrue(all(value==(None,None) for value in held['conditional_requests'][before:]))
        self.assertEqual(json.loads(meta_path.read_text())['download_url_sha256'],pipeline.source_url_fingerprint(second_url))

    def test_compiled_shard_and_diagnostic_metadata_excludes_synthetic_url_values(self):
        from contextlib import redirect_stdout
        from urllib.parse import quote
        target='https://fixture-user:fixture-password@operator.example/feed.zip?api_key=fixture-key#fixture-fragment'
        other=target.replace('fixture-key','fixture-other')
        raw={'source':target,'lineage':[{'source':other}], 'urls':[target,other],
             'error':'Failure at '+quote(target,safe=''),target:'first',other:'second'}
        redacted=pipeline.published_metadata(raw)
        self.assertEqual(redacted['source_sha256'],pipeline.source_url_fingerprint(target))
        self.assertEqual(redacted['lineage'][0]['source_sha256'],pipeline.source_url_fingerprint(other))
        self.assertEqual(redacted['urls_sha256'],[pipeline.source_url_fingerprint(target),pipeline.source_url_fingerprint(other)])
        self.assertEqual(pipeline.published_metadata(redacted),redacted)
        self.assertEqual(raw['source'],target,'diagnostic copy does not mutate operational input')
        self.assertEqual(len(redacted),len(raw)+2,'distinct URL keys are preserved')
        identity='https://ids.example/route?variant=synthetic-route-id'
        metadata_feed=self.root/'metadata.json.gz'
        pipeline.write_feed(metadata_feed,{'source':raw,'agencies':[{'agency_id':identity,'agency_url':target}],
                            'routes':[{'route_id':identity,'route_url':target}],
                            'segments':[{'route_id':identity}]})
        metadata=json.loads(gzip.decompress(metadata_feed.read_bytes()))
        self.assertEqual(metadata['routes'][0]['route_id'],identity,'matching IDs are not display URL metadata')
        self.assertEqual(metadata['agencies'][0]['agency_id'],identity)
        self.assertEqual(metadata['segments'][0]['route_id'],identity)
        self.assertEqual(metadata['routes'][0]['route_url_sha256'],pipeline.source_url_fingerprint(target))
        base,_=self.server(self.archive())
        source=base+'?feed=fixture-download'
        row={'filename':'ca_diagnostic.gtfs.zip','source':source,'country_code':'CA','delivery':'direct',
             'lineage':[{'source':target.replace('fixture-user:fixture-password@','')}], 'publisher':{'url':target}}
        entry=pipeline.discover([row],{})[0]
        cache,output=self.root/'diagnostic-cache',self.root/'diagnostic-output';cache.mkdir()
        result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        compiled=gzip.decompress((output/'feeds/ca_diagnostic.json.gz').read_bytes()).decode()
        catalogue=self.root/'diagnostic-catalogue.json';catalogue.write_text(json.dumps([row]))
        logs=io.StringIO()
        argv=['global-service-frequency.py','--catalogue',str(catalogue),'--cache',str(cache),
              '--output',str(output),'--date','2026-10-05']
        with patch.object(sys,'argv',argv),patch.object(pipeline,'compile_entry_isolated',return_value=result),redirect_stdout(logs):
            pipeline.main()
        shard=(output/'inventory-0.json').read_text()
        evidence=compiled+shard+logs.getvalue()+json.dumps(redacted)
        for value in ['fixture-user','fixture-password','fixture-key','fixture-other','fixture-fragment','fixture-download']:
            self.assertNotIn(value,evidence)
        self.assertEqual(json.loads(shard)['entries'][0]['catalogue']['source_sha256'],pipeline.source_url_fingerprint(source))
        self.assertIn('fixture-download',catalogue.read_text(),'operational pinned catalogue retains its retrieval input')

    def test_exact_source_prohibition_covers_catalogue_alias_and_its_processed_copy(self):
        rules={'sources':{'original.gtfs.zip':{
            'expected_source':'https://reviewed.example/rail.zip',
            'prohibit_frequency_use':True,'license_url':'https://reviewed.example/terms'}}}
        for source in ['https://reviewed.example/rail.zip',
                       'https://REVIEWED.example:443/rail.zip#catalogue-fragment']:
            with self.subTest(source=source):
                entry=pipeline.discover([{'filename':'new-alias.gtfs.zip',
                                         'source':source,'country_code':'CA'}],rules)[0]
                self.assertEqual(entry['status'],'excluded')
                self.assertEqual(entry['reason_code'],'source_terms_prohibit_derived_use')
                self.assertEqual(pipeline.source_candidates(entry),[])
        other=pipeline.discover([{'filename':'new-alias.gtfs.zip',
                                  'source':'https://reviewed.example/different.zip','country_code':'CA'}],rules)[0]
        self.assertEqual(other['status'],'pending')
        self.assertEqual(len(pipeline.source_candidates(other)),2)

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
        def broken_processed(url, headers=None, **kwargs):
            if url == processed:
                from urllib.error import HTTPError
                raise HTTPError(url, 404, 'Not Found', {}, io.BytesIO())
            return real_get(url,headers, **kwargs)
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

    def test_malformed_routes_metadata_falls_back_for_whole_and_ranged_archives(self):
        valid=self.archive()
        for ranges in [False,True]:
            for name,table in [('missing-table',None),('missing-column',b'route_id,route_short_name\nr,R\n'),
                               ('missing-value',b'route_id,route_type\nr\n'),
                               ('later-missing-value',b'route_id,route_type\nr,2\ns\n'),
                               ('later-invalid-value',b'route_id,route_type\nr,2\ns,invalid\n'),
                               ('later-missing-id',b'route_id,route_type\nr,2\n,3\n')]:
                with self.subTest(ranges=ranges,malformation=name):
                    data=io.BytesIO()
                    with zipfile.ZipFile(io.BytesIO(valid)) as old,zipfile.ZipFile(data,'w') as archive:
                        for item in old.infolist():
                            if item.filename!='routes.txt':archive.writestr(item,old.read(item.filename))
                        if table is not None:archive.writestr('routes.txt',table)
                    broken,held=self.server(data.getvalue(),ranges=ranges)
                    fallback,_=self.server(valid)
                    entry=pipeline.discover([{'filename':'fallback.gtfs.zip','source':fallback,'country_code':'CA'}],{})[0]
                    entry['processed_url']=broken
                    cache=self.root/f'cache-{ranges}-{name}';cache.mkdir()
                    result=pipeline.compile_entry(entry,cache,self.root/f'output-{ranges}-{name}',
                                                  '2026-10-05',None,1_000_000,pipeline.PROFILES)
                    self.assertEqual(result['status'],'compiled')
                    self.assertEqual(result['source']['download_url_sha256'],pipeline.source_url_fingerprint(fallback))
                    self.assertEqual(result['source']['recovered_source_errors'][0]['code'],'invalid_feed_or_budget')
                    self.assertTrue(held['requests'])
                    direct=pipeline.discover([{'filename':'broken.gtfs.zip','source':broken,'country_code':'CA','delivery':'direct'}],{})[0]
                    with self.assertRaises(pipeline.SourceRetrievalError) as error:
                        pipeline.fetch_alternative(direct,cache/'broken.zip',1_000_000)
                    self.assertEqual(error.exception.attempts[0]['code'],'invalid_feed_or_budget')
                    self.assertFalse((cache/'broken.zip').exists(),'unusable metadata is not a successful no-rail cache')

    def routes_archive(self, table):
        data=io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(self.archive())) as old,zipfile.ZipFile(data,'w') as archive:
            for item in old.infolist():
                archive.writestr(item,table if item.filename=='routes.txt' else old.read(item.filename))
        return data.getvalue()

    def test_conditional_malformed_routes_keep_good_cache_and_try_fallback(self):
        malformed=self.routes_archive(b'route_id,route_type\nr,2\ns,invalid\n')
        for fallback_available in [True,False]:
            with self.subTest(fallback_available=fallback_available):
                processed,held=self.server(self.archive())
                original,_=self.server(self.archive())
                entry=pipeline.discover([{'filename':'refresh.gtfs.zip','source':original if fallback_available else processed,
                                         'country_code':'CA'}],{})[0]
                entry['processed_url']=processed
                cache=self.root/f'refresh-{fallback_available}';cache.mkdir()
                output=self.root/f'refresh-output-{fallback_available}'
                pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
                archive=cache/'refresh.zip';old=archive.read_bytes()
                meta_path=cache/'refresh.meta.json';meta=json.loads(meta_path.read_text())
                yesterday=(pipeline.dt.datetime.now(pipeline.dt.timezone.utc).date()-pipeline.dt.timedelta(days=1)).isoformat()
                meta['retrieved']=meta['checked']=yesterday;meta_path.write_text(json.dumps(meta))
                destination=output/'feeds/refresh.json.gz'
                with gzip.open(destination,'rt') as file:previous=json.load(file)
                previous['source']['retrieved']=previous['source']['checked']=yesterday
                pipeline.write_feed(destination,previous)
                held['data']=malformed;held['etag']='"two"'
                result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
                self.assertEqual(result['status'],'compiled')
                self.assertEqual(archive.read_bytes(),old,'invalid refresh never replaces the last good archive')
                self.assertEqual(result['source']['recovered_source_errors'][0]['code'],'invalid_feed_or_budget')
                if fallback_available:
                    self.assertEqual(result['source']['download_url_sha256'],pipeline.source_url_fingerprint(original))
                    self.assertFalse(result['source']['offline_cached'])
                else:
                    self.assertTrue(result['source']['offline_cached'])
                    self.assertEqual(result['source']['retrieved'],yesterday)
                    self.assertEqual(result['source']['checked'],yesterday)
                    # Once that last valid cache expires the source is still a
                    # retriable failure, never a successful no-rail outcome.
                    meta=json.loads(meta_path.read_text());meta['checked']='2020-01-01'
                    meta_path.write_text(json.dumps(meta))
                    with self.assertRaises(pipeline.SourceRetrievalError) as error:
                        pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
                    self.assertIn('invalid_feed_or_budget',{x['code'] for x in error.exception.attempts})
                    self.assertEqual(archive.read_bytes(),old)

    def test_bad_cached_metadata_on_304_uses_alternative_or_remains_failure(self):
        malformed=self.routes_archive(b'route_id,route_type\nr,2\ns,invalid\n')
        for fallback_available in [True,False]:
            with self.subTest(fallback_available=fallback_available):
                processed,held=self.server(self.archive())
                original,_=self.server(self.archive())
                entry=pipeline.discover([{'filename':'cached.gtfs.zip','source':original if fallback_available else processed,
                                         'country_code':'CA'}],{})[0]
                entry['processed_url']=processed
                cache=self.root/f'cached-{fallback_available}';cache.mkdir()
                output=self.root/f'cached-output-{fallback_available}'
                pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
                path=cache/'cached.zip';path.write_bytes(malformed)
                meta=json.loads((cache/'cached.meta.json').read_text())
                self.assertFalse(pipeline.valid_cached_archive(path,meta,pipeline.source_candidates(entry)))
                if fallback_available:
                    result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
                    self.assertEqual(result['status'],'compiled')
                    self.assertEqual(result['source']['download_url_sha256'],pipeline.source_url_fingerprint(original))
                    self.assertEqual(result['source']['recovered_source_errors'][0]['code'],'invalid_feed_or_budget')
                else:
                    with self.assertRaises(pipeline.SourceRetrievalError):
                        pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
                    self.assertEqual(json.loads((cache/'cached.meta.json').read_text()),meta)
                self.assertIn(('"one"',None),held['conditional_requests'])

    def test_full_download_routes_are_revalidated_after_range_preflight(self):
        valid=self.archive()
        malformed=self.routes_archive(b'route_id,route_type\nr,2\ns,invalid\n')
        entry=pipeline.discover([{'filename':'revision.gtfs.zip','source':'https://fixture.example/feed.zip',
                                 'country_code':'CA','delivery':'direct'}],{})[0]
        class ChangedRemote:
            etag='"one"';last_modified=None;full=malformed
            def __init__(self,*args,**kwargs):pass
            def table(self,name):
                with zipfile.ZipFile(io.BytesIO(valid)) as archive:return archive.read(name)
            def download(self):return self.full
        path=self.root/'changed.zip'
        with patch.object(pipeline,'RemoteZip',ChangedRemote):
            with self.assertRaises(pipeline.SourceRetrievalError):
                pipeline.fetch_alternative(entry,path,1_000_000)
        self.assertFalse(path.exists())

    def undecodable_archive(self, kind):
        data=bytearray(self.archive())
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            info=archive.getinfo('routes.txt');local=info.header_offset
        central=0
        while True:
            central=data.index(b'PK\x01\x02',central)
            name_len=struct.unpack_from('<H',data,central+28)[0]
            if data[central+46:central+46+name_len]==b'routes.txt':break
            central+=46+name_len
        if kind=='encrypted':
            for offset in [local+6,central+8]:
                flags=struct.unpack_from('<H',data,offset)[0]
                struct.pack_into('<H',data,offset,flags|1)
        elif kind=='unsupported':
            for offset in [local+8,central+10]:struct.pack_into('<H',data,offset,99)
        else:
            name_len,extra_len=struct.unpack_from('<HH',data,local+26)
            data[local+30+name_len+extra_len]=7  # Invalid deflate block type.
        return bytes(data)

    def test_zip_metadata_decode_failures_reach_fallback_without_replacing_cache(self):
        for kind in ['encrypted','unsupported','deflate']:
            malformed=self.undecodable_archive(kind)
            for mode in ['whole','ranged','conditional']:
                with self.subTest(kind=kind,mode=mode):
                    processed,held=self.server(self.archive() if mode=='conditional' else malformed,ranges=mode!='whole')
                    original,_=self.server(self.archive())
                    entry=pipeline.discover([{'filename':'decode.gtfs.zip','source':original,'country_code':'CA'}],{})[0]
                    entry['processed_url']=processed
                    cache=self.root/f'decode-{kind}-{mode}';cache.mkdir()
                    output=self.root/f'decode-out-{kind}-{mode}'
                    if mode=='conditional':
                        pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
                        old=(cache/'decode.zip').read_bytes()
                        held['data']=malformed;held['etag']='"two"'
                    result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
                    self.assertEqual(result['status'],'compiled')
                    self.assertEqual(result['source']['download_url_sha256'],pipeline.source_url_fingerprint(original))
                    self.assertEqual(result['source']['recovered_source_errors'][0]['code'],'invalid_feed_or_budget')
                    if mode=='conditional':self.assertEqual((cache/'decode.zip').read_bytes(),old)
                    direct=pipeline.discover([{'filename':'bad.gtfs.zip','source':processed,'country_code':'CA','delivery':'direct'}],{})[0]
                    with self.assertRaises(pipeline.SourceRetrievalError):
                        pipeline.fetch_alternative(direct,cache/'bad.zip',1_000_000)
                    self.assertFalse((cache/'bad.zip').exists())

    def test_inconsistent_range_zip_directories_fall_back_or_remain_retriable(self):
        for kind in ['excess-record-count','short-directory-header','truncated-record-fields']:
            with self.subTest(kind=kind):
                data=bytearray(self.archive());end=data.rfind(b'PK\x05\x06')
                if kind=='excess-record-count':
                    struct.pack_into('<HH',data,end+8,100,100)
                elif kind=='short-directory-header':
                    struct.pack_into('<I',data,end+12,1)
                else:
                    central=struct.unpack_from('<I',data,end+16)[0]
                    struct.pack_into('<H',data,central+28,65535)
                processed,held=self.server(bytes(data))
                original,_=self.server(self.archive())
                entry=pipeline.discover([{'filename':'directory.gtfs.zip','source':original,'country_code':'CA'}],{})[0]
                entry['processed_url']=processed
                cache=self.root/kind;cache.mkdir()
                result=pipeline.compile_entry(entry,cache,self.root/(kind+'-output'),'2026-10-05',None,1_000_000,pipeline.PROFILES)
                self.assertEqual(result['status'],'compiled')
                self.assertEqual(result['source']['download_url_sha256'],pipeline.source_url_fingerprint(original))
                self.assertEqual(result['source']['recovered_source_errors'][0]['code'],'invalid_feed_or_budget')
                direct=pipeline.discover([{'filename':'broken.gtfs.zip','source':processed,'country_code':'CA','delivery':'direct'}],{})[0]
                with self.assertRaises(pipeline.SourceRetrievalError) as error:
                    pipeline.fetch_alternative(direct,cache/'broken.zip',1_000_000)
                self.assertEqual(error.exception.attempts[0]['code'],'invalid_feed_or_budget')
                self.assertFalse((cache/'broken.zip').exists())
                self.assertTrue(all(held['requests']),'malformed ranged directory never triggers a full bad download')

    def test_bounded_zip_header_corruption_matrix_preserves_fallback_and_cache(self):
        for kind in ['truncated-file','central-signature','local-signature','local-name-overflow','bad-crc','unsupported-version']:
            data=bytearray(self.archive());end=data.rfind(b'PK\x05\x06')
            central=struct.unpack_from('<I',data,end+16)[0]
            with zipfile.ZipFile(io.BytesIO(data)) as archive:local=archive.getinfo('routes.txt').header_offset
            if kind=='truncated-file':data=data[:-1000]
            elif kind=='central-signature':data[central:central+4]=b'BAD!'
            elif kind=='local-signature':data[local:local+4]=b'BAD!'
            elif kind=='local-name-overflow':struct.pack_into('<H',data,local+26,65535)
            elif kind=='bad-crc':
                while True:
                    name_len=struct.unpack_from('<H',data,central+28)[0]
                    if data[central+46:central+46+name_len]==b'routes.txt':break
                    central=data.index(b'PK\x01\x02',central+46+name_len)
                crc=struct.unpack_from('<I',data,central+16)[0]
                struct.pack_into('<I',data,central+16,crc^0xffffffff)
            else:struct.pack_into('<H',data,central+6,99)
            malformed=bytes(data)
            for mode in ['whole','ranged','conditional']:
                with self.subTest(kind=kind,mode=mode):
                    processed,held=self.server(self.archive() if mode=='conditional' else malformed,ranges=mode!='whole')
                    original,_=self.server(self.archive())
                    entry=pipeline.discover([{'filename':'matrix.gtfs.zip','source':original,'country_code':'CA'}],{})[0]
                    entry['processed_url']=processed
                    cache=self.root/f'matrix-{kind}-{mode}';cache.mkdir()
                    output=self.root/f'matrix-out-{kind}-{mode}'
                    if mode=='conditional':
                        pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
                        old=(cache/'matrix.zip').read_bytes()
                        held['data']=malformed;held['etag']='"two"'
                    result=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
                    self.assertEqual(result['status'],'compiled')
                    self.assertEqual(result['source']['download_url_sha256'],pipeline.source_url_fingerprint(original))
                    self.assertEqual(result['source']['recovered_source_errors'][0]['code'],'invalid_feed_or_budget')
                    if mode=='conditional':self.assertEqual((cache/'matrix.zip').read_bytes(),old)
                    direct=pipeline.discover([{'filename':'bad.gtfs.zip','source':processed,'country_code':'CA','delivery':'direct'}],{})[0]
                    with self.assertRaises(pipeline.SourceRetrievalError):
                        pipeline.fetch_alternative(direct,cache/'bad.zip',1_000_000)
                    self.assertFalse((cache/'bad.zip').exists())

    def test_zip_decoder_boundaries_preserve_programmer_and_control_flow_errors(self):
        from types import SimpleNamespace
        archive=SimpleNamespace(getinfo=lambda name:SimpleNamespace(file_size=10,flag_bits=0))
        errors=[zipfile.BadZipFile('bad'),EOFError('truncated'),struct.error('short'),
                NotImplementedError('unsupported codec'),pipeline.zlib.error('bad deflate')]
        if pipeline.lzma:errors.append(pipeline.lzma.LZMAError('bad lzma'))
        for error in errors:
            with self.subTest(error=type(error).__name__):
                with patch.object(pipeline.zipfile,'ZipFile',side_effect=error):
                    with self.assertRaises(ValueError):pipeline.source_archive(io.BytesIO())
                archive.read=lambda info,error=error:(_ for _ in ()).throw(error)
                with self.assertRaises(ValueError):pipeline.archive_metadata(archive,'routes.txt')
        for error in [TypeError('programmer'),AssertionError('invariant'),RuntimeError('programmer'),
                      MemoryError('budget'),KeyboardInterrupt(),SystemExit(1)]:
            with self.subTest(preserved=type(error).__name__):
                with patch.object(pipeline.zipfile,'ZipFile',side_effect=error):
                    with self.assertRaises(type(error)) as caught:pipeline.source_archive(io.BytesIO())
                    self.assertIs(caught.exception,error)
                archive.read=lambda info,error=error:(_ for _ in ()).throw(error)
                with self.assertRaises(type(error)) as caught:pipeline.archive_metadata(archive,'routes.txt')
                self.assertIs(caught.exception,error)
        for codec in ['zlib','bz2','lzma']:
            archive.read=lambda info:(_ for _ in ()).throw(RuntimeError(f'Compression requires the (missing) {codec} module'))
            with self.assertRaises(ValueError):pipeline.archive_metadata(archive,'routes.txt')
        for size in range(30):
            with self.assertRaises(ValueError):pipeline.unpack_zip_metadata('<4s5H3I2H',b'X'*size)
        for size in range(46):
            with self.assertRaises(ValueError):pipeline.unpack_zip_metadata('<4s6H3I5H2I',b'X'*size)

    def test_lineage_fallback_enforces_domains_and_exact_source_review_before_fetch(self):
        from urllib.error import HTTPError
        allowed, held = self.server(self.archive())
        denied = 'https://reviewed.example/rail.zip'
        row = {'filename': 'jp_rail.gtfs.zip', 'source': 'https://operator.example/old.zip',
               'country_code': 'JP', 'lineage': [
                   {'source': 'https://publisher.ru/rail.zip'},
                   {'source': 'https://PUBLISHER.RU./rail.zip'},
                   {'source': denied}, {'source': denied + '#fragment'},
                   {'source': 'https://REVIEWED.example:443/rail.zip'},
                   {'source': allowed}]}
        # The reviewed original has changed in the primary row, but still appears
        # in lineage; its exact-source prohibition still applies to acquisition.
        rules = {'sources': {'jp_rail.gtfs.zip': {'expected_source': denied,
                  'prohibit_frequency_use': True, 'license_url': 'https://reviewed.example/terms'}}}
        entry = pipeline.discover([row], rules)[0]
        self.assertEqual(entry['status'], 'pending')
        self.assertEqual(pipeline.source_candidates(entry), [entry['processed_url'], row['source'], allowed])
        entry = json.loads(json.dumps(entry))  # The worker receives the same rules.
        seen = []
        real_get = pipeline.get
        def fetch(url, headers=None, **kwargs):
            seen.append(url)
            if url != allowed:
                raise HTTPError(url, 404, 'Missing fixture', {}, io.BytesIO())
            return real_get(url, headers, **kwargs)
        cache, output = self.root/'policy-cache', self.root/'policy-output'
        cache.mkdir()
        with patch.object(pipeline, 'get', side_effect=fetch):
            result = pipeline.compile_entry(entry, cache, output, '2026-10-05', None,
                                            1_000_000, pipeline.PROFILES)
        self.assertEqual(result['status'], 'compiled')
        self.assertEqual(result['source']['download_url'], allowed)
        self.assertEqual(set(seen), {entry['processed_url'], row['source'], allowed})
        self.assertTrue(held['requests'])
        self.assertEqual(len(result['source']['recovered_source_errors']), 2)

    def test_source_rules_are_exact_and_unknown_rights_remain_eligible(self):
        rule = {'sources': {'other.gtfs.zip': {'expected_source': 'https://reviewed.example/rail.zip',
                'prohibit_frequency_use': True, 'terms_url': 'https://reviewed.example/terms'},
                'blocked.gtfs.zip': {'expected_source': 'https://publisher.ru/rail.zip',
                'prohibit_frequency_use': True, 'license_url': 'https://publisher.ru/terms'}}}
        row = {'filename': 'rail.gtfs.zip', 'source': 'https://unreviewed.example/rail.zip',
               'country_code': 'JP', 'lineage': [{'source': 'https://reviewed.example/rail.zip'},
                                               {'source': 'https://reviewed.example/different.zip'}]}
        entry = pipeline.discover([row], rule)[0]
        self.assertEqual(entry['terms']['state'], 'not_provided')
        self.assertEqual(entry['status'], 'pending')
        self.assertEqual(pipeline.source_candidates(entry), [entry['processed_url'], row['source'],
                                                             'https://reviewed.example/different.zip'])
        entry['catalogue']['country_code'] = 'RU'
        self.assertEqual(pipeline.source_candidates(entry), [])

    def test_new_source_rule_prevents_conditional_or_offline_cache_reuse(self):
        from urllib.error import HTTPError
        url, held = self.server(self.archive())
        row = {'filename': 'rail.gtfs.zip', 'source': 'https://operator.example/rail.zip',
               'country_code': 'JP', 'lineage': [{'source': url}]}
        entry = pipeline.discover([row], {})[0]
        entry['processed_url'] = url
        cache, output = self.root/'rule-cache', self.root/'rule-output'
        cache.mkdir()
        pipeline.compile_entry(entry, cache, output, '2026-10-05', None, 1_000_000, pipeline.PROFILES)
        entry['denied_source_urls'] = [url]
        seen = []
        def unavailable(target, headers=None, **kwargs):
            seen.append(target)
            raise HTTPError(target, 404, 'Missing fixture', {}, io.BytesIO())
        with patch.object(pipeline, 'get', side_effect=unavailable), \
             self.assertRaises(pipeline.SourceRetrievalError):
            pipeline.compile_entry(entry, cache, output, '2026-10-05', None, 1_000_000, pipeline.PROFILES)
        self.assertEqual(seen, [row['source']])

    def test_unsafe_refresh_target_does_not_become_an_offline_cache_success(self):
        url, held = self.server(self.archive())
        entry = pipeline.discover([{'filename': 'rail.gtfs.zip', 'source': url, 'country_code': 'JP'}], {})[0]
        entry['processed_url'] = url
        cache, output = self.root/'target-cache', self.root/'target-output'
        cache.mkdir()
        pipeline.compile_entry(entry, cache, output, '2026-10-05', None, 1_000_000, pipeline.PROFILES)
        with patch.object(pipeline, 'get', side_effect=pipeline.UnsafeSourceURL('Non-public acquisition address')), \
             self.assertRaises(pipeline.SourceRetrievalError) as caught:
            pipeline.compile_entry(entry, cache, output, '2026-10-05', None, 1_000_000, pipeline.PROFILES)
        self.assertEqual(caught.exception.attempts[0]['code'], 'unsafe_source_url')
        self.assertEqual(pipeline.classify_failure(caught.exception), ('source_retrieval_error', 'retrieval'))

    def test_all_source_404s_are_recoverable_with_inspectable_attempts(self):
        from urllib.error import HTTPError
        row={'filename':'jp_rail.gtfs.zip','source':'https://operator.example/rail.zip','country_code':'JP'}
        entry=pipeline.discover([row],{})[0]
        cache,output=self.root/'missing-cache',self.root/'missing-output'
        cache.mkdir()
        def only_404(url, headers=None, **kwargs):
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
        def broken(url, headers=None, **kwargs):
            if url==entry['processed_url']:
                from email.message import Message
                class Response(io.BytesIO):
                    status=200
                    headers={'Content-Length':'10','ETag':'"new"'}
                    def __enter__(self): return self
                    def __exit__(self,*_): self.close()
                return Response(b'not-a-zip')
            return real_get(url,headers, **kwargs)
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

        def offline(url,headers=None, **kwargs):
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
        def unavailable(url,headers=None, **kwargs):
            raise HTTPError(url,404,'Gone',{},io.BytesIO())
        meta['checked']='2020-01-01'
        meta_file.write_text(json.dumps(meta))
        with patch.object(pipeline,'get',side_effect=unavailable):
            with self.assertRaises(pipeline.SourceRetrievalError):
                pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        meta['checked']=old_date=__import__('datetime').date.today().isoformat()
        meta['download_url']='https://different.example/previous-source.zip'
        meta.pop('download_url_sha256',None)  # exercise legacy full-URL mismatch
        meta_file.write_text(json.dumps(meta))
        with patch.object(pipeline,'get',side_effect=unavailable):
            with self.assertRaises(pipeline.SourceRetrievalError):
                pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)

    def test_bounded_retries_respect_publisher_backoff_and_do_not_repeat_404(self):
        from urllib.error import HTTPError
        attempts=[]
        def transient(request, timeout=45, **kwargs):
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

        def permanent(request, timeout=45, **kwargs):
            attempts.append(request.full_url)
            raise HTTPError(request.full_url,404,'Not Found',{},io.BytesIO())
        attempts.clear()
        with patch.object(pipeline,'urlopen',side_effect=permanent), patch.object(pipeline.time,'sleep') as sleep:
            with self.assertRaises(HTTPError):
                pipeline.get('https://example.net/missing.zip')
        self.assertEqual(len(attempts),1,'retry the alternate feed, not the dead 404 itself')
        sleep.assert_not_called()

        def delayed(request, timeout=45, **kwargs):
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

    def test_retry_after_parses_seconds_dates_past_and_invalid_values(self):
        from email.utils import formatdate
        now = 1791536400.0
        cases = [('0', 0), (' 8 ', 8), ('120', 120),
                 (formatdate(now + 5, usegmt=True), 5),
                 (formatdate(now + 3600, usegmt=True), 3600),
                 (formatdate(now - 10, usegmt=True), 0),
                 (None, None), ('', None), ('later', None), ('-1', None), ('1.5', None)]
        for value, expected in cases:
            with self.subTest(value=value):
                self.assertEqual(pipeline.retry_after_delay(value, now), expected)

    def test_short_retry_after_date_waits_until_the_publisher_deadline(self):
        from email.utils import formatdate
        from urllib.error import HTTPError
        clock=[1791536400.0]
        deadline=clock[0]+5
        requests=[]
        def upstream(request,timeout=45, **kwargs):
            requests.append(clock[0])
            if len(requests)==1:
                raise HTTPError(request.full_url,503,'Unavailable',
                                {'Retry-After':formatdate(deadline,usegmt=True)},io.BytesIO())
            return io.BytesIO(b'ok')
        def advance(delay):
            clock[0]+=delay
        with patch.object(pipeline,'urlopen',side_effect=upstream), \
             patch.object(pipeline.time,'time',side_effect=lambda:clock[0]), \
             patch.object(pipeline.time,'sleep',side_effect=advance) as sleep:
            with pipeline.get('https://operator.example/rail.zip') as response:
                self.assertEqual(response.read(),b'ok')
        self.assertEqual(requests,[deadline-5,deadline])
        sleep.assert_called_once_with(5.0)

    def test_retry_after_dates_bound_requests_and_preserve_retry_pending_inventory(self):
        from email.utils import formatdate
        from urllib.error import HTTPError
        now = 1791536400.0
        for header, sleeps, count in [
                ('120', [], 1), (formatdate(now + 3600, usegmt=True), [], 1),
                (formatdate(now + 5, usegmt=True), [5.0, 5.0], 3),
                (formatdate(now - 5, usegmt=True), [0.0, 0.0], 3),
                ('invalid', [1.0, 2.0], 3)]:
            with self.subTest(header=header):
                def unavailable(request, timeout=45, **kwargs):
                    raise HTTPError(request.full_url,503,'Unavailable',{'Retry-After':header},io.BytesIO())
                with patch.object(pipeline,'urlopen',side_effect=unavailable) as request, \
                     patch.object(pipeline.time,'time',return_value=now), \
                     patch.object(pipeline.time,'sleep') as sleep:
                    with self.assertRaises(HTTPError) as caught:
                        pipeline.get('https://operator.example/rail.zip')
                self.assertEqual(request.call_count,count)
                self.assertEqual([x.args[0] for x in sleep.call_args_list],sleeps)
                caught.exception.close()
        catalogue=self.root/'delayed-catalogue.json'
        catalogue.write_text(json.dumps([{'filename':'delayed.gtfs.zip','country_code':'CA',
                                         'delivery':'direct','source':'https://operator.example/rail.zip'}]))
        cache,output=self.root/'delay-cache',self.root/'delay-output'
        def deferred(entry,*args):
            try:
                pipeline.get(entry['processed_url'])
            except HTTPError as error:
                raise pipeline.SourceRetrievalError([pipeline.source_attempt(entry['processed_url'],error)])
        def long_delay(request,timeout=45, **kwargs):
            raise HTTPError(request.full_url,429,'Rate Limited',
                            {'Retry-After':formatdate(now+3600,usegmt=True)},io.BytesIO())
        with patch('sys.argv',['global-service-frequency.py','--catalogue',str(catalogue),
                              '--cache',str(cache),'--output',str(output),'--date','2026-10-05']), \
             patch.object(pipeline,'compile_entry_isolated',side_effect=deferred), \
             patch.object(pipeline,'urlopen',side_effect=long_delay) as request, \
             patch.object(pipeline.time,'time',return_value=now), \
             patch.object(pipeline.time,'sleep') as sleep:
            pipeline.main()
        record=json.loads((output/'inventory-0.json').read_text())['entries'][0]
        self.assertEqual(request.call_count,1)
        sleep.assert_not_called()
        self.assertEqual(record['status'],'retry_pending')
        self.assertTrue(record['retry_eligible'])
        self.assertEqual(record['source_attempts'][0]['code'],'http_429')

    def archive(self,rail=True):
        data=io.BytesIO()
        with zipfile.ZipFile(data,'w',compression=zipfile.ZIP_DEFLATED) as z:
            def write(name,value):
                info=zipfile.ZipInfo(name,(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
                z.writestr(info,value)
            write('routes.txt','route_id,route_type,agency_id,route_short_name\nr,2,a,R\n' if rail else 'route_id,route_type\nb,3\n')
            write('agency.txt','agency_id,agency_name,agency_timezone\na,National Rail,Etc/UTC\n')
            write('feed_info.txt','feed_start_date,feed_end_date\n20260101,20261231\n')
            write('stops.txt','stop_id,stop_name,stop_lat,stop_lon\nA,A,30,31\nB,B,30.01,31\n')
            write('trips.txt','trip_id,route_id,service_id\nt,r,w\n')
            write('stop_times.txt','trip_id,stop_sequence,stop_id,departure_time\nt,1,A,08:00:00\nt,2,B,08:10:00\n')
            write('calendar.txt','service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nw,1,1,1,1,1,1,1,20260101,20261231\n')
            write('unused-padding.bin',bytes(range(256))*2000)
        return data.getvalue()

    def test_fixture_archive_bytes_do_not_depend_on_wall_clock(self):
        with patch('zipfile.time.localtime',return_value=(2026,1,1,0,0,0,0,1,0)):
            first=self.archive()
        with patch('zipfile.time.localtime',return_value=(2026,10,9,11,0,2,4,282,0)):
            second=self.archive()
        self.assertEqual(first,second)
        with zipfile.ZipFile(io.BytesIO(first)) as archive:
            self.assertTrue(all(info.date_time==(2026,1,1,0,0,0) for info in archive.infolist()))

    def server(self,data,ranges=True,change=False,last_modified=False):
        held={'requests':[],'conditional_requests':[],'range_validators':[],'etag':None if last_modified else '"one"','last_modified':'Mon, 01 Jun 2026 00:00:00 GMT' if last_modified else None,'data':data}
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                data=held['data']
                range_value=self.headers.get('Range');held['requests'].append(range_value)
                validator=self.headers.get('If-Range');held['range_validators'].append(validator)
                held['conditional_requests'].append((self.headers.get('If-None-Match'),self.headers.get('If-Modified-Since')))
                if held.get('redirect'):
                    self.send_response(302);self.send_header('Location',held['redirect']);self.end_headers();return
                if held.get('retry_after'):
                    self.send_response(503);self.send_header('Retry-After',held['retry_after']);self.end_headers();return
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
        self.fixture_ports.add(server.server_port)
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

    def test_bus_only_fallback_invalidates_old_rail_cache_before_a_later_outage(self):
        from urllib.error import HTTPError
        processed,_=self.server(self.archive())
        original,_=self.server(self.archive(rail=False))
        entry=pipeline.discover([{'filename':'ca_changed.gtfs.zip','source':original,
                                 'country_code':'CA'}],{})[0]
        entry['processed_url']=processed
        cache,output=self.root/'changed-cache',self.root/'changed-output';cache.mkdir()
        first=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(first['status'],'compiled')
        archive=cache/'ca_changed.zip';old=archive.read_bytes()
        real_get=pipeline.get
        def missing_processed(url,headers=None,*,policy=None,retry_state=None):
            if url==processed:raise HTTPError(url,404,'Gone',{},io.BytesIO())
            return real_get(url,headers,policy=policy,retry_state=retry_state)
        with patch.object(pipeline,'get',side_effect=missing_processed):
            current=pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertEqual(current['status'],'no_rail')
        self.assertFalse(archive.exists())
        self.assertFalse((output/'feeds/ca_changed.json.gz').exists())
        meta=json.loads((cache/'ca_changed.meta.json').read_text())
        self.assertTrue(meta['no_rail'])
        self.assertEqual(meta['download_url'],original)
        # Also cover an orphaned old ZIP: a persisted no-rail fact prevents
        # offline reuse even if the prior cache deletion was interrupted.
        archive.write_bytes(old)
        self.assertFalse(pipeline.valid_cached_archive(archive,meta,pipeline.source_candidates(entry)))
        def unavailable(url,headers=None,*,policy=None,retry_state=None):raise HTTPError(url,503,'Unavailable',{},io.BytesIO())
        with patch.object(pipeline,'get',side_effect=unavailable):
            with self.assertRaises(pipeline.SourceRetrievalError):
                pipeline.compile_entry(entry,cache,output,'2026-10-05',None,1_000_000,pipeline.PROFILES)
        self.assertFalse((output/'feeds/ca_changed.json.gz').exists())

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


class PublicAcquisition(unittest.TestCase):
    """Run the real HTTP client against fake sockets; there is no real egress."""
    def setUp(self):
        self.responses = []
        self.sockets = []
        self.dns_calls = []
        owner = self
        class FakeSocket:
            def __init__(self, *args):
                self.sent = b''
                self.closed = False
                owner.sockets.append(self)
            def settimeout(self, value): self.timeout = value
            def setsockopt(self, *args): pass
            def connect(self, address): self.address = address
            def getpeername(self): return self.address
            def sendall(self, value): self.sent += value
            def makefile(self, *args):
                if not owner.responses:
                    raise AssertionError('Unexpected HTTP request')
                return io.BytesIO(owner.responses.pop(0))
            def close(self): self.closed = True
        self.socket_type = FakeSocket
        self.socket_factory = self.enterContext(patch.object(pipeline.socket, 'socket', side_effect=FakeSocket))
        self.resolver = self.enterContext(patch.object(pipeline.socket, 'getaddrinfo', side_effect=self.public_dns))
        self.sleep = self.enterContext(patch.object(pipeline.time, 'sleep'))

    def public_dns(self, host, port, **kwargs):
        self.dns_calls.append((host, port))
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, '', ('93.184.216.34', port))]

    def response(self, code=200, headers=None, data=b'feed'):
        fields = {'Content-Length': str(len(data)), **(headers or {})}
        self.responses.append((f'HTTP/1.1 {code} Fixture\r\n' +
                               ''.join(f'{key}: {value}\r\n' for key, value in fields.items()) +
                               '\r\n').encode() + data)

    def test_literal_special_use_targets_are_blocked_before_dns_or_connect(self):
        addresses = ['0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1',
                     '169.254.169.254', '172.16.0.1', '192.168.1.1', '192.0.0.8',
                     '192.0.2.1', '192.88.99.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
                     '[::]', '[::1]', '[fc00::1]', '[fe80::1]', '[fec0::1]', '[ff02::1]',
                     '[::ffff:127.0.0.1]', '[::ffff:8.8.8.8]', '[64:ff9b::a00:1]',
                     '[2002:7f00:1::]', '[2001::1]', '[2001:20::1]', '[2001:db8::1]', '[3fff::1]']
        for address in addresses:
            with self.subTest(address=address), self.assertRaises(pipeline.UnsafeSourceURL):
                pipeline.get('http://' + address + '/feed.zip')
        self.resolver.assert_not_called()
        self.socket_factory.assert_not_called()
        self.sleep.assert_not_called()

    def test_non_http_credentials_malformed_urls_and_policy_domains_never_resolve(self):
        urls = ['file:///tmp/feed.zip', 'ftp://operator.example/feed.zip', 'http:///feed.zip',
                'http://name:password@operator.example/feed.zip', 'http://operator.example:0/x',
                'http://operator.example:65536/x', 'http://operator.example:/x',
                'http://[fe80::1%25eth0]/x', 'http://operator.example\\@127.0.0.1/x',
                'http://operator.example/\nfeed.zip', ' http://operator.example/feed.zip',
                'http://operator.example/ feed.zip', 'https://publisher.ru/feed.zip',
                'https://PUBLISHER.RU./feed.zip', 'https://publisher.ＲＵ/feed.zip']
        for url in urls:
            with self.subTest(url=url), self.assertRaises(ValueError):
                pipeline.get(url)
        self.resolver.assert_not_called()
        self.socket_factory.assert_not_called()

    def test_dns_private_mixed_empty_and_legacy_numeric_targets_are_blocked(self):
        for host, addresses in [('private.example', ['10.1.2.3']),
                                ('mixed.example', ['93.184.216.34', '127.0.0.1']),
                                ('ipv6.example', ['fe80::1']), ('empty.example', []),
                                ('2130706433', ['127.0.0.1']), ('127.1', ['127.0.0.1']),
                                ('0x7f000001', ['127.0.0.1'])]:
            answers = [(socket.AF_INET6 if ':' in value else socket.AF_INET,
                        socket.SOCK_STREAM, socket.IPPROTO_TCP, '', (value, 80)) for value in addresses]
            with self.subTest(host=host), patch.object(pipeline.socket, 'getaddrinfo', return_value=answers), \
                 self.assertRaises(pipeline.UnsafeSourceURL):
                pipeline.get('http://' + host + '/feed.zip')
        self.socket_factory.assert_not_called()
        self.sleep.assert_not_called()

    def test_http_dns_is_pinned_and_original_host_range_and_conditions_survive(self):
        self.response(206, {'Content-Range': 'bytes 0-3/4', 'ETag': '"one"'})
        answers = self.public_dns('operator.example', 80)
        # A second resolution would rebind to loopback. The transport must not do it.
        self.resolver.side_effect = [answers, [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP,
                                               '', ('127.0.0.1', 80))]]
        with patch.dict('os.environ', {'http_proxy': 'http://127.0.0.1:1', 'HTTP_PROXY': 'http://127.0.0.1:1'}):
            with pipeline.get('http://operator.example/feed.zip?version=1',
                              {'Range': 'bytes=0-3', 'If-Range': '"one"', 'If-None-Match': '"old"'}) as response:
                self.assertEqual(response.status, 206)
                self.assertEqual(response.read(), b'feed')
        self.assertEqual(self.resolver.call_count, 1)
        self.assertEqual(self.sockets[0].address, ('93.184.216.34', 80))
        sent = self.sockets[0].sent.lower()
        for field in [b'get /feed.zip?version=1 http/1.1', b'host: operator.example',
                      b'range: bytes=0-3', b'if-range: "one"', b'if-none-match: "old"']:
            self.assertIn(field, sent)
        self.assertTrue(self.sockets[0].closed)

    def test_https_keeps_certificate_verification_and_original_sni_on_pinned_socket(self):
        import ssl
        self.response()
        context = ssl.create_default_context()
        seen = []
        def wrap(sock, server_hostname):
            self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
            self.assertTrue(context.check_hostname)
            seen.append((sock.address, server_hostname))
            return sock
        with patch.object(context, 'wrap_socket', side_effect=wrap), \
             patch.object(pipeline.http.client.ssl, '_create_default_https_context', return_value=context):
            with pipeline.get('https://operator.example/feed.zip') as response:
                self.assertEqual(response.read(), b'feed')
        self.assertEqual(seen, [(('93.184.216.34', 443), 'operator.example')])
        self.assertEqual(self.resolver.call_count, 1)

    def test_peer_mismatch_is_rejected_before_request_bytes(self):
        with patch.object(self.socket_type, 'getpeername', return_value=('127.0.0.1', 80)), \
             self.assertRaises(pipeline.UnsafeSourceURL):
            pipeline.get('http://operator.example/feed.zip')
        self.assertEqual(len(self.sockets), 1)
        self.assertEqual(self.sockets[0].sent, b'')
        self.assertTrue(self.sockets[0].closed)
        self.sleep.assert_not_called()

    def test_every_redirect_hop_is_validated_before_destination_connect(self):
        for destination in ['http://127.0.0.1/feed.zip', 'http://169.254.169.254/feed.zip',
                            'http://[::1]/feed.zip', 'file:///tmp/feed.zip',
                            'http://user:password@operator.example/feed.zip',
                            'http://publisher.ru/feed.zip', 'http://denied.example/feed.zip']:
            self.sockets.clear()
            self.response(302, {'Location': destination})
            def policy(url):
                pipeline.source_policy({'denied_source_urls': ['http://denied.example/feed.zip']}, url)
            with self.subTest(destination=destination), self.assertRaises(ValueError):
                pipeline.get('http://operator.example/feed.zip', policy=policy)
            self.assertEqual(len(self.sockets), 1)
            self.assertTrue(self.sockets[0].closed)
        self.sleep.assert_not_called()

    def test_redirect_dns_rebinding_and_mixed_answers_never_create_second_socket(self):
        self.response(302, {'Location': '/new.zip'})
        self.resolver.side_effect = [self.public_dns('operator.example', 80),
                                    [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP,
                                      '', ('10.0.0.1', 80))]]
        with self.assertRaises(pipeline.UnsafeSourceURL):
            pipeline.get('http://operator.example/feed.zip')
        self.assertEqual(self.resolver.call_count, 2)
        self.assertEqual(len(self.sockets), 1)
        self.assertTrue(self.sockets[0].closed)

    def test_public_redirect_chain_preserves_range_conditions_but_not_cross_host_auth(self):
        self.response(302, {'Location': '/next.zip'})
        self.response(307, {'Location': 'http://cdn.example/feed.zip'})
        self.response(206, {'Content-Range': 'bytes 0-3/4'})
        visited = []
        with pipeline.get('http://operator.example/feed.zip',
                          {'Range': 'bytes=0-3', 'If-Range': '"one"', 'Authorization': 'fixture',
                           'Cookie': 'fixture', 'Host': 'override.example'}, policy=visited.append) as response:
            self.assertEqual(response.read(), b'feed')
            self.assertEqual(response.url, 'http://cdn.example/feed.zip')
        self.assertEqual(visited, ['http://operator.example/feed.zip', 'http://operator.example/next.zip',
                                   'http://cdn.example/feed.zip'])
        self.assertEqual([host for host, _ in self.dns_calls], ['operator.example', 'operator.example', 'cdn.example'])
        for sock in self.sockets:
            self.assertIn(b'Range: bytes=0-3'.lower(), sock.sent.lower())
            self.assertIn(b'If-range: "one"'.lower(), sock.sent.lower())
            self.assertTrue(sock.closed)
        self.assertIn(b'Host: cdn.example', self.sockets[-1].sent)
        self.assertNotIn(b'override.example', self.sockets[-1].sent)
        self.assertNotIn(b'authorization:', self.sockets[-1].sent.lower())
        self.assertNotIn(b'cookie:', self.sockets[-1].sent.lower())

    def test_redirect_loop_limit_and_https_downgrade_are_bounded(self):
        for _ in range(6):
            self.response(302, {'Location': '/feed.zip'})
        with self.assertRaisesRegex(pipeline.UnsafeSourceURL, 'redirects'):
            pipeline.get('http://operator.example/feed.zip')
        self.assertEqual(len(self.sockets), 6)
        self.assertTrue(all(sock.closed for sock in self.sockets))
        self.sleep.assert_not_called()
        self.response(302, {'Location': 'http://cdn.example/feed.zip'})
        # HTTPS factory is substituted only for this no-network redirect test.
        with patch.object(pipeline.http.client, 'HTTPSConnection', pipeline.http.client.HTTPConnection), \
             self.assertRaisesRegex(pipeline.UnsafeSourceURL, 'downgrades'):
            pipeline.get('https://operator.example/feed.zip')
        self.assertEqual(len(self.sockets), 7)

    def test_304_errors_close_connections_and_non_public_attempts_are_structured(self):
        from urllib.error import HTTPError
        self.response(304, {'ETag': '"one"'}, b'')
        with self.assertRaises(HTTPError) as caught:
            pipeline.get('http://operator.example/feed.zip', {'If-None-Match': '"one"'})
        self.assertEqual(caught.exception.code, 304)
        caught.exception.close()
        self.assertTrue(self.sockets[0].closed)
        error = pipeline.UnsafeSourceURL('Non-public acquisition address')
        attempt = pipeline.source_attempt('http://127.0.0.1/feed.zip', error)
        self.assertEqual(attempt['code'], 'unsafe_source_url')
        self.assertEqual(pipeline.classify_failure(pipeline.SourceRetrievalError([attempt])),
                         ('source_retrieval_error', 'retrieval'))

    def test_eligible_literals_and_ipv6_dns_answers_do_not_require_second_resolution(self):
        for host, expected in [('93.184.216.34', ('93.184.216.34', 80)),
                               ('[2606:4700:4700::1111]', ('2606:4700:4700::1111', 80, 0, 0))]:
            self.response()
            with pipeline.get('http://' + host + '/feed.zip') as response:
                self.assertEqual(response.read(), b'feed')
            self.assertEqual(self.sockets[-1].address, expected)
        self.resolver.assert_not_called()
        answer = [(socket.AF_INET6, socket.SOCK_STREAM, socket.IPPROTO_TCP, '',
                   ('2606:4700:4700::1111', 80, 0, 0))]
        self.response()
        with patch.object(pipeline.socket, 'getaddrinfo', return_value=answer) as dns:
            with pipeline.get('http://ipv6.example/feed.zip') as response:
                self.assertEqual(response.read(), b'feed')
            dns.assert_called_once()
        self.assertEqual(self.sockets[-1].address, answer[0][-1])


if __name__=='__main__':unittest.main()
