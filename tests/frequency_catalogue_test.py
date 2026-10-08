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
