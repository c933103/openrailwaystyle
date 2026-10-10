#!/usr/bin/env python3
"""Create disposable, validated frequency artifact derivatives; never acquire data.

The producer outcome is a trusted workflow argument, not an authentication token.
Operational cache files and original/downloaded artifacts are read-only inputs.
"""
import argparse
import gzip
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zlib

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('frequency_pipeline', ROOT/'scripts/global-service-frequency.py')
pipeline = importlib.util.module_from_spec(spec); spec.loader.exec_module(pipeline)
MAX_BYTES = 3_000_000_000
MAX_MEMORY = 3_000_000_000
MAX_SECONDS = 600
MAX_HEADER = 64 * 1024
MAX_METADATA = 64 * 1024 * 1024
HASH = re.compile('[a-f0-9]{64}')
IDENT = re.compile('[A-Za-z0-9_.-]{1,256}')
# Explicit producer vocabulary. Unknown values never become diagnostic text.
DIAGNOSTIC_VALUES = {
    'status': frozenset('pending compiled retry_pending excluded no_rail non_timetable source_alias failed'.split()),
    'reason_code': frozenset(('source_access_review provider_policy source_terms_prohibit_derived_use non_timetable_format '
        'ambiguous_source_reference unresolved_source_reference duplicate_static_source missing_source_url '
        'unresolved_source_cache_identity source_reference_identity_changed source_retry_after source_http_404 '
        'source_access_denied source_retrieval_error calendar_horizon memory_limit time_limit table_row_limit '
        'byte_limit invalid_archive_or_gtfs compile_error source_cache_policy_restriction unresolved_source_cache_policy').split()),
    'failure_stage': frozenset('discovery retrieval calendar resources parsing compilation'.split()),
    'next_action': frozenset(('review_source_access_or_declared_public_alternative resolve_catalogue_reference '
        'repair_or_find_feed_url refresh_from_public_source_or_review_cache_provenance '
        'refresh_from_public_source_or_review_source_identity retry_source_or_repair_compiler '
        'refresh_from_permitted_source_or_review_cache_policy').split()),
}
ATTEMPT_CODES = frozenset(('other_source_error retry_after_pending source_access_hold source_identity_changed '
    'source_cache_access_hold source_cache_identity_unresolved source_policy unsafe_source_url connection_error '
    'invalid_zip invalid_feed_or_budget missing_source_url source_cache_policy_blocked source_cache_policy_unresolved').split())
HTTP_ATTEMPT = re.compile('http_[1-5][0-9]{2}')
FEED_ERRORS = frozenset(('compressed_feed_byte_limit expanded_feed_byte_limit feed_identity_mismatch feed_io_failure '
    'feed_memory_limit feed_metadata_invalid gzip_header_limit gzip_trailing_data invalid_feed_shape invalid_gzip_header '
    'invalid_gzip_payload invalid_json metadata_byte_limit metadata_input_changed nonregular_input symlink_input truncated_gzip').split())
STAGE_ERRORS = FEED_ERRORS | frozenset(('aggregate_binding_mismatch aggregate_inventory_mismatch catalogue_report_binding_mismatch '
    'cross_shard_output_collision duplicate_expected_id duplicate_feed_id duplicate_feed_output expected_metadata_byte_limit '
    'expected_metadata_renderer_failed expected_metadata_renderer_invalid expected_metadata_time_limit feed_stage_digest_mismatch '
    'feed_time_limit feed_worker_failed incomplete_inventory input_directory_missing invalid_aggregate invalid_catalogue '
    'invalid_catalogue_report invalid_compiled_binding invalid_feed_id invalid_shard_directory inventory_catalogue_mismatch '
    'inventory_missing inventory_outcome_invalid inventory_partial inventory_provenance_mismatch inventory_schema_mismatch '
    'inventory_stale_or_mismatched noncompiled_feed_output overlapping_stage_paths publication_index_binding_mismatch '
    'shard_directory_mismatch shard_receipt_mismatch shard_sidecar_mismatch snapshot_receipt_mismatch snapshot_sidecar_mismatch '
    'stage_destination_exists stage_io_failure stage_memory_limit stage_metadata_invalid tile_contract_changed '
    'unexpected_shard_artifact unexpected_snapshot_artifact producer_not_successful stage_validation_failed').split())


class StageError(ValueError):
    pass


def require(condition, code):
    if not condition:
        raise StageError(code)


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        while chunk := source.read(1024 * 1024): result.update(chunk)
    return result.hexdigest()


def regular(path):
    # Reject symlink components too: resolving first would conceal them.
    for part in [*reversed(path.parents), path]:
        require(not part.is_symlink(), 'symlink_input')
    require(stat.S_ISREG(path.stat().st_mode), 'nonregular_input')
    return path


def read_json(path, maximum=MAX_METADATA):
    regular(path)
    size=path.stat().st_size
    require(size <= maximum, 'metadata_byte_limit')
    with path.open('rb') as source: data = source.read(size + 1)
    require(len(data) == size, 'metadata_input_changed')
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:raise ValueError('duplicate_field')
            result[key]=value
        return result
    def finite(text):
        value=float(text)
        if not math.isfinite(value):raise ValueError('nonfinite_number')
        return value
    def invalid_constant(_):raise ValueError('nonfinite_number')
    try:return json.loads(data,object_pairs_hook=pairs,parse_float=finite,parse_constant=invalid_constant)
    except (ValueError, UnicodeError, RecursionError): raise StageError('invalid_json') from None


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)+'\n')


def hash_value(value):
    return hashlib.sha256(pipeline.registry.publication.encoded(value)).hexdigest()


def check_header(source):
    start = source.tell(); head = source.read(10)
    require(len(head) == 10 and head[:3] == b'\x1f\x8b\x08' and not head[3] & 0xe0, 'invalid_gzip_header')
    flags = head[3]
    if flags & 4:
        length = source.read(2); require(len(length) == 2, 'invalid_gzip_header')
        size = int.from_bytes(length, 'little')
        require(source.tell()-start+size <= MAX_HEADER, 'gzip_header_limit')
        require(len(source.read(size)) == size, 'invalid_gzip_header')
    for flag in (8, 16):
        if flags & flag:
            while True:
                require(source.tell()-start < MAX_HEADER, 'gzip_header_limit')
                byte = source.read(1); require(bool(byte), 'invalid_gzip_header')
                if byte == b'\0': break
    if flags & 2:
        require(len(source.read(2)) == 2, 'invalid_gzip_header')
    require(source.tell()-start <= MAX_HEADER, 'gzip_header_limit')
    source.seek(start)


def expand_feed(source_path, destination, limit):
    regular(source_path)
    require(source_path.stat().st_size <= limit, 'compressed_feed_byte_limit')
    decoder = zlib.decompressobj(16 + zlib.MAX_WBITS)
    expanded = 0
    with source_path.open('rb') as source, destination.open('wb') as output:
        check_header(source)
        while chunk := source.read(1024 * 1024):
            require(not decoder.eof, 'gzip_trailing_data')
            while chunk:
                try: decoded = decoder.decompress(chunk, min(1024 * 1024, limit-expanded+1))
                except zlib.error: raise StageError('invalid_gzip_payload') from None
                expanded += len(decoded)
                require(expanded <= limit, 'expanded_feed_byte_limit')
                output.write(decoded)
                require(not decoder.unused_data, 'gzip_trailing_data')
                chunk = decoder.unconsumed_tail
        require(decoder.eof, 'truncated_gzip')
    return expanded


def feed_worker(request_path):
    import resource
    request = read_json(request_path, 16384)
    resource.setrlimit(resource.RLIMIT_AS, (request['memory'], request['memory']))
    source, target = Path(request['source']), Path(request['target'])
    try:
        with tempfile.TemporaryDirectory(prefix='.feed-json-', dir=target.parent) as work:
            plain = Path(work)/'feed.json'
            expanded = expand_feed(source, plain, request['bytes'])
            # One bounded national feed at a time, never a second geometry copy.
            feed = read_json(plain, request['bytes'])
            require(isinstance(feed, dict) and isinstance(feed.get('source'), dict), 'invalid_feed_shape')
            actual = feed['source']
            require(all(actual.get(key) == request[key] for key in ('id', 'sha256', 'service_date')), 'feed_identity_mismatch')
            require(all(isinstance(feed.get(key), list) for key in ('routes', 'agencies', 'segments')), 'invalid_feed_shape')
            pipeline.write_feed(target, feed)
            write_json(Path(request['response']), {'schema':1, 'expanded_bytes':expanded, 'sha256':digest(target)})
        return 0
    except StageError as error: code = str(error)
    except MemoryError: code = 'feed_memory_limit'
    except (ValueError, TypeError, KeyError, UnicodeError, RecursionError): code = 'feed_metadata_invalid'
    except OSError: code = 'feed_io_failure'
    write_json(Path(request['response']), {'schema':1, 'error':code})
    return 1


def stage_feed(source, target, entry, args, work):
    target.parent.mkdir(parents=True, exist_ok=True)
    regular(source)
    request, response = work/'feed-request.json', work/'feed-response.json'
    response.unlink(missing_ok=True)
    write_json(request, {'source':str(source), 'target':str(target), 'response':str(response),
        'id':entry['id'], 'sha256':entry['sha256'], 'service_date':args.date,
        'bytes':args.max_feed_bytes, 'memory':args.max_feed_memory_bytes})
    try:
        run = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--feed-request', str(request)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=args.max_feed_seconds)
    except subprocess.TimeoutExpired: raise StageError('feed_time_limit') from None
    result = read_json(response, 4096) if response.exists() else {}
    if run.returncode:
        code = result.get('error') if isinstance(result,dict) else None
        valid = (isinstance(result,dict) and set(result)=={'schema','error'} and type(result['schema']) is int
            and result['schema']==1 and isinstance(code,str) and code in FEED_ERRORS)
        raise StageError(code if valid else 'feed_worker_failed')
    require(isinstance(result,dict) and set(result)=={'schema','expanded_bytes','sha256'}
        and type(result['schema']) is int and result['schema']==1 and type(result['expanded_bytes']) is int
        and 0<result['expanded_bytes']<=args.max_feed_bytes
        and result['sha256']==digest(regular(target)), 'feed_stage_digest_mismatch')
    request.unlink(); response.unlink()


def context(args):
    rows = read_json(args.catalogue, pipeline.registry.publication.MAX_INPUT_BYTES)
    require(isinstance(rows, list), 'invalid_catalogue')
    catalogue_hash = digest(args.catalogue)
    report = read_json(args.catalogue_report, pipeline.registry.publication.MAX_REPORT_BYTES)
    fields = {'schema','publication_index','catalogue_sha256','transitous_ref','sources','transitland_ref',
              'transitland_state','transitland_reason','input_sha256','counts','note'}
    require(isinstance(report, dict) and set(report) == fields and report.get('schema') == 4, 'invalid_catalogue_report')
    require(report.get('catalogue_sha256') == catalogue_hash, 'catalogue_report_binding_mismatch')
    read_json(args.publication_index, pipeline.registry.publication.MAX_INDEX_BYTES)
    publication, state = pipeline.registry.publication.read_context(args.publication_index, report)
    require(state == 'verified' and publication is not None, 'publication_index_binding_mismatch')
    provenance = pipeline.catalogue_provenance(args.catalogue_report, catalogue_hash, len(rows), True, report)
    provenance['publication_context'] = {'state':state,'index_sha256':digest(args.publication_index)}
    expected = pipeline.discover(rows, read_json(args.rules), publication)
    require(len({entry['id'] for entry in expected}) == len(expected), 'duplicate_expected_id')
    return {'hash':catalogue_hash, 'provenance':pipeline.published_metadata(provenance), 'entries':expected,
            'report':digest(args.catalogue_report), 'index':digest(args.publication_index)}


def snapshot_catalogues(ctx, args):
    """Exactly replay the existing Python producer -> JS assembler display path.

    Both input and output are local bounded JSON files. No source string becomes
    a command, path or acquisition target. Report/index were already verified.
    """
    import resource
    fixed_code = ("import {readFileSync} from 'node:fs'; "
        "import {publishedMetadata} from './scripts/assemble-global-frequency.mjs'; "
        "process.stdout.write(JSON.stringify(publishedMetadata(JSON.parse(readFileSync(0,'utf8'))))); ")
    values=[pipeline.published_metadata(entry['catalogue']) for entry in ctx['entries']]
    def output_budget():resource.setrlimit(resource.RLIMIT_FSIZE,(MAX_METADATA,MAX_METADATA))
    with tempfile.TemporaryDirectory(prefix='.frequency-expected-') as folder:
        request,response=Path(folder)/'request.json',Path(folder)/'response.json'
        write_json(request,values)
        require(request.stat().st_size<=MAX_METADATA,'expected_metadata_byte_limit')
        with request.open('rb') as source,response.open('wb') as result:
            try:
                run=subprocess.run(['node','--max-old-space-size=512','--input-type=module','-e',fixed_code],
                    cwd=ROOT,stdin=source,stdout=result,stderr=subprocess.DEVNULL,preexec_fn=output_budget,
                    timeout=min(args.max_feed_seconds,MAX_SECONDS))
            except subprocess.TimeoutExpired:raise StageError('expected_metadata_time_limit') from None
        require(run.returncode==0,'expected_metadata_renderer_failed')
        rendered=read_json(response)
    require(isinstance(rendered,list) and len(rendered)==len(values),'expected_metadata_renderer_invalid')
    return {entry['id']:row for entry,row in zip(ctx['entries'],rendered)}


def selected_ids(ctx, shard, shards):
    return sorted(entry['id'] for entry in ctx['entries']
                  if int(hashlib.sha256(entry['id'].encode()).hexdigest(), 16) % shards == shard)


def inventory(path, ctx, args, shard):
    require(path.exists(), 'inventory_missing')
    value = read_json(path)
    require(isinstance(value, dict) and value.get('schema') == 3, 'inventory_schema_mismatch')
    require(value.get('catalogue_sha256') == ctx['hash'] and value.get('service_date') == args.date
        and value.get('shard') == shard and value.get('shards') == args.shards
        and value.get('catalogue_entries') == len(ctx['entries']), 'inventory_stale_or_mismatched')
    require(value.get('catalogue_provenance') == ctx['provenance'], 'inventory_provenance_mismatch')
    entries = value.get('entries')
    require(isinstance(entries, list) and all(isinstance(e, dict) for e in entries), 'inventory_schema_mismatch')
    expected = selected_ids(ctx, shard, args.shards)
    actual = [e.get('id') for e in entries]
    require(all(isinstance(ident, str) and IDENT.fullmatch(ident) for ident in actual), 'invalid_feed_id')
    require(len(set(actual)) == len(actual), 'duplicate_feed_id')
    if sorted(actual) != expected:
        require(not set(actual).issubset(expected), 'inventory_partial')
        raise StageError('inventory_stale_or_mismatched')
    original = {e['id']:e for e in ctx['entries']}
    outputs = set()
    for entry in entries:
        if 'snapshot_catalogues' in ctx:
            # Compare exact assembler output, before any further lossy rendering.
            require(entry.get('catalogue') == ctx['snapshot_catalogues'][entry['id']], 'inventory_catalogue_mismatch')
        else:
            require(pipeline.published_metadata(entry.get('catalogue')) ==
                pipeline.published_metadata(original[entry['id']]['catalogue']), 'inventory_catalogue_mismatch')
        require(entry.get('status') in {'compiled','retry_pending','excluded','no_rail','non_timetable','source_alias'}, 'inventory_outcome_invalid')
        if original[entry['id']]['status'] != 'pending':
            require(entry.get('status') == original[entry['id']]['status'], 'inventory_outcome_invalid')
        if entry.get('status') == 'compiled':
            require(entry.get('output') == 'feeds/'+entry['id']+'.json.gz' and
                    isinstance(entry.get('sha256'), str) and HASH.fullmatch(entry['sha256']), 'invalid_compiled_binding')
            require(entry['output'] not in outputs, 'duplicate_feed_output'); outputs.add(entry['output'])
        else:
            require(not entry.get('output'), 'noncompiled_feed_output')
    return value


def sidecars(target, args):
    shutil.copyfile(regular(args.catalogue_report), target/'catalogue-report.json')
    shutil.copyfile(regular(args.publication_index), target/'publication-index.json')


def file_hashes(root):
    result = {}
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'symlink_input')
        if path.is_dir(): continue
        regular(path); result[path.relative_to(root).as_posix()] = digest(path)
    return result


def receipt(ctx, args, shard, files):
    return {'schema':1,'status':'complete','mode':'shard','shard':shard,'shards':args.shards,
        'catalogue_sha256':ctx['hash'],'service_date':args.date,
        'expected_ids_sha256':hash_value(selected_ids(ctx, shard, args.shards)),
        'files':files}


def validate_receipt(record, ctx, args, shard, value, actual=None):
    """A post-assembly inventory digest is provenance, never current-byte proof."""
    names = {f'inventory-{shard}.json','catalogue-report.json','publication-index.json'} | {
        entry['output'] for entry in value['entries'] if entry['status']=='compiled'}
    require(isinstance(record,dict) and isinstance(record.get('files'),dict), 'shard_receipt_mismatch')
    files=record['files']
    require(set(files)==names and all(isinstance(data,str) and HASH.fullmatch(data) for data in files.values()),
        'shard_receipt_mismatch')
    require(all(type(record.get(key)) is int for key in ('schema','shard','shards'))
        and record==receipt(ctx,args,shard,files), 'shard_receipt_mismatch')
    require(files['catalogue-report.json']==ctx['report'] and files['publication-index.json']==ctx['index'],
        'shard_sidecar_mismatch')
    if actual is not None:
        require(set(actual)==names and all(files[name]==data for name,data in actual.items()), 'shard_receipt_mismatch')
    return record


def stage_shard(args, ctx, target, work):
    value = inventory(args.input/f'inventory-{args.shard}.json', ctx, args, args.shard)
    published = pipeline.published_metadata(value)
    write_json(target/f'inventory-{args.shard}.json', published)
    sidecars(target, args)
    for entry in value['entries']:
        if entry['status'] == 'compiled': stage_feed(args.input/entry['output'],target/entry['output'],entry,args,work)
    record=receipt(ctx,args,args.shard,file_hashes(target))
    validate_receipt(record,ctx,args,args.shard,value)
    write_json(target/f'stage-receipt-{args.shard}.json',record)


def merge_shards(args, ctx, target):
    expected_roots = {f'worldwide-frequency-shard-{i}' for i in range(args.shards)}
    require({p.name for p in args.input.iterdir()} == expected_roots, 'shard_directory_mismatch')
    inventories = []
    for shard in range(args.shards):
        root = args.input/f'worldwide-frequency-shard-{shard}'
        require(root.is_dir() and not root.is_symlink(), 'invalid_shard_directory')
        value = inventory(root/f'inventory-{shard}.json', ctx, args, shard)
        record = read_json(root/f'stage-receipt-{shard}.json')
        actual = file_hashes(root); actual.pop(f'stage-receipt-{shard}.json', None)
        validate_receipt(record,ctx,args,shard,value,actual)
        required = {f'inventory-{shard}.json','catalogue-report.json','publication-index.json'} | {
            e['output'] for e in value['entries'] if e['status'] == 'compiled'}
        require(set(actual) == required, 'unexpected_shard_artifact')
        require(actual['catalogue-report.json'] == ctx['report'] and actual['publication-index.json'] == ctx['index'], 'shard_sidecar_mismatch')
        for name in [f'inventory-{shard}.json',f'stage-receipt-{shard}.json'] + [e['output'] for e in value['entries'] if e['status'] == 'compiled']:
            require(not (target/name).exists(), 'cross_shard_output_collision')
            (target/name).parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(regular(root/name),target/name)
        inventories.append(value)
    sidecars(target,args)
    # The ordinary assembler still independently validates complete alias proof.
    require(sum(len(value['entries']) for value in inventories) == len(ctx['entries']), 'incomplete_inventory')


def stage_snapshot(args, ctx, target, work):
    inventories = [inventory(args.input/f'inventory-{shard}.json',ctx,args,shard) for shard in range(args.shards)]
    entries = [entry for value in inventories for entry in value['entries']]
    aggregated = read_json(args.input/'inventory.json'); manifest = read_json(args.input/'manifest.json')
    require(isinstance(aggregated, dict) and isinstance(manifest, dict), 'invalid_aggregate')
    for value in [aggregated,manifest]:
        require(value.get('catalogue_sha256') == ctx['hash'] and value.get('service_date') == args.date
                and value.get('catalogue_provenance') == ctx['provenance'], 'aggregate_binding_mismatch')
    aggregate_entries=aggregated.get('entries')
    require(isinstance(aggregate_entries,list) and all(isinstance(e,dict) for e in aggregate_entries)
        and len(aggregate_entries)==len(entries)
        and {e.get('id'):e for e in aggregate_entries}=={e['id']:e for e in entries}, 'aggregate_inventory_mismatch')
    require(read_json(args.input/'tiles/index.json') == {'tiles':[]} and manifest.get('tiles') == 0, 'tile_contract_changed')
    require({p.name for p in (args.input/'tiles').iterdir()} == {'index.json'}, 'tile_contract_changed')
    expected = {'inventory.json','manifest.json','tiles','feeds','catalogue-report.json','publication-index.json'} | {
        f'inventory-{i}.json' for i in range(args.shards)} | {f'stage-receipt-{i}.json' for i in range(args.shards)}
    require({p.name for p in args.input.iterdir()} <= expected, 'unexpected_snapshot_artifact')
    require(digest(regular(args.input/'catalogue-report.json')) == ctx['report'] and digest(regular(args.input/'publication-index.json')) == ctx['index'], 'snapshot_sidecar_mismatch')
    sidecars(target,args)
    for i,value in enumerate(inventories):
        write_json(target/f'inventory-{i}.json',pipeline.published_metadata(value))
        rec = read_json(args.input/f'stage-receipt-{i}.json')
        validate_receipt(rec,ctx,args,i,value)
        # Assembly rewrites inventory JSON, but never changes referenced gzip or sidecars.
        for name,expected in rec['files'].items():
            if name != f'inventory-{i}.json':
                require(digest(regular(args.input/name))==expected, 'snapshot_receipt_mismatch')
        write_json(target/f'stage-receipt-{i}.json',rec)
    write_json(target/'inventory.json',pipeline.published_metadata(aggregated))
    write_json(target/'manifest.json',pipeline.published_metadata(manifest))
    write_json(target/'tiles/index.json',{'tiles':[]})
    for entry in entries:
        if entry['status'] == 'compiled':stage_feed(args.input/entry['output'],target/entry['output'],entry,args,work)
    write_json(target/'snapshot-stage-receipt.json',{'schema':1,'status':'complete','mode':'snapshot',
        'catalogue_sha256':ctx['hash'],'service_date':args.date,'files':file_hashes(target)})


def diagnose(args, code, ctx=None):
    result={'schema':1,'status':'diagnostic_only','mode':args.mode if args.mode in {'shard','assembly-input','snapshot'} else 'unknown',
            'producer_outcome':args.producer_outcome if args.producer_outcome in {'success','failure','cancelled','skipped'} else 'unknown',
            'reason_code':code if isinstance(code,str) and code in STAGE_ERRORS else 'stage_validation_failed',
            'inventory_state':'missing','entries':[]}
    trusted_ids={entry['id'] for entry in ctx['entries']} if ctx else set()
    path=args.input/f'inventory-{args.shard}.json'
    if path.exists():
        try:
            value=read_json(path)
            if ctx:
                try: inventory(path,ctx,args,args.shard); state='complete'
                except StageError as error: state='partial' if str(error)=='inventory_partial' else 'stale_or_invalid'
            else:state='unverified'
            result['inventory_state']=state
            if isinstance(value,dict) and isinstance(value.get('entries'),list):
                result['entries_total']=len(value['entries']);result['entries_truncated']=len(value['entries'])>1000
                for index,entry in enumerate(value['entries'][:1000]):
                    if not isinstance(entry,dict):continue
                    record={'entry_index':index}
                    ident=entry.get('id')
                    if isinstance(ident,str) and ident in trusted_ids:record['id']=ident
                    for key,allowed in DIAGNOSTIC_VALUES.items():
                        if key in entry:
                            data=entry[key]
                            record[key]=data if isinstance(data,str) and (data in allowed or data=='') else 'unknown'
                    if type(entry.get('retry_eligible')) is bool:record['retry_eligible']=entry['retry_eligible']
                    attempts=entry.get('source_attempts')
                    if isinstance(attempts,list):
                        safe=[]
                        for attempt in attempts[:8]:
                            if not isinstance(attempt,dict):continue
                            detail={}
                            if 'code' in attempt:
                                code=attempt['code']
                                detail['code']=code if isinstance(code,str) and (code in ATTEMPT_CODES or HTTP_ATTEMPT.fullmatch(code)) else 'unknown'
                            url=attempt.get('url')
                            if isinstance(url,str) and len(url)<=4096:detail['url']=pipeline.redacted_source_url(url)
                            if detail:safe.append(detail)
                        if safe:record['source_attempts']=safe
                    result['entries'].append(record)
        except (OSError,ValueError,TypeError,RecursionError):result['inventory_state']='unreadable'
    write_json(args.diagnostics/'receipt.json',result)


def run(args):
    paths=[args.input,args.output,args.diagnostics]
    for path in paths:
        require(not any(parent.is_symlink() for parent in [path,*path.parents]),'symlink_input')
    resolved=[path.resolve() for path in paths]
    require(all(a != b and a not in b.parents and b not in a.parents
                for i,a in enumerate(resolved) for b in resolved[i+1:]),'overlapping_stage_paths')
    require(not args.output.exists() and not args.diagnostics.exists(),'stage_destination_exists')
    ctx=None
    try:
        require(args.input.is_dir(),'input_directory_missing')
        ctx=context(args)
        if args.producer_outcome != 'success':
            diagnose(args,'producer_not_successful',ctx)
            return 0
        if args.mode=='snapshot':ctx['snapshot_catalogues']=snapshot_catalogues(ctx,args)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.frequency-stage-',dir=args.output.parent) as temporary:
            work=Path(temporary);target=work/'artifact';target.mkdir()
            if args.mode=='shard':stage_shard(args,ctx,target,work)
            elif args.mode=='assembly-input':merge_shards(args,ctx,target)
            else:stage_snapshot(args,ctx,target,work)
            require(not args.output.exists(),'stage_destination_exists')
            target.rename(args.output)
        return 0
    except StageError as error:code=str(error)
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError):code='stage_metadata_invalid'
    except MemoryError:code='stage_memory_limit'
    except OSError:code='stage_io_failure'
    diagnose(args,code,ctx)
    return 1


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ('input','output','diagnostics','catalogue','catalogue-report','publication-index'):
        parser.add_argument('--'+key,type=Path,required=True)
    parser.add_argument('--rules',type=Path,default=ROOT/'styles/data-src/frequency-source-rules.json')
    parser.add_argument('--mode',choices=('shard','assembly-input','snapshot'),required=True)
    parser.add_argument('--producer-outcome',choices=('success','failure','cancelled','skipped'),required=True)
    parser.add_argument('--date',required=True)
    parser.add_argument('--shard',type=int,default=0);parser.add_argument('--shards',type=int,required=True)
    parser.add_argument('--max-feed-bytes',type=int,default=MAX_BYTES)
    parser.add_argument('--max-feed-memory-bytes',type=int,default=MAX_MEMORY)
    parser.add_argument('--max-feed-seconds',type=float,default=MAX_SECONDS)
    args=parser.parse_args()
    if not (0<=args.shard<args.shards<=1024 and 0<args.max_feed_bytes<=MAX_BYTES
            and 0<args.max_feed_memory_bytes<=MAX_MEMORY and 0<args.max_feed_seconds<=MAX_SECONDS):
        parser.error('invalid_staging_budget_or_shard')
    pipeline.dt.date.fromisoformat(args.date)
    try:return run(args)
    except (StageError,OSError,ValueError,TypeError):
        # Unsafe destination/overlap errors cannot authorize writing diagnostics there.
        print('frequency_stage_path_or_configuration_invalid',file=sys.stderr);return 1


if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='--feed-request':sys.exit(feed_worker(Path(sys.argv[2])))
    sys.exit(main())
