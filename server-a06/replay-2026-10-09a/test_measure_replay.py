#!/usr/bin/env python3
"""Focused receipt/provenance controls; no workload or network launched."""
from pathlib import Path
from types import SimpleNamespace
import hashlib,json,tempfile,unittest
import measure_replay as m

class Controls(unittest.TestCase):
    def fixture(self,root):
        source=root/'source';deps=root/'deps';source.mkdir();deps.mkdir()
        (source/'code.mjs').write_text('example');(deps/'package.js').write_text('dependency');node=root/'node';node.write_bytes(b'example executable identity')
        bundle=root/'bundle';bundle.mkdir();(bundle/'replay-manifest.json').write_text('{}')
        config={'cohort':'test-cohort','role':'test','source_commit':'test-commit','source':m.tree_digest(source,skip=('node_modules','.git')),'dependencies':m.tree_digest(deps),'node_binary_sha256':hashlib.sha256(node.read_bytes()).hexdigest(),'replay_manifest_sha256':hashlib.sha256(b'{}').hexdigest()}
        p=root/'identities.json';p.write_text(json.dumps(config));return SimpleNamespace(source=source,dependencies=deps,node=node,identity_manifest=p,bundle=bundle)
    def test_clean_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            a=self.fixture(Path(tmp));self.assertEqual(m.verify_provenance(a)['cohort'],'test-cohort')
    def test_changed_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            a=self.fixture(Path(tmp));(a.source/'code.mjs').write_text('changed')
            with self.assertRaises(ValueError):m.verify_provenance(a)
    def test_extra_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            a=self.fixture(Path(tmp));(a.source/'extra.js').write_text('extra')
            with self.assertRaises(ValueError):m.verify_provenance(a)
    def test_changed_dependency(self):
        with tempfile.TemporaryDirectory() as tmp:
            a=self.fixture(Path(tmp));(a.dependencies/'package.js').write_text('changed')
            with self.assertRaises(ValueError):m.verify_provenance(a)
    def test_changed_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            a=self.fixture(Path(tmp));a.node.write_text('different runtime')
            with self.assertRaises(ValueError):m.verify_provenance(a)
    def test_external_dependency_link(self):
        with tempfile.TemporaryDirectory() as tmp:
            a=self.fixture(Path(tmp));(a.dependencies/'link').symlink_to(a.node)
            with self.assertRaises(ValueError):m.verify_provenance(a)
    def test_changed_replay_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            a=self.fixture(Path(tmp));(a.bundle/'replay-manifest.json').write_text('{"altered":true}')
            with self.assertRaises(ValueError):m.verify_provenance(a)
    def test_known_cache_exclusion_is_exact(self):
        with tempfile.TemporaryDirectory() as tmp:
            a=self.fixture(Path(tmp));cache=a.source/'__pycache__';cache.mkdir();(cache/'known.pyc').write_bytes(b'cache')
            config=json.loads(a.identity_manifest.read_text());config['source_excluded_files']=['__pycache__/known.pyc'];a.identity_manifest.write_text(json.dumps(config));m.verify_provenance(a)
            (cache/'unexpected.js').write_text('additional code')
            with self.assertRaises(ValueError):m.verify_provenance(a)
    def test_extra_output_does_not_reduce_matching_expected(self):
        expected=[{'path':'a','bytes':1,'sha256':'a'},{'path':'b','bytes':2,'sha256':'b'}]
        result=m.compare_outputs({'files':expected+[{'path':'c','bytes':3,'sha256':'c'}]},expected)
        self.assertEqual(result['matching_files'],2);self.assertFalse(result['exact_match']);self.assertEqual(len(result['differences']),1)
    def test_missing_and_changed_outputs(self):
        result=m.compare_outputs({'files':[{'path':'a','bytes':1,'sha256':'bad'}]},[{'path':'a','bytes':1,'sha256':'a'},{'path':'b','bytes':2,'sha256':'b'}])
        self.assertEqual(result['matching_files'],0);self.assertEqual(len(result['differences']),2)
if __name__=='__main__':unittest.main(verbosity=2)
