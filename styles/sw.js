// Service worker for the installed app. It keeps the app's own page, code and
// style so the app opens without a connection (the map data still needs
// one). The page comes from the network first, so an update is never held
// back. Files the page asks for with a version (?v=) are kept per version
// and served from the saved copy of that version first (a changed file gets
// a new version); a versioned request is never answered by another version,
// so a newer module is never paired with an older one it depends on. A new
// page is shown only once every file of its version is saved. Other files
// come from the network first, the saved copy only when it fails. The map
// libraries are hosted with this page and included in the same complete shell.
// Their filenames pin the library version, so cached old/new app versions
// cannot overwrite one another's dependency bytes. Map tiles and data files
// are not handled here.
const PREFIX = 'atlas-shell-', CACHE = `${PREFIX}26`, KEEP_VERSIONS = 2;
const FONT_CACHE='atlas-label-fonts-v1';
// Shell 25 includes the full-train schedule renderer. The hash-pinned
// MapLibre attribution backport keeps older open tabs working without
// any new legacy request.
// Stored user settings are not touched.
// Keep in step with loadScript in app.mjs and the stylesheet in index.html.
const LIBRARIES = ['vendor/maplibre-gl-5.24.0-atlas.1.js', 'vendor/maplibre-gl-5.24.0.css', 'vendor/pmtiles-4.2.1.js'];
const LEGACY_LIBRARIES = {
  'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css': 'ab1e70d59ec40465bae7e7030da2f3ccf28133fd502e62bd598eefbadfd7a732',
  'https://cdn.jsdelivr.net/npm/pmtiles@4.2.1/dist/pmtiles.js': 'afc49d216fd24c0a3c0ff3cd2e0c62d6cdaf062854c3dced778dcab168824f79',
};
// Historical pages use plain script tags without SRI. Their v5 API remains
// compatible, so future requests to either old JS URL receive verified fixed
// bytes. Do not migrate original executable JS into the replacement cache.
const MAPLIBRE_PATCHED = new URL('vendor/maplibre-gl-5.24.0-atlas.1.js', self.registration.scope).href;
const MAPLIBRE_PATCHED_SHA256 = '46dc2971db363b0c7efa1d9ae6035d26c872c7110a3384aaec379ff281e0f223';
const LEGACY_MAPLIBRE = new Set([
  new URL('vendor/maplibre-gl-5.24.0.js', self.registration.scope).href,
  'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js',
]);
const legacyMapLibre = url => LEGACY_MAPLIBRE.has(url.origin + url.pathname);
const SHELL = /\/(app\.css|[\w-]+\.mjs|vendor\/[\w.-]+\.(?:js|css)|world\.style\.json|major-stations\.geojson|manifest\.webmanifest|atlas-icon[\w-]*\.(?:png|svg))$/;
// Saved at installation, so an app installed on the first visit (before this
// worker controlled the page) also opens offline.
const PRECACHE = ['./', ...LIBRARIES, 'app.css', 'app.mjs', 'bathymetry.mjs', 'map-model.mjs', 'layer-semantics.mjs', 'map-controls.mjs', 'rail-provider-recovery.mjs', 'platform-length.mjs', 'context.mjs', 'cjk-font.mjs', 'rare-han.mjs', 'crossing-tags.mjs', 'power-facilities.mjs', 'draw.mjs', 'elevation.mjs', 'dem-repair.mjs', 'globe-drag.mjs', 'keyboard-pan.mjs', 'watch-map.mjs', 'tile-bundles.mjs', 'service-frequency.mjs', 'departures.mjs', 'departures-ui.mjs', 'polar.mjs', 'track-count.mjs', 'track-tiles.mjs', 'han-region.mjs', 'han-region-data.mjs', 'loading-gauge-list.mjs', 'axle-load.mjs', 'vendor/tile-labels.js', 'vendor/track-worker.js', 'vendor/polar-layer.js', 'vendor/maplibre-contour.js', 'vendor/dem-worker.js', 'vendor/depth-worker.js', 'world.style.json', 'major-stations.geojson', 'manifest.webmanifest', 'atlas-icon.svg', 'atlas-icon-192.png', 'atlas-icon-512.png', 'atlas-icon-maskable-512.png', 'atlas-icon-touch-180.png'];

// The version the page asks for, read from its module script.
const pageVersion = html => html.match(/src="app\.mjs\?v=([\w.-]+)"/)?.[1] ?? null;
const versioned = (key, version) => `${key}?v=${encodeURIComponent(version)}`;
// The versions kept (saveVersion), newest first.
const keptVersions = cache => cache.match(new URL('__versions', self.registration.scope).href).then(r => r ? r.json() : []).catch(() => []);
// Compatibility responses must match the same immutable byte pins as
// app.mjs and scripts/browser-libraries.mjs before they are migrated or served.
async function verifiedLegacyLibrary(cache, url, expected = LEGACY_LIBRARIES[url]) {
  if (!expected || !self.crypto?.subtle) return null;
  try {
    const response = await cache.match(url);
    if (!response?.ok || response.type === 'opaque') return null;
    const type = (response.headers.get('content-type') || '').split(';')[0].trim();
    if (!(url.endsWith('.css') ? /^text\/css$/i.test(type) : /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/i.test(type))) return null;
    const digest = await self.crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
    const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return sha256 === expected ? response : null;
  } catch { return null; }
}
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
      if (legacyMapLibre(url)) continue;
      // Older tabs may still request original CSS/PMTiles CDN URLs after the
      // new worker claims it. Transfer only copies already saved; CDN access
      // is never required for installation or for this compatibility path.
      if (Object.hasOwn(LEGACY_LIBRARIES, request.url)) {
        if (!await verifiedLegacyLibrary(cache, request.url)) {
          const response = await verifiedLegacyLibrary(old, request.url);
          if (response) await cache.put(request.url, response);
        }
        continue;
      }
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
  // App modules and version-pinned map libraries succeed together. A blocked
  // third-party CDN cannot prevent the new shell from becoming available.
  await saveVersion(cache, version, response);
  await migrate(cache, version);
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
  if (request.method === 'GET' && legacyMapLibre(url)) {
    event.respondWith(caches.open(CACHE).then(async cache =>
      await verifiedLegacyLibrary(cache, MAPLIBRE_PATCHED, MAPLIBRE_PATCHED_SHA256) || Response.error()));
    return;
  }
  if (request.method === 'GET' && Object.hasOwn(LEGACY_LIBRARIES, request.url)) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      // Compatibility for old open pages only. An absent legacy copy must
      // not cause a new CDN download, even when the browser is online.
      return await verifiedLegacyLibrary(cache, request.url) || Response.error();
    }));
    return;
  }
  if (request.method !== 'GET' || url.origin !== location.origin) return;
  // Fonts are immutable, optional assets. Fetch only the selected script and
  // retain it offline without making installation download both large files.
  // Rare Han slices (rare-han.mjs) are kept the same way, one per 256
  // characters, with the index that lists them: without it no saved slice is
  // used offline.
  if(/\/fonts\/atlas-cjk-(tc|sc)-v1\.woff2$/.test(url.pathname)||/\/fonts\/rare-han-v1\/([0-9a-f]{3}\.woff2|index\.json)$/.test(url.pathname)){
    // Keeping a copy is best effort: without Cache Storage, or with it full,
    // the downloaded font is still served.
    event.respondWith((async()=>{
      const cache=await caches.open(FONT_CACHE).catch(()=>null);
      const saved=await cache?.match(url.href).catch(()=>null);if(saved)return saved;
      const response=await fetch(request);
      if(response.ok&&cache)await cache.put(url.href,response.clone()).catch(()=>{});
      return response;
    })());return;
  }
  const scope = new URL(self.registration.scope).pathname, page = url.pathname === scope || url.pathname === scope + 'index.html';
  if (request.mode === 'navigate' ? !page : !SHELL.test(url.pathname)) return;
  const version = url.searchParams.get('v');
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const plain = request.mode === 'navigate' ? new URL('./', self.registration.scope).href : url.origin + url.pathname;
    if (version === null && LIBRARIES.some(path => new URL(path, self.registration.scope).href === plain)) {
      const saved = await cache.match(plain);
      if (saved) return saved;
    }
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
