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

    def run_compiler(self, output, report=True, local=True, extra=()):
        argv = ['global-service-frequency.py', '--cache', str(self.root/'cache'),
                '--output', str(output), '--date', '2026-10-05', *extra]
        if local:
            argv.extend(['--catalogue', str(self.catalogue)])
        if report:
            argv.extend(['--catalogue-report', str(self.report)])
        with patch.object(sys, 'argv', argv), patch('sys.stdout', new_callable=io.StringIO):
            pipeline.main()

    def test_report_to_shards_to_manifest_preserves_all_sources_and_accounting(self):
        self.assertEqual(self.data['schema'], 3)
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
            'transitous_ref': PIN, 'sources': sources, 'input_sha256': self.input_hashes})
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


if __name__ == '__main__':
    unittest.main()
