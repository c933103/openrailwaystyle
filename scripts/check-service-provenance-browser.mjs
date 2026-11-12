// Actual app, generated MVTs and MapLibre picking; synthetic map providers only.
import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {serveAtlasAppFixture} from './atlas-app-browser-fixture.mjs';
import {buildTiles} from './service-routes.mjs';
import {serviceProvenanceFixture} from './service-provenance-fixture.mjs';
import {waitUntil} from './wait-until.mjs';

const server = await serveAtlasAppFixture(), base = server.origin + '/';
let browser;
try {
  const tiles = buildTiles(serviceProvenanceFixture());
  browser = await launchBrowser();
  const context = await browser.newContext({viewport: {width: 1100, height: 800}});
  await installEmptyMapProviders(context, base);
  const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url), 'utf8'));
  style.sources.stationMajor.data = {type: 'FeatureCollection', features: []};
  style.sources.serviceRoutes = {type: 'vector', tiles: [base + 'provenance-tiles/{z}/{x}/{y}'], minzoom: 7, maxzoom: 12};
  await context.route('**/world.style.json*', route => route.fulfill({json: style}));
  await context.route('**/provenance-tiles/**', route => {
    const key = new URL(route.request().url()).pathname.split('/provenance-tiles/')[1];
    return route.fulfill({contentType: 'application/x-protobuf', body: Buffer.from(tiles.get(key) || [])});
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '?mode=service&relief=0&serviceWidth=equal#14/.04/.035', {waitUntil: 'domcontentloaded'});
  await page.waitForSelector('body[data-map-ready="true"]');
  await page.evaluate(async () => window.provenanceMap = (await import(document.querySelector('script[type="module"]').src)).map);
  const links = scope => page.locator(`[data-relation-scope="${scope}"] a`).evaluateAll(items => items.map(item => item.href));
  const urls = ids => ids.map(id => `https://www.openstreetmap.org/relation/${id}`);
  const open = async (point, ref, segment) => {
    if (await page.locator('#details').isVisible()) await page.locator('#details-close').click();
    await page.evaluate(point => provenanceMap.jumpTo({center: point, zoom: 15}), point);
    await waitUntil(page, () => provenanceMap.loaded() && provenanceMap.areTilesLoaded() && !provenanceMap.isMoving());
    const screen = await page.evaluate(({point, ref, segment}) => {
      const features = provenanceMap.querySourceFeatures('serviceRoutes', {sourceLayer: 'service_routes'});
      const feature = features.find(f => f.properties.ref === ref && f.properties.segment_relation_ids === JSON.stringify(segment));
      if (!feature) throw new Error('Expected generated segment is absent from loaded MVTs');
      const p = provenanceMap.project(point);
      // The eastbound fixture is offset by its actual production slot. Use
      // the same public paint calculation as the app's nearest-service pick.
      return import('./service-frequency.mjs').then(({frequencyOffset}) => {
        p.y += frequencyOffset(feature.properties, provenanceMap.getZoom(), {serviceWidth: 'equal'});
        return {x: p.x, y: p.y};
      });
    }, {point, ref, segment});
    await page.mouse.click(screen.x, screen.y);
    await page.locator('#details').waitFor({state: 'visible'});
    assert.deepEqual(await links('segment'), urls(segment));
  };
  await open([.055, .04], 'A', [20]);
  assert.deepEqual(await links('group'), urls([10, 20, 30]));
  assert.match(await page.locator('#detail-content').textContent(), /Relation 10 \(display identity\)/);
  assert.match(await page.locator('#detail-content').textContent(), /does not establish identical stops, timetable matches or frequency/);
  // Language is a main-panel control: opening Settings hides that panel.
  // Change the selection through the visible UI and wait for an actual detail
  // redraw, rather than accidentally accepting the old links before reload.
  assert.equal(await page.locator('#language').isVisible(), true);
  const nextLanguage = (await page.locator('#language').inputValue()) === 'en' ? 'de' : 'en';
  await page.evaluate(() => window.provenanceDetailBeforeRedraw = document.querySelector('#detail-content').firstElementChild);
  await page.selectOption('#language', nextLanguage);
  await waitUntil(page, () => !provenanceDetailBeforeRedraw.isConnected && provenanceMap.loaded() && provenanceMap.areTilesLoaded());
  assert.deepEqual(await links('segment'), urls([20]), 'language redraw keeps the clicked segment');
  assert.deepEqual(await links('group'), urls([10, 20, 30]), 'language redraw keeps the full group');
  await open([.055, .05], 'A', [30]);
  assert.deepEqual(await links('group'), urls([10, 20, 30]));
  await open([.035, .04], 'A', [10, 20, 30]);
  assert.deepEqual(await links('group'), urls([10, 20, 30]));
  await open([.015, .065], 'B', [40]);
  assert.deepEqual(await links('group'), urls([40]), 'unrelated nearby service has no A identities');
  await open([.055, .04], 'A', [20]);
  await mkdir('browser-review', {recursive: true});
  await page.screenshot({path: 'browser-review/service-provenance.png'});
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS: generated MVTs, direction and branch details, shared-track picking, unrelated service, close/reopen and language redraw');
} finally {
  try { if (browser) await browser.close(); } finally { await server.close(); }
}
