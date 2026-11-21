"""Publish ordinary compressed vector tiles; Pages archive ranges are unreliable."""
import json
import sys
from hashlib import file_digest
from pathlib import Path

from lifecycle_mvt import normalize


def unpack_tiles(tiles, target):
    keys = []
    total = upgraded = 0
    for (z, x, y), data in tiles:
        key = f'{z}/{x}/{y}'
        try:
            data, changed = normalize(data)
        except (ValueError, OSError, EOFError) as error:
            raise ValueError(f'Invalid lifecycle tile {key}: {error}') from error
        path = target / f'{key}.pbf.gz'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        total += len(data)
        upgraded += changed
        keys.append(key)
    if '7/109/50' not in keys:
        raise ValueError('Korean regression tile missing')
    (target / 'index.json').write_text(json.dumps({'tiles': keys}, separators=(',', ':')))
    print(f'Published {len(keys)} static lifecycle tiles, {total} compressed bytes; upgraded {upgraded} to MVT v2')


if __name__ == '__main__':
    from pmtiles.reader import all_tiles, MmapSource

    with Path(sys.argv[1]).open('rb') as source:
        print(f'Lifecycle input archive SHA-256: {file_digest(source, "sha256").hexdigest()}')
        source.seek(0)
        unpack_tiles(all_tiles(MmapSource(source)), Path('styles/data/lifecycle'))
