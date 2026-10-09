#!/usr/bin/env python3
"""Record a distinctly named local environment after verifying historical source.

This does not assert equivalence to the published host/runtime/dependency build.
It writes new identities for a new cohort, never edits the supplied ones.
"""
from pathlib import Path
from types import SimpleNamespace
import argparse, hashlib, json, re
import measure_replay as m
from replay_bundle import no_symlinks

def pin(args):
    if not re.fullmatch('[A-Za-z0-9_-]+',args.cohort) or args.cohort=='replay-20261009a':
        raise ValueError('Choose a distinct new cohort ID')
    output=no_symlinks(args.output)
    if output.exists():raise ValueError('Identity output already exists')
    known=json.loads((args.bundle/'historical-identities.json').read_text())
    source=m.tree_digest(args.source,skip=('node_modules','.git'),exclude_files=known['source_excluded_files'])
    if source!=known['source']:raise ValueError('Source is not the pinned historical tree')
    lock=json.loads((args.source/'package-lock.json').read_text());checked=0
    for name,record in lock['packages'].items():
        if not name:continue
        relative=Path(name)
        if relative.is_absolute() or '..' in relative.parts or not relative.parts or relative.parts[0]!='node_modules':
            raise ValueError('Unsafe dependency lock path')
        package=args.dependencies.joinpath(*relative.parts[1:])/'package.json'
        if not package.resolve().is_relative_to(args.dependencies.resolve()):raise ValueError('External dependency path')
        if not package.exists() and record.get('optional'):continue
        if json.loads(package.read_text())['version']!=record['version']:raise ValueError('Dependency version mismatch')
        checked+=1
    config={'schema':1,'cohort':args.cohort,'role':'new-local-replay','source_commit':known['source_commit'],
            'source_excluded_directories':['node_modules','.git'],'source_excluded_files':known['source_excluded_files'],
            'source':source,'dependencies':m.tree_digest(args.dependencies),
            'node_binary_sha256':hashlib.sha256(args.node.resolve().read_bytes()).hexdigest(),
            'replay_manifest_sha256':hashlib.sha256((args.bundle/'replay-manifest.json').read_bytes()).hexdigest(),
            'checked_locked_package_versions':checked,
            'runtime_policy':'New local runtime binary identity; record node --version separately. Do not pool with the published cohort.'}
    with output.open('x') as f:f.write(json.dumps(config,indent=2)+'\n')
    print(json.dumps(config,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ('source','dependencies','node','bundle','output'):p.add_argument('--'+key,type=Path,required=True)
    p.add_argument('--cohort',required=True);pin(p.parse_args())
