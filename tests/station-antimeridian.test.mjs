import test from 'node:test';
import assert from 'node:assert/strict';
import {pickStops, stationDepartures} from '../styles/departures.mjs';
import {searchResults, tileStations} from '../styles/map-model.mjs';

const stop = (id, lon, name = 'Terminal 1', lat = 0) => ({type:'STOP', id, name, lat, lon, modes:['REGIONAL_RAIL']});
const station = (lon, lat = 0) => ({lat, lon, names:['Terminal 1']});
const facility = (longitude, name = 'Terminal 1', latitude = 0) => ({osm_id:1, name, longitude, latitude, railway:'station'});
const place = (lon, name = 'Terminal 1', lat = 0, extra = {}) => ({osm_type:'way', osm_id:2, category:'railway', type:'station', lat:String(lat), lon:String(lon), namedetails:{name}, ...extra});
const tile = (lon, name = 'Terminal 1', lat = 0, id = 'way-2-station') => ({geometry:{type:'Point', coordinates:[lon, lat]}, properties:{id, name, feature:'station'}});
const pairs = [[179.999, -179.999], [-179.999, 179.999], [180, -180], [-180, 180], [10, 10.002], [10.002, 10]];

for (const [from, to] of pairs) test(`station proximity crosses ${from} to ${to} in all three runtime paths`, () => {
  const candidate = stop('near', to), before = structuredClone(candidate);
  assert.deepEqual(pickStops([candidate], station(from)).map(s => s.id), ['near']);
  assert.deepEqual(searchResults([facility(from)], [place(to)]).rail.map(s => s.osm_id), [1]);
  assert.deepEqual(tileStations([tile(to)], 'Terminal 1', [from, 0], [facility(from)]), []);
  assert.deepEqual(candidate, before, 'longitude wrapping does not mutate provider coordinates');
});

for (const direction of [-1, 1]) test(`wrapped proximity keeps distance, latitude and name guards (${direction})`, () => {
  const from = direction * 179.999, near = -direction * 179.999, far = -direction * 179.98;
  assert.deepEqual(pickStops([stop('far', far)], station(from)), []);
  assert.deepEqual(pickStops([stop('far-latitude', near, 'Terminal 1', .01)], station(from)), []);
  // A closer different station must not displace the two complete named matches.
  const candidates = [stop('different-number', from, 'Terminal 10'), stop('different-name', from, 'Terminal Park'),
    stop('right-a', near), stop('right-b', -direction * 179.9985), stop('third', -direction * 179.998)];
  for (const order of [candidates, [...candidates].reverse()]) {
    assert.deepEqual(pickStops(order, station(from)).map(s => s.id), ['right-a', 'right-b']);
    assert.deepEqual(pickStops(order, station(from), 1).map(s => s.id), ['right-a']);
  }
  for (const [lon, name, lat] of [[far, 'Terminal 1', 0], [near, 'Terminal 1', .01], [near, 'Terminal 10', 0], [near, 'Terminal Park', 0]]) {
    assert.deepEqual(searchResults([facility(from)], [place(lon, name, lat)]).rail.map(s => s.osm_id), [1, 2]);
    assert.deepEqual(tileStations([tile(lon, name, lat)], 'Terminal', [from, 0], [facility(from)]).map(s => s.osm_id), [2]);
  }
  // Matching numeric bilingual identity can still reconcile across the seam.
  const alias = '第1航廈 Terminal 1';
  assert.deepEqual(searchResults([facility(from)], [place(near, alias)]).rail.map(s => s.osm_id), [1]);
  assert.deepEqual(tileStations([tile(near, alias)], 'Terminal', [from, 0], [facility(from)]), []);
});

test('wrapped proximity retains latitude scaling and the separate existing radii', () => {
  // At 60 degrees latitude this 0.006-degree longitude gap is about 334 m.
  const from = 179.997, to = -179.997;
  assert.deepEqual(pickStops([stop('near', to, 'Terminal 1', 60)], station(from, 60)).map(s => s.id), ['near']);
  assert.deepEqual(searchResults([facility(from, 'Terminal 1', 60)], [place(to, 'Terminal 1', 60)]).rail.map(s => s.osm_id), [1]);
  assert.deepEqual(tileStations([tile(to, 'Terminal 1', 60)], 'Terminal', [from, 60], [facility(from, 'Terminal 1', 60)]), []);
  // Search retains its 0.004-degree rectangle; departures retain their 400 m circle.
  assert.deepEqual(pickStops([stop('outside-circle', -179.9985, 'Terminal 1', .0035)], station(179.998)), []);
  assert.equal(searchResults([facility(179.998)], [place(-179.9985, 'Terminal 1', .0035)]).rail.length, 1);
  assert.deepEqual(tileStations([tile(-179.9985, 'Terminal 1', .0035)], 'Terminal', [179.998, 0], [facility(179.998)]), []);
});

test('OSM identity stays type-scoped and remains independent of proximity and names', () => {
  assert.equal(searchResults([facility(179.999)], [place(-170, 'Terminal 10', 10, {osm_type:'node', osm_id:1})]).rail.length, 1);
  assert.deepEqual(tileStations([tile(-170, 'Terminal 10', 10, 'node-1-station')], 'Terminal', [179.999, 0], [facility(179.999)]), []);
  assert.equal(searchResults([facility(179.999)], [place(-179.999, 'Terminal 10', 0, {osm_id:1})]).rail.length, 2);
  assert.equal(tileStations([tile(-179.999, 'Terminal 10', 0, 'way-1-station')], 'Terminal', [179.999, 0], [facility(179.999)]).length, 1);
});

for (const direction of [-1, 1]) test(`departure lookup requests the wrapped match, with original coordinates and two-board cap (${direction})`, async () => {
  const from = direction * 179.999, candidates = [stop('a', -direction * 179.999), stop('b', -direction * 179.9985), stop('c', -direction * 179.998)];
  const calls = [], signal = new AbortController().signal;
  const board = await stationDepartures(station(from), {signal, fetch:async (href, options) => {
    const url = new URL(href); calls.push({url, options});
    assert.equal(url.origin, 'https://api.transitous.org');
    if (url.pathname.endsWith('/reverse-geocode')) return {ok:true, json:async () => candidates};
    assert.equal(url.pathname, '/api/v1/stoptimes');
    const id = url.searchParams.get('stopId');
    return {ok:true, json:async () => ({stopTimes:[{mode:'REGIONAL_RAIL', displayName:`R-${id}`, headsign:'Fixture terminus', tripId:id,
      place:{stopId:id, departure:'2099-01-01T12:00:00Z', scheduledDeparture:'2099-01-01T12:00:00Z', tz:'UTC'}}]})};
  }});
  assert.deepEqual(board.stops.map(s => s.id), ['a', 'b']);
  assert.deepEqual(board.stopResults, [{stopId:'a', status:'fulfilled'}, {stopId:'b', status:'fulfilled'}]);
  assert.deepEqual(board.rows.map(row => row.line), ['R-a', 'R-b']);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.searchParams.get('place'), `0,${from}`);
  assert.deepEqual(calls.slice(1).map(({url}) => url.searchParams.get('stopId')), ['a', 'b']);
  assert.ok(calls.every(({options}) => options.signal === signal));
});
