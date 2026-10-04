import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

class SnapshotRepository(unittest.TestCase):
    def load(self,environment):
        spec=importlib.util.spec_from_file_location('snapshot_loader',Path(__file__).parent.parent/'scripts/load-frequency-snapshot.py')
        module=importlib.util.module_from_spec(spec)
        with patch.dict(os.environ,environment,clear=True):spec.loader.exec_module(module)
        return module
    def test_fork_release_and_asset_use_same_repository(self):
        loader=self.load({'GITHUB_REPOSITORY':'another-owner/atlas-fork'})
        self.assertIn('/another-owner/atlas-fork/releases/download/',loader.URL)
        self.assertIn('/repos/another-owner/atlas-fork/releases/tags/',loader.RELEASE_URL)
    def test_local_default_and_invalid_repository(self):
        self.assertIn('/c933103/openrailwaystyle/',self.load({}).URL)
        with self.assertRaises(ValueError):self.load({'GITHUB_REPOSITORY':'../other/repository'})
if __name__=='__main__':unittest.main()
