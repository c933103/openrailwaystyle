// Pinned Paris OSM-positive / explicitly synthetic timetable-negative acceptance.
// Uses production rebuilt MVTs, MapLibre and service paint. No external basemap.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchBrowser} from './browser.mjs';
import {rendererFixture} from './browser-renderer-fixture.mjs';
import {buildParisAcceptanceVariants, injectParisAdversaryTiles} from './paris-service-geometry-fixture.mjs';
import {geometryTestCenter, validateGeometryTestFrames} from './service-geometry-test-framing.mjs';
import {FREQUENCY_PROFILES} from '../styles/service-frequency.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
export async function checkParisServiceGeometryBrowser({root = process.env.ATLAS_TEST_URL || 'http://127.0.0.1:4173',
  browserLauncher = launchBrowser, fixtureBuilder = buildParisAcceptanceVariants, reportPrefix = 'paris-service',
  title = 'Paris: retained OSM services, rejected timetable chords',
  caption = 'Pinned legacy OSM service-data subset, not a fresh source-certified acquisition. Timetable adversary is synthetic, not the original Normandy feed.',
  attribution = 'OSM-derived paths © OpenStreetMap contributors (ODbL 1.0). Synthetic timetable controls carry no authentic timetable claim.',
  scope = 'Pinned legacy Paris OSM-positive paths; synthetic timetable/stop-chord negatives. This synthetic gate does not claim an original-feed reproduction or issue closure. Paris frequency profiles exercise unknown fallback.',
} = {}) {
  const built = await fixtureBuilder();
  const {metadata, probes, variants} = built;
  try {validateGeometryTestFrames(probes);} catch (error) {await built.dispose(); throw error;}
  const source = await readFile('styles/world.style.json', 'utf8');
  const layer = JSON.parse(source).layers.find(candidate => candidate.id === 'service-routes');
  assert.ok(layer, 'the production service line layer exists');
  layer.layout = {...layer.layout, visibility: 'visible'};
  const modes = ['equal', ...FREQUENCY_PROFILES, 'equal-return'];
  const renderer = process.env.ATLAS_MAPLIBRE_ASSETS ? new Map(await Promise.all(Object.entries({
    'maplibre-gl.js': '45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb',
    'maplibre-gl.css': 'ab1e70d59ec40465bae7e7030da2f3ccf28133fd502e62bd598eefbadfd7a732',
  }).map(async ([name, hash]) => {
    const body = await readFile(`${process.env.ATLAS_MAPLIBRE_ASSETS}/${name}`);
    assert.equal(digest(body), hash, `Pinned production MapLibre asset: ${name}`);
    return [`https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/${name}`, {body, contentType: name.endsWith('.js') ? 'text/javascript' : 'text/css'}];
  }))) : await rendererFixture();
  const tiles = new Map(variants.flatMap(variant => [...variant.tiles].map(([key, bytes]) => [`${variant.id}/${key}`, Buffer.from(bytes)])));
  const injected = injectParisAdversaryTiles(variants.find(variant => variant.id === 'present').tiles, built.forbiddenTiles);
  for (const [key, bytes] of injected) tiles.set(`injected/${key}`, Buffer.from(bytes));
  const browser = await browserLauncher(process.env.ATLAS_CHROMIUM_EXECUTABLE ? {executablePath: process.env.ATLAS_CHROMIUM_EXECUTABLE} : {}).catch(async error => {await built.dispose(); throw error;});
  const results = [], errors = [], sensitivity = [], baselines = new Map();
  let page;
  await mkdir('browser-review', {recursive: true});
  try {
    page = await browser.newPage({viewport: {width: 1400, height: 690}, deviceScaleFactor: 1});
    page.on('pageerror', error => errors.push(error.message));
    // Every request is deterministic. A new unhandled URL is an error, never a
    // dependency on a live railway provider or background acquisition endpoint.
    await page.route('**/*', async route => {
      const url = new URL(route.request().url()), asset = renderer.get(url.href);
      if (asset) return route.fulfill(asset);
      if (url.pathname === '/favicon.ico') return route.fulfill({status: 204, body: ''});
      if (url.pathname.endsWith('/service-frequency.mjs')) return route.fulfill({contentType: 'text/javascript', body: await readFile(new URL('../styles/service-frequency.mjs', import.meta.url))});
      if (url.pathname.includes('/paris-service-tiles/')) return route.fulfill({contentType: 'application/x-protobuf', body: tiles.get(url.pathname.split('/paris-service-tiles/')[1]) || Buffer.alloc(0)});
      if (url.pathname.endsWith('/paris-service-check.html')) return route.fulfill({contentType: 'text/html', body: `<!doctype html>
        <meta charset="utf-8"><title>Paris Service geometry acceptance</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css">
        <style>body{margin:0;background:#edf2f5;color:#1e3545;font:14px system-ui}header,footer{padding:14px 20px}h1{font-size:21px;margin:0 0 7px}#maps{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 16px}.panel{border:1px solid #bac9d1;background:white}h2{font-size:15px;padding:10px;margin:0}.map{height:470px}footer{font-size:12px;line-height:1.5}</style>
        <header><h1>${title}</h1><div id="profile"></div></header><main id="maps"></main>
        <footer>${caption}<br>Real production tiles, line layer and width profiles; blank background intentionally removes live-provider dependencies. Paris frequency profiles use the unknown-data fallback.<br>${attribution}</footer>
        <script src="https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>`});
      errors.push(`Unexpected network request: ${url.href}`);
      return route.abort();
    });
    await page.goto(`${root}/paris-service-check.html`);
    await page.evaluate(async ({probes, layer, root, clocks}) => {
      const frequency = await import('./service-frequency.mjs');
      const audit = window.parisAudit = {probes, layer, root, clocks, frequency, maps: [], errors: []};
      audit.settings = mode => mode.startsWith('equal') ? {serviceWidth: 'equal'}
        : /^h\d\d$/.test(mode) ? {serviceWidth: 'frequency', frequencyPeriod: 'hour', frequencyHour: Number(mode.slice(1))}
          : {serviceWidth: 'frequency', frequencyPeriod: ['am', 'pm'].includes(mode) ? 'peak' : mode, peakPhase: mode};
      audit.idle = map => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Paris service tiles did not settle')), 30000);
        map.once('idle', () => {clearTimeout(timer); resolve();}); map.triggerRepaint();
      });
      audit.setVariant = async variant => {
        for (const {map} of audit.maps) {
          if (map.getLayer('service-routes')) map.removeLayer('service-routes');
          if (map.getSource('serviceRoutes')) map.removeSource('serviceRoutes');
          map.addSource('serviceRoutes', {type: 'vector', tiles: [`${root}/paris-service-tiles/${variant}/{z}/{x}/{y}`], minzoom: 7, maxzoom: 12});
          map.addLayer(structuredClone(layer));
        }
        await Promise.all(audit.maps.map(({map}) => audit.idle(map)));
      };
      audit.observe = async (mode, variant) => {
        const clock = audit.clocks[variant === 'injected' ? 'present' : variant] || (variant === 'expired' ? '2027-01-07T12:00:00Z' : '2026-10-07T12:00:00Z');
        const paint = frequency.serviceFrequencyPaint(audit.settings(mode), Date.parse(clock));
        for (const {map} of audit.maps) for (const [key, value] of [['line-width', paint.width], ['line-offset', paint.offset], ['line-opacity', paint.opacity]]) map.setPaintProperty('service-routes', key, value);
        await Promise.all(audit.maps.map(({map}) => audit.idle(map)));
        return audit.maps.map(({probe, map}) => {
          const features = map.queryRenderedFeatures({layers: ['service-routes']});
          // Include real decoded geometry and shared-track membership, not only
          // relation prefixes. Exact signatures are compared across variants.
          const geometry = [...new Set(features.map(f => JSON.stringify({id: f.properties.id, ref: f.properties.ref, i: f.properties.i, n: f.properties.n, slot: f.properties.slot, geometry: f.geometry})))].sort();
          const widths = [...new Set(features.map(f => JSON.stringify({id: f.properties.id, i: f.properties.i, n: f.properties.n, width: f.layer.paint['line-width'], offset: f.layer.paint['line-offset']})))].sort();
          const positivePoint = map.project(probe.positive.point);
          const hits = map.queryRenderedFeatures([[positivePoint.x - 12, positivePoint.y - 12], [positivePoint.x + 12, positivePoint.y + 12]], {layers: ['service-routes']});
          const nominated = hits.filter(f => probe.positive.relationIds.some(id => String(f.properties.id).split(/[^0-9]+/).includes(String(id))));
          const canvas = map.getCanvas(), copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
          const ctx = copy.getContext('2d'); ctx.drawImage(canvas, 0, 0);
          const pixels = point => {
            if (point.x < 12 || point.y < 12 || point.x > canvas.width - 12 || point.y > canvas.height - 12) return null;
            const data = ctx.getImageData(Math.round(point.x) - 10, Math.round(point.y) - 10, 21, 21).data;
            let count = 0; for (let i = 0; i < data.length; i += 4) if (Math.min(data[i], data[i + 1], data[i + 2]) < 247) count++;
            return count;
          };
          const negative = probe.negativeProbes.filter(probe => !probe.zooms || probe.zooms.includes(map.getZoom())).map(({id, point}) => {
            const at = map.project(point), inside = at.x >= 2 && at.y >= 2 && at.x <= canvas.width - 2 && at.y <= canvas.height - 2;
            const radius = 2;
            const hits = inside ? map.queryRenderedFeatures([[at.x - radius, at.y - radius], [at.x + radius, at.y + radius]], {layers: ['service-routes']}) : [];
            return {id, inside, hits: hits.map(f => f.properties.id), pass: inside && hits.length === 0};
          });
          const positivePixels = pixels(positivePoint);
          const positive = {ids: [...new Set(nominated.map(f => f.properties.id))].sort(), pixels: positivePixels, pass: nominated.length > 0 && positivePixels > 0};
          const unknownFallback = features.every(f => Number(f.properties.frequency_until || 0) === 0 && !Object.keys(f.properties).some(k => /^frequency_(am|pm|offpeak|overnight|h\d\d)$/.test(k)));
          const z = map.getZoom(), expectedWidth = z <= 12 ? 2 + (Math.max(7, z) - 7) * 0.3 : 3.5 + (Math.min(16, z) - 12) * 0.375;
          const expectedOpacity = mode.startsWith('equal') ? 1 : 0.45;
          const fallbackPaint = features.every(f => Math.abs(f.layer.paint['line-width'] - expectedWidth) < 1e-5
            && Math.abs(f.layer.paint['line-offset'] - (f.properties.i - (f.properties.n - 1) / 2) * expectedWidth) < 1e-5
            && Math.abs(f.layer.paint['line-opacity'] - expectedOpacity) < 1e-5);
          return {terminal: probe.id, zoom: map.getZoom(), variant, mode, clock, featureCount: features.length, positive, negative, unknownFallback, fallbackPaint, expectedWidth, expectedOpacity, geometry, widths,
            pass: positive.pass && negative.length > 0 && negative.every(value => value.pass) && unknownFallback && fallbackPaint};
        });
      };
    }, {probes: probes.map(probe => ({...probe, viewCenters: Object.fromEntries([9, 12, 16].map(zoom => [zoom, geometryTestCenter(probe, zoom)]))})), layer, root, clocks: Object.fromEntries(variants.map(variant => [variant.id, variant.clock]))});
    for (const zoom of [9, 12, 16]) {
      await page.evaluate(async zoom => {
        const audit = window.parisAudit;
        for (const {map} of audit.maps) map.remove();
        audit.maps = []; document.querySelector('#maps').innerHTML = '';
        for (const probe of audit.probes) {
          const section = document.createElement('section'); section.className = 'panel';
          section.innerHTML = `<h2>${probe.label}</h2><div class="map" id="${probe.id}"></div>`; document.querySelector('#maps').append(section);
          const map = new maplibregl.Map({container: probe.id, center: probe.viewCenters[zoom], zoom, interactive: false, attributionControl: false, fadeDuration: 0,
            canvasContextAttributes: {preserveDrawingBuffer: true}, style: {version: 8, transition: {duration: 0, delay: 0}, sources: {}, layers: [{id: 'background', type: 'background', paint: {'background-color': '#ffffff'}}]}});
          map.on('error', event => audit.errors.push(`${probe.id}: ${event.error?.message || event.error}`)); audit.maps.push({probe, map});
        }
        await Promise.all(audit.maps.map(({map}) => audit.idle(map)));
      }, zoom);
      for (const {id: variant} of variants) {
        await page.evaluate(variant => window.parisAudit.setVariant(variant), variant);
        for (const mode of modes) {
          const rows = await page.evaluate(async ({mode, variant}) => {
            document.querySelector('#profile').textContent = `Zoom ${window.parisAudit.maps[0].map.getZoom()} · timetable ${variant} · ${mode}`;
            return window.parisAudit.observe(mode, variant);
          }, {mode, variant});
          for (const row of rows) {
            const key = `${row.terminal}/${zoom}`, reference = baselines.get(key);
            const hashes = {geometry: digest(row.geometry.join('\n')), widths: digest(row.widths.join('\n'))};
            if (!reference) {assert.equal(variant, 'absent'); assert.equal(mode, 'equal'); baselines.set(key, hashes);}
            row.geometryUnchanged = !reference || hashes.geometry === reference.geometry;
            row.widthsAndOffsetsUnchanged = !reference || hashes.widths === reference.widths;
            row.pass &&= row.geometryUnchanged && row.widthsAndOffsetsUnchanged;
            delete row.geometry; delete row.widths; row.hashes = hashes; results.push(row);
          }
          if ((variant === 'present' && ['equal', 'am', 'h12', 'equal-return'].includes(mode)) || (variant !== 'present' && mode === 'equal')) await page.screenshot({path: `browser-review/${reportPrefix}-z${zoom}-${variant}-${mode}.png`, fullPage: true});
        }
      }
      // A mutation probe goes through the exact same source, production layer,
      // projection and forbidden-probe assertion. It must fail while the real
      // positive paths remain present, demonstrating a non-vacuous rejection.
      await page.evaluate(() => window.parisAudit.setVariant('injected'));
      for (const mode of ['equal', 'am']) {
        const rows = await page.evaluate(mode => {
          document.querySelector('#profile').textContent = `Zoom ${window.parisAudit.maps[0].map.getZoom()} · FORBIDDEN CHORD MUTATION (must be rejected) · ${mode}`;
          return window.parisAudit.observe(mode, 'injected');
        }, mode);
        for (const row of rows) sensitivity.push({terminal: row.terminal, zoom, mode, positive: row.positive, negative: row.negative,
          rejected: !row.pass && row.positive.pass && row.negative.length > 0 && row.negative.every(probe => probe.inside && probe.hits.length > 0)});
      }
      await page.screenshot({path: `browser-review/${reportPrefix}-z${zoom}-forbidden-injection.png`, fullPage: true});
    }
  } finally {
    if (page && !page.isClosed()) errors.push(...await page.evaluate(() => window.parisAudit?.errors || []).catch(error => [`Could not read browser diagnostics: ${error.message}`]));
    await writeFile(`browser-review/${reportPrefix}-geometry-results.json`, JSON.stringify({schema: 1, browser: browser.version(), renderer: 'MapLibre 5.24.0',
      scope,
      metadata, productionStyleSha256: digest(source), fixtureVariants: variants.map(({id, manifest, assemblyManifest, staleOutputsRemoved, inputSha256, clock}) => ({id, manifest, assemblyManifest, staleOutputsRemoved, inputSha256, clock})),
      expected: probes.length * 3 * variants.length * modes.length, total: results.length, passed: results.filter(row => row.pass).length, errors, sensitivity, results}, null, 2) + '\n');
    await browser.close(); await built.dispose();
  }
  assert.deepEqual(errors, [], 'no browser errors or live-provider requests');
  assert.equal(results.length, probes.length * 3 * variants.length * modes.length, 'complete Paris terminal/zoom/timetable/profile matrix');
  assert.equal(results.filter(row => !row.pass).length, 0, `Paris acceptance failed: ${JSON.stringify(results.filter(row => !row.pass).slice(0, 3))}`);
  assert.equal(sensitivity.length, probes.length * 3 * 2);
  assert.ok(sensitivity.every(row => row.rejected), `Forbidden chord mutation must be rejected: ${JSON.stringify(sensitivity.filter(row => !row.rejected))}`);
  console.log(`${reportPrefix} geometry: ${results.length} cases passed; ${sensitivity.length} forbidden-chord mutations rejected; JSON and screenshots saved.`);
  return {cases: results.length, sensitivity: sensitivity.length};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkParisServiceGeometryBrowser();
