import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {layerVisibility} from '../styles/layer-semantics.mjs';
import {installSovietPreview, installSovietProtocol, loadSovietPreview, publicSovietArchiveRoot, sovietCoverage, sovietPreviewAllowed} from '../styles/soviet-topo.mjs';

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

test('public archive roots come from a clean HTTPS configuration', async () => {
  for (const value of ['', './data', 'http://assets.example.org/map/', 'https://user:p@assets.example.org/',
    'https://assets.example.org/map/?', 'https://assets.example.org/map/#fragment'])
    assert.equal(publicSovietArchiveRoot(value), null, value);
  const hostedRoot = publicSovietArchiveRoot('https://assets.example.org/topo/v1');
  assert.equal(hostedRoot.href, 'https://assets.example.org/topo/v1/');
  const requests = [];
  const options = {
    dataRoot, hostedRoot,
    fetcher: async (url, {redirect}) => {
      assert.equal(redirect, 'error');
      requests.push(url.href);
      return {ok: true, json: async () => config};
    },
    createArchive: url => {
      requests.push(url);
      return {getHeader: async () => goodHeader};
    },
  };
  const preview = await loadSovietPreview({href: 'https://atlas.example/?background=soviet', ...options});
  assert.equal(preview.catalogue.href, 'https://assets.example.org/topo/v1/index.json');
  assert.deepEqual(requests, [preview.catalogue.href, hostedRoot.href + name]);
  const local = await loadSovietPreview({href: loopback, ...options});
  assert.equal(local.catalogue.href, new URL('index.json', dataRoot).href);
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
