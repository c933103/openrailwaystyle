#!/usr/bin/env python3
"""Discover and compile the whole worldwide catalogue, without a city allow-list.

The default source is Transitous's publicly downloadable, overlap-cleaned GTFS.
Every catalogue entry receives an explicit outcome. A bounded shard can resume
from content hashes; no successful feed's retrieval date is advanced by a failed
download. Raw ZIPs are a cache, not site assets. No Overpass requests are made.
"""
import argparse
from collections import Counter
import csv
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
import zlib
try:
    import lzma
except ImportError:  # zipfile also supports builds without optional codecs.
    lzma = None

ZIP_METADATA_ERRORS = (zipfile.BadZipFile, struct.error, EOFError, NotImplementedError, zlib.error) + ((lzma.LZMAError,) if lzma else ())

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
retry_spec = importlib.util.spec_from_file_location('frequency_retry', ROOT/'scripts/frequency_retry.py')
retry = importlib.util.module_from_spec(retry_spec)
retry_spec.loader.exec_module(retry)


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    temporary.replace(path)


def source_id(row):
    name = row.get('filename', '')
    if not isinstance(name, str) or not name.endswith('.gtfs.zip') or '/' in name or '\\' in name or '\0' in name:
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
        if not isinstance(value, str):
            continue
        try:
            host = (urlparse(value).hostname or '').encode('idna').decode('ascii').rstrip('.').lower()
        except (ValueError, UnicodeError):
            continue
        if any(host == code.lower() or host.endswith('.'+code.lower()) for code in EXCLUDED):
            return 'excluded provider domain'
    return None


def discover(rows, rules, publication_context=None):
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
        row = registry.prepare_catalogue_row(original)
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
        resolution = row.get('source_resolution') or {}
        reference_state = registry.references.resolution_state(row, publication_context)
        rights = registry.usage_rights(row)
        policy_reason = blocked(row)
        if row.get('access_review'):
            status, reason_code = 'retry_pending', 'source_access_review'
            reason = 'Source access material requires review; acquisition paused'
        elif policy_reason:
            status, reason, reason_code = 'excluded', policy_reason, 'provider_policy'
        elif rights['prohibitions']:
            status, reason_code = 'excluded', 'source_terms_prohibit_derived_use'
            reason = '; '.join(item['basis'] for item in rights['prohibitions'])
        elif reference_state == 'non_timetable_format':
            status, reason_code = 'non_timetable', 'non_timetable_format'
            reason = 'Pinned reference metadata describes a non-timetable format'
        elif reference_state in ('unresolved', 'ambiguous', 'invalid'):
            status, reason_code = 'retry_pending', ('ambiguous_source_reference' if reference_state == 'ambiguous' else 'unresolved_source_reference')
            reason = 'Source reference metadata is incomplete, invalid or conflicting; acquisition paused'
            if reference_state == 'unresolved' and registry.references.uncertain_static_resources(row):
                reason = 'Original identity of a redacted access-held source is unavailable; compatible acquisition paused'
        elif reference_state == 'schedule' and resolution.get('acquisition_alias_of'):
            status, reason_code = 'source_alias', 'duplicate_static_source'
            reason = 'Exact static source is retained under another existing acquisition owner'
        elif row.get('delivery') == 'direct' and (not isinstance(row.get('source'), str) or not row.get('source')):
            status, reason, reason_code = 'retry_pending', 'Original GTFS URL unresolved', 'missing_source_url'
        else:
            status, reason, reason_code = 'pending', '', ''
        out.append({'id': ident, 'status': status, 'reason': reason,
                    'reason_code': reason_code, 'retry_eligible': status == 'retry_pending',
                    'failure_stage': 'discovery' if reason_code in ('missing_source_url', 'source_access_review', 'non_timetable_format', 'unresolved_source_reference', 'ambiguous_source_reference', 'duplicate_static_source') else '',
                    'next_action': ('review_source_access_or_declared_public_alternative' if reason_code == 'source_access_review' else 'resolve_catalogue_reference' if reason_code in ('unresolved_source_reference', 'ambiguous_source_reference') else ''),
                    'terms': rights, 'denied_source_urls': denied_sources,
                    'country': row.get('country_code', ''),
                    'name': row.get('human_name', ident), 'catalogue': row,
                    'processed_url': ('' if reference_state is not None and
                        (reference_state != 'schedule' or not registry.references.processed_available(row, publication_context)) else
                        row.get('source', '') if row.get('delivery') == 'direct' else PROCESSED+quote(row['filename']))})
    for entry in out:
        if (entry['status'] == 'pending' and 'source_resolution' in entry['catalogue']
                and not source_candidates(entry, publication_context)):
            entry.update(status='retry_pending', reason_code='unresolved_source_reference',
                reason='No independently evidenced public acquisition candidate; acquisition paused',
                retry_eligible=True, failure_stage='discovery', next_action='resolve_catalogue_reference', processed_url='')
            if registry.references.uncertain_static_resources(entry['catalogue']):
                entry['reason'] = 'Original identity of a redacted access-held source is unavailable; compatible acquisition paused'
    by_id = {entry['id']: entry for entry in out}
    for entry in out:
        if entry['status'] != 'source_alias':
            continue
        resolution = entry['catalogue']['source_resolution']
        target = by_id.get(resolution['acquisition_alias_of'])
        target_row = target['catalogue'] if target else {}
        source = target_row.get('source')
        target_resolution = target_row.get('source_resolution')
        target_resolution = target_resolution if isinstance(target_resolution, dict) else {}
        if (not target or target['id'] == entry['id'] or target_row.get('delivery') != 'direct'
                or target_resolution.get('acquisition_alias_of') or target['status'] != 'pending'
                or not registry.references.alias_owner_metadata_compatible(target_row)
                or not source_candidates(target, publication_context)
                # Legacy owner Mobility auth is decided by the alias-only
                # compatibility contract above, without changing owner policy.
                or ('source_resolution' in target_row and registry.references.withheld_static_identities(target_row))
                or not registry.references.alias_source_bindings(entry['catalogue'])
                or registry.references.alias_source_bindings(entry['catalogue']) != registry.references.alias_source_bindings(target_row)
                or not isinstance(source, str) or hashlib.sha256(source.encode()).hexdigest() != resolution['alias_source_sha256']):
            entry.update(status='retry_pending', reason_code='ambiguous_source_reference',
                reason='Static source alias target is missing, changed or has incompatible acquisition policy; acquisition paused',
                retry_eligible=True, failure_stage='discovery', next_action='resolve_catalogue_reference')
    return sorted(out, key=lambda x: x['id'])


RETRYABLE_HTTP = {408, 425, 429, 500, 502, 503, 504}


def retry_after_delay(value, now=None):
    """Decode either HTTP Retry-After form; malformed values use normal backoff."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    if re.fullmatch(r'[0-9]+', value):
        try:
            return int(value)
        except ValueError:
            # A decimal beyond Python's parser limit still asks us to wait.
            # This runtime-only sentinel is never serialized or slept on.
            return float('inf')
    try:
        deadline = parsedate_to_datetime(value)
        if deadline.tzinfo is None:
            deadline = deadline.replace(tzinfo=dt.timezone.utc)
        return max(0.0, deadline.timestamp() - (time.time() if now is None else now))
    except (TypeError, ValueError, OverflowError):
        return None


class UnsafeSourceURL(ValueError):
    """An acquisition target does not meet the public HTTP(S) boundary."""


class SourceAccessHold(UnsafeSourceURL):
    """Declared row access requirements, not an observed HTTP denial or terms ban."""


class SourceIdentityChanged(UnsafeSourceURL):
    """A changed public terminal cannot validate bytes from the prior resource."""


class CacheAccessHold(ValueError):
    """A recorded historical destination is now held; no new request is implied."""


class CacheIdentityUnresolved(ValueError):
    """Old archive destination evidence is unavailable, invalid or now held."""


class SourcePolicyError(ValueError):
    """A particular endpoint is prohibited by an existing source rule."""


def source_policy(entry, url):
    row = entry.get('catalogue') or {}
    if 'source_resolution' in row:
        if (row.get('access_review') or not registry.references.metadata_shape_valid(row['source_resolution'])
                or registry.references.source_withheld(row, url)):
            raise SourceAccessHold('Declared source access hold prevents this request')
    if blocked({'source': url}):
        raise SourcePolicyError('excluded provider domain')
    key = acquisition_url_key(url)
    if any(key == acquisition_url_key(denied) for denied in entry.get('denied_source_urls', [])):
        raise SourcePolicyError('source terms explicitly forbid end-user timetable-frequency use')


def parse_acquisition_url(url):
    """Reject ambiguous authorities before DNS, connection or redirect handling."""
    if not isinstance(url, str) or any(ord(c) < 33 or ord(c) == 127 for c in url) or '\\' in url:
        raise UnsafeSourceURL('Invalid acquisition URL')
    if registry.access_review_url(url):
        raise UnsafeSourceURL('Acquisition URL requires access review')
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
    return registry.references.resource_key(url) or ('invalid', url)


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


def urlopen(request, timeout=45, *, policy=None, retry_state=None, validator_resource_sha256=None, request_evidence=None):
    """Public-only HTTP transport with pinned DNS, TLS identity and checked hops.

    Ignore environment proxies and implicit urllib auth/redirect handlers.
    HTTPS still verifies certificates/SNI against the original hostname.
    """
    url, headers = request.full_url, dict(request.header_items())
    if request_evidence is not None: request_evidence.begin()
    for hop in range(6):
        parsed, host, port = parse_acquisition_url(url)
        if policy:
            policy(url)
        if retry_state is not None:
            retry_state.check(url)
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
            if retry_state is not None:
                retry_state.metrics['http_requests'] += 1
            request_headers = headers
            if validator_resource_sha256 is not None and request_resource_hash(url) != validator_resource_sha256:
                request_headers = {key:value for key,value in headers.items()
                    if key.lower() not in ('if-none-match','if-modified-since','if-range')}
            connection.request('GET', path, headers={**request_headers, 'Connection': 'close'})
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


def get(url, headers=None, *, policy=None, retry_state=None, validator_resource_sha256=None, request_evidence=None):
    """Bounded retry for transport outages; never loop on permanent HTTP 404."""
    parse_acquisition_url(url)
    if retry_state is not None:
        if policy:
            policy(url)
        retry_state.check(url)
    request = Request(url, headers={'User-Agent': 'RailwayAtlas-frequency/1.0 (+https://github.com/c933103/openrailwaystyle)', **(headers or {})})
    for attempt in range(3):
        try:
            options = {'validator_resource_sha256':validator_resource_sha256} if validator_resource_sha256 is not None else {}
            if request_evidence is not None: options['request_evidence']=request_evidence
            response = urlopen(request, timeout=45, policy=policy, retry_state=retry_state, **options)
            try:
                if retry_state is not None:
                    retry_state.clear(url)
                    if isinstance(getattr(response, 'url', None), str):
                        retry_state.clear(response.url)
            except BaseException:
                response.close()
                raise
            return response
        except retry.RetryAfterDeferred as error:
            if retry_state is not None and retry_state.fingerprint(url) != error.fingerprint:
                retry_state.record(url, error.status, retry_state.now(), error.not_before)
            raise
        except HTTPError as error:
            if error.code not in RETRYABLE_HTTP:
                raise
            try:
                observed = retry_state.now() if retry_state is not None else time.time()
                delay = retry_after_delay(error.headers.get('Retry-After'), observed) if error.headers else None
                if delay is not None and delay > 0 and retry_state is not None:
                    deadline = observed + delay if retry.finite_number(delay) else None
                    if retry.finite_number(deadline):
                        for target in {url, error.url}:
                            # Both the requested source and its checked redirect endpoint
                            # retain the deadline, avoiding repeated redirect walks.
                            if isinstance(target, str):
                                retry_state.record(target, error.code, observed, deadline)
                        error.retry_after_not_before = deadline
                    else:
                        # Do not shorten an unrepresentable hint to a convenient
                        # deadline. It still defers this run, but cannot be saved.
                        retry_state.metrics['unpersistable_hints'] += 1
            except BaseException:
                error.close()
                raise
            if attempt == 2:
                raise
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


def source_candidates(entry, publication_context=None):
    """Distinct public source endpoints, processed first, originals as fallback."""
    row = entry.get('catalogue') or {}
    reference_state = registry.references.resolution_state(row, publication_context)
    if reference_state is not None and (reference_state != 'schedule'
            or row['source_resolution'].get('acquisition_alias_of')):
        return []
    lineage = row.get('lineage') if isinstance(row.get('lineage'), list) else []
    if row.get('access_review') or any(registry.access_review_url(url) for url in
            [row.get('source'), entry.get('processed_url')]+[x.get('source') for x in lineage if isinstance(x, dict)]):
        return []
    if blocked(row) or (entry.get('terms') or registry.usage_rights(row))['prohibitions']:
        return []
    processed = entry.get('processed_url')
    if reference_state is not None:
        processed = PROCESSED+quote(row['filename']) if registry.references.processed_available(row, publication_context) else ''
    values = [processed, row.get('source')]
    values.extend(x.get('source') for x in lineage if isinstance(x, dict))
    allowed = registry.references.evidenced_static_identities(row, publication_context) if reference_state is not None else None
    urls, seen = [], set()
    for url in values:
        if (not isinstance(url, str) or url in seen or (allowed is not None and url != processed
                and hashlib.sha256(url.encode()).hexdigest() not in allowed)):
            continue
        if reference_state is not None and registry.references.source_withheld(row, url):
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


def published_metadata(value, reference_context=False):
    """Redact diagnostic copies; never use display URLs as acquisition inputs."""
    if isinstance(value, str):
        return (registry.references.reference_display_url(value) if reference_context and registry.references.reference_url_valid(value)
                else redacted_diagnostic(value))
    if isinstance(value, list):
        return [published_metadata(item, reference_context) for item in value]
    if not isinstance(value, dict):
        return value
    def public_key(key):
        display = redacted_diagnostic(key)
        return key if display == key else '[sha256:'+source_url_fingerprint(key)+'] '+display
    value = registry.references.project_row(value)
    result = {public_key(key): published_metadata(item, reference_context or key == 'source_resolution'
        or key == 'lineage' and 'source_resolution' in value) for key, item in value.items()}
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
    def __init__(self, attempts, unsafe_urls=(), acquisition_metrics=None):
        self.attempts = attempts
        self.acquisition_metrics = acquisition_metrics or {}
        # Raw identities only decide whether an in-memory cache may be used.
        # They are not included in the message, JSON response or source audit.
        self._unsafe_urls = set(unsafe_urls)
        summary = '; '.join(x['code'] + ' @ ' + x['url'] for x in attempts)
        super().__init__('Source endpoints unavailable or unusable: ' + summary[:1900])


MAX_CHECKED_ENDPOINTS = 64
MAX_REFERENCE_CACHE_METADATA_BYTES = 1024 * 1024


def request_resource_hash(url):
    key = registry.references.resource_key(url)
    if key is None: raise UnsafeSourceURL('Invalid request resource identity')
    return registry.references.digest(key)


def request_endpoint(url):
    display = redacted_source_url(url)
    if len(display) > 4096 or display == '[invalid source URL]':
        raise ValueError('Request provenance URL budget exceeded')
    return {'url':display, 'url_sha256':source_url_fingerprint(url),
        'resource_sha256':request_resource_hash(url),
        'visible_resource_sha256':request_resource_hash(display)}


class CheckedRequests:
    """Producer-owned bounded receipt for checked hops, never raw access values."""
    def __init__(self, entry, candidate, terminal=None):
        self.entry, self.candidate = entry, source_url_fingerprint(candidate)
        self.terminal = terminal
        self.endpoints, self.pending = {}, {}

    def begin(self):
        # Retried failed chains did not supply the accepted representation.
        self.pending = {}

    def policy(self, url):
        source_policy(self.entry, url)  # Before DNS/connect at every hop.
        endpoint = request_endpoint(url)
        self.pending[endpoint['url_sha256']] = endpoint
        if len(self.endpoints.keys() | self.pending.keys()) > MAX_CHECKED_ENDPOINTS:
            raise ValueError('Request provenance endpoint budget exceeded')

    def response(self, url):
        resource = request_resource_hash(url)
        if self.terminal is not None and resource != self.terminal:
            raise SourceIdentityChanged('Feed terminal resource changed during validation')
        if source_url_fingerprint(url) not in self.pending:
            raise ValueError('Response has no checked request identity')
        self.endpoints.update(self.pending)
        self.terminal = resource

    def receipt(self, data, kind='archive'):
        if self.terminal is None: raise ValueError('Missing checked terminal resource')
        return {'schema':1, 'candidate_sha256':self.candidate, 'terminal_resource_sha256':self.terminal,
            'artifact_kind':kind, 'artifact_sha256':hashlib.sha256(data).hexdigest(),
            'endpoints':list(self.endpoints.values())}


def request_receipt_valid(value, candidate):
    fields = {'schema','candidate_sha256','terminal_resource_sha256','artifact_kind','artifact_sha256','endpoints'}
    endpoint_fields = {'url','url_sha256','resource_sha256','visible_resource_sha256'}
    is_hash = lambda value:isinstance(value,str) and re.fullmatch('[a-f0-9]{64}',value) is not None
    if (not isinstance(value,dict) or set(value)!=fields or type(value['schema']) is not int or value['schema']!=1
            or value['candidate_sha256']!=source_url_fingerprint(candidate)
            or value['artifact_kind'] not in ('archive','routes') or not is_hash(value['artifact_sha256'])
            or not is_hash(value['terminal_resource_sha256']) or not isinstance(value['endpoints'],list)
            or not 1 <= len(value['endpoints']) <= MAX_CHECKED_ENDPOINTS): return False
    identities = set(); resources = set()
    for item in value['endpoints']:
        if (not isinstance(item,dict) or set(item)!=endpoint_fields or not isinstance(item['url'],str)
                or not 0 < len(item['url']) <= 4096 or item['url']!=redacted_source_url(item['url'])
                or any(not is_hash(item[key]) for key in endpoint_fields-{'url'})): return False
        try:
            if item['visible_resource_sha256']!=request_resource_hash(item['url']): return False
        except ValueError: return False
        # A URL without hidden query values retains a recomputable resource key.
        if not urlparse(item['url']).query and item['resource_sha256']!=item['visible_resource_sha256']: return False
        if item['url_sha256'] in identities: return False
        identities.add(item['url_sha256']); resources.add(item['resource_sha256'])
    return value['candidate_sha256'] in identities and value['terminal_resource_sha256'] in resources


def reference_cache_state(entry, meta, path, candidate):
    row = entry.get('catalogue') or {}
    if 'source_resolution' not in row: return 'legacy'
    receipt = meta.get('request_provenance')
    held = registry.references.withheld_static_identities(row)
    if receipt is None: return 'destination_unverified' if held else 'legacy_public_unverified'
    if not candidate or not request_receipt_valid(receipt,candidate): return 'invalid'
    if receipt['artifact_kind']!='archive' or not path.is_file(): return 'invalid'
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        while chunk:=stream.read(1048576):digest.update(chunk)
    if digest.hexdigest()!=receipt['artifact_sha256']: return 'invalid'
    resources={registry.references.digest(key) for key in registry.references.withheld_static_resources(row)}
    uncertain={registry.references.digest(key) for key in registry.references.uncertain_static_resources(row)}
    for endpoint in receipt['endpoints']:
        if (endpoint['url_sha256'] in held or endpoint['resource_sha256'] in resources
                or endpoint['visible_resource_sha256'] in uncertain): return 'held'
    return 'verified'


def source_attempt(url, error):
    """Structured evidence of a particular endpoint failing, not feed exclusion."""
    code = 'other_source_error'
    if isinstance(error, retry.RetryAfterDeferred):
        return {'url': redacted_source_url(url), 'url_sha256': source_url_fingerprint(url),
                'code': 'retry_after_pending', 'message': 'Source Retry-After deadline has not elapsed',
                'retry_after_not_before': error.not_before, 'http_status': error.status,
                'deferred_endpoint_sha256': error.fingerprint}
    if isinstance(error, SourceAccessHold):
        code = 'source_access_hold'
    elif isinstance(error, SourceIdentityChanged):
        code = 'source_identity_changed'
    elif isinstance(error, CacheAccessHold):
        return {'url':redacted_source_url(url),'url_sha256':source_url_fingerprint(url),
            'code':'source_cache_access_hold','message':'Previously checked cached destination is now access-held; reuse paused'}
    elif isinstance(error, CacheIdentityUnresolved):
        return {'url':redacted_source_url(url),'url_sha256':source_url_fingerprint(url),
            'code':'source_cache_identity_unresolved','message':'Cached destination evidence is unavailable or invalid; reuse paused'}
    elif isinstance(error, SourcePolicyError):
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
    result = {'url': redacted_source_url(url), 'url_sha256': source_url_fingerprint(url),
              'code': code, 'message': message}
    if retry.finite_number(getattr(error, 'retry_after_not_before', None)):
        result['retry_after_not_before'] = error.retry_after_not_before
    return result


def routes_have_rail(data):
    """Validate every route before choosing a source or retiring rail coverage.

    A rail row is not permission to short-circuit validation of later rows.
    Malformed metadata stays a retriable source failure, including on refresh.
    """
    try:
        routes = csv.DictReader(io.StringIO(data.decode('utf-8-sig')), strict=True)
        if not {'route_id', 'route_type'}.issubset(routes.fieldnames or []):
            raise ValueError('Missing routes.txt route_id or route_type column')
        has_rail = False
        for number, row in enumerate(routes, 1):
            if number > compiler.MAX_TABLE_ROWS:
                raise ValueError('Routes metadata exceeds row budget')
            if not (row.get('route_id') or '').strip():
                raise ValueError('Missing routes.txt route_id value')
            rail = compiler.rail_type(row.get('route_type') or '')
            has_rail = has_rail or rail
        return has_rail
    except csv.Error:
        raise ValueError('Invalid routes.txt CSV metadata') from None


def unpack_zip_metadata(layout, data):
    try:
        return struct.unpack(layout, data)
    except struct.error:
        raise ValueError('Truncated ZIP metadata structure') from None


def source_archive(source):
    """Convert malformed/unsupported archive headers, not arbitrary failures."""
    try:
        return zipfile.ZipFile(source)
    except ZIP_METADATA_ERRORS:
        raise ValueError('Unreadable ZIP directory') from None


def archive_metadata(archive, name):
    """Normalize only ZIP-member decoding failures into source failures."""
    try:
        info = archive.getinfo(name)
    except KeyError:
        raise ValueError('Missing '+name) from None
    if info.file_size > 128_000_000:
        raise ValueError('Metadata table exceeds budget')
    if info.flag_bits & 1:
        raise ValueError('Encrypted ZIP metadata')
    try:
        return archive.read(info)
    except ZIP_METADATA_ERRORS:
        raise ValueError('Unreadable ZIP metadata') from None
    except RuntimeError as error:
        # zipfile reports unavailable optional codecs as RuntimeError. Do not
        # turn unrelated programmer/control-flow failures into feed failures.
        if re.fullmatch(r'Compression requires the \(missing\) (?:zlib|bz2|lzma) module', str(error)):
            raise ValueError('Unavailable ZIP metadata codec') from None
        raise


def archive_has_rail(archive):
    """Use the same bounded metadata validation for full and cached ZIPs."""
    return routes_have_rail(archive_metadata(archive, 'routes.txt'))


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
        with source_archive(path) as archive:
            return archive_has_rail(archive)
    except (ValueError, OSError, zipfile.BadZipFile):
        return False


def fetch_alternative(entry, path, max_bytes, skip=(), *, retry_state=None, publication_context=None):
    """Fallback to another real published schedule, without inventing data.

    Cache writes only after a valid ZIP has been downloaded. Each upstream
    failure stays attached to the resulting source entry for investigation.
    """
    attempts, unsafe_urls = [], set()
    for url in source_candidates(entry, publication_context):
        if url in skip:
            continue
        try:
            checked = CheckedRequests(entry,url) if 'source_resolution' in (entry.get('catalogue') or {}) else None
            remote = RemoteZip(url, max_bytes, policy=checked.policy if checked else lambda target: source_policy(entry, target),
                retry_state=retry_state, checked_requests=checked)
            # Keep the cheap preflight: bus-only GTFS must not download its
            # entire stop_times/shapes archive or consume a compile slot.
            routes = remote.table('routes.txt')
            if not routes_have_rail(routes):
                return {
                    **({'request_provenance':checked.receipt(routes,'routes')} if checked else {}),
                    'no_rail': True, 'download_url': redacted_source_url(url),
                    'download_url_sha256': source_url_fingerprint(url),
                    'etag': remote.etag, 'last_modified': remote.last_modified,
                    'retrieved': dt.datetime.now(dt.timezone.utc).date().isoformat()
                }, attempts
            with source_archive(io.BytesIO(remote.download())) as archive:
                if not archive_has_rail(archive):
                    raise ValueError('Rail metadata changed during full download')
            data = remote.full
            temporary = path.with_suffix('.download.tmp')
            temporary.write_bytes(data)
            temporary.replace(path)
            return {
                **({'request_provenance':checked.receipt(data)} if checked else {}),
                'etag': remote.etag, 'last_modified': remote.last_modified,
                'download_url': redacted_source_url(url), 'download_url_sha256': source_url_fingerprint(url),
                'retrieved': dt.datetime.now(dt.timezone.utc).date().isoformat()
            }, attempts
        except (retry.RetryAfterDeferred, HTTPError, URLError, TimeoutError, ConnectionError, OSError, ValueError, zipfile.BadZipFile, http.client.HTTPException) as error:
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
    def __init__(self, url, max_bytes, *, policy=None, retry_state=None, checked_requests=None):
        self.url, self.max_bytes, self.policy, self.retry_state = url, max_bytes, policy, retry_state
        self.checked_requests = checked_requests
        self.full, self.identity = None, None
        with get(url, {'Range': 'bytes=-65557'}, policy=self.policy, retry_state=self.retry_state,
                **({'request_evidence':self.checked_requests} if self.checked_requests else {})) as response:
            if self.checked_requests: self.checked_requests.response(response.url)
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
        _, disk, start_disk, _, count, length, start, comment = unpack_zip_metadata('<4s4H2IH', tail[index:index+22])
        if disk or start_disk or index+22+comment != len(tail) or count == 65535 or start == 0xffffffff:
            self.directory = None
            return
        if start+length > offset+index:
            raise ValueError('ZIP directory exceeds archive bounds')
        directory = tail[start-offset:start-offset+length] if start >= offset else self.range(start, start+length-1)
        if len(directory) != length:
            raise ValueError('Truncated ZIP directory')
        self.directory = {}
        position = 0
        for _ in range(count):
            values = unpack_zip_metadata('<4s6H3I5H2I', directory[position:position+46])
            if values[0] != b'PK\x01\x02':
                raise ValueError('Invalid ZIP directory record')
            _, _, _, flags, method, _, _, _, compressed, uncompressed, name_len, extra_len, comment_len, _, _, _, location = values
            if position+46+name_len+extra_len+comment_len > len(directory):
                raise ValueError('Truncated ZIP directory fields')
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
        with get(self.url, headers, policy=self.policy, retry_state=self.retry_state,
                **({'validator_resource_sha256':self.checked_requests.terminal,'request_evidence':self.checked_requests} if self.checked_requests else {})) as response:
            if self.checked_requests: self.checked_requests.response(response.url)
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
            with source_archive(io.BytesIO(self.full)) as archive:
                return archive_metadata(archive, name)
        if self.directory is None:
            self.download()
            return self.table(name)
        if name not in self.directory:
            raise ValueError('Missing '+name)
        start, length, expanded = self.directory[name]
        if length > 32_000_000 or expanded > 128_000_000:
            raise ValueError('Metadata table exceeds budget')
        header = self.range(start, start+29)
        fields = unpack_zip_metadata('<4s5H3I2H', header)
        if fields[0] != b'PK\x03\x04':
            raise ValueError('Invalid ZIP local header')
        flags, method, name_len, extra_len = fields[2], fields[3], fields[-2], fields[-1]
        if flags & 1:
            raise ValueError('Encrypted feed')
        data = self.range(start+30+name_len+extra_len, start+30+name_len+extra_len+length-1)
        if method == 8:
            inflater = zlib.decompressobj(-15)
            try:
                data = inflater.decompress(data, expanded+1)
            except zlib.error:
                raise ValueError('Unreadable ZIP metadata') from None
            if inflater.unconsumed_tail or not inflater.eof:
                raise ValueError('Metadata expansion exceeds declared budget')
        elif method != 0:
            raise ValueError('Unsupported ZIP compression')
        if len(data) != expanded:
            raise ValueError('Invalid expanded metadata')
        return data

    def download(self):
        if self.full is None:
            with get(self.url, policy=self.policy, retry_state=self.retry_state,
                    **({'request_evidence':self.checked_requests} if self.checked_requests else {})) as response:
                if self.checked_requests: self.checked_requests.response(response.url)
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


def compile_entry(entry, cache, output, date, graph, max_bytes, profiles, max_seconds=600, *, retry_state=None, publication_context=None):
    ident, row = entry['id'], entry['catalogue']
    reference_state = registry.references.resolution_state(row, publication_context)
    if reference_state is not None and (reference_state != 'schedule'
            or row['source_resolution'].get('acquisition_alias_of')):
        raise ValueError('Source reference is not acquisition eligible')
    if retry_state is None:
        retry_state = retry.RetryAfterCache(cache)
    path, meta_path = cache/(ident+'.zip'), cache/(ident+'.meta.json')
    # 304 from the same successful source may reuse cache. A 404 or transient
    # outage MUST fall through to other known originals, not reject the feed.
    invalid_cache_metadata = False
    if reference_state is not None and meta_path.exists():
        try:
            with meta_path.open('rb') as stream: metadata_bytes = stream.read(MAX_REFERENCE_CACHE_METADATA_BYTES+1)
            if len(metadata_bytes)>MAX_REFERENCE_CACHE_METADATA_BYTES: raise ValueError('Reference cache metadata budget exceeded')
            meta = registry.publication.parsed(metadata_bytes)
            if not isinstance(meta,dict): raise ValueError('Invalid reference cache metadata')
        except (OSError,ValueError,TypeError,UnicodeError,RecursionError):
            meta,invalid_cache_metadata = {},True
    else:
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    headers = {'If-None-Match': meta['etag']} if meta.get('etag') else {'If-Modified-Since':meta['last_modified']} if meta.get('last_modified') else {}
    fresh, attempted, attempts, unsafe_urls = False, set(), [], set()
    cached_url = cached_source_url(meta, source_candidates(entry, publication_context), entry.get('processed_url'))
    cache_state = reference_cache_state(entry,meta,path,cached_url) if cached_url else 'unavailable'
    if invalid_cache_metadata: cache_state='invalid'
    cache_eligible = cache_state in ('legacy','legacy_public_unverified','verified')
    if invalid_cache_metadata and path.exists() and not cached_url:
        candidates = source_candidates(entry,publication_context)
        attempts.append(source_attempt(candidates[0] if candidates else '',CacheIdentityUnresolved()))
    if path.exists() and cached_url and not cache_eligible:
        attempts.append(source_attempt(cached_url,CacheAccessHold() if cache_state=='held' else CacheIdentityUnresolved()))
    checked = CheckedRequests(entry,cached_url,meta['request_provenance']['terminal_resource_sha256']) if cache_state=='verified' else None
    if cached_url:
        meta['download_url'] = redacted_source_url(cached_url)
        meta['download_url_sha256'] = source_url_fingerprint(cached_url)
    if (path.exists() and headers and cache_state in ('legacy','verified')
            and cached_url in source_candidates(entry, publication_context)):
        try:
            with get(cached_url, headers, policy=checked.policy if checked else lambda target: source_policy(entry, target), retry_state=retry_state,
                    **({'validator_resource_sha256':checked.terminal,'request_evidence':checked} if checked else {})) as response:
                # A new 200 representation may establish a new public terminal.
                if checked:
                    checked.terminal = None
                    checked.response(response.url)
                data = RemoteZip.read_bounded(type('Budget', (), {'max_bytes': max_bytes})(), response)
                # Never replace a previously usable ZIP with an error page or
                # malformed archive returned as HTTP 200.
                with source_archive(io.BytesIO(data)) as archive:
                    archive_has_rail(archive)
                temporary = path.with_suffix('.download.tmp')
                temporary.write_bytes(data)
                temporary.replace(path)
                meta = {**({'request_provenance':checked.receipt(data)} if checked else {}),
                        'etag': response.headers.get('ETag'), 'last_modified':response.headers.get('Last-Modified'),
                        'download_url': redacted_source_url(cached_url),
                        'download_url_sha256': source_url_fingerprint(cached_url),
                        'retrieved': dt.datetime.now(dt.timezone.utc).date().isoformat()}
                fresh = True
        except HTTPError as error:
            if error.code == 304:
                error.close()
                try:
                    # A validator confirms origin identity, not that an older
                    # local cache passed today's complete metadata checks.
                    if checked:
                        checked.response(error.url)
                        # Merge checked revalidation hops into the historical
                        # chain without claiming they produced the old bytes.
                        receipt=meta['request_provenance']
                        combined={item['url_sha256']:item for item in receipt['endpoints']}
                        combined.update(checked.endpoints)
                        if len(combined)>MAX_CHECKED_ENDPOINTS: raise ValueError('Request provenance endpoint budget exceeded')
                        receipt['endpoints']=list(combined.values())
                    if not meta.get('no_rail'):
                        with source_archive(path) as archive:
                            archive_has_rail(archive)
                    meta['download_url'] = redacted_source_url(cached_url)
                    meta['download_url_sha256'] = source_url_fingerprint(cached_url)
                    meta.pop('offline_cached', None)
                    meta.pop('recovered_source_errors', None)
                    retry_state.metrics['conditional_not_modified'] += 1
                    fresh = True
                except (OSError, ValueError, zipfile.BadZipFile) as invalid:
                    # Retry an unconditionally fetched public representation;
                    # changed-terminal 304 never certifies previous bytes.
                    if not checked: attempted.add(cached_url)
                    if isinstance(invalid, SourceIdentityChanged): unsafe_urls.add(cached_url)
                    attempts.append(source_attempt(cached_url, invalid))
            else:
                attempted.add(cached_url)
                attempts.append(source_attempt(cached_url, error))
        except (retry.RetryAfterDeferred, URLError, TimeoutError, ConnectionError, OSError, ValueError, zipfile.BadZipFile, http.client.HTTPException) as error:
            attempted.add(cached_url)
            if isinstance(error, (SourcePolicyError, UnsafeSourceURL)):
                unsafe_urls.add(cached_url)
            attempts.append(source_attempt(cached_url, error))
    if not fresh:
        try:
            meta, more_attempts = fetch_alternative(entry, path, max_bytes, skip=attempted, retry_state=retry_state, publication_context=publication_context)
            attempts.extend(more_attempts)
        except SourceRetrievalError as error:
            attempts.extend(error.attempts)
            unsafe_urls.update(error._unsafe_urls)
            safe_cache_urls = [url for url in source_candidates(entry, publication_context) if url not in unsafe_urls]
            if cache_eligible and valid_cached_archive(path, meta, safe_cache_urls):
                # Continue compiling using the last successfully retrieved
                # ZIP. Never advance its 'checked' or 'retrieved' timestamps.
                meta['offline_cached'] = True
                retry_state.metrics['offline_archive_uses'] += 1
                meta['recovered_source_errors'] = attempts
                fresh = True
            else:
                raise SourceRetrievalError(attempts, unsafe_urls, dict(retry_state.metrics)) from error
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
        return {**entry, 'status': 'no_rail', 'rail_routes': 0, 'acquisition_metrics': dict(retry_state.metrics)}
    # Reinspect changed conditional 200 responses and cached 304 revisions.
    with source_archive(path) as archive:
        has_rail=archive_has_rail(archive)
    if not meta.get('offline_cached'):
        meta['checked'] = dt.datetime.now(dt.timezone.utc).date().isoformat()
    atomic_json(meta_path, meta)
    if not has_rail:
        (output/'feeds'/(ident+'.json.gz')).unlink(missing_ok=True)
        return {**entry, 'status': 'no_rail', 'rail_routes': 0, 'acquisition_metrics': dict(retry_state.metrics)}
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    signature=hashlib.sha256(json.dumps({'catalogue':row,'profiles':profiles,'denied_source_urls':entry.get('denied_source_urls', []),
        'graph':file_hash(str(graph)) if graph else None,
        'compiler':[file_hash(str(ROOT/'scripts'/name)) for name in ['global-service-frequency.py','frequency_catalogue.py','frequency_references.py','frequency_publication.py','frequency-reference-schema.json','gtfs-frequency.py','gtfs-shapes.py','gtfs-rail-paths.py']]},sort_keys=True).encode()).hexdigest()
    destination = output/'feeds'/(ident+'.json.gz')
    if destination.exists():
        with gzip.open(destination, 'rt') as file:
            previous = json.load(file)
        if previous['source']['sha256'] == digest and previous['source']['service_date'] == date and previous['source'].get('input_signature') == signature:
            retry_state.metrics['compiled_cache_hits'] += 1
            previous['source'] = published_metadata(previous['source'])
            previous['source']['checked'] = meta['checked']
            previous['source']['download_url'] = meta['download_url']
            previous['source']['download_url_sha256'] = meta['download_url_sha256']
            previous['source']['offline_cached'] = bool(meta.get('offline_cached'))
            previous['source']['recovered_source_errors'] = meta.get('recovered_source_errors', [])
            write_feed(destination, previous)
            return {**entry, 'status': 'compiled', 'output': 'feeds/'+destination.name, 'sha256': digest,
                    'rail_routes': len(previous['routes']), 'mapped_segments': len(previous['segments']),
                    'unmapped_segments': len(previous.get('unmapped_segments', [])), 'source': previous['source'],
                    'acquisition_metrics': dict(retry_state.metrics)}
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
            'unmapped_segments': len(result.get('unmapped_segments', [])), 'source': source,
            'acquisition_metrics': dict(retry_state.metrics)}


def compile_entry_isolated(entry, cache, output, date, graph, max_bytes, profiles,
                           max_seconds=600, max_memory_bytes=3_000_000_000, publication_context=None):
    """Keep a failed feed's memory/CPU budget separate from its worldwide shard."""
    payload={'entry':entry,'cache':str(cache),'output':str(output),'date':date,
             'graph':str(graph) if graph else None,'max_bytes':max_bytes,
             'profiles':profiles,'max_seconds':max_seconds,'max_memory_bytes':max_memory_bytes,
             'publication_context':publication_context.worker_record(entry.get('catalogue') or {}) if publication_context is not None else None}
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
                raise SourceRetrievalError(result['source_attempts'], acquisition_metrics=result.get('acquisition_metrics'))
            error = RuntimeError(result.get('error') or f'Feed compiler exited {process.returncode}')
            error.acquisition_metrics = result.get('acquisition_metrics', {})
            raise error
        return result['entry']


def compile_one(request, response):
    import resource
    payload=json.loads(Path(request).read_text())
    payload['publication_context'] = registry.publication.from_worker(payload.get('publication_context'))
    limit=payload.pop('max_memory_bytes')
    resource.setrlimit(resource.RLIMIT_AS,(limit,limit))
    for key in ['cache','output']:
        payload[key]=Path(payload[key])
    if payload['graph']:
        payload['graph']=Path(payload['graph'])
    retry_state = retry.RetryAfterCache(payload['cache'])
    try:
        atomic_json(Path(response),{'entry':published_metadata(compile_entry(**payload, retry_state=retry_state))})
    except SourceRetrievalError as error:
        atomic_json(Path(response),{'error':str(error)[:2000], 'source_attempts':error.attempts,
                                    'acquisition_metrics':dict(retry_state.metrics)})
        return 1
    except Exception as error:
        atomic_json(Path(response),{'error':redacted_diagnostic(f'{type(error).__name__}: {error}')[:2000],
                                    'acquisition_metrics':dict(retry_state.metrics)})
        return 1
    return 0


def classify_failure(error):
    """Annotate the unresolved failure; it remains eligible for future attempts."""
    if isinstance(error, SourceRetrievalError):
        codes = {x['code'] for x in error.attempts}
        if 'source_cache_identity_unresolved' in codes:
            return 'unresolved_source_cache_identity', 'retrieval'
        if codes & {'source_access_hold','source_cache_access_hold'}:
            return 'source_access_review', 'retrieval'
        if 'source_identity_changed' in codes:
            return 'source_reference_identity_changed', 'retrieval'
        if codes == {'retry_after_pending'}:
            return 'source_retry_after', 'retrieval'
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


def catalogue_provenance(report_path, catalogue_hash, catalogue_entries, local, report=None):
    """Bind reconciled provenance to these exact input bytes, never guess it."""
    if report_path is None:
        return {'schema': 1, 'kind': 'local-unverified' if local else 'transitous-licences',
                'sources': [] if local else [CATALOGUE]}
    if report is None:
        report = registry.publication.read_report(report_path)
    if (not isinstance(report, dict) or report.get('schema') not in (2, 3, 4)
            or report.get('catalogue_sha256') != catalogue_hash
            or not isinstance(report.get('counts'), dict)
            or report['counts'].get('merged_entries') != catalogue_entries):
        raise ValueError('Catalogue report does not match the input catalogue')
    sources = registry.catalogue_sources(report.get('transitous_ref'))
    reference_provenance = {}
    if report['schema'] >= 3:
        ref, state, reason = report.get('transitland_ref'), report.get('transitland_state'), report.get('transitland_reason')
        if ref is not None:
            sources.append(registry.references.pinned_url(ref))
        if state not in ('available', 'unavailable') or not isinstance(reason, str) or reason not in registry.references.METADATA_REASONS:
            raise ValueError('Catalogue report has invalid reference input state')
        reference_provenance = {'transitland_ref': ref, 'transitland_state': state, 'transitland_reason': reason}
    hashes = report.get('input_sha256')
    if (report.get('sources') != sources or not isinstance(hashes, dict)
            or any(not isinstance(hashes.get(key), str) or not re.fullmatch(r'[a-f0-9]{64}', hashes[key])
                   for key in ('transitous_licences', 'transitous_feeds', 'mobility_csv'))):
        raise ValueError('Catalogue report is missing pinned input identities')
    keys = ['transitous_licences', 'transitous_feeds', 'mobility_csv']
    if report['schema'] >= 3:
        digest = hashes.get('transitland_feeds')
        if ((reference_provenance['transitland_state'] == 'available' and
                (reference_provenance['transitland_ref'] is None or not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest)))
                or (reference_provenance['transitland_state'] == 'unavailable' and digest is not None)):
            raise ValueError('Catalogue report has invalid reference input identity')
        keys.append('transitland_feeds')
    # Copy only the public provenance schema, not arbitrary report metadata.
    return {'schema': 2 if report['schema'] >= 3 else 1, 'kind': 'reconciled', 'transitous_ref': report['transitous_ref'],
            'sources': sources, 'input_sha256': {key: hashes[key] for key in keys}, **reference_provenance}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalogue', help='Local catalogue for offline reproduction; default downloads worldwide registry')
    parser.add_argument('--catalogue-report', type=Path, help='Matching reconciliation report with pinned upstream identities')
    parser.add_argument('--publication-index', type=Path, help='Explicit secret-free membership artifact from the catalogue producer')
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
    if args.catalogue_report and not args.catalogue:
        parser.error('--catalogue-report requires --catalogue')
    if args.publication_index and not args.catalogue_report:
        parser.error('--publication-index requires --catalogue-report')
    dt.date.fromisoformat(args.date)
    args.cache.mkdir(parents=True, exist_ok=True)
    data = Path(args.catalogue).read_bytes() if args.catalogue else get(CATALOGUE).read()
    catalogue_hash = hashlib.sha256(data).hexdigest()
    rules = json.loads(args.rules.read_text())
    rows = json.loads(data)
    report = registry.publication.read_report(args.catalogue_report) if args.catalogue_report else None
    provenance = catalogue_provenance(args.catalogue_report, catalogue_hash, len(rows), bool(args.catalogue), report)
    publication_context, publication_state = registry.publication.read_context(args.publication_index, report)
    if args.publication_index or args.catalogue_report:
        provenance['publication_context'] = {'state': publication_state}
        if publication_context is not None:
            provenance['publication_context']['index_sha256'] = file_hash(str(args.publication_index))
    entries = discover(rows, rules, publication_context)
    previous_path = args.output/f'inventory-{args.shard}.json'
    outcomes = []
    def save():
        atomic_json(previous_path, {'schema': 3, 'catalogue_url': None if args.catalogue else CATALOGUE, 'catalogue_sha256': catalogue_hash,
            'catalogue_provenance': published_metadata(provenance),
            'catalogue_entries': len(entries), 'service_date': args.date, 'shard': args.shard, 'shards': args.shards,
            'scope': 'Worldwide timetable discovery plus explicit source-reference outcomes; no city allow-list',
            'counts': dict(Counter(x['status'] for x in outcomes)),
            'reason_codes': dict(Counter(x.get('reason_code') or 'none' for x in outcomes)),
            'entries': published_metadata(outcomes)})
    for entry in entries:
        if int(hashlib.sha256(entry['id'].encode()).hexdigest(), 16) % args.shards != args.shard:
            continue
        if entry['status'] == 'pending' and not args.inventory_only:
            try:
                entry = compile_entry_isolated(entry, args.cache, args.output, args.date, args.rail_graph, args.max_feed_bytes, rules.get('profiles', PROFILES), args.max_compile_seconds, args.max_compile_memory_bytes, publication_context)
            except Exception as error:
                code, stage = classify_failure(error)
                entry = {**entry, 'status': 'retry_pending', 'reason': redacted_diagnostic(f'{type(error).__name__}: {error}'),
                         'reason_code': code, 'failure_stage': stage, 'retry_eligible': True,
                         'next_action': ('repair_or_find_feed_url' if code in ('source_http_404', 'missing_source_url')
                                         else 'review_source_access_or_declared_public_alternative' if code == 'source_access_review'
                                         else 'refresh_from_public_source_or_review_cache_provenance' if code == 'unresolved_source_cache_identity'
                                         else 'refresh_from_public_source_or_review_source_identity' if code == 'source_reference_identity_changed'
                                         else 'retry_source_or_repair_compiler'),
                         'source_attempts': error.attempts if isinstance(error, SourceRetrievalError) else []}
                entry['acquisition_metrics'] = getattr(error, 'acquisition_metrics', {})
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
