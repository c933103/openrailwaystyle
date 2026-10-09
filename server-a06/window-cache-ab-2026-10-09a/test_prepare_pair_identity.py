#!/usr/bin/env python3
from pathlib import Path
from types import SimpleNamespace
import hashlib,importlib.util,json,tempfile,unittest
from unittest import mock
import prepare_pair_identity as prepare

REFERENCE=Path(__file__).resolve().parent/'measure_replay.py'
spec=importlib.util.spec_from_file_location('test_harness',REFERENCE);harness=importlib.util.module_from_spec(spec);spec.loader.exec_module(harness)

class PrepareTests(unittest.TestCase):
    def make(self,root):
        reference=root/'reference';experiment=root/'experiment';deps=root/'dependencies';reference.mkdir();experiment.mkdir();(deps/'pkg').mkdir(parents=True)
        (experiment/'measure_replay.py').write_bytes(REFERENCE.read_bytes());(reference/'replay-manifest.json').write_text('{}');node=root/'node';node.write_text('node identity');(deps/'pkg/package.json').write_text('{"version":"1.0.0"}')
        sources={}
        for side in ('control','candidate'):
            source=root/side;source.mkdir();(source/'code.mjs').write_text(side);(source/'package-lock.json').write_text(json.dumps({'packages':{'node_modules/pkg':{'version':'1.0.0'}}}));sources[side]=source
            config={'source':harness.tree_digest(source),'source_excluded_files':[],'replay_manifest_sha256':hashlib.sha256(b'{}').hexdigest(),'role':side};(experiment/(side+'-identities.json')).write_text(json.dumps(config))
        (experiment/'experiment-plan.json').write_text(json.dumps({'harness':{'sha256':hashlib.sha256(REFERENCE.read_bytes()).hexdigest()}}))
        return SimpleNamespace(**sources,dependencies=deps,node=node,reference=reference,experiment=experiment,output=root/'result',cohort='new-paired-test')
    def case(self,name):
        with tempfile.TemporaryDirectory(prefix='atlas-pair-identities-') as tmp:
            root=Path(tmp);a=self.make(root)
            if name=='reserved':a.cohort='window-cache-ab-20261009a'
            if name=='source_changed':(a.candidate/'code.mjs').write_text('wrong')
            if name=='harness_changed':(a.experiment/'measure_replay.py').write_text('raise RuntimeError("must not execute")')
            if name=='manifest_changed':(a.reference/'replay-manifest.json').write_text('{"changed":true}')
            if name=='dependency_changed':(a.dependencies/'pkg/package.json').write_text('{"version":"2.0.0"}')
            if name=='existing_output':a.output.mkdir()
            if name=='output_symlink':a.output.symlink_to(root/'outside')
            if name=='clean':
                with mock.patch.object(prepare.subprocess,'check_output',return_value='v22.23.3\n'):prepare.prepare(a)
                self.assertEqual(json.loads((a.output/'candidate-identities.json').read_text())['cohort'],'new-paired-test')
            else:
                with self.assertRaises(ValueError):prepare.prepare(a)
                self.assertFalse((root/'outside').exists())
                if name!='existing_output':self.assertFalse(a.output.exists())
                else:self.assertEqual(list(a.output.iterdir()),[])
for name in ['clean','reserved','source_changed','harness_changed','manifest_changed','dependency_changed','existing_output','output_symlink']:
    def test(self,n=name):self.case(n)
    setattr(PrepareTests,'test_'+name,test)
if __name__=='__main__':unittest.main(verbosity=2)
