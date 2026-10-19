// Actual app/profile/measure UI and PNG decoding, with synthetic providers only.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';
import {depthFixturePng} from './bathymetry-browser-fixture.mjs';
const base = (process.env.MAP_BASE_URL || 'http://127.0.0.1:4173/').replace(/\/?$/, '/');
const browser = await launchBrowser({...(process.env.BROWSER_PATH ? {executablePath: process.env.BROWSER_PATH} : {})});
const errors = [];
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 800}}), page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await installEmptyMapProviders(context, base);
  await context.route('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/**', route => {
    const [,z,x] = /\/(\d+)\/(\d+)\/\d+\.png$/.exec(new URL(route.request().url()).pathname);
    return route.fulfill({contentType: 'image/png', body: depthFixturePng(Number(z), Number(x))});
  });
  await page.addInitScript(() => {
    const original = window.fetch;
    window.terrainFixture = {mode: 'partial', calls: []};
    window.fetch = (input, options) => {
      const url = String(input?.url || input), match = /elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/.exec(url);
      if (!match) return original(input, options);
      const fixture = window.terrainFixture, [,z,x] = match;
      const record = {url, aborted: false, blocked: fixture.mode === 'stall' || fixture.mode === 'partial' && z === '14' && x === '8192'};
      fixture.calls.push(record); options?.signal?.addEventListener('abort', () => {record.aborted = true;});
      // Non-cooperative headers: the application, not a fixture abort handler,
      // must settle this request. Healthy reads still decode real PNG bytes.
      if (record.blocked) return new Promise(resolve => {record.finish = () => resolve(new Response(new Uint8Array()));});
      return original(input, options);
    };
  });
  await page.goto(base + '?relief=0&inactive=0&transport=0#13/0.55/0', {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => document.body.dataset.mapReady === 'true', null, {timeout: 60000});
  await page.evaluate(async () => {window.testMap = (await import(document.querySelector('script[type="module"]').src)).map;});
  const draw = async lat => {
    await page.evaluate(lat => {
      document.querySelector('[data-draw="line"]').click();
      for (const lng of [-.04, .04]) testMap.fire('click', {lngLat: {lng, lat}, point: testMap.project([lng, lat])});
      document.getElementById('draw-finish').click(); document.getElementById('draw-close').click();
      testMap.jumpTo({center: [0, lat]});
    }, lat);
    await page.waitForFunction(lat => {
      const p = testMap.project([0, lat]);
      return testMap.queryRenderedFeatures([[p.x - 3, p.y - 3], [p.x + 3, p.y + 3]], {layers: ['drawing-line']}).length > 0;
    }, lat, {timeout: 15000});
  };
  const open = lat => page.evaluate(lat => testMap.fire('click', {lngLat: {lng: 0, lat}, point: testMap.project([0, lat])}), lat);
  const panel = page.locator('#detail-content');
  await draw(.55); await open(.55);
  await page.waitForFunction(() => document.getElementById('detail-content').textContent.includes('Finding heights'));
  await page.waitForFunction(() => document.getElementById('detail-content').textContent.includes('Incomplete elevation profile'), null, {timeout: 30000});
  assert.equal(await panel.locator('polyline.profile-line').count(), 2, 'the failed middle tile remains a real chart gap');
  const partial = await page.evaluate(() => ({calls: terrainFixture.calls.map(({url, blocked, aborted}) => ({url, blocked, aborted})), text: document.getElementById('detail-content').textContent}));
  assert.ok(partial.calls.some(c => c.blocked)); assert.ok(partial.calls.filter(c => c.blocked).every(c => c.aborted));
  await mkdir('browser-review', {recursive: true});
  await page.screenshot({path: 'browser-review/terrain-deadline-partial.png'});
  await page.locator('#details-close').click();
  await page.evaluate(() => {terrainFixture.mode = 'healthy';}); await open(.55);
  await page.waitForFunction(() => document.querySelector('#detail-content svg') && !document.getElementById('detail-content').textContent.includes('Finding heights'));
  assert.doesNotMatch(await panel.textContent(), /Incomplete|could not load/);
  assert.equal(await panel.locator('polyline.profile-line').count(), 1);
  await page.locator('#details-close').click();

  await draw(.85); await page.evaluate(() => {terrainFixture.mode = 'stall'; terrainFixture.calls = [];}); await open(.85);
  await page.waitForFunction(() => terrainFixture.calls.some(c => c.blocked));
  await page.locator('#details-close').click();
  await page.waitForFunction(() => terrainFixture.calls.filter(c => c.blocked).every(c => c.aborted));
  await page.evaluate(() => {terrainFixture.mode = 'healthy';}); await open(.85);
  await page.waitForFunction(() => document.querySelector('#detail-content svg') && !document.getElementById('detail-content').textContent.includes('Finding heights'));
  const recovered = await panel.textContent();
  await page.evaluate(() => {for (const c of terrainFixture.calls) c.finish?.();});
  assert.equal(await panel.textContent(), recovered, 'late cancelled responses cannot replace the recovered profile');
  await page.locator('#details-close').click();

  await page.evaluate(() => {
    terrainFixture.mode = 'stall'; terrainFixture.calls = [];
    document.querySelector('button[title="Measure"]').click();
    document.querySelector('[data-measure="distance"]').click();
    for (const lat of [1.1, 1.2]) testMap.fire('click', {lngLat: {lng: .1, lat}, point: testMap.project([.1, lat])});
    testMap.fire('dblclick', {preventDefault() {}});
  });
  await page.waitForFunction(() => document.getElementById('measure-status').textContent.includes('Finding heights'));
  await page.waitForFunction(() => document.getElementById('measure-status').textContent.includes('End-to-end heights unavailable'), null, {timeout: 30000});
  assert.equal(await page.locator('#measure-retry').isVisible(), true);
  await page.evaluate(() => {terrainFixture.mode = 'healthy'; document.getElementById('measure-retry').click();});
  await page.waitForFunction(() => document.getElementById('measure-status').textContent.includes('End to end:'));
  await page.screenshot({path: 'browser-review/terrain-deadline-recovered.png'});
  assert.deepEqual(errors, []);
  console.log('PASS: real 20 s elevation deadlines, explicit profile gaps, close cancellation, late-response safety, measurement retry and PNG recovery; all providers synthetic.');
} finally {await browser.close();}
