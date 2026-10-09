#!/usr/bin/env python3
"""Descriptive paired analysis; no discarded pairs or statistical speedup claim."""
from pathlib import Path
import argparse,csv,json,statistics

def analyze(runs,output):
    output.mkdir(parents=True,exist_ok=False)
    pairs=[];all_runs=[]
    for i in range(1,5):
        a=json.loads((runs/f'pair-{i:02d}-control/metrics.json').read_text());b=json.loads((runs/f'pair-{i:02d}-candidate/metrics.json').read_text());all_runs.extend([a,b])
        for r in (a,b):
            if r['exit_code'] or r['termination_reason'] is not None or r['capture_errors'] or not r['exact_expected_match'] or r['instrumented_cpu_profile']:
                raise ValueError('Failed execution/correctness/instrumentation gate; do not analyze incomplete pairs')
        row={'pair':i,'order':'control/candidate' if i%2 else 'candidate/control','control_run':a['run_id'],'candidate_run':b['run_id'],'metrics':{}}
        for key in ('wall_seconds','total_cpu_seconds','peak_rss_kib'):
            delta=b[key]-a[key];row['metrics'][key]={'control':a[key],'candidate':b[key],'candidate_minus_control':delta,'percent_change':delta*100/a[key]}
        row['start_load_average']={'control':a['start_conditions']['load_average'],'candidate':b['start_conditions']['load_average']}
        row['start_memory_available_kib']={'control':a['start_conditions']['memory_kib']['MemAvailable'],'candidate':b['start_conditions']['memory_kib']['MemAvailable']}
        pairs.append(row)
    if len({r['cohort'] for r in all_runs})!=1:raise ValueError('Mixed cohorts')
    summary={'cohort':all_runs[0]['cohort'],'pairs':4,'executions':8,'all_output_identity_gates_passed':True,'expected_output_files_per_run':117,'original_recovery_status':'unchanged:57/83; none of these runs count as recovered originals','metrics':{}}
    for key in ('wall_seconds','total_cpu_seconds','peak_rss_kib'):
        controls=[p['metrics'][key]['control'] for p in pairs];candidates=[p['metrics'][key]['candidate'] for p in pairs];changes=[p['metrics'][key]['percent_change'] for p in pairs];deltas=[p['metrics'][key]['candidate_minus_control'] for p in pairs]
        summary['metrics'][key]={'control':{'median':statistics.median(controls),'min':min(controls),'max':max(controls),'values':controls},'candidate':{'median':statistics.median(candidates),'min':min(candidates),'max':max(candidates),'values':candidates},'paired_percent_change':{'values':changes,'median':statistics.median(changes),'min':min(changes),'max':max(changes)},'paired_absolute_change_median':statistics.median(deltas),'candidate_lower_pairs':sum(d<0 for d in deltas),'candidate_equal_pairs':sum(d==0 for d in deltas),'candidate_higher_pairs':sum(d>0 for d in deltas)}
    summary['interpretation']='Negative candidate-minus-control values indicate lower time/RSS. Four non-independent shared-host pairs are descriptive, not a population confidence interval. No result is pooled with the old host or Node24 cohorts. Wall completion uses blocking wait4 and is independent of the250ms monitor interval; scheduler wakeup latency remains possible.'
    (output/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');(output/'pairs.json').write_text(json.dumps(pairs,indent=2)+'\n')
    keys=['run_id','role','start_utc','wall_seconds','user_cpu_seconds','system_cpu_seconds','total_cpu_seconds','peak_rss_kib','exact_expected_match']
    with (output/'metrics.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=keys);w.writeheader();w.writerows({k:r[k] for k in keys} for r in sorted(all_runs,key=lambda r:r['start_utc']))
    print(json.dumps(summary,indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--runs-dir',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True);a=p.parse_args();analyze(a.runs_dir,a.output_dir)
