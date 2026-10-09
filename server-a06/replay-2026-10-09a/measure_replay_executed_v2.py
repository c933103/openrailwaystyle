#!/usr/bin/env python3
"""New bounded offline cohort harness; never substitutes for lost originals."""
from pathlib import Path
import argparse, datetime, hashlib, json, os, resource, shutil, signal, subprocess, threading, time

def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def write_json(path, value): path.write_text(json.dumps(value, indent=2)+'\n')
def identity(root):
    records = []
    for p in sorted(root.rglob('*')):
        if p.is_symlink(): raise ValueError('Output symlink')
        if p.is_file():
            b=p.read_bytes(); records.append({'path':p.relative_to(root).as_posix(), 'bytes':len(b), 'allocated_bytes':p.stat().st_blocks*512, 'sha256':hashlib.sha256(b).hexdigest()})
    return {'file_count':len(records),'bytes':sum(x['bytes'] for x in records),'allocated_bytes':sum(x['allocated_bytes'] for x in records),'files':records}
def conditions():
    info={'utc':utc(),'load_average':list(os.getloadavg())}
    try:
        wanted=('MemTotal:','MemAvailable:','SwapTotal:','SwapFree:')
        info['memory_kib']={a[0].rstrip(':'):int(a[1]) for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith(wanted) for a in [line.split()]}
    except (OSError,ValueError): info['memory_kib']=None
    return info
def child_status(pid):
    try:
        text=Path(f'/proc/{pid}/status').read_text(); wanted={'VmRSS','VmHWM','VmSize','Threads'}
        return {a[0].rstrip(':'):int(a[1]) for line in text.splitlines() for a in [line.split()] if a and a[0].rstrip(':') in wanted}
    except (OSError,ValueError): return None
def child_bounds():
    resource.setrlimit(resource.RLIMIT_CPU,(300,305))
    resource.setrlimit(resource.RLIMIT_FSIZE,(256*1024*1024,256*1024*1024))
    resource.setrlimit(resource.RLIMIT_CORE,(0,0))

def tree_digest(root, skip=()):
    root=root.resolve(); digest=hashlib.sha256(); count=0; size=0
    for p in sorted(root.rglob('*')):
        relative=p.relative_to(root)
        if any(x in skip for x in relative.parts): continue
        if p.is_symlink():
            if not p.resolve().is_relative_to(root): raise ValueError('External dependency symlink')
            payload=b'link\0'+os.readlink(p).encode()
        elif p.is_file(): payload=p.read_bytes();size+=len(payload)
        else: continue
        digest.update(relative.as_posix().encode()+b'\0'+hashlib.sha256(payload).digest());count+=1
    return {'sha256':digest.hexdigest(),'entries':count,'file_bytes':size}

def verify_provenance(args, source=None):
    config_bytes=args.identity_manifest.read_bytes();config=json.loads(config_bytes)
    actual={'source':tree_digest(source or args.source,skip=('node_modules','.git')),
            'dependencies':tree_digest(args.dependencies),
            'node_binary_sha256':hashlib.sha256(args.node.resolve().read_bytes()).hexdigest()}
    for key in ('source','dependencies','node_binary_sha256'):
        if actual[key]!=config[key]: raise ValueError('Pinned execution identity mismatch: '+key)
    return {'configuration_sha256':hashlib.sha256(config_bytes).hexdigest(),'cohort':config['cohort'],
            'role':config['role'],'source_commit':config['source_commit'],
            'identities':actual,'verified_utc':utc()}

def compare_outputs(after, expected):
    amap={x['path']:x for x in after['files']};emap={x['path']:x for x in expected}
    matches={name for name in emap if name in amap and amap[name]['bytes']==emap[name]['bytes'] and amap[name]['sha256']==emap[name]['sha256']}
    differences=[{'path':name,'expected':emap.get(name),'actual':amap.get(name)} for name in sorted(set(amap)|set(emap)) if name not in matches]
    return {'exact_match':not differences,'matching_files':len(matches),'differences':differences}

def run(args):
    if not args.run_id or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in args.run_id):
        raise ValueError('Invalid run ID')
    provenance=verify_provenance(args)
    artifact=args.artifacts/args.run_id; working=args.work/args.run_id
    if artifact.exists() or working.exists(): raise ValueError('Run already exists')
    artifact.mkdir(parents=True); working.mkdir(parents=True)
    source=working/'source'; output=working/'output'
    shutil.copytree(args.source,source,ignore=shutil.ignore_patterns('node_modules','.git'))
    (source/'node_modules').symlink_to(args.dependencies.resolve(),target_is_directory=True)
    shutil.copytree(args.reconstructed/'input',output)
    provenance=verify_provenance(args,source)
    write_json(artifact/'provenance-before.json',provenance)
    before=identity(output); write_json(artifact/'input-identity.json',before)
    expected=json.loads((args.bundle/'replay-manifest.json').read_text())['expected']
    command=[str(args.node.resolve()),'--max-old-space-size=1536']
    if args.profile: command += ['--cpu-prof',f'--cpu-prof-dir={artifact.resolve()}','--cpu-prof-name=assembly.cpuprofile']
    command += [str((source/'scripts/assemble-global-frequency.mjs').resolve()),str(output.resolve())]
    start_conditions=conditions(); start=time.monotonic(); started=utc()
    errors=[]
    with (artifact/'stdout.log').open('wb') as stdout,(artifact/'stderr.log').open('wb') as stderr,(artifact/'progress.jsonl').open('w') as progress,(artifact/'samples.jsonl').open('w') as samples:
        process=subprocess.Popen(command,cwd=source,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=stderr,start_new_session=True,preexec_fn=child_bounds,env={**os.environ,'TZ':'UTC'})
        def capture():
            try:
                for line in process.stdout:
                    stdout.write(line); stdout.flush()
                    progress.write(json.dumps({'elapsed_seconds':time.monotonic()-start,'line':line.decode('utf-8',errors='replace').rstrip('\n')})+'\n');progress.flush()
            except Exception as exc: errors.append(type(exc).__name__)
        thread=threading.Thread(target=capture,daemon=True);thread.start();reason=None;kill_at=None
        while True:
            pid,status,usage=os.wait4(process.pid,os.WNOHANG)
            if pid: break
            elapsed=time.monotonic()-start; child=child_status(process.pid)
            samples.write(json.dumps({'elapsed_seconds':elapsed,'child_status':child,'host':conditions()})+'\n');samples.flush()
            if reason is None and (elapsed>300 or (child and child.get('VmRSS',0)>2*1024*1024)):
                reason='wall_limit' if elapsed>300 else 'rss_limit';kill_at=time.monotonic();os.killpg(process.pid,signal.SIGTERM)
            if kill_at is not None and time.monotonic()-kill_at>5:
                try: os.killpg(process.pid,signal.SIGKILL)
                except ProcessLookupError: pass
            time.sleep(0.25)
        end=time.monotonic();process.returncode=os.waitstatus_to_exitcode(status);thread.join(timeout=10)
        if thread.is_alive(): raise RuntimeError('Output capture did not finish')
    after=identity(output);write_json(artifact/'output-identity.json',after)
    comparison=compare_outputs(after,expected);differences=comparison['differences']
    coverage=None
    if (output/'manifest.json').is_file():
        manifest=json.loads((output/'manifest.json').read_text());coverage={'catalogue_entries':manifest['catalogue_entries'],'summary_feeds':len(manifest['feeds']),'mapped_feeds':sum(f['mappedRoutes']>0 for f in manifest['feeds']),'countries':len(manifest['countries_scanned']),'tiles':manifest['tiles'],'counts':manifest['counts'],'available_segments':sum(f['availableSegments'] for f in manifest['feeds']),'routes_with_profiles':sum(f['routesWithProfiles'] for f in manifest['feeds'])}
    metrics={'cohort':'replay-20261009a','run_id':args.run_id,'classification':'new replacement-host cohort, not an original recovered measurement','instrumented_cpu_profile':args.profile,'start_utc':started,'end_utc':utc(),'command':command,'wall_seconds':end-start,'user_cpu_seconds':usage.ru_utime,'system_cpu_seconds':usage.ru_stime,'total_cpu_seconds':usage.ru_utime+usage.ru_stime,'peak_rss_kib':usage.ru_maxrss,'exit_code':process.returncode,'termination_reason':reason,'capture_errors':errors,'sample_interval_seconds':0.25,'wait4_minor_faults':usage.ru_minflt,'wait4_major_faults':usage.ru_majflt,'wait4_voluntary_switches':usage.ru_nvcsw,'wait4_involuntary_switches':usage.ru_nivcsw,'io_bytes':'unavailable; previously denied optional per-process I/O source was not retried','input_bytes':before['bytes'],'output_bytes':after['bytes'],'output_allocated_bytes':after['allocated_bytes'],'output_files':after['file_count'],'exact_expected_match':not differences,'coverage':coverage,'start_conditions':start_conditions,'end_conditions':conditions(),'cache_state':'fresh source/input copies and fresh Node process; filesystem cache uncontrolled and warmed by copying/verification, not a cold-cache run','time_policy':'Unmodified Date.now(); actual UTC captured; exact raw output hashes compared without field removal','bounds':{'node_heap_mib':1536,'rss_guard_mib':2048,'wall_seconds':300,'cpu_soft_seconds':300,'file_limit_bytes':256*1024*1024}}
    metrics['cohort']=provenance['cohort'];metrics['role']=provenance['role'];metrics['source_commit']=provenance['source_commit'];metrics['provenance']=provenance
    write_json(artifact/'provenance-after.json',verify_provenance(args,source))
    write_json(artifact/'comparison.json',comparison)
    write_json(artifact/'metrics.json',metrics)
    print(json.dumps({k:metrics[k] for k in ('run_id','wall_seconds','total_cpu_seconds','peak_rss_kib','exit_code','exact_expected_match')}),flush=True)
    if process.returncode or differences or errors: raise RuntimeError('Run failed correctness or execution gate; raw outputs retained')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ('source','dependencies','reconstructed','bundle','work','artifacts','node'): p.add_argument('--'+key,type=Path,required=True)
    p.add_argument('--identity-manifest',type=Path,required=True)
    p.add_argument('--run-id',required=True);p.add_argument('--profile',action='store_true');run(p.parse_args())
