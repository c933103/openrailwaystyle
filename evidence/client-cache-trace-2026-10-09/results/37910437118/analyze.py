#!/usr/bin/env python3
"""Derive bounded baseline tables without treating synthetic timing as a gain."""
import argparse,collections,gzip,hashlib,json,math,pathlib,statistics
p=argparse.ArgumentParser();p.add_argument('directory',type=pathlib.Path);p.add_argument('--expected-pairs',type=int,default=3);a=p.parse_args();root=a.directory
read=lambda name:json.loads((root/name).read_text())
ledger=read('server-ledger.json');environment=read('environment.json');controls=read('transport-controls.json')
assert controls['passed'] is True
samples=[];origins=[];validation=[]
def pct(xs,p):
 xs=sorted(xs);return xs[min(len(xs)-1,max(0,math.ceil(len(xs)*p)-1))] if xs else None
def peak(rows,start='startMs',end='finishMs'):
 events=[]
 for row in rows:
  if row.get(end) is not None:events.extend([(row[start],1),(row[end],-1)])
 n=result=0
 for _,d in sorted(events):n+=d;result=max(result,n)
 return result
for pair in range(1,a.expected_pairs+1):
 for cache in ['cold','warm']:
  id=f'p{pair}-{cache}';x=read(id+'.json');assert not x.get('failed'),x.get('failed');assert x['sourceCommit']=='2875a0744912633f35cd6faba25e3260dae09d89'
  assert not x['pageErrors'];assert not x['consoleErrors'];assert len(x['phases'])==4
  requests={}
  for e in x['network']:
   k=e.get('requestId')
   if k is None:continue
   r=requests.setdefault(k,{'id':k,'chunks':[],'cacheEvents':0})
   if e['event']=='requestWillBeSent':r.update({'start':e,'url':e['request']['url']})
   elif e['event']=='responseReceived':r['response']=e
   elif e['event']=='dataReceived':r['chunks'].append(e)
   elif e['event']=='requestServedFromCache':r['cacheEvents']+=1
   elif e['event'] in ['loadingFinished','loadingFailed']:r['finish']=e
  byphase={}
  for phase in x['phases']:
   name=phase['name'];before=phase['start'];after=phase['end'];v=phase['value']
   assert v['loaded'] and v['tilesLoaded']
   if name=='startup':assert v['featureCount']>0;left=0;right=v['usableAt']
   else:left=v['start'];right=v['end']
   gaps=[e['gap'] for e in x['performance']['trace']['raf'] if left<=e['at']<=right]
   tasks=[e for e in x['performance']['trace']['longTasks'] if left<=e['start']<right]
   hp=[e['JSHeapUsedSize'] for e in x['heap'] if e['phase']==name]
   proc0={e['id']:e for e in before['processes']};proc1={e['id']:e for e in after['processes']};common=proc0.keys()&proc1.keys()
   row={'sample':id,'cache':cache,'phase':name,'elapsedMs':right-left,'mainThreadTaskCpuS':after['metrics']['TaskDuration']-before['metrics']['TaskDuration'],'mainThreadScriptCpuS':after['metrics']['ScriptDuration']-before['metrics']['ScriptDuration'],'observedStableProcessCpuS':sum(proc1[k]['cpuTime']-proc0[k]['cpuTime'] for k in common),'stableProcessCpuByType':{kind:sum(proc1[k]['cpuTime']-proc0[k]['cpuTime'] for k in common if proc1[k]['type']==kind) for kind in sorted({p['type'] for p in proc1.values()})},'newProcessIds':list(proc1.keys()-proc0.keys()),'lostProcessIds':list(proc0.keys()-proc1.keys()),'rafCount':len(gaps),'rafGapP50Ms':pct(gaps,.5),'rafGapP95Ms':pct(gaps,.95),'rafGapMaxMs':max(gaps,default=None),'longTaskCount':len(tasks),'longTaskTotalMs':sum(e['duration'] for e in tasks),'sampledPeakPageHeapBytes':max(hp,default=None),'heapSampleCount':len(hp),'endPageHeapBytes':after['metrics']['JSHeapUsedSize']}
   rows=[e for e in ledger if e['sample']==id and e['phase']==name];row['serverRequests']=len(rows);row['serverPayloadBytes']=sum(e.get('bodyBytes',0) for e in rows);row['serverPeakConcurrency']=peak(rows)
   byphase[name]=row;samples.append(row)
   nr=[r for r in requests.values() if r.get('start',{}).get('phase')==name]
   for origin in sorted({r['origin'] for r in rows}|{('first-party' if r['url'].startswith('http://atlas.fixture/') else r['url'].split('/')[0]+'//'+r['url'].split('/')[2]) for r in nr if r.get('url','').startswith('http')}):
    sr=[r for r in rows if r['origin']==origin];net=[r for r in nr if r.get('url','').startswith(('http://atlas.fixture' if origin=='first-party' else origin)+'/')]
    keys=collections.Counter((r['path'],r['range']) for r in sr)
    origins.append({'sample':id,'phase':name,'origin':origin,'wireRequests':len(sr),'wirePayloadBytes':sum(r.get('bodyBytes',0) for r in sr),'statusCounts':dict(collections.Counter(str(r['status']) for r in sr)),'wirePeakConcurrency':peak(sr),'repeatedWireKeyExcess':sum(n-1 for n in keys.values()),'conditionalRequests':sum(bool(r['ifNoneMatch']) for r in sr),'prematureCloses':sum(bool(r.get('prematureClose')) for r in sr),'cdpRequestStarts':len(net),'cdpCacheSignals':sum(bool(r['cacheEvents'] or r.get('response',{}).get('response',{}).get('fromDiskCache')) for r in net),'cdpEncodedResponseBytesKnown':sum(r['finish']['encodedDataLength'] for r in net if r.get('finish',{}).get('event')=='loadingFinished'),'cdpDecodedChunkBytes':sum(e['dataLength'] for r in net for e in r['chunks']),'cdpFailures':sum(r.get('finish',{}).get('event')=='loadingFailed' for r in net),'cdpMissingTerminalEvents':sum('finish' not in r for r in net),'finishedInLaterCameraEpoch':sum(r.get('finish',{}).get('epoch',0)>r.get('start',{}).get('epoch',0) for r in net)})
  validation.append({'sample':id,'pageErrors':0,'consoleErrors':0,'retainedPageHeapAfterGC':x['retainedAfterGC']['JSHeapUsedSize'],'cacheState':x['cacheState']})
result={'scope':'Synthetic baseline only, no optimization comparison or provider-policy inference. Main isolate only; sampled heap maxima and rAF gaps are not GPU memory or compositor FPS.','sourceCommit':'2875a0744912633f35cd6faba25e3260dae09d89','executionLimits':{'containerCpuQuota':2,'containerMemoryBytes':4294967296,'network':'Docker --network none, working loopback','softwareRenderer':'SwiftShader','noDevToolsCpuThrottling':True,'hostReportedCpuCountIsNotQuota':True},'environment':environment,'phases':samples,'perOrigin':origins,'sampleValidation':validation}
(root/'analysis.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'samples':len(validation),'phaseRows':len(samples),'rows':origins[:3]},indent=2))
