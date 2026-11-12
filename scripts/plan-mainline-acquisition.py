"""Fail the complete cost plan before any continental PBF body is requested."""
import argparse
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import urllib.request

spec = importlib.util.spec_from_file_location('mainline_acquire', Path(__file__).with_name('acquire-mainline-extract.py'))
acquire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acquire)


def validate_checkpoint(root, region, date, size, md5):
    """A cached export must belong to the exact current, dated provider body."""
    try:
        source = json.loads((root / 'source.json').read_text())
        export = root / 'ways.geojsonseq.gz'
        if not (source.get('complete') is True and source.get('region') == region
                and source.get('date') == date and source.get('pbfBytes') == size
                and source.get('sourceMd5') == md5 and export.is_file()
                and 0 < export.stat().st_size <= 1024**3
                and export.stat().st_size == source.get('exportBytes')):
            return False
        with export.open('rb') as stream:
            return hashlib.file_digest(stream, 'sha256').hexdigest() == source.get('exportSha256')
    except (OSError, ValueError, TypeError):
        return False


def plan(date):
    opener = urllib.request.build_opener(acquire.NoRedirect)
    sources = []
    for region in acquire.REGIONS:
        url = acquire.source_url(region, date)
        request = urllib.request.Request(url, method='HEAD', headers={'User-Agent': acquire.UA})
        with opener.open(request, timeout=90) as response:
            size = int(response.headers.get('Content-Length', 0))
        if not 0 < size <= acquire.MAX_PBF_BYTES:
            raise ValueError('Unbounded or oversized continent PBF')
        request = urllib.request.Request(url + '.md5', headers={'User-Agent': acquire.UA})
        with opener.open(request, timeout=90) as response:
            checksum_text = response.read(4097).decode('ascii')
        if len(checksum_text) > 4096 or not re.match(r'^[0-9a-fA-F]{32}\s', checksum_text):
            raise ValueError('Invalid dated source checksum')
        sources.append(dict(region=region, url=url, pbfBytes=size, sourceMd5=checksum_text[:32].lower()))
    if sum(s['pbfBytes'] for s in sources) > 144 * 1024**3:
        raise ValueError('Worldwide download budget exceeded before acquisition')
    return dict(date=date, sources=sources, pbfBytes=sum(s['pbfBytes'] for s in sources),
                preflightRequests=2*len(sources), maximumConcurrentDownloads=2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('date')
    args = parser.parse_args()
    result = plan(args.date)
    print(json.dumps(result))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('sizes=' + json.dumps({s['region']: s['pbfBytes'] for s in result['sources']}) + '\n')
            output.write('checksums=' + json.dumps({s['region']: s['sourceMd5'] for s in result['sources']}) + '\n')
