import test from 'node:test';
import assert from 'node:assert/strict';
import {departureRows, stationDepartures} from '../styles/departures.mjs';

const observation = (scheduled, departure = scheduled) => ({
  mode:'REGIONAL_RAIL', routeId:'test_route', tripId:'20990101_11:00_test_trip',
  displayName:'R1', headsign:'Central', place:{stopId:'test_stop', scheduledDeparture:scheduled, departure, tz:'UTC'}
});
const order = (a, b) => [[a,b],[b,a]];
const at = '2099-01-01T12:00:00Z', late = '2099-01-01T12:14:00Z';
const now = Date.parse('2099-01-01T12:10:00Z');
const expected = r => [r.tripId, r.stopId, r.tripEvent, r.cancelled, r.delay, r.track];

test('one selected stop board retains cancellation of the exact event despite differing presentation', async () => {
  const scheduled = new Date(Date.now() - 600_000).toISOString();
  const departure = new Date(Date.parse(scheduled) + 840_000).toISOString();
  const base = observation(scheduled);
  const cancelled = {...base, cancelled:true};
  const live = {...base, displayName:'Regional 1', headsign:'中央', realTime:true, place:{...base.place, departure, track:'8'}};
  for (const stopTimes of order(cancelled,live)) {
    const calls = [];
    const result = await stationDepartures({lat:0,lon:0,names:['Central']}, {fetch:async value => {
      const url = new URL(value); calls.push(url.pathname);
      return {ok:true,json:async () => calls.length === 1 ? [
        {stopId:'test_stop',name:'Central',lat:0,lon:0,modes:['REGIONAL_RAIL']}
      ] : {stopTimes}};
    }});
    assert.deepEqual(calls,['/api/v6/map/stops','/api/v1/stoptimes']);
    assert.equal(result.rows.length,1);
    assert.deepEqual(expected(result.rows[0]),[base.tripId,'test_stop','departure',true,14,'8']);
  }
});

test('a matching occurrence cannot use a directionless row to bridge opposite directions', () => {
  const base = observation(at,late), other = {...base, displayName:'R2',directionId:1,cancelled:true};
  const left = {...base, directionId:0}, unknown = {...base, displayName:'Regional'};
  for (const entries of [[left,other,unknown],[unknown,other,left],[other,left,unknown]]) {
    const result = departureRows([entries],{now});
    assert.equal(result.length,3);
    assert.equal(result.filter(r=>r.cancelled).length,1);
  }
});

test('same-board cleanup does not unlock presentation-only matching to a second board', () => {
  const base = observation(at), old = {...base,cancelled:true};
  const later = {...base, displayName:'R2', realTime:true, place:{...base.place, departure:late}};
  const other = {...later, tripId:'20990101_11:00_other_trip', place:{...later.place,stopId:'other_stop'}};
  for (const inputs of [[[old,later],[other]],[[other],[later,old]]]) {
    const result = departureRows(inputs,{now});
    assert.equal(result.length,2);
    assert.equal(result.find(r=>r.tripId===other.tripId).cancelled,false);
    assert.equal(result.find(r=>r.tripId===base.tripId).cancelled,true);
  }
});

test('verified same-event reconciliation across boards still works after same-board cleanup', () => {
  const base = observation(at), old = {...base, tripCancelled:true, directionId:0};
  const regional = {...base, displayName:'Regional 1', headsign:'中央', realTime:true,
    place:{...base.place, departure:late, track:'8'}};
  const right = {...regional, displayName:'R-1', directionId:0};
  const opposite = {...right, directionId:1};
  for (const left of order(old, regional)) for (const input of order(left, [right])) {
    const result = departureRows(input,{now});
    assert.equal(result.length,1);
    assert.deepEqual(expected(result[0]),[base.tripId,'test_stop','departure',true,14,'8']);
    assert.equal('presentations' in result[0],false);
  }
  for (const left of order(old, regional)) for (const input of order(left, [opposite])) {
    const result = departureRows(input,{now});
    assert.equal(result.length,2);
    assert.equal(result.filter(r=>r.cancelled).length,1);
  }
});

test('a coalesced event keeps its alternate presentation as a competing edge', () => {
  const base = observation(at,late);
  const alternate = {...base, displayName:'R2'};
  const competitor = {...base, displayName:'R2', tripId:'20990101_11:00_test_second-trip'};
  const cross = {...competitor, tripId:'20990101_11:00_other_third-trip'};
  for (const left of [[base,alternate,competitor],[competitor,alternate,base]]) {
    for (const input of order(left, [cross])) {
      assert.equal(departureRows(input,{now}).length,3);
    }
  }
});

test('an alternate strong-event edge cannot disappear before ambiguity checks', () => {
  const base = observation(at,late);
  const known = {...base, directionId:0};
  const alternate = {...base, displayName:'R2'};
  const competing = {...base, displayName:'R3', directionId:1, tripId:'20990101_11:00_other_competing'};
  for (const expired of [false,true]) {
    const original = {...base, displayName:'R3', directionId:1, cancelled:true,
      place:{...base.place, departure:expired?at:late}};
    const expectedCount = expired ? 2 : 3;
    for (const entries of [[known,alternate,competing],[alternate,competing,known],[competing,known,alternate]]) {
      for (const inputs of order(entries,[original])) {
        const result = departureRows(inputs,{now});
        assert.equal(result.length,expectedCount);
        assert.equal(result.find(r=>r.tripId===competing.tripId)?.cancelled,false);
        assert.equal(result.filter(r=>r.cancelled).length,expired?0:1);
      }
    }
  }
});
