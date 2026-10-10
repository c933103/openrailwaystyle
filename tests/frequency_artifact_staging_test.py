import argparse
import copy
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('stage_frequency',ROOT/'scripts/stage-frequency-artifact.py')
stage=importlib.util.module_from_spec(spec);spec.loader.exec_module(stage)
p=stage.pipeline
MARKER='synthetic-unpublished-lineage-marker'

def deny(*args,**kwargs):raise AssertionError('network_and_dns_forbidden')

def fixture(root,url='https://public.example.test/feed.zip?region=synthetic'):
    source=root/'input';source.mkdir();(source/'feeds').mkdir()
    catalogue=root/'catalogue';catalogue.mkdir()
    lineage={'catalogue':'mobility-database','id':'fixture','url':p.registry.MOBILITY_CSV,'source':url,'status':'active','authentication_type':'0'}
    row={'filename':'fixture.gtfs.zip','human_name':'Fixture','country_code':'ZZ','source':url,'delivery':'direct','lineage':[lineage]}
    stage.write_json(catalogue/'catalogue.json',[row]);raw=b'[]'
    index=p.registry.publication.build_index(raw,p.registry.catalogue_sources('a'*40)[0]);stage.write_json(catalogue/'publication-index.json',index)
    report={'schema':4,'publication_index':{'sha256':stage.digest(catalogue/'publication-index.json'),'records':0},
        'catalogue_sha256':stage.digest(catalogue/'catalogue.json'),'transitous_ref':'a'*40,'sources':p.registry.catalogue_sources('a'*40),
        'transitland_ref':None,'transitland_state':'unavailable','transitland_reason':'not_supplied',
        'input_sha256':{'transitous_licences':hashlib.sha256(raw).hexdigest(),'transitous_feeds':'a'*64,'mobility_csv':'b'*64,'transitland_feeds':None},
        'counts':{'merged_entries':1},'note':'Synthetic fixture'}
    stage.write_json(catalogue/'catalogue-report.json',report)
    args=argparse.Namespace(input=source,output=root/'artifact',diagnostics=root/'diagnostics',catalogue=catalogue/'catalogue.json',
        catalogue_report=catalogue/'catalogue-report.json',publication_index=catalogue/'publication-index.json',
        rules=ROOT/'styles/data-src/frequency-source-rules.json',date='2026-10-05',mode='shard',producer_outcome='success',
        shard=0,shards=1,max_feed_bytes=stage.MAX_BYTES,max_feed_memory_bytes=stage.MAX_MEMORY,max_feed_seconds=stage.MAX_SECONDS)
    ctx=stage.context(args);entry=copy.deepcopy(ctx['entries'][0]);entry.update(status='compiled',output='feeds/fixture.json.gz',sha256='c'*64)
    entry=p.published_metadata(entry)
    inventory={'schema':3,'shard':0,'shards':1,'catalogue_entries':1,'catalogue_sha256':ctx['hash'],'catalogue_provenance':ctx['provenance'],
        'service_date':args.date,'entries':[entry],'counts':{'compiled':1}}
    stage.write_json(source/'inventory-0.json',inventory)
    id='https://ids.example.test/r?identity=keep'
    feed={'schema':1,'source':{'id':'fixture','sha256':'c'*64,'service_date':args.date,'checked':args.date,'name':'Fixture','feed_info':{},
        'valid_until':1900000000,'catalogue_lineage':[{**lineage,'authorization':{'value':MARKER}}],
        'catalogue_attribution':{**row,'lineage':[{**lineage,'authorization':{'value':MARKER}}]},'license':'CC-BY-4.0','rights':{'attribution_required':True}},
        'agencies':[{'agency_id':'a','agency_name':'Fixture','agency_timezone':'UTC','agency_url':'https://u:synthetic@public.example.test/?token=synthetic'}],
        'routes':[{'route_id':id,'route_type':'1'}],
        'profiles':{'h01':{'start':'01:00:00','end':'02:00:00'}},
        'segments':[{'route_id':id,'agency_id':'a','trip_id':'https://ids.example.test/t?identity=keep','geometry':[[0,0],[1,1]],
            'profiles':{'h01':{'display_tph':2,'forward_tph':2,'backward_tph':2,'quality':'scheduled'}}}]}
    (source/'feeds/fixture.json.gz').write_bytes(gzip.compress(json.dumps(feed).encode(),mtime=0))
    return args,ctx,inventory,feed


class ArtifactStaging(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.args,self.ctx,self.inventory,self.feed=fixture(self.root)
        self.guards=[patch.object(socket.socket,'connect',deny),patch.object(socket.socket,'connect_ex',deny),patch.object(socket,'getaddrinfo',deny)]
        for guard in self.guards:guard.start()
    def tearDown(self):
        for guard in self.guards:guard.stop()
        self.temp.cleanup()
    def save_inventory(self):stage.write_json(self.args.input/'inventory-0.json',self.inventory)
    def save_feed(self,feed=None):
        (self.args.input/'feeds/fixture.json.gz').write_bytes(gzip.compress(json.dumps(feed or self.feed).encode(),mtime=0))
    def failure(self,code=None):
        self.assertEqual(stage.run(self.args),1)
        self.assertFalse(self.args.output.exists())
        self.assertFalse(any(self.root.glob('.frequency-stage-*')))
        receipt=stage.read_json(self.args.diagnostics/'receipt.json')
        self.assertEqual(receipt['status'],'diagnostic_only')
        if code:self.assertEqual(receipt['reason_code'],code)
        self.assertNotIn(MARKER,json.dumps(receipt));return receipt
    def test_success_derivative_preserves_inputs_ids_geometry_and_sidecars(self):
        original=stage.file_hashes(self.args.input);feed_path=self.args.input/'feeds/fixture.json.gz'
        (self.args.input/'feeds/stale.json.gz').write_bytes(b'not_a_feed')
        self.assertEqual(stage.run(self.args),0)
        self.assertEqual(stage.digest(feed_path),original['feeds/fixture.json.gz'])
        result=json.loads(gzip.decompress((self.args.output/'feeds/fixture.json.gz').read_bytes()))
        self.assertNotIn(MARKER,json.dumps(result))
        for key in ['routes','segments','profiles']:self.assertEqual(result[key],self.feed[key])
        for key in ['id','sha256','service_date','license','rights']:self.assertEqual(result['source'][key],self.feed['source'][key])
        self.assertEqual((self.args.output/'catalogue-report.json').read_bytes(),self.args.catalogue_report.read_bytes())
        self.assertEqual((self.args.output/'publication-index.json').read_bytes(),self.args.publication_index.read_bytes())
        self.assertEqual({f.name for f in (self.args.output/'feeds').iterdir()},{'fixture.json.gz'})
        self.assertFalse(self.args.diagnostics.exists())
    def test_multi_chunk_national_fixture_fits_default_bounds(self):
        self.feed['segments']=[copy.deepcopy(self.feed['segments'][0]) for _ in range(12000)]
        self.save_feed()
        expected=json.dumps(self.feed).encode()
        self.assertGreater(len(expected),1024*1024)
        original=stage.digest(self.args.input/'feeds/fixture.json.gz')
        self.assertEqual(stage.run(self.args),0)
        result=json.loads(gzip.decompress((self.args.output/'feeds/fixture.json.gz').read_bytes()))
        self.assertEqual(result['segments'],self.feed['segments'])
        self.assertEqual(stage.digest(self.args.input/'feeds/fixture.json.gz'),original)
    def test_missing_inventory(self):
        (self.args.input/'inventory-0.json').unlink();self.assertEqual(self.failure('inventory_missing')['inventory_state'],'missing')
    def test_partial_inventory(self):
        self.inventory['entries']=[];self.save_inventory();self.assertEqual(self.failure('inventory_partial')['inventory_state'],'partial')
    def test_stale_inventory(self):
        self.inventory['service_date']='2026-10-04';self.save_inventory();self.assertEqual(self.failure('inventory_stale_or_mismatched')['inventory_state'],'stale_or_invalid')
    def test_complete_inventory_does_not_override_failed_cancelled_or_skipped_producer(self):
        for status in ['failure','cancelled','skipped']:
            with self.subTest(status=status):
                self.args.producer_outcome=status
                self.args.diagnostics=self.root/('diagnostic-'+status)
                self.assertEqual(stage.run(self.args),0);self.assertFalse(self.args.output.exists())
                receipt=stage.read_json(self.args.diagnostics/'receipt.json');self.assertEqual(receipt['inventory_state'],'complete')
    def test_failed_feed_diagnosis_remains_structured(self):
        self.inventory['entries'][0].update(status='retry_pending',reason_code='source_http_404',failure_stage='retrieval',retry_eligible=True,
            next_action='repair_or_find_feed_url',source_attempts=[{'code':'http_404','url':'https://u:synthetic@public.example.test/f?token=synthetic'}])
        self.inventory['entries'][0].pop('output');self.save_inventory();self.args.producer_outcome='failure'
        self.assertEqual(stage.run(self.args),0);row=stage.read_json(self.args.diagnostics/'receipt.json')['entries'][0]
        self.assertEqual(row['reason_code'],'source_http_404');self.assertEqual(row['source_attempts'][0]['code'],'http_404')
        self.assertNotIn('synthetic',json.dumps(row));self.assertIn('token=',row['source_attempts'][0]['url'])
    def test_feed_identity_mismatch(self):
        self.feed['source']['sha256']='d'*64;self.save_feed();self.failure('feed_identity_mismatch')
    def test_path_traversal_output(self):
        self.inventory['entries'][0]['output']='../outside.json.gz';self.save_inventory();self.failure('invalid_compiled_binding')
    def test_symlink_feed(self):
        feed=self.args.input/'feeds/fixture.json.gz';raw=feed.read_bytes();feed.unlink();outside=self.root/'outside';outside.write_bytes(raw);feed.symlink_to(outside)
        self.failure('symlink_input');self.assertEqual(outside.read_bytes(),raw)
    def test_duplicate_inventory_keys(self):
        path=self.args.input/'inventory-0.json';path.write_text('{"schema":3,"schema":3}')
        self.failure('invalid_json')
    def test_multiple_members_and_trailing_data_are_rejected(self):
        path=self.args.input/'feeds/fixture.json.gz';original=path.read_bytes()
        for i,extra in enumerate([gzip.compress(b'{}'),b'\0',b'synthetic-trailing']):
            with self.subTest(extra=i):
                self.args.diagnostics=self.root/('diagnostic-'+str(i));path.write_bytes(original+extra);self.failure('gzip_trailing_data')
    def test_expansion_limit_leaves_no_partial_artifact(self):
        self.feed['segments'][0]['synthetic_padding']='x'*100000;self.save_feed();self.args.max_feed_bytes=8192
        self.failure('expanded_feed_byte_limit')
    def test_header_limit_and_truncated_gzip(self):
        path=self.args.input/'feeds/fixture.json.gz';original=path.read_bytes()
        path.write_bytes(original[:3]+bytes([8])+original[4:10]+b'x'*65536+b'\0'+original[10:]);self.failure('gzip_header_limit')
        self.args.diagnostics=self.root/'diagnostic-truncated';path.write_bytes(original[:-4]);self.failure('truncated_gzip')
    def test_worker_timeout_and_write_failure_do_not_publish(self):
        with patch.object(stage.subprocess,'run',side_effect=subprocess.TimeoutExpired('synthetic',1)):
            self.failure('feed_time_limit')
        self.args.diagnostics=self.root/'diagnostic-write'
        with patch.object(stage.shutil,'copyfile',side_effect=OSError('synthetic-unpublished-lineage-marker')):
            self.failure('stage_io_failure')
    def test_actual_time_and_memory_caps_leave_no_artifact(self):
        self.args.max_feed_seconds=0.0001
        self.failure('feed_time_limit')
        self.args.diagnostics=self.root/'diagnostic-memory';self.args.max_feed_seconds=600
        self.args.max_feed_memory_bytes=1_000_000
        receipt=self.failure()
        self.assertIn(receipt['reason_code'],{'feed_memory_limit','feed_worker_failed'})
    def test_header_metadata_is_removed_only_in_the_derivative(self):
        path=self.args.input/'feeds/fixture.json.gz';original=path.read_bytes()
        inherited=original[:3]+bytes([24])+original[4:10]+MARKER.encode()+b'\0'+MARKER.encode()+b'\0'+original[10:]
        path.write_bytes(inherited)
        self.assertEqual(stage.run(self.args),0)
        self.assertEqual(path.read_bytes(),inherited)
        self.assertNotIn(MARKER.encode(),(self.args.output/'feeds/fixture.json.gz').read_bytes())
    def test_duplicate_feed_json_keys_fail_closed(self):
        path=self.args.input/'feeds/fixture.json.gz'
        path.write_bytes(gzip.compress(b'{"source":{},"source":{}}'))
        self.failure('invalid_json')
    def test_overflowed_nonfinite_json_is_rejected_before_serialization(self):
        path=self.args.input/'feeds/fixture.json.gz'
        path.write_bytes(gzip.compress(b'{"source":{},"unrelated":1e309}'))
        self.failure('invalid_json')
    def test_mid_stage_failure_removes_partial_derivative(self):
        original=(self.args.input/'feeds/fixture.json.gz').read_bytes()
        def interrupted(source,target,*args):
            target.parent.mkdir(exist_ok=True);target.write_bytes(b'partial')
            raise OSError('synthetic interrupted write')
        with patch.object(stage,'stage_feed',side_effect=interrupted):self.failure('stage_io_failure')
        self.assertEqual((self.args.input/'feeds/fixture.json.gz').read_bytes(),original)
    def test_existing_destination_and_overlap_never_modify_original(self):
        self.args.output.mkdir();sentinel=self.args.output/'sentinel';sentinel.write_bytes(b'original')
        with self.assertRaises(stage.StageError):stage.run(self.args)
        self.assertEqual(sentinel.read_bytes(),b'original')
        self.args.output=self.args.input/'new-stage'
        with self.assertRaises(stage.StageError):stage.run(self.args)
    def test_separate_shards_reject_sidecar_overlay_disagreement(self):
        self.assertEqual(stage.run(self.args),0)
        shardroot=self.root/'shards';shardroot.mkdir();shutil.move(str(self.args.output),shardroot/'worldwide-frequency-shard-0')
        canonical=(shardroot/'worldwide-frequency-shard-0/catalogue-report.json');canonical.write_text('{}')
        self.args.input=shardroot;self.args.output=self.root/'merged';self.args.mode='assembly-input'
        self.failure('shard_receipt_mismatch')
    def test_distinct_shards_are_compared_to_canonical_sidecars_before_flattening(self):
        roots=self.root/'shards';roots.mkdir();self.args.shards=2
        for shard in range(2):
            self.args.shard=shard;self.args.output=roots/f'worldwide-frequency-shard-{shard}'
            self.inventory.update(shard=shard,shards=2)
            entries=[copy.deepcopy(self.inventory['entries'][0])] if shard==0 else original_entries
            if shard==0:original_entries=copy.deepcopy(self.inventory['entries'])
            self.inventory['entries']=[e for e in entries if e['id'] in stage.selected_ids(self.ctx,shard,2)]
            stage.write_json(self.args.input/f'inventory-{shard}.json',self.inventory)
            self.assertEqual(stage.run(self.args),0)
        root=roots/'worldwide-frequency-shard-1';sidecar=root/'catalogue-report.json'
        data=stage.read_json(sidecar);data['note']='different synthetic note';stage.write_json(sidecar,data)
        receipt=stage.read_json(root/'stage-receipt-1.json')
        receipt['files']['catalogue-report.json']=stage.digest(sidecar)
        stage.write_json(root/'stage-receipt-1.json',receipt)
        self.args.mode='assembly-input';self.args.shard=0;self.args.input=roots;self.args.output=self.root/'merged'
        self.failure('shard_sidecar_mismatch')
    def assemble_fixture(self):
        self.assertEqual(stage.run(self.args),0)
        roots=self.root/'shards';roots.mkdir();shutil.move(str(self.args.output),roots/'worldwide-frequency-shard-0')
        self.args.input=roots;self.args.output=self.root/'merged';self.args.mode='assembly-input'
        self.assertEqual(stage.run(self.args),0)
        result=subprocess.run([os.environ.get('NODE_BINARY','node'),str(ROOT/'scripts/assemble-global-frequency.mjs'),str(self.args.output)],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.args.input=self.args.output;self.args.output=self.root/'snapshot';self.args.mode='snapshot'
    def test_snapshot_rejects_changed_display_hash_and_hold(self):
        self.assemble_fixture()
        path=self.args.input/'inventory-0.json';original=stage.read_json(path)
        for i,change in enumerate([
                {'source':'https://changed.example.test/feed.zip?region=[redacted]'},
                {'source_sha256':'d'*64},
                {'source_access':{'hold':True}},
                {'publication_alias_eligible':False}]):
            with self.subTest(kind=i):
                changed=copy.deepcopy(original);changed['entries'][0]['catalogue'].update(change)
                stage.write_json(path,changed);self.args.diagnostics=self.root/('diagnostic-tamper-'+str(i))
                self.failure('inventory_catalogue_mismatch')
        stage.write_json(path,original)
    def test_repeated_snapshot_staging_is_deterministic_and_read_only(self):
        self.assemble_fixture();before=stage.file_hashes(self.args.input)
        self.assertEqual(stage.run(self.args),0);first=stage.file_hashes(self.args.output)
        self.args.output=self.root/'snapshot-repeat'
        self.assertEqual(stage.run(self.args),0)
        self.assertEqual(stage.file_hashes(self.args.output),first)
        self.assertEqual(stage.file_hashes(self.args.input),before)
    def test_snapshot_expected_renderer_is_bounded_and_sanitizes_failures(self):
        self.assemble_fixture()
        with patch.object(stage.subprocess,'run',side_effect=subprocess.TimeoutExpired('synthetic-unpublished-lineage-marker',1)):
            self.failure('expected_metadata_time_limit')
        self.args.diagnostics=self.root/'diagnostic-renderer'
        with patch.object(stage.subprocess,'run',return_value=argparse.Namespace(returncode=1)):
            self.failure('expected_metadata_renderer_failed')
        self.args.diagnostics=self.root/'diagnostic-renderer-size'
        with patch.object(stage,'MAX_METADATA',32):
            self.failure('expected_metadata_byte_limit')
    def test_assembly_input_rejects_unknown_receipt_fields_and_nested_hash_values(self):
        self.assertEqual(stage.run(self.args),0)
        roots=self.root/'shards';roots.mkdir();shutil.move(str(self.args.output),roots/'worldwide-frequency-shard-0')
        path=roots/'worldwide-frequency-shard-0/stage-receipt-0.json';original=stage.read_json(path)
        self.args.input=roots;self.args.mode='assembly-input'
        for i,(key,value) in enumerate([('authorization',{'value':MARKER}),('schema',True),
                ('files',{**original['files'],'inventory-0.json':{'value':MARKER}})]):
            with self.subTest(kind=i):
                record=copy.deepcopy(original);record[key]=value;stage.write_json(path,record)
                self.args.output=self.root/('merged-unknown-'+str(i));self.args.diagnostics=self.root/('diagnostic-unknown-'+str(i))
                self.failure('shard_receipt_mismatch')
    def test_unknown_nested_diagnostic_shapes_and_internal_codes_are_bounded(self):
        token='synthetic_unpublished_sentinel'
        for i,value in enumerate([token,{'value':MARKER},[MARKER],None,True]):
            with self.subTest(kind=i):
                entry=self.inventory['entries'][0]
                for key in stage.DIAGNOSTIC_VALUES:entry[key]=value
                entry['source_attempts']=[{'code':value,'authorization':{'value':MARKER}}]
                self.save_inventory();self.args.diagnostics=self.root/('diagnostic-shape-'+str(i))
                stage.diagnose(self.args,token,self.ctx)
                receipt=stage.read_json(self.args.diagnostics/'receipt.json')
                self.assertEqual(receipt['reason_code'],'stage_validation_failed')
                self.assertNotIn(token,json.dumps(receipt));self.assertNotIn(MARKER,json.dumps(receipt))
    def test_snapshot_receipt_rejects_unknown_fields_shapes_and_changed_bindings(self):
        self.assemble_fixture();path=self.args.input/'stage-receipt-0.json';original=stage.read_json(path)
        mutations=[('authorization',{'value':MARKER}),('schema',True),('mode','synthetic_unpublished_sentinel'),
            ('status','synthetic_unpublished_sentinel'),('service_date','2026-10-04'),('shards',2),
            ('expected_ids_sha256','d'*64),('files',{**original['files'],'authorization':{'value':MARKER}}),
            ('files',{**original['files'],'inventory-0.json':{'value':MARKER}}),
            ('files',{**original['files'],'feeds/fixture.json.gz':'d'*64})]
        for i,(key,value) in enumerate(mutations):
            with self.subTest(kind=i):
                changed=copy.deepcopy(original);changed[key]=value;stage.write_json(path,changed)
                self.args.output=self.root/('snapshot-receipt-'+str(i))
                self.args.diagnostics=self.root/('diagnostic-receipt-'+str(i));self.failure()
        stage.write_json(path,original)
    def test_diagnostics_admit_only_approved_values_and_trusted_ids(self):
        token='synthetic_unpublished_sentinel'
        entry=self.inventory['entries'][0]
        entry.update(id=token,status=token,reason_code=token,failure_stage=token,next_action=token,
            authorization={'value':MARKER},source_attempts=[{'code':token,'authorization':{'value':MARKER}}])
        self.save_inventory();self.args.producer_outcome='failure'
        self.assertEqual(stage.run(self.args),0)
        receipt=stage.read_json(self.args.diagnostics/'receipt.json')
        self.assertNotIn(token,json.dumps(receipt));self.assertNotIn(MARKER,json.dumps(receipt))
        self.assertEqual(receipt['entries'][0]['status'],'unknown')
    def test_diagnostics_preserve_approved_cache_and_transport_categories(self):
        for i,(reason,attempt,action) in enumerate([
                ('source_cache_policy_restriction','source_cache_policy_blocked','refresh_from_permitted_source_or_review_cache_policy'),
                ('unresolved_source_cache_policy','source_cache_policy_unresolved','refresh_from_permitted_source_or_review_cache_policy'),
                ('source_retry_after','retry_after_pending','retry_source_or_repair_compiler'),
                ('source_access_denied','http_403','retry_source_or_repair_compiler')]):
            with self.subTest(kind=i):
                self.inventory['entries'][0].update(status='retry_pending',reason_code=reason,failure_stage='retrieval',next_action=action,
                    source_attempts=[{'code':attempt,'authorization':{'value':MARKER}}])
                self.save_inventory();self.args.producer_outcome='failure';self.args.diagnostics=self.root/('diagnostic-approved-'+str(i))
                self.assertEqual(stage.run(self.args),0);record=stage.read_json(self.args.diagnostics/'receipt.json')['entries'][0]
                self.assertEqual((record['reason_code'],record['source_attempts'][0]['code'],record['next_action']),(reason,attempt,action))
                self.assertNotIn(MARKER,json.dumps(record))
    def test_worker_response_unknown_error_token_is_not_echoed(self):
        token='synthetic_unpublished_sentinel'
        def worker(command,**kwargs):
            request=stage.read_json(Path(command[-1]));stage.write_json(Path(request['response']),{'schema':1,'error':token})
            return argparse.Namespace(returncode=1)
        with patch.object(stage.subprocess,'run',side_effect=worker):
            receipt=self.failure('feed_worker_failed')
        self.assertNotIn(token,json.dumps(receipt))
    def test_legacy_unicode_and_authority_rendering_roundtrip(self):
        for i,url in enumerate(['https://例子.test/鉄道.zip','https://public.example.test','https://public.example.test:443/feed.zip']):
            with self.subTest(kind=i):
                root=self.root/('render-'+str(i));root.mkdir()
                args,ctx,inventory,feed=fixture(root,url)
                self.assertEqual(stage.run(args),0)
                roots=root/'shards';roots.mkdir();shutil.move(str(args.output),roots/'worldwide-frequency-shard-0')
                args.input=roots;args.output=root/'merged';args.mode='assembly-input'
                self.assertEqual(stage.run(args),0)
                result=subprocess.run([os.environ.get('NODE_BINARY','node'),str(ROOT/'scripts/assemble-global-frequency.mjs'),str(args.output)],capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                args.input=args.output;args.output=root/'snapshot';args.mode='snapshot'
                status=stage.run(args)
                if status:reason=stage.read_json(args.diagnostics/'receipt.json')['reason_code']
                else:reason='none'
                self.assertEqual(status,0,reason)
    def test_successful_shard_merge_and_snapshot_contract(self):
        self.assertEqual(stage.run(self.args),0)
        shardroot=self.root/'shards';shardroot.mkdir();shutil.move(str(self.args.output),shardroot/'worldwide-frequency-shard-0')
        self.args.input=shardroot;self.args.output=self.root/'merged';self.args.mode='assembly-input'
        self.assertEqual(stage.run(self.args),0)
        # Use the actual assembler, preserving the original uploaded shard root.
        result=subprocess.run([os.environ.get('NODE_BINARY','node'),str(ROOT/'scripts/assemble-global-frequency.mjs'),str(self.args.output)],capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.args.input=self.args.output;self.args.output=self.root/'snapshot';self.args.mode='snapshot'
        self.assertEqual(stage.run(self.args),0)
        self.assertEqual(stage.read_json(self.args.output/'tiles/index.json'),{'tiles':[]})
        self.assertTrue((self.args.output/'manifest.json').is_file());self.assertTrue((self.args.output/'inventory.json').is_file())
        self.assertTrue((self.args.output/'feeds/fixture.json.gz').is_file())
        feed=json.loads(gzip.decompress((self.args.output/'feeds/fixture.json.gz').read_bytes()))
        self.assertEqual(feed['agencies'][0]['agency_url_sha256'],p.source_url_fingerprint(self.feed['agencies'][0]['agency_url']))

if __name__=='__main__':unittest.main()
