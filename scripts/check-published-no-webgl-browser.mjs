// Exercise the published application with real Firefox and with hardware
// WebGL disabled. First-party application files and data are fetched from the
// selected deployment; external provider responses are synthetic and no
// provider traffic is sent. The browser profile and drawings are disposable.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {launchBrowser} from './browser.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';

const base = (process.env.MAP_BASE_URL || 'http://127.0.0.1:4173/').replace(/\/?$/, '/');
const destination = new URL('?mode=infrastructure&language=en&relief=0&transport=0#9/35.68/139.76', base).href;
const browser = await launchBrowser({engine: 'firefox', executablePath: process.env.FIREFOX_EXECUTABLE,
  firefoxUserPrefs: {'webgl.disabled': true}});
try {
  const context = await browser.newContext({serviceWorkers: 'block', viewport: {width: 1220, height: 800}});
  await installEmptyMapProviders(context, base, {firstParty: 'network'});
  await context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    window.atlasCheckGL = [];
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      const context = getContext.call(this, type, ...args);
      if (['webgl', 'webgl2', 'experimental-webgl'].includes(type))
        window.atlasCheckGL.push({type, created: Boolean(context)});
      return context;
    };
  });
  const page = await context.newPage(), assetRequests = [], pageErrors = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.href.startsWith(base) && /\/vendor\/maplibre-gl[-.]/.test(url.pathname))
      assetRequests.push(url.pathname);
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  const canvas = page.locator('canvas.atlas-flat-preview');
  const center = () => page.locator('#map').getAttribute('data-flat-center');
  async function readyCanvas() {
    await canvas.waitFor({timeout: 30000});
    await page.waitForFunction(() => {
      const c = document.querySelector('canvas.atlas-flat-preview');
      return c?.width && c?.height && c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] === 255;
    }, null, {timeout: 20000});
    assert.equal(await page.locator('canvas.maplibregl-canvas').count(), 0);
  }
  async function openSettings() {
    const settings = page.locator('#settings-open');
    if (!(await settings.isVisible())) await page.locator('#controls-open').click();
    await settings.click();
  }
  await page.goto(destination, {waitUntil: 'domcontentloaded'});
  await readyCanvas();
  const blockedContexts = await page.evaluate(() => window.atlasCheckGL);
  assert.ok(blockedContexts.length > 0 && blockedContexts.every(probe => !probe.created),
    'Firefox must actually reject every WebGL context and automatically show Canvas');
  assert.equal(await page.evaluate(() => localStorage.getItem('atlas_disable_webgl')), null);
  const original = await center();
  assert.ok(original);
  await canvas.press('ArrowRight');
  await page.waitForFunction(before => document.querySelector('#map').dataset.flatCenter !== before, original);
  const panned = await center();
  await openSettings();
  const toggle = page.locator('#disable-webgl');
  assert.equal(await toggle.isChecked(), false);
  const count = assetRequests.length;
  await Promise.all([page.waitForEvent('load'), toggle.click()]);
  await readyCanvas();
  assert.equal(await page.evaluate(() => localStorage.getItem('atlas_disable_webgl')), '1');
  assert.deepEqual(await page.evaluate(() => window.atlasCheckGL), []);
  assert.equal(assetRequests.length, count, 'opt-out reload must not request MapLibre JS or CSS');
  const after = (await center()).split(',').map(Number), before = panned.split(',').map(Number);
  assert.ok(after.length === 2 && after.every((value, i) => Math.abs(value - before[i]) < 0.0001),
    'the setting must preserve the current panned map');
  await page.getByRole('button', {name: 'Drawing tools', exact: true}).click();
  await page.locator('[data-draw="point"]').click();
  const point = await canvas.evaluate(el => {
    const r = el.getBoundingClientRect();
    return [r.left + r.width * .67, r.top + r.height * .28];
  });
  await page.mouse.click(...point);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('openrailwayatlas-drawing') || 'null')?.features?.length === 1);
  await page.reload({waitUntil: 'domcontentloaded'});
  await readyCanvas();
  assert.deepEqual(await page.evaluate(() => window.atlasCheckGL), []);
  assert.equal(assetRequests.length, count, 'subsequent Canvas reload must not request MapLibre');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('openrailwayatlas-drawing')).features.length), 1);
  await openSettings();
  assert.equal(await toggle.isChecked(), true);
  assert.deepEqual(pageErrors, []);
  await mkdir('browser-review', {recursive: true});
  await page.screenshot({path: 'browser-review/published-no-webgl-firefox.png'});
  console.log('PASS: Firefox native no-WebGL startup; live Canvas pixels, pan, persisted opt-out without WebGL assets, and saved drawing after reload');
} finally {
  await browser.close();
}
