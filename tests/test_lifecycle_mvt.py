import gzip
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

scripts = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(scripts))
from lifecycle_mvt import normalize

spec = importlib.util.spec_from_file_location('unpack_snapshot', scripts / 'unpack-snapshot.py')
unpack_snapshot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(unpack_snapshot)


def vint(n):
    out = bytearray()
    while n > 127:
        out.append(128 | (n & 127))
        n >>= 7
    return bytes(out) + bytes([n])


def field(number, value):
    if isinstance(value, int):
        return vint(number * 8) + vint(value)
    return vint(number * 8 + 2) + vint(len(value)) + value


def tile(version=1, extent=4096, name=b'lifecycle', kind=2, geom=b'\x09\x02\x01\x0a\x08\x00'):
    feature = field(1, (1 << 53) + 1) + field(2, b'\x00\x00') + field(3, kind) + field(4, geom)
    # Include UTF-8 text, ID, tags, and integer geometry so a byte-comparison
    # catches any lossy decoding/re-encoding, not just feature counts.
    layer = field(15, version) + field(1, name) + field(2, feature) + field(3, b'name')
    layer += field(4, field(1, '남부내륙선'.encode())) + field(5, extent)
    return field(3, layer)


class LifecycleMvtTest(unittest.TestCase):
    def test_exact_wire_change_and_stable_output(self):
        raw = tile()
        packed = gzip.compress(raw, mtime=123)
        output, changed = normalize(packed)
        self.assertEqual(changed, (1, 0, 0, 0, 0))
        self.assertEqual(output, normalize(raw)[0])
        self.assertEqual(gzip.decompress(output), tile(version=2))
        self.assertEqual(sum(a != b for a, b in zip(raw, gzip.decompress(output), strict=True)), 1)
        self.assertEqual(normalize(output), (output, (0, 0, 0, 0, 0)))

    def test_current_compressed_bytes_are_preserved(self):
        packed = gzip.compress(tile(version=2), compresslevel=3, mtime=123)
        self.assertEqual(normalize(packed), (packed, (0, 0, 0, 0, 0)))

    def test_unexpected_or_malformed_tiles(self):
        for raw in (b'', tile()[:-1], tile() * 2, tile(version=3), tile(extent=2048),
                    tile(name=b'rail'), tile(kind=3), tile(kind=1), tile(geom=b''),
                    tile(version=2, geom=b'\x09\x02\x01\x0a\x00\x00'),
                    tile(geom=b'\x09\x02\x01\x0a\x08\x00\x0f')):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                normalize(raw)

    def test_legacy_multipart_recomputes_cursor(self):
        # (1,0)->(3,0), degenerate path at (8,0), then (2,0)->(2,2).
        # Also drop repeated interior and terminal vertices on real paths.
        g = bytes([9,2,0,18,0,0,4,0, 9,10,0,10,0,0, 9,11,0,18,0,4,0,0])
        clean = bytes([9,2,0,10,4,0, 9,1,0,10,0,4])
        packed, counts = normalize(tile(geom=g))
        self.assertEqual(counts, (1, 3, 1, 0, 0))
        self.assertEqual(gzip.decompress(packed), tile(version=2, geom=clean))

    def test_wholly_degenerate_feature_preserves_layer_metadata(self):
        packed, counts = normalize(tile(geom=bytes([9,2,0,10,0,0])))
        self.assertEqual(counts, (1, 1, 1, 1, 0))
        expected = field(3, field(15, 2) + field(1, b'lifecycle') + field(3, b'name')
                         + field(4, field(1, '남부내륙선'.encode())) + field(5, 4096))
        self.assertEqual(gzip.decompress(packed), expected)
        self.assertEqual(normalize(packed), (packed, (0, 0, 0, 0, 0)))

    def test_move_only_matches_writer_and_preserves_cursor(self):
        # Prior singleton at x=8, ordinary line x=2..3, terminal singleton x=4.
        raw = bytes([9,16,0, 9,11,0,10,2,0, 9,2,0])
        packed, counts = normalize(tile(geom=raw))
        self.assertEqual(counts, (1, 0, 2, 0, 2))
        self.assertEqual(gzip.decompress(packed), tile(version=2, geom=bytes([9,4,0,10,2,0])))
        with self.assertRaisesRegex(ValueError, 'varint'):
            normalize(tile(geom=raw[:-1]))
        with self.assertRaisesRegex(ValueError, 'expected nonempty'):
            normalize(tile(geom=bytes([9,4,0,18,2,0])))
        with self.assertRaisesRegex(ValueError, 'missing line LineTo'):
            normalize(tile(version=2, geom=bytes([9,4,0])))

    def test_unpacked_index_and_source_manifest(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'lifecycle'
            manifest = target.parent / 'manifest.json'
            content = b'{"built":"2026-11-10T13:21:11.250Z","parts":[{"timestamp":"2026-09-22T08:45:51Z"}]}'
            manifest.write_bytes(content)
            current = gzip.compress(tile(version=2), mtime=123)
            rows = [((5, 13, 6), tile()), ((7, 109, 50), current)]
            unpack_snapshot.unpack_tiles(rows, target)
            self.assertEqual(json.loads((target / 'index.json').read_bytes()), {'tiles': ['5/13/6', '7/109/50']})
            self.assertEqual(manifest.read_bytes(), content)
            self.assertEqual(gzip.decompress((target / '5/13/6.pbf.gz').read_bytes()), tile(version=2))
            self.assertEqual((target / '7/109/50.pbf.gz').read_bytes(), current)


if __name__ == '__main__':
    unittest.main()
