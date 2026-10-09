"""Offline, bounded reference resolution; no provider requests or upstream code.

The legacy filename is an inventory identity, not proof of a downloadable GTFS.
This module only adds evidence to the existing row universe. Acquisition policy,
rights, public-address validation and publication redaction remain downstream.
"""
from collections import Counter, defaultdict
from copy import deepcopy
import hashlib
import ipaddress
import json
from pathlib import Path
import re
from urllib.parse import urlsplit, urlparse, parse_qsl

MAX_FILES = 4096
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_TOTAL_BYTES = 32 * 1024 * 1024
MAX_RECORDS = 50000
MAX_RECORD_BYTES = 65536
MAX_DECLARATIONS = 64
MAX_STRING = 4096
ROLE_SPECS = {'static_current': 'gtfs', 'realtime_trip_updates': 'gtfs-rt',
              'realtime_vehicle_positions': 'gtfs-rt', 'realtime_alerts': 'gtfs-rt',
              'gbfs_auto_discovery': 'gbfs'}
REFERENCE_TYPES = {'transitland-atlas', 'mobility-database'}
METADATA_REASONS = {'', 'not_supplied', 'metadata_unavailable', 'metadata_file_limit',
    'metadata_empty', 'metadata_invalid_file', 'metadata_byte_limit', 'metadata_invalid_document',
    'metadata_record_limit', 'metadata_invalid_record', 'metadata_record_byte_limit', 'metadata_invalid_or_unreadable'}


_METADATA_SCHEMA = json.loads(Path(__file__).with_name('frequency-reference-schema.json').read_text())


def metadata_shape_valid(value, shape='root'):
    """Shared allowlist; no unrecognized nested values reach public evidence."""
    budget = [_METADATA_SCHEMA['node_limit'], _METADATA_SCHEMA['character_limit']]
    def check(value, spec, depth=0):
        budget[0] -= 1
        if budget[0] < 0 or depth > _METADATA_SCHEMA['depth_limit']:
            return False
        if 'ref' in spec:
            spec = _METADATA_SCHEMA['shapes'][spec['ref']]
        if value is None and spec.get('nullable'):
            return True
        kind = spec['kind']
        if kind == 'string':
            if not isinstance(value, str) or not spec['min'] <= len(value) <= spec['max']:
                return False
            units = len(value.encode('utf-16-le', errors='surrogatepass')) // 2
            if units > spec['max']: return False
            budget[1] -= units
            return (budget[1] >= 0 and (not spec.get('pattern') or re.fullmatch(spec['pattern'], value) is not None)
                and (spec.get('format') not in ('url', 'url_or_empty') or
                     spec.get('format') == 'url_or_empty' and value == '' or bool(_url(value))))
        if kind == 'boolean': return type(value) is bool
        if kind == 'integer': return type(value) is int and value == spec['value']
        if kind == 'enum': return isinstance(value, str) and value in spec['values']
        if kind == 'array':
            return isinstance(value, list) and len(value) <= spec['max'] and all(check(item, spec['item'], depth+1) for item in value)
        if not isinstance(value, dict) or len(value) > 2*len(spec['fields']): return False
        if any(key not in value for key in spec['required']): return False
        for key, item in value.items():
            field = spec['fields'].get(key)
            # Publication adds original-URL fingerprints. Accept only hashes of
            # known string fields, preserving one-way redaction idempotence.
            if field is None and isinstance(key, str) and key.endswith('_sha256'):
                base = spec['fields'].get(key[:-7], {})
                if base.get('kind') == 'string': field = {'kind':'string','min':64,'max':64,'pattern':'[a-f0-9]{64}'}
            if field is None or not check(item, field, depth+1): return False
        return True
    try:
        return check(value, _METADATA_SCHEMA['shapes'][shape])
    except (TypeError, ValueError, RecursionError):
        return False


def _project_shape(value, shape='root'):
    # Retain only complete safe subrecords. Never serialize/hash invalid bytes,
    # echo unknown keys, or infer acquisition permission from a repaired graph.
    missing = object()
    budget = [_METADATA_SCHEMA['node_limit'], _METADATA_SCHEMA['character_limit']]
    def project(value, spec, depth=0):
        budget[0] -= 1
        if budget[0] < 0 or depth > _METADATA_SCHEMA['depth_limit']: return missing
        if 'ref' in spec: spec = _METADATA_SCHEMA['shapes'][spec['ref']]
        if value is None and spec.get('nullable'): return None
        kind = spec['kind']
        if kind == 'object':
            if not isinstance(value, dict): return missing
            result = {}
            for key, field in spec['fields'].items():
                if key in value:
                    item = project(value[key], field, depth+1)
                    if item is not missing: result[key] = item
                hash_key = key + '_sha256'
                if field.get('kind') == 'string' and hash_key not in spec['fields'] and hash_key in value:
                    item = project(value[hash_key], {'kind':'string','min':64,'max':64,'pattern':'[a-f0-9]{64}'}, depth+1)
                    if item is not missing: result[hash_key] = item
            return result if all(key in result for key in spec['required']) else missing
        if kind == 'array':
            if not isinstance(value, list): return missing
            result = []
            for item in value[:spec['max']]:
                item = project(item, spec['item'], depth+1)
                if item is not missing: result.append(item)
            return result
        if kind == 'string':
            if not isinstance(value, str) or len(value) > spec['max']: return missing
            units = len(value.encode('utf-16-le', errors='surrogatepass')) // 2
            if units > spec['max']: return missing
            budget[1] -= units
            valid = (spec['min'] <= len(value) <= spec['max'] and budget[1] >= 0
                and (not spec.get('pattern') or re.fullmatch(spec['pattern'], value) is not None)
                and (spec.get('format') not in ('url', 'url_or_empty') or
                     spec.get('format') == 'url_or_empty' and value == '' or bool(_url(value))))
        elif kind == 'boolean': valid = type(value) is bool
        elif kind == 'integer': valid = type(value) is int and value == spec['value']
        else: valid = isinstance(value, str) and value in spec['values']
        return value if valid else missing
    try:
        safe = project(value, _METADATA_SCHEMA['shapes'][shape])
    except (TypeError, ValueError, RecursionError):
        safe = missing
    return safe if safe is not missing else None


def hold_metadata(safe):
    hold = deepcopy(_METADATA_SCHEMA['invalid'])
    if isinstance(safe, dict):
        # Preserve specs and individually projected provenance; invalidate every
        # acquisition-affecting top-level selection and basis.
        hold = {**safe, **{key: item for key, item in hold.items()
                         if key not in ('specs', 'declarations', 'ordinary_static_declarations')}}
    return hold


def project_metadata(value):
    return value if metadata_shape_valid(value) else hold_metadata(_project_shape(value))


def lineage_valid(row, item):
    """Complete generated identity, not a cryptographic authenticity guarantee."""
    if not isinstance(item, dict): return False
    kind = item.get('catalogue')
    shape = _METADATA_SCHEMA['lineage']['shapes'].get(kind) if isinstance(kind, str) else None
    if not shape or not metadata_shape_valid(item, shape): return False
    if kind == 'transitous-licence':
        return (item['id'] == row.get('filename') and item['id'].endswith('.gtfs.zip')
            and '/' not in item['id'] and '\\' not in item['id']
            and row.get('delivery') == 'transitous' and item['url'] == row.get('catalogue_url')
            and re.fullmatch(_METADATA_SCHEMA['lineage']['transitous_origin_pattern'], item['url']) is not None)
    if kind == 'mobility-database':
        return item['url'] == _METADATA_SCHEMA['lineage']['mobility_origin']
    return True


def project_row(row):
    """Only new-schema reference rows cross the extended lineage boundary."""
    if 'source_resolution' not in row: return row
    metadata = project_metadata(row['source_resolution'])
    result = {**row, 'source_resolution': metadata}
    if 'lineage' not in row: return result
    lineage = row['lineage']; maximum = _METADATA_SCHEMA['lineage']['max_records']
    valid = isinstance(lineage, list) and len(lineage) <= maximum
    safe = []
    for item in lineage[:maximum] if isinstance(lineage, list) else []:
        if lineage_valid(row, item): safe.append(item)
        else:
            valid = False
            record = _project_shape(item, 'lineage_safe')
            if record: safe.append(record)
    result['lineage'] = safe
    if not valid: result['source_resolution'] = hold_metadata(metadata)
    return result


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')).encode()).hexdigest()


def text(value, limit=MAX_STRING):
    return value if isinstance(value, str) and len(value) <= limit else ''


def legacy_id(filename):
    ident = filename[:-9]
    if re.fullmatch(r'[A-Za-z0-9_.-]+', ident):
        return ident
    prefix = re.sub(r'[^A-Za-z0-9_.-]', '-', ident).strip('-')[:70]
    return prefix + '-' + hashlib.sha256(filename.encode()).hexdigest()[:12]


def pinned_url(ref):
    if not isinstance(ref, str) or not re.fullmatch('[a-f0-9]{40}', ref):
        raise ValueError('Transitland ref must be a full pinned Git commit SHA')
    return 'https://github.com/transitland/transitland-atlas/tree/' + ref + '/feeds'


def unavailable(ref=None, reason='not_supplied'):
    return {'ref': ref, 'state': 'unavailable', 'reason': reason,
            'sha256': None, 'files': {}, 'by_id': {}}


def read_transitland(directory, ref):
    """A corrupt/incomplete local input is explicit, never an empty valid index."""
    pinned_url(ref)
    result = unavailable(ref)
    try:
        root = Path(directory)
        if not root.is_dir():
            return unavailable(ref, 'metadata_unavailable')
        paths = []
        for scanned, path in enumerate(root.iterdir(), 1):
            if scanned > MAX_FILES:
                raise ValueError('metadata_file_limit')
            if path.suffix != '.json':
                continue
            paths.append(path)
            if len(paths) > MAX_FILES:
                raise ValueError('metadata_file_limit')
        if not paths:
            raise ValueError('metadata_empty')
        files, index, total, records = {}, defaultdict(list), 0, 0
        for path in sorted(paths):
            if path.is_symlink() or not path.is_file():
                raise ValueError('metadata_invalid_file')
            with path.open('rb') as stream:
                data = stream.read(MAX_FILE_BYTES + 1)
            total += len(data)
            if len(data) > MAX_FILE_BYTES or total > MAX_TOTAL_BYTES:
                raise ValueError('metadata_byte_limit')
            obj = json.loads(data)
            if not isinstance(obj, dict) or not isinstance(obj.get('feeds'), list):
                raise ValueError('metadata_invalid_document')
            blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            files[path.name] = hashlib.sha256(data).hexdigest()
            for ordinal, feed in enumerate(obj['feeds']):
                records += 1
                if records > MAX_RECORDS:
                    raise ValueError('metadata_record_limit')
                if not isinstance(feed, dict) or not text(feed.get('id')):
                    raise ValueError('metadata_invalid_record')
                if len(json.dumps(feed, ensure_ascii=False).encode()) > MAX_RECORD_BYTES:
                    raise ValueError('metadata_record_byte_limit')
                index[feed['id']].append({'feed': feed,
                    'url': 'https://github.com/transitland/transitland-atlas/blob/' + ref + '/feeds/' + path.name,
                    'pointer': '/feeds/' + str(ordinal), 'blob_sha': blob})
        result = {'ref': ref, 'state': 'available', 'reason': '', 'sha256': digest(files),
                  'files': files, 'by_id': dict(index)}
    except (OSError, ValueError, TypeError, RecursionError, UnicodeError) as error:
        # Do not echo metadata contents, arbitrary paths, or exception text.
        allowed = {'metadata_file_limit', 'metadata_empty', 'metadata_invalid_file',
                   'metadata_byte_limit', 'metadata_invalid_document', 'metadata_record_limit',
                   'metadata_invalid_record', 'metadata_record_byte_limit'}
        reason = str(error) if str(error) in allowed else 'metadata_invalid_or_unreadable'
        result = unavailable(ref, reason)
    return result


def reference_url_valid(value):
    """Explicit shared URI grammar, independent of permissive native parsers."""
    grammar = _METADATA_SCHEMA['url_grammar']
    if not isinstance(value, str) or not value.isascii() or len(value) > grammar['max_length']:
        return False
    match = re.fullmatch(grammar['pattern'], value, re.I)
    if not match or re.search(r'%(?![a-fA-F0-9]{2})', value):
        return False
    # Bound the redacted representation too, so publication stays idempotent.
    before_fragment = value.split('#', 1)[0]
    if '?' in before_fragment:
        base, query = before_fragment.split('?', 1)
        pairs = query.split('&') if query else []
        if (len(pairs) > grammar['max_query_fields'] or len(base) + 1 + sum(
                max(len(pair.split('=', 1)[0]), 9) + 15 for pair in pairs) > grammar['max_length']):
            return False
    host, port = match.groups()
    if port is not None and int(port) > grammar['max_port']:
        return False
    if host.startswith('['):
        try:
            return ipaddress.ip_address(host[1:-1]).version == 6
        except ValueError:
            return False
    if len(host) > grammar['max_host_length']:
        return False
    labels = host.rstrip('.').split('.')
    if any(not re.fullmatch(grammar['label_pattern'], label) for label in labels):
        return False
    if re.fullmatch(grammar['numeric_label_pattern'], labels[-1]):
        try:
            return ipaddress.ip_address(host).version == 4
        except ValueError:
            return False
    return True


def reference_display_url(value):
    """Redact already supported URIs without a second host parser grammar."""
    grammar = _METADATA_SCHEMA['url_grammar']
    match = re.fullmatch(grammar['pattern'], value, re.I)
    host, port = match.groups()
    scheme, remainder = value.split('://', 1)
    tail_at = min((remainder.find(char) for char in '/?#' if char in remainder), default=len(remainder))
    tail = remainder[tail_at:].split('#', 1)[0]
    path, _, query = tail.partition('?')
    parameters = parse_qsl(query, keep_blank_values=True, max_num_fields=grammar['max_query_fields'])
    public_query = '&'.join((key if re.fullmatch(r'[A-Za-z0-9_.-]{1,80}', key) else 'parameter')
        + '=%5Bredacted%5D' for key, _ in parameters)
    return (scheme.lower() + '://' + host.lower() + (':' + port if port is not None else '')
        + (path or '/') + ('?' + public_query if public_query else ''))


def _url(value):
    return value if reference_url_valid(value) else ''


def _authorization(feed):
    auth = feed.get('authorization')
    if auth is None:
        return None
    if not isinstance(auth, dict) or not text(auth.get('type'), 80):
        return {'type': 'unknown'}
    result = {'type': text(auth.get('type'), 80)}
    name = text(auth.get('param_name'), 80)
    if name and re.fullmatch(r'[A-Za-z0-9_.-]+', name):
        result['parameter_name'] = name
    if _url(auth.get('info_url')):
        result['info_url'] = auth['info_url']
    return result


def resolve_declaration(item, source_url, ordinal, index, mobility):
    """Project a strict public metadata schema, never copy credentials/options."""
    kind = text(item.get('type'), 80)
    reference = text(item.get('transitland-atlas-id') if kind == 'transitland-atlas' else item.get('mdb-id'))
    declaration = {'id': digest([kind, reference]), 'type': kind,
        'reference_id': reference, 'declared_spec': text(item.get('spec'), 80) or None,
        'definition': {'url': source_url, 'pointer': '/sources/' + str(ordinal), 'sha256': digest(item)},
        'upstream_skip': item.get('skip') is True,
        'upstream_skip_reason': text(item.get('skip-reason')),
        'resolution': {'state': 'missing_reference', 'specs': [], 'endpoints': []}}
    resolution = declaration['resolution']
    override = item.get('url-override')
    if override is not None:
        # No encrypted or arbitrary non-URL value is retained.
        declaration['url_override_sha256'] = hashlib.sha256(str(override).encode()).hexdigest()
        if _url(override):
            declaration['url_override'] = override
        else:
            resolution['state'] = 'malformed_reference'
            return declaration
    if not reference:
        resolution['state'] = 'malformed_reference'
        return declaration
    if kind == 'transitland-atlas':
        matches = index.get('by_id', {}).get(reference, [])
        if index.get('state') != 'available':
            resolution['state'] = 'metadata_unavailable'
            return declaration
        if len(matches) != 1:
            resolution['state'] = 'conflicting_reference' if matches else 'missing_reference'
            return declaration
        match = matches[0]
        feed = match['feed']
        resolution.update({'metadata_url': match['url'], 'metadata_pointer': match['pointer'],
                           'metadata_blob_sha': match['blob_sha']})
        urls = feed.get('urls')
        if not isinstance(urls, dict):
            resolution['state'] = 'malformed_reference'
            return declaration
        spec = text(feed.get('spec'), 80)
        roles = [(role, urls[role]) for role in ROLE_SPECS if role in urls]
        authorization = _authorization(feed)
        licence = feed.get('license')
        if isinstance(licence, dict):
            declaration['licence'] = {k: text(licence.get(k)) for k in ('spdx_identifier', 'url') if text(licence.get(k))}
    elif kind == 'mobility-database':
        matches = mobility.get(reference, [])
        if len(matches) != 1:
            resolution['state'] = 'conflicting_reference' if matches else 'missing_reference'
            return declaration
        m = matches[0]
        spec = m['data_type']
        roles = [('static_current', m['download'])] if spec == 'gtfs' else []
        authorization = {'type': m['authentication_type']} if m['authentication_type'] not in ('', '0', 'none') else None
        resolution['metadata_url'] = 'https://files.mobilitydatabase.org/feeds_v2.csv'
        if spec in ('gtfs-rt', 'gbfs'):
            mismatch = declaration['declared_spec'] not in (None, spec)
            resolution.update({'state': 'conflicting_reference' if mismatch else 'resolved',
                               'specs': [spec], 'metadata_spec': spec, 'declared_spec_mismatch': mismatch})
            return declaration
    else:
        resolution['state'] = 'unsupported_type'
        return declaration
    role_specs = sorted({ROLE_SPECS[role] for role, _ in roles})
    resolution['metadata_spec'] = spec
    declared = declaration['declared_spec']
    # The upstream resolver selects endpoint roles, not the DMFR spec label.
    # Older registry RT entries sometimes retain spec=gtfs. Keep the mismatch
    # visible without turning a realtime endpoint into a timetable archive.
    resolution['metadata_spec_mismatch'] = bool(spec and spec not in role_specs)
    resolution['declared_spec_mismatch'] = bool(declared and declared not in role_specs)
    resolution['specs'] = role_specs
    legacy_rt_label = spec == 'gtfs' and role_specs == ['gtfs-rt']
    if legacy_rt_label:
        resolution['spec_precedence'] = 'endpoint_roles_legacy_rt_label'
    if ((resolution['metadata_spec_mismatch'] and not legacy_rt_label and roles)
            or resolution['declared_spec_mismatch']
            or ('gbfs' in role_specs and len(role_specs) > 1)):
        resolution['state'] = 'conflicting_reference'
        return declaration
    if not roles or any(not _url(url) for _, url in roles):
        resolution['state'] = 'malformed_reference'
        return declaration
    inherited_authorization = bool(item.get('api-key'))
    transport_options = bool(item.get('http-options') or item.get('function'))
    if transport_options:
        resolution['unsupported_options'] = [key for key in ('http-options', 'function') if item.get(key)]
    for role, url in roles:
        effective = override or url
        endpoint = {'role': role, 'spec': ROLE_SPECS[role], 'url': effective,
            'url_sha256': hashlib.sha256(effective.encode()).hexdigest(),
            'url_origin': 'url_override' if override else 'metadata',
            'access_state': ('authorization_required' if authorization or inherited_authorization else
                             'review_required' if transport_options else 'public_declared')}
        if override:
            endpoint['declared_url'] = url
            endpoint['declared_url_sha256'] = hashlib.sha256(url.encode()).hexdigest()
        if authorization:
            endpoint['authorization'] = authorization
        resolution['endpoints'].append(endpoint)
    resolution['specs'] = role_specs
    resolution['state'] = ('authorization_required' if any(e['access_state'] == 'authorization_required' for e in resolution['endpoints']) else
                           'transport_options_required' if transport_options else 'resolved')
    return declaration


def candidate_identities(row):
    lineage = row.get('lineage') if isinstance(row.get('lineage'), list) else []
    values = [row.get('source')] + [item.get('source') for item in lineage if isinstance(item, dict)]
    return {hashlib.sha256(value.encode()).hexdigest() for value in values if _url(value)}


def public_authentication(value):
    return value is None or isinstance(value, (str, int)) and str(value).strip().lower() in ('', '0', 'none')


def source_identities(item, key='source'):
    value = item.get(key)
    if not _url(value):
        return set()
    result = {hashlib.sha256(value.encode()).hexdigest()}
    stored = item.get(key + '_sha256')
    if isinstance(stored, str) and re.fullmatch('[a-f0-9]{64}', stored):
        result.add(stored)
    return result


def resource_key(value):
    """Acquisition's lexical resource identity, without policy or DNS inference."""
    if not isinstance(value, str) or any(ord(c) < 33 or ord(c) == 127 for c in value) or '\\' in value:
        return None
    try:
        parsed = urlparse(value)
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname or '%' in parsed.hostname
                or parsed.username is not None or parsed.password is not None or parsed.netloc.endswith(':')):
            return None
        host = parsed.hostname.encode('idna').decode('ascii').rstrip('.').lower()
        port = parsed.port if parsed.port is not None else (443 if parsed.scheme == 'https' else 80)
        if not host or not 1 <= port <= 65535: return None
        return parsed.scheme, host, port, parsed.path or '/', parsed.params, parsed.query
    except (ValueError, UnicodeError):
        return None


def raw_source(item, key='source'):
    """A retained original digest cannot reconstruct a redacted download URL."""
    value = item.get(key)
    if not _url(value): return None
    stored = item.get(key + '_sha256')
    if stored is not None and stored != hashlib.sha256(value.encode()).hexdigest(): return None
    return value


def held_sources(row):
    evidence = row.get('source_resolution') or {}
    for declaration in evidence.get('declarations', []):
        for endpoint in declaration['resolution']['endpoints']:
            if endpoint['spec'] == 'gtfs' and endpoint['access_state'] != 'public_declared':
                yield endpoint, 'url'
                yield endpoint, 'declared_url'
    for item in evidence.get('ordinary_static_declarations', []):
        if item.get('access_state') != 'public_declared': yield item, 'url'
    for item in row.get('lineage') or []:
        if item.get('catalogue') == 'mobility-database' and not public_authentication(item.get('authentication_type')):
            yield item, 'source'


def withheld_static_resources(row):
    # Visible query values retain lexical identity even if an asserted hash is
    # stale. Redacted values keep exact hashes without equating hidden values.
    return {key for item, field in held_sources(row) if _url(item.get(field))
            and not any(value == '[redacted]' for _, value in parse_qsl(urlsplit(item[field]).query, keep_blank_values=True))
            for key in [resource_key(item[field])] if key is not None}


def uncertain_static_resources(row):
    # A published query display cannot prove which value was held. Compatible
    # visible resources remain unresolved; this is uncertainty, not equivalence
    # between distinct original query values or a reconstructed request key.
    return {key for item, field in held_sources(row) if _url(item.get(field))
        and any(value == '[redacted]' for _, value in parse_qsl(urlsplit(item[field]).query, keep_blank_values=True))
        for key in [resource_key(reference_display_url(item[field]))] if key is not None}


def source_withheld(row, value):
    if not isinstance(value, str): return False
    exact = hashlib.sha256(value.encode()).hexdigest()
    resource = resource_key(value)
    visible = resource_key(reference_display_url(value)) if _url(value) else None
    return (exact in withheld_static_identities(row)
        or resource is not None and resource in withheld_static_resources(row)
        or visible is not None and visible in uncertain_static_resources(row))



def withheld_static_identities(row):
    """Access requirements bind original identities, even beside a public primary."""
    return {identity for item, field in held_sources(row) for identity in source_identities(item, field)}


def evidenced_static_identities(row, publication_context=None):
    """Acquisition authority comes from source evidence, never a display hash."""
    evidence = row.get('source_resolution') or {}
    urls = []
    for declaration in evidence.get('declarations', []):
        for endpoint in declaration['resolution']['endpoints']:
            if (endpoint['spec'] == 'gtfs' and endpoint['access_state'] == 'public_declared'
                    and declaration['resolution']['state'] == 'resolved'):
                urls.append(raw_source(endpoint, 'url'))
    urls.extend(raw_source(item, 'url') for item in evidence.get('ordinary_static_declarations', [])
        if item['access_state'] == 'public_declared')
    for item in row.get('lineage') or []:
        if (lineage_valid(row, item) and (item.get('catalogue') == 'transitous-licence' and publication_context is not None and publication_context.matches(row, item) or item.get('catalogue') == 'mobility-database'
                and public_authentication(item.get('authentication_type')))):
            urls.append(raw_source(item))
    return {hashlib.sha256(url.encode()).hexdigest() for url in urls if _url(url) and not source_withheld(row, url)}


def alias_owner_metadata_compatible(row):
    """Legacy owner outcomes stay unchanged; new aliases need compatible proof."""
    def public_owner_authentication(value):
        # JSON parsers' finite numeric-zero values are equivalent here,
        # including a literal that underflows to zero in both runtimes.
        # Keep this alias-only compatibility distinct from reference proof.
        return public_authentication(value) or type(value) in (int, float) and value == 0
    lineage = row.get('lineage', [])
    return (isinstance(lineage, list) and len(lineage) <= MAX_DECLARATIONS
        and all(isinstance(item, dict) and (item.get('catalogue') != 'mobility-database'
            or public_owner_authentication(item.get('authentication_type'))) for item in lineage))


def independent_static_evidence(row, publication_context=None):
    evidence = row.get('source_resolution') or {}
    lineage = row.get('lineage') if isinstance(row.get('lineage'), list) else []
    # Published GTFS establishes the public processed archive, not that an
    # authenticated original suddenly became public.
    published = publication_context is not None and any(lineage_valid(row, item) and item.get('catalogue') == 'transitous-licence'
        and publication_context.matches(row, item) for item in lineage)
    mobility = any(lineage_valid(row, item) and item.get('catalogue') == 'mobility-database'
        and public_authentication(item.get('authentication_type')) and source_identities(item)
        and raw_source(item) and not source_withheld(row, item['source']) for item in lineage)
    ordinary = [item for item in evidence.get('ordinary_static_declarations', [])
        if item.get('access_state') == 'public_declared' and source_identities(item, 'url')
        and raw_source(item, 'url') and not source_withheld(row, item['url'])]
    return published, mobility, ordinary


def companion_only(declaration):
    resolution = declaration['resolution']
    specs = resolution.get('specs') or []
    if 'gtfs' in specs:
        return False
    return bool(specs) or declaration.get('declared_spec') in ('gtfs-rt', 'gbfs')


def apply_references(rows, feed_sources, mobility_rows, compact_mobility, index=None, licence_evidence=None, definition_metadata=None, publication_context=None):
    """Keep legacy identities/owners; attach complete reference declarations."""
    index = index or unavailable()
    result = deepcopy(rows)
    by_filename = {r['filename']: r for r in result}
    groups, ordinals = defaultdict(list), Counter()
    for region, item, source_url in feed_sources:
        ordinal = ordinals[source_url]; ordinals[source_url] += 1
        if not isinstance(item, dict) or not text(item.get('name')):
            continue
        filename = region + '_' + item['name'] + '.gtfs.zip'
        if filename in by_filename:
            groups[filename].append((item, source_url, ordinal))
    mobility = defaultdict(list)
    for raw in mobility_rows:
        m = compact_mobility(raw)
        if m['id']:
            mobility[m['id']].append(m)
    # Only existing direct rows may own a newly resolved reference. Their source
    # and cache/policy identity are never rewritten by this pass.
    owners = defaultdict(list)
    for row in result:
        if row.get('delivery') == 'direct' and _url(row.get('source')):
            owners[hashlib.sha256(row['source'].encode()).hexdigest()].append(row)
    counts = Counter()
    for filename, definitions in groups.items():
        refs = [d for d in definitions if d[0].get('type') in REFERENCE_TYPES]
        if not refs:
            continue
        row = by_filename[filename]
        if row.get('access_review'):
            counts['reference_existing_access_hold_unchanged'] += 1
            continue
        evidence = {'schema': 1, 'state': 'unresolved', 'specs': [],
            'identity_state': 'single' if len(refs) == 1 else 'multiple_declarations',
            'selected_static_declaration': None, 'acquisition_alias_of': None,
            'processed_filename': None, 'processed_basis': 'unresolved', 'declarations': []}
        row['source_resolution'] = evidence
        if publication_context is not None:
            membership = publication_context.evidence(filename)
            if membership is not None: evidence['publication_evidence'] = membership
        if len(definitions) > MAX_DECLARATIONS:
            evidence['reason'] = 'declaration_limit'
            counts['reference_unresolved'] += 1
            continue
        declarations = [resolve_declaration(item, url, ordinal, index, mobility) for item, url, ordinal in refs]
        for declaration in declarations:
            file_metadata = (definition_metadata or {}).get(declaration['definition']['url'], {})
            declaration['definition'].update({key: file_metadata[key] for key in ('blob_sha', 'file_sha256') if key in file_metadata})
        evidence['declarations'] = declarations
        counts['reference_declarations'] += len(declarations)
        # Distinct occurrences never overwrite one another. Identical reference
        # identities with different source options are explicitly ambiguous.
        identities = defaultdict(set)
        for d in declarations:
            identities[d['id']].add(d['definition']['sha256'])
        specs = sorted({s for d in declarations for s in d['resolution']['specs']})
        evidence['specs'] = specs
        # A separately declared ordinary static source is also independent.
        ordinary_static = []
        for item, url, ordinal in definitions:
            if (item.get('type') not in REFERENCE_TYPES and item.get('spec', 'gtfs') in ('gtfs', '')
                    and _url(item.get('url'))):
                ordinary_static.append({'type': text(item.get('type'), 80) or 'http', 'spec': 'gtfs',
                    'url': item['url'], 'url_sha256': hashlib.sha256(item['url'].encode()).hexdigest(),
                    'access_state': 'authorization_required' if item.get('api-key') else
                                    'review_required' if item.get('http-options') or item.get('function') else 'public_declared',
                    'upstream_skip': item.get('skip') is True,
                    'definition': {'url': url, 'pointer': '/sources/' + str(ordinal), 'sha256': digest(item),
                                   **(definition_metadata or {}).get(url, {})}})
        evidence['ordinary_static_declarations'] = ordinary_static
        if ordinary_static:
            evidence['specs'] = sorted(set(specs) | {'gtfs'})
        published, public_mobility, public_ordinary = independent_static_evidence(row, publication_context)
        independent = published or public_mobility or bool(public_ordinary)
        active_ordinary = any(d['type'] in ('http', 'ftp') and not d['upstream_skip'] for d in public_ordinary)
        unknown = [d for d in declarations if d['resolution']['state'] not in ('resolved', 'authorization_required')]
        static = [(d, e) for d in declarations for e in d['resolution']['endpoints'] if e['spec'] == 'gtfs']
        static_ids = {d['id'] for d, _ in static}
        conflicts = [d for d in declarations if d['resolution']['state'] == 'conflicting_reference'
                     or len(identities[d['id']]) > 1]
        known_primary = bool(static) or independent
        # A separately evidenced static primary must not disappear because its
        # ancillary real-time declaration is unavailable or inconsistent.
        blocking_conflicts = [d for d in conflicts if not known_primary or
            not companion_only(d)]
        if blocking_conflicts or len(static_ids) > 1:
            evidence.update(state='ambiguous', identity_state='ambiguous', processed_basis='ambiguous')
        elif unknown and not independent and (not static or any(not companion_only(d) for d in unknown)):
            evidence['reason'] = 'incomplete_reference_resolution'
        elif static or independent:
            evidence['state'] = 'schedule'
            if independent:
                evidence['specs'] = sorted(set(specs) | {'gtfs'})
            if unknown or conflicts:
                evidence['companion_resolution_incomplete'] = True
            if static:
                d, endpoint = static[0]
                if endpoint['access_state'] == 'public_declared' and (not row.get('source') or row.get('source') == endpoint['url']):
                    evidence['selected_static_declaration'] = d['id']
                evidence['identity_state'] = 'static_with_companions' if len(declarations) > 1 else 'single'
                if endpoint['access_state'] == 'public_declared' and not row.get('source'):
                    row['source'] = endpoint['url']
                    row['source_sha256'] = endpoint['url_sha256']
                    row['lineage'].append({'catalogue': d['type'], 'id': d['reference_id'],
                        'url': d['resolution'].get('metadata_url', ''), 'source': endpoint['url'],
                        'source_sha256': endpoint['url_sha256']})
                if licence_evidence and d.get('licence'):
                    ev = licence_evidence(d['licence'], d['type'], d['resolution'].get('metadata_url', ''))
                    if ev and ev not in row.get('rights_evidence', []):
                        row.setdefault('rights_evidence', []).append(ev)
            if published or active_ordinary or (static and not static[0][0]['upstream_skip'] and static[0][1]['access_state'] == 'public_declared'):
                evidence['processed_filename'] = filename
                evidence['processed_basis'] = 'published_gtfs_record' if published else 'active_static_declaration'
            else:
                evidence['processed_basis'] = 'upstream_skip' if static else 'unresolved'
            if not evidence['processed_filename'] and not (candidate_identities(row) & evidenced_static_identities(row, publication_context)):
                evidence['state'] = 'unresolved'
                evidence['reason'] = 'no_public_static_candidate'
        elif ordinary_static:
            evidence['reason'] = 'no_public_static_candidate'
        elif specs and not unknown:
            evidence.update(state='non_timetable_format', processed_basis='non_timetable')
        if evidence['state'] == 'schedule' and not evidence['processed_filename'] and static:
            d, endpoint = static[0]
            matches = owners.get(endpoint['url_sha256'], []) if endpoint['access_state'] == 'public_declared' else []
            if (len(matches) == 1 and matches[0]['filename'] != filename
                    and candidate_identities(row) == candidate_identities(matches[0]) == {endpoint['url_sha256']}):
                # Preserve the unchanged target's established filesystem/shard ID.
                evidence['acquisition_alias_of'] = legacy_id(matches[0]['filename'])
                evidence['alias_source_sha256'] = endpoint['url_sha256']
            elif len(matches) > 1:
                evidence.update(state='ambiguous', identity_state='ambiguous')
        counts['reference_' + evidence['state']] += 1
    counts['reference_aliases'] = sum(bool(r.get('source_resolution', {}).get('acquisition_alias_of')) for r in result)
    return result, dict(counts)


def resolution_state(row, publication_context=None):
    """Validate all static proof before selection; malformed new schemas hold."""
    value = row.get('source_resolution')
    if value is None:
        return None
    if not metadata_shape_valid(value):
        return 'invalid'
    state = value.get('state')
    if state not in ('schedule', 'non_timetable_format', 'unresolved', 'ambiguous'):
        return 'invalid'
    specs, declarations = value.get('specs'), value.get('declarations')
    if (not isinstance(specs, list) or len(specs) > 3
            or any(s not in ('gtfs', 'gtfs-rt', 'gbfs') for s in specs)
            or not isinstance(declarations, list) or len(declarations) > MAX_DECLARATIONS
            or any(not isinstance(d, dict) for d in declarations)):
        return 'invalid'
    if state == 'schedule' and 'gtfs' not in specs:
        return 'invalid'
    if state == 'non_timetable_format' and (not specs or 'gtfs' in specs):
        return 'invalid'
    static, options, proofs = [], defaultdict(set), defaultdict(set)
    for declaration in declarations:
        resolution = declaration.get('resolution')
        definition = declaration.get('definition')
        if (not isinstance(declaration.get('id'), str) or not re.fullmatch('[a-f0-9]{64}', declaration['id'])
                or not isinstance(definition, dict) or not isinstance(definition.get('sha256'), str)
                or not re.fullmatch('[a-f0-9]{64}', definition['sha256'])
                or not isinstance(resolution, dict) or resolution.get('state') not in
                ('resolved', 'authorization_required', 'transport_options_required', 'metadata_unavailable',
                 'conflicting_reference', 'missing_reference', 'malformed_reference', 'unsupported_type')):
            return 'invalid'
        if (declaration.get('declared_spec') is not None and not text(declaration.get('declared_spec'), 80)
                or not isinstance(declaration.get('upstream_skip', False), bool)):
            return 'invalid'
        child_specs, endpoints = resolution.get('specs'), resolution.get('endpoints')
        if (not isinstance(child_specs, list) or len(child_specs) > 3
                or any(spec not in ('gtfs', 'gtfs-rt', 'gbfs') for spec in child_specs)
                or not isinstance(endpoints, list) or len(endpoints) > len(ROLE_SPECS)):
            return 'invalid'
        if not companion_only(declaration):
            options[declaration['id']].add(definition['sha256'])
        for endpoint in endpoints:
            if (not isinstance(endpoint, dict) or not isinstance(endpoint.get('role'), str)
                    or endpoint['role'] not in ROLE_SPECS or endpoint.get('spec') != ROLE_SPECS[endpoint['role']]
                    or endpoint.get('spec') not in child_specs or not _url(endpoint.get('url'))
                    or not isinstance(endpoint.get('url_sha256'), str) or not re.fullmatch('[a-f0-9]{64}', endpoint['url_sha256'])
                    or endpoint.get('access_state') not in ('public_declared', 'authorization_required', 'review_required')
                    or ('declared_url' in endpoint and not _url(endpoint['declared_url']))
                    or (endpoint.get('authorization') is not None and endpoint['access_state'] != 'authorization_required')):
                return 'invalid'
            if endpoint['spec'] == 'gtfs':
                static.append((declaration, endpoint))
        if len({e['role'] for e in endpoints}) != len(endpoints):
            return 'invalid'
        if endpoints:
            expected = ('authorization_required' if any(e['access_state'] == 'authorization_required' for e in endpoints)
                else 'transport_options_required' if any(e['access_state'] == 'review_required' for e in endpoints) else 'resolved')
            if resolution['state'] != expected:
                return 'invalid'
        if not companion_only(declaration):
            proofs[declaration['id']].add((resolution['state'], tuple(child_specs), declaration.get('upstream_skip', False),
                tuple((e['role'], e['spec'], e['url'], e['url_sha256'], e.get('declared_url', ''), e['access_state']) for e in endpoints)))
    ordinary = value.get('ordinary_static_declarations', [])
    if (not isinstance(ordinary, list) or len(ordinary) > MAX_DECLARATIONS
            or any(not isinstance(d, dict) or d.get('spec') != 'gtfs' or not _url(d.get('url'))
                or d.get('access_state') not in ('public_declared', 'authorization_required', 'review_required')
                for d in ordinary)):
        return 'invalid'
    lineage = row.get('lineage', [])
    if not isinstance(lineage, list) or len(lineage) > MAX_DECLARATIONS or any(not lineage_valid(row, item) for item in lineage):
        return 'invalid'
    processed = value.get('processed_filename')
    if processed is not None and (state != 'schedule' or processed != row.get('filename')):
        return 'invalid'
    if state == 'schedule':
        # A selected declaration cannot hide another static identity or distinct
        # options under the same identity, even in externally supplied schemas.
        if (len({d['id'] for d, _ in static}) > 1 or len({e['url_sha256'] for _, e in static}) > 1
                or len({e['url'] for _, e in static}) > 1
                or any(len(values) > 1 for values in options.values())
                or any(len(values) > 1 for values in proofs.values())):
            return 'invalid'
        if any(d['resolution']['state'] == 'conflicting_reference' and not companion_only(d) for d in declarations):
            return 'invalid'
        selected = value.get('selected_static_declaration')
        selected_static = [(d, e) for d, e in static if d['id'] == selected
            and d['resolution']['state'] == 'resolved' and e['access_state'] == 'public_declared'
            and (not row.get('source') or e['url'] == row['source'])]
        if selected is not None and (not isinstance(selected, str) or not selected_static):
            return 'invalid'
        published, public_mobility, public_ordinary = independent_static_evidence(row, publication_context)
        if (not (published or public_mobility or public_ordinary) and any(
                d['resolution']['state'] not in ('resolved', 'authorization_required') and not companion_only(d) for d in declarations)):
            return 'unresolved'
        if not (selected_static or published or public_mobility or public_ordinary):
            return 'unresolved'
        if processed and any('upstream_skip' not in d for d, _ in selected_static) and not published:
            return 'invalid'
        if not processed_available(row, publication_context) and not (candidate_identities(row) & evidenced_static_identities(row, publication_context)):
            return 'unresolved'
    alias = value.get('acquisition_alias_of')
    if alias is not None and (state != 'schedule' or processed is not None
            or not isinstance(alias, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,256}', alias)
            or not isinstance(value.get('alias_source_sha256'), str)
            or not re.fullmatch('[a-f0-9]{64}', value['alias_source_sha256'])):
        return 'invalid'
    return state


def processed_available(row, publication_context=None):
    value = row.get('source_resolution') or {}
    if not value.get('processed_filename'): return False
    published, _, ordinary = independent_static_evidence(row, publication_context)
    if published: return True
    if any(d.get('upstream_skip') is False and d.get('type') in ('http', 'ftp') for d in ordinary): return True
    return any(d.get('upstream_skip') is False and d['resolution']['state'] == 'resolved'
        and e['spec'] == 'gtfs' and e['access_state'] == 'public_declared' and raw_source(e, 'url')
        and not source_withheld(row, e['url'])
        for d in value.get('declarations', []) for e in d['resolution']['endpoints'])


def alias_source_bindings(row):
    if not _url(row.get('source')): return None
    result = set()
    for item in [row] + (row.get('lineage') or []):
        value = item.get('source')
        if not _url(value): continue
        actual = hashlib.sha256(value.encode()).hexdigest()
        stored = item.get('source_sha256', actual)
        if not isinstance(stored, str) or not re.fullmatch('[a-f0-9]{64}', stored): return None
        if stored != actual:
            query = parse_qsl(urlsplit(value).query, keep_blank_values=True)
            if not query or any(v != '[redacted]' for _, v in query): return None
        # Canonical display is only a compatibility check beside the exact
        # original fingerprint. It never grants source acquisition authority.
        key = resource_key(reference_display_url(value))
        if key is None: return None
        result.add((stored, key))
    return result
