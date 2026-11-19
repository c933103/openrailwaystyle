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
  // Simulate the independent gateway origin of the Pages test entry point.
  const broker = 'https://tiles.atlas.test/restricted/';
  let metadataRequests = 0, providerTiles = 0, hostedAvailable = false, tileState = 'image';
  const token = 'x'.repeat(43);
  let logoutRequests = 0;
  await page.route(url => url.href.startsWith(base) && url.pathname === new URL(base).pathname, async route => {
    const response = await route.fetch();
    await route.fulfill({response, body: (await response.text()).replace(
      '<meta name="atlas-restricted-tile-origin" content="">',
      '<meta name="atlas-restricted-tile-origin" content="https://tiles.atlas.test">'
    )});
  });
  const cors = {'Access-Control-Allow-Origin': new URL(base).origin, 'Access-Control-Allow-Headers':'Authorization, X-Atlas-Preview',
    'Access-Control-Allow-Methods':'GET, POST, DELETE', 'Access-Control-Expose-Headers':'Retry-After'};
  let admin = false;
  await context.route(broker + 'auth/device', route => {
    const method = route.request().method();
    if (method === 'OPTIONS') return route.fulfill({status:204,headers:cors});
    if (method === 'POST') return route.fulfill({status:201,headers:cors,json:{
      challenge:'t'.repeat(43), userCode:'TEST-2345', expiresAt:Date.now()+60_000,
    }});
    assert.equal(route.request().headers().authorization,'Device '+'t'.repeat(43));
    return admin ? route.fulfill({headers:cors,json:{token, soviet:true, google:true, expiresAt:Date.now()+60_000}})
      : route.fulfill({status:403,headers:cors});
  });
  const authenticated = (route, respond) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({status:204,headers:cors});
    assert.equal(route.request().headers().authorization, 'Bearer ' + token);
    return respond();
  };
  await context.route(broker + 'auth/session', route => authenticated(route, () => {
    assert.equal(route.request().method(), 'DELETE');
    logoutRequests++;
    return route.fulfill({status:204,headers:cors});
  }));
  await context.route('https://indianopenmaps.com/**', () => assert.fail('browser tried a direct historical tile request'));
  const sheet = ['L-32 fixture', '1970', [0, 40, 30, 66]];
  await page.route(base + 'soviet-footprints.json', route => route.fulfill({json: {
    1000000: [sheet], 500000: [['L-32-1 fixture', '1980', sheet[2]]],
  }}));
  for (const key of ['1m', '500k']) {
    const root = broker + 'soviet/' + key + '/';
    await context.route(root + 'tiles.json', route => authenticated(route, () => {
      metadataRequests++;
      return route.fulfill(hostedAvailable
        ? {headers:cors, json:{minzoom:3,maxzoom:5}}
        : {status:503, headers:cors});
    }));
    await context.route(url => url.href.startsWith(root) && /\/\d+\/\d+\/\d+$/.test(url.pathname), route => authenticated(route, () => {
      providerTiles++;
      if (tileState === 'missing') return route.fulfill({status:404, headers:cors});
      if (tileState === 'failed') return route.fulfill({status:503, headers:{...cors, 'Retry-After':'120'}});
      if (tileState === 'expired') return route.fulfill({status:401, headers:cors});
      return route.fulfill({headers:cors, contentType:'image/webp', body:redWebP});
    }));
  }
  const google = '[data-background="google"]';
  let googleTiles = 0, googleViewportCalls = 0;
  await context.route(url => url.href.startsWith(broker + 'google/viewport?'), route => authenticated(route, () => {
    googleViewportCalls++;
    return route.fulfill({headers:cors,json:{copyright:'Fixture satellite credits'}});
  }));
  await context.route(url => url.href.startsWith(broker + 'google/') && /\/\d+\/\d+\/\d+$/.test(url.pathname), route => authenticated(route, () => {
    googleTiles++;
    return route.fulfill({headers:cors,contentType:'image/png',body:red});
  }));
  async function openAdminSettings() {
    await page.locator('#settings-open').click();
    const summary = page.locator('#restricted-tiles:not([open]) > summary');
    if (await summary.isVisible()) await summary.click();
  }
  async function signIn() {
    await openAdminSettings();
    await page.locator('#restricted-tile-sign-in').click();
    await page.locator('#restricted-tile-sign-out').waitFor();
    await page.locator('#settings-close').click();
  }
  await open(false);
  assert.equal(await page.locator(button).isVisible(), false);
  assert.equal(await page.locator('[data-background="map"]').getAttribute('aria-pressed'), 'true');
  assert.equal(metadataRequests, 0, 'even a shared Soviet background requires sign-in');
  assert.equal(providerTiles, 0);
  assert.equal(await page.locator(google).isVisible(), false);
  assert.equal(googleViewportCalls, 0);
  assert.equal(googleTiles, 0);
  await open(false, 'map');
  await openAdminSettings();
  await page.locator('#restricted-tile-sign-in').click();
  await page.waitForFunction(() => document.querySelector('#restricted-tile-status').textContent.includes('does not have repository admin access'));
  await page.locator('#settings-close').click();
  assert.equal(await page.locator(button).isVisible(), false);
  assert.equal(await page.locator(google).isVisible(), false);
  admin = true;
  await signIn();
  assert.equal(await page.locator(button).isVisible(), true);
  assert.equal(await page.locator(google).isVisible(), true);
  assert.equal(googleTiles, 0);
  await page.locator(google).click();
  await page.locator('#google-preview-attribution').waitFor();
  assert.match(await page.locator('#google-preview-attribution').textContent(), /Google Maps.*Fixture satellite credits/);
  await page.waitForFunction(() => window.sovietMap.isSourceLoaded('google-satellite-preview'));
  assert.ok(googleTiles > 0);
  assert.ok(googleViewportCalls > 0);
  await page.locator('[data-background="map"]').click();
  assert.equal(await page.locator('#google-preview-attribution').isVisible(), false);
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
  assert.ok(providerTiles > 0, 'authenticated raster views request the two XYZ layers');
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
  await signIn();
  await page.waitForFunction(() => ['soviet-topo', 'soviet-topo-1'].every(id => window.sovietMap.getSource(id) && window.sovietMap.isSourceLoaded(id)));
  assert.equal(await page.locator(button).getAttribute('aria-pressed'), 'true');
  assert.doesNotMatch(await page.locator('#soviet-status').textContent(), /could not load/);
  tileState = 'failed';
  await open(false);
  await signIn();
  await page.waitForFunction(() => document.querySelector('#soviet-status').textContent.includes('could not load'));
  await page.locator('[data-background="map"]').click();
  assert.equal(await page.locator('#soviet-status').isVisible(), false);
  await page.locator(google).click();
  await page.locator('#google-preview-attribution').waitFor();
  await openAdminSettings();
  await page.locator('#restricted-tile-sign-out').click();
  await page.locator('#settings-close').click();
  assert.equal(await page.locator(button).isVisible(), false);
  assert.equal(await page.locator(google).isVisible(), false);
  assert.equal(await page.locator('#google-preview-attribution').isVisible(), false);
  assert.equal(await page.evaluate(() => Boolean(window.sovietMap.getSource('soviet-topo'))), false);
  assert.equal(await page.evaluate(() => Boolean(window.sovietMap.getSource('google-satellite-preview'))), false);
  await page.waitForTimeout(300);
  assert.equal(logoutRequests, 1);
  tileState = 'expired';
  await open(false, 'map');
  await signIn();
  await page.locator(button).click();
  await page.waitForFunction(() => document.querySelector('#restricted-tile-status').textContent.startsWith('Session expired'));
  assert.equal(await page.locator(button).isVisible(), false);
  assert.equal(await page.locator('[data-background="map"]').getAttribute('aria-pressed'), 'true');

  // Exercise the actual static Pages map with the optional gateway absent.
  const repository = 'c933103/openrailwaystyle';
  const tokenFixture = 'github_pat_browser_fixture';
  const browserKey = 'sample_browser_key_for_testing';
  let allowAdmin = false, directGoogle = 0, directSoviet = 0;
  await page.route(url => url.href.startsWith(base) && url.pathname === new URL(base).pathname, async route => {
    const response = await route.fetch();
    await route.fulfill({response, body:(await response.text()).replace(
      '<meta name="atlas-static-tile-tests" content="">',
      `<meta name="atlas-static-tile-tests" content="${repository}|${browserKey}|indian-open-maps">`
    )});
  });
  await context.route(broker + '**', () => assert.fail('Static mode contacted the optional gateway'));
  const directCors = {...cors, 'Access-Control-Allow-Headers':'Authorization, Content-Type, X-GitHub-Api-Version'};
  await context.route('https://api.github.com/repos/' + repository, route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({status:204,headers:directCors});
    assert.equal(route.request().headers().authorization, 'Bearer ' + tokenFixture);
    return route.fulfill({headers:directCors,json:{permissions:{admin:allowAdmin}}});
  });
  await context.route('https://tile.googleapis.com/**', route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({status:204,headers:directCors});
    assert.equal(request.headers().authorization,undefined);
    assert.equal(url.searchParams.get('key'),browserKey);
    directGoogle++;
    if (url.pathname === '/v1/createSession') return route.fulfill({headers:directCors,json:{
      session:'fixture-session', expiry:String(Math.floor(Date.now()/1000)+300),
    }});
    assert.equal(url.searchParams.get('session'),'fixture-session');
    if (url.pathname === '/tile/v1/viewport') return route.fulfill({headers:directCors,json:{copyright:'Direct satellite fixture credits'}});
    return route.fulfill({headers:directCors,contentType:'image/png',body:red});
  });
  await context.route('https://indianopenmaps.com/world/topo/russian/**', route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(request.headers().authorization,undefined);
    directSoviet++;
    if (url.pathname.endsWith('tiles.json')) return route.fulfill({headers:directCors,json:{
      tiles:[url.href.replace('tiles.json','{z}/{x}/{y}.webp')], scheme:'xyz', minzoom:3, maxzoom:8,
    }});
    return route.fulfill({headers:directCors,contentType:'image/webp',body:redWebP});
  });
  await open(false, 'map');
  await openAdminSettings();
  const input = page.locator('#restricted-tile-token');
  const verify = page.getByRole('button',{name:'Verify GitHub access'});
  assert.equal(await page.locator('#restricted-tile-sign-in').isVisible(),false);
  await input.fill(tokenFixture);
  await verify.click();
  await page.waitForFunction(() => document.querySelector('#restricted-tile-status').textContent.includes('did not confirm repository admin access'));
  assert.equal(await input.inputValue(),'');
  assert.equal(directGoogle + directSoviet,0);
  allowAdmin = true;
  await input.fill(tokenFixture);
  await verify.click();
  await page.locator('#restricted-tile-sign-out').waitFor();
  await page.locator('#settings-close').click();
  assert.equal(directGoogle + directSoviet,0,'verified sign-in alone does not fetch test tiles');
  await page.locator(google).click();
  await page.waitForFunction(() => window.sovietMap.getSource('google-satellite-preview') && window.sovietMap.isSourceLoaded('google-satellite-preview'));
  assert.ok(directGoogle > 1);
  assert.match(await page.locator('#google-preview-attribution').textContent(), /Direct satellite fixture credits/);
  await page.locator(button).click();
  await page.waitForFunction(() => window.sovietMap.getSource('soviet-topo') && window.sovietMap.isSourceLoaded('soviet-topo'));
  assert.ok(directSoviet > 2);
  await openAdminSettings();
  await page.locator('#restricted-tile-sign-out').click();
  await page.locator('#settings-close').click();
  assert.equal(await page.locator(button).isVisible(),false);
  assert.equal(await page.locator(google).isVisible(),false);
  assert.equal(await page.locator('[data-background="map"]').getAttribute('aria-pressed'),'true');
  assert.deepEqual(pageErrors, []);
  console.log('PASS: historical pixels, stacking, static Pages and optional gateway access, viewport credits, non-admin rejection, sign-out, and expiry');
} finally {
  await browser.close();
}
