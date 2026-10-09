#!/usr/bin/env python3
"""New recovery helper; accept records only if pre-loss SHA-256 matches.
No assembler or timing measurement is run. This helper is not an original file.
"""
from pathlib import Path
import gzip,hashlib,json,re,zipfile,os
ROOT=Path(__file__).resolve().parent
oldplan=json.loads((ROOT/'recovery-plan-original.json').read_text());wanted={x['relative_path']:x for x in oldplan['files']}
source=json.loads((ROOT/'private-input-recovery-verification.json').read_text());archive_recovery=json.loads((ROOT/'derivative-recovery-verification.json').read_text())
regex=re.compile(rb'([?&](?:api[_-]?key|token|key|rlkey|access[_-]?token|refresh[_-]?token|secret|password|signature|credential|session|auth|uid)=)([^&#"\\\s]+)',re.I)
original={};clean={};archives=[]
for original_archive,derived in zip(sorted(source['shards'],key=lambda x:x['shard']),archive_recovery['archives']):
 with zipfile.ZipFile(original_archive['local_private_path']) as z:
  original.update({x.filename:z.read(x) for x in z.infolist() if not x.is_dir()})
 with zipfile.ZipFile(derived['local_path']) as z:
  clean.update({x.filename:z.read(x) for x in z.infolist() if not x.is_dir()})
 archives.append({'path':derived['original_path'],'original_artifact_id':original_archive['artifact_id'],'original_archive_sha256':original_archive['sha256'],'sanitized_archive_sha256':derived['original_sha256'],'bytes':derived['bytes']})
 target=ROOT/'recovered-verified'/derived['original_path'];target.parent.mkdir(parents=True,exist_ok=True)
 if not target.exists():os.link(derived['local_path'],target)
records=[]
for name in sorted(original):
 a=original[name];b=clean[name];n=0
 if a!=b:
  payload=gzip.decompress(a) if name.endswith('.gz') else a
  transformed,n=regex.subn(lambda m:m.group(1),payload)
  if not n:raise ValueError('Unexpected changed member')
 records.append({'path':name,'original_sha256':hashlib.sha256(a).hexdigest(),'sanitized_sha256':hashlib.sha256(b).hexdigest(),'original_bytes':len(a),'sanitized_bytes':len(b),'removed_query_values':n,'gzip_recompressed':bool(n and name.endswith('.gz'))})
with zipfile.ZipFile(source['snapshot']['local_private_path']) as z:
 original_snapshot={x.filename:z.read(x) for x in z.infolist() if not x.is_dir()}
expected=[];tree=ROOT/'reconstructed-sanitized-tree-v1';tree.mkdir(exist_ok=True)
for name in sorted(original_snapshot):
 a=original_snapshot[name];b=clean[name] if name in clean else regex.sub(lambda m:m.group(1),a)
 expected.append({'path':name,'original_sha256':hashlib.sha256(a).hexdigest(),'sanitized_sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)})
 target=(tree/name).resolve()
 if not target.is_relative_to(tree.resolve()):raise ValueError('Unsafe reconstruction member')
 target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b)
ref=wanted['sanitized-retention/matching-snapshot-reference-sanitized.tar.gz']
meta={'classification':'sanitized derived fixtures, not byte-identical original inputs','transformation':'For URL-style query parameters with case-insensitive names api[_-]?key, token, key, rlkey, access[_-]?token, refresh[_-]?token, secret, password, signature, credential, session, auth, uid, remove nonempty value bytes between = and the next delimiter. Keep parameter names and all other bytes unchanged. Recompress only changed .json.gz members with gzip level 9, mtime 0. Repackage original shard member sets as separately named deterministic ZIPs. The opaque uid parameter is removed conservatively because its access semantics were not established; this is not a claim that uid is a working credential. No original is modified. Apply the same transformation to exact reference metadata and retained compiled-feed bytes.','regex_ascii':regex.pattern.decode(),'input_files':records,'expected_files':expected,'derived_archives':archives,'changed_input_files':[x['path'] for x in records if x['removed_query_values']],'total_removed_query_values_in_inputs':sum(x['removed_query_values'] for x in records),'non_source_timetable_content_unchanged':True,'source_attribution_policy':'All names, credits, licences, URLs and query-parameter names remain; only possible access/authentication value bytes are removed. Sanitized URLs are evidence metadata and must not be exercised as live download links.','reference_pack':{'path':ref['relative_path'],'bytes':ref['bytes'],'sha256':ref['sha256']},'verified_replay':{'run':7,'source_commit':'6f43c9f9ca998ea5b3081655b6a43bb29ae51713','comparison_target':'equivalently sanitized expected snapshot, not the original snapshot','matching_files':117,'coverage':{'catalogue_entries':2039,'summary_feeds':106,'mapped_feeds':86,'countries':66,'tiles':0,'counts':{'excluded':1220,'no_rail':635,'compiled':106,'failed':78}}}}
files=[]
for p in sorted(tree.rglob('*')):
 if p.is_file():
  b=p.read_bytes();files.append({'path':p.relative_to(tree).as_posix(),'bytes':len(b),'allocated_bytes':p.stat().st_blocks*512,'sha256':hashlib.sha256(b).hexdigest()})
identity={'file_count':len(files),'bytes':sum(x['bytes'] for x in files),'allocated_file_bytes':sum(x['allocated_bytes'] for x in files),'files':files}
results=[]
for path,value in [('sanitization-manifest.json',meta),('raw/run-07/output-identity.json',identity)]:
 b=(json.dumps(value,indent=2)+'\n').encode();h=hashlib.sha256(b).hexdigest();e=wanted[path];matches=h==e['sha256'] and len(b)==e['bytes']
 if matches:
  p=ROOT/'recovered-verified'/path;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
 else:(ROOT/('new-unmatched-'+Path(path).name)).write_bytes(b)
 results.append({'original_path':path,'exact_original_match':matches,'bytes':len(b),'sha256':h,'original_sha256':e['sha256'],'method':'Deterministic reconstruction from hash-verified frozen input/reference data; accepted only if the full original record hash matches. Not a replacement measurement.'})
(ROOT/'manifest-recovery-verification.json').write_text(json.dumps({'new_helper':'recovery_manifests_v1.py','measurement_reruns':0,'results':results},indent=2)+'\n')
print(json.dumps(results,indent=2))
