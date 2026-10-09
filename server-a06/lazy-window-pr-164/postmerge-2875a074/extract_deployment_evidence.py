from pathlib import Path
import argparse,hashlib,json
p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('output');a=p.parse_args()
b=Path(a.source).read_bytes();s=b.decode('utf-8');lines=s.splitlines(keepends=True)
selected=[line for line in lines if ('pages_build_version' in line or 'Created deployment for ' in line or 'Z PASS: exact deployed vector tile ' in line or 'Z PASS: Wuhan rail overlays ' in line)]
if len(selected)!=9:raise ValueError(f'Expected two deployment identities and seven PASS lines, got {len(selected)}')
out=''.join(selected).encode('utf-8');Path(a.output).write_bytes(out)
print(json.dumps({'source_bytes':len(b),'source_sha256':hashlib.sha256(b).hexdigest(),'excerpt_bytes':len(out),'excerpt_sha256':hashlib.sha256(out).hexdigest(),'selected_lines':len(selected)}))
