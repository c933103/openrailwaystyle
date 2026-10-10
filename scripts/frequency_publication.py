"""Secret-free membership context, separate from catalogue row assertions.

The producer reads the pinned licence input once. Consumers explicitly receive
its bounded index through the catalogue job/report/artifact handoff. This is a
trusted-input boundary, not a signature or independent upstream authentication.
"""
import hashlib
import json
from pathlib import Path
import re

MAX_INPUT_BYTES = 32 * 1024 * 1024
MAX_INDEX_BYTES = 4 * 1024 * 1024
MAX_RECORDS = 20000
MAX_RECORD_BYTES = 1024 * 1024
MAX_REPORT_BYTES = 1024 * 1024
ORIGIN = re.compile(r'https://github\.com/public-transport/transitous/blob/[a-f0-9]{40}/website/data/license\.json')
HASH = re.compile('[a-f0-9]{64}')
FIELDS = {'filename', 'pointer', 'record_sha256', 'source_sha256'}


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def parsed(data):
    def object_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise ValueError('Duplicate publication field')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=object_pairs,
        parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Invalid publication number')))


def sha(value):
    return hashlib.sha256(value).hexdigest()


def valid_record(record):
    return (isinstance(record, dict) and set(record) == FIELDS
        and isinstance(record['filename'], str) and 0 < len(record['filename']) <= 4096
        and not re.search(r'[/\\\x00-\x1f\x7f]', record['filename'])
        and isinstance(record['pointer'], str) and re.fullmatch(r'/(?:0|[1-9][0-9]{0,7})', record['pointer']) is not None
        and all(isinstance(record[key], str) and HASH.fullmatch(record[key]) is not None
                for key in ('record_sha256', 'source_sha256')))


def validate_index(index):
    if (not isinstance(index, dict) or set(index) != {'schema', 'source_url', 'input_sha256', 'records'}
            or type(index['schema']) is not int or index['schema'] != 1
            or not isinstance(index['source_url'], str) or ORIGIN.fullmatch(index['source_url']) is None
            or not isinstance(index['input_sha256'], str) or HASH.fullmatch(index['input_sha256']) is None
            or not isinstance(index['records'], list) or len(index['records']) > MAX_RECORDS
            or any(not valid_record(record) for record in index['records'])):
        raise ValueError('Invalid publication index schema')
    records = index['records']
    if len({r['filename'] for r in records}) != len(records) or len({r['pointer'] for r in records}) != len(records):
        raise ValueError('Ambiguous publication index membership')
    return index


def build_index(raw, source_url):
    if not isinstance(raw, bytes) or len(raw) > MAX_INPUT_BYTES:
        raise ValueError('Publication input byte budget exceeded')
    items = parsed(raw)
    if not isinstance(items, list) or len(items) > MAX_RECORDS:
        raise ValueError('Publication input record budget exceeded')
    records = []
    for i, item in enumerate(items):
        if not isinstance(item, dict): raise ValueError('Invalid publication input record')
        data = encoded(item)
        if len(data) > MAX_RECORD_BYTES: raise ValueError('Publication record byte budget exceeded')
        source = item.get('source', '')
        if not isinstance(source, str): raise ValueError('Invalid publication source identity')
        records.append({'filename': item.get('filename'), 'pointer': '/' + str(i),
                        'record_sha256': sha(data), 'source_sha256': sha(source.encode('utf-8'))})
    index = validate_index({'schema': 1, 'source_url': source_url, 'input_sha256': sha(raw), 'records': records})
    if len(encoded(index)) > MAX_INDEX_BYTES: raise ValueError('Publication index byte budget exceeded')
    return index


class Context:
    """Constructed only from an explicit producer or checked artifact context."""
    def __init__(self, index):
        index = validate_index(index)
        self.source_url = index['source_url']
        self.input_sha256 = index['input_sha256']
        self.records = {r['filename']: dict(r) for r in index['records']}

    def evidence(self, filename):
        record = self.records.get(filename)
        return ({'input_sha256': self.input_sha256, **record} if record else None)

    def matches(self, row, lineage):
        evidence = (row.get('source_resolution') or {}).get('publication_evidence')
        expected = self.evidence(row.get('filename'))
        return (expected is not None and evidence == expected and lineage.get('id') == expected['filename']
            and lineage.get('url') == self.source_url and row.get('catalogue_url') == self.source_url
            and isinstance(lineage.get('source'), str)
            and (sha(lineage['source'].encode('utf-8')) == expected['source_sha256']
                 or lineage.get('source_sha256') == expected['source_sha256']))

    def worker_record(self, row):
        record = self.records.get(row.get('filename'))
        return ({'schema': 1, 'source_url': self.source_url, 'input_sha256': self.input_sha256,
                 'records': [dict(record)]} if record else None)


def read_report(path):
    with Path(path).open('rb') as stream: data = stream.read(MAX_REPORT_BYTES + 1)
    if len(data) > MAX_REPORT_BYTES: raise ValueError('Catalogue report byte budget exceeded')
    return parsed(data)


def read_context(path, report):
    """Explicit caller-supplied artifact context; catalogue fields never enter."""
    if path is None: return None, 'not_supplied'
    try:
        if not isinstance(report, dict) or report.get('schema') != 4:
            return None, 'report_unverified'
        binding = report.get('publication_index')
        if (not isinstance(binding, dict) or set(binding) != {'sha256', 'records'}
                or not isinstance(binding['sha256'], str) or HASH.fullmatch(binding['sha256']) is None
                or type(binding['records']) is not int or not 0 <= binding['records'] <= MAX_RECORDS):
            return None, 'index_binding_invalid'
        with Path(path).open('rb') as stream: data = stream.read(MAX_INDEX_BYTES + 1)
        if len(data) > MAX_INDEX_BYTES: return None, 'index_byte_limit'
        if sha(data) != binding['sha256']: return None, 'index_hash_mismatch'
        index = validate_index(parsed(data))
        if (index['input_sha256'] != (report.get('input_sha256') or {}).get('transitous_licences')
                or index['source_url'] != 'https://github.com/public-transport/transitous/blob/'
                    + str(report.get('transitous_ref')) + '/website/data/license.json'
                or len(index['records']) != binding['records']):
            return None, 'index_binding_mismatch'
        return Context(index), 'verified'
    except (OSError, ValueError, TypeError, UnicodeError, RecursionError):
        return None, 'index_invalid_or_unavailable'


def from_worker(value):
    # This separate argument is authored by the verified parent, not read from
    # entry.catalogue. The local compile-one request is a trusted worker channel.
    if value is None: return None
    context = Context(value)
    if len(context.records) != 1: raise ValueError('Invalid worker publication context')
    return context
