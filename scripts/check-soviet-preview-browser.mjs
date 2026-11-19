// The archive is synthetic. No historical raster provider is contacted.
import assert from 'node:assert/strict';
import {zxyToTileId} from 'pmtiles';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {launchBrowser} from './browser.mjs';
import {pmtilesBytesResponse} from './pmtiles-browser-fixture.mjs';

const base = (process.env.MAP_BASE_URL || 'http://127.0.0.1:4173/').replace(/\/?$/, '/');
const red = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const redWebP = Buffer.from('UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ/Y/+ByKi/wEA', 'base64');
const directory = Buffer.from([1, zxyToTileId(3, 4, 2), 1, red.length, 1]);
const metadata = Buffer.from('{}'), header = Buffer.alloc(127);
const tileOffset = header.length + directory.length + metadata.length;
header.write('PMTiles');
header[7] = 3;
for (const [offset, number] of [
  [8, header.length], [16, directory.length], [24, header.length + directory.length], [32, metadata.length],
  [40, tileOffset], [56, tileOffset], [64, red.length], [72, 1], [80, 1], [88, 1],
]) header.writeBigUInt64LE(BigInt(number), offset);
header.set([1, 1, 1, 2, 3, 3], 96); // Clustered, uncompressed index and PNG tiles at z3.
for (const [offset, number] of [[102, -40], [106, 40], [110, 45], [114, 66]]) header.writeInt32LE(number * 1e7, offset);
const raster = Buffer.concat([header, directory, metadata, red]);
const name = `${'a'.repeat(64)}.pmtiles`;
const config = {version: 1, archive: name, sheets: [{
  id: 'L-32 fixture', name: 'Historical sheet fixture', bounds: [0, 40, 45, 66], date: 'Compiled 1970',
  scale: 1000000, source: 'https://example.org/sheets/l32', credit: 'Scan archive fixture', alignment: 'Fixture alignment',
}]};
const button = '[data-background="soviet"]';
const browser = await launchBrowser();
try {
  const context = await browser.newContext({viewport: {width: 800, height: 600}});
  await installEmptyMapProviders(context, base, {realPmtiles: true});
  const page = await context.newPage();
  let indexRequests = 0, archiveRequests = 0, available = false, failTiles = false;
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route(`${base}data/soviet-topo/index.json`, route => {
    indexRequests++;
    return route.fulfill(available ? {json: config} : {status: 404});
  });
  await page.route(`${base}data/soviet-topo/${name}`, route => {
    archiveRequests++;
    const range = route.request().headers().range;
    return route.fulfill(failTiles && !range?.startsWith('bytes=0-') ? {status: 503} : pmtilesBytesResponse(raster, range, 'soviet-fixture'));
  });
  async function open(preview, background = 'soviet') {
    await page.goto(`${base}?background=${background}&relief=0&stations=0${preview ? '&sovietPreview=1' : ''}#6/47.241/8.557`, {waitUntil: 'domcontentloaded'});
    await page.waitForSelector('body[data-map-ready="true"]', {timeout: 90000});
    await page.evaluate(async () => { window.sovietMap = (await import(document.querySelector('script[type="module"]').src)).map; });
  }
  await open(false);
  assert.equal(await page.locator(button).isVisible(), false);
  assert.equal(indexRequests, 0, 'a shared background setting alone must not request preview data');
  await open(true);
  assert.equal(await page.locator(button).isVisible(), false);
  assert.equal(indexRequests, 1);
  assert.equal(archiveRequests, 0);

  available = true;
  await open(true);
  assert.equal(await page.locator(button).getAttribute('aria-pressed'), 'true');
  assert.match(await page.locator('#soviet-status').textContent(), /Compiled 1970.*1:1,000,000/);
  assert.equal(await page.locator('#soviet-sheets a').getAttribute('href'), config.sheets[0].source);
  const layout = await page.evaluate(() => {
    const {layers} = window.sovietMap.getStyle();
    return Object.fromEntries(['terrain-bathymetry', 'soviet-topo', 'infrastructure-overview', 'station-major-dots', 'place_label_city'].map(id => {
      const index = layers.findIndex(layer => layer.id === id);
      return [id, [index, layers[index]?.layout?.visibility]];
    }));
  });
  assert.ok(layout['terrain-bathymetry'][0] < layout['soviet-topo'][0]);
  assert.ok(layout['soviet-topo'][0] < layout['infrastructure-overview'][0]);
  assert.ok(layout['soviet-topo'][0] < layout['station-major-dots'][0]);
  assert.ok(layout['soviet-topo'][0] < layout['place_label_city'][0]);
  assert.equal(layout['place_label_city'][1], 'visible', 'modern localized city labels remain visible');
  await page.waitForFunction(() => window.sovietMap.isSourceLoaded('soviet-topo'));
  const pixel = await page.evaluate(() => new Promise(resolve => {
    const map = window.sovietMap;
    map.once('render', () => {
      const gl = map.getCanvas().getContext('webgl2'), out = new Uint8Array(4);
      gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      resolve([...out]);
    });
    map.triggerRepaint();
  }));
  assert.ok(pixel[0] > 245 && pixel[1] < 10 && pixel[2] < 10, `historical raster renders over the map: ${pixel}`);
  // This gap is inside the archive's bounding box but has no raster tile.
  // Source settlement must succeed without raising an outage in that gap.
  await page.evaluate(() => window.sovietMap.jumpTo({center: [-30, 47], zoom: 9}));
  await page.waitForFunction(() => window.sovietMap.isSourceLoaded('soviet-topo'));
  assert.match(await page.locator('#soviet-status').textContent(), /No historical sheet/);
  await page.evaluate(() => window.sovietMap.jumpTo({center: [-150, 30], zoom: 9}));
  await page.waitForFunction(() => document.querySelector('#soviet-status').textContent.includes('No historical sheet'));
  await page.locator('[data-background="map"]').click();
  assert.equal(await page.locator('#soviet-status').isVisible(), false);
  assert.equal(await page.evaluate(() => window.sovietMap.getLayoutProperty('soviet-topo', 'visibility')), 'none');

  failTiles = true;
  await open(true);
  await page.waitForFunction(() => document.querySelector('#soviet-status').textContent.includes('could not load'));
  await page.locator('[data-background="map"]').click();
  assert.equal(await page.locator('#soviet-status').isVisible(), false);
  // Production configuration comes from the deployment page, not a shared
  // URL or a local-storage setting. The external host is a fixture only.
  const host = 'https://indianopenmaps.com/world/topo/russian/';
  let metadataRequests = 0, providerTiles = 0, hostedAvailable = false, tileState = 'image';
  await page.route(url => url.href.startsWith(base) && url.pathname === new URL(base).pathname, async route => {
    const response = await route.fetch();
    await route.fulfill({response, body: (await response.text()).replace(
      '<meta name="atlas-soviet-tile-service" content="">',
      '<meta name="atlas-soviet-tile-service" content="indian-open-maps">'
    )});
  });
  const cors = {'Access-Control-Allow-Origin': new URL(base).origin};
  const sheet = ['L-32 fixture', '1970', [0, 40, 30, 66]];
  await page.route(base + 'soviet-footprints.json', route => route.fulfill({json: {
    1000000: [sheet], 500000: [['L-32-1 fixture', '1980', sheet[2]]],
  }}));
  for (const key of ['1m', '500k']) {
    const root = host + key + '/gs/';
    await page.route(root + 'tiles.json', route => {
      metadataRequests++;
      return route.fulfill(hostedAvailable
        ? {headers:cors, json:{minzoom:3,maxzoom:5,scheme:'xyz',tiles:[root + '{z}/{x}/{y}.webp']}}
        : {status:503, headers:cors});
    });
    await page.route(root + '**/*.webp', route => {
      providerTiles++;
      if (tileState === 'missing') return route.fulfill({status:404, headers:cors});
      if (tileState === 'failed') return route.fulfill({status:503, headers:{...cors, 'Retry-After':'120'}});
      return route.fulfill({headers:cors, contentType:'image/webp', body:redWebP});
    });
  }
  await open(false, 'map');
  assert.equal(await page.locator(button).isVisible(), true);
  assert.equal(metadataRequests, 0, 'regular sessions must not fetch hosted metadata');
  assert.equal(providerTiles, 0);
  await page.locator(button).click();
  await page.waitForFunction(() => document.querySelector('#soviet-status').textContent.includes('temporarily unavailable'));
  assert.equal(await page.locator('[data-background="map"]').getAttribute('aria-pressed'), 'true');
  assert.equal(metadataRequests, 2);
  assert.equal(providerTiles, 0);
  hostedAvailable = true;
  await page.locator(button).click();
  await page.waitForFunction(() => document.querySelector('[data-background="soviet"]').getAttribute('aria-pressed') === 'true');
  await page.waitForFunction(() => ['soviet-topo', 'soviet-topo-1'].every(id => window.sovietMap.isSourceLoaded(id)));
  assert.match(await page.locator('#soviet-status').textContent(), /Catalogue date 1980/);
  assert.ok(providerTiles > 0, 'direct raster views request the two XYZ layers');
  const painted = await page.evaluate(() => new Promise(resolve => {
    window.sovietMap.once('render', () => {
      const gl = window.sovietMap.getCanvas().getContext('webgl2'), bytes = new Uint8Array(4);
      gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      resolve([...bytes]);
    });
    window.sovietMap.triggerRepaint();
  }));
  assert.ok(painted[0] > 245 && painted[1] < 10 && painted[2] < 10, `hosted tiles render: ${painted}`);
  const beforeGap = providerTiles;
  await page.evaluate(() => window.sovietMap.jumpTo({center: [-150, 30], zoom: 9}));
  await page.waitForFunction(() => document.querySelector('#soviet-status').textContent.includes('No historical sheet'));
  assert.equal(providerTiles, beforeGap, 'coverage suppresses open-ocean fetches');
  tileState = 'missing';
  await open(false);
  await page.waitForFunction(() => ['soviet-topo', 'soviet-topo-1'].every(id => window.sovietMap.isSourceLoaded(id)));
  assert.equal(await page.locator(button).getAttribute('aria-pressed'), 'true');
  assert.doesNotMatch(await page.locator('#soviet-status').textContent(), /could not load/);
  tileState = 'failed';
  await open(false);
  await page.waitForFunction(() => document.querySelector('#soviet-status').textContent.includes('could not load'));
  await page.locator('[data-background="map"]').click();
  assert.equal(await page.locator('#soviet-status').isVisible(), false);
  assert.deepEqual(pageErrors, []);
  console.log('PASS: loopback opt-in, missing archive, historical pixels, layer order, coverage, isolated tile failure, and on-demand third-party XYZ');
} finally {
  await browser.close();
}
