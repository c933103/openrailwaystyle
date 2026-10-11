import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {departureRows, trainSchedule, tripStops, clock} from '../styles/departures.mjs';
import {departureItem, scheduleLoader, renderSchedule} from '../styles/departures-ui.mjs';

const at = '2026-10-10T00:00:00Z';
const place = (name, stopId, fields = {}) => ({name, stopId, tz:'Asia/Tokyo', arrival:at, departure:at, ...fields});
const itinerary = {legs:[{mode:'SUBWAY', realTime:false, from:place('Shibuya','origin'),
  intermediateStops:[place('Suehirocho','selected', {scheduledDeparture:at, track:'1'})], to:place('Asakusa','terminus')}]};
const boardRow = {mode:'SUBWAY', line:'G', headsign:'Asakusa', departure:Date.parse(at), scheduled:Date.parse(at), tripId:'feed_trip&a=1', stopId:'selected', tz:'Asia/Tokyo'};
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

test('complete trip includes origin, preceding stops, selected stop and terminus, and encodes its opaque ID', async () => {
  let request;
  const stops = await trainSchedule(boardRow.tripId, {fetch:async url => {request = new URL(url); return {ok:true, json:async()=>itinerary};}});
  assert.equal(request.origin,'https://api.transitous.org');
  assert.equal(request.pathname,'/api/v1/trip');
  assert.equal(request.searchParams.get('tripId'),boardRow.tripId);
  assert.equal(request.searchParams.get('a'),null);
  assert.equal(request.searchParams.get('withScheduledSkippedStops'),'true');
  assert.deepEqual(stops.map(s=>s.stopId),['origin','selected','terminus']);
  assert.equal(stops[1].track,'1');
  await assert.rejects(trainSchedule('', {fetch:()=>assert.fail('must not request without an ID')}));
  await assert.rejects(trainSchedule('trip', {fetch:async()=>({ok:false,status:503})}),/503/);
  assert.equal(clock(NaN),'—');
});

test('loops keep repeated stations; interlined continuations join only their shared boundary', () => {
  const first = {...itinerary.legs[0], intermediateStops:[place('Origin again','origin'),place('Selected','selected')]};
  const second = {mode:'SUBWAY', interlineWithPreviousLeg:true, from:place('Asakusa','terminus',{departure:'2026-10-10T00:03:00Z'}), to:place('Further','beyond')};
  const result = tripStops({legs:[first,second]});
  assert.deepEqual(result.map(s=>s.stopId),['origin','origin','selected','terminus','beyond']);
  assert.equal(result[3].departure,Date.parse('2026-10-10T00:03:00Z'));
  assert.throws(()=>tripStops({legs:[first,{...second,interlineWithPreviousLeg:false}]}),/Invalid train/);
  assert.throws(()=>tripStops({legs:[]}),/Missing trip/);
});

test('cross-feed merging retains a usable trip reference with its own stop, deterministically', () => {
  const observation = fields => ({mode:'SUBWAY', displayName:'G', headsign:'Asakusa', place:{departure:at,scheduledDeparture:at,stopId:'stop'}, ...fields});
  const a = observation({tripId:'a-trip'}), b = observation({tripId:'b-trip'});
  const rows = lists => departureRows(lists,{now:Date.parse(at)-1});
  assert.deepEqual(rows([[a],[b]]),rows([[b],[a]]));
  const result = rows([[observation({})],[a]])[0];
  assert.equal(result.tripId,'a-trip'); assert.equal(result.stopId,'stop');
});

test('bounded loader shares requests, expires cached schedules and recovers after failure', async () => {
  let stamp=0,calls=0,fail=true;
  const load=scheduleLoader({now:()=>stamp,load:async()=>{calls++; if(fail)throw new Error('outage');return ['stops'];}});
  assert.equal(load('one'),load('one'));
  await assert.rejects(load('one'));
  fail=false;assert.deepEqual(await load('one'),['stops']);assert.equal(calls,2);
  await load('one');assert.equal(calls,2);
  stamp=60_001;await load('one');assert.equal(calls,3);
  for(let i=0;i<65;i++)await load(String(i));
  const before=calls;await load('one');assert.equal(calls,before+1,'oldest schedules are evicted');
});

test('departure expansion is lazy, reuses loaded content and reports missing IDs and retryable failure', async () => {
  const dom=new JSDOM('<div id="detail-content"><ol></ol></div>'),document=dom.window.document;
  let calls=0,fail=true;
  const item=departureItem(document,boardRow,{load:async()=>{calls++;if(fail)throw new Error('outage');return tripStops(itinerary);}});
  document.querySelector('ol').append(item);
  assert.equal(calls,0);
  const details=item.querySelector('details');details.open=true;await settle();
  assert.equal(calls,1);assert.ok(item.textContent.includes('could not load'));
  fail=false;item.querySelector('button').click();await settle();
  assert.equal(calls,2);assert.equal(item.querySelectorAll('tbody tr').length,3);
  details.open=false;await settle();details.open=true;await settle();assert.equal(calls,2);
  const missing=departureItem(document,{...boardRow,tripId:''},{load:()=>assert.fail('missing ID')});
  document.querySelector('ol').append(missing);missing.querySelector('details').open=true;await settle();
  assert.ok(missing.textContent.includes('did not supply a trip ID'));
  dom.window.close();
});

test('schedule shows local dates over midnight, dwell, live scheduled times, cancellations and safe text', () => {
  const dom=new JSDOM('<div></div>'),container=dom.window.document.querySelector('div');
  const stop={name:'<img src=x onerror=alert(1)>',stopId:'selected',tz:'Asia/Tokyo',
    arrival:Date.parse('2026-10-10T14:59:00Z'),departure:Date.parse('2026-10-10T15:02:00Z'),
    scheduledArrival:Date.parse('2026-10-10T14:58:00Z'),scheduledDeparture:boardRow.scheduled,
    track:'2',live:true,pickupType:'NOT_ALLOWED'};
  renderSchedule(container,[stop,{...stop,name:'Cancelled',cancelled:true}],boardRow);
  assert.equal(container.querySelector('img'),null);
  assert.ok(container.textContent.includes('10 Oct 2026'));assert.ok(container.textContent.includes('11 Oct 2026'));
  assert.ok(container.textContent.includes('23:59'));assert.ok(container.textContent.includes('00:02'));
  assert.ok(container.textContent.includes('Scheduled'));assert.ok(container.textContent.includes('No boarding'));
  assert.ok(container.textContent.includes('Cancelled / stop skipped'));
  assert.equal(container.querySelectorAll('.trip-current-stop').length,2);
  dom.window.close();
});

test('merged trip highlight uses its own observation time through both reconciliation stages',()=>{
 const linked=new Date(Date.parse(at)+30_000).toISOString();
 const rows=departureRows([[{mode:'SUBWAY',displayName:'G',headsign:'Asakusa',place:place('Suehirocho','preferred',{scheduledDeparture:at})}],
  [{mode:'SUBWAY',headsign:'Asakusa',tripId:'linked',place:place('Suehirocho','selected',{departure:linked,scheduledDeparture:linked})}]],{now:Date.parse(at)-60000});
 assert.equal(rows.length,1);assert.equal(rows[0].scheduled,Date.parse(at));assert.equal(rows[0].tripScheduled,Date.parse(linked));
 const dom=new JSDOM('<div></div>'),container=dom.window.document.querySelector('div');
 renderSchedule(container,[{name:'Earlier loop',stopId:'selected',scheduledDeparture:Date.parse(at)},
  {name:'Selected',stopId:'selected',scheduledDeparture:Date.parse(linked)}],rows[0]);
 assert.equal(container.querySelectorAll('.trip-current-stop').length,1);assert.equal(container.querySelector('.trip-current-stop th').textContent,'Selected');dom.window.close();
});
test('arrival-only board events highlight the matching arrival rather than a later departure',()=>{
 const row=departureRows([[{mode:'SUBWAY',displayName:'G',headsign:'Asakusa',tripId:'arrival-trip',place:{stopId:'selected',arrival:at,scheduledArrival:at}}]],{now:Date.parse(at)-60000})[0];
 assert.equal(row.tripEvent,'arrival');
 const dom=new JSDOM('<div></div>'),container=dom.window.document.querySelector('div');
 renderSchedule(container,[{name:'Selected',stopId:'selected',scheduledArrival:Date.parse(at),scheduledDeparture:Date.parse(at)+120000}],row);
 assert.equal(container.querySelectorAll('.trip-current-stop').length,1);dom.window.close();
});

test('arrival and departure observations tied in presentation choose trip context deterministically',()=>{
 const common={mode:'SUBWAY',displayName:'G',headsign:'Asakusa',tripId:'trip',place:{stopId:'selected',tz:'Asia/Tokyo'}};
 const arrival={...common,place:{...common.place,arrival:at,scheduledArrival:at}},departure={...common,place:{...common.place,departure:at,scheduledDeparture:at}};
 const rows=items=>departureRows([items],{now:Date.parse(at)-60000});assert.deepEqual(rows([arrival,departure]),rows([departure,arrival]));
});
