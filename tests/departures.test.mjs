import test from 'node:test';
import assert from 'node:assert/strict';
import {pickStops, departureRows, clock, plannerLink, stationDepartures} from '../styles/departures.mjs';

const stop = (name, id, lat, lon, modes) => ({type:'STOP', name, id, lat, lon, modes});

test('the station\'s timetable stops: rail stops nearby, named like the station first', () => {
  const station = {lat:35.6812, lon:139.7671, names:['東京']};
  const candidates = [stop('東京駅八重洲口','bus',35.6813,139.7690,['BUS']), stop('大手町','otemachi',35.6840,139.7660,['SUBWAY']), stop('東京 Tōkyō','tokyo-rail',35.6814,139.7668,['REGIONAL_RAIL','SUBWAY']), stop('東京','jr',35.6810,139.7672,['HIGHSPEED_RAIL']), stop('横浜','far',35.4660,139.6220,['REGIONAL_RAIL'])];
  assert.deepEqual(pickStops(candidates, station).map(s => s.id), ['jr','tokyo-rail']);
  assert.deepEqual(pickStops(candidates, {lat:35.6840, lon:139.7661, names:['Unmatched']}).map(s => s.id), ['otemachi','tokyo-rail'], 'without a name match, the nearest rail stops');
  assert.deepEqual(pickStops([stop('Austin','aus',22.3045,114.1667,['SUBWAY'])], {lat:22.3046, lon:114.1660, names:['Austin Station']}).map(s => s.id), ['aus'], '"Station" is ignored in names');
});

test('departure rows: rail only, merged in time order, one row per train, live delays and cancellations', () => {
  const now = Date.parse('2026-09-30T05:00:00Z');
  const t = (mode, line, headsign, scheduled, actual, realTime, extra = {}) => ({mode, displayName: line, headsign, realTime, cancelled: false, routeColor: 'ff0000', place: {scheduledDeparture: scheduled, departure: actual, tz: 'Europe/Berlin', track: '2'}, ...extra});
  const rows = departureRows([
    [t('REGIONAL_RAIL','RE3','Wittenberg','2026-09-30T05:32:00Z','2026-09-30T05:35:00Z',true), t('BUS','M41','Sonnenallee','2026-09-30T05:31:00Z','2026-09-30T05:31:00Z',false)],
    [t('SUBURBAN','S5','Hoppegarten','2026-09-30T05:31:00Z','2026-09-30T05:31:00Z',false), t('REGIONAL_RAIL','RE3','Wittenberg','2026-09-30T05:32:00Z','2026-09-30T05:35:00Z',true), t('REGIONAL_RAIL','RB','Gone','2026-09-30T04:30:00Z','2026-09-30T04:30:00Z',false), t('REGIONAL_RAIL','RE1','Cancelled','2026-09-30T05:40:00Z','2026-09-30T05:40:00Z',true,{cancelled:true})],
  ], {now});
  assert.deepEqual(rows.map(r => [r.line, r.live, r.delay, r.cancelled]), [['S5',false,null,false],['RE3',true,3,false],['RE1',true,0,true]]);
  assert.equal(rows[1].color, '#ff0000');
  assert.equal(clock(rows[1].departure, rows[1].tz), '07:35', 'the station\'s own time zone');
});

test('journey links and the station board request', async () => {
  assert.equal(plannerLink('from', 'jp-japan-rail_1748', '東京'), 'https://api.transitous.org/?fromPlace=jp-japan-rail_1748&fromName=%E6%9D%B1%E4%BA%AC');
  const urls = [];
  const fetch = async url => { urls.push(url); return {ok:true, json: async () => url.includes('reverse-geocode') ? [stop('Austin','hk-MTR-AUS',22.30447,114.16666,['SUBWAY'])] : {stopTimes: []}}; };
  const board = await stationDepartures({lat:22.3046, lon:114.1660, names:['Austin']}, {fetch});
  assert.deepEqual(board, {stops:[stop('Austin','hk-MTR-AUS',22.30447,114.16666,['SUBWAY'])], rows:[]});
  assert.deepEqual(urls, ['https://api.transitous.org/api/v1/reverse-geocode?place=22.3046,114.166&type=STOP', 'https://api.transitous.org/api/v1/stoptimes?stopId=hk-MTR-AUS&n=30']);
});

test('one stop\'s board failing keeps the other\'s; all failing is an error', async () => {
  const stops = [stop('東京','jr',35.6810,139.7672,['HIGHSPEED_RAIL']), stop('東京 Tōkyō','tokyo-rail',35.6814,139.7668,['REGIONAL_RAIL'])];
  const later = new Date(Date.now() + 600_000).toISOString();
  const board = {stopTimes: [{mode:'HIGHSPEED_RAIL', displayName:'Nozomi 1', headsign:'Hakata', realTime:false, place:{departure:later, scheduledDeparture:later, tz:'Asia/Tokyo'}}]};
  const fetchWith = failing => async url => url.includes('reverse-geocode') ? {ok:true, json: async () => stops} : failing(url) ? {ok:false, status:404} : {ok:true, json: async () => board};
  const result = await stationDepartures({lat:35.6812, lon:139.7671, names:['東京']}, {fetch: fetchWith(url => url.includes('tokyo-rail'))});
  assert.deepEqual(result.rows.map(r => r.line), ['Nozomi 1']);
  await assert.rejects(stationDepartures({lat:35.6812, lon:139.7671, names:['東京']}, {fetch: fetchWith(() => true)}), /404/);
});
