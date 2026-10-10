"""Synthetic generator -> compile shards -> published provenance; no acquisition."""
import copy
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('provenance_pipeline', ROOT/'scripts/global-service-frequency.py')
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)
PIN = '0123456789abcdef0123456789abcdef01234567'


class CatalogueProvenance(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.catalogue = self.root/'catalogue.json'
        self.report = self.root/'report.json'
        feeds = self.root/'feeds'
        feeds.mkdir()
        licences = self.root/'license.json'
        licences.write_text(json.dumps([{'filename': 'be_rail.gtfs.zip', 'country_code': 'BE',
            'source': 'https://provider.test/rail.zip?region=fixture-region'}]))
        (feeds/'be.json').write_text(json.dumps({'sources': [
            {'name': 'rail', 'url': 'https://provider.test/rail.zip?region=fixture-region'},
            {'name': 'guarded', 'url': 'https://user:fixture-password@provider.test/guarded.zip'}]}))
        mobility = self.root/'mobility.csv'
        mobility.write_text('id,data_type,provider,location.country_code,urls.direct_download\n'
                           'regional,gtfs,Rail,JP,https://provider.test/regional.zip\n')
        feed_hashes = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in feeds.glob('*.json')}
        self.input_hashes = {'transitous_feeds': hashlib.sha256(json.dumps(feed_hashes, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
                            'transitous_licences': hashlib.sha256(licences.read_bytes()).hexdigest(),
                            'mobility_csv': hashlib.sha256(mobility.read_bytes()).hexdigest(), 'transitland_feeds': None}
        with patch.object(sys, 'argv', ['frequency_catalogue.py', '--licences', str(licences),
                '--feeds-directory', str(feeds), '--transitous-ref', PIN,
                '--mobility-csv', str(mobility), '--output', str(self.catalogue), '--report', str(self.report)]), patch('sys.stdout', new_callable=io.StringIO):
            pipeline.registry.main()
        self.data = json.loads(self.report.read_text())
        self.hash = hashlib.sha256(self.catalogue.read_bytes()).hexdigest()

    def run_compiler(self, output, report=True, local=True, extra=(), index=True):
        argv = ['global-service-frequency.py', '--cache', str(self.root/'cache'),
                '--output', str(output), '--date', '2026-10-05', *extra]
        if local:
            argv.extend(['--catalogue', str(self.catalogue)])
        if report:
            argv.extend(['--catalogue-report', str(self.report)])
            if index: argv.extend(['--publication-index', str(self.root/'publication-index.json')])
        with patch.object(sys, 'argv', argv), patch('sys.stdout', new_callable=io.StringIO):
            pipeline.main()

    def test_report_to_shards_to_manifest_preserves_all_sources_and_accounting(self):
        self.assertEqual(self.data['schema'], 4)
        self.assertEqual(self.data['catalogue_sha256'], self.hash)
        self.assertEqual(self.data['input_sha256'], self.input_hashes)
        self.assertEqual(self.data['counts']['merged_entries'], 3)
        sources = pipeline.registry.catalogue_sources(PIN)
        self.assertEqual(self.data['sources'], sources)
        rows = json.loads(self.catalogue.read_text())
        rail = next(row for row in rows if row['filename'] == 'be_rail.gtfs.zip')
        self.assertEqual(rail['catalogue_url'], sources[0])
        self.assertEqual(rail['lineage'][0]['url'], sources[0])
        self.assertIn('/'+PIN+'/feeds/be.json', rail['lineage'][1]['url'])
        self.assertNotIn('fixture-password', self.catalogue.read_text())
        # Unrecognized report fields are not publication authority.
        self.data['private_extra'] = 'fixture-private-report-value'
        self.data['input_sha256']['private_extra'] = 'fixture-private-hash-value'
        self.report.write_text(json.dumps(self.data))
        output = self.root/'output'
        acquired = []
        def compiled_fixture(entry, cache, directory, date, *args):
            acquired.append(entry['id'])
            ident = entry['id']
            digest = hashlib.sha256(ident.encode()).hexdigest()
            feed = {'schema': 1, 'source': {'id': ident, 'sha256': digest, 'service_date': date,
                'checked': date, 'name': ident, 'feed_info': {}, 'valid_until': 1900000000},
                'agencies': [{'agency_id': 'a', 'agency_name': ident, 'agency_timezone': 'UTC'}],
                'routes': [{'route_id': 'r', 'route_type': '1'}],
                'profiles': {'h01': {'start': '01:00:00', 'end': '02:00:00'}},
                'segments': [{'route_id': 'r', 'agency_id': 'a', 'geometry': [[0, 0], [1, 1]],
                    'profiles': {'h01': {'display_tph': 2, 'forward_tph': 2,
                        'backward_tph': 2, 'quality': 'scheduled'}}}]}
            path = directory/'feeds'/(ident+'.json.gz')
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(gzip.compress(json.dumps(feed).encode()))
            return {**entry, 'status': 'compiled', 'sha256': digest, 'output': 'feeds/'+path.name}
        # Only archive acquisition/compilation is synthetic; report validation,
        # shard selection/checkpointing and assembly execute their real entrypoints.
        with patch.object(pipeline, 'compile_entry_isolated', side_effect=compiled_fixture), patch.object(pipeline, 'get', side_effect=AssertionError('No acquisition permitted')):
            for shard in range(2):
                self.run_compiler(output, extra=('--shards', '2', '--shard', str(shard)))
        self.assertEqual(sorted(acquired), ['be_rail', 'mdb_regional'])
        shards = [json.loads((output/f'inventory-{shard}.json').read_text()) for shard in range(2)]
        expected = pipeline.published_metadata({'schema': 2, 'kind': 'reconciled',
            'transitland_ref': None, 'transitland_state': 'unavailable', 'transitland_reason': 'not_supplied',
            'transitous_ref': PIN, 'sources': sources, 'input_sha256': self.input_hashes,
            'publication_context': {'state': 'verified', 'index_sha256': self.data['publication_index']['sha256']}})
        for shard in shards:
            self.assertIsNone(shard['catalogue_url'])
            self.assertEqual(shard['catalogue_sha256'], self.hash)
            self.assertEqual(shard['catalogue_provenance'], expected)
        result = subprocess.run([os.environ.get('ATLAS_TEST_NODE', 'node'),
            str(ROOT/'scripts/assemble-global-frequency.mjs'), str(output)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        manifest = json.loads((output/'manifest.json').read_text())
        inventory = json.loads((output/'inventory.json').read_text())
        for value in [manifest, inventory]:
            self.assertEqual(value['catalogue_provenance'], expected)
            self.assertEqual(value['catalogue_sha256'], self.hash)
            self.assertEqual(value['catalogue_entries'], 3)
            self.assertEqual(value['counts'], {'compiled': 2, 'retry_pending': 1})
            self.assertEqual(value['reason_codes'], {'source_access_review': 1})
            self.assertIsNone(value['catalogue_url'])
        published = '\n'.join(path.read_text() for path in output.glob('*.json'))+result.stdout+result.stderr
        for secret in ['fixture-password', 'fixture-region', 'fixture-private-report-value', 'fixture-private-hash-value']:
            self.assertNotIn(secret, published)

    def test_real_producer_reference_proof_requires_its_matching_artifact(self):
        (self.root/'feeds'/'be.json').write_text(json.dumps({'sources':[
            {'name':'rail','type':'transitland-atlas','transitland-atlas-id':'missing'}]}))
        with patch.object(sys,'argv',['frequency_catalogue.py','--licences',str(self.root/'license.json'),
            '--feeds-directory',str(self.root/'feeds'),'--transitous-ref',PIN,'--mobility-csv',str(self.root/'mobility.csv'),
            '--output',str(self.catalogue),'--report',str(self.report)]),patch('sys.stdout',new_callable=io.StringIO):
            pipeline.registry.main()
        row=next(r for r in json.loads(self.catalogue.read_text()) if r['filename']=='be_rail.gtfs.zip')
        index=json.loads((self.root/'publication-index.json').read_text())
        self.assertEqual(row['source_resolution']['publication_evidence'],{'input_sha256':index['input_sha256'],**index['records'][0]})
        raw_input=(self.root/'license.json').read_bytes()
        self.assertEqual(index['input_sha256'],hashlib.sha256(raw_input).hexdigest())
        self.assertNotIn('fixture-region',(self.root/'publication-index.json').read_text())
        for supplied in [False,True]:
            output=self.root/('with-index' if supplied else 'without-index')
            self.run_compiler(output,extra=('--inventory-only',),index=supplied)
            inventory=json.loads((output/'inventory-0.json').read_text())
            entry=next(e for e in inventory['entries'] if e['id']=='be_rail')
            self.assertEqual(entry['status'],'pending' if supplied else 'retry_pending')
            self.assertEqual(inventory['catalogue_provenance']['publication_context']['state'],'verified' if supplied else 'not_supplied')
        (self.root/'publication-index.json').write_text('{}')
        self.run_compiler(self.root/'wrong-index',extra=('--inventory-only',))
        inventory=json.loads((self.root/'wrong-index'/'inventory-0.json').read_text())
        self.assertEqual(next(e for e in inventory['entries'] if e['id']=='be_rail')['reason_code'],'unresolved_source_reference')
        self.assertEqual(inventory['catalogue_provenance']['publication_context']['state'],'index_hash_mismatch')


    def test_invalid_or_mismatched_reports_fail_before_compilation(self):
        cases = []
        def changed(field, value):
            row = copy.deepcopy(self.data)
            row[field] = value
            return row
        cases.extend([changed('schema', 1), changed('catalogue_sha256', '0'*64),
                      changed('counts', {'merged_entries': 999}), changed('transitous_ref', 'main'),
                      changed('sources', self.data['sources'][:2]), changed('input_sha256', {})])
        for name in ['transitous_licences', 'transitous_feeds', 'mobility_csv']:
            row = copy.deepcopy(self.data)
            row['input_sha256'][name] = 'invalid'
            cases.append(row)
        for i, report in enumerate(cases):
            with self.subTest(case=i):
                self.report.write_text(json.dumps(report))
                output = self.root/f'invalid-{i}'
                with patch.object(pipeline, 'compile_entry_isolated') as compile_one:
                    with self.assertRaises(ValueError):
                        self.run_compiler(output)
                    compile_one.assert_not_called()
                self.assertFalse(output.exists())
        self.report.unlink()
        with self.assertRaises(FileNotFoundError), patch.object(pipeline, 'compile_entry_isolated') as compile_one:
            self.run_compiler(self.root/'missing')
        compile_one.assert_not_called()

    def test_old_schema_two_reports_remain_readable_without_reference_claims(self):
        report = copy.deepcopy(self.data); report['schema'] = 2
        for key in ['transitland_ref', 'transitland_state', 'transitland_reason']: report.pop(key)
        report['input_sha256'].pop('transitland_feeds')
        self.report.write_text(json.dumps(report))
        self.run_compiler(self.root/'old', extra=('--inventory-only',))
        inventory = json.loads((self.root/'old'/'inventory-0.json').read_text())
        self.assertEqual(inventory['catalogue_provenance']['schema'], 1)
        self.assertNotIn('transitland_ref', inventory['catalogue_provenance'])

    def test_reference_report_binds_availability_pin_and_exact_input_digest(self):
        cases = [('transitland_state', 'unknown'), ('transitland_reason', 'fixture-private-report-value'),
                 ('transitland_state', 'available'), ('transitland_ref', 'main')]
        for key, value in cases:
            with self.subTest(key=key, value=value):
                report = copy.deepcopy(self.data); report[key] = value
                self.report.write_text(json.dumps(report))
                with self.assertRaises(ValueError): self.run_compiler(self.root/'invalid-reference', extra=('--inventory-only',))
        report = copy.deepcopy(self.data); report['transitland_ref'] = 'b'*40; report['transitland_state'] = 'available'; report['transitland_reason'] = ''
        report['sources'].append(pipeline.registry.references.pinned_url('b'*40))
        report['input_sha256']['transitland_feeds'] = 'c'*64
        self.report.write_text(json.dumps(report))
        self.run_compiler(self.root/'pinned', extra=('--inventory-only',))
        evidence = json.loads((self.root/'pinned'/'inventory-0.json').read_text())['catalogue_provenance']
        self.assertEqual(evidence['schema'], 2); self.assertEqual(evidence['transitland_ref'], 'b'*40)
        self.assertEqual(evidence['input_sha256']['transitland_feeds'], 'c'*64)

    def test_local_without_report_has_no_invented_transitous_origin(self):
        output = self.root/'local'
        with patch.object(pipeline, 'get', side_effect=AssertionError('No acquisition permitted')):
            self.run_compiler(output, report=False, extra=('--inventory-only',))
        inventory = json.loads((output/'inventory-0.json').read_text())
        self.assertIsNone(inventory['catalogue_url'])
        self.assertEqual(inventory['catalogue_provenance'], {'schema': 1, 'kind': 'local-unverified', 'sources': []})
        self.assertEqual(inventory['catalogue_sha256'], self.hash)
        self.assertEqual(inventory['catalogue_entries'], 3)

    def test_default_single_source_compatibility_identifies_only_actual_url(self):
        output = self.root/'default'
        with patch.object(pipeline, 'get', return_value=io.BytesIO(b'[]')) as get:
            self.run_compiler(output, report=False, local=False, extra=('--inventory-only',))
        get.assert_called_once_with(pipeline.CATALOGUE)
        inventory = json.loads((output/'inventory-0.json').read_text())
        self.assertEqual(inventory['catalogue_url'], pipeline.CATALOGUE)
        self.assertEqual(inventory['catalogue_provenance'], pipeline.published_metadata(
            {'schema': 1, 'kind': 'transitous-licences', 'sources': [pipeline.CATALOGUE]}))
        self.assertEqual(inventory['catalogue_sha256'], hashlib.sha256(b'[]').hexdigest())
        self.assertEqual(inventory['catalogue_entries'], 0)

    def test_report_requires_local_catalogue_before_any_acquisition(self):
        with patch.object(pipeline, 'get') as get, patch('sys.stderr', new_callable=io.StringIO):
            with self.assertRaises(SystemExit):
                self.run_compiler(self.root/'invalid', local=False, extra=('--inventory-only',))
        get.assert_not_called()


class PublicationMembership(unittest.TestCase):
    def fixture(self, source='', active=False):
        pub = pipeline.registry.publication
        raw = pub.encoded([{'filename':'xx_proven.gtfs.zip','source':source}])
        index = pub.build_index(raw, pipeline.registry.catalogue_sources(PIN)[0])
        context = pub.Context(index)
        row = {'filename':'xx_proven.gtfs.zip','delivery':'transitous','source':source,
            'catalogue_url':index['source_url'],
            'lineage':[{'catalogue':'transitous-licence','id':'xx_proven.gtfs.zip','url':index['source_url'],'source':source}],
            'source_resolution':{'schema':1,'state':'schedule','specs':['gtfs'],'declarations':[],
                'processed_filename':'xx_proven.gtfs.zip','publication_evidence':context.evidence('xx_proven.gtfs.zip')}}
        if active:
            row['source_resolution']['ordinary_static_declarations']=[{'type':'http','spec':'gtfs','url':source,
                'url_sha256':pub.sha(source.encode()),'access_state':'public_declared','upstream_skip':False,
                'definition':{'url':'https://github.test/feeds/xx.json','pointer':'/sources/0','sha256':'a'*64}}]
        return row, context, index

    def candidates(self, row, context=None):
        entry = pipeline.discover([row], {}, context)[0]
        return pipeline.source_candidates(entry, context)

    def test_membership_requires_separate_context_and_exact_record(self):
        row, context, _ = self.fixture()
        processed = pipeline.PROCESSED+row['filename']
        self.assertEqual(self.candidates(row, context), [processed])
        self.assertEqual(self.candidates(row), [])
        for key in ['input_sha256','record_sha256','source_sha256','pointer','filename']:
            bad=copy.deepcopy(row);bad['source_resolution']['publication_evidence'][key]='0'*64 if key.endswith('sha256') else '/99' if key=='pointer' else 'invented.gtfs.zip'
            self.assertEqual(self.candidates(bad, context), [])
        fake=copy.deepcopy(row);fake['filename']='invented.gtfs.zip';fake['lineage'][0]['id']=fake['filename']
        fake['source_resolution']['processed_filename']=fake['filename'];fake['source_resolution']['publication_evidence']['filename']=fake['filename']
        self.assertEqual(self.candidates(fake, context), [])
        # Audit state cannot serialize the runtime authority.
        for flag in ['verified','publication_verified']:
            fake=copy.deepcopy(row);fake[flag]=True
            self.assertEqual(self.candidates(fake), [])
        reloaded=pipeline.published_metadata(row)
        self.assertEqual(self.candidates(reloaded), [])
        self.assertEqual(self.candidates(reloaded, context), [processed])

    def test_public_ordinary_fallback_and_redacted_original_boundary(self):
        raw='https://provider.test/feed?region=public-fixture'
        row, context, _=self.fixture(raw, active=True)
        self.assertEqual(self.candidates(row), [pipeline.PROCESSED+row['filename'],raw])
        published=pipeline.published_metadata(row)
        # Matching original-source digest establishes membership, never a raw
        # request to the one-way redacted display URL.
        self.assertEqual(self.candidates(published, context), [pipeline.PROCESSED+row['filename']])
        self.assertEqual(self.candidates(published), [])
        public, _, _=self.fixture('https://provider.test/public',active=True)
        self.assertEqual(self.candidates(public), [pipeline.PROCESSED+public['filename'],public['source']])

    def test_resource_holds_cover_all_candidates_and_keep_distinct_public_sources(self):
        held='https://EXAMPLE.test:443/feed#held-fixture'
        for public, equivalent in [('https://example.test/feed#public',True),('https://example.test./feed',True),
                ('https://EXAMPLE.TEST:443/feed',True),('https://example.test/other',False),
                ('http://example.test/feed',False),('https://example.test/feed?q=1',False)]:
            with self.subTest(public=public):
                row, context, _=self.fixture(public,active=True)
                ordinary=row['source_resolution']['ordinary_static_declarations']
                private=copy.deepcopy(ordinary[0]);private.update(url=held,url_sha256=hashlib.sha256(held.encode()).hexdigest(),access_state='authorization_required')
                ordinary.append(private)
                processed=pipeline.PROCESSED+row['filename']
                self.assertEqual(self.candidates(row, context), [processed] if equivalent else [processed,public])
                self.assertEqual(self.candidates(row), [] if equivalent else [processed,public])
        row, context, _=self.fixture('',active=False)
        processed=pipeline.PROCESSED+row['filename']
        row['source_resolution']['ordinary_static_declarations']=[{'type':'http','spec':'gtfs','url':processed+'#hold',
            'url_sha256':hashlib.sha256((processed+'#hold').encode()).hexdigest(),'access_state':'authorization_required','upstream_skip':True,
            'definition':{'url':'https://github.test/xx.json','pointer':'/sources/0','sha256':'a'*64}}]
        self.assertEqual(self.candidates(row, context), [],'even the processed request is subject to the canonical hold')
        # Preserve exact query values/order/path and credential-authority distinctions.
        key=pipeline.registry.references.resource_key
        for a,b in [('https://x.test/f?a=1','https://x.test/f?a=2'),('https://x.test/f?a=1&b=2','https://x.test/f?b=2&a=1'),
                    ('https://x.test/f','https://x.test/f/'),('http://x.test/f','https://x.test/f')]:
            self.assertNotEqual(key(a),key(b))
        self.assertIsNone(key('https://fixture-user:fixture-pass@x.test/f'))

    def test_redacted_hold_retains_uncertainty_without_equating_raw_queries(self):
        pub=pipeline.registry.publication
        held='https://EXAMPLE.test:443/feed?region=one#held'
        public='https://example.test/feed?region=one#public'
        row,context,_=self.fixture(public,active=True)
        private=copy.deepcopy(row['source_resolution']['ordinary_static_declarations'][0])
        private.update(url=held,url_sha256=pub.sha(held.encode()),access_state='authorization_required')
        row['source_resolution']['ordinary_static_declarations'].append(private)
        processed=pipeline.PROCESSED+row['filename']
        self.assertEqual(self.candidates(row,context),[processed])
        distinct=copy.deepcopy(row);source='https://example.test/feed?region=two'
        distinct['source']=source;distinct['lineage'][0]['source']=source
        distinct['source_resolution']['ordinary_static_declarations'][0].update(url=source,url_sha256=pub.sha(source.encode()))
        self.assertEqual(self.candidates(distinct),[processed,source])
        private.update(url=pipeline.registry.references.reference_display_url(held))
        self.assertEqual(self.candidates(row,context),[processed])
        self.assertEqual(self.candidates(row),[])
        entry=pipeline.discover([row],{})[0]
        self.assertEqual(entry['reason_code'],'unresolved_source_reference')
        self.assertIn('Original identity of a redacted access-held source is unavailable',entry['reason'])
        distinct['source_resolution']['ordinary_static_declarations'][1]=copy.deepcopy(private)
        self.assertEqual(self.candidates(distinct),[],'unknown hidden held value is not independent public proof')
        other=copy.deepcopy(distinct);source='https://example.test/other?region=two'
        other['source']=source;other['source_resolution']['ordinary_static_declarations'][0].update(url=source,url_sha256=pub.sha(source.encode()))
        self.assertEqual(self.candidates(other),[processed,source])

    def test_index_is_bounded_unique_and_bound_to_report(self):
        pub=pipeline.registry.publication;row,context,index=self.fixture('https://provider.test/feed')
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'index.json';data=pub.encoded(index)+b'\n';path.write_bytes(data)
            report={'schema':4,'transitous_ref':PIN,'input_sha256':{'transitous_licences':index['input_sha256']},
                'publication_index':{'sha256':pub.sha(data),'records':1}}
            self.assertEqual(pub.read_context(path,report)[1],'verified')
            self.assertIsNone(pub.read_context(None,report)[0])
            for key,value in [('schema',3),('transitous_ref','f'*40),('input_sha256',{'transitous_licences':'f'*64}),
                              ('publication_index',{'sha256':pub.sha(data),'records':2})]:
                bad=copy.deepcopy(report);bad[key]=value;self.assertIsNone(pub.read_context(path,bad)[0])
            for changed in [dict(index,records=index['records']*2),dict(index,source_url=index['source_url']+'?wrong=1')]:
                altered=pub.encoded(changed);path.write_bytes(altered);bad=copy.deepcopy(report);bad['publication_index']['sha256']=pub.sha(altered)
                self.assertIsNone(pub.read_context(path,bad)[0])
            path.write_bytes(data+b' ');self.assertIsNone(pub.read_context(path,report)[0])
            path.unlink();self.assertIsNone(pub.read_context(path,report)[0])
        for records in [[{'filename':'../escape.gtfs.zip'}],[{'filename':'same.gtfs.zip'}]*2]:
            with self.assertRaises(ValueError):pub.build_index(pub.encoded(records),index['source_url'])
        with self.assertRaises(ValueError):pub.build_index(b' '* (pub.MAX_INPUT_BYTES+1),index['source_url'])
        for data in [b'{"schema":1,"schema":1}', b'{"value":NaN}']:
            with self.assertRaises(ValueError):pub.parsed(data)

    def test_worker_handoff_is_separate_minimal_and_checked_before_cache(self):
        row,context,index=self.fixture()
        entry=pipeline.discover([row],{},context)[0]
        pub=pipeline.registry.publication
        worker=pub.from_worker(context.worker_record(row))
        self.assertEqual(len(worker.records),1)
        self.assertEqual(pipeline.source_candidates(entry,worker),[pipeline.PROCESSED+row['filename']])
        self.assertEqual(pipeline.source_candidates(entry),[])
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            with patch.object(pipeline,'fetch_alternative',side_effect=AssertionError('No acquisition')),patch.object(pipeline,'cached_source_url',side_effect=AssertionError('No cache inspection')):
                with self.assertRaisesRegex(ValueError,'not acquisition eligible'):
                    pipeline.compile_entry(entry,root,root,'2026-10-05',None,1000,{})
            def fake_process(command,**kwargs):
                payload=json.loads(Path(command[-2]).read_text())
                self.assertEqual(payload['publication_context'],context.worker_record(row))
                self.assertNotIn('publication_context',payload['entry']['catalogue'])
                Path(command[-1]).write_text(json.dumps({'entry':entry}))
                return type('Result',(),{'returncode':0,'stderr':''})()
            with patch.object(pipeline.subprocess,'run',side_effect=fake_process):
                pipeline.compile_entry_isolated(entry,root,root,'2026-10-05',None,1000,{},publication_context=context)
            payload={'entry':entry,'cache':str(root),'output':str(root),'date':'2026-10-05','graph':None,'max_bytes':1000,
                'profiles':{},'max_seconds':10,'max_memory_bytes':10**9,'publication_context':context.worker_record(row)}
            request=root/'request';response=root/'response';request.write_text(json.dumps(payload))
            def compiled(**kwargs):
                self.assertTrue(kwargs['publication_context'].matches(row,row['lineage'][0]));return entry
            with patch('resource.setrlimit'),patch.object(pipeline,'compile_entry',side_effect=compiled):
                pipeline.compile_one(request,response)
            self.assertNotIn('records',json.loads(response.read_text())['entry'])


if __name__ == '__main__':
    unittest.main()
