// Real Chromium checks for branding metadata and old-to-new service-worker
// migration. Map/timetable requests are deliberately not part of this fixture.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const html = await read('styles/index.html');
const manifest = JSON.parse(await read('styles/manifest.webmanifest'));
const worker = await read('styles/sw.js');
const icons = new Map();
for (const name of ['atlas-icon.svg', 'atlas-icon-192.png', 'atlas-icon-512.png', 'atlas-icon-maskable-512.png', 'atlas-icon-touch-180.png']) {
  icons.set(name, await readFile(new URL(`styles/${name}`, root)));
}
const output = new URL('../browser-review/branding/', import.meta.url);
await mkdir(output, {recursive: true});

// Reproduce the metadata before #72. Keep app id/start_url/scope unchanged.
const beforeManifest = {...manifest, short_name: 'Rail Atlas', icons: manifest.icons.map(icon => ({...icon, src: icon.src.split('?')[0]}))};
const cacheMatch = worker.match(/CACHE = `\$\{PREFIX\}(\d+)`/);
assert.ok(cacheMatch, 'worker must expose a numbered shell cache');
const cacheGeneration = Number(cacheMatch[1]);
assert.ok(cacheGeneration >= 7, 'branding refresh must use a new shell generation');
const previousWorker = worker.replace(/CACHE = `\$\{PREFIX\}\d+`/, `CACHE = \`\${PREFIX}${cacheGeneration - 1}\``);
let phase = 'before', base;
const fixtureHead = html.match(/<head>([\s\S]*?)<\/head>/)[1];
function fixturePage() {
  let head = fixtureHead.replace(/<link\b[^>]*href="https:[^"]*"[^>]*>/g, '');
  head = head.replace(/app\.css\?v=[\w.-]+/g, `app.css?v=branding-${phase}`);
  if (phase === 'before') head = head.replace(/\?rev=[a-f0-9]+/g, '').replace('name="apple-mobile-web-app-title" content="Railway Atlas"', 'name="apple-mobile-web-app-title" content="Rail Atlas"');
  return `<!doctype html><html lang="en"><head>${head}</head><body><h1>Railway Atlas</h1><script type="module" src="app.mjs?v=branding-${phase}"></script><script>navigator.serviceWorker.register('sw.js', {updateViaCache:'none'});</script></body></html>`;
}
const requests = [];
const server = createServer((req, res) => {
  const url = new URL(req.url, base), path = url.pathname.replace(/^\/openrailwaystyle\//, '');
  requests.push({phase, path, search: url.search});
  res.setHeader('Cache-Control', 'no-store');
  let body, type;
  if (path === '' || path === 'index.html') { body = fixturePage(); type = 'text/html'; }
  else if (path === 'manifest.webmanifest') { body = JSON.stringify(phase === 'before' ? beforeManifest : manifest); type = 'application/manifest+json'; }
  else if (path === 'sw.js') {
    // Only dependency locations change: keep the production caching, fetching,
    // activation and migration logic. No third-party network is required.
    body = (phase === 'before' ? previousWorker : worker).replace(/const LIBRARIES = \[[^\n]+\];/, `const LIBRARIES = ['${base}fixture-library.js'];`);
    type = 'text/javascript';
  } else if (icons.has(path)) { body = icons.get(path); type = path.endsWith('.svg') ? 'image/svg+xml' : 'image/png'; }
  else if (path === 'app.mjs') { body = `document.body.dataset.fixtureVersion='branding-${phase}';`; type = 'text/javascript'; }
  else if (path.endsWith('.mjs') || path.endsWith('.js')) { body = `/* shell fixture: ${phase} */`; type = 'text/javascript'; }
  else if (path.endsWith('.css')) { body = ''; type = 'text/css'; }
  else if (path.endsWith('.json') || path.endsWith('.geojson')) { body = '{}'; type = 'application/json'; }
  else { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', type);
  res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
base = `http://127.0.0.1:${server.address().port}/openrailwaystyle/`;
const profile = await mkdtemp(join(tmpdir(), 'atlas-branding-'));
let context;
const results = {scope: base, checks: [], boundaries: 'Real browser with production manifest, icons and service-worker logic. App/map resources and CDN dependency locations are isolated fixtures. No Android/iOS launcher is emulated.'};
try {
  context = await chromium.launchPersistentContext(profile, {
    headless: true, channel: 'chromium', executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox'], viewport: {width: 1280, height: 720}
  });
  context.setDefaultTimeout(20000);
  results.browser = context.browser()?.version() || 'Chromium persistent context';
  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForFunction(() => document.body.dataset.fixtureVersion === 'branding-before');
  const settings = JSON.stringify({language: 'en', attributionOpen: false});
  const drawing = JSON.stringify({type: 'FeatureCollection', features: [{type: 'Feature', properties: {name: 'branding test'}, geometry: {type: 'Point', coordinates: [0, 0]}}]});
  await page.evaluate(({settings, drawing}) => {
    document.cookie = `atlas_settings=${encodeURIComponent(settings)};path=/openrailwaystyle/;SameSite=Lax`;
    localStorage.setItem('openrailwayatlas-drawing', drawing);
  }, {settings, drawing});
  const originalCookie = await page.evaluate(() => document.cookie);
  const oldCaches = await page.evaluate(() => caches.keys());
  assert.ok(oldCaches.includes(`atlas-shell-${cacheGeneration - 1}`));
  // Preserve an unrelated app's cache on the same origin as a migration guard.
  await page.evaluate(async () => (await caches.open('unrelated-app')).put('/other-app', new Response('keep')));
  const oldIdentity = await cdp.send('Page.getAppManifest');
  assert.equal(JSON.parse(oldIdentity.data).short_name, 'Rail Atlas');
  assert.deepEqual(oldIdentity.errors, []);
  results.checks.push('Pre-update manifest parsed; previous shell installed');

  // This is an actual browser-managed PWA install, not display-mode emulation.
  await cdp.send('PWA.install', {manifestId: base, installUrlOrBundleUrl: base});
  const installedState = await cdp.send('PWA.getOsAppState', {manifestId: base});
  assert.ok(installedState);
  results.checks.push('Browser-managed PWA installed at unchanged manifest id');

  phase = 'after';
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForFunction(async cacheName => (await caches.keys()).includes(cacheName) && !(await caches.keys()).includes(`atlas-shell-${Number(cacheName.split('-').at(-1)) - 1}`), `atlas-shell-${cacheGeneration}`);
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.fixtureVersion === 'branding-after');
  const newIdentity = await cdp.send('Page.getAppManifest');
  assert.deepEqual(newIdentity.errors, []);
  assert.deepEqual(JSON.parse(newIdentity.data), manifest);
  assert.equal(newIdentity.url, oldIdentity.url);
  assert.equal(await page.evaluate(() => document.cookie), originalCookie);
  assert.equal(await page.evaluate(() => localStorage.getItem('openrailwayatlas-drawing')), drawing);
  const afterCaches = await page.evaluate(() => caches.keys());
  assert.ok(afterCaches.includes('unrelated-app'));
  results.checks.push('New manifest fetched at the same URL; settings, drawings and unrelated cache preserved');

  for (const icon of manifest.icons) {
    const loaded = await page.evaluate(async src => {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`Icon HTTP ${response.status}`);
      const img = new Image(); img.src = src; await img.decode();
      return {width: img.naturalWidth, height: img.naturalHeight};
    }, icon.src);
    if (icon.sizes !== 'any') assert.equal(`${loaded.width}x${loaded.height}`, icon.sizes);
  }
  results.checks.push('Every manifest icon fetched and decoded successfully');

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.fixtureVersion === 'branding-after');
  const offline = await page.evaluate(async ({manifest, oldVersion, newCache}) => {
    const cachedManifest = await (await fetch('manifest.webmanifest')).json();
    const iconBytes = [];
    for (const icon of manifest.icons) iconBytes.push((await (await fetch(icon.src)).arrayBuffer()).byteLength);
    const cachedOldModule = await (await fetch(`app.mjs?v=${oldVersion}`)).text();
    const cache = await caches.open(newCache);
    return {cachedManifest, iconBytes, cachedOldModule, versions: await (await cache.match(new URL('__versions', location.href))).json()};
  }, {manifest, oldVersion: 'branding-before', newCache: `atlas-shell-${cacheGeneration}`});
  assert.deepEqual(offline.cachedManifest, manifest);
  assert.ok(offline.iconBytes.every(length => length > 100));
  assert.match(offline.cachedOldModule, /branding-before/);
  assert.deepEqual(offline.versions, ['branding-after', 'branding-before']);
  assert.equal(await page.evaluate(() => document.cookie), originalCookie);
  assert.equal(await page.evaluate(() => localStorage.getItem('openrailwayatlas-drawing')), drawing);
  results.checks.push('Offline relaunch works; revised icons and previous-version modules remain available');
  await cdp.send('PWA.getOsAppState', {manifestId: base});
  results.checks.push('The same installed PWA identity remains registered after migration');
  await context.setOffline(false);
  await cdp.send('PWA.uninstall', {manifestId: base});

  // Reviewable, upload-ready GitHub social card using the exact existing SVG.
  // The card is not a new icon and does not alter the installed-app artwork.
  const card = await context.newPage();
  await card.setViewportSize({width: 1280, height: 640});
  await card.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;width:1280px;height:640px;background:#e7eee9;color:#173e47;font-family:Arial,sans-serif;padding:80px;display:flex;align-items:center;gap:64px}
    .icon{width:280px;height:280px;flex:none}.icon svg{width:100%;height:100%}h1{font-size:68px;letter-spacing:-2px;margin:0 0 18px;white-space:nowrap}p{font-size:32px;margin:0}footer{font-size:23px;line-height:1.6;margin-top:48px;color:#24565f}
    </style></head><body><div class="icon">${icons.get('atlas-icon.svg').toString()}</div><main><h1>Railway Atlas</h1><p>The world, by rail.</p><footer>Worldwide stations and railway infrastructure<br>Built on OpenStreetMap</footer></main></body></html>`);
  await card.screenshot({path: new URL('github-social-preview.png', output).pathname});
  results.checks.push('1280×640 social-preview PNG produced from approved artwork');
  results.requests = requests;
  await writeFile(new URL('results.json', output), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({...results, requests: undefined}, null, 2));
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, {recursive: true, force: true});
}
