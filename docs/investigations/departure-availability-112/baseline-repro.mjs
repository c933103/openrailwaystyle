import assert from 'node:assert/strict';
import {stationDepartures} from './baseline-departures.mjs';

const station = {lat: 0, lon: 0, names: ['Central']};
const stops = ['a', 'b'].map((id, i) => ({type: 'STOP', modes: ['REGIONAL_RAIL'], lat: i * 0.001, lon: 0, id, name: 'Central'}));
const at = new Date(Date.now() + 600_000).toISOString();
const departure = {mode: 'REGIONAL_RAIL', displayName: 'R', headsign: 'Airport', tripId: 'trip', place: {scheduledDeparture: at, departure: at, stopId: 'a', tz: 'UTC'}};
const probe = async outcomes => {
  const requests = [];
  const fakeFetch = async url => {
    requests.push(url);
    if (url.includes('reverse-geocode')) return {ok: true, json: async () => stops};
    const id = new URL(url).searchParams.get('stopId'), outcome = outcomes[id];
    if (outcome === 'failure') return {ok: false, status: 503, json: async () => ({})};
    return {ok: true, json: async () => ({stopTimes: outcome === 'rows' ? [departure] : []})};
  };
  try { return {result: await stationDepartures(station, {fetch: fakeFetch}), requestCount: requests.length}; }
  catch (error) { return {error: error.message, requestCount: requests.length}; }
};
const allEmpty = await probe({a: 'empty', b: 'empty'});
const partialEmpty = await probe({a: 'empty', b: 'failure'});
const partialEmptyReversed = await probe({a: 'failure', b: 'empty'});
const allWithRows = await probe({a: 'rows', b: 'empty'});
const partialWithRows = await probe({a: 'rows', b: 'failure'});
const allFailed = await probe({a: 'failure', b: 'failure'});
assert.deepEqual(partialEmpty.result, allEmpty.result);
assert.deepEqual(partialEmptyReversed.result, allEmpty.result);
assert.deepEqual(partialWithRows.result, allWithRows.result);
assert.equal(allFailed.error, 'Transitous returned 503');
for (const p of [allEmpty, partialEmpty, partialEmptyReversed, allWithRows, partialWithRows, allFailed]) assert.equal(p.requestCount, 3);
console.log(JSON.stringify({
  sourceCommit: '8c1d2607068f0f3c0cce7e9e721fca1deaa07ee0',
  sourceBlob: '092b3e9c580e0bad06c7b15922574df9d7b72e62',
  noExternalFetch: true,
  observed: {allEmpty, partialEmpty, partialEmptyReversed, allWithRows, partialWithRows, allFailed},
  indistinguishable: {partialEmptyFromAllEmpty: true, partialRowsFromCompleteRows: true},
  note: 'Assertions characterize existing faulty status loss; they are not fixed-behavior acceptance tests.'
}, null, 2));
