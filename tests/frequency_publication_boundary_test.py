"""Offline producer and publication regressions; no provider or DNS requests."""
import copy, gzip, hashlib, importlib.util, json, math, os, socket, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
ROOT = Path(os.environ.get('ATLAS_SOURCE_ROOT', Path(__file__).resolve().parents[1])).resolve()
def deny(*args, **kwargs):
    raise AssertionError('network_and_dns_forbidden')
socket.socket.connect = socket.socket.connect_ex = socket.create_connection = socket.getaddrinfo = deny
spec = importlib.util.spec_from_file_location('pipeline', ROOT/'scripts/global-service-frequency.py')
p = importlib.util.module_from_spec(spec); spec.loader.exec_module(p)
spec = importlib.util.spec_from_file_location('fixtures', ROOT/'tests/global_frequency_test.py')
f = importlib.util.module_from_spec(spec); spec.loader.exec_module(f)
MARKER = 'synthetic-unpublished-lineage-marker'
URL = 'https://feeds.example.test/static.zip?region=synthetic-one'
OTHER = URL.replace('one', 'two')
LINEAGE = {'catalogue':'mobility-database','id':'synthetic','url':'https://files.mobilitydatabase.org/feeds_v2.csv',
           'source':OTHER,'status':'active','authentication_type':'0',
           'authorization':{'parameter_name':'x-fixture','value':MARKER}, 'debug':{'nested':[MARKER]}}
ROW = {'filename':'fixture.gtfs.zip','human_name':'Fixture Rail','country_code':'ZZ','source':URL,
       'delivery':'direct','publisher':{'name':'Fixture Publisher','url':'https://publisher.example.test/about'},
       'spdx_license_identifier':'CC-BY-4.0','attribution_text':'Fixture attribution',
       'rights_evidence':[{'origin':'fixture','spdx_license_identifier':'CC-BY-4.0'}], 'lineage':[LINEAGE]}
def feed():
    return {'schema':1,'source':{'id':'fixture','sha256':'a'*64,'service_date':'2026-10-05','catalogue_lineage':[LINEAGE],
        'catalogue_attribution':ROW,'license':'CC-BY-4.0','rights':{'attribution_required':True},'attribution':'Fixture attribution'},
        'routes':[{'route_id':'https://ids.example.test/r?identity=keep','route_type':'1','url':URL}],
        'agencies':[{'agency_id':'https://ids.example.test/a?identity=keep','agency_url':URL}],
        'segments':[{'route_id':'https://ids.example.test/r?identity=keep','trip_id':'https://ids.example.test/t?identity=keep',
           'geometry':[[0,0],[1,1]],'profiles':{'h01':{'display_tph':2}}}],
        'profiles':{'h01':{'start':'01:00:00','end':'02:00:00'}}}
class PublicationRegressions(unittest.TestCase):
    def test_legacy_lineage_and_standalone_copies_discard_unknown_nested_fields(self):
        for value in [ROW, {'catalogue_lineage':[LINEAGE]}, feed()['source']]:
            with self.subTest(boundary=list(value)):
                result = p.published_metadata(value)
                self.assertNotIn(MARKER,json.dumps(result))
    def test_legacy_preservation_controls(self):
        row=copy.deepcopy(ROW); before=copy.deepcopy(row)
        entry=p.discover([row],{})[0]; candidates=p.source_candidates(entry)
        result=p.published_metadata(row)
        self.assertEqual(row,before); self.assertEqual(candidates,[URL,OTHER])
        self.assertEqual(p.source_candidates(p.discover([row],{})[0]),candidates)
        self.assertEqual(result['source_sha256'],p.source_url_fingerprint(URL))
        self.assertEqual(result['lineage'][0]['source_sha256'],p.source_url_fingerprint(OTHER))
        self.assertNotEqual(result['source_sha256'],result['lineage'][0]['source_sha256'])
        for key in ['publisher','spdx_license_identifier','attribution_text','rights_evidence']:
            self.assertEqual(result[key],p.published_metadata(before[key]))
        self.assertEqual(p.published_metadata(result),result)
        for url in ['https://例子.test/feed.zip','https://public.example.test/鉄道.zip']:
            raw={'lineage':[{'source':url}]}; pub=p.published_metadata(raw)
            self.assertEqual(pub['lineage'][0]['source'],p.redacted_source_url(url))
            self.assertEqual(pub['lineage'][0]['source_sha256'],p.source_url_fingerprint(url))
    def test_authentication_scalar_controls_remain_exact(self):
        for auth in ['0','none','',None,0,1,True,False,1.5,'key']:
            with self.subTest(auth=auth):
                item={**LINEAGE,'authentication_type':auth}
                self.assertEqual(p.published_metadata({'lineage':[item]})['lineage'][0]['authentication_type'],auth)
    def test_malformed_authority_container_or_hash_fails_closed(self):
        malformed=[{'lineage':None},{'lineage':{'value':MARKER}},{'lineage':MARKER},{'lineage':[None]},
            {'lineage':[[MARKER]]},{'lineage':[{**LINEAGE,'authentication_type':{'value':MARKER}}]},
            {'lineage':[{**LINEAGE,'source_sha256':'malformed'}]},
            {'catalogue_lineage':[{**LINEAGE,'url_sha256':{'value':MARKER}}]}]
        for value in malformed:
            with self.subTest(value_shape=list(value)):
                with self.assertRaises((ValueError,TypeError)):
                    p.published_metadata(value)
    def test_current_writer_removes_marker_without_altering_matching_payload(self):
        record=feed(); before=copy.deepcopy(record)
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'fixture.json.gz';p.write_feed(path,record)
            result=json.loads(gzip.decompress(path.read_bytes()))
        self.assertEqual(record,before)
        for key in ['segments','profiles']:
            self.assertEqual(result[key],before[key])
        for table in ['routes','agencies']:
            for key,value in before[table][0].items():
                if key!='url' and not key.endswith('_url'):
                    self.assertEqual(result[table][0][key],value)
        for key in ['id','sha256','service_date','license','rights','attribution']:
            self.assertEqual(result['source'][key],before['source'][key])
        self.assertNotIn(MARKER,json.dumps(result))
    def test_fresh_cache_hit_and_signature_miss_producer_remove_marker(self):
        entry=p.discover([copy.deepcopy(ROW)],{})[0]; archive=f.GlobalFrequency().archive()
        with tempfile.TemporaryDirectory() as root:
            root=Path(root);cache=root/'cache';cache.mkdir();output=root/'output'
            def local_fetch(_entry,path,*args,**kwargs):
                path.write_bytes(archive)
                return {'download_url':p.redacted_source_url(URL),'download_url_sha256':p.source_url_fingerprint(URL),
                    'retrieved':'2026-10-05','checked':'2026-10-05'},[]
            with patch.object(p,'fetch_alternative',side_effect=local_fetch),patch.object(p,'get',side_effect=deny):
                fresh=p.compile_entry(entry,cache,output,'2026-10-05',None,1000000,p.PROFILES)
                hit=p.compile_entry(entry,cache,output,'2026-10-05',None,1000000,p.PROFILES)
                real_hash=p.file_hash
                with patch.object(p,'file_hash',side_effect=lambda path:'0'*64 if str(path).endswith('global-service-frequency.py') else real_hash(path)):
                    stale=p.compile_entry(entry,cache,output,'2026-10-05',None,1000000,p.PROFILES)
            self.assertEqual(hit['acquisition_metrics']['compiled_cache_hits'],1)
            self.assertNotEqual(stale['source']['input_signature'],hit['source']['input_signature'])
            self.assertEqual((cache/'fixture.zip').read_bytes(),archive)
            for name,result in [('fresh',fresh),('cache_hit',hit),('stale_signature',stale)]:
                with self.subTest(path=name):
                    self.assertEqual(result['source']['sha256'],hashlib.sha256(archive).hexdigest())
                    self.assertNotIn(MARKER,json.dumps(result['source']))
    def test_publication_alias_rejection_is_monotone(self):
        row={'source':URL,'lineage':[{'catalogue':'mobility-database','source':URL,'authentication_type':'0'}],
             'publication_alias_eligible':False}
        result=p.published_metadata(row)
        self.assertFalse(result['publication_alias_eligible'])
        self.assertFalse(p.registry.references.alias_owner_metadata_compatible(result))
    def test_marker_types_and_fake_true_do_not_grant_authority(self):
        for marker in [None,0,1,'false',[],{}]:
            with self.subTest(marker=marker):
                with self.assertRaises((ValueError,TypeError)):
                    p.published_metadata({'lineage':[], 'publication_alias_eligible':marker})
        row={'source':URL,'lineage':[{'catalogue':'mobility-database','source':URL,'authentication_type':1}],
             'publication_alias_eligible':True}
        result=p.published_metadata(row)
        self.assertFalse(result['publication_alias_eligible'])
        self.assertEqual(p.published_metadata(result),result)
        for literal in ['0.0','0e0','-0.0','1e-999']:
            value=json.loads(literal)
            row={'source':URL,'lineage':[{'catalogue':'mobility-database','source':URL,'authentication_type':value}]}
            self.assertTrue(p.registry.references.alias_owner_metadata_compatible(p.published_metadata(row)))
        for value in [float('nan'),float('inf'),float('-inf')]:
            with self.assertRaises(ValueError):p.published_metadata({'lineage':[{'authentication_type':value}]})
    def test_source_only_legacy_owner_keeps_original_discovery_and_alias_rejection(self):
        row={'filename':'fixture.gtfs.zip','source':'https://synthetic:synthetic@public.example.test/feed?region=synthetic',
             'delivery':'direct','human_name':'Fixture','country_code':'ZZ'}
        before=copy.deepcopy(row);entry=p.discover([row],{})[0];candidates=p.source_candidates(entry)
        result=p.published_metadata(row)
        self.assertFalse(result['publication_alias_eligible'])
        self.assertEqual(p.published_metadata(result),result)
        self.assertEqual(row,before)
        self.assertEqual(p.source_candidates(p.discover([row],{})[0]),candidates)
        self.assertFalse(p.registry.references.alias_owner_metadata_compatible(result))
    def test_repeated_feed_writes_preserve_gtfs_url_fingerprints(self):
        record=feed()
        with tempfile.TemporaryDirectory() as root:
            path=Path(root)/'feed.json.gz';p.write_feed(path,record)
            first=json.loads(gzip.decompress(path.read_bytes()))
            p.write_feed(path,first);second=json.loads(gzip.decompress(path.read_bytes()))
            self.assertEqual(second,first)
            self.assertEqual(second['routes'][0]['url_sha256'],p.source_url_fingerprint(URL))
            self.assertEqual(second['agencies'][0]['agency_url_sha256'],p.source_url_fingerprint(URL))
    def test_plain_legacy_source_text_and_first_display_marker_are_stable(self):
        for source in ['synthetic-plain-source','synthetic:plain','', '[invalid source URL]']:
            row={'delivery':'direct','source':source,'lineage':[{'catalogue':'mobility-database','source':source,'authentication_type':'0'}]}
            result=p.published_metadata(row)
            self.assertEqual(result['lineage'][0]['source'],source)
            self.assertFalse(result['publication_alias_eligible'])
            self.assertEqual(p.published_metadata(result),result)
        row={'source':'https://PUBLIC.example.test/feed','lineage':[{'source':'https://PUBLIC.example.test/feed'}]}
        result=p.published_metadata(row)
        self.assertFalse(result['publication_alias_eligible'])
        self.assertEqual(p.published_metadata(result),result)
        with self.assertRaisesRegex(ValueError,'invalid_publication_lineage_url'):
            p.published_metadata({'lineage':[{'source':'https://[broken]/feed'}]})
    def test_artifact_staging_entry_point_is_explicit(self):
        self.assertTrue((ROOT/'scripts/stage-frequency-artifact.py').is_file(),
                        'The workflow must have an explicit disposable staging entry point')
if __name__ == '__main__': unittest.main(verbosity=2)
