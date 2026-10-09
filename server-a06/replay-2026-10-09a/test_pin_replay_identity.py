#!/usr/bin/env python3
from pathlib import Path
from types import SimpleNamespace
import contextlib,io,json,tempfile,unittest
import measure_replay as m
import pin_replay_identity as pin

class PinTests(unittest.TestCase):
    def make(self,root):
        source=root/'source';deps=root/'dependencies';bundle=root/'bundle'
        source.mkdir();(deps/'pkg').mkdir(parents=True);bundle.mkdir();node=root/'node';node.write_text('node bytes')
        (source/'code.mjs').write_text('code');(source/'package-lock.json').write_text(json.dumps({'packages':{'node_modules/pkg':{'version':'1.0.0'}}}));(deps/'pkg/package.json').write_text('{"version":"1.0.0"}')
        (bundle/'historical-identities.json').write_text(json.dumps({'source':m.tree_digest(source),'source_excluded_files':[],'source_commit':'test-pinned-source'}));(bundle/'replay-manifest.json').write_text('{}')
        return SimpleNamespace(source=source,dependencies=deps,bundle=bundle,node=node,output=root/'identity.json',cohort='new-local-cohort')
    def run_case(self,case):
        with tempfile.TemporaryDirectory(prefix='atlas-pin-test-') as tmp:
            root=Path(tmp);a=self.make(root)
            if case=='reserved':a.cohort='replay-20261009a'
            if case=='changed_source':(a.source/'code.mjs').write_text('different')
            if case=='wrong_version':(a.dependencies/'pkg/package.json').write_text('{"version":"2.0.0"}')
            if case=='existing_output':a.output.write_text('retain')
            if case=='output_symlink':a.output.symlink_to(root/'outside')
            if case=='dependency_symlink':
                f=a.dependencies/'pkg/package.json';f.unlink();f.symlink_to(a.node)
            with contextlib.redirect_stdout(io.StringIO()):
                if case=='clean':pin.pin(a);self.assertEqual(json.loads(a.output.read_text())['cohort'],'new-local-cohort')
                else:
                    with self.assertRaises(ValueError):pin.pin(a)
                    self.assertFalse((root/'outside').exists())
                    if case=='existing_output':self.assertEqual(a.output.read_text(),'retain')
for case in ['clean','reserved','changed_source','wrong_version','existing_output','output_symlink','dependency_symlink']:
    def test(self,c=case):self.run_case(c)
    setattr(PinTests,'test_'+case,test)
if __name__=='__main__':unittest.main(verbosity=2)
