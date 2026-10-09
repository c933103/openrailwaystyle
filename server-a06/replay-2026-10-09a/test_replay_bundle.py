#!/usr/bin/env python3
"""New safe extraction tests. All mutations remain in owned temp directories."""
from pathlib import Path
import copy, gzip, hashlib, io, json, os, subprocess, sys, tarfile, tempfile, unittest, zipfile

HELPER = Path(__file__).with_name('replay_bundle.py')

def rec(name, data):
    return {'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

def zip_bytes(entries):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as z:
        for name, data in entries:
            z.writestr(name, data)
    return stream.getvalue()

def tar_bytes(entries, link=False):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as t:
        for name, data in entries:
            info = tarfile.TarInfo(name); info.size = len(data)
            if link:
                info.type = tarfile.SYMTYPE; info.linkname = '../outside'; info.size = 0
            t.addfile(info, io.BytesIO(data))
    return gzip.compress(stream.getvalue(), mtime=0)

class ReplayTests(unittest.TestCase):
    def exercise(self, case, optimized):
        with tempfile.TemporaryDirectory(prefix='atlas-replay-test-') as tmp:
            root = Path(tmp); fixture = root/'fixture'; bundle = root/'bundle'
            fixture.mkdir(); bundle.mkdir(); dest = root/'result'
            z = zip_bytes([('feeds/a.gz', b'feed')]); t = tar_bytes([('manifest.json', b'{}')])
            m = {'schema': 1, 'inputs': [rec('feeds/a.gz', b'feed')],
                 'expected': [rec('feeds/a.gz', b'feed'), rec('manifest.json', b'{}')],
                 'archives': [{**rec('a.zip', z), 'members': ['feeds/a.gz']}],
                 'reference': {**rec('ref.tar.gz', t), 'members': ['manifest.json']}}
            if case == 'archive_path': m['archives'][0]['path'] = '../outside'
            if case == 'absolute_path': m['inputs'][0]['path'] = '/outside'
            if case == 'record_traversal': m['inputs'][0]['path'] = 'feeds/../../outside'
            if case == 'duplicate_record': m['inputs'].append(copy.deepcopy(m['inputs'][0]))
            if case == 'archive_hash': m['archives'][0]['sha256'] = '0'*64
            if case == 'input_hash': m['inputs'][0]['sha256'] = '0'*64
            if case == 'input_size': m['inputs'][0]['bytes'] += 1
            if case == 'expected_hash': m['expected'][0]['sha256'] = '0'*64
            if case == 'reference_hash': m['reference']['sha256'] = '0'*64
            if case == 'reference_size': m['expected'][1]['bytes'] += 1
            if case == 'invalid_size': m['inputs'][0]['bytes'] = True
            if case == 'duplicate_declared_member': m['archives'][0]['members'] *= 2
            if case in ('zip_duplicate', 'zip_extra', 'zip_traversal'):
                extra = {'zip_duplicate':'feeds/a.gz', 'zip_extra':'extra', 'zip_traversal':'../outside'}[case]
                z = zip_bytes([('feeds/a.gz', b'feed'), (extra, b'evil')])
                m['archives'][0].update(rec('a.zip', z))
            if case in ('tar_duplicate', 'tar_extra', 'tar_traversal', 'tar_symlink'):
                if case == 'tar_symlink': t = tar_bytes([('manifest.json', b'{}')], link=True)
                else:
                    extra = {'tar_duplicate':'manifest.json','tar_extra':'extra','tar_traversal':'../outside'}[case]
                    t = tar_bytes([('manifest.json', b'{}'), (extra, b'evil')])
                m['reference'].update(rec('ref.tar.gz', t))
            if case == 'tar_expansion':
                t = gzip.compress(b'\0' * 100000, mtime=0); m['reference'].update(rec('ref.tar.gz', t))
            (fixture/'a.zip').write_bytes(z); (bundle/'ref.tar.gz').write_bytes(t)
            (bundle/'replay-manifest.json').write_text(json.dumps(m))
            if case == 'manifest_symlink':
                (bundle/'replay-manifest.json').rename(root/'original.json'); (bundle/'replay-manifest.json').symlink_to(root/'original.json')
            if case == 'archive_symlink':
                (fixture/'a.zip').rename(root/'original.zip'); (fixture/'a.zip').symlink_to(root/'original.zip')
            if case == 'destination_exists': dest.mkdir()
            if case == 'destination_symlink': dest.symlink_to(root/'not-created')
            cmd = [sys.executable] + (['-O'] if optimized else []) + [str(HELPER), '--fixtures', str(fixture), '--bundle', str(bundle), '--destination', str(dest)]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            if case == 'clean':
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((dest/'input/feeds/a.gz').read_bytes(), b'feed')
                self.assertEqual((dest/'expected/manifest.json').read_bytes(), b'{}')
            else:
                self.assertNotEqual(result.returncode, 0, case)
                self.assertFalse((root/'outside').exists())
                if case not in ('destination_exists', 'destination_symlink'):
                    self.assertFalse(dest.exists(), 'Validation wrote destination before rejecting '+case)
                elif case == 'destination_exists': self.assertEqual(list(dest.iterdir()), [])

CASES = ['clean','archive_path','absolute_path','record_traversal','duplicate_record','archive_hash','input_hash','input_size','expected_hash','reference_hash','reference_size','invalid_size','duplicate_declared_member','zip_duplicate','zip_extra','zip_traversal','tar_duplicate','tar_extra','tar_traversal','tar_symlink','tar_expansion','manifest_symlink','archive_symlink','destination_exists','destination_symlink']
for case in CASES:
    for optimized in (False, True):
        def test(self, c=case, o=optimized): self.exercise(c, o)
        setattr(ReplayTests, 'test_'+case+('_optimized' if optimized else '_normal'), test)
if __name__ == '__main__': unittest.main(verbosity=2)
