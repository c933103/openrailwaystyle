import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {launchBrowser} from './browser.mjs';

// Synthetic geometry tests the real generated cartography without downloading
// provider tiles. These features never enter the production map or snapshots.
const style = JSON.parse(await readFile('styles/world.style.json'));
const app = await readFile('styles/app.mjs', 'utf8');
const library = /loadScript\('(https:\/\/[^']+maplibre-gl\.js)'/.exec(app)?.[1];
assert.ok(library, 'use the application\'s pinned renderer');
const mainLayers = style.layers.filter(layer => /^(infrastructure|speed|electrification|control|gauge|loading|axle|owner|service)-overview(?:-system-[23])?$/.test(layer.id));
assert.ok(mainLayers.length >= 9);
// At zoom 7, the full-detail high railway tiles replace the low overview.
// Include both track layers so the fixture can catch the original regression:
// querying Speed while Infrastructure is selected must return no geometry.
const detailLayers = ['infrastructure-tracks', 'speed-tracks'].map(id => {
  const layer = style.layers.find(layer => layer.id === id);
  assert.ok(layer?.source === 'railway' && layer['source-layer'] === 'railway_line_high' && layer.minzoom === 7,
    `${id} must use the real zoom-7 high-detail railway layer`);
  return layer;
});
const properties = {id: 'way-1', feature: 'rail', state: 'present', usage: 'main', highspeed: true,
  maxspeed: 300, electrification_state: 'present', voltage: 25000, frequency: 50,
  gaugeint0: 1435, train_protection0: 'etcs_2', loading_gauge: 'UIC_GC', axle_tonnes: 22.5, owner_color: '#2356b6'};
const index = geojsonvt({type: 'FeatureCollection', features: [{type: 'Feature', properties,
  geometry: {type: 'LineString', coordinates: [[0, 0], [30, 25], [60, 30], [90, 20], [120, 0]]}}]}, {maxZoom: 6, extent: 4096, buffer: 64});
const wuhan = [114.305, 30.593];
const wuhanIndex = geojsonvt({type: 'FeatureCollection', features: [{type: 'Feature', properties,
  geometry: {type: 'LineString', coordinates: [[114.15, 30.53], wuhan, [114.49, 30.70]]}}]},
  {maxZoom: 9, extent: 4096, buffer: 64});
const browser = await launchBrowser();
const page = await browser.newPage({viewport: {width: 360, height: 320}});
const errors = [], requests = [], samples = [], consoleErrors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {if (message.type() === 'error') consoleErrors.push(message.text());});
page.on('requestfailed', request => consoleErrors.push(`Request failed: ${request.url()} ${request.failure()?.errorText}`));
await page.route('https://rail-fixture.invalid/**', async route => {
  const [endpoint, z, x, y] = new URL(route.request().url()).pathname.slice(1).split('/');
  requests.push({endpoint, z: +z, x: +x, y: +y});
  const tile = (endpoint === 'railway_line_high' ? wuhanIndex : index).getTile(+z, +x, +y);
  // Playwright expects Buffer, not Uint8Array: the latter's toString('base64')
  // produces comma-separated decimals and corrupts the intercepted response.
  await route.fulfill({status: 200, headers: {'content-type': 'application/x-protobuf', 'access-control-allow-origin': '*'},
    body: tile ? Buffer.from(vtpbf.fromGeojsonVt({[endpoint]: tile})) : Buffer.alloc(0)});
});
await mkdir('browser-review', {recursive: true});
try {
  await page.setContent('<html><body style="margin:0"><div id="map" style="width:360px;height:320px"></div></body></html>');
  await page.addScriptTag({url: library});
  await page.evaluate(({layers, originals}) => {
    const sources = {};
    for (const layer of layers) {
      sources[layer.source] = {...originals[layer.source], tiles: [`https://rail-fixture.invalid/${layer['source-layer']}/{z}/{x}/{y}`]};
      delete sources[layer.source].url;
      layer.layout = {...layer.layout, visibility: layer.id.startsWith('speed-') ? 'visible' : 'none'};
    }
    window.testMap = new maplibregl.Map({container: 'map', minZoom: -2, maxZoom: 9, zoom: -0.1,
      center: [60, 20], attributionControl: false, fadeDuration: 0,
      canvasContextAttributes: {preserveDrawingBuffer: true},
      style: {version: 8, projection: {type: 'globe'}, sources,
        layers: [{id: 'background', type: 'background', paint: {'background-color': '#f2f1e9'}}, ...layers]}});
    window.mapErrors = [];
    window.testMap.on('error', e => window.mapErrors.push(e.error?.message || String(e.error)));
  }, {layers: [...mainLayers, ...detailLayers], originals: style.sources});
  await page.waitForFunction(() => window.testMap?.isStyleLoaded(), undefined, {timeout: 30000});
  for (const projection of ['globe', 'mercator']) for (const zoom of [-0.1, 0, 0.1]) {
    await page.evaluate(({projection, zoom}) => {testMap.setProjection({type: projection}); testMap.jumpTo({center: [60, 20], zoom});}, {projection, zoom});
    for (const mode of ['speed', 'infrastructure', 'electrification', 'control', 'gauge', 'loading', 'axle', 'owner', 'service']) {
      await page.evaluate(mode => {
        for (const layer of testMap.getStyle().layers) if (layer.id !== 'background') testMap.setLayoutProperty(layer.id, 'visibility', layer.id.startsWith(`${mode}-`) ? 'visible' : 'none');
      }, mode);
      await page.waitForFunction(({zoom, mode}) => Math.abs(testMap.getZoom() - zoom) < 0.001
        && testMap.queryRenderedFeatures().some(f => f.layer.id.startsWith(`${mode}-overview`)), {zoom, mode}, {timeout: 20000});
      // Check pixels as well as feature-query results. A zero-width or fully
      // transparent line must not satisfy a visibility regression.
      const painted = await page.evaluate(async () => {
        await new Promise(resolve => {testMap.once('render', resolve);testMap.triggerRepaint();});
        const canvas = testMap.getCanvas(), gl = canvas.getContext('webgl2');
        gl.finish();
        const point = testMap.project([60, 30]);
        const scale = canvas.width / testMap.getContainer().clientWidth;
        const x = Math.round(point.x * scale) - 4;
        const y = canvas.height - Math.round(point.y * scale) - 4;
        const pixels = new Uint8Array(9 * 9 * 4);
        gl.readPixels(x, y, 9, 9, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let painted = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] && Math.max(Math.abs(pixels[i] - 242), Math.abs(pixels[i + 1] - 241), Math.abs(pixels[i + 2] - 233)) > 20) painted++;
        }
        return painted;
      });
      assert.ok(painted > 0, `${projection} ${mode} z${zoom}: the railway stroke must paint visible pixels`);
      samples.push({projection, zoom, mode, painted, features: await page.evaluate(() => testMap.queryRenderedFeatures().length)});
    }
  }
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.deepEqual(await page.evaluate(() => window.mapErrors), []);
  assert.ok(requests.length && requests.every(r => r.z >= 0), 'negative camera zoom must never request negative tile coordinates');
  assert.ok(requests.some(r => r.z === 0), 'world overview uses real zoom-0 tiles');
  await writeFile('browser-review/rail-overview-negative-zoom.json', JSON.stringify({samples, requests}, null, 2));
  await page.screenshot({path: 'browser-review/rail-overview-negative-zoom.png'});
  console.log('PASS: global railway geometry across 54 mode/projection/zoom combinations', JSON.stringify(samples));
  // Deterministic Wuhan regression: the production Infrastructure layer must
  // draw a real high-detail vector line at the z7 overview/detail handoff.
  // No OpenRailwayMap tile is downloaded by this test.
  await page.evaluate(center => {
    testMap.setProjection({type: 'mercator'});
    testMap.jumpTo({center, zoom: 7});
    for (const layer of testMap.getStyle().layers) if (layer.id !== 'background')
      testMap.setLayoutProperty(layer.id, 'visibility', layer.id === 'infrastructure-tracks' ? 'visible' : 'none');
  }, wuhan);
  await page.waitForFunction(center => {
    const map = window.testMap, point = map.project(center);
    return !map.isMoving() && Math.abs(map.getZoom() - 7) < 0.001 &&
      map.queryRenderedFeatures([[point.x - 32, point.y - 32], [point.x + 32, point.y + 32]],
        {layers: ['infrastructure-tracks']}).some(f => f.source === 'railway' &&
          ['LineString', 'MultiLineString'].includes(f.geometry.type));
  }, wuhan, {timeout: 30000});
  const wuhanResult = await page.evaluate(async center => {
    const map = window.testMap, point = map.project(center);
    await new Promise(resolve => {map.once('render', resolve); map.triggerRepaint();});
    const canvas = map.getCanvas(), gl = canvas.getContext('webgl2');
    gl.finish();
    const scale = canvas.width / map.getContainer().clientWidth;
    const x = Math.round(point.x * scale) - 4, y = canvas.height - Math.round(point.y * scale) - 4;
    const pixels = new Uint8Array(9 * 9 * 4);
    gl.readPixels(x, y, 9, 9, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let painted = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 3] && Math.max(Math.abs(pixels[i] - 242), Math.abs(pixels[i + 1] - 241), Math.abs(pixels[i + 2] - 233)) > 20) painted++;
    const box = [[point.x - 32, point.y - 32], [point.x + 32, point.y + 32]];
    return {zoom: map.getZoom(), sourceFeatures: map.querySourceFeatures('railway', {sourceLayer: 'railway_line_high'}).length,
      infrastructure: map.queryRenderedFeatures(box, {layers: ['infrastructure-tracks']}).length,
      hiddenSpeed: map.queryRenderedFeatures(box, {layers: ['speed-tracks']}).length,
      infrastructureVisibility: map.getLayoutProperty('infrastructure-tracks', 'visibility'),
      speedVisibility: map.getLayoutProperty('speed-tracks', 'visibility'), painted};
  }, wuhan);
  assert.equal(wuhanResult.infrastructureVisibility, 'visible');
  assert.equal(wuhanResult.speedVisibility, 'none');
  assert.ok(wuhanResult.sourceFeatures > 0 && wuhanResult.infrastructure > 0 && wuhanResult.painted > 0,
    'Wuhan z7 must paint high-detail Infrastructure rails from supplied vector geometry: ' + JSON.stringify(wuhanResult));
  assert.equal(wuhanResult.hiddenSpeed, 0, 'the inactive Speed track layer must not satisfy the Infrastructure regression');
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.deepEqual(await page.evaluate(() => window.mapErrors), []);
  await writeFile('browser-review/wuhan-z7-fixture.json', JSON.stringify(wuhanResult, null, 2));
  await page.screenshot({path: 'browser-review/wuhan-z7-fixture.png'});
  console.log('PASS: Wuhan zoom-7 high-detail Infrastructure layer paints visible fixture geometry', JSON.stringify(wuhanResult));
} catch (error) {
  const renderer = await page.evaluate(() => {
    const map = window.testMap;
    if (!map) return {created: false};
    const style = map.getStyle();
    return {zoom: map.getZoom(), projection: map.getProjection(), loaded: map.loaded(), styleLoaded: map.isStyleLoaded(),
      dimensions: [map.getContainer().clientWidth, map.getContainer().clientHeight], mapErrors: window.mapErrors,
      sources: Object.keys(style?.sources || {}).map(id => ({id, loaded: map.isSourceLoaded(id), tiles: map.getSource(id)?.tiles})),
      layers: style?.layers.map(layer => ({id: layer.id, minzoom: layer.minzoom, visibility: layer.layout?.visibility})),
      features: map.queryRenderedFeatures().map(feature => feature.layer.id)};
  }).catch(failure => ({diagnosticError: failure.message}));
  const diagnostic = {message: error.message, errors, consoleErrors, requests, samples, renderer};
  console.error('RAIL_OVERVIEW_FAILURE', JSON.stringify(diagnostic));
  await writeFile('browser-review/rail-overview-failure.json', JSON.stringify(diagnostic, null, 2));
  await page.screenshot({path: 'browser-review/rail-overview-failure.png'}).catch(() => {});
  throw error;
} finally {await browser.close();}
