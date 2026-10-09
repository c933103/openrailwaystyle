from pathlib import Path
import sys,json,subprocess,shutil,hashlib,datetime
base=Path('/workspace/shared/atlas-a06-replay-cohort-20261009a');source=Path('/workspace/shared/atlas-lazy-window-combined-20261009');evidence=Path(__file__).parent;sys.path.insert(0,str(Path('/workspace/shared/atlas-a06-window-cache-ab-20261009a/publish')));import measure_replay as m
output=evidence/'working-output';shutil.copytree(base/'work/reconstructed/input',output);manifest=json.loads((base/'publish/replay-manifest.json').read_text());before=m.identity(output)
if not m.compare_outputs(before,manifest['inputs'])['exact_match']:raise ValueError('Frozen input mismatch')
node=Path('/workspace/shared/atlas-a06-window-cache-ab-20261009a/runtime/node');start=m.utc()
with (evidence/'assembly.stdout.log').open('wb') as out,(evidence/'assembly.stderr.log').open('wb') as err:
 result=subprocess.run([str(node),'--max-old-space-size=1536',str(source/'scripts/assemble-global-frequency.mjs'),str(output)],cwd=source,stdin=subprocess.DEVNULL,stdout=out,stderr=err,timeout=300,preexec_fn=m.child_bounds)
identity=m.identity(output);comparison=m.compare_outputs(identity,manifest['expected']);m.write_json(evidence/'output-identity.json',identity);m.write_json(evidence/'output-comparison.json',comparison)
r={'scope':'New-base correctness only. No new performance sample or relabelled benchmark.','base_commit':'6c5fbb21ed86b0437f1bf2d6caca8819781e67f2','pr_head':'4d34da8a3d06e83b7c979bd882c4725d3cebbd7a','source_sha256':hashlib.sha256((source/'scripts/gtfs-service.mjs').read_bytes()).hexdigest(),'tests_sha256':hashlib.sha256((source/'tests/gtfs-service.test.mjs').read_bytes()).hexdigest(),'node_version':'22.23.3','node_sha256':hashlib.sha256(node.read_bytes()).hexdigest(),'start_utc':start,'end_utc':m.utc(),'exit_code':result.returncode,'matching_files':comparison['matching_files'],'exact_match':comparison['exact_match'],'input_files':before['file_count'],'output_files':identity['file_count']};m.write_json(evidence/'correctness-receipt.json',r);print(json.dumps(r))
if result.returncode or not comparison['exact_match']:raise ValueError('Correctness failed; raw output retained')
