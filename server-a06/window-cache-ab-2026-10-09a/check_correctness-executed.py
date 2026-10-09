from pathlib import Path
import json,shutil,subprocess,sys,datetime,hashlib
root=Path('/workspace/shared/atlas-a06-window-cache-ab-20261009a');base=Path('/workspace/shared/atlas-a06-replay-cohort-20261009a');sys.path.insert(0,str(root/'publish'));import measure_replay as m
expected=json.loads((base/'publish/replay-manifest.json').read_text());all_results=[]
for side in ('control','candidate'):
 output=root/'work'/('correctness-'+side);artifact=root/'publish/correctness'/side
 if output.exists() or artifact.exists():raise ValueError('Correctness run already exists')
 artifact.mkdir(parents=True);shutil.copytree(base/'work/reconstructed/input',output)
 before=m.identity(output)
 if not m.compare_outputs(before,expected['inputs'])['exact_match']:raise ValueError('Input mismatch')
 start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (artifact/'stdout.log').open('wb') as stdout,(artifact/'stderr.log').open('wb') as stderr:
  result=subprocess.run([str(root/'runtime/node'),'--max-old-space-size=1536',str(root/('source-'+side)/'scripts/assemble-global-frequency.mjs'),str(output)],cwd=root/('source-'+side),stdout=stdout,stderr=stderr,stdin=subprocess.DEVNULL,timeout=300,preexec_fn=m.child_bounds)
 after=m.identity(output);comparison=m.compare_outputs(after,expected['expected']);m.write_json(artifact/'output-identity.json',after);m.write_json(artifact/'comparison.json',comparison)
 record={'scope':'Untimed full-data correctness check, not part of performance cohort','side':side,'start_utc':start,'end_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit_code':result.returncode,'matching_files':comparison['matching_files'],'exact_match':comparison['exact_match'],'node_version':'22.23.3','node_binary_sha256':hashlib.sha256((root/'runtime/node').read_bytes()).hexdigest()};m.write_json(artifact/'result.json',record);all_results.append(record);print(json.dumps(record),flush=True)
 if result.returncode or not comparison['exact_match']:raise ValueError('Correctness gate failed; preserve raw outputs')
m.write_json(root/'publish/correctness-summary.json',{'results':all_results,'performance_measurements_started':False})
