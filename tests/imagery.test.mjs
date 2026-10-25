import test from 'node:test';
import assert from 'node:assert/strict';
import {loadImageryConfig, applyImageryConfig, createImageryProtocol, ESRI_MAX_ZOOM, ESRI_OFF_KEY, ESRI_OFF_MS, ESRI_ATTRIBUTION} from '../styles/imagery.mjs';

const KEY = 'AAPTxy8BH1VEsoebNVZXo8HurEOF051kAEKlhkOhBEc9BmTEST';
const bytes = text => new TextEncoder().encode(text).buffer;
const image = text => ({ok: true, status: 200, headers: new Headers({'content-type': 'image/jpeg'}), arrayBuffer: async () => bytes(text)});
const reply = (status, type = 'application/json') => ({ok: status >= 200 && status < 300, status, headers: new Headers({'content-type': type}), arrayBuffer: async () => bytes('{}')});
const memory = () => { const values = new Map(); return {getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v))}; };
const text = data => new TextDecoder().decode(data);

function harness(esriReply, {storage = memory(), now = () => 1000} = {}) {
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    if (url.includes('arcgis.com')) { const r = esriReply(url); if (r instanceof Error) throw r; return r; }
    return image('eox ' + url.match(/g\/(\d+\/\d+\/\d+)/)[1]);
  };
  const resampled = [];
  const resample = async (data, depth, dx, dy) => { resampled.push([text(data), depth, dx, dy]); return bytes(`crop ${depth} ${dx} ${dy}`); };
  return {calls, resampled, storage, protocol: createImageryProtocol({esriKey: KEY, fetcher, storage, now, resample})};
}
const get = (protocol, z, x, y, signal) => protocol.tile({url: `atlasimagery://${z}/${x}/${y}`}, {signal}).then(r => text(r.data));

test('the deployment configuration enables Esri only with a well-formed key', async () => {
  const json = value => async () => ({ok: true, json: async () => value});
  assert.deepEqual(await loadImageryConfig('x', {fetcher: json({esriKey: KEY})}), {esriKey: KEY});
  for (const value of [{}, {esriKey: ''}, {esriKey: 'short'}, {esriKey: 'has spaces in it but is long enough'}, null])
    assert.deepEqual(await loadImageryConfig('x', {fetcher: json(value)}), {}, JSON.stringify(value));
  assert.deepEqual(await loadImageryConfig('x', {fetcher: async () => ({ok: false, status: 404})}), {});
  assert.deepEqual(await loadImageryConfig('x', {fetcher: async () => { throw new TypeError('offline'); }}), {});
});

test('without a key the published EOX source is untouched; with one it routes through the protocol', () => {
  const eox = {type: 'raster', tiles: ['https://tiles.maps.eox.at/x/{z}/{y}/{x}.jpg'], maxzoom: 14, attribution: 'EOX credit'};
  const untouched = structuredClone(eox);
  assert.deepEqual(applyImageryConfig(untouched, {}), eox);
  const esri = applyImageryConfig(structuredClone(eox), {esriKey: KEY});
  assert.deepEqual(esri.tiles, ['atlasimagery://{z}/{x}/{y}']);
  assert.equal(esri.maxzoom, ESRI_MAX_ZOOM);
  assert.ok(esri.attribution.startsWith(ESRI_ATTRIBUTION) && esri.attribution.includes('EOX credit'), 'both providers credited');
  assert.match(ESRI_ATTRIBUTION, /Powered by .*Esri.*Vantor, Earthstar Geographics, and the GIS User Community/);
});

test('Esri tiles are requested with the key and returned as served', async () => {
  const h = harness(() => image('esri'));
  assert.equal(await get(h.protocol, 15, 100, 200), 'esri');
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0], new RegExp(`^https://ibasemaps-api\\.arcgis\\.com/arcgis/rest/services/World_Imagery/MapServer/tile/15/200/100\\?token=${KEY}$`));
});

test('a quota or authorization failure switches the device to Sentinel-2 for the back-off period', async () => {
  for (const failure of [reply(403), reply(498), reply(499), reply(401), reply(200, 'application/json')]) {
    let now = 1000; const h = harness(() => failure, {now: () => now});
    assert.equal(await get(h.protocol, 10, 1, 2), 'eox 10/2/1', `status ${failure.status} falls back for this tile`);
    assert.equal(h.protocol.esriActive(), false);
    assert.equal(Number(h.storage.getItem(ESRI_OFF_KEY)), 1000 + ESRI_OFF_MS);
    h.calls.length = 0;
    assert.equal(await get(h.protocol, 10, 3, 4), 'eox 10/4/3');
    assert.ok(h.calls.every(url => !url.includes('arcgis')), 'no Esri request while switched off');
    const later = createImageryProtocol({esriKey: KEY, storage: h.storage, now: () => 1000 + ESRI_OFF_MS - 1, fetcher: async () => image('x')});
    assert.equal(later.esriActive(), false, 'another page on the device honours the back-off');
    now = 1000 + ESRI_OFF_MS;
    assert.equal(h.protocol.esriActive(), true, 'Esri is tried again after the back-off');
  }
});

test('other Esri failures fall back for that tile only', async () => {
  for (const failure of [reply(500), reply(404), new TypeError('Failed to fetch')]) {
    const h = harness(() => failure);
    assert.equal(await get(h.protocol, 9, 5, 6), 'eox 9/6/5');
    assert.equal(h.protocol.esriActive(), true, String(failure.status ?? failure.message));
  }
});

test('beyond Sentinel-2 zoom the fallback crops a shared z14 ancestor', async () => {
  const h = harness(() => reply(503));
  assert.equal(await get(h.protocol, 16, 4 * 100 + 1, 4 * 200 + 3), 'crop 2 1 3');
  assert.equal(await get(h.protocol, 16, 4 * 100 + 2, 4 * 200 + 0), 'crop 2 2 0');
  assert.deepEqual(h.resampled.map(r => r[0]), ['eox 14/200/100', 'eox 14/200/100']);
  assert.equal(h.calls.filter(url => url.includes('eox')).length, 1, 'children share one ancestor request');
});

test('a cancelled tile is not silently replaced and storage failures keep the session switch', async () => {
  const controller = new AbortController(); controller.abort();
  const h = harness(() => new DOMException('Aborted', 'AbortError'));
  await assert.rejects(get(h.protocol, 10, 1, 1, controller.signal), {name: 'AbortError'});
  const broken = {getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }};
  const b = harness(() => reply(403), {storage: broken});
  assert.equal(await get(b.protocol, 10, 1, 1), 'eox 10/1/1');
  assert.equal(b.protocol.esriActive(), false);
  await assert.rejects(get(b.protocol, 10, 1, 1).then(() => b.protocol.tile({url: 'atlasimagery://bad'}, {})), /Invalid imagery tile/);
});
