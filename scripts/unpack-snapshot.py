"""Publish ordinary compressed vector tiles; Pages archive ranges are unreliable."""
import json
import sys
from hashlib import file_digest
from pathlib import Path

from lifecycle_mvt import normalize


def unpack_tiles(tiles, target):
    keys = []
    total = upgraded = segments = paths = features = affected = singleton_paths = failure_count = 0
    failures = {}
    sampled_keys = set()
    for (z, x, y), data in tiles:
        key = f'{z}/{x}/{y}'
        def sample(payload):
            if key not in sampled_keys and (len(sampled_keys) < 3 or key == '5/17/11'):
                sampled_keys.add(key)
                encoded = payload.hex() if len(payload) <= 128 else payload[:64].hex() + '...' + payload[-64:].hex()
                print(f'Legacy MoveTo-only path at {key}: length={len(payload)} geometry={encoded}')
        try:
            data, (changed, dropped_segments, dropped_paths, dropped_features, move_only) = normalize(data, sample)
        except (ValueError, OSError, EOFError) as error:
            reason = str(error).split('; geometry', 1)[0]
            count, samples = failures.setdefault(reason, [0, []])
            failures[reason][0] = count + 1
            failure_count += 1
            if len(samples) < 3:
                samples.append(f'{key}: {error}')
            continue
        path = target / f'{key}.pbf.gz'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        total += len(data)
        upgraded += changed
        affected += bool(dropped_segments or dropped_paths)
        singleton_paths += move_only
        segments += dropped_segments
        paths += dropped_paths
        features += dropped_features
        keys.append(key)
    print(f'Legacy geometry cleanup: {affected} tiles, {segments} zero-length segments, '
          f'{paths} zero-length paths ({singleton_paths} MoveTo-only), {features} all-degenerate features omitted')
    if failure_count:
        for reason, (count, samples) in sorted(failures.items()):
            print(f'Lifecycle validation rejected {count} tiles ({reason}); examples: {samples}', flush=True)
        raise ValueError(f'{failure_count} lifecycle tiles failed validation; no index published')
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
