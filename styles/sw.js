// Service worker for the installed app. It keeps the app's own page, code and
// style so the app opens without a connection (the map data still needs
// one). Always the network first, so an update is never held back; the saved
// copy is used only when the network fails. The map libraries from the CDN
// are kept too: their addresses carry the version, so a saved copy never goes
// stale and is used first. Map tiles and data files are not handled here.
// Files the page asks for with a version (?v=) are saved under that version
// too, and offline a versioned request is answered only by the same version,
// so a newer module is never paired with an older one it depends on; whenever
// a page of a new version is saved, every file of that version is saved with
// it.
const PREFIX = 'atlas-shell-', CACHE = `${PREFIX}6`;
// Keep in step with loadScript in app.mjs and the stylesheet in index.html.
const LIBRARIES = ['https://cdn.jsdelivr.net/npm/maplibre-gl@5.1.0/dist/maplibre-gl.js', 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.1.0/dist/maplibre-gl.css', 'https://cdn.jsdelivr.net/npm/pmtiles@4.2.1/dist/pmtiles.js'];
const SHELL = /\/(app\.css|[\w-]+\.mjs|vendor\/[\w-]+\.js|world\.style\.json|manifest\.webmanifest|favicon\.svg|icon-[\w-]+\.png)$/;
// Saved at installation, so an app installed on the first visit (before this
// worker controlled the page) also opens offline.
const PRECACHE = ['./', 'app.css', 'app.mjs', 'map-model.mjs', 'context.mjs', 'draw.mjs', 'elevation.mjs', 'globe-drag.mjs', 'departures.mjs', 'polar.mjs', 'track-count.mjs', 'track-tiles.mjs', 'han-region.mjs', 'han-region-data.mjs', 'loading-gauge-list.mjs', 'vendor/tile-labels.js', 'vendor/track-worker.js', 'vendor/polar-layer.js', 'vendor/maplibre-contour.js', 'world.style.json', 'manifest.webmanifest', 'favicon.svg', 'icon-192.png', 'icon-512.png'];

// The version the page asks for, read from its module script.
const pageVersion = html => html.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1] ?? null;
const versioned = (key, version) => `${key}?v=${encodeURIComponent(version)}`;
// Saves every file of one version, all fetched now (so they match each
// other), under both the plain and the versioned address; then drops the
// files of other versions. Throws if any file fails, keeping what was there.
async function saveVersion(cache, version, page) {
  const files = await Promise.all(PRECACHE.filter(path => path !== './').map(async path => {
    const url = new URL(path, self.registration.scope), key = url.origin + url.pathname;
    const saved = await cache.match(versioned(key, version));
    if (saved) return [key, saved];
    const response = await fetch(versioned(key, version), {cache: 'no-cache'});
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return [key, response];
  }));
  for (const [key, response] of files) {
    await cache.put(versioned(key, version), response.clone());
    await cache.put(key, response);
  }
  if (page) await cache.put(new URL('./', self.registration.scope).href, page);
  for (const request of await cache.keys()) {
    const v = new URL(request.url).searchParams.get('v');
    if (v !== null && v !== version) await cache.delete(request);
  }
}

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  // Every file is needed: if one fails to load, the installation fails, the
  // worker in place (and its complete copy) stays, and the browser tries
  // again later.
  const response = await fetch(new URL('./', self.registration.scope), {cache: 'no-cache'});
  if (!response.ok) throw new Error(`page returned ${response.status}`);
  const version = pageVersion(await response.clone().text());
  if (!version) throw new Error('page names no version');
  await saveVersion(cache, version, response);
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
  const version = url.searchParams.get('v');
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const plain = request.mode === 'navigate' ? new URL('./', self.registration.scope).href : url.origin + url.pathname;
    try {
      const response = await fetch(request);
      if (response.ok && request.mode === 'navigate') {
        // The saved page changes only once every file of its version is
        // saved too, so the saved page always finds its own files.
        const copy = response.clone(), next = pageVersion(await response.clone().text());
        if (next) event.waitUntil(saveVersion(cache, next, copy).catch(() => {}));
      } else if (response.ok) {
        await cache.put(plain, response.clone());
        if (version !== null) await cache.put(versioned(plain, version), response.clone());
      }
      return response;
    } catch (error) {
      // A versioned file only from the same version; anything else from its
      // one saved copy.
      const saved = await cache.match(version === null ? plain : versioned(plain, version));
      if (saved) return saved;
      throw error;
    }
  })());
});
