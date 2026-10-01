// Service worker for the installed app. It keeps the app's own page, code and
// style so the app opens without a connection (the map data still needs
// one). Always the network first, so an update is never held back; the saved
// copy is used only when the network fails. The map libraries from the CDN
// are kept too: their addresses carry the version, so a saved copy never goes
// stale and is used first. Map tiles and data files are not handled here.
const PREFIX = 'atlas-shell-', CACHE = `${PREFIX}5`;
// Keep in step with loadScript in app.mjs and the stylesheet in index.html.
const LIBRARIES = ['https://cdn.jsdelivr.net/npm/maplibre-gl@5.1.0/dist/maplibre-gl.js', 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.1.0/dist/maplibre-gl.css', 'https://cdn.jsdelivr.net/npm/pmtiles@4.2.1/dist/pmtiles.js'];
const SHELL = /\/(app\.css|[\w-]+\.mjs|vendor\/[\w-]+\.js|world\.style\.json|manifest\.webmanifest|favicon\.svg|icon-[\w-]+\.png)$/;
// Saved at installation, so an app installed on the first visit (before this
// worker controlled the page) also opens offline.
const PRECACHE = ['./', 'app.css', 'app.mjs', 'map-model.mjs', 'context.mjs', 'draw.mjs', 'elevation.mjs', 'globe-drag.mjs', 'keyboard-pan.mjs', 'departures.mjs', 'polar.mjs', 'track-count.mjs', 'track-tiles.mjs', 'han-region.mjs', 'han-region-data.mjs', 'loading-gauge-list.mjs', 'vendor/tile-labels.js', 'vendor/track-worker.js', 'vendor/polar-layer.js', 'vendor/maplibre-contour.js', 'world.style.json', 'manifest.webmanifest', 'favicon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  // Every file is needed: if one fails to load, the installation fails, the
  // worker in place (and its complete copy) stays, and the browser tries
  // again later.
  await Promise.all(PRECACHE.map(async path => {
    const url = new URL(path, self.registration.scope), response = await fetch(url, {cache: 'no-cache'});
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    await cache.put(url.origin + url.pathname, response);
  }));
  // Fetched with CORS (the CDN allows any origin) so that an error status can
  // be seen and fails the installation; the saved copy also serves the page's
  // plain script and stylesheet requests.
  await Promise.all(LIBRARIES.map(async url => {
    if (await cache.match(url)) return;
    const response = await fetch(url, {mode: 'cors'});
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    await cache.put(url, response);
  }));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  // Only this app's older copies: other apps on the same origin keep theirs.
  for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method === 'GET' && LIBRARIES.includes(request.url)) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      const saved = await cache.match(request.url);
      if (saved) return saved;
      // Only a successful copy is kept; otherwise the page's own request.
      const response = await fetch(request.url, {mode: 'cors'}).catch(() => null);
      if (!response?.ok) return fetch(request);
      await cache.put(request.url, response.clone());
      return response;
    }));
    return;
  }
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope).pathname, page = url.pathname === scope || url.pathname === scope + 'index.html';
  if (request.mode === 'navigate' ? !page : !SHELL.test(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // One saved copy per file, whatever its version query.
    const key = request.mode === 'navigate' ? new URL('./', self.registration.scope).href : url.origin + url.pathname;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(key, response.clone());
      return response;
    } catch (error) {
      const saved = await cache.match(key);
      if (saved) return saved;
      throw error;
    }
  })());
});
