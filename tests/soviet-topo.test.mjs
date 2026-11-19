import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {layerVisibility} from '../styles/layer-semantics.mjs';
import {installSovietPreview, installSovietProtocol, loadSovietPreview, loadSovietTiles, installSovietXYZProtocol, sovietCoverage, sovietPreviewAllowed} from '../styles/soviet-topo.mjs';

const loopback = 'http://127.0.0.1:4173/?sovietPreview=1';
const dataRoot = new URL('./data/soviet-topo/', loopback);
const name = `${'a'.repeat(64)}.pmtiles`;
const sheet = {
  id: 'L-32', name: 'Preview sheet', date: 'Compiled 1970', scale: 1000000, bounds: [6, 44, 12, 48],
  source: 'https://example.org/scan', credit: 'Scans <example>', alignment: 'Calibrated from sheet grid',
};
const config = {version: 1, archive: name, sheets: [sheet]};
const goodHeader = {tileType: 2, minZoom: 3, maxZoom: 10};

test('even a saved background cannot request preview data on an ordinary or public visit', async () => {
  for (const href of ['https://atlas.example/?sovietPreview=1', 'http://127.0.0.1/?background=soviet', 'bad URI']) {
    assert.equal(sovietPreviewAllowed(href), false);
    let requested = false;
    assert.equal(await loadSovietPreview({href, dataRoot, fetcher: async () => { requested = true; }}), null);
    assert.equal(requested, false);
  }
  assert.equal(sovietPreviewAllowed(loopback), true);
});

test('only a valid local manifest and raster archive enable the background', async () => {
  let requested;
  const createArchive = url => { requested = url; return {getHeader: async () => goodHeader}; };
  const load = (manifest, factory = createArchive) => loadSovietPreview({
    href: loopback, dataRoot, fetcher: async () => ({ok: true, json: async () => manifest}), createArchive: factory,
  });
  for (const invalid of [{...config, archive:'../map.pmtiles'}, {...config, sheets:[]}, {...config, sheets:[{...sheet, source:'javascript:alert(0)'}]}]) {
    assert.equal(await load(invalid), null);
    assert.equal(requested, undefined);
  }
  assert.equal(await load(config, () => ({getHeader: async () => ({...goodHeader, tileType: 1})})), null);
  assert.equal(await load(config, () => ({getHeader: async () => { throw new Error('Missing archive'); }})), null);
  const preview = await load(config);
  assert.equal(preview.archives[0].url, new URL(name, dataRoot).href);
  assert.equal(requested, preview.archives[0].url);
  assert.equal(sovietCoverage(preview, 368.5, 47), sheet);
  assert.equal(sovietCoverage(preview, -150, 30), undefined);
});

const provider = 'https://indianopenmaps.com/world/topo/russian/';
const hostedCatalogue = new URL('https://atlas.example/soviet-footprints.json');
const footprints = {1000000: [[sheet.id, '1970', sheet.bounds]], 500000: [['L-32-1', 'unknown', sheet.bounds]]};
const metadata = (key, maxzoom = 9) => ({tiles: [`${provider}${key}/gs/{z}/{x}/{y}.webp`], minzoom: 3, maxzoom});

test('tiles use the verified provider routes and date catalogue', async () => {
  const requests = [];
  const load = async (detail = metadata('500k')) => loadSovietTiles({catalogue: hostedCatalogue, fetcher: async (url, {redirect}) => {
    assert.equal(redirect, 'error');
    const address = String(url);
    requests.push(address);
    return {ok: true, json: async () => address === hostedCatalogue.href ? footprints
      : address === `${provider}1m/gs/tiles.json` ? metadata('1m') : detail};
  }});
  const preview = await load();
  assert.deepEqual(requests, [hostedCatalogue.href, provider + '1m/gs/tiles.json', provider + '500k/gs/tiles.json']);
  assert.equal(sovietCoverage(preview, 8.5, 47).date, 'Date unknown');
  assert.equal(sovietCoverage(preview, 8.5, 47).scale, 500000);
  assert.equal(sovietCoverage(preview, 8.5, 47, 2), undefined);
  assert.equal(await load(metadata('500k', 12)), null);
  assert.equal(await load({...metadata('500k'), tiles: ['https://elsewhere.example/{z}/{x}/{y}.webp']}), null);
});

test('tile requests skip areas outside the catalogue, treat 404 as gaps, and pause a rate-limited source', async () => {
  let handler, response = new Response(null, {status: 404});
  const requests = [];
  installSovietXYZProtocol({addProtocol: (_, fn) => {handler = fn;}}, [
    {key: '1m', template: metadata('1m').tiles[0], minzoom: 3, maxzoom: 9, sheets: [sheet]},
    {key: '500k', template: metadata('500k').tiles[0], minzoom: 3, maxzoom: 9, sheets: [sheet]},
  ], async (url, options) => {requests.push([url, options.redirect]); return response;});
  const get = path => handler({url: 'atlassovietxyz://' + path}, new AbortController());
  const gap = await get('1m/3/0/2');
  assert.equal(gap.data[0], 137);
  assert.deepEqual(requests, []);
  await assert.rejects(() => get('1m/3/10/2'), /Invalid/);
  const empty = await get('1m/3/4/2');
  assert.deepEqual(empty, gap);
  assert.deepEqual(requests[0], [provider + '1m/gs/3/4/2.webp', 'error']);
  response = new Response(null, {status: 429, headers: {'Retry-After': '60'}});
  await assert.rejects(() => get('500k/3/4/2'), /429/);
  await assert.rejects(() => get('1m/3/4/2'), /pause/);
  assert.equal(requests.length, 2);
});

test('the original raster sits above seabed and below railway and localized labels', async () => {
  const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));
  assert.equal(installSovietPreview(style, {archives: [{url: new URL(name, dataRoot).href}], sheets: [sheet]}), true);
  const layers = new Map(style.layers.map((layer, index) => [layer.id, {layer, index}]));
  const soviet = layers.get('soviet-topo');
  assert.ok(layers.get('terrain-bathymetry').index < soviet.index);
  for (const id of ['energy-overview-areas', 'infrastructure-overview', 'station-major-dots', 'place_label_city'])
    assert.ok(layers.get(id).index > soviet.index, id);
  const settings = {background: 'soviet', relief: true, mode: 'infrastructure', stations: true};
  for (const id of ['terrain-bathymetry', 'soviet-topo', 'infrastructure-overview', 'station-major-dots', 'place_label_city'])
    assert.equal(layerVisibility(layers.get(id).layer, settings), true, id);
  assert.equal(layerVisibility(layers.get('terrain-seabed-contours').layer, settings), false);
  assert.equal(layerVisibility(layers.get('terrain-seabed-contours').layer, {...settings, background:'map'}), true);
  assert.equal(layerVisibility(soviet.layer, {...settings, background:'map'}), false);
  assert.match(style.sources['soviet-topo'].attribution, /Scans &lt;example&gt;/);
});

test('worldwide groups preserve coarse archives beneath independently overzoomed detail', async () => {
  const west = {...sheet, id: 'America', bounds: [-75, 35, -65, 45]};
  const pacific = {...sheet, id: 'Pacific', bounds: [172, -45, 180, -38]};
  const detail = {...sheet, id: 'L-32-1', scale: 500000, minzoom: 6};
  const secondFile = `${'b'.repeat(64)}.pmtiles`, thirdFile = `${'c'.repeat(64)}.pmtiles`;
  const manifest = {version: 2, groups: [
    {archives: [name], sheets: [sheet, west, pacific]},
    {archives: [secondFile, thirdFile], sheets: [detail]},
  ]};
  const load = groups => loadSovietPreview({
    href: loopback, dataRoot, fetcher: async () => ({ok: true, json: async () => ({version: 2, groups})}),
    createArchive: url => ({getHeader: async () => ({...goodHeader, tileType: url.endsWith(secondFile) ? 4 : 2})}),
  });
  const preview = await load(manifest.groups);
  assert.deepEqual(preview.archives.map(({url}) => url.split('/').at(-1)), [name, secondFile, thirdFile]);
  assert.equal(sovietCoverage(preview, 8.5, 47, 3), sheet);
  assert.equal(sovietCoverage(preview, 8.5, 47, 12), detail);
  assert.equal(sovietCoverage(preview, -68, 41, 12), west);
  assert.equal(sovietCoverage(preview, -180, -40, 12), pacific);
  assert.equal(sovietCoverage(preview, -150, 30, 12), undefined);
  assert.equal(await load([manifest.groups[0], manifest.groups[0]]), null);
  const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));
  assert.equal(installSovietPreview(style, preview), true);
  assert.deepEqual(style.layers.filter(({id}) => id.startsWith('soviet-topo')).map(({id}) => id),
    ['soviet-topo', 'soviet-topo-1', 'soviet-topo-2']);
});

test('the historical protocol settles a missing tile with a transparent image', async () => {
  let handler;
  const component = 'http://127.0.0.1/history.pmtiles';
  installSovietProtocol({addProtocol: (_, load) => { handler = load; }}, async ({type, url}) => {
    if (type === 'json') return {data: {tiles: [`pmtiles://${component}/{z}/{x}/{y}`]}};
    assert.equal(url, `pmtiles://${component}/3/4/2`);
    return {data: null};
  });
  const controller = new AbortController();
  const metadata = await handler({type:'json', url:`atlassoviet://${component}`}, controller);
  assert.deepEqual(metadata.data.tiles, [`atlassoviet://${component}/{z}/{x}/{y}`]);
  const result = await handler({type:'arrayBuffer', url:`atlassoviet://${component}/3/4/2`}, controller);
  assert.deepEqual([...result.data.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});
