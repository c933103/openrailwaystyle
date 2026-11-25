import test from 'node:test';
import assert from 'node:assert/strict';
import {stationDepartures} from '../styles/departures.mjs';

const station={lat:24.9887274,lon:121.3137764,names:['桃園','Taoyuan']};
const rail={name:'桃園',stopId:'TRA_1080',lat:24.98888,lon:121.31449,modes:['REGIONAL_RAIL']};
const buses=Array.from({length:5},(_,i)=>({type:'STOP',id:'bus'+i,name:'stop '+i,
  lat:station.lat+i/100000,lon:station.lon,modes:['BUS']}));
const response=body=>({ok:true,json:async()=>body});

test('rail-scoped lookup does not lose the actual station behind five nearby buses',async()=>{
  const calls=[],signal=new AbortController().signal;
  const out=await stationDepartures(station,{signal,fetch:async(address,opts)=>{
    const u=new URL(address); calls.push(u.pathname); assert.equal(opts.signal,signal);
    if(u.pathname==='/api/v1/reverse-geocode')return response(buses);
    if(u.pathname==='/api/v6/map/stops'){
      assert.equal(u.searchParams.get('grouped'),'true');
      assert.deepEqual(u.searchParams.getAll('modes'),['RAIL','TRAM','FUNICULAR','CABLE_CAR']);
      const [south,west]=u.searchParams.get('min').split(',').map(Number);
      const [north,east]=u.searchParams.get('max').split(',').map(Number);
      assert.ok(south<rail.lat&&rail.lat<north&&west<rail.lon&&rail.lon<east);
      assert.ok(north-south<0.008&&east-west<0.01);
      return response([rail,{...rail,stopId:'bus',modes:['BUS']},{...rail,stopId:'outside-circle',
        lat:station.lat+.0034,lon:station.lon+.0037}]);
    }
    assert.equal(u.pathname,'/api/v1/stoptimes'); assert.equal(u.searchParams.get('stopId'),rail.stopId);
    return response({stopTimes:[]});
  }});
  assert.deepEqual(calls,['/api/v6/map/stops','/api/v1/stoptimes']);
  assert.deepEqual(out.stops.map(s=>s.id),['TRA_1080']);
});
test('grouped place IDs are preserved, even when several operators share a name',async()=>{
  const centre={lat:25.04774,lon:121.51703,names:['臺北','台北','Taipei']};
  const calls=[];
  const candidates=[
    {...rail,stopId:'TRA',parentId:'different-parent',name:'臺北',lat:25.04775,lon:121.51711},
    {...rail,stopId:'THSR',name:'台北',lat:25.04767,lon:121.51698},
    {...rail,stopId:'TRTC',name:'台北車站',lat:25.04631,lon:121.51742,modes:['SUBWAY']},
  ];
  const out=await stationDepartures(centre,{fetch:async address=>{
    const u=new URL(address); if(u.pathname==='/api/v6/map/stops')return response(candidates);
    calls.push(u.searchParams.get('stopId'));return response({stopTimes:[]});
  }});
  assert.deepEqual(calls,['TRA','THSR']);
  assert.deepEqual(out.stops.map(s=>s.id),calls);
});

test('unreadable map-place identity is not presented as a successful empty lookup',async()=>{
  const seen=[];
  await assert.rejects(stationDepartures(station,{fetch:async address=>{
    seen.push(new URL(address).pathname);return response([{...rail,stopId:undefined}]);
  }}),/Invalid Transitous map stop response/);
  assert.deepEqual(seen,['/api/v6/map/stops']);
});
