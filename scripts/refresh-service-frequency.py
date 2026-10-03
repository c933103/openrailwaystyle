#!/usr/bin/env python3
"""Rebuild the reviewed feed registry from already downloaded official ZIPs.

This makes no network requests. Fetch the URL in each config into CACHE/id.zip,
then pass its actual retrieval date. Review the resulting sources/coverage in a
PR; a build must not silently replace feeds or advance freshness timestamps.
"""
import argparse
import gzip
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('gtfs_frequency',ROOT/'scripts/gtfs-frequency.py')
compiler=importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cache',type=Path,required=True)
    p.add_argument('--date',required=True)
    p.add_argument('--retrieved',required=True)
    p.add_argument('--feed',action='append',help='Registered feed ID; omit to rebuild all')
    args=p.parse_args()
    registry=json.loads((ROOT/'styles/data-src/service-frequency-sources.json').read_text())
    requested=set(args.feed or [f['id'] for f in registry['feeds']])
    if requested-{f['id'] for f in registry['feeds']}:
        p.error('Unregistered feed ID')
    results=[]
    # Validate/compile every requested feed before replacing any outputs.
    for entry in registry['feeds']:
        if entry['id'] not in requested:continue
        config=json.loads((ROOT/'styles/data-src'/entry['config']).read_text())
        if not config['source'].get('terms_url') or not config['source'].get('license') or not config['source'].get('attribution'):
            raise ValueError('Source needs reviewed terms and attribution')
        config['source']['retrieved']=args.retrieved
        result=compiler.compile_feed(args.cache/f"{entry['id']}.zip",config,args.date,geometry=True)
        if not result['segments']:
            raise ValueError(f"{entry['id']}: no usable rail shape profiles; do not publish as coverage")
        results.append((entry,config,result))
        print(entry['id'],len(result['routes']),'routes',len(result['segments']),'path segments',result['source']['geometry_audit'],flush=True)
    for entry,config,result in results:
        output=ROOT/'styles'/entry['output'];output.parent.mkdir(parents=True,exist_ok=True)
        output.write_bytes(gzip.compress((json.dumps(result,ensure_ascii=False,separators=(',',':'))+'\n').encode(),compresslevel=9,mtime=0))
        (ROOT/'styles/data-src'/entry['config']).write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n')
    registry['service_date']=args.date
    (ROOT/'styles/data-src/service-frequency-sources.json').write_text(json.dumps(registry,ensure_ascii=False,indent=2)+'\n')


if __name__=='__main__':main()
