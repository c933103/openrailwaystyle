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

test('one train from two feeds is one row under its line name; numbered route IDs are not line names', () => {
  // Ōji, 2026-10-05, as returned by Transitous: jp_japan-rail gives each trip
  // pattern a numbered route; jp_tokyo-rail names the line and the train.
  const now = Date.parse('2026-10-05T12:00:00Z');
  const t = (fields, at) => ({mode: 'REGIONAL_RAIL', realTime: false, place: {scheduledDeparture: at, departure: at, tz: 'Asia/Tokyo'}, ...fields});
  const rows = departureRows([
    [t({displayName: '8913771', routeShortName: '8913771', routeLongName: '', routeId: 'jp-japan-rail_8913771', headsign: '桜木町'}, '2026-10-05T13:31:00Z'),
     t({displayName: '7348861', routeShortName: '7348861', routeLongName: '', routeId: 'jp-japan-rail_7348861', headsign: '大船'}, '2026-10-05T13:38:00Z')],
    [t({displayName: 'JK', routeShortName: 'JK', routeLongName: 'JR京浜東北線・根岸線 JR Keihin-Tohoku-Negishi Line', tripShortName: '2223A', routeId: 'jp-tokyo-rail_JR-East.KeihinTohokuNegishi', headsign: '(普通 Local) 桜木町 Sakuragichō'}, '2026-10-05T13:31:00Z'),
     t({displayName: 'N', routeShortName: 'N', routeId: 'jp-tokyo-rail_TokyoMetro.Namboku', headsign: '(普通 Local) 白金高輪 Shirokane-takanawa'}, '2026-10-05T13:31:00Z')],
  ], {now});
  assert.deepEqual(rows.map(r => [r.line, r.headsign]), [
    ['JK', '(普通 Local) 桜木町 Sakuragichō'], ['N', '(普通 Local) 白金高輪 Shirokane-takanawa'], ['', '大船']]);
  // Two named lines leaving the same minute for the same place stay two trains.
  const both = departureRows([[t({displayName: 'JK', routeId: 'a_JK', headsign: '大宮'}, '2026-10-05T13:40:00Z'), t({displayName: 'JU', routeId: 'a_JU', headsign: '大宮'}, '2026-10-05T13:40:00Z')]], {now});
  assert.equal(both.length, 2);
});

test('merged rows keep real-time state from either feed; rows without a destination are not merged', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  const t = (fields, at, actual = at) => ({mode: 'REGIONAL_RAIL', realTime: false, place: {scheduledDeparture: at, departure: actual, tz: 'Asia/Tokyo'}, ...fields});
  const live = departureRows([[t({displayName: 'JK', routeId: 'a_JK', headsign: '大宮'}, '2026-10-05T13:40:00Z')],
    [t({displayName: 'JK', routeId: 'b_JK', headsign: '(普通) 大宮', realTime: true, place: undefined}, '2026-10-05T13:40:00Z')]].map(list => list.map(x => x.place ? x : {...x, place: {scheduledDeparture: '2026-10-05T13:40:00Z', departure: '2026-10-05T13:43:00Z', tz: 'Asia/Tokyo', track: '3'}})), {now});
  assert.equal(live.length, 1);
  assert.deepEqual([live[0].line, live[0].headsign, live[0].live, live[0].delay, live[0].track], ['JK', '大宮', true, 3, '3']);
  const cancelled = departureRows([[t({displayName: '12345678', routeId: 'x_12345678', headsign: '大宮', cancelled: true}, '2026-10-05T13:40:00Z')], [t({displayName: 'JK', routeId: 'a_JK', headsign: '大宮'}, '2026-10-05T13:40:00Z')]], {now});
  assert.deepEqual(cancelled.map(r => [r.line, r.cancelled]), [['JK', true]], 'the named row carries the cancellation');
  const blank = departureRows([[t({displayName: '12345678', routeId: 'x_12345678', headsign: ''}, '2026-10-05T13:40:00Z')], [t({displayName: 'JK', routeId: 'a_JK', headsign: '大宮'}, '2026-10-05T13:40:00Z')]], {now});
  assert.equal(blank.length, 2, 'a row without a destination matches nothing');
});

test('a live row and a cancelled duplicate merge as cancelled; one list keeps two simultaneous services', () => {
  const now = Date.parse('2026-10-05T12:00:00Z'), at = '2026-10-05T13:40:00Z';
  const t = fields => ({mode: 'REGIONAL_RAIL', realTime: false, place: {scheduledDeparture: at, departure: at, tz: 'Asia/Tokyo'}, ...fields});
  const merged = departureRows([[t({displayName: 'JK', routeId: 'a_JK', headsign: '大宮', realTime: true})], [t({displayName: 'JK', routeId: 'b_JK', headsign: '大宮', realTime: true, cancelled: true})]], {now});
  assert.deepEqual(merged.map(r => [r.line, r.live, r.cancelled]), [['JK', true, true]]);
  const one = departureRows([[t({displayName: '12345678', routeId: 'x_12345678', headsign: '大宮'}), t({displayName: '87654321', routeId: 'x_87654321', headsign: '大宮'})]], {now});
  assert.equal(one.length, 2, 'two unnamed services in one list stay two');
  assert.equal(departureRows([[t({displayName: 'JK', routeId: 'a_JK', headsign: '大宮'}), t({displayName: 'JK', routeId: 'a_JK', headsign: '大宮'})]], {now}).length, 1, 'an exact repeat in one list is one train');
});

test('a named row with two candidates in another list merges with neither, in either order', () => {
  const now = Date.parse('2026-10-05T12:00:00Z'), at = '2026-10-05T13:40:00Z';
  const t = fields => ({mode: 'REGIONAL_RAIL', realTime: false, place: {scheduledDeparture: at, departure: at, tz: 'Asia/Tokyo'}, ...fields});
  const named = [t({displayName: 'JK', routeId: 'a_JK', headsign: '大宮'})];
  const unnamed = [t({displayName: '12345678', routeId: 'x_12345678', headsign: '大宮'}), t({displayName: '87654321', routeId: 'x_87654321', headsign: '大宮'})];
  assert.equal(departureRows([named, unnamed], {now}).length, 3, 'which unnamed row is the JK train is unknown');
  assert.equal(departureRows([unnamed, named], {now}).length, 3, 'list order does not change the result');
});

test('ambiguous cross-feed matches stay separate whatever the order', () => {
  const now = Date.parse('2026-10-05T12:00:00Z'), at = '2026-10-05T13:40:00Z';
  const t = fields => ({mode: 'REGIONAL_RAIL', realTime: false, place: {scheduledDeparture: at, departure: at, tz: 'Asia/Tokyo'}, ...fields});
  const named = [t({displayName: 'JK', routeId: 'a_JK', headsign: '大宮'})];
  const unnamed = t({displayName: '12345678', routeId: 'x_12345678', headsign: '大宮'}), sameLine = t({displayName: 'JK', routeId: 'b_JK', headsign: '(普通) 大宮'});
  for (const second of [[unnamed, sameLine], [sameLine, unnamed]]) for (const lists of [[named, second], [second, named]]) {
    // The named JK row has two candidates in the other list: nothing is merged.
    assert.equal(departureRows(lists, {now}).length, 3, JSON.stringify(lists.map(l => l.map(x => x.displayName))));
  }
});

test('a regional train and a metro train leaving together are never merged', () => {
  const now = Date.parse('2026-10-05T12:00:00Z'), at = '2026-10-05T13:40:00Z';
  const t = fields => ({realTime: false, place: {scheduledDeparture: at, departure: at, tz: 'Asia/Tokyo'}, ...fields});
  const rows = departureRows([[t({mode: 'REGIONAL_RAIL', displayName: '12345678', routeId: 'x_12345678', headsign: '大宮'})], [t({mode: 'SUBWAY', displayName: 'N', routeId: 'a_N', headsign: '大宮'})]], {now});
  assert.equal(rows.length, 2);
  assert.equal(departureRows([[t({mode: 'REGIONAL_RAIL', displayName: '12345678', routeId: 'x_12345678', headsign: '大宮'})], [t({mode: 'SUBURBAN', displayName: 'JK', routeId: 'a_JK', headsign: '大宮'})]], {now}).length, 1, 'main-line modes are one family');
});

test('journey links and the station board request', async () => {
  assert.equal(plannerLink('from', 'jp-japan-rail_1748', '東京'), 'https://api.transitous.org/?fromPlace=jp-japan-rail_1748&fromName=%E6%9D%B1%E4%BA%AC');
  const urls = [];
  const fetch = async url => { urls.push(url); return {ok:true, json: async () => url.includes('reverse-geocode') ? [stop('Austin','hk-MTR-AUS',22.30447,114.16666,['SUBWAY'])] : {stopTimes: []}}; };
  const board = await stationDepartures({lat:22.3046, lon:114.1660, names:['Austin']}, {fetch});
  assert.deepEqual(board, {stops:[stop('Austin','hk-MTR-AUS',22.30447,114.16666,['SUBWAY'])], rows:[]});
  assert.deepEqual(urls, ['https://api.transitous.org/api/v1/reverse-geocode?place=22.3046,114.166&type=STOP', 'https://api.transitous.org/api/v1/stoptimes?stopId=hk-MTR-AUS&n=30&mode=HIGHSPEED_RAIL,LONG_DISTANCE,NIGHT_RAIL,REGIONAL_FAST_RAIL,REGIONAL_RAIL,SUBURBAN,RAIL,METRO,SUBWAY,TRAM,FUNICULAR,CABLE_CAR']);
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
