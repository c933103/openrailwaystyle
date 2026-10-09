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
from email.utils import parsedate_to_datetime
import gzip
import hashlib
import importlib.util
import io
import http.client
import ipaddress
import json
from functools import lru_cache
from pathlib import Path
import re
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, quote, unquote, urlencode, urljoin, urlparse, urlunparse
from urllib.request import Request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = 'https://raw.githubusercontent.com/public-transport/transitous/main/website/data/license.json'
PROCESSED = 'https://api.transitous.org/gtfs/'
# SPDX licence labels are provenance, not a gate for normal end-user timetable analysis.
EXCLUDED = {'CN', 'RU', 'IR', 'KP'}
PROFILES = json.loads((ROOT/'styles/data-src/frequency-source-rules.json').read_text())['profiles']
spec = importlib.util.spec_from_file_location('gtfs_frequency', ROOT/'scripts/gtfs-frequency.py')
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)
catalogue_spec = importlib.util.spec_from_file_location('frequency_catalogue', ROOT/'scripts/frequency_catalogue.py')
registry = importlib.util.module_from_spec(catalogue_spec)
catalogue_spec.loader.exec_module(registry)


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
    publisher = row.get('publisher') or {}
    for value in [row.get('source') or '', publisher.get('url', '') if isinstance(publisher, dict) else '']:
        try:
            host = (urlparse(value).hostname or '').encode('idna').decode('ascii').rstrip('.').lower()
        except (ValueError, UnicodeError):
            continue
        if any(host == code.lower() or host.endswith('.'+code.lower()) for code in EXCLUDED):
            return 'excluded provider domain'
    return None


def discover(rows, rules):
    """Inventory each normalized feed; unknown catalogue rights are not denials."""
    out, seen = [], set()
    # Rules belong to the trusted local configuration, never catalogue lineage.
    # Index by exact source URL so a reconciled alias cannot evade its review.
    denied_sources = set()
    reviewed_denials = {}
    for rule in rules.get('sources', {}).values():
        evidence = registry.licence_evidence(rule, 'source-specific-reviewed-rule',
                                             'styles/data-src/frequency-source-rules.json')
        if (rule.get('expected_source') and evidence
                and registry.usage_rights({'rights_evidence': [evidence]})['prohibitions']):
            denied_sources.add(rule['expected_source'])
            reviewed_denials.setdefault(acquisition_url_key(rule['expected_source']), []).append(evidence)
    denied_sources = sorted(denied_sources)
    for original in rows:
        row = dict(original)
        rule = rules.get('sources', {}).get(row.get('filename'), {})
        if rule and rule.get('expected_source') == row.get('source'):
            row.update({key: value for key, value in rule.items() if key != 'expected_source'})
            evidence = registry.licence_evidence(rule, 'source-specific-reviewed-rule',
                                                  'styles/data-src/frequency-source-rules.json')
            if evidence:
                row['rights_evidence'] = list(row.get('rights_evidence') or []) + [evidence]
        # The same source may have another catalogue filename. A known ban on
        # that primary source also covers its processed copy, not just the
        # direct endpoint removed from the fallback candidate list.
        if isinstance(row.get('source'), str):
            for evidence in reviewed_denials.get(acquisition_url_key(row['source']), []):
                if evidence not in (row.get('rights_evidence') or []):
                    row['rights_evidence'] = list(row.get('rights_evidence') or []) + [evidence]
        try:
            ident = source_id(row)
        except ValueError:
            continue  # GBFS/NeTEx are not GTFS schedule entries.
        if ident in seen:
            raise ValueError('Duplicate catalogue ID '+ident)
        seen.add(ident)
        rights = registry.usage_rights(row)
        policy_reason = blocked(row)
        if policy_reason:
            status, reason, reason_code = 'excluded', policy_reason, 'provider_policy'
        elif rights['prohibitions']:
            status, reason_code = 'excluded', 'source_terms_prohibit_derived_use'
            reason = '; '.join(item['basis'] for item in rights['prohibitions'])
        elif row.get('delivery') == 'direct' and not row.get('source'):
            status, reason, reason_code = 'retry_pending', 'Original GTFS URL unresolved', 'missing_source_url'
        else:
            status, reason, reason_code = 'pending', '', ''
        out.append({'id': ident, 'status': status, 'reason': reason,
                    'reason_code': reason_code, 'retry_eligible': status == 'retry_pending',
                    'failure_stage': 'discovery' if reason_code == 'missing_source_url' else '',
                    'terms': rights, 'denied_source_urls': denied_sources,
                    'country': row.get('country_code', ''),
                    'name': row.get('human_name', ident), 'catalogue': row,
                    'processed_url': (row.get('source', '') if row.get('delivery') == 'direct'
                                      else PROCESSED+quote(row['filename']))})
    return sorted(out, key=lambda x: x['id'])


RETRYABLE_HTTP = {408, 425, 429, 500, 502, 503, 504}


def retry_after_delay(value, now=None):
    """Decode either HTTP Retry-After form; malformed values use normal backoff."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    if re.fullmatch(r'[0-9]+', value):
        return int(value)
    try:
        deadline = parsedate_to_datetime(value)
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=dt.timezone.utc)
        return max(0.0, deadline.timestamp() - (time.time() if now is None else now))
    except (TypeError, ValueError, OverflowError):
        return None


class UnsafeSourceURL(ValueError):
    """An acquisition target does not meet the public HTTP(S) boundary."""


class SourcePolicyError(ValueError):
    """A particular endpoint is prohibited by an existing source rule."""


def source_policy(entry, url):
    if blocked({'source': url}):
        raise SourcePolicyError('excluded provider domain')
    key = acquisition_url_key(url)
    if any(key == acquisition_url_key(denied) for denied in entry.get('denied_source_urls', [])):
        raise SourcePolicyError('source terms explicitly forbid end-user timetable-frequency use')


def parse_acquisition_url(url):
    """Reject ambiguous authorities before DNS, connection or redirect handling."""
    if not isinstance(url, str) or any(ord(c) < 33 or ord(c) == 127 for c in url) or '\\' in url:
        raise UnsafeSourceURL('Invalid acquisition URL')
    try:
        parsed = urlparse(url)
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or '%' in parsed.hostname):
            raise ValueError()
        host = parsed.hostname.encode('idna').decode('ascii').rstrip('.').lower()
        port = parsed.port if parsed.port is not None else (443 if parsed.scheme == 'https' else 80)
        if not host or not 1 <= port <= 65535 or parsed.netloc.endswith(':'):
            raise ValueError()
    except (ValueError, UnicodeError):
        raise UnsafeSourceURL('Expected a public HTTP(S) URL without credentials') from None
    if blocked({'source': url}):
        raise SourcePolicyError('excluded provider domain')
    return parsed, host, port


def acquisition_url_key(url):
    """Compare an exact HTTP resource without fragment/authority spelling aliases."""
    try:
        parsed, host, port = parse_acquisition_url(url)
    except ValueError:
        return ('invalid', url)
    return parsed.scheme, host, port, parsed.path or '/', parsed.params, parsed.query


def public_address(value):
    """Fail closed on special-use and address-translation destinations."""
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    if (not address.is_global or address.is_multicast or address.is_reserved
            or address.is_unspecified or address.is_loopback or address.is_link_local):
        return False
    if isinstance(address, ipaddress.IPv6Address):
        if (address not in ipaddress.ip_network('2000::/3')
                or address in ipaddress.ip_network('2001::/23')
                or address in ipaddress.ip_network('3fff::/20')
                or address.ipv4_mapped or address.sixtofour or address.teredo
                or address.is_site_local
                or address in ipaddress.ip_network('64:ff9b::/96')
                or address in ipaddress.ip_network('64:ff9b:1::/48')):
            return False
    # Keep the boundary conservative on older Python special-use registries.
    elif address in ipaddress.ip_network('192.0.0.0/24') or address in ipaddress.ip_network('192.88.99.0/24'):
        return False
    return True


def resolve_public_addresses(host, port):
    """Resolve once and reject the whole answer if any destination is non-public.

    Tests may inject a resolver restricted to their own loopback fixture ports.
    No catalogue field, CLI option or environment setting enables that seam.
    """
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not public_address(host):
            raise UnsafeSourceURL('Non-public acquisition address')
        family = socket.AF_INET6 if literal.version == 6 else socket.AF_INET
        answers = [(family, socket.SOCK_STREAM, socket.IPPROTO_TCP, '',
                    (host, port, 0, 0) if literal.version == 6 else (host, port))]
    else:
        try:
            answers = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
        except OSError as error:
            raise URLError(error) from error
    if not answers or any(family not in (socket.AF_INET, socket.AF_INET6)
                          or not public_address(address[0])
                          for family, _, _, _, address in answers):
        raise UnsafeSourceURL('DNS includes a non-public acquisition address')
    return list(dict.fromkeys((family, kind, protocol, address)
                             for family, kind, protocol, _, address in answers))


def connect_pinned(addresses, timeout):
    """Connect numeric sockaddrs directly: never let HTTP/TLS resolve again."""
    last_error = None
    for family, kind, protocol, address in addresses:
        sock = socket.socket(family, kind, protocol)
        try:
            sock.settimeout(timeout)
            sock.connect(address)
            if ipaddress.ip_address(sock.getpeername()[0]) != ipaddress.ip_address(address[0]):
                raise UnsafeSourceURL('Connected peer differs from the validated destination')
            return sock
        except (OSError, ValueError) as error:
            sock.close()
            if isinstance(error, UnsafeSourceURL):
                raise
            last_error = error
    raise URLError(last_error or 'No acquisition addresses')


class AcquiredResponse:
    """Own both the HTTP response and connection, including errors/range exits."""
    def __init__(self, response, connection, url):
        self.response, self.connection, self.url = response, connection, url

    def __getattr__(self, name):
        return getattr(self.response, name)

    def close(self):
        try:
            self.response.close()
        finally:
            self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def urlopen(request, timeout=45, *, policy=None):
    """Public-only HTTP transport with pinned DNS, TLS identity and checked hops.

    Ignore environment proxies and implicit urllib auth/redirect handlers.
    HTTPS still verifies certificates/SNI against the original hostname.
    """
    url, headers = request.full_url, dict(request.header_items())
    for hop in range(6):
        parsed, host, port = parse_acquisition_url(url)
        if policy:
            policy(url)
        addresses = resolve_public_addresses(host, port)
        connection_type = http.client.HTTPSConnection if parsed.scheme == 'https' else http.client.HTTPConnection
        connection = connection_type(host, port, timeout=timeout)
        connection._create_connection = lambda *args, **kwargs: connect_pinned(addresses, timeout)
        # Host is generated by http.client from the validated authority.
        headers = {key: value for key, value in headers.items() if key.lower() not in ('host', 'proxy-authorization')}
        try:
            path = parsed.path or '/'
            if parsed.params:
                path += ';' + parsed.params
            if parsed.query:
                path += '?' + parsed.query
            connection.request('GET', path, headers={**headers, 'Connection': 'close'})
            response = AcquiredResponse(connection.getresponse(), connection, url)
        except Exception:
            connection.close()
            raise
        if response.status in (301, 302, 303, 307, 308):
            location = response.headers.get('Location')
            response.close()
            if not location or hop == 5:
                raise UnsafeSourceURL('Missing or excessive acquisition redirects')
            # Validate raw Location before urljoin can discard control characters.
            if any(ord(c) < 33 or ord(c) == 127 for c in location) or '\\' in location:
                raise UnsafeSourceURL('Invalid acquisition redirect')
            destination = urljoin(url, location)
            next_parsed, next_host, next_port = parse_acquisition_url(destination)
            if parsed.scheme == 'https' and next_parsed.scheme != 'https':
                raise UnsafeSourceURL('Acquisition redirect downgrades HTTPS')
            if (parsed.scheme, host, port) != (next_parsed.scheme, next_host, next_port):
                headers = {key: value for key, value in headers.items()
                           if key.lower() not in ('authorization', 'cookie')}
            url = destination
            continue
        if not 200 <= response.status < 300:
            raise HTTPError(url, response.status, response.reason, response.headers, response)
        return response


def get(url, headers=None, *, policy=None):
    """Bounded retry for transport outages; never loop on permanent HTTP 404."""
    parse_acquisition_url(url)
    request = Request(url, headers={'User-Agent': 'RailwayAtlas-frequency/1.0 (+https://github.com/c933103/openrailwaystyle)', **(headers or {})})
    for attempt in range(3):
        try:
            return urlopen(request, timeout=45, policy=policy)
        except HTTPError as error:
            if error.code not in RETRYABLE_HTTP or attempt == 2:
                raise
            delay = retry_after_delay(error.headers.get('Retry-After')) if error.headers else None
            if delay is not None and delay > 8:
                # Respect a publisher's longer retry window: the next
                # scheduled workflow can retry instead of hammering it now.
                raise
            error.close()
            time.sleep(float(2 ** attempt) if delay is None else delay)
        except (URLError, TimeoutError, ConnectionError, http.client.HTTPException):
            if attempt == 2:
                raise
            time.sleep(float(2 ** attempt))


def source_candidates(entry):
    """Distinct public source endpoints, processed first, originals as fallback."""
    row = entry.get('catalogue') or {}
    if blocked(row) or (entry.get('terms') or registry.usage_rights(row))['prohibitions']:
        return []
    values = [entry.get('processed_url'), row.get('source')]
    values.extend(x.get('source') for x in row.get('lineage', []) if isinstance(x, dict))
    urls, seen = [], set()
    for url in values:
        if not isinstance(url, str) or url in seen:
            continue
        try:
            parse_acquisition_url(url)
            source_policy(entry, url)
        except ValueError:
            continue
        seen.add(url)
        urls.append(url)
    return urls[:8]


def redacted_source_url(url):
    """Retain endpoint/parameter context without credentials or query values."""
    if not url:
        return ''
    try:
        url = url.replace('\\/', '/')
        if re.match(r'^https?%3a', url, re.I):
            url = unquote(url, errors='strict')
        if re.search(r'[\x00-\x20\x7f]', url):
            return '[invalid source URL]'
        parsed = urlparse(url)
        host = parsed.hostname or ''
        if not host:
            return '[invalid source URL]'
        authority = '['+host+']' if ':' in host else host
        if parsed.port is not None:
            authority += ':'+str(parsed.port)
        parameters = parse_qsl(parsed.query, keep_blank_values=True, max_num_fields=128)
        query = urlencode([(key if re.fullmatch(r'[A-Za-z0-9_.-]{1,80}', key) else 'parameter',
                            '[redacted]') for key, _ in parameters])
        return urlunparse((parsed.scheme, authority, parsed.path, parsed.params, query, ''))
    except (AttributeError, TypeError, ValueError):
        return '[invalid source URL]'


URL_START = re.compile(r'^(?:[a-z][a-z0-9+.-]*:(?:/|\\/){1,2}|https?%3a(?:%2f){1,2}|//)', re.I)
URL_IN_TEXT = re.compile(r'''(?:[a-z][a-z0-9+.-]*:(?:/|\\/){1,2}|https?%3a(?:%2f){1,2}|//)[^\s<>"'`]+''', re.I)


def redacted_diagnostic(value):
    if URL_START.match(value):
        return redacted_source_url(value)
    return URL_IN_TEXT.sub(lambda match: redacted_source_url(match[0]), value)


def published_metadata(value):
    """Redact diagnostic copies; never use display URLs as acquisition inputs."""
    if isinstance(value, str):
        return redacted_diagnostic(value)
    if isinstance(value, list):
        return [published_metadata(item) for item in value]
    if not isinstance(value, dict):
        return value
    def public_key(key):
        display = redacted_diagnostic(key)
        return key if display == key else '[sha256:'+source_url_fingerprint(key)+'] '+display
    result = {public_key(key): published_metadata(item) for key, item in value.items()}
    for key, item in value.items():
        hash_key = public_key(key)+'_sha256'
        if isinstance(item, str) and URL_START.match(item):
            if not re.fullmatch(r'[a-f0-9]{64}', str(result.get(hash_key, ''))):
                result[hash_key] = source_url_fingerprint(item)
        elif isinstance(item, list) and any(isinstance(x, str) and URL_START.match(x) for x in item):
            if not isinstance(result.get(hash_key), list):
                result[hash_key] = [source_url_fingerprint(x) if isinstance(x, str) and URL_START.match(x) else None for x in item]
    return result


def source_url_fingerprint(url):
    """Full-URL identity only, not encryption or an authorization credential."""
    return hashlib.sha256(url.encode('utf-8')).hexdigest()


def cached_source_url(meta, candidates, default=None):
    """Match operational inputs by full identity, never by a redacted display."""
    fingerprint = meta.get('download_url_sha256')
    if fingerprint:
        return next((url for url in candidates if source_url_fingerprint(url) == fingerprint), None)
    # One-way compatibility with earlier private cache records. A successful
    # use rewrites this raw legacy URL as a fingerprint plus redacted display.
    legacy = meta.get('download_url') or default
    return legacy if legacy in candidates else None


class SourceRetrievalError(RuntimeError):
    """Unresolved transport/feed failure after attempting available source links."""
    def __init__(self, attempts, unsafe_urls=()):
        self.attempts = attempts
        # Raw identities only decide whether an in-memory cache may be used.
        # They are not included in the message, JSON response or source audit.
        self._unsafe_urls = set(unsafe_urls)
        summary = '; '.join(x['code'] + ' @ ' + x['url'] for x in attempts)
        super().__init__('Source endpoints unavailable or unusable: ' + summary[:1900])


def source_attempt(url, error):
    """Structured evidence of a particular endpoint failing, not feed exclusion."""
    code = 'other_source_error'
    if isinstance(error, SourcePolicyError):
        code = 'source_policy'
    elif isinstance(error, UnsafeSourceURL):
        code = 'unsafe_source_url'
    elif isinstance(error, HTTPError):
        code = 'http_' + str(error.code)
        error.close()
    elif isinstance(error, (URLError, TimeoutError, ConnectionError, http.client.HTTPException)):
        code = 'connection_error'
    elif isinstance(error, zipfile.BadZipFile):
        code = 'invalid_zip'
    elif isinstance(error, ValueError):
        code = 'invalid_feed_or_budget'
    # HTTP reason lines and transport exception text are upstream-controlled
    # and can echo access-like query values. Keep only a bounded category.
    message = ('HTTP '+str(error.code) if isinstance(error, HTTPError)
               else type(error).__name__+': source acquisition failed')
    return {'url': redacted_source_url(url), 'url_sha256': source_url_fingerprint(url),
            'code': code, 'message': message}


def valid_cached_archive(path, meta, candidates, max_age_days=30):
    """Use last successfully fetched source while temporarily offline.

    Do not allow a failed refresh to extend source verification. Service dates
    are still checked by the ordinary compiler, not presumed from ZIP age.
    """
    checked = meta.get('checked') or meta.get('retrieved')
    if (meta.get('no_rail') or not checked or not path.is_file()
            or cached_source_url(meta, candidates) is None):
        return False
    try:
        last_success = dt.date.fromisoformat(checked)
        delta = (dt.datetime.now(dt.timezone.utc).date() - last_success).days
        if delta < 0 or delta > max_age_days:
            return False
        with zipfile.ZipFile(path) as archive:
            return 'routes.txt' in archive.namelist()
    except (ValueError, OSError, zipfile.BadZipFile):
        return False


def fetch_alternative(entry, path, max_bytes, skip=()):
    """Fallback to another real published schedule, without inventing data.

    Cache writes only after a valid ZIP has been downloaded. Each upstream
    failure stays attached to the resulting source entry for investigation.
    """
    attempts, unsafe_urls = [], set()
    for url in source_candidates(entry):
        if url in skip:
            continue
        try:
            remote = RemoteZip(url, max_bytes, policy=lambda target: source_policy(entry, target))
            # Keep the cheap preflight: bus-only GTFS must not download its
            # entire stop_times/shapes archive or consume a compile slot.
            import csv
            routes = csv.DictReader(io.StringIO(remote.table('routes.txt').decode('utf-8-sig')))
            if not any(compiler.rail_type(row['route_type']) for row in routes):
                return {
                    'no_rail': True, 'download_url': redacted_source_url(url),
                    'download_url_sha256': source_url_fingerprint(url),
                    'etag': remote.etag, 'last_modified': remote.last_modified,
                    'retrieved': dt.datetime.now(dt.timezone.utc).date().isoformat()
                }, attempts
            with zipfile.ZipFile(io.BytesIO(remote.download())) as archive:
                if 'routes.txt' not in archive.namelist():
                    raise ValueError('Missing routes.txt')
            data = remote.full
            temporary = path.with_suffix('.download.tmp')
            temporary.write_bytes(data)
            temporary.replace(path)
            return {
                'etag': remote.etag, 'last_modified': remote.last_modified,
                'download_url': redacted_source_url(url), 'download_url_sha256': source_url_fingerprint(url),
                'retrieved': dt.datetime.now(dt.timezone.utc).date().isoformat()
            }, attempts
        except (HTTPError, URLError, TimeoutError, ConnectionError, OSError, ValueError, zipfile.BadZipFile, http.client.HTTPException) as error:
            if isinstance(error, (SourcePolicyError, UnsafeSourceURL)):
                unsafe_urls.add(url)
            attempts.append(source_attempt(url, error))
    raise SourceRetrievalError(attempts or [{'url': '', 'code': 'missing_source_url', 'message': 'No suitable published GTFS source URL'}], unsafe_urls)


class RemoteZip:
    """Read the ZIP directory and routes without downloading bus timetables.

    Servers without byte ranges fall back to one bounded full download. The
    identity validator prevents joining byte ranges from different revisions.
    ZIP64 is supported by the full-download fallback, not guessed offsets.
    """
    def __init__(self, url, max_bytes, *, policy=None):
        self.url, self.max_bytes, self.policy = url, max_bytes, policy
        self.full, self.identity = None, None
        with get(url, {'Range': 'bytes=-65557'}, policy=self.policy) as response:
            self.etag=response.headers.get('ETag')
            self.last_modified=response.headers.get('Last-Modified')
            self.identity = self.etag or self.last_modified
            # A weak ETag is valid for If-None-Match, never for If-Range.
            self.range_validator = self.etag if self.etag and not self.etag.startswith('W/') else self.last_modified
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
            if not self.range_validator:
                # One bounded whole response avoids mixing unguarded byte
                # ranges when there is no strong ETag or date validator.
                self.directory = None
                return
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
        if self.range_validator:
            headers['If-Range'] = self.range_validator
        with get(self.url, headers, policy=self.policy) as response:
            if response.status != 206:
                raise ValueError('Feed changed during range reads, or ranges unavailable')
            identity = response.headers.get('ETag') or response.headers.get('Last-Modified')
            if self.identity and identity != self.identity:
                raise ValueError('Feed changed during range reads')
            if self.last_modified and self.range_validator == self.last_modified and response.headers.get('Last-Modified') != self.last_modified:
                raise ValueError('Feed changed during range reads')
            data = response.read(end-begin+2)
        if len(data) != end-begin+1:
            raise ValueError('Truncated range')
        return data

    def table(self, name):
        if self.full is not None:
            with zipfile.ZipFile(io.BytesIO(self.full)) as archive:
                if archive.getinfo(name).file_size > 128_000_000:
                    raise ValueError('Metadata table exceeds budget')
                return archive.read(name)
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
            inflater = zlib.decompressobj(-15)
            data = inflater.decompress(data, expanded+1)
            if inflater.unconsumed_tail or not inflater.eof:
                raise ValueError('Metadata expansion exceeds declared budget')
        elif method != 0:
            raise ValueError('Unsupported ZIP compression')
        if len(data) != expanded:
            raise ValueError('Invalid expanded metadata')
        return data

    def download(self):
        if self.full is None:
            with get(self.url, policy=self.policy) as response:
                identity = response.headers.get('ETag') or response.headers.get('Last-Modified')
                if self.identity and identity != self.identity:
                    raise ValueError('Feed changed during full download')
                if self.last_modified and self.range_validator == self.last_modified and response.headers.get('Last-Modified') != self.last_modified:
                    raise ValueError('Feed changed during full download')
                self.full = self.read_bounded(response)
        return self.full


def write_feed(path, value):
    # Redact provenance and GTFS URL columns, not matching identifiers that
    # happen to resemble URLs. Avoid a second copy or walk of geometry/profiles.
    value = {**value, 'source': published_metadata(value['source'])}
    for table in ('agencies', 'routes'):
        if table in value:
            value[table] = [{**row, **published_metadata({key: item for key, item in row.items()
                            if key == 'url' or key.endswith('_url')})} for row in value[table]]
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    with temporary.open('wb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, compresslevel=9, mtime=0) as compressed:
            with io.TextIOWrapper(compressed, encoding='utf-8') as text:
                json.dump(value, text, ensure_ascii=False, separators=(',', ':'))
                text.write('\n')
    temporary.replace(path)


@lru_cache(maxsize=8)
def file_hash(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as file:
        while chunk:=file.read(1_048_576):digest.update(chunk)
    return digest.hexdigest()


def compile_entry(entry, cache, output, date, graph, max_bytes, profiles, max_seconds=600):
    ident, row = entry['id'], entry['catalogue']
    path, meta_path = cache/(ident+'.zip'), cache/(ident+'.meta.json')
    # 304 from the same successful source may reuse cache. A 404 or transient
    # outage MUST fall through to other known originals, not reject the feed.
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    headers = {'If-None-Match': meta['etag']} if meta.get('etag') else {'If-Modified-Since':meta['last_modified']} if meta.get('last_modified') else {}
    fresh, attempted, attempts, unsafe_urls = False, set(), [], set()
    cached_url = cached_source_url(meta, source_candidates(entry), entry.get('processed_url'))
    if cached_url:
        meta['download_url'] = redacted_source_url(cached_url)
        meta['download_url_sha256'] = source_url_fingerprint(cached_url)
    if path.exists() and headers and cached_url in source_candidates(entry):
        try:
            with get(cached_url, headers, policy=lambda target: source_policy(entry, target)) as response:
                data = RemoteZip.read_bounded(type('Budget', (), {'max_bytes': max_bytes})(), response)
                # Never replace a previously usable ZIP with an error page or
                # malformed archive returned as HTTP 200.
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    if 'routes.txt' not in archive.namelist():
                        raise ValueError('Missing routes.txt')
                temporary = path.with_suffix('.download.tmp')
                temporary.write_bytes(data)
                temporary.replace(path)
                meta = {'etag': response.headers.get('ETag'), 'last_modified':response.headers.get('Last-Modified'),
                        'download_url': redacted_source_url(cached_url),
                        'download_url_sha256': source_url_fingerprint(cached_url),
                        'retrieved': dt.datetime.now(dt.timezone.utc).date().isoformat()}
                fresh = True
        except HTTPError as error:
            if error.code == 304:
                error.close()
                meta['download_url'] = redacted_source_url(cached_url)
                meta['download_url_sha256'] = source_url_fingerprint(cached_url)
                meta.pop('offline_cached', None)
                meta.pop('recovered_source_errors', None)
                fresh = True
            else:
                attempted.add(cached_url)
                attempts.append(source_attempt(cached_url, error))
        except (URLError, TimeoutError, ConnectionError, OSError, ValueError, zipfile.BadZipFile, http.client.HTTPException) as error:
            attempted.add(cached_url)
            if isinstance(error, (SourcePolicyError, UnsafeSourceURL)):
                unsafe_urls.add(cached_url)
            attempts.append(source_attempt(cached_url, error))
    if not fresh:
        try:
            meta, more_attempts = fetch_alternative(entry, path, max_bytes, skip=attempted)
            attempts.extend(more_attempts)
        except SourceRetrievalError as error:
            attempts.extend(error.attempts)
            unsafe_urls.update(error._unsafe_urls)
            safe_cache_urls = [url for url in source_candidates(entry) if url not in unsafe_urls]
            if valid_cached_archive(path, meta, safe_cache_urls):
                # Continue compiling using the last successfully retrieved
                # ZIP. Never advance its 'checked' or 'retrieved' timestamps.
                meta['offline_cached'] = True
                meta['recovered_source_errors'] = attempts
                fresh = True
            else:
                raise SourceRetrievalError(attempts, unsafe_urls) from error
    if attempts:
        meta['recovered_source_errors'] = attempts
    if meta.get('no_rail'):
        # A successful newer bus-only source supersedes any previous rail
        # archive. Persist that fact before removing the old cache, so even
        # an interrupted deletion cannot resurrect it during a later outage.
        meta['checked'] = dt.datetime.now(dt.timezone.utc).date().isoformat()
        atomic_json(meta_path, meta)
        path.unlink(missing_ok=True)
        (output/'feeds'/(ident+'.json.gz')).unlink(missing_ok=True)
        return {**entry, 'status': 'no_rail', 'rail_routes': 0}
    # Reinspect changed conditional 200 responses and cached 304 revisions.
    with zipfile.ZipFile(path) as archive:
        has_rail=any(compiler.rail_type(r['route_type']) for r in compiler.read(archive,'routes.txt'))
    if not meta.get('offline_cached'):
        meta['checked'] = dt.datetime.now(dt.timezone.utc).date().isoformat()
    atomic_json(meta_path, meta)
    if not has_rail:
        (output/'feeds'/(ident+'.json.gz')).unlink(missing_ok=True)
        return {**entry, 'status': 'no_rail', 'rail_routes': 0}
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    signature=hashlib.sha256(json.dumps({'catalogue':row,'profiles':profiles,'denied_source_urls':entry.get('denied_source_urls', []),
        'graph':file_hash(str(graph)) if graph else None,
        'compiler':[file_hash(str(ROOT/'scripts'/name)) for name in ['global-service-frequency.py','frequency_catalogue.py','gtfs-frequency.py','gtfs-shapes.py','gtfs-rail-paths.py']]},sort_keys=True).encode()).hexdigest()
    destination = output/'feeds'/(ident+'.json.gz')
    if destination.exists():
        with gzip.open(destination, 'rt') as file:
            previous = json.load(file)
        if previous['source']['sha256'] == digest and previous['source']['service_date'] == date and previous['source'].get('input_signature') == signature:
            previous['source'] = published_metadata(previous['source'])
            previous['source']['checked'] = meta['checked']
            previous['source']['download_url'] = meta['download_url']
            previous['source']['download_url_sha256'] = meta['download_url_sha256']
            previous['source']['offline_cached'] = bool(meta.get('offline_cached'))
            previous['source']['recovered_source_errors'] = meta.get('recovered_source_errors', [])
            write_feed(destination, previous)
            return {**entry, 'status': 'compiled', 'output': 'feeds/'+destination.name, 'sha256': digest,
                    'rail_routes': len(previous['routes']), 'mapped_segments': len(previous['segments']),
                    'unmapped_segments': len(previous.get('unmapped_segments', [])), 'source': previous['source']}
        del previous  # stale national output must not coexist with recompilation.
    publisher = row.get('publisher') if isinstance(row.get('publisher'), dict) else {}
    rights = entry.get('terms') or registry.usage_rights(row)
    spdx = row.get('spdx_license_identifier') or (rights['spdx_identifiers'][0] if len(rights['spdx_identifiers']) == 1 else '')
    terms_url = row.get('license_url') or (rights['terms_urls'][0] if rights['terms_urls'] else '')
    if not terms_url and spdx and spdx.startswith(('CC-', 'MIT', 'ODbL-', 'OGL-')):
        terms_url = 'https://spdx.org/licenses/'+quote(spdx)+'.html'
    config = {'source': {'id': ident, 'name': entry['name'], 'url': row.get('source') or entry['processed_url'],
               'processed_url': entry['processed_url'], 'catalogue_url': row.get('catalogue_url') or CATALOGUE,
               'license': spdx, 'terms_url': terms_url, 'rights': rights,
               'catalogue_lineage': row.get('lineage', []),
               'download_url': meta.get('download_url') or redacted_source_url(entry.get('processed_url')),
               'download_url_sha256': meta.get('download_url_sha256'),
               'recovered_source_errors': meta.get('recovered_source_errors', []),
               'offline_cached': bool(meta.get('offline_cached')),
               'attribution': row.get('attribution_text') or publisher.get('name') or entry['name'],
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
        try:
            result = compiler.compile_feed(path, config, date, geometry=True)
        except TimeoutError:
            # An expensive geometry match must not discard valid national
            # timetable data. Retry only the stop-pair calculation, retaining
            # the same explicit time budget and no invented map geometry.
            signal.alarm(max_seconds)
            result = compiler.compile_feed(path, {**config, 'include_unmapped': False, 'rail_graph': None}, date, geometry=False)
            result['unmapped_segments'] = result.pop('segments')
            result['unmapped_stops'] = result.pop('stops')
            result['segments'], result['stops'] = [], []
            result['source']['geometry_audit'] = {'reason': 'Geometry compilation exceeded time budget; frequencies retained as unmatched stop pairs'}
    finally:
        signal.alarm(0); signal.signal(signal.SIGALRM, previous_handler)
    source = result['source']
    source['attribution'] = '; '.join(dict.fromkeys([source['attribution']]+[a['agency_name'] for a in result['agencies']]+[a.get('organization_name','') for a in source['feed_attributions']]))
    source = result['source'] = published_metadata(source)
    write_feed(destination, result)
    return {**entry, 'status': 'compiled', 'output': 'feeds/'+destination.name, 'sha256': digest,
            'rail_routes': len(result['routes']), 'mapped_segments': len(result['segments']),
            'unmapped_segments': len(result.get('unmapped_segments', [])), 'source': source}


def compile_entry_isolated(entry, cache, output, date, graph, max_bytes, profiles,
                           max_seconds=600, max_memory_bytes=3_000_000_000):
    """Keep a failed feed's memory/CPU budget separate from its worldwide shard."""
    payload={'entry':entry,'cache':str(cache),'output':str(output),'date':date,
             'graph':str(graph) if graph else None,'max_bytes':max_bytes,
             'profiles':profiles,'max_seconds':max_seconds,'max_memory_bytes':max_memory_bytes}
    with tempfile.TemporaryDirectory(prefix='frequency-compile-') as folder:
        request, response = Path(folder)/'request.json', Path(folder)/'response.json'
        request.write_text(json.dumps(payload))
        process=subprocess.run([sys.executable,str(Path(__file__).resolve()),'--compile-one',str(request),str(response)],
                               stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,
                               timeout=2*max_seconds+300)
        if not response.exists():
            raise RuntimeError(f"Feed compiler exited {process.returncode}: {redacted_diagnostic(process.stderr)[-2000:]}")
        if response.stat().st_size > 8_000_000:
            raise ValueError('Feed audit metadata exceeds byte budget')
        result=json.loads(response.read_text())
        if process.returncode or 'error' in result:
            if 'source_attempts' in result:
                raise SourceRetrievalError(result['source_attempts'])
            raise RuntimeError(result.get('error') or f'Feed compiler exited {process.returncode}')
        return result['entry']


def compile_one(request, response):
    import resource
    payload=json.loads(Path(request).read_text())
    limit=payload.pop('max_memory_bytes')
    resource.setrlimit(resource.RLIMIT_AS,(limit,limit))
    for key in ['cache','output']:
        payload[key]=Path(payload[key])
    if payload['graph']:
        payload['graph']=Path(payload['graph'])
    try:
        atomic_json(Path(response),{'entry':published_metadata(compile_entry(**payload))})
    except SourceRetrievalError as error:
        atomic_json(Path(response),{'error':str(error)[:2000], 'source_attempts':error.attempts})
        return 1
    except Exception as error:
        atomic_json(Path(response),{'error':redacted_diagnostic(f'{type(error).__name__}: {error}')[:2000]})
        return 1
    return 0


def classify_failure(error):
    """Annotate the unresolved failure; it remains eligible for future attempts."""
    if isinstance(error, SourceRetrievalError):
        codes = {x['code'] for x in error.attempts}
        if codes == {'http_404'}:
            return 'source_http_404', 'retrieval'
        if codes <= {'http_403', 'http_401'}:
            return 'source_access_denied', 'retrieval'
        if codes == {'missing_source_url'}:
            return 'missing_source_url', 'discovery'
        return 'source_retrieval_error', 'retrieval'
    reason = f'{type(error).__name__}: {error}'
    message = reason.lower()
    if 'http error 404' in message or 'http 404' in message:
        return 'source_http_404', 'retrieval'
    if any(s in message for s in ('http error 403', 'http error 401', 'unauthorized', 'forbidden')):
        return 'source_access_denied', 'retrieval'
    if any(s in message for s in ('http error', 'urlerror', 'timed out', 'connection', 'invalid http range', 'truncated range', 'feed changed during')):
        return 'source_retrieval_error', 'retrieval'
    if 'calendar horizon' in message or "feed's validity" in message or 'service calendar' in message:
        return 'calendar_horizon', 'calendar'
    if 'memoryerror' in message or 'memory budget' in message:
        return 'memory_limit', 'resources'
    if 'time budget' in message or 'timeoutexpired' in message:
        return 'time_limit', 'resources'
    if 'row budget' in message:
        return 'table_row_limit', 'parsing'
    if 'byte budget' in message or 'exceeds download byte' in message:
        return 'byte_limit', 'parsing'
    if any(s in message for s in ('zip', 'missing routes.txt', 'missing table')):
        return 'invalid_archive_or_gtfs', 'parsing'
    return 'compile_error', 'compilation'


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
    parser.add_argument('--max-compile-memory-bytes', type=int, default=3_000_000_000)
    parser.add_argument('--inventory-only', action='store_true')
    args = parser.parse_args()
    if not 0 <= args.shard < args.shards or args.max_feed_bytes <= 0 or args.max_compile_seconds <= 0 or args.max_compile_memory_bytes <= 0:
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
            'counts': dict(Counter(x['status'] for x in outcomes)),
            'reason_codes': dict(Counter(x.get('reason_code') or 'none' for x in outcomes)),
            'entries': published_metadata(outcomes)})
    for entry in entries:
        if int(hashlib.sha256(entry['id'].encode()).hexdigest(), 16) % args.shards != args.shard:
            continue
        if entry['status'] == 'pending' and not args.inventory_only:
            try:
                entry = compile_entry_isolated(entry, args.cache, args.output, args.date, args.rail_graph, args.max_feed_bytes, rules.get('profiles', PROFILES), args.max_compile_seconds, args.max_compile_memory_bytes)
            except Exception as error:
                code, stage = classify_failure(error)
                entry = {**entry, 'status': 'retry_pending', 'reason': redacted_diagnostic(f'{type(error).__name__}: {error}'),
                         'reason_code': code, 'failure_stage': stage, 'retry_eligible': True,
                         'next_action': ('repair_or_find_feed_url' if code in ('source_http_404', 'missing_source_url')
                                         else 'retry_source_or_repair_compiler'),
                         'source_attempts': error.attempts if isinstance(error, SourceRetrievalError) else []}
        outcomes.append(entry)
        # Inventory-only is read-only: write once rather than serializing the
        # growing worldwide inventory N times (quadratic work at global scale).
        # Compiling shards still checkpoint after each feed for resumability.
        if not args.inventory_only:
            save()
            print(entry['id'], entry['status'], entry.get('rail_routes', ''),
                  entry.get('mapped_segments', ''), redacted_diagnostic(entry.get('reason', '')), flush=True)
    if args.inventory_only:
        save()
    print(json.dumps({'catalogue_entries': len(entries), 'shard_outcomes': len(outcomes),
                      'counts': dict(Counter(x['status'] for x in outcomes)),
                      'reason_codes': dict(Counter(x.get('reason_code') or 'none' for x in outcomes))}), flush=True)


if __name__ == '__main__':
    if len(sys.argv)==4 and sys.argv[1]=='--compile-one':
        sys.exit(compile_one(sys.argv[2],sys.argv[3]))
    main()
