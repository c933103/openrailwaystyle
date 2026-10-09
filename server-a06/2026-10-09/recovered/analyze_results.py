#!/usr/bin/env python3
import argparse, collections, csv, hashlib, json, pathlib, statistics

ROOT=pathlib.Path(__file__).resolve().parent
RUNS_DIR=ROOT/'raw' if (ROOT/'raw').is_dir() else ROOT/'runs'
OUTPUT_DIR=ROOT/'analysis-output'
def read(p): return json.loads((ROOT/p).read_text())
def save(p,data):
    target=OUTPUT_DIR/p
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(data,indent=2)+'\n')

def analyze_profile(path):
    p=json.loads(path.read_text());nodes={x['id']:x for x in p['nodes']};parents={c:n['id'] for n in p['nodes'] for c in n.get('children',[])}
    exclusive=collections.Counter();inclusive=collections.Counter();total=0
    for ident,delta in zip(p.get('samples',[]),p.get('timeDeltas',[])):
        total+=delta;exclusive[ident]+=delta
        node=ident
        while node in nodes:
            inclusive[node]+=delta
            if node not in parents:break
            node=parents[node]
    def row(n,us):
        f=nodes[n]['callFrame'];return {'function':f['functionName'] or '(anonymous)','url':f.get('url',''),'line_1based':f.get('lineNumber',-1)+1,'sampled_seconds':us/1e6,'percent_of_sampled_time':us/total*100}
    cats=collections.Counter()
    for n,us in exclusive.items():
        name=nodes[n]['callFrame']['functionName'];node=n;category=None
        if name=='(idle)':category='idle'
        elif name=='(garbage collector)':category='garbage_collector'
        else:
            ancestry=[]
            while node in nodes:
                ancestry.append(nodes[node]['callFrame'])
                if node not in parents:break
                node=parents[node]
            if any(x['functionName']=='timetableFeatures' for x in ancestry):category='timetableFeatures_inclusive'
            elif any('/scripts/read-frequency-feed.mjs' in x.get('url','') for x in ancestry):category='read_frequency_feed_inclusive'
            else:category='other'
        cats[category]+=us
    return {'file':str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'sample_count':len(p.get('samples',[])),'sampled_seconds':total/1e6,'interpretation':'Main-thread V8 sampled elapsed-time weights, not exact OS CPU time. Categories are exclusive by ancestry; native/background zlib workers are not comprehensively represented. Instrumented run is excluded from the uninstrumented baseline.','categories':[{'category':k,'sampled_seconds':v/1e6,'percent_of_sampled_time':v/total*100} for k,v in cats.most_common()],'top_exclusive':[row(n,us) for n,us in exclusive.most_common(25)],'named_inclusive':[row(n,inclusive[n]) for n in nodes if nodes[n]['callFrame']['functionName'] in ['timetableFeatures','parseFrequencyFeed','readFrequencyFeed','assemble']]}

def main():
    global RUNS_DIR, OUTPUT_DIR
    parser=argparse.ArgumentParser(description='Recompute preserved baseline observations without moving raw files.')
    parser.add_argument('--runs-dir',type=pathlib.Path,default=RUNS_DIR)
    parser.add_argument('--output-dir',type=pathlib.Path,default=OUTPUT_DIR)
    args=parser.parse_args()
    RUNS_DIR=args.runs_dir.resolve(); OUTPUT_DIR=args.output_dir.resolve()
    OUTPUT_DIR.mkdir(parents=True,exist_ok=True)
    runs=[json.loads((RUNS_DIR/f'run-{i:02d}/metrics.json').read_text()) for i in range(1,5)]
    for x in runs: x.setdefault('instrumented_cpu_profile',False)
    baseline=runs[:3];profile=analyze_profile(RUNS_DIR/'run-04/assembly.cpuprofile');save('evidence/cpu-profile-summary.json',profile)
    summary={'repository':'c933103/openrailwaystyle','source_commit':'6f43c9f9ca998ea5b3081655b6a43bb29ae51713','frozen_workflow_run':37732419672,'runtime':'Node.js 24.19.0','historical_workflow_runtime':'Node.js 22 (major only specified by workflow)','baseline_runs':baseline,'instrumented_run':runs[3],'aggregate':{},'all_4_outputs_byte_identical_to_reference':all(x['comparison']['all_files_byte_identical'] for x in runs)}
    for k in ['wall_seconds','user_cpu_seconds','system_cpu_seconds','total_cpu_seconds','peak_rss_kib','cpu_to_wall_ratio']:
        vals=[x[k] for x in baseline];summary['aggregate'][k]={'min':min(vals),'median':statistics.median(vals),'max':max(vals),'mean':statistics.mean(vals)}
    for i in range(1,5):
        samples=[json.loads(x) for x in (RUNS_DIR/f'run-{i:02d}/samples.jsonl').read_text().splitlines()]
        conditions={'sample_count':len(samples),'host_MemAvailable_kib_min':min(x['host_MemAvailable_kib'] for x in samples),'sampled_rss_kib_max':max(x.get('VmRSS',0) for x in samples),'loadavg_1m_min':min(float(x['loadavg'][0]) for x in samples),'loadavg_1m_max':max(float(x['loadavg'][0]) for x in samples)}
        runs[i-1]['observed_conditions']=conditions
    save('metrics.json',summary)
    with (OUTPUT_DIR/'metrics.csv').open('w') as f:
        fields=['run','instrumented_cpu_profile','wall_seconds','user_cpu_seconds','system_cpu_seconds','total_cpu_seconds','peak_rss_kib','peak_rss_bytes','input_bytes','output_bytes','output_file_count','exit_code']
        w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(runs)
    sizes={x['id']:x for x in read('evidence/feed-sizes.json')['feeds']};intervals={}
    for i in range(1,4):
        prev=0
        for e in [json.loads(x) for x in (RUNS_DIR/f'run-{i:02d}/progress.jsonl').read_text().splitlines()]:
            if not e['line'].endswith('rail services'):continue
            fid=e['line'].rsplit(' ',3)[0];intervals.setdefault(fid,[]).append(e['elapsed_seconds']-prev);prev=e['elapsed_seconds']
    feed_timing=sorted([{'id':fid,**sizes[fid],'intervals_seconds':vals,'median_interval_seconds':statistics.median(vals)} for fid,vals in intervals.items()],key=lambda x:x['median_interval_seconds'],reverse=True)
    save('evidence/feed-timing.json',{'interpretation':'Intervals between feed-completion stdout lines. Include read/decompression/parsing/summary and scheduling; first interval also includes startup and inventory work. Not pure per-function CPU.','feeds':feed_timing})
    print(json.dumps({'aggregate':summary['aggregate'],'identity':summary['all_4_outputs_byte_identical_to_reference'],'profile_categories':profile['categories'],'top_functions':profile['top_exclusive'][:12],'top_feed_intervals':feed_timing[:5]},indent=2))

if __name__=='__main__':main()
