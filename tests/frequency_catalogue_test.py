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
        self.assertEqual(counts['transitous_schedule_source'],2)
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
                '--mobility-csv',str(path/'mobility.csv'),'--transitous-ref','0123456789abcdef',
                '--output',str(path/'combined.json'),'--report',str(path/'report.json')]):
                catalogue.main()
            got=json.loads((path/'combined.json').read_text())
            report=json.loads((path/'report.json').read_text())
            self.assertEqual(len(got),2)
            self.assertEqual(report['counts']['merged_entries'],2)
            self.assertIn('0123456789abcdef',got[0]['lineage'][0]['url'])
            self.assertEqual(got[1]['delivery'],'direct')


if __name__ == '__main__':
    unittest.main()

