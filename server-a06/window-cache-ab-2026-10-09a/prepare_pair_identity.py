#!/usr/bin/env python3
"""Bind the published two source variants to a distinctly named local cohort."""
from pathlib import Path
import argparse,hashlib,importlib.util,json,re,subprocess

def prepare(a):
    if not re.fullmatch('[A-Za-z0-9_-]+',a.cohort) or a.cohort=='window-cache-ab-20261009a':raise ValueError('Use a distinct new cohort ID')
    plan=json.loads((a.experiment/'experiment-plan.json').read_text())
    if hashlib.sha256((a.experiment/'measure_replay.py').read_bytes()).hexdigest()!=plan['harness']['sha256']:raise ValueError('Referenced harness identity mismatch')
    spec=importlib.util.spec_from_file_location('replay_harness',a.experiment/'measure_replay.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    output=Path(a.output.absolute())
    for p in (output,*output.parents):
        if p.is_symlink():raise ValueError('Output path contains symlink')
    if output.exists():raise ValueError('Output already exists')
    deps=m.tree_digest(a.dependencies);node=hashlib.sha256(a.node.resolve().read_bytes()).hexdigest();manifest=hashlib.sha256((a.reference/'replay-manifest.json').read_bytes()).hexdigest();configs=[]
    for side,source in [('control',a.control),('candidate',a.candidate)]:
        recorded=json.loads((a.experiment/(side+'-identities.json')).read_text());actual=m.tree_digest(source,skip=('node_modules','.git'),exclude_files=recorded['source_excluded_files'])
        if actual!=recorded['source']:raise ValueError('Source differs from published '+side)
        if manifest!=recorded['replay_manifest_sha256']:raise ValueError('Reference manifest mismatch')
        for name,r in json.loads((source/'package-lock.json').read_text())['packages'].items():
            if not name:continue
            parts=Path(name).parts
            if not parts or parts[0]!='node_modules' or '..' in parts:raise ValueError('Unsafe package path')
            p=a.dependencies.joinpath(*parts[1:])/'package.json'
            if not p.resolve().is_relative_to(a.dependencies.resolve()):raise ValueError('External dependency path')
            if not p.exists() and r.get('optional'):continue
            if json.loads(p.read_text())['version']!=r['version']:raise ValueError('Dependency version mismatch')
        configs.append((side,{**recorded,'cohort':a.cohort,'dependencies':deps,'node_binary_sha256':node,'runtime_policy':'New local binary/dependency fingerprint; do not pool with published measurements.'}))
    version=subprocess.check_output([str(a.node.resolve()),'--version'],text=True,timeout=10).strip()
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+',version):raise ValueError('Unrecognized Node version output')
    for _,config in configs:config['node_version']=version.removeprefix('v')
    output.mkdir(parents=False,exist_ok=False)
    for side,config in configs:
        with (output/(side+'-identities.json')).open('x') as f:f.write(json.dumps(config,indent=2)+'\n')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('control','candidate','dependencies','node','reference','experiment','output'):p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--cohort',required=True);prepare(p.parse_args())
