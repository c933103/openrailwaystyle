"""Source catalogue tests: no public feed download or API credentials needed."""
import csv
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


spec=importlib.util.spec_from_file_location('frequency_catalogue',
    Path(__file__).parent.parent/'scripts/frequency_catalogue.py')
catalogue=importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalogue)


class FrequencyCatalogue(unittest.TestCase):
    def test_staging_pauses_signed_schedule_sources_but_retains_ordinary_queries(self):
        signed='https://fixture.blob.core.windows.net/feed.zip?sv=fixture-version&se=fixture-expiry&sp=rl&sr=c&sig=fixture-signature'
        ordinary='https://operator.test/feed.zip?token=public-selector&rid=ordinary-feed'
        ancillary='https://api.511.org/transit/datafeeds?api_key=fixture-issued-key&operator_id=fixture-operator'
        inputs=[{'filename':'signed.gtfs.zip','source':signed,'country_code':'NZ'},
                {'filename':'ordinary.gtfs.zip','source':ordinary,'country_code':'US','rt':[{'source':ancillary}]}]
        rows,counts=catalogue.build_catalogue(inputs,[],[])
        by_name={row['filename']:row for row in rows}
        self.assertEqual(counts['merged_entries'],2)
        self.assertEqual(counts['pending_access_review'],1)
        self.assertEqual(by_name['ordinary.gtfs.zip']['source'],ordinary)
        self.assertNotIn('access_review',by_name['ordinary.gtfs.zip'],'ancillary access metadata does not disable unrelated timetable acquisition')
        evidence=json.dumps(rows)
        for value in ['fixture-signature','fixture-issued-key','fixture-expiry','fixture-version','fixture-operator']:
            self.assertNotIn(value,evidence)
        signed_row=by_name['signed.gtfs.zip']
        self.assertEqual(signed_row['access_review'][0]['reason'],'signed_storage_access')
        self.assertEqual(signed_row['source_sha256'],__import__('hashlib').sha256(signed.encode()).hexdigest())
        self.assertEqual(catalogue.prepare_catalogue_row(signed_row),signed_row,'repeat boundary retains exact identities')
        self.assertEqual(catalogue.prepare_catalogue_row(by_name['ordinary.gtfs.zip']),by_name['ordinary.gtfs.zip'])
        self.assertEqual(inputs[0]['source'],signed,'operational reconciliation input is not mutated')

    def test_access_review_recognizes_only_explicit_grant_structures(self):
        for url in ['https://operator.test/feed?token=value&key=value&apiKey=value',
                    'https://fixture.blob.core.windows.net/feed?sv=version&region=selector',
                    'https://operator.test/feed?sig=value&sv=value&se=value&sp=value&sr=value']:
            self.assertIsNone(catalogue.access_review_url(url))
        self.assertEqual(catalogue.access_review_url('https://fixture-user:fixture-password@operator.test/feed')['reason'],'embedded_url_credentials')

    def test_access_review_boundary_rejects_forged_identity_and_malformed_audit_metadata(self):
        source='https://fixture-user:fixture-password@operator.test/feed'
        for existing in ['invalid',[None],[{}],[{'url_sha256':'a'*64,'raw':'https://api.511.org/feed?api_key=fixture-secret'}]]:
            with self.subTest(existing_type=type(existing).__name__):
                row={'source':source,'source_sha256':'a'*64,'access_review':existing,'lineage':None}
                result=catalogue.prepare_catalogue_row(row)
                self.assertEqual(len(result['access_review']),1)
                self.assertEqual(result['source_sha256'],__import__('hashlib').sha256(source.encode()).hexdigest())
                self.assertEqual(catalogue.prepare_catalogue_row(result),result)
                for marker in ['fixture-user','fixture-password','fixture-secret']:
                    self.assertNotIn(marker,json.dumps(result))
        result=catalogue.prepare_catalogue_row({'source':source,'source_sha256':{},'lineage':3})
        self.assertEqual(len(result['access_review']),1)

    def test_long_signed_query_and_invalid_port_do_not_fail_open(self):
        long_name='fixture-sensitive-name-'+'x'*100
        query='sv=fixture-version&se=fixture-expiry&sp=rl&sr=c&sig=fixture-signature&'+long_name+'=value&'+'&'.join('p'+str(i)+'=value' for i in range(130))
        for authority in ['fixture.blob.core.windows.net','fixture.blob.core.windows.net:invalid']:
            source='https://'+authority+'/feed?'+query
            result=catalogue.prepare_catalogue_row({'source':source})
            self.assertEqual(len(result['access_review']),1)
            self.assertNotIn(long_name,json.dumps(result))
            self.assertNotIn('fixture-signature',json.dumps(result))
            self.assertEqual(catalogue.prepare_catalogue_row(result),result)

    def test_retained_access_reviews_are_source_bound_and_canonical(self):
        source='https://fixture-user:fixture-password@operator.test/feed?Mode=fixture-mode'
        prepared=catalogue.prepare_catalogue_row({'source':source})
        self.assertEqual(prepared['access_review'][0]['parameter_names'],['mode'])
        self.assertEqual(catalogue.prepare_catalogue_row(prepared),prepared)
        ordinary={'source':'https://operator.test/ordinary?rid=public-selector','access_review':prepared['access_review']}
        self.assertNotIn('access_review',catalogue.prepare_catalogue_row(ordinary),'unrelated audit does not pause an ordinary source')
        long_name='fixture-sensitive-name-'+'x'*100
        display='https://api.511.org/feed?api_key=%5Bredacted%5D&'+long_name+'=%5Bredacted%5D'
        existing={'source':display,'source_sha256':'a'*64,'access_review':[{
            'url':display,'url_sha256':'a'*64,'reason':'documented_api_access_key'}]}
        sanitized=catalogue.prepare_catalogue_row(existing)
        self.assertNotIn(long_name,json.dumps(sanitized))
        self.assertEqual(sanitized['source_sha256'],'a'*64)
        self.assertEqual(len(sanitized['access_review']),1)
        self.assertEqual(catalogue.prepare_catalogue_row(sanitized),sanitized)

    def test_source_lists_recover_missing_rail_feeds(self):
        older=[{'filename':'jp_tokyo-rail.gtfs.zip','country_code':'JP',
                'human_name':'Tokyo rail','source':'https://mkuran.pl/gtfs/tokyo/rail.zip',
                'spdx_license_identifier':'MIT'}]
        sources=[
            ('jp',{'name':'tokyo-rail','type':'http',
                   'url':'https://mkuran.pl/gtfs/tokyo/rail.zip',
                   'license':{'spdx-identifier':'MIT'}},'https://github.test/transitous/jp.json'),
            ('jp',{'name':'japan-rail','type':'http',
                   'url':'https://jbb.ghsq.de/gtfs/jp-jr.gtfs.zip'},
                    'https://github.test/transitous/jp.json'),
            ('jp',{'name':'live-alerts','type':'url','spec':'gtfs-rt','url':'https://operator.test/live'},
                    'https://github.test/transitous/jp.json')
        ]
        results,counts=catalogue.build_catalogue(older,sources,[])
        self.assertEqual([r['filename'] for r in results],
                         ['jp_japan-rail.gtfs.zip','jp_tokyo-rail.gtfs.zip'])
        self.assertEqual(counts['legacy_transitous_candidate_sources'],2)
        self.assertEqual(counts['non_schedule'],1)
        jr=results[0]
        self.assertEqual(jr['delivery'],'transitous')
        self.assertEqual(jr['source'],'https://jbb.ghsq.de/gtfs/jp-jr.gtfs.zip')
        self.assertEqual(jr['rights_evidence'],[])
        self.assertEqual(jr['lineage'][0]['url'],'https://github.test/transitous/jp.json')
        self.assertEqual(len(results[1]['lineage']),2)

    def test_mobility_crosswalk_url_overlap_and_extra_source(self):
        sources=[
            ('jp',{'name':'local-bus','type':'mobility-database','mdb-id':'jbda-123'},
             'https://github.test/transitous/jp.json'),
            ('be',{'name':'sncb','type':'http','url':'https://provider.test/rail.zip'},
             'https://github.test/transitous/be.json')]
        mobility=[
            {'data_type':'gtfs','id':'jbda-123','provider':'Town Bus',
             'location.country_code':'JP','urls.direct_download':'https://api.gtfs-data.jp/x.zip',
             'urls.license':'https://gtfs-data.jp/terms','status':'active'},
            {'data_type':'gtfs','id':'mdb-2','provider':'Belgian Rail',
             'location.country_code':'BE','urls.direct_download':'https://provider.test/rail.zip',
             'urls.license':'https://provider.test/terms'},
            {'data_type':'gtfs','id':'mdb-3','provider':'Regional Tram',
             'location.country_code':'DE','urls.direct_download':'https://operator.test/tram.zip',
             'urls.license':'https://operator.test/license'},
            {'data_type':'gtfs-rt','id':'real-time','provider':'Not GTFS schedule',
             'urls.direct_download':'https://operator.test/realtime.pb'}]
        results,cnt=catalogue.build_catalogue([],sources,mobility)
        self.assertEqual(len(results),3)
        self.assertEqual(cnt['overlap_mdb_id'],1)
        self.assertEqual(cnt['overlap_source_url'],1)
        self.assertEqual(cnt['mobility_gtfs'],3)
        bus=next(r for r in results if r['filename']=='jp_local-bus.gtfs.zip')
        self.assertEqual(bus['delivery'],'transitous')
        self.assertEqual(bus['source'],'https://api.gtfs-data.jp/x.zip')
        self.assertEqual(len(bus['lineage']),2)
        self.assertEqual(bus['rights_evidence'][0]['terms_url'],'https://gtfs-data.jp/terms')
        sncb=next(r for r in results if r['filename']=='be_sncb.gtfs.zip')
        self.assertEqual(len(sncb['lineage']),2)
        extra=next(r for r in results if r['filename']=='mdb_mdb-3.gtfs.zip')
        self.assertEqual(extra['delivery'],'direct')
        self.assertEqual(extra['country_code'],'DE')

    def test_denial_attributes_and_url_only_terms(self):
        rows=[
            {'filename':'first.gtfs.zip','rights_evidence':[{
                'origin':'operator','reference':'https://example.test/terms',
                'spdx':'CC-BY-ND-4.0','terms_url':'https://example.test/terms',
                'restrictions':{}}]},
            {'filename':'second.gtfs.zip','rights_evidence':[{
                'origin':'operator','reference':'https://example.test/terms',
                'spdx':'','terms_url':'https://example.test/terms',
                'restrictions':{'redistribution_allowed':'no','create_derived_product':'yes'}}]},
            {'filename':'third.gtfs.zip','rights_evidence':[{
                'origin':'operator','reference':'https://example.test/terms',
                'spdx':'','terms_url':'https://example.test/terms',
                'restrictions':{'create_derived_product':'no'}}]}
        ]
        self.assertEqual(catalogue.usage_rights(rows[0])['prohibitions'],[],
                         'ND does not automatically forbid factual timetable analysis')
        self.assertEqual(catalogue.usage_rights(rows[1])['prohibitions'],[],
                         'no raw redistribution need not prohibit an attributed summary')
        self.assertEqual(catalogue.usage_rights(rows[2])['prohibitions'],[],
                         'a generic ban on republishing derived datasets is not a ban on use')
        reviewed={'rights_evidence':[{'origin':'source-specific-reviewed-rule',
                 'terms_url':'https://example.test/explicit-operator-rule',
                 'restrictions':{'prohibit_frequency_use':True}}]}
        self.assertEqual(len(catalogue.usage_rights(reviewed)['prohibitions']),1)
        unreviewed={'rights_evidence':[{'origin':'mobility-database',
                 'terms_url':'https://example.test/terms',
                 'restrictions':{'prohibit_frequency_use':True}}]}
        self.assertEqual(catalogue.usage_rights(unreviewed)['prohibitions'],[],
                         'unverified catalogue flags cannot exclude feeds')
        self.assertEqual(catalogue.usage_rights({'license_url':'https://example.test/terms'})['state'],'linked')
        self.assertEqual(catalogue.usage_rights({})['state'],'not_provided')

    def test_cli_fixture_reads_all_sources_with_pinned_provenance(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d); (path/'feeds').mkdir()
            (path/'license.json').write_text('[]')
            (path/'feeds'/'jp.json').write_text(json.dumps({'maintainers':[],
                'sources':[{'name':'japan-rail','type':'http','url':'https://provider.test/rail.zip'}]}))
            (path/'mobility.csv').write_text('id,data_type,provider,location.country_code,urls.direct_download,urls.license\n'
                'regional-001,gtfs,Rail,BE,https://provider.test/be.zip,https://provider.test/terms\n')
            from unittest.mock import patch
            import sys
            with patch.object(sys,'argv',['frequency_catalogue.py',
                '--licences',str(path/'license.json'),'--feeds-directory',str(path/'feeds'),
                '--mobility-csv',str(path/'mobility.csv'),'--transitous-ref','0123456789abcdef0123456789abcdef01234567',
                '--output',str(path/'combined.json'),'--report',str(path/'report.json')]):
                catalogue.main()
            got=json.loads((path/'combined.json').read_text())
            report=json.loads((path/'report.json').read_text())
            self.assertEqual(len(got),2)
            self.assertEqual(report['counts']['merged_entries'],2)
            self.assertIn('0123456789abcdef0123456789abcdef01234567',got[0]['lineage'][0]['url'])
            self.assertEqual(got[1]['delivery'],'direct')




class ReferenceResolution(unittest.TestCase):
    PIN = 'a' * 40

    def index(self, feeds):
        return {'ref': self.PIN, 'state': 'available', 'reason': '', 'sha256': 'b' * 64,
            'files': {}, 'by_id': {f['id']: [{'feed': f, 'url': 'https://github.test/' + self.PIN + '/feeds/example.json',
                'pointer': '/feeds/' + str(i), 'blob_sha': 'c' * 40}] for i, f in enumerate(feeds)}}

    def reference(self, name, ident, **extra):
        return ('xx', {'name': name, 'type': 'transitland-atlas', 'transitland-atlas-id': ident, **extra},
                'https://github.test/' + self.PIN + '/feeds/xx.json')

    def build(self, definitions, feeds, licences=(), mobility=()):
        context = catalogue.publication.Context(catalogue.publication.build_index(catalogue.publication.encoded(list(licences)), catalogue.catalogue_sources(self.PIN)[0]))
        return catalogue.build_catalogue(list(licences), definitions, list(mobility), self.PIN, self.index(feeds), publication_context=context)[0]

    def test_burlington_and_milwaukee_static_rt_groups_keep_all_declarations(self):
        for name in ['Burlington-Transit', 'milwaukee']:
            with self.subTest(name=name):
                rows = self.build([self.reference(name, 'static', skip=True), self.reference(name, 'rt', skip=True)], [
                    {'id': 'static', 'spec': 'gtfs', 'urls': {'static_current': 'https://operator.test/rail.zip'}},
                    {'id': 'rt', 'spec': 'gtfs-rt', 'urls': {'realtime_trip_updates': 'https://operator.test/rt'}}])
                self.assertEqual(len(rows), 1)
                row = rows[0]; v = row['source_resolution']
                self.assertEqual(row['filename'], 'xx_' + name + '.gtfs.zip')
                self.assertEqual(row['source'], 'https://operator.test/rail.zip')
                self.assertEqual(v['state'], 'schedule'); self.assertIsNone(v['processed_filename'])
                self.assertEqual([d['reference_id'] for d in v['declarations']], ['static', 'rt'])
                self.assertEqual(v['specs'], ['gtfs', 'gtfs-rt'])
                self.assertEqual(v['identity_state'], 'static_with_companions')
                self.assertEqual([x['source'] for x in row['lineage'] if x.get('source')], ['https://operator.test/rail.zip'])

    def test_transit_rt_authorization_is_held_separately_from_static(self):
        rows = self.build([self.reference('TransIt', 'static', skip=True), self.reference('TransIt', 'rt', skip=True)], [
            {'id': 'static', 'spec': 'gtfs', 'urls': {'static_current': 'https://operator.test/rail.zip'}},
            {'id': 'rt', 'spec': 'gtfs-rt', 'authorization': {'type': 'header', 'param_name': 'Authorization', 'secret': 'fixture-do-not-copy'},
             'urls': {'realtime_trip_updates': 'https://operator.test/rt'}}])
        row = rows[0]; self.assertEqual(row['source_resolution']['state'], 'schedule')
        self.assertEqual(row['source_resolution']['declarations'][1]['resolution']['state'], 'authorization_required')
        self.assertNotIn('fixture-do-not-copy', json.dumps(rows)); self.assertNotIn('access_review', row)
        self.assertEqual(row['source'], 'https://operator.test/rail.zip')

    def test_slobozia_two_distinct_gbfs_references_are_not_silently_merged(self):
        rows = self.build([self.reference('Slobozia-Bike-City', x) for x in ['buzau', 'slobozia']], [
            {'id': x, 'spec': 'gbfs', 'urls': {'gbfs_auto_discovery': 'https://operator.test/' + x}} for x in ['buzau', 'slobozia']])
        v = rows[0]['source_resolution']; self.assertEqual(v['state'], 'non_timetable_format')
        self.assertEqual(v['identity_state'], 'multiple_declarations'); self.assertEqual(len(v['declarations']), 2)
        self.assertIsNone(v['processed_filename']); self.assertFalse(rows[0]['source'])

    def test_gbfs_name_hint_never_disables_verified_static_rail(self):
        row = self.build([self.reference('rail-gbfs', 'static')], [
            {'id': 'static', 'spec': 'gtfs', 'urls': {'static_current': 'https://operator.test/rail.zip'}}])[0]
        self.assertEqual(row['source_resolution']['state'], 'schedule')
        self.assertEqual(row['source_resolution']['processed_filename'], row['filename'])

    def test_unknown_companion_is_not_a_non_timetable_only_result(self):
        row = self.build([self.reference('mixed', 'known'), self.reference('mixed', 'unknown')], [
            {'id': 'known', 'spec': 'gbfs', 'urls': {'gbfs_auto_discovery': 'https://operator.test/gbfs'}}])[0]
        self.assertEqual(row['source_resolution']['state'], 'unresolved')
        self.assertEqual(row['source_resolution']['declarations'][1]['resolution']['state'], 'missing_reference')

    def test_multiple_static_sources_are_ambiguous_and_order_independent(self):
        definitions = [self.reference('same', x) for x in ['one', 'two']]
        feeds = [{'id': x, 'spec': 'gtfs', 'urls': {'static_current': 'https://operator.test/' + x}} for x in ['one', 'two']]
        values = []
        for order in [definitions, list(reversed(definitions))]:
            row = self.build(order, feeds)[0]
            self.assertEqual(row['source_resolution']['state'], 'ambiguous')
            self.assertFalse(row['source']); self.assertIsNone(row['source_resolution']['processed_filename'])
            values.append(sorted(d['id'] for d in row['source_resolution']['declarations']))
        self.assertEqual(*values)

    def test_duplicate_identity_options_conflict_but_identical_occurrences_survive(self):
        feed = {'id': 'one', 'spec': 'gtfs', 'urls': {'static_current': 'https://operator.test/feed'}}
        first = self.reference('same', 'one')
        row = self.build([first, first], [feed])[0]
        self.assertEqual(row['source_resolution']['state'], 'schedule')
        self.assertEqual(len(row['source_resolution']['declarations']), 2)
        row = self.build([first, self.reference('same', 'one', skip=True)], [feed])[0]
        self.assertEqual(row['source_resolution']['state'], 'ambiguous')

    def test_legacy_rt_label_precedence_is_narrow_and_explicit(self):
        for roles in [{'realtime_trip_updates': 'https://operator.test/rt'},
                      {'realtime_vehicle_positions': 'https://operator.test/rt', 'realtime_alerts': 'https://operator.test/alerts'}]:
            row = self.build([self.reference('rt', 'legacy')], [{'id': 'legacy', 'spec': 'gtfs', 'urls': roles}])[0]
            r = row['source_resolution']['declarations'][0]['resolution']
            self.assertEqual(r['metadata_spec'], 'gtfs'); self.assertEqual(r['specs'], ['gtfs-rt'])
            self.assertEqual(r['spec_precedence'], 'endpoint_roles_legacy_rt_label')
            self.assertTrue(r['metadata_spec_mismatch']); self.assertEqual(row['source_resolution']['state'], 'non_timetable_format')
        for declared, roles in [('gbfs', {'static_current': 'https://operator.test/feed'}),
                                ('gtfs-rt', {'static_current': 'https://operator.test/feed'}),
                                ('gtfs', {'gbfs_auto_discovery': 'https://operator.test/gbfs'})]:
            row = self.build([self.reference('conflict', 'c')], [{'id': 'c', 'spec': declared, 'urls': roles}])[0]
            self.assertEqual(row['source_resolution']['state'], 'ambiguous')
            self.assertFalse(row['source']); self.assertIsNone(row['source_resolution']['processed_filename'])

    def test_independent_published_static_survives_missing_current_reference_endpoint(self):
        row = self.build([self.reference('rail', 'old')], [{'id': 'old', 'spec': 'gtfs', 'urls': {'static_historic': ['https://operator.test/old']}}],
            licences=[{'filename': 'xx_rail.gtfs.zip', 'source': 'https://operator.test/known'}])[0]
        self.assertEqual(row['source_resolution']['state'], 'schedule')
        self.assertIsNone(row['source_resolution']['selected_static_declaration'])
        self.assertTrue(row['source_resolution']['companion_resolution_incomplete'])
        self.assertEqual(row['source'], 'https://operator.test/known')
        self.assertEqual(row['source_resolution']['processed_basis'], 'published_gtfs_record')

    def test_exact_original_alias_preserves_existing_owner_and_legacy_row(self):
        definitions = [self.reference('reference', 'f', skip=True)]
        feeds = [{'id': 'f', 'spec': 'gtfs', 'urls': {'static_current': 'https://operator.test/feed?q=first'}}]
        mobility = [{'id': 'owner', 'data_type': 'gtfs', 'urls.direct_download': 'https://operator.test/feed?q=first'}]
        rows = self.build(definitions, feeds, mobility=mobility)
        self.assertEqual(len(rows), 2)
        by_name = {r['filename']: r for r in rows}
        owner = by_name['mdb_owner.gtfs.zip']; ref = by_name['xx_reference.gtfs.zip']
        self.assertNotIn('source_resolution', owner)
        self.assertEqual(ref['source_resolution']['acquisition_alias_of'], 'mdb_owner')
        self.assertEqual(ref['source_resolution']['alias_source_sha256'], __import__('hashlib').sha256(owner['source'].encode()).hexdigest())
        mobility[0]['urls.direct_download'] = 'https://operator.test/feed?q=second'
        rows = self.build(definitions, feeds, mobility=mobility)
        self.assertIsNone(next(r for r in rows if r['filename'].startswith('xx_'))['source_resolution']['acquisition_alias_of'])

    def test_overrides_and_access_material_are_not_silently_stripped(self):
        row = self.build([self.reference('gbfs', 'g', **{'url-override': 'https://override.test/gbfs'})], [
            {'id': 'g', 'spec': 'gbfs', 'urls': {'gbfs_auto_discovery': 'https://operator.test/gbfs'}}])[0]
        endpoint = row['source_resolution']['declarations'][0]['resolution']['endpoints'][0]
        self.assertEqual(endpoint['url'], 'https://override.test/gbfs'); self.assertEqual(endpoint['declared_url'], 'https://operator.test/gbfs')
        row = self.build([self.reference('held', 's', **{'api-key': 'fixture-secret-key', 'url-override': 'AGE-ENCRYPTED:fixture-secret'})], [
            {'id': 's', 'spec': 'gtfs', 'urls': {'static_current': 'https://operator.test/static'}}])[0]
        self.assertEqual(row['source_resolution']['state'], 'unresolved')
        self.assertNotIn('fixture-secret', json.dumps(row))

    def test_security_sensitive_transport_options_are_not_mislabelled_or_applied(self):
        row = self.build([self.reference('transport', 'static', **{'http-options': {'ignore-tls-errors': True}})], [
            {'id': 'static', 'spec': 'gtfs', 'urls': {'static_current': 'https://operator.test/rail.zip'}}])[0]
        declaration = row['source_resolution']['declarations'][0]
        self.assertEqual(declaration['resolution']['state'], 'transport_options_required')
        self.assertEqual(declaration['resolution']['specs'], ['gtfs'])
        self.assertEqual(declaration['resolution']['unsupported_options'], ['http-options'])
        self.assertEqual(declaration['resolution']['endpoints'][0]['access_state'], 'review_required')
        self.assertNotIn('authorization', declaration['resolution']['endpoints'][0])
        self.assertNotIn('ignore-tls-errors', json.dumps(row))
        self.assertEqual(row['source_resolution']['state'], 'unresolved')
        self.assertFalse(row['source'])

    def test_explicit_rt_missing_companion_keeps_unique_static_primary(self):
        row = self.build([self.reference('rail', 'static', skip=True), self.reference('rail', 'missing', spec='gtfs-rt')], [
            {'id': 'static', 'spec': 'gtfs', 'urls': {'static_current': 'https://operator.test/rail.zip'}}])[0]
        self.assertEqual(row['source_resolution']['state'], 'schedule')
        self.assertEqual(row['source'], 'https://operator.test/rail.zip')
        self.assertEqual(row['source_resolution']['declarations'][1]['resolution']['state'], 'missing_reference')
        self.assertTrue(row['source_resolution']['companion_resolution_incomplete'])

    def test_distinct_ordinary_candidate_prevents_whole_row_alias(self):
        ordinary = ('xx', {'name': 'rail', 'type': 'http', 'url': 'https://independent.test/rail.zip'}, 'https://github.test/pin/xx.json')
        definitions = [ordinary, self.reference('rail', 'static', skip=True)]
        feeds = [{'id': 'static', 'spec': 'gtfs', 'urls': {'static_current': 'https://owner.test/shared.zip'}}]
        rows = self.build(definitions, feeds, mobility=[{'id': 'owner', 'data_type': 'gtfs', 'urls.direct_download': 'https://owner.test/shared.zip'}])
        row = next(r for r in rows if r['filename'] == 'xx_rail.gtfs.zip')
        self.assertEqual(row['source_resolution']['state'], 'schedule')
        self.assertEqual(row['source'], 'https://independent.test/rail.zip')
        self.assertIsNone(row['source_resolution']['acquisition_alias_of'])
        self.assertEqual(row['source_resolution']['processed_filename'], row['filename'])

    def test_mobility_declared_format_disagreements_are_retained(self):
        for declared in ['gtfs', 'gtfs-rt']:
            definition = ('xx', {'name': 'mismatch', 'type': 'mobility-database', 'mdb-id': 'known', 'spec': declared}, 'https://github.test/pin/xx.json')
            licence = [{'filename': 'xx_mismatch.gtfs.zip', 'source': 'https://known.test/static'}] if declared == 'gtfs-rt' else []
            context = catalogue.publication.Context(catalogue.publication.build_index(catalogue.publication.encoded(licence), catalogue.catalogue_sources(self.PIN)[0]))
            rows = catalogue.build_catalogue(licence, [definition], [{'id': 'known', 'data_type': 'gbfs', 'urls.direct_download': 'https://operator.test/gbfs'}], self.PIN, publication_context=context)[0]
            resolution = rows[0]['source_resolution']
            self.assertEqual(resolution['declarations'][0]['resolution']['state'], 'conflicting_reference')
            self.assertEqual(resolution['state'], 'schedule' if licence else 'ambiguous')
            self.assertNotEqual(rows[0]['source'], 'https://operator.test/gbfs')

    def test_existing_access_hold_stays_byte_equivalent(self):
        signed = 'https://fixture-user:fixture-pass@operator.test/rail'
        licences = [{'filename': 'xx_held.gtfs.zip', 'source': signed}]
        definitions = [self.reference('held', 'static')]
        old = catalogue.build_catalogue(licences, definitions, [], self.PIN)[0][0]
        new = self.build(definitions, [{'id': 'static', 'spec': 'gtfs', 'urls': {'static_current': 'https://public.test/feed'}}], licences=licences)[0]
        self.assertEqual(new, old); self.assertNotIn('source_resolution', new)

    def test_reference_index_limits_duplicates_and_corruption_are_explicit(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(catalogue.references.read_transitland(root, self.PIN)['state'], 'unavailable')
            path = root/'one.json'; feed = {'id': 'same', 'spec': 'gtfs', 'urls': {'static_current': 'https://operator.test/feed'}}
            path.write_text(json.dumps({'feeds': [feed, feed]}))
            index = catalogue.references.read_transitland(root, self.PIN)
            self.assertEqual(len(index['by_id']['same']), 2)
            rows = catalogue.build_catalogue([], [self.reference('same', 'same')], [], self.PIN, index)[0]
            self.assertEqual(rows[0]['source_resolution']['state'], 'ambiguous')
            for field, limit in [('MAX_FILE_BYTES', 4), ('MAX_TOTAL_BYTES', 4), ('MAX_RECORDS', 1), ('MAX_RECORD_BYTES', 4), ('MAX_FILES', 0)]:
                with patch.object(catalogue.references, field, limit):
                    value = catalogue.references.read_transitland(root, self.PIN)
                    self.assertEqual(value['state'], 'unavailable'); self.assertIsNone(value['sha256']); self.assertEqual(value['by_id'], {})
            path.write_text('{ malformed fixture-private-body')
            value = catalogue.references.read_transitland(root, self.PIN)
            self.assertEqual(value['state'], 'unavailable'); self.assertNotIn('fixture-private-body', json.dumps(value))

    def test_unavailable_index_never_guesses_reference_type_or_drops_rows(self):
        for index in [None, catalogue.references.unavailable(self.PIN, 'metadata_unavailable')]:
            rows = catalogue.build_catalogue([], [self.reference('rail', 'unknown')], [], self.PIN, index)[0]
            self.assertEqual(len(rows), 1); self.assertEqual(rows[0]['source_resolution']['state'], 'unresolved')
            self.assertIsNone(rows[0]['source_resolution']['processed_filename'])

    def test_mobility_reference_resolves_exact_type_without_gtfs_default(self):
        for datatype, expected in [('gtfs', 'schedule'), ('gtfs-rt', 'non_timetable_format'), ('gbfs', 'non_timetable_format')]:
            definition = ('xx', {'name': 'source', 'type': 'mobility-database', 'mdb-id': 'known'}, 'https://github.test/feeds/xx.json')
            rows = catalogue.build_catalogue([], [definition], [{'id': 'known', 'data_type': datatype, 'urls.direct_download': 'https://operator.test/feed'}], self.PIN)[0]
            self.assertEqual(rows[0]['source_resolution']['state'], expected)


if __name__ == '__main__':
    unittest.main()
