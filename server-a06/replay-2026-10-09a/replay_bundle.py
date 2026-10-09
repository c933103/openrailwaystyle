#!/usr/bin/env python3
"""New replay helper v1. Local files only; no provider or other network calls.

Validate all archive names, types, sizes and hashes before creating a fresh
destination. Integrity checks are explicit and remain enabled under python -O.
"""
from pathlib import Path, PurePosixPath
import argparse, gzip, hashlib, json, os, re, stat, tarfile, zipfile

MAX_FILE = 64 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024

def checked_path(value):
    if not isinstance(value, str) or not value or not re.fullmatch(r'[A-Za-z0-9_./-]+', value):
        raise ValueError('Invalid path spelling')
    p = PurePosixPath(value)
    if p.is_absolute() or str(p) != value or any(x in ('', '.', '..') for x in value.split('/')):
        raise ValueError('Unsafe relative path')
    return value

def no_symlinks(path):
    p = Path(os.path.abspath(path))
    for part in (p, *p.parents):
        if part.is_symlink():
            raise ValueError('Symlink in filesystem path')
    return p

def read_file(root, name, record=None):
    p = no_symlinks(no_symlinks(root) / checked_path(name))
    if not p.is_file() or p.stat().st_size > MAX_FILE:
        raise ValueError('Missing or oversized regular file')
    data = p.read_bytes()
    if record is not None:
        verify(data, record)
    return data

def verify(data, record):
    if len(data) != record['bytes'] or hashlib.sha256(data).hexdigest() != record['sha256']:
        raise ValueError('Content hash or size mismatch')

def record_map(records):
    result = {}
    if not isinstance(records, list) or not 1 <= len(records) <= 512:
        raise ValueError('Invalid record count')
    for r in records:
        name = checked_path(r['path'])
        if name in result or type(r['bytes']) is not int or not 0 <= r['bytes'] <= MAX_FILE:
            raise ValueError('Duplicate path or invalid size')
        if not isinstance(r['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', r['sha256']):
            raise ValueError('Invalid SHA-256')
        result[name] = r
    if sum(r['bytes'] for r in result.values()) > MAX_TOTAL:
        raise ValueError('Manifest exceeds bounded total')
    return result

def unique_members(names):
    if not isinstance(names, list) or not names or len(names) > 512:
        raise ValueError('Invalid member list')
    checked = [checked_path(n) for n in names]
    if len(checked) != len(set(checked)):
        raise ValueError('Duplicate declared member')
    return set(checked)

def prepare(fixtures, bundle, destination):
    bundle = no_symlinks(bundle)
    manifest = json.loads(read_file(bundle, 'replay-manifest.json'))
    if manifest.get('schema') != 1:
        raise ValueError('Unsupported manifest schema')
    inputs, expected = record_map(manifest['inputs']), record_map(manifest['expected'])
    archives = record_map(manifest['archives'])
    reference = record_map([manifest['reference']])
    dest = no_symlinks(destination)
    if dest.exists():
        raise ValueError('Destination must not exist')
    data = {}
    import io
    for name, record in archives.items():
        payload = read_file(fixtures, name, record)
        members = unique_members(record['members'])
        if not members.issubset(inputs) or members.intersection(data):
            raise ValueError('Invalid or overlapping input member set')
        with zipfile.ZipFile(io.BytesIO(payload)) as z:
            infos = z.infolist()
            if len(infos) != len(members) or {i.filename for i in infos} != members:
                raise ValueError('Unexpected, missing or duplicate ZIP member')
            for i in infos:
                checked_path(i.filename)
                kind = stat.S_IFMT(i.external_attr >> 16)
                if i.is_dir() or kind not in (0, stat.S_IFREG) or i.flag_bits & 1:
                    raise ValueError('Unsafe ZIP member type')
                if i.file_size != inputs[i.filename]['bytes']:
                    raise ValueError('ZIP member size disagrees with manifest')
                b = z.read(i)
                verify(b, inputs[i.filename])
                data[i.filename] = b
    if set(data) != set(inputs):
        raise ValueError('Incomplete input set')
    metadata = {}
    for name, record in reference.items():
        payload = read_file(bundle, name, record)
        members = unique_members(record['members'])
        if members != set(expected) - set(inputs):
            raise ValueError('Reference set disagrees with expected outputs')
        limit = sum(((expected[n]['bytes'] + 511) // 512 + 1) * 512 for n in members) + 10240
        with gzip.GzipFile(fileobj=io.BytesIO(payload)) as gz:
            unpacked = gz.read(limit + 1)
        if len(unpacked) > limit:
            raise ValueError('Reference TAR exceeds bounded declared size')
        with tarfile.open(fileobj=io.BytesIO(unpacked), mode='r:') as t:
            infos = t.getmembers()
            if len(infos) != len(members) or {i.name for i in infos} != members:
                raise ValueError('Unexpected, missing or duplicate TAR member')
            for i in infos:
                checked_path(i.name)
                if not i.isfile() or i.size != expected[i.name]['bytes']:
                    raise ValueError('TAR type or size disagrees with manifest')
                f = t.extractfile(i)
                if f is None:
                    raise ValueError('Missing TAR content')
                b = f.read(MAX_FILE + 1)
                verify(b, expected[i.name])
                metadata[i.name] = b
    output = {name: data[name] if name in data else metadata[name] for name in expected}
    for name, b in output.items():
        verify(b, expected[name])
    # No filesystem output has occurred before the complete validation above.
    dest.mkdir(parents=False, exist_ok=False)
    for label, files in [('input', data), ('expected', output)]:
        for name, b in files.items():
            p = dest / label / name
            p.parent.mkdir(parents=True, exist_ok=True)
            no_symlinks(p)
            with p.open('xb') as f:
                f.write(b)
    return {'input_files': len(data), 'expected_files': len(output),
            'input_bytes': sum(map(len, data.values())), 'expected_bytes': sum(map(len, output.values()))}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixtures', required=True, type=Path)
    parser.add_argument('--bundle', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--destination', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.fixtures, args.bundle, args.destination), sort_keys=True))
