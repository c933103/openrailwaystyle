import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {layerVisibility} from '../styles/layer-semantics.mjs';
import {installSovietPreview, loadSovietPreview, sovietCoverage, sovietPreviewAllowed} from '../styles/soviet-topo.mjs';

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
  assert.equal(preview.url, new URL(name, dataRoot).href);
  assert.equal(requested, preview.url);
  assert.equal(sovietCoverage(preview, 368.5, 47), sheet);
  assert.equal(sovietCoverage(preview, -150, 30), undefined);
});

test('the original raster sits above seabed and below railway and localized labels', async () => {
  const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));
  assert.equal(installSovietPreview(style, {url: new URL(name, dataRoot).href, sheets: [sheet]}), true);
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
