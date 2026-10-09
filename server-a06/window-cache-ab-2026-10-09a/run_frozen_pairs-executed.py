from pathlib import Path
from types import SimpleNamespace
import sys,json,hashlib
root=Path(__file__).parent;pub=root/'publish';sys.path.insert(0,str(pub));import measure_replay as m
base=Path('/workspace/shared/atlas-a06-replay-cohort-20261009a')
plan_bytes=(pub/'experiment-plan.json').read_bytes();plan=json.loads(plan_bytes)
expected_plan='b0ac1f9156bb999bdaf583146f53f73ae7c453adb3823899e101f738e6241b0d'
if hashlib.sha256(plan_bytes).hexdigest()!=expected_plan:raise ValueError('Frozen plan identity mismatch')
if hashlib.sha256((pub/'measure_replay.py').read_bytes()).hexdigest()!=plan['harness']['sha256']:raise ValueError('Harness changed')
for pair in plan['pairs']:
 for side in pair['order']:
  args=SimpleNamespace(source=root/('source-'+side),dependencies=base/'dependency-pool/node_modules',reconstructed=base/'work/reconstructed',bundle=base/'publish',work=root/'work',artifacts=pub/'runs',node=root/'runtime/node',identity_manifest=pub/(side+'-identities.json'),run_id=f"pair-{pair['pair']:02d}-{side}",profile=False)
  m.run(args)
