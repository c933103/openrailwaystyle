// Service worker for the installed app. It keeps the app's own page, code and
// style so the app opens without a connection (the map data still needs
// one). The page comes from the network first, so an update is never held
// back. Files the page asks for with a version (?v=) are kept per version
// and served from the saved copy of that version first (a changed file gets
// a new version); a versioned request is never answered by another version,
// so a newer module is never paired with an older one it depends on. A new
// page is shown only once every file of its version is saved. Other files
// come from the network first, the saved copy only when it fails. The map
// libraries from the CDN are kept too: their addresses carry the version, so
// a saved copy never goes stale and is used first. Map tiles and data files
// are not handled here.
const PREFIX = 'atlas-shell-', CACHE = `${PREFIX}12`, KEEP_VERSIONS = 2;
// Shell 12 refreshes the merged modules while migrate() keeps the previous app's
// versioned modules. Stored user settings are not touched.
// Keep in step with loadScript in app.mjs and the stylesheet in index.html.
const LIBRARIES = ['https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js', 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css', 'https://cdn.jsdelivr.net/npm/pmtiles@4.2.1/dist/pmtiles.js'];
const SHELL = /\/(app\.css|[\w-]+\.mjs|vendor\/[\w-]+\.js|world\.style\.json|major-stations\.geojson|manifest\.webmanifest|atlas-icon[\w-]*\.(?:png|svg))$/;
// Saved at installation, so an app installed on the first visit (before this
// worker controlled the page) also opens offline.
const PRECACHE = ['./', 'app.css', 'app.mjs', 'map-model.mjs', 'layer-semantics.mjs', 'map-controls.mjs', 'platform-length.mjs', 'context.mjs', 'power-facilities.mjs', 'draw.mjs', 'elevation.mjs', 'dem-repair.mjs', 'globe-drag.mjs', 'keyboard-pan.mjs', 'departures.mjs', 'polar.mjs', 'track-count.mjs', 'track-tiles.mjs', 'han-region.mjs', 'han-region-data.mjs', 'loading-gauge-list.mjs', 'axle-load.mjs', 'vendor/tile-labels.js', 'vendor/track-worker.js', 'vendor/polar-layer.js', 'vendor/maplibre-contour.js', 'vendor/dem-worker.js', 'world.style.json', 'major-stations.geojson', 'manifest.webmanifest', 'atlas-icon.svg', 'atlas-icon-192.png', 'atlas-icon-512.png', 'atlas-icon-maskable-512.png', 'atlas-icon-touch-180.png'];

// The version the page asks for, read from its module script.
const pageVersion = html => html.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1] ?? null;
const versioned = (key, version) => `${key}?v=${encodeURIComponent(version)}`;
// The versions kept (saveVersion), newest first.
const keptVersions = cache => cache.match(new URL('__versions', self.registration.scope).href).then(r => r ? r.json() : []).catch(() => []);
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
    // A fetch resolves at headers. Installing workers throttle outstanding
    // requests; consume this body now rather than leaving every slot occupied
    // while Promise.all waits for the remaining fetches. Retain the original
    // Response (including URL/type/headers) for cache.put below. A truncated
    // body rejects before any of this version's files are published.
    await response.clone().arrayBuffer();
    return [key, response];
  }));
  for (const [key, response] of files) {
    await cache.put(versioned(key, version), response.clone());
    await cache.put(key, response);
  }
  if (page) await cache.put(new URL('./', self.registration.scope).href, page);
  // The two latest versions are kept: a page still open on the one before
  // (another tab) loads its lazy modules (the polar layer, the track worker)
  // from it. Older ones are dropped.
  const listKey = new URL('__versions', self.registration.scope).href;
  const known = await keptVersions(cache);
  const keep = [version, ...known.filter(v => v !== version)].slice(0, KEEP_VERSIONS);
  await cache.put(listKey, new Response(JSON.stringify(keep), {headers: {'content-type': 'application/json'}}));
  for (const request of await cache.keys()) {
    const v = new URL(request.url).searchParams.get('v');
    if (v !== null && !keep.includes(v)) await cache.delete(request);
  }
}

// Brings the files of the version before over from this app's older caches
// (before they are deleted on activation), so a page still open on it keeps
// finding its lazy modules offline. Earlier caches kept each file only under
// its plain address: those belong to the version their saved page names.
async function migrate(cache, version) {
  const scope = self.registration.scope, listKey = new URL('__versions', scope).href;
  const versions = async c => c.match(listKey).then(r => r ? r.json() : []).catch(() => []);
  let keep = await versions(cache);
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX) || name === CACHE) continue;
    const old = await caches.open(name), page = await old.match(new URL('./', scope).href);
    const pageOf = page ? pageVersion(await page.text()) : null;
    keep = [...new Set([version, ...keep, ...(await versions(old)), ...(pageOf ? [pageOf] : [])])].slice(0, KEEP_VERSIONS);
    for (const request of await old.keys()) {
      const url = new URL(request.url), v = url.searchParams.get('v');
      if (url.origin !== location.origin || !SHELL.test(url.pathname)) continue;
      const key = v !== null ? request.url : pageOf && versioned(url.origin + url.pathname, pageOf);
      if (!key || !keep.includes(v ?? pageOf) || await cache.match(key)) continue;
      const response = await old.match(request);
      if (response) await cache.put(key, response);
    }
  }
  await cache.put(listKey, new Response(JSON.stringify(keep), {headers: {'content-type': 'application/json'}}));
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
  // The libraries are fetched before anything is saved, so a library that
  // fails to load leaves the cache as it was: the worker in place keeps a
  // page that only asks for the libraries it knows. Fetched with CORS (the
  // CDN allows any origin) so that an error status can be seen and fails the
  // installation; the saved copy also serves the page's plain script and
  // stylesheet requests.
  const libraries = await Promise.all(LIBRARIES.map(async url => {
    if (await cache.match(url)) return null;
    const library = await fetch(url, {mode: 'cors'});
    if (!library.ok) throw new Error(`${url} returned ${library.status}`);
    // Release the installing worker's network slot before fetching the shell.
    await library.clone().arrayBuffer();
    return [url, library];
  }));
  await saveVersion(cache, version, response);
  await migrate(cache, version);
  for (const entry of libraries) if (entry) await cache.put(...entry);
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  // Only this app's older copies (their files of the version before were
  // brought over at installation): other apps on the same origin keep theirs.
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
    // A file of a saved version is the same file for good (a changed file
    // gets a new version), so it comes from the saved copy: a page then
    // always gets its own version's files, even the saved page shown when
    // a newer one could not be saved, while the server already has newer.
    if (version !== null && request.mode !== 'navigate') {
      const saved = await cache.match(versioned(plain, version));
      if (saved) return saved;
    }
    try {
      const response = await fetch(request);
      if (response.ok && request.mode === 'navigate') {
        // A page is shown only once every file of its version is saved
        // (quick when the version is unchanged: they are all saved), so it
        // always finds its own files even if the connection then drops. If
        // they cannot all be had, the saved page, complete with its files,
        // is shown instead.
        const next = pageVersion(await response.clone().text());
        if (next) {
          try { await saveVersion(cache, next, response.clone()); }
          catch { const saved = await cache.match(plain); if (saved) return saved; }
        }
      } else if (response.ok) {
        await cache.put(plain, response.clone());
        // Kept under its version only while that version is kept: the server
        // answers any ?v= with the current file, so a tab still open on a
        // dropped version would otherwise have newer bytes saved as its own.
        if (version !== null && (await keptVersions(cache)).includes(version)) await cache.put(versioned(plain, version), response.clone());
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
