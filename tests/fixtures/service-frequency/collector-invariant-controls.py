# Synthetic offline controls from the independent PR168 comparison.
import json, sys, zipfile
sys.path.insert(0, 'tests')
import gtfs_frequency_test as f

def collect(disconnected=False, inactive=False, date='2026-10-05', times=('08:00:00','08:10:00'), frequencies=None):
    case = f.GTFSFrequency()
    try:
        patterns = {'one': list(zip('AB',times)), 'two': list(zip('CD' if disconnected else 'AB',times))}
        path = case.feed(patterns, patterns, frequencies=frequencies)
        with zipfile.ZipFile(path) as z:
            files = {n:z.read(n) for n in z.namelist()}
        files['routes.txt'] = b'route_id,route_type,agency_id,route_short_name\na,1,A,R\nb,1,A,R\n'
        files['trips.txt'] = b'trip_id,route_id,service_id,direction_id\none,a,W,0\ntwo,b,W,0\n'
        if inactive:
            files['calendar_dates.txt'] = b'service_id,date,exception_type\nW,20261003,2\nW,20261004,2\nW,20261005,2\n'
        for name in ['calendar.txt','feed_info.txt']:
            files[name] = files[name].replace(b'20260101', date[:4].encode()+b'0101').replace(b'20261231',date[:4].encode()+b'1231')
        with zipfile.ZipFile(path,'w') as z:
            for n,data in files.items(): z.writestr(n,data)
        return f.compiler.compile_feed(path,{**f.CONFIG,'canonical_routes':True},date,matching_evidence=True)['matching_evidence']
    finally: case.doCleanups()

output = {k:collect(**args) for k,args in {
    'connected':{},'disconnected':{'disconnected':True},'inactive':{'inactive':True},
    'historical':{'date':'1950-10-05'},'spring':{'date':'2024-03-31'},'fall':{'date':'2024-10-27'},
    'overnight':{'times':('25:00:00','25:10:00')},
    'anchored-frequency':{'frequencies':[{'trip_id':'one','start_time':'24:00:00','end_time':'25:00:00','headway_secs':'600','exact_times':'0'}]},
}.items()}
print(json.dumps(output))
