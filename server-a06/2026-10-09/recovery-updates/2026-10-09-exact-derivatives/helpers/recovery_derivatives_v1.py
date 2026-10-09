#!/usr/bin/env python3
"""New replacement-workspace recovery helper, not a recovered original helper.
Only accept generated archives where the original pre-loss length and SHA-256
match exactly. No measurements, provider traffic or publication is performed.
"""
from pathlib import Path
import gzip,hashlib,json,re,zipfile
ROOT=Path(__file__).resolve().parent
records=json.loads((ROOT/'private-input-recovery-verification.json').read_text())
original=json.loads((ROOT/'recovery-plan-original.json').read_text())
expected={x['relative_path']:x for x in original['files']}
TARGET=ROOT/'derivative-recovery-v1';TARGET.mkdir(exist_ok=True)
regex=re.compile(rb'([?&](?:api[_-]?key|token|key|rlkey|access[_-]?token|refresh[_-]?token|secret|password|signature|credential|session|auth|uid)=)([^&#"\\\s]+)',re.I)
changed_paths={'feeds/us-az_valleymetro.json.gz',*[f'inventory-{i}.json' for i in range(7)]}
results=[];changes={}
for record in sorted(records['shards'],key=lambda x:x['shard']):
 shard=record['shard']
 if type(shard) is not int or not 0<=shard<=7:raise ValueError('Invalid shard index')
 src=Path(record['local_private_path']);raw=src.read_bytes()
 if len(raw)!=record['bytes'] or hashlib.sha256(raw).hexdigest()!=record['sha256']:raise ValueError('Original archive changed')
 name=f'worldwide-frequency-shard-{shard}-sanitized.zip';target=TARGET/name
 with zipfile.ZipFile(src) as z,zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as out:
  if z.testzip() is not None:raise ValueError('Original ZIP CRC failure')
  for member in z.infolist():
   if member.is_dir():continue
   data=z.read(member)
   if member.filename in changed_paths:
    payload=gzip.decompress(data) if member.filename.endswith('.gz') else data
    transformed,count=regex.subn(lambda m:m.group(1),payload)
    if not count:raise ValueError('Expected transformation absent')
    if member.filename.endswith('.gz'):
     old=json.loads(payload);new=json.loads(transformed)
     if {k:v for k,v in old.items() if k!='source'}!={k:v for k,v in new.items() if k!='source'}:raise ValueError('Timetable data changed')
     data=gzip.compress(transformed,compresslevel=9,mtime=0)
    else:data=transformed
    changes[member.filename]=count
   zi=zipfile.ZipInfo(member.filename,date_time=(2026,10,9,0,0,0));zi.compress_type=zipfile.ZIP_DEFLATED;zi.external_attr=0o100644<<16
   out.writestr(zi,data)
 raw=target.read_bytes();e=expected['sanitized-retention/'+name];sha=hashlib.sha256(raw).hexdigest();matches=sha==e['sha256'] and len(raw)==e['bytes']
 results.append({'original_path':e['relative_path'],'original_sha256':e['sha256'],'recovered_sha256':sha,'bytes':len(raw),'exact_original_match':matches,'local_path':str(target),'recovery_method':'New helper reproduced the recorded sanitization and deterministic ZIP construction; accepted only by exact original length and SHA-256.'})
 if not matches:target.rename(target.with_name(target.name+'.unverified'))
report={'new_helper_identity':'recovery_derivatives_v1.py, written after workspace replacement; not counted as one of the five missing original helpers','status':'all_eight_archives_exactly_recovered' if all(x['exact_original_match'] for x in results) else 'some_archives_unverified','matched_archive_count':sum(x['exact_original_match'] for x in results),'transformed_member_count':len(changes),'removed_query_value_occurrences':sum(changes.values()),'timetable_content_preserved':True,'measurement_reruns':0,'published':False,'archives':results}
(ROOT/'derivative-recovery-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='archives'},indent=2))
