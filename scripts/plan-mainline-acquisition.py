"""Fail the complete cost plan before any continental PBF body is requested."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import urllib.request

spec = importlib.util.spec_from_file_location('mainline_acquire', Path(__file__).with_name('acquire-mainline-extract.py'))
acquire = importlib.util.module_from_spec(spec)
spec.loader.exec_module(acquire)


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
        sources.append(dict(region=region, url=url, pbfBytes=size))
    if sum(s['pbfBytes'] for s in sources) > 144 * 1024**3:
        raise ValueError('Worldwide download budget exceeded before acquisition')
    return dict(date=date, sources=sources, pbfBytes=sum(s['pbfBytes'] for s in sources),
                preflightRequests=len(sources), maximumConcurrentDownloads=2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('date')
    args = parser.parse_args()
    result = plan(args.date)
    print(json.dumps(result))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('sizes=' + json.dumps({s['region']: s['pbfBytes'] for s in result['sources']}) + '\n')
