#!/usr/bin/env python3
"""Discover and compile the whole worldwide catalogue, without a city allow-list.

The default source is Transitous's publicly downloadable, overlap-cleaned GTFS.
Every catalogue entry receives an explicit outcome. A bounded shard can resume
from content hashes; no successful feed's retrieval date is advanced by a failed
download. Raw ZIPs are a cache, not site assets. No Overpass requests are made.
"""
import argparse
from collections import Counter
import datetime as dt
import gzip
import hashlib
import importlib.util
import io
import json
from functools import lru_cache
from pathlib import Path
import re
import signal
import struct
from urllib.error import HTTPError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen
import zipfile

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = 'https://raw.githubusercontent.com/public-transport/transitous/main/website/data/license.json'
PROCESSED = 'https://api.transitous.org/gtfs/'
# These data licences permit redistribution of derived data. Other entries
# remain in the inventory, with a reason; the licence is never inferred from
# the fact that a download is public. URL-only licences need an explicit rule.
LICENSES = {'CC0-1.0', 'CC-BY-1.0', 'CC-BY-2.5', 'CC-BY-3.0', 'CC-BY-4.0',
            'CC-BY-SA-4.0', 'ODbL-1.0', 'ODC-By-1.0', 'OGL-UK-3.0',
            'etalab-2.0', 'NLOD-1.0', 'MIT', 'LicenseRef-MTA-Data', 'LicenseRef-MassDOT-Developers'}
EXCLUDED = {'CN', 'RU', 'IR', 'KP'}
PROFILES = {'am': {'start': '07:00:00', 'end': '09:00:00'},
            'pm': {'start': '16:00:00', 'end': '18:00:00'},
            'offpeak': {'start': '12:00:00', 'end': '14:00:00'}}
spec = importlib.util.spec_from_file_location('gtfs_frequency', ROOT/'scripts/gtfs-frequency.py')
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    temporary.replace(path)


def source_id(row):
    name = row.get('filename', '')
    if not name.endswith('.gtfs.zip') or '/' in name or '\\' in name or '\0' in name:
        raise ValueError('Not a safe GTFS filename')
    ident = name[:-9]
    if re.fullmatch(r'[A-Za-z0-9_.-]+', ident):
        return ident
    # Non-Latin names are common (especially Japan). Keep them in metadata;
    # use a deterministic filesystem ID, never drop them from discovery.
    prefix = re.sub(r'[^A-Za-z0-9_.-]', '-', ident).strip('-')[:70]
    return prefix+'-'+hashlib.sha256(name.encode()).hexdigest()[:12]


def blocked(row):
    if row.get('country_code') in EXCLUDED:
        return 'excluded provider jurisdiction'
    for value in [row.get('source', ''), row.get('publisher', {}).get('url', '')]:
        host = (urlparse(value).hostname or '').lower()
        if any(host.endswith('.'+code.lower()) for code in EXCLUDED):
            return 'excluded provider domain'
    return None


def discover(rows, rules):
    """Stable IDs and all outcomes; rules add licences, never select cities."""
    out, seen = [], set()
    for original in rows:
        row = dict(original)
        rule = rules.get('sources', {}).get(row.get('filename'), {})
        if rule and rule.get('expected_source') == row.get('source'):
            row.update({key: value for key,value in rule.items() if key!='expected_source'})
        try:
            ident = source_id(row)
        except ValueError:
            continue  # GBFS/NeTEx are not GTFS schedule entries.
        if ident in seen:
            raise ValueError('Duplicate catalogue ID '+ident)
        seen.add(ident)
        reason = blocked(row)
        if not reason and row.get('spdx_license_identifier') not in LICENSES:
            reason = 'redistribution licence needs review'
        out.append({'id': ident, 'status': 'excluded' if reason else 'pending',
                    'reason': reason or '', 'country': row.get('country_code', ''),
                    'name': row.get('human_name', ident), 'catalogue': row,
                    'processed_url': PROCESSED+quote(row['filename'])})
    return sorted(out, key=lambda x: x['id'])


def get(url, headers=None):
    request = Request(url, headers={'User-Agent': 'RailwayAtlas-frequency/1.0 (+https://github.com/c933103/openrailwaystyle)', **(headers or {})})
    return urlopen(request, timeout=45)


class RemoteZip:
    """Read the ZIP directory and routes without downloading bus timetables.

    Servers without byte ranges fall back to one bounded full download. The
    identity validator prevents joining byte ranges from different revisions.
    ZIP64 is supported by the full-download fallback, not guessed offsets.
    """
    def __init__(self, url, max_bytes):
        self.url, self.max_bytes = url, max_bytes
        self.full, self.identity = None, None
        with get(url, {'Range': 'bytes=-65557'}) as response:
            self.identity = response.headers.get('ETag') or response.headers.get('Last-Modified')
            content_range = response.headers.get('Content-Range', '')
            if response.status != 206:
                self.full = self.read_bounded(response)
                self.size = len(self.full)
                self.directory = None
                return
            match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', content_range)
            if not match:
                raise ValueError('Invalid HTTP range')
            offset, _, self.size = map(int, match.groups())
            if self.size > max_bytes:
                raise ValueError('Feed exceeds download byte budget')
            tail = response.read(65558)
        index = tail.rfind(b'PK\x05\x06')
        if index < 0 or len(tail) < index+22:
            raise ValueError('Missing ZIP directory')
        _, disk, start_disk, _, count, length, start, comment = struct.unpack('<4s4H2IH', tail[index:index+22])
        if disk or start_disk or index+22+comment != len(tail) or count == 65535 or start == 0xffffffff:
            self.directory = None
            return
        directory = tail[start-offset:start-offset+length] if start >= offset else self.range(start, start+length-1)
        self.directory = {}
        position = 0
        for _ in range(count):
            values = struct.unpack('<4s6H3I5H2I', directory[position:position+46])
            if values[0] != b'PK\x01\x02':
                raise ValueError('Invalid ZIP directory record')
            _, _, _, flags, method, _, _, _, compressed, uncompressed, name_len, extra_len, comment_len, _, _, _, location = values
            name = directory[position+46:position+46+name_len].decode('utf-8' if flags & 2048 else 'cp437')
            self.directory[name] = (location, compressed, uncompressed)
            position += 46+name_len+extra_len+comment_len

    def read_bounded(self, response):
        if int(response.headers.get('Content-Length', '0')) > self.max_bytes:
            raise ValueError('Feed exceeds download byte budget')
        data = response.read(self.max_bytes+1)
        if len(data) > self.max_bytes:
            raise ValueError('Feed exceeds download byte budget')
        return data

    def range(self, begin, end):
        headers = {'Range': f'bytes={begin}-{end}'}
        if self.identity:
            headers['If-Range'] = self.identity
        with get(self.url, headers) as response:
            if response.status != 206:
                raise ValueError('Feed changed during range reads, or ranges unavailable')
            identity = response.headers.get('ETag') or response.headers.get('Last-Modified')
            if self.identity and identity != self.identity:
                raise ValueError('Feed changed during range reads')
            data = response.read(end-begin+2)
        if len(data) != end-begin+1:
            raise ValueError('Truncated range')
        return data

    def table(self, name):
        if self.full is not None:
            return zipfile.ZipFile(io.BytesIO(self.full)).read(name)
        if self.directory is None:
            self.download()
            return self.table(name)
        if name not in self.directory:
            raise ValueError('Missing '+name)
        start, length, expanded = self.directory[name]
        if length > 32_000_000 or expanded > 128_000_000:
            raise ValueError('Metadata table exceeds budget')
        header = self.range(start, start+29)
        fields = struct.unpack('<4s5H3I2H', header)
        if fields[0] != b'PK\x03\x04':
            raise ValueError('Invalid ZIP local header')
        flags, method, name_len, extra_len = fields[2], fields[3], fields[-2], fields[-1]
        if flags & 1:
            raise ValueError('Encrypted feed')
        data = self.range(start+30+name_len+extra_len, start+30+name_len+extra_len+length-1)
        if method == 8:
            import zlib
            data = zlib.decompress(data, -15)
        elif method != 0:
            raise ValueError('Unsupported ZIP compression')
        if len(data) != expanded:
            raise ValueError('Invalid expanded metadata')
        return data

    def download(self):
        if self.full is None:
            with get(self.url) as response:
                identity = response.headers.get('ETag') or response.headers.get('Last-Modified')
                if self.identity and identity != self.identity:
                    raise ValueError('Feed changed during full download')
                self.full = self.read_bounded(response)
        return self.full


def write_feed(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = (json.dumps(value, ensure_ascii=False, separators=(',', ':'))+'\n').encode()
    temporary = path.with_suffix('.tmp')
    temporary.write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
    temporary.replace(path)


@lru_cache(maxsize=8)
def file_hash(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as file:
        while chunk:=file.read(1_048_576):digest.update(chunk)
    return digest.hexdigest()


def compile_entry(entry, cache, output, date, graph, max_bytes, profiles, max_seconds=600):
    import csv
    ident, row = entry['id'], entry['catalogue']
    path, meta_path = cache/(ident+'.zip'), cache/(ident+'.meta.json')
    # Download with conditional revalidation. A cached successful ZIP is still
    # used only after a successful response/304, never after a failed refresh.
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    headers = {'If-None-Match': meta['etag']} if meta.get('etag') else {}
    fresh = False
    if path.exists() and headers:
        try:
            with get(entry['processed_url'], headers) as response:
                data = RemoteZip.read_bounded(type('Budget', (), {'max_bytes': max_bytes})(), response)
                path.write_bytes(data)
                meta = {'etag': response.headers.get('ETag'), 'retrieved': dt.datetime.now(dt.timezone.utc).date().isoformat()}
                fresh = True
        except HTTPError as error:
            if error.code != 304:
                raise
            fresh = True  # content remains the exact successful revision.
    if not fresh:
        remote = RemoteZip(entry['processed_url'], max_bytes)
        rail = [r for r in csv.DictReader(io.StringIO(remote.table('routes.txt').decode('utf-8-sig'))) if compiler.rail_type(r['route_type'])]
        if not rail:
            return {**entry, 'status': 'no_rail', 'rail_routes': 0}
        path.write_bytes(remote.download())
        meta = {'etag': remote.identity, 'retrieved': dt.datetime.now(dt.timezone.utc).date().isoformat()}
    meta['checked'] = dt.datetime.now(dt.timezone.utc).date().isoformat()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    atomic_json(meta_path, meta)
    signature=hashlib.sha256(json.dumps({'catalogue':row,'profiles':profiles,
        'graph':file_hash(str(graph)) if graph else None,
        'compiler':[file_hash(str(ROOT/'scripts'/name)) for name in ['gtfs-frequency.py','gtfs-shapes.py','gtfs-rail-paths.py']]},sort_keys=True).encode()).hexdigest()
    destination = output/'feeds'/(ident+'.json.gz')
    if destination.exists():
        with gzip.open(destination, 'rt') as file:
            previous = json.load(file)
        if previous['source']['sha256'] == digest and previous['source']['service_date'] == date and previous['source'].get('input_signature') == signature:
            previous['source']['checked'] = meta['checked']
            write_feed(destination, previous)
            return {**entry, 'status': 'compiled', 'output': 'feeds/'+destination.name, 'sha256': digest,
                    'rail_routes': len(previous['routes']), 'mapped_segments': len(previous['segments']),
                    'unmapped_segments': len(previous.get('unmapped_segments', [])), 'source': previous['source']}
    config = {'source': {'id': ident, 'name': entry['name'], 'url': row['source'],
               'processed_url': entry['processed_url'], 'catalogue_url': CATALOGUE,
               'license': row['spdx_license_identifier'],
               'terms_url': row.get('license_url') or f"https://spdx.org/licenses/{row['spdx_license_identifier']}.html",
               'attribution': row.get('attribution_text') or row.get('publisher', {}).get('name') or entry['name'],
               'catalogue_attribution': row, 'retrieved': meta['retrieved'], 'checked': meta['checked'],
               'rail_graph_sha256': file_hash(str(graph)) if graph else None,
               'country': entry['country'], 'region': row.get('country_name', entry['country']),
               'review_after_days': 30, 'compiler_version': 2, 'input_signature': signature,
               'note': 'Configured AM/PM/daytime windows in each agency timezone. Scheduled service, not live departures.'},
              'profiles': profiles, 'canonical_routes': True, 'include_unmapped': True,
              'rail_graph': str(graph) if graph else None, 'exclude_platform_codes': ['R-Bus']}
    def timeout(*_):
        raise TimeoutError('Feed exceeded compilation time budget')
    previous_handler = signal.signal(signal.SIGALRM, timeout)
    signal.alarm(max_seconds)
    try:
        result = compiler.compile_feed(path, config, date, geometry=True)
    finally:
        signal.alarm(0); signal.signal(signal.SIGALRM, previous_handler)
    source = result['source']
    source['attribution'] = '; '.join(dict.fromkeys([source['attribution']]+[a['agency_name'] for a in result['agencies']]+[a.get('organization_name','') for a in source['feed_attributions']]))
    write_feed(destination, result)
    return {**entry, 'status': 'compiled', 'output': 'feeds/'+destination.name, 'sha256': digest,
            'rail_routes': len(result['routes']), 'mapped_segments': len(result['segments']),
            'unmapped_segments': len(result.get('unmapped_segments', [])), 'source': source}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalogue', help='Local catalogue for offline reproduction; default downloads worldwide registry')
    parser.add_argument('--rules', type=Path, default=ROOT/'styles/data-src/frequency-source-rules.json')
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--date', required=True, help='Explicit reference date, not the machine clock')
    parser.add_argument('--rail-graph', type=Path, help='Published OSM branch/metro GeoJSON NDJSON.gz; never fetched here')
    parser.add_argument('--shard', type=int, default=0)
    parser.add_argument('--shards', type=int, default=1)
    parser.add_argument('--max-feed-bytes', type=int, default=600_000_000)
    parser.add_argument('--max-compile-seconds', type=int, default=600)
    parser.add_argument('--inventory-only', action='store_true')
    args = parser.parse_args()
    if not 0 <= args.shard < args.shards or args.max_feed_bytes <= 0 or args.max_compile_seconds <= 0:
        parser.error('Invalid shard or byte budget')
    dt.date.fromisoformat(args.date)
    args.cache.mkdir(parents=True, exist_ok=True)
    data = Path(args.catalogue).read_bytes() if args.catalogue else get(CATALOGUE).read()
    catalogue_hash = hashlib.sha256(data).hexdigest()
    rules = json.loads(args.rules.read_text())
    entries = discover(json.loads(data), rules)
    previous_path = args.output/f'inventory-{args.shard}.json'
    outcomes = []
    def save():
        atomic_json(previous_path, {'schema': 2, 'catalogue_url': CATALOGUE, 'catalogue_sha256': catalogue_hash,
            'catalogue_entries': len(entries), 'service_date': args.date, 'shard': args.shard, 'shards': args.shards,
            'scope': 'Every GTFS feed in the worldwide catalogue; no city allow-list',
            'counts': dict(Counter(x['status'] for x in outcomes)), 'entries': outcomes})
    for entry in entries:
        if int(hashlib.sha256(entry['id'].encode()).hexdigest(), 16) % args.shards != args.shard:
            continue
        if entry['status'] == 'pending' and not args.inventory_only:
            try:
                entry = compile_entry(entry, args.cache, args.output, args.date, args.rail_graph, args.max_feed_bytes, rules.get('profiles', PROFILES), args.max_compile_seconds)
            except Exception as error:
                entry = {**entry, 'status': 'failed', 'reason': f'{type(error).__name__}: {error}'}
        outcomes.append(entry)
        save()  # durable after every feed, even if a job times out later.
        print(entry['id'], entry['status'], entry.get('rail_routes', ''), entry.get('mapped_segments', ''), entry.get('reason', ''), flush=True)
    print(json.dumps({'catalogue_entries': len(entries), 'shard_outcomes': len(outcomes), 'counts': dict(Counter(x['status'] for x in outcomes))}), flush=True)


if __name__ == '__main__':
    main()
