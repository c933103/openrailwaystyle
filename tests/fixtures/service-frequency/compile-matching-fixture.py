"""Offline end-to-end timetable fixture: ordinary and short-working trains."""
import csv, importlib.util, io, json, sys, tempfile, zipfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('compiler',Path(__file__).resolve().parents[3]/'scripts'/'gtfs-frequency.py')
compiler=importlib.util.module_from_spec(spec);spec.loader.exec_module(compiler)
def csv_bytes(fields,rows):
    out=io.StringIO();w=csv.DictWriter(out,fieldnames=fields);w.writeheader();w.writerows(rows);return out.getvalue()
points=[(139.70,35.68),(139.71,35.68),(139.72,35.68),(139.73,35.68)]
trips=[];times=[];shapes=[]
for direction in (0,1):
    order=list(range(4))[::1 if direction==0 else -1]
    for i,k in enumerate(order):shapes.append(dict(shape_id=str(direction),shape_pt_sequence=i,shape_pt_lon=points[k][0],shape_pt_lat=points[k][1]))
    # Four full trips per hour, plus two short workings serving just A-B.
    for j in range(12):
        ident=f'{direction}-{j}';short=j>=8
        served=([0,1] if direction==0 else [1,0]) if short else order
        trips.append(dict(trip_id=ident,route_id='ginza',service_id='W',shape_id=str(direction)))
        minute=([0,10,20,30,40,50,60,90][j] if not short else (j-8)*30)
        for i,k in enumerate(served):
            total=7*3600+minute*60+i*120
            value=f'{total//3600:02}:{total//60%60:02}:{total%60:02}'
            times.append(dict(trip_id=ident,stop_id=chr(65+k),stop_sequence=i,arrival_time=value,departure_time=value))
config={'source':{'id':'jp-metro','name':'Offline Metro fixture','checked':'2026-10-10','retrieved':'2026-10-10','license':'CC0','attribution':'Synthetic test timetable','terms_url':'https://example.test/terms'},'profiles':{'am':{'start':'07:00:00','end':'09:00:00'},'h08':{'start':'08:00:00','end':'09:00:00'},'overnight':{'start':'00:00:00','end':'05:00:00'}}}
tables={
 'agency.txt':(['agency_id','agency_name','agency_timezone'],[dict(agency_id='metro',agency_name='東京メトロ',agency_timezone='Asia/Tokyo')]),
 'routes.txt':(['route_id','agency_id','route_type','route_short_name','route_long_name'],[dict(route_id='ginza',agency_id='metro',route_type=1,route_short_name='G',route_long_name='銀座線')]),
 'calendar.txt':(['service_id','start_date','end_date','monday','tuesday','wednesday','thursday','friday','saturday','sunday'],[dict(service_id='W',start_date='20260101',end_date='20261231',**{d:1 for d in ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']})]),
 'stops.txt':(['stop_id','stop_name','stop_lon','stop_lat'],[dict(stop_id=chr(65+i),stop_name=chr(65+i),stop_lon=x,stop_lat=y) for i,(x,y) in enumerate(points)]),
 'trips.txt':(['trip_id','route_id','service_id','shape_id'],trips),
 'stop_times.txt':(['trip_id','stop_id','stop_sequence','arrival_time','departure_time'],times),
 'shapes.txt':(['shape_id','shape_pt_sequence','shape_pt_lon','shape_pt_lat'],shapes)}
with tempfile.TemporaryDirectory() as temp:
    path=Path(temp)/'fixture.zip'
    with zipfile.ZipFile(path,'w') as z:
        for name,(fields,rows) in tables.items():z.writestr(name,csv_bytes(fields,rows))
    result=compiler.compile_feed(path,config,'2026-10-12',geometry=True)
    Path(sys.argv[1]).write_text(json.dumps(result),encoding='utf8')
