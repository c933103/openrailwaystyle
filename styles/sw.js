// Service worker for the installed app. It keeps the app's own page, code and
// style so the app opens without a connection (the map data still needs
// one). Always the network first, so an update is never held back; the saved
// copy is used only when the network fails. Map tiles and data files are not
// handled here.
const PREFIX = 'atlas-shell-', CACHE = `${PREFIX}2`;
const SHELL = /\/(app\.css|[\w-]+\.mjs|vendor\/[\w-]+\.js|world\.style\.json|manifest\.webmanifest|favicon\.svg|icon-[\w-]+\.png)$/;
// Saved at installation, so an app installed on the first visit (before this
// worker controlled the page) also opens offline.
const PRECACHE = ['./', 'app.css', 'app.mjs', 'map-model.mjs', 'context.mjs', 'draw.mjs', 'elevation.mjs', 'globe-drag.mjs', 'departures.mjs', 'polar.mjs', 'track-count.mjs', 'track-tiles.mjs', 'han-region.mjs', 'han-region-data.mjs', 'loading-gauge-list.mjs', 'vendor/tile-labels.js', 'vendor/maplibre-contour.js', 'world.style.json', 'manifest.webmanifest', 'favicon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  // A file that fails to load does not stop the installation.
  await Promise.allSettled(PRECACHE.map(async path => {
    const url = new URL(path, self.registration.scope), response = await fetch(url, {cache: 'no-cache'});
    if (response.ok) await cache.put(url.origin + url.pathname, response);
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
