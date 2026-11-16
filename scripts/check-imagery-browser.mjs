// Satellite provider selection in the real app and MapLibre: Sentinel-2 (EOX)
// where it has native detail, Esri World Imagery only beyond it when a key is
// configured, regional orthophotos or global fallbacks after refusal and
// without a key. Every provider response is a solid-colour local fixture.
import assert from 'node:assert/strict';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';

const base = (process.env.MAP_BASE_URL || 'http://127.0.0.1:4173/').replace(/\/?$/, '/');
const KEY = 'AAPTfixtureKeyForImageryBrowserCheck0000';
const RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const BLUE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==', 'base64');
const browser = await launchBrowser({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']});

async function open({config, esri}) {
  const context = await browser.newContext({viewport: {width: 800, height: 600}, serviceWorkers: 'block'});
  await installEmptyMapProviders(context, base);
  const requests = {esri: [], eox: 0, gibs: 0, regional: []}, errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`${base}imagery-config.json`, route => route.fulfill({json: config}));
  await page.route('https://ibasemaps-api.arcgis.com/**', route => {
    requests.esri.push(route.request().url());
    return esri === 'ok' ? route.fulfill({contentType: 'image/png', body: RED}) : route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":403}}'});
  });
  await page.route('https://tiles.maps.eox.at/**', route => { requests.eox++; return route.fulfill({contentType: 'image/png', body: BLUE}); });
  for(const pattern of ['https://wmts.geo.admin.ch/**','https://data.geopf.fr/**','https://basemap.nationalmap.gov/**'])await page.route(pattern,route=>{requests.regional.push(route.request().url());return route.fulfill({contentType:'image/png',body:RED});});
  await page.route('https://gibs.earthdata.nasa.gov/**', route=>{requests.gibs++;return route.fulfill({contentType:'image/png',body:RED});});
  return {context, page, requests, errors};
}
async function centre(page) {
  return page.evaluate(() => new Promise(resolve => {
    const map = window.imageryMap;
    map.once('render', () => {
      const gl = map.getCanvas().getContext('webgl2') || map.getCanvas().getContext('webgl'), out = new Uint8Array(4);
      gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      resolve([...out]);
    });
    map.triggerRepaint();
  }));
}
async function load(page, zoom) {
  await page.goto(`${base}?background=satellite&relief=0&stations=0&names=0#${zoom}/35.68/139.76`, {waitUntil: 'domcontentloaded'});
  await page.waitForSelector('body[data-map-ready="true"]', {state: 'attached', timeout: 90000});
  await page.evaluate(async () => {
    window.imageryMap = (await import(document.querySelector('script[type="module"]').src)).map;
    await new Promise(resolve => { const map = window.imageryMap; if (map.areTilesLoaded()) resolve(); map.on('idle', resolve); setTimeout(resolve, 20000); });
  });
}
const near = (pixel, rgb, label) => assert.ok(rgb.every((v, i) => Math.abs(pixel[i] - v) <= 8), `${label}: ${JSON.stringify(pixel)}`);

try {
  // Where EOX has native detail (z12 at Tokyo) it draws without any Esri
  // request; beyond it (z15) Esri draws.
  const healthy = await open({config: {esriKey: KEY}, esri: 'ok'});
  await load(healthy.page, 12);
  near(await centre(healthy.page), [0, 0, 255], 'Sentinel-2 where it has native detail, even with a key');
  assert.equal(healthy.requests.esri.length, 0, 'no Esri request where EOX covers the view');
  await healthy.page.evaluate(() => window.imageryMap.jumpTo({zoom: 15}));
  await healthy.page.evaluate(() => new Promise(resolve => { window.imageryMap.once('idle', resolve); setTimeout(resolve, 20000); }));
  near(await centre(healthy.page), [255, 0, 0], 'Esri imagery beyond Sentinel-2 detail');
  assert.ok(healthy.requests.esri.length > 0 && healthy.requests.esri.every(url => url.endsWith(`?token=${KEY}`)), 'keyed Esri requests');
  assert.ok(healthy.requests.esri.every(url => +/\/tile\/(\d+)\//.exec(url)[1] >= 14), 'Esri is requested only at zooms EOX cannot cover here');
  assert.equal(await healthy.page.evaluate(() => window.imageryMap.getStyle().sources.satellite.maxzoom), 19);
  assert.match(await healthy.page.locator('.maplibregl-ctrl-attrib').textContent(), /Powered by Esri.*Vantor/s, 'Esri attribution');
  assert.deepEqual(healthy.errors, []);
  await healthy.context.close();

  // z15 is beyond EOX's z14, so the fallback also crops the z14 ancestor.
  const refused = await open({config: {esriKey: KEY}, esri: 'forbidden'});
  await load(refused.page, 15);
  near(await centre(refused.page), [0, 0, 255], 'Sentinel-2 replaces refused Esri tiles');
  assert.ok(await refused.page.evaluate(() => Number(localStorage.getItem('atlas-imagery-esri-off-until')) > Date.now()), 'the device remembers the refusal');
  const afterRefusal = refused.requests.esri.length;
  assert.ok(afterRefusal > 0, 'Esri was tried before the device switched');
  await refused.page.evaluate(() => window.imageryMap.jumpTo({center: [2.35, 48.85], zoom: 15}));
  await refused.page.evaluate(() => new Promise(resolve => { window.imageryMap.once('idle', resolve); setTimeout(resolve, 20000); }));
  near(await centre(refused.page), [255, 0, 0], 'French orthophotos after panning during Esri cooldown');
  assert.ok(refused.requests.regional.some(url=>url.includes('data.geopf.fr')));
  assert.equal(refused.requests.esri.length, afterRefusal, 'no Esri request after the refusal');
  assert.deepEqual(refused.errors, []);
  await refused.context.close();

  const unconfigured = await open({config: {}, esri: 'ok'});
  await load(unconfigured.page, 12);
  near(await centre(unconfigured.page), [0, 0, 255], 'Sentinel-2 without a key');
  assert.equal(await unconfigured.page.evaluate(() => window.imageryMap.getStyle().sources.satellite.tiles[0]), 'atlasimagery://{z}/{x}/{y}', 'keyless imagery protocol enabled');
  assert.equal(unconfigured.requests.esri.length, 0);
  for(const [center,host] of [[[8.54,47.37],'wmts.geo.admin.ch'],[[-97.74,30.27],'basemap.nationalmap.gov']]) {
    await unconfigured.page.evaluate(center=>window.imageryMap.jumpTo({center,zoom:16}),center);
    await unconfigured.page.waitForFunction(()=>window.imageryMap.areTilesLoaded());
    near(await centre(unconfigured.page),[255,0,0],'keyless regional orthophoto');
    assert.ok(unconfigured.requests.regional.some(url=>url.includes(host)));
  }
  await unconfigured.page.evaluate(()=>window.imageryMap.jumpTo({center:[166.67,-77.85],zoom:12}));
  await unconfigured.page.waitForFunction(()=>window.imageryMap.areTilesLoaded());
  near(await centre(unconfigured.page),[255,0,0],'keyless NASA Antarctic fallback');
  assert.ok(unconfigured.requests.gibs>0);assert.equal(unconfigured.requests.esri.length,0);
  await unconfigured.context.close();
  console.log('PASS: Sentinel-2 where it has native detail, Esri only beyond it with a key, Sentinel-2 after refusal (including z15 crop), keyless EOX and NASA Antarctic fallback');
} finally {
  await browser.close();
}
