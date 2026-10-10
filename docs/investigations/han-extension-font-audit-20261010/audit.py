#!/usr/bin/python3
"""Read-only audit of Atlas packaged fonts and optional deployed font hashes.

Usage: python3 audit.py --archive railway-world-site.zip --source checkout [--live]
Requires already installed fontTools and Brotli. No project or service writes.
The caller may redirect JSON stdout to preserve results.
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import io
import json
from pathlib import Path
import urllib.request
import zipfile

from fontTools.ttLib import TTFont

BASE = 'https://c933103.github.io/openrailwaystyle/'
MAIN = '74bc7efa89526c5cbd310b55f3d499fd8f3cc7f3'
RANGES = {'H': (0x31350, 0x323AF), 'I': (0x2EBF0, 0x2EE5D), 'J': (0x323B0, 0x33479)}

def inspect(data, outlines=False):
    font = TTFont(io.BytesIO(data))
    cmap = font.getBestCmap()
    features = {tag: [r.FeatureTag for r in font[tag].table.FeatureList.FeatureRecord]
                if font[tag].table.FeatureList else []
                for tag in ['GSUB', 'GPOS'] if tag in font}
    result = {
        'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
        'cmapFormats': [t.format for t in font['cmap'].tables],
        'uvsEntries': sum(sum(len(v) for v in t.uvsDict.values())
                          for t in font['cmap'].tables if t.format == 14),
        'layoutFeatures': features,
        'fontNames': {str(n.nameID): n.toUnicode() for n in font['name'].names
                      if n.nameID in [1, 2, 4, 5, 6]},
        'mappedScalars': len(cmap),
    }
    if outlines:
        result['emptyMappedOutlines'] = [f'U+{c:X}' for c, g in cmap.items()
                                         if font['glyf'][g].numberOfContours == 0]
    return result, set(cmap)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--live', action='store_true')
    args = parser.parse_args()
    result = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'mainCommitVerifiedViaGitHub': MAIN,
              'archive': {'bytes': args.archive.stat().st_size,
                          'sha256': hashlib.sha256(args.archive.read_bytes()).hexdigest(),
                          'artifactId': 11672435802, 'runId': 38058389835,
                          'testedSiteCommit': 'a38098c1d459238f62bc113c7d5845e38b07cf79'},
              'ranges': {}, 'packaged': {}, 'rareSlices': {}}
    selected_blocks = set(b for a, z in RANGES.values() for b in range(a >> 8, (z >> 8) + 1))
    expected_live = {}
    with zipfile.ZipFile(args.archive) as archive:
        index_data = archive.read('fonts/rare-han-v1/index.json')
        result['rareIndex'] = json.loads(index_data)
        expected_live['fonts/rare-han-v1/index.json'] = hashlib.sha256(index_data).hexdigest()
        all_chars = set()
        for path in archive.namelist():
            if not path.startswith('fonts/rare-han-v1/') or not path.endswith('.woff2'):
                continue
            data = archive.read(path)
            block = int(Path(path).stem, 16)
            info, chars = inspect(data, outlines=block in selected_blocks)
            result['rareSlices'][path] = info
            all_chars.update(chars)
            if block in selected_blocks:
                expected_live[path] = info['sha256']
        for name, (a, b) in RANGES.items():
            requested = set(range(a, b + 1))
            result['ranges'][name] = {
                'first': f'U+{a:X}', 'lastAssigned': f'U+{b:X}',
                'assignedScalarCount': len(requested),
                'mappedScalarCount': len(requested & all_chars),
                'missing': [f'U+{c:X}' for c in sorted(requested - all_chars)],
            }
    for region in ['sc', 'tc']:
        path = args.source / f'styles/fonts/atlas-cjk-{region}-v1.woff2'
        data = path.read_bytes()
        info, chars = inspect(data)
        info['gitBlobSha'] = hashlib.sha1(f'blob {len(data)}\0'.encode() + data).hexdigest()
        info['coverage'] = {k: sum(a <= c <= b for c in chars) for k, (a, b) in RANGES.items()}
        result['packaged'][region] = info
    result['liveExpectedHashes'] = expected_live
    if args.live:
        def fetch(path):
            try:
                with urllib.request.urlopen(BASE + path, timeout=45) as response:
                    data = response.read()
                    digest = hashlib.sha256(data).hexdigest()
                    return {'path': path, 'status': response.status, 'bytes': len(data),
                            'sha256': digest, 'matchesCI': digest == expected_live[path]}
            except Exception as error:
                return {'path': path, 'error': str(error)}
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            result['live'] = list(pool.map(fetch, expected_live))
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
