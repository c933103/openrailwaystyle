// Render actual generated service tiles with the production line layer.
// This is synthetic regression coverage, not a live OSM coverage audit.
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchBrowser} from './browser.mjs';
import {rendererFixture} from './browser-renderer-fixture.mjs';
import {serviceGeometryBrowserFixtures} from './service-geometry-browser-fixture.mjs';
import {FREQUENCY_PROFILES} from '../styles/service-frequency.mjs';

export async function checkServiceGeometryBrowser({root = process.env.ATLAS_TEST_URL || 'http://127.0.0.1:4173'} = {}) {
  const fixtures = serviceGeometryBrowserFixtures();
  const style = JSON.parse(await readFile('styles/world.style.json', 'utf8'));
  const layer = style.layers.find(candidate => candidate.id === 'service-routes');
  assert.ok(layer, 'production service line layer exists');
  // The shipped style starts outside Service mode; mirror that view's toggle.
  layer.layout = {...layer.layout, visibility: 'visible'};
  const modes = ['equal', ...FREQUENCY_PROFILES, 'expired', 'unknown'];
  const tiles = new Map(fixtures.flatMap(fixture => [
    ...[...fixture.tiles].map(([key, bytes]) => [`${fixture.id}/${key}`, Buffer.from(bytes)]),
    ...[...fixture.unknownTiles].map(([key, bytes]) => [`${fixture.id}-unknown/${key}`, Buffer.from(bytes)]),
  ]));
  const renderer = await rendererFixture(root.replace(/\/?$/, '/'));
  const browser = await launchBrowser();
  const results = [], errors = [];
  let browserVersion;
  await mkdir('browser-review', {recursive: true});
  try {
    browserVersion = browser.version();
    const page = await browser.newPage({viewport: {width: 1200, height: 960}, deviceScaleFactor: 1});
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/vendor/maplibre-gl-5.24.0.*', route => {
      const asset = renderer.get(route.request().url());
      return asset ? route.fulfill(asset) : route.fallback();
    });
    await page.route('**/audit-service-geometry/**', route => {
      const key = new URL(route.request().url()).pathname.split('/audit-service-geometry/')[1];
      return route.fulfill({contentType: 'application/x-protobuf', body: tiles.get(key) || Buffer.alloc(0)});
    });
    await page.route('**/service-geometry-check.html', route => route.fulfill({contentType: 'text/html', body: `<!doctype html>
      <meta charset="utf-8"><title>Service geometry rendering audit</title>
      <link rel="stylesheet" href="vendor/maplibre-gl-5.24.0.css">
      <style>body{margin:0;background:#eef2f6;color:#172d43;font:14px system-ui}header{padding:16px 22px}h1{font-size:21px;margin:0 0 8px}#maps{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 16px}.panel{background:white;border:1px solid #ccd5df;border-radius:5px;overflow:hidden}h2{font-size:13px;margin:0;padding:8px 12px}.map{height:160px}footer{padding:12px 22px;font-size:12px}</style>
      <header><h1>Service geometry: actual generated vector tiles</h1><div id="profile"></div></header><main id="maps"></main>
      <footer>Two shared synthetic services. Production MapLibre service layer. White gaps are intentional withheld geometry. No live OSM or real timetable validation is claimed.</footer>
      <script src="vendor/maplibre-gl-5.24.0.js"></script>`}));
    await page.goto(`${root}/service-geometry-check.html`);
    await page.evaluate(async ({fixtures, layer, root}) => {
      const frequency = await import('./service-frequency.mjs');
      const now = Date.parse('2026-10-07T12:00:00Z');
      const audit = window.geometryAudit = {fixtures, layer, root, frequency, now, maps: [], errors: []};
      audit.settings = mode => mode === 'equal' ? {serviceWidth: 'equal'}
        : /^h\d\d$/.test(mode) ? {serviceWidth: 'frequency', frequencyPeriod: 'hour', frequencyHour: Number(mode.slice(1))}
          : {serviceWidth: 'frequency', frequencyPeriod: ['am', 'pm', 'expired', 'unknown'].includes(mode) ? 'peak' : mode, peakPhase: mode === 'pm' ? 'pm' : 'am'};
      audit.clock = mode => mode === 'expired' ? now + 90 * 86400000 : now;
      audit.idle = map => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Service geometry rendering timed out')), 30000);
        map.once('idle', () => {clearTimeout(timer); resolve();});
        map.triggerRepaint();
      });
    }, {fixtures: fixtures.map(({tiles: _tiles, unknownTiles: _unknownTiles, ...fixture}) => fixture), layer, root});
    for (const zoom of [12, 16]) {
      await page.evaluate(async zoom => {
        const audit = window.geometryAudit;
        for (const {map} of audit.maps) map.remove();
        audit.maps = [];
        document.querySelector('#maps').innerHTML = '';
        for (const fixture of audit.fixtures.filter(fixture => fixture.zoom === zoom)) {
          const panel = document.createElement('section');
          panel.className = 'panel';
          panel.innerHTML = `<h2>${fixture.label}</h2><div class="map" id="${fixture.id}"></div>`;
          document.querySelector('#maps').append(panel);
          const map = new maplibregl.Map({container: fixture.id, center: fixture.points[2], zoom,
            interactive: false, attributionControl: false, fadeDuration: 0,
            canvasContextAttributes: {preserveDrawingBuffer: true},
            style: {version: 8, transition: {duration: 0, delay: 0},
              sources: {serviceRoutes: {type: 'vector', tiles: [`${audit.root}/audit-service-geometry/${fixture.id}/{z}/{x}/{y}`], minzoom: 7, maxzoom: 12}},
              layers: [{id: 'background', type: 'background', paint: {'background-color': '#ffffff'}}, structuredClone(audit.layer)]},
          });
          map.on('error', event => audit.errors.push(`${fixture.id}: ${event.error?.message || event.error}`));
          audit.maps.push({fixture, map});
        }
        await Promise.all(audit.maps.map(({map}) => audit.idle(map)));
      }, zoom);
      for (const mode of modes) {
        const rows = await page.evaluate(async mode => {
          const audit = window.geometryAudit, {serviceFrequencyPaint, nearestServiceFeature} = audit.frequency;
          const paint = serviceFrequencyPaint(audit.settings(mode), audit.clock(mode));
          // Switch to genuinely unenriched tiles so both paint and picking
          // run their production missing-property fallback in frequency mode.
          if (mode === 'unknown') for (const {fixture, map} of audit.maps) {
            // Recreate the source rather than setTiles: an idle event can
            // precede setTiles' asynchronous reload and leave cached enriched
            // features available to queryRenderedFeatures for this frame.
            map.removeLayer('service-routes');
            map.removeSource('serviceRoutes');
            map.addSource('serviceRoutes', {type: 'vector',
              tiles: [`${audit.root}/audit-service-geometry/${fixture.id}-unknown/{z}/{x}/{y}`], minzoom: 7, maxzoom: 12});
            map.addLayer(structuredClone(audit.layer));
          }
          const effective = paint;
          for (const {map} of audit.maps) for (const [property, value] of [
            ['line-width', effective.width], ['line-offset', effective.offset], ['line-opacity', effective.opacity],
          ]) map.setPaintProperty('service-routes', property, value);
          await Promise.all(audit.maps.map(({map}) => audit.idle(map)));
          document.querySelector('#profile').textContent = `Zoom ${audit.maps[0].fixture.zoom} · ${mode === 'equal' ? 'Equal width' : `Frequency: ${mode}`} · red / blue shared-service separation`;
          return audit.maps.map(({fixture, map}) => {
            const canvas = map.getCanvas(), copy = document.createElement('canvas');
            copy.width = canvas.width; copy.height = canvas.height;
            const context = copy.getContext('2d'); context.drawImage(canvas, 0, 0);
            const density = canvas.width / canvas.clientWidth, checks = [], picked = [];
            for (let segment = 0; segment < 4; segment++) {
              const [a, b] = [fixture.points[segment], fixture.points[segment + 1]];
              const midpoint = [(a[0] + b[0]) / 2, a[1]], point = map.project(midpoint);
              const x = Math.round(point.x * density), y = Math.round(point.y * density), radius = Math.round(18 * density);
              const data = context.getImageData(x - 3, y - radius, 7, 2 * radius + 1).data;
              let red = 0, blue = 0;
              for (let index = 0; index < data.length; index += 4) {
                if (data[index] - data[index + 2] > 15) red++;
                if (data[index + 2] - data[index] > 15) blue++;
              }
              const hits = map.queryRenderedFeatures([[point.x - 2, point.y - 18], [point.x + 2, point.y + 18]], {layers: ['service-routes']});
              const refs = [...new Set(hits.map(feature => feature.properties.ref))].sort();
              const expected = Boolean(fixture.expected[segment]);
              const unknownPropertiesAbsent = mode !== 'unknown' || hits.every(feature => !Object.keys(feature.properties).some(key => key.startsWith('frequency_')));
              checks.push({segment, expected, redPixels: red, bluePixels: blue, renderedRefs: refs, unknownPropertiesAbsent,
                pass: unknownPropertiesAbsent && (expected ? red > 0 && blue > 0 && refs.join(',') === '1,2' : red === 0 && blue === 0 && refs.length === 0)});
              if (!expected || segment !== 0) continue;
              for (const ref of ['1', '2']) {
                const feature = hits.find(feature => feature.properties.ref === ref);
                if (!feature) {picked.push({ref, pass: false, reason: 'Expected service missing'}); continue;}
                const properties = feature.properties;
                const lines = feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
                const line = lines.find(line => line[0][0] <= midpoint[0] && line.at(-1)[0] >= midpoint[0]) || lines[0];
                // Use decoded latitude to account for vector-tile quantization.
                const center = map.project([midpoint[0], line[0][1]]);
                const fallback = ['equal', 'expired', 'unknown'].includes(mode), scale = fixture.zoom === 16 ? 5 / 3.5 : 1;
                const expectedWidth = (fallback ? 3.5 : properties[`frequency_width_${mode}`]) * scale;
                const expectedOffset = (fallback ? (properties.i - (properties.n - 1) / 2) * 3.5 : properties[`frequency_offset_${mode}`]) * scale;
                const at = {x: center.x, y: center.y + expectedOffset};
                const drawn = map.queryRenderedFeatures([at.x, at.y], {layers: ['service-routes']});
                const chosen = nearestServiceFeature(drawn, at, point => map.project(point), fixture.zoom,
                  audit.settings(mode), audit.clock(mode));
                const width = feature.layer.paint['line-width'], offset = feature.layer.paint['line-offset'];
                picked.push({ref, picked: chosen?.properties.ref, width, expectedWidth, offset, expectedOffset, n: properties.n, i: properties.i,
                  pass: chosen?.properties.ref === ref && Math.abs(width - expectedWidth) < 1e-5 && Math.abs(offset - expectedOffset) < 1e-5 && properties.n === 2});
              }
            }
            return {fixture: fixture.id, zoom: fixture.zoom, mode, pass: checks.every(check => check.pass) && picked.every(check => check.pass), checks, picked};
          });
        }, mode);
        results.push(...rows);
        if (['equal', 'am', 'offpeak', 'overnight', 'h12', 'expired', 'unknown'].includes(mode)) {
          await page.screenshot({path: `browser-review/service-geometry-z${zoom}-${mode}.png`, fullPage: true});
        }
      }
    }
    errors.push(...await page.evaluate(() => window.geometryAudit.errors));
    assert.equal(results.length, fixtures.length * modes.length, 'all geometry/profile/zoom cases were checked');
  } finally {
    await writeFile('browser-review/service-geometry-results.json', JSON.stringify({
      schema: 1, browser: browserVersion, renderer: 'MapLibre 5.24.0',
      scope: 'Synthetic source observations; real buildTiles vector data and production service line style, widths, offsets, and picking. Not live OSM validation.',
      expectedCases: fixtures.length * modes.length, total: results.length,
      passed: results.filter(result => result.pass).length, errors, results,
    }, null, 2));
    await browser.close();
  }
  const failed = results.filter(result => !result.pass);
  assert.deepEqual(errors, [], 'no browser or MapLibre errors');
  assert.equal(failed.length, 0, `Service geometry rendering failures: ${JSON.stringify(failed.slice(0, 3))}`);
  console.log(`Service geometry: ${results.length} native/overscaled geometry and width-profile cases passed; screenshots and JSON saved.`);
  return {cases: results.length};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkServiceGeometryBrowser();
