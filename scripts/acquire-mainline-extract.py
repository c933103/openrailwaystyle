#!/usr/bin/env python3
"""Maintenance-only, bounded Geofabrik PBF acquisition. No map tile requests."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.request
import gzip

REGIONS = ('africa', 'antarctica', 'asia', 'australia-oceania', 'central-america',
           'europe', 'north-america', 'south-america')
MAX_PBF_BYTES = 48 * 1024**3
MAX_EXPORT_BYTES = 4 * 1024**3
UA = 'RailwayAtlas-reference/1 (+https://github.com/c933103/openrailwaystyle/issues/181)'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('Unexpected acquisition redirect; retained source must be explicit')


def source_url(region, date):
    if region not in REGIONS or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
        raise ValueError('Invalid dated continent source')
    day = dt.date.fromisoformat(date)
    if day > dt.datetime.now(dt.timezone.utc).date():
        raise ValueError('Future source date')
    return f'https://download.geofabrik.de/{region}-{day:%y%m%d}.osm.pbf'


def acquire(region, date, output):
    output.mkdir(parents=True, exist_ok=True)
    url = source_url(region, date)
    opener = urllib.request.build_opener(NoRedirect)
    def request(url, method='GET'):
        return opener.open(urllib.request.Request(url, method=method, headers={'User-Agent': UA}), timeout=90)
    with request(url, 'HEAD') as response:
        size = int(response.headers.get('Content-Length', 0))
        if not 0 < size <= MAX_PBF_BYTES:
            raise ValueError('Unbounded or oversized PBF Content-Length')
    if shutil.disk_usage(output).free < size + 4 * 1024**3:
        raise ValueError('Insufficient disk for bounded extract; do not publish partial data')
    with request(url + '.md5') as response:
        checksum_text = response.read(4097).decode('ascii')
    if len(checksum_text) > 4096 or not re.match(r'^[0-9a-fA-F]{32}\s', checksum_text):
        raise ValueError('Invalid source checksum')
    expected = checksum_text[:32].lower()
    partial = output / 'source.osm.pbf.part'
    pbf = output / 'source.osm.pbf'
    sha, md5 = hashlib.sha256(), hashlib.md5(usedforsecurity=False)
    started = time.monotonic()
    received = 0
    try:
        with request(url) as response, partial.open('wb') as stream:
            if int(response.headers.get('Content-Length', 0)) != size:
                raise ValueError('Source size changed after planning')
            while chunk := response.read(1024 * 1024):
                received += len(chunk)
                if received > size or time.monotonic() - started > 5400:
                    raise ValueError('Download exceeded byte or time budget')
                stream.write(chunk)
                sha.update(chunk)
                md5.update(chunk)
        if received != size or md5.hexdigest() != expected:
            raise ValueError('Truncated or changed continent PBF')
        partial.replace(pbf)
    finally:
        partial.unlink(missing_ok=True)
    download_seconds = time.monotonic() - started
    source_timestamp = subprocess.check_output(
        ['osmium', 'fileinfo', '-g', 'header.option.osmosis_replication_timestamp', str(pbf)], text=True).strip()
    stamp = dt.datetime.fromisoformat(source_timestamp.replace('Z', '+00:00'))
    if stamp.tzinfo is None or abs((stamp.date() - dt.date.fromisoformat(date)).days) > 1:
        raise ValueError('Unexpected or missing OSM source age')
    filtered = output / 'rail.osm.pbf'
    processing = time.monotonic()
    subprocess.run(['osmium', 'tags-filter', str(pbf), 'w/railway=rail,narrow_gauge',
                    '-o', str(filtered), '--overwrite'], check=True, timeout=5400)
    pbf.unlink()
    subprocess.run(['osmium', 'check-refs', str(filtered)], check=True, timeout=600)
    exported = output / 'ways.geojsonseq.gz'
    command = ['osmium', 'export', str(filtered), '--geometry-types=linestring',
               '--attributes=type,id,version,timestamp,way_nodes', '--stop-on-error',
               '-f', 'geojsonseq', '-x', 'print_record_separator=false']
    child = subprocess.Popen(command, stdout=subprocess.PIPE)
    total = 0
    try:
        with gzip.open(exported, 'wb', compresslevel=6) as destination:
            while chunk := child.stdout.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_EXPORT_BYTES or time.monotonic() - processing > 7200:
                    raise ValueError('OSM export exceeded budget')
                destination.write(chunk)
        if child.wait(timeout=60) != 0:
            raise ValueError('Incomplete source geometry export')
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
    export_sha = hashlib.sha256()
    with exported.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            export_sha.update(chunk)
    manifest = dict(schema=1, complete=True, region=region, date=date, url=url,
                    sourceTimestamp=source_timestamp, pbfBytes=size, pbfSha256=sha.hexdigest(),
                    sourceMd5=expected, filteredBytes=filtered.stat().st_size,
                    exportBytes=exported.stat().st_size, exportSha256=export_sha.hexdigest(),
                    downloadSeconds=download_seconds, processSeconds=time.monotonic()-processing,
                    source='OpenStreetMap via Geofabrik', license='ODbL-1.0')
    filtered.unlink()
    (output / 'source.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('region', choices=REGIONS)
    parser.add_argument('date')
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    acquire(args.region, args.date, args.output)
