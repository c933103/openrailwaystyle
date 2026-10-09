"""Offline, bounded reference resolution; no provider requests or upstream code.

The legacy filename is an inventory identity, not proof of a downloadable GTFS.
This module only adds evidence to the existing row universe. Acquisition policy,
rights, public-address validation and publication redaction remain downstream.
"""
from collections import Counter, defaultdict
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

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


def _url(value):
    if not text(value):
        return ''
    try:
        p = urlsplit(value)
        return value if p.scheme in ('http', 'https') and p.hostname else ''
    except ValueError:
        return ''


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
            'access_state': ('authorization_required' if (authorization and not override) or inherited_authorization else
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


def companion_only(declaration):
    resolution = declaration['resolution']
    specs = resolution.get('specs') or []
    if 'gtfs' in specs:
        return False
    return bool(specs) or declaration.get('declared_spec') in ('gtfs-rt', 'gbfs')


def apply_references(rows, feed_sources, mobility_rows, compact_mobility, index=None, licence_evidence=None, definition_metadata=None):
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
        independent = any(x.get('catalogue') in ('transitous-licence', 'mobility-database') for x in row.get('lineage', []) if isinstance(x, dict))
        # A separately declared ordinary static source is also independent.
        ordinary_static = []
        for item, url, ordinal in definitions:
            if (item.get('type') not in REFERENCE_TYPES and item.get('spec', 'gtfs') in ('gtfs', '')
                    and _url(item.get('url'))):
                ordinary_static.append({'type': text(item.get('type'), 80) or 'http', 'spec': 'gtfs',
                    'url': item['url'], 'url_sha256': hashlib.sha256(item['url'].encode()).hexdigest(),
                    'upstream_skip': item.get('skip') is True,
                    'definition': {'url': url, 'pointer': '/sources/' + str(ordinal), 'sha256': digest(item),
                                   **(definition_metadata or {}).get(url, {})}})
        evidence['ordinary_static_declarations'] = ordinary_static
        independent = independent or bool(ordinary_static)
        active_ordinary = any(d['type'] in ('http', 'ftp') and not d['upstream_skip'] for d in ordinary_static)
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
                if not row.get('source') or row.get('source') == endpoint['url']:
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
            published = any(x.get('catalogue') == 'transitous-licence' for x in row.get('lineage', []) if isinstance(x, dict))
            if published or active_ordinary or (static and not static[0][0]['upstream_skip'] and static[0][1]['access_state'] == 'public_declared'):
                evidence['processed_filename'] = filename
                evidence['processed_basis'] = 'published_gtfs_record' if published else 'active_static_declaration'
            else:
                evidence['processed_basis'] = 'upstream_skip' if static else 'unresolved'
            if not evidence['processed_filename'] and not _url(row.get('source')):
                evidence['state'] = 'unresolved'
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


def resolution_state(row):
    """Validate acquisition-affecting fields; malformed new schemas fail closed."""
    value = row.get('source_resolution')
    if value is None:
        return None
    if not isinstance(value, dict) or value.get('schema') != 1:
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
    for declaration in declarations:
        resolution = declaration.get('resolution')
        if (not isinstance(resolution, dict) or resolution.get('state') not in
                ('resolved', 'authorization_required', 'transport_options_required', 'metadata_unavailable',
                 'conflicting_reference', 'missing_reference', 'malformed_reference', 'unsupported_type')):
            return 'invalid'
        child_specs, endpoints = resolution.get('specs'), resolution.get('endpoints')
        if (not isinstance(child_specs, list) or len(child_specs) > 3
                or any(spec not in ('gtfs', 'gtfs-rt', 'gbfs') for spec in child_specs)
                or not isinstance(endpoints, list) or len(endpoints) > len(ROLE_SPECS)):
            return 'invalid'
        for endpoint in endpoints:
            if (not isinstance(endpoint, dict) or not isinstance(endpoint.get('role'), str)
                    or endpoint['role'] not in ROLE_SPECS or endpoint.get('spec') != ROLE_SPECS[endpoint['role']]
                    or endpoint.get('spec') not in child_specs
                    or not _url(endpoint.get('url'))
                    or endpoint.get('access_state') not in ('public_declared', 'authorization_required', 'review_required')):
                return 'invalid'
    if state == 'schedule':
        selected = value.get('selected_static_declaration')
        selected_static = any(d.get('id') == selected and isinstance(d.get('resolution'), dict)
            and d['resolution'].get('state') == 'resolved' and 'gtfs' in (d['resolution'].get('specs') or [])
            and any(isinstance(e, dict) and e.get('role') == 'static_current' and e.get('spec') == 'gtfs'
                    and e.get('access_state') == 'public_declared'
                    and (not row.get('source') or e.get('url') == row['source'])
                    for e in (d['resolution'].get('endpoints') or [])) for d in declarations) if isinstance(selected, str) else False
        lineage = row.get('lineage') if isinstance(row.get('lineage'), list) else []
        independently_published = any(isinstance(item, dict) and item.get('catalogue') in
            ('transitous-licence', 'mobility-database') for item in lineage)
        ordinary = value.get('ordinary_static_declarations')
        if ordinary is None:
            ordinary = []
        if (not isinstance(ordinary, list) or len(ordinary) > MAX_DECLARATIONS
                or any(not isinstance(d, dict) for d in ordinary)):
            return 'invalid'
        ordinary_static = any(d.get('spec') == 'gtfs' and _url(d.get('url')) for d in ordinary)
        if not (selected_static or independently_published or ordinary_static):
            return 'invalid'
    processed = value.get('processed_filename')
    if processed is not None and processed != row.get('filename'):
        return 'invalid'
    alias = value.get('acquisition_alias_of')
    if alias is not None and (state != 'schedule' or processed is not None
            or not isinstance(alias, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,256}', alias)
            or not isinstance(value.get('alias_source_sha256'), str)
            or not re.fullmatch('[a-f0-9]{64}', value['alias_source_sha256'])):
        return 'invalid'
    return state
