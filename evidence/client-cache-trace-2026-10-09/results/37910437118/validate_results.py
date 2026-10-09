#!/usr/bin/env python3
import copy, json, pathlib, sys
root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
a = json.loads((root / 'analysis.json').read_text())
controls = json.loads((root / 'transport-controls-derived.json').read_text())
checks = []

def validate(a):
    if not a['sourceCommit'] == '2875a0744912633f35cd6faba25e3260dae09d89':
        raise AssertionError()
    if not len(a['sampleValidation']) == 6:
        raise AssertionError()
    ids = {f'p{i}-{cache}' for i in range(1, 4) for cache in ['cold', 'warm']}
    if not {x['sample'] for x in a['sampleValidation']} == ids:
        raise AssertionError()
    if not len(a['phases']) == 24:
        raise AssertionError()
    for v in a['sampleValidation']:
        if not v['pageErrors'] == v['consoleErrors'] == 0:
            raise AssertionError()
        if not v['retainedPageHeapAfterGC'] > 0:
            raise AssertionError()
    for v in a['phases']:
        if not v['sample'] in ids:
            raise AssertionError()
        if not v['phase'] in ['startup', 'first-pan', 'reset', 'cached-pan']:
            raise AssertionError()
        if not (v['elapsedMs'] > 0 and v['mainThreadTaskCpuS'] > 0):
            raise AssertionError()
        if not (v['heapSampleCount'] > 0 and v['sampledPeakPageHeapBytes'] > 0):
            raise AssertionError()
        if not (not v['newProcessIds'] and (not v['lostProcessIds'])):
            raise AssertionError()
        sources = [s for s in a['perOrigin'] if s['sample'] == v['sample'] and s['phase'] == v['phase']]
        if not sum((s['wireRequests'] for s in sources)) == v['serverRequests']:
            raise AssertionError()
        if not sum((s['wirePayloadBytes'] for s in sources)) == v['serverPayloadBytes']:
            raise AssertionError()
    for s in a['perOrigin']:
        if not s['repeatedWireKeyExcess'] == s['cdpFailures'] == s['prematureCloses'] == s['finishedInLaterCameraEpoch'] == 0:
            raise AssertionError()
    for i in range(1, 4):
        for cache in ['cold', 'warm']:
            st = next((v for v in a['phases'] if v['sample'] == f'p{i}-{cache}' and v['phase'] == 'startup'))
            if not (st['serverRequests'], st['serverPayloadBytes']) == ((129, 4150029) if cache == 'cold' else (1, 44519)):
                raise AssertionError()
            orm = next((v for v in a['perOrigin'] if v['sample'] == f'p{i}-{cache}' and v['phase'] == 'startup' and (v['origin'] == 'https://openrailwaymap.app')))
            if not (orm['wireRequests'], orm['cdpCacheSignals']) == ((88, 0) if cache == 'cold' else (0, 88)):
                raise AssertionError()
validate(a)
checks.append({'check': 'source/sample/phase/error/memory/CPU/PID/byte/origin/cache invariants', 'passed': True})
if not controls['passed'] is True:
    raise AssertionError()
cached = [v for v in controls['requests'] if v['path'] == '/__controls/cached']
stale = [v for v in controls['requests'] if v['path'] == '/__controls/revalidate']
if not (len(cached) == 1 and cached[0]['status'] == 200):
    raise AssertionError()
if not ([v['status'] for v in stale] == [200, 304] and stale[1]['ifNoneMatch']):
    raise AssertionError()
checks.append({'check': 'actual browser cacheable-repeat and stale-ETag controls', 'passed': True})
mutations = [('missing sample', lambda x: x['sampleValidation'].pop()), ('wrong source', lambda x: x.update(sourceCommit='0' * 40)), ('wrong byte sum', lambda x: x['phases'][0].update(serverPayloadBytes=1)), ('hidden page error', lambda x: x['sampleValidation'][0].update(pageErrors=1)), ('missing HTTP cache signal', lambda x: next((v for v in x['perOrigin'] if v['sample'] == 'p1-warm' and v['origin'] == 'https://openrailwaymap.app' and (v['phase'] == 'startup'))).update(cdpCacheSignals=0))]
for name, mutate in mutations:
    bad = copy.deepcopy(a)
    mutate(bad)
    try:
        validate(bad)
    except AssertionError:
        checks.append({'check': 'reject ' + name, 'passed': True})
    else:
        raise AssertionError('Mutation accepted: ' + name)
print(json.dumps({'passed': True, 'checks': checks, 'count': len(checks), 'scope': 'Derived-evidence consistency and five adversarial controls; not additional browser or application tests.'}, indent=2))
