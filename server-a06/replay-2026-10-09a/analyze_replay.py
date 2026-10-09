#!/usr/bin/env python3
"""Recompute new-cohort summaries without modifying supplied raw evidence."""
from pathlib import Path
import argparse, collections, csv, json, statistics

def analyze(runs, destination):
    destination.mkdir(parents=True, exist_ok=False)
    all_runs=[json.loads(p.read_text()) for p in sorted(runs.glob('*/metrics.json'))]
    selected=[r for r in all_runs if r['run_id'] in ('historical-02','historical-03','historical-04')]
    if len(selected)!=3 or not all(r['exit_code']==0 and r['exact_expected_match'] and not r['instrumented_cpu_profile'] for r in selected):
        raise ValueError('Expected three passing uninstrumented historical repetitions')
    summary={'cohort':'replay-20261009a','baseline_run_ids':[r['run_id'] for r in selected],'other_runs_excluded_from_baseline':[r['run_id'] for r in all_runs if r not in selected],'metrics':{}}
    for key in ('wall_seconds','user_cpu_seconds','system_cpu_seconds','total_cpu_seconds','peak_rss_kib'):
        values=[r[key] for r in selected];summary['metrics'][key]={'values':values,'median':statistics.median(values),'min':min(values),'max':max(values)}
    summary['all_output_identities_exact']=all(r['exact_expected_match'] for r in all_runs)
    summary['coverage']=selected[0]['coverage']
    (destination/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    keys=['run_id','instrumented_cpu_profile','wall_seconds','user_cpu_seconds','system_cpu_seconds','total_cpu_seconds','peak_rss_kib','input_bytes','output_bytes','output_files','exit_code','exact_expected_match']
    with (destination/'metrics.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=keys);w.writeheader();w.writerows({k:r[k] for k in keys} for r in all_runs)
    p=runs/'historical-profile/assembly.cpuprofile'
    if p.exists():
        profile=json.loads(p.read_text());nodes={n['id']:n for n in profile['nodes']};groups=collections.Counter();functions=collections.Counter()
        samples=profile.get('samples',[]);deltas=profile.get('timeDeltas',[])
        if len(samples)!=len(deltas):raise ValueError('Profile samples/deltas mismatch')
        for sample,delta in zip(samples,deltas):
            frame=nodes[sample]['callFrame'];name=frame.get('functionName','');url=frame.get('url','')
            group='reader' if url.endswith('/read-frequency-feed.mjs') else 'timetable-summary' if url.endswith('/gtfs-service.mjs') else 'gc' if name=='(garbage collector)' else 'idle' if name=='(idle)' else 'other'
            groups[group]+=delta;functions[(name,url,frame.get('lineNumber'))]+=delta
        total=sum(groups.values());result={'method':'Exclusive main-thread CPU-profile sample timeDelta weights; not total process CPU and not worker-thread gzip attribution','sample_count':len(samples),'sampled_microseconds':total,'groups':{k:{'microseconds':v,'percent':v*100/total} for k,v in groups.items()},'top_functions':[{'function':k[0],'url':k[1],'line_number_zero_based':k[2],'microseconds':v,'percent':v*100/total} for k,v in functions.most_common(30)]}
        (destination/'cpu-profile-summary.json').write_text(json.dumps(result,indent=2)+'\n')
    timings=[]
    for r in selected:
        previous=0
        for line in (runs/r['run_id']/'progress.jsonl').read_text().splitlines():
            row=json.loads(line)
            if row['line'].endswith(' rail services'):
                timings.append({'run_id':r['run_id'],'feed_id':row['line'].split()[0],'completion_interval_seconds':row['elapsed_seconds']-previous});previous=row['elapsed_seconds']
    (destination/'feed-completion-intervals.json').write_text(json.dumps({'method':'Intervals between captured stdout completion lines; include feed read/parse/summary and capture scheduling, not isolated phase timings','largest_intervals':sorted(timings,key=lambda x:x['completion_interval_seconds'],reverse=True)[:30]},indent=2)+'\n')
    print(json.dumps(summary,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--runs-dir',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True);a=p.parse_args();analyze(a.runs_dir,a.output_dir)
