"""Publish ordinary compressed vector tiles; Pages archive ranges are unreliable."""
import json, sys, gzip
from pathlib import Path
from pmtiles.reader import all_tiles, MmapSource

archive = Path(sys.argv[1])
target = Path('styles/data/lifecycle')
keys = []
total = 0
with archive.open('rb') as source:
    for (z, x, y), data in all_tiles(MmapSource(source)):
        key = f'{z}/{x}/{y}'
        path = target / f'{key}.pbf.gz'
        path.parent.mkdir(parents=True, exist_ok=True)
        if data[:2] != b'\x1f\x8b':
            data = gzip.compress(data, mtime=0)
        path.write_bytes(data)
        total += len(data)
        keys.append(key)
assert '7/109/50' in keys, 'Korean regression tile missing'
(target / 'index.json').write_text(json.dumps({'tiles': keys}, separators=(',', ':')))
print(f'Published {len(keys)} static lifecycle tiles, {total} compressed bytes')
