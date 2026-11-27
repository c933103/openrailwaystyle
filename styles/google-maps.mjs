// Repository-admin SSO & Google Maps Platform basemap integration for Railway Atlas.
// - Primary production domain: https://10671435.xyz/ (GitHub Pages) as well as
//   Node/Express deployments (local dev / Cloud Run).
// - Authentication:
//   1. Backend OAuth SSO (/api/auth/* or configured authBackendOrigin) verifying
//      admin permission on c933103/openrailwaystyle via GitHub OAuth / App Manifest.
//   2. Static GitHub Pages fallback: direct browser verification against
//      https://api.github.com/repos/c933103/openrailwaystyle (permissions.admin === true)
//      when deployed purely statically without an OAuth backend.
// - Primary rendering: Google Map Tiles API 2D XYZ tiles streamed into MapLibre's
//   native raster pipeline (googleTiles / google-tiles) so 3D terrain relief and
//   the 3D globe ("Earth view") transform and drape Google tiles natively.
// - Fallback rendering: Maps JavaScript API (#gmaps-underlay) if an API key
//   does not have Map Tiles API enabled.

export const GOOGLE_TILE_SOURCE_ID = 'googleTiles';
export const GOOGLE_TILE_LAYER_ID = 'google-tiles';
export const GOOGLE_PROTOCOL = 'atlasgmaps';
export const DEFAULT_ADMIN_REPO = 'c933103/openrailwaystyle';
export const CANONICAL_SITE_ORIGIN = 'https://10671435.xyz';

export const isImageryOnlyBackground = background => background === 'satellite';

// MapLibre GL JS uses 512px world size at zoom 0, while Google Maps uses 256px
// world size at zoom 0.
export function googleZoomForMapLibre(maplibreZoom, detail = 0) {
  return maplibreZoom - detail + 1;
}

// Road-deemphasized Google Maps style for Roadmap and Terrain:
// - Hides Google's built-in transit lines & stations so Railway Atlas vector
//   railways never double-render or clash.
// - Hides commercial POIs, highway route shields, and local street labels.
// - Simplifies road geometry and mutes highways, arterials, and local streets
//   into low-contrast warm neutral strokes harmonized with Railway Atlas.
export const ROAD_DEEMPHASIZED_STYLES = Object.freeze([
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ visibility: 'on' }, { color: '#e5ece1' }] },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry.fill', stylers: [{ color: '#f3f2ea' }] },
  { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#bfd8e0' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5c7c88' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#dfdace' }] },
  { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#e7e4dc' }] },
  { featureType: 'road.local', elementType: 'geometry.fill', stylers: [{ color: '#efede6' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.local', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#8a867c' }] },
  { featureType: 'road.highway', elementType: 'labels.text.stroke', stylers: [{ color: '#f4f3ec' }, { weight: 2 }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#949086' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.stroke', stylers: [{ color: '#f4f3ec' }, { weight: 2 }] },
  { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#616d69' }] },
]);

export function googleVariantForSettings(settings) {
  if (settings?.background === 'map') {
    return settings?.googleTheme === 'terrain' ? 'terrain' : 'roadmap';
  }
  return 'satellite';
}

export function googleMapOptionsForSettings(settings) {
  const variant = googleVariantForSettings(settings);
  if (variant === 'satellite') return { mapTypeId: 'satellite', styles: [] };
  if (variant === 'terrain') return { mapTypeId: 'terrain', styles: ROAD_DEEMPHASIZED_STYLES };
  return { mapTypeId: 'roadmap', styles: ROAD_DEEMPHASIZED_STYLES };
}

export function googleTileProtocolUrl(variant = 'satellite', language = 'local') {
  const safeVariant = variant === 'roadmap' || variant === 'terrain' ? variant : 'satellite';
  return `${GOOGLE_PROTOCOL}://${safeVariant}/{z}/{x}/{y}?lang=${encodeURIComponent(language || 'local')}`;
}

// Preserve a narrow dateline-crossing viewport instead of presenting it as global.
export function googleLongitudeBounds(west, east) {
  if (!Number.isFinite(west) || !Number.isFinite(east) || Math.abs(east - west) >= 360) {
    return { west: -180, east: 180 };
  }
  const wrap = x => x >= -180 && x <= 180 ? x : ((x + 180) % 360 + 360) % 360 - 180;
  return { west: wrap(west), east: wrap(east) };
}

// Only declare a viewport unsupported when the response positively covers
// it with a lower limit and no overlapping rectangle advertises this zoom.
export function googleViewportHasProvenZoomLimit(rects, bounds, zoom) {
  if (!Array.isArray(rects) || !rects.length ||
      ![bounds.north,bounds.south,bounds.west,bounds.east,zoom].every(Number.isFinite)) return false;
  const intervals = ({west,east}) => west <= east ? [[west,east]] : [[west,180],[-180,east]];
  const viewport = intervals(bounds);
  const valid = rects.filter(rect => rect &&
    [rect.north,rect.south,rect.west,rect.east,rect.maxZoom].every(Number.isFinite) &&
    rect.north > rect.south && rect.north <= 90 && rect.south >= -90 &&
    Math.abs(rect.west) <= 180 && Math.abs(rect.east) <= 180 &&
    rect.maxZoom >= 0 && rect.maxZoom <= 22);
  const overlaps = (a,b) => a[0] < b[1] && a[1] > b[0];
  const contains = (a,b) => a[0] <= b[0] && a[1] >= b[1];
  const intersects = rect => rect.south < bounds.north && rect.north > bounds.south &&
    viewport.some(span => intervals(rect).some(part => overlaps(part,span)));
  if (valid.some(rect => rect.maxZoom >= zoom && intersects(rect))) return false;
  return valid.some(rect => rect.maxZoom < zoom && rect.south <= bounds.south &&
    rect.north >= bounds.north && viewport.every(span => intervals(rect).some(part => contains(part,span))));
}

export function createGoogleTileSourceSpec(variant = 'satellite', language = 'local') {
  return {
    type: 'raster',
    tiles: [googleTileProtocolUrl(variant, language)],
    tileSize: 256,
    minzoom: 0,
    maxzoom: 22,
  };
}

// Use source canonical zoom, not UI zoom or the overscaled display zoom.
export function googleWebGLTileZoom(map, source = createGoogleTileSourceSpec()) {
  const {tileSize,minzoom,maxzoom} = source;
  const covering = map.coveringTiles({tileSize,minzoom,maxzoom,roundZoom:true,terrain:map.terrain});
  return covering.length ? covering.reduce((zoom,tile)=>Math.max(zoom,tile.canonical.z),0) : undefined;
}

export function createGoogleTileLayerSpec() {
  return {
    id: GOOGLE_TILE_LAYER_ID,
    type: 'raster',
    source: GOOGLE_TILE_SOURCE_ID,
    minzoom: 0,
    // Layer maxzoom is exclusive; the map can reach z22 at highest detail.
    maxzoom: 23,
    layout: { visibility: 'none' },
    paint: { 'raster-fade-duration': 0 },
    metadata: {
      'atlas:semantics-version': 1,
      'atlas:group': 'imagery',
      'atlas:category': 'background',
      'atlas:views': [],
      'atlas:settings': [],
      'atlas:initial-hidden': true,
      'atlas:base-map': false,
      'atlas:terrain': false,
      'atlas:runtime': true,
      'atlas:background': 'google',
      'atlas:hide-backgrounds': [],
      'atlas:localize': false,
    },
  };
}

export function installGoogleTileLayer(style, { variant = 'satellite', language = 'local' } = {}) {
  if (!style?.sources || !Array.isArray(style?.layers)) return false;
  style.sources[GOOGLE_TILE_SOURCE_ID] = createGoogleTileSourceSpec(variant, language);
  if (style.layers.some(layer => layer.id === GOOGLE_TILE_LAYER_ID)) return true;
  const satIdx = style.layers.findIndex(layer => layer.id === 'satellite');
  const insertAt = satIdx >= 0 ? satIdx + 1 : 1;
  style.layers.splice(insertAt, 0, createGoogleTileLayerSpec());
  return true;
}

export const GMP_QUOTA_DOCS_URL =
  'https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors';

export function installGoogleMapsQuotaDefense({
  window: win = globalThis.window,
  document: doc = globalThis.document,
  console: con = globalThis.console,
} = {}) {
  if (!win || win.__gmpQuotaDefenseInstalled) return;
  win.__gmpQuotaDefenseInstalled = true;

  const dispatchQuotaExceeded = () => {
    try {
      win.dispatchEvent(new win.CustomEvent('gmp-quota-exceeded'));
    } catch {}
  };

  const prevAuthFailure = win.gm_authFailure;
  win.gm_authFailure = () => {
    dispatchQuotaExceeded();
    if (typeof prevAuthFailure === 'function') prevAuthFailure();
  };

  if (con && typeof con.error === 'function') {
    const origError = con.error.bind(con);
    con.error = (...args) => {
      origError(...args);
      if (args.some(a => typeof a === 'string' && /OverQuotaMapError|QuotaExceededError/.test(a))) {
        dispatchQuotaExceeded();
      }
    };
  }

  win.addEventListener('gmp-quota-exceeded', () => {
    const banner = doc?.getElementById?.('gmp-quota-banner');
    if (banner) banner.hidden = false;
  });

  doc?.getElementById?.('gmp-quota-dismiss')?.addEventListener('click', () => {
    const banner = doc.getElementById('gmp-quota-banner');
    if (banner) banner.hidden = true;
  });
}

export async function checkGmpQuotaResponse(response, win = globalThis.window) {
  const fire = () => {
    try {
      win?.dispatchEvent?.(new win.CustomEvent('gmp-quota-exceeded'));
    } catch {}
  };
  if (response.status === 429) {
    fire();
    return true;
  }
  if (!response.ok) {
    const body = await response.clone().text().catch(() => '');
    if (body.includes('RESOURCE_EXHAUSTED')) {
      fire();
      return true;
    }
  }
  return false;
}

const ADMIN_SESSION_STORAGE_KEY = 'atlas_admin_session';
const ADMIN_PREFS_STORAGE_KEY = 'atlas_admin_prefs';
const DIRECT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function readStoredAdminSession(storage) {
  if (!storage) return null;
  try {
    const raw = JSON.parse(storage.getItem(ADMIN_SESSION_STORAGE_KEY) || 'null');
    if (!raw || typeof raw.token !== 'string' || typeof raw.expiresAt !== 'number') return null;
    if (raw.expiresAt <= Date.now()) {
      storage.removeItem(ADMIN_SESSION_STORAGE_KEY);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function writeStoredAdminSession(storage, session) {
  if (!storage) return;
  try {
    if (!session) storage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    else storage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {}
}

function readStoredAdminPrefs(storage) {
  const defaults = { mapSource: 'standard', googleTheme: 'roadmap' };
  if (!storage) return defaults;
  try {
    const raw = JSON.parse(storage.getItem(ADMIN_PREFS_STORAGE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return defaults;
    return {
      mapSource: raw.mapSource === 'google' ? 'google' : 'standard',
      googleTheme: raw.googleTheme === 'terrain' ? 'terrain' : 'roadmap',
    };
  } catch {
    return defaults;
  }
}

function writeStoredAdminPrefs(storage, prefs) {
  if (!storage) return;
  try {
    if (!prefs) storage.removeItem(ADMIN_PREFS_STORAGE_KEY);
    else storage.setItem(ADMIN_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {}
}

export function isAllowedMessageOrigin(origin, currentOrigin, authBackendOrigin = '') {
  return Boolean(origin && (origin === currentOrigin || origin === authBackendOrigin));
}

function buildDirectSessionBody(variant, safeLang, includeStyles = true) {
  if (variant === 'satellite') {
    return { mapType: 'satellite', language: safeLang, region: 'US' };
  }
  if (variant === 'terrain') {
    return {
      mapType: 'terrain',
      language: safeLang,
      region: 'US',
      layerTypes: ['layerRoadmap'],
      ...(includeStyles ? { styles: ROAD_DEEMPHASIZED_STYLES } : {}),
    };
  }
  return {
    mapType: 'roadmap',
    language: safeLang,
    region: 'US',
    styles: ROAD_DEEMPHASIZED_STYLES,
  };
}

export function createAdminController({
  window: win = globalThis.window,
  document: doc = globalThis.document,
  fetcher = (...args) => globalThis.fetch(...args),
  assetVersion = '20261121-supplied-atlas-rebase-1',
  deploymentConfig: initialDeploymentConfig = {},
  loadMapsLibrary,
  allowStaticTokenFallback = true,
  allowJsFallback = () => true,
  getCamera,
  getViewportBounds,
  getSettings,
  onStateChange,
} = {}) {
  installGoogleMapsQuotaDefense({ window: win, document: doc, console: win?.console });

  const storage = (() => {
    try {
      return win?.sessionStorage ?? null;
    } catch {
      return null;
    }
  })();

  let deploymentConfig = {
    googleMapsKey: typeof initialDeploymentConfig?.googleMapsKey === 'string' ? initialDeploymentConfig.googleMapsKey : '',
    githubClientId: typeof initialDeploymentConfig?.githubClientId === 'string' ? initialDeploymentConfig.githubClientId : '',
    adminRepo: typeof initialDeploymentConfig?.adminRepo === 'string' && initialDeploymentConfig.adminRepo
      ? initialDeploymentConfig.adminRepo
      : DEFAULT_ADMIN_REPO,
    authBackendOrigin: typeof initialDeploymentConfig?.authBackendOrigin === 'string'
      ? initialDeploymentConfig.authBackendOrigin.replace(/\/+$/, '')
      : '',
  };

  let session = readStoredAdminSession(storage);
  if (!allowStaticTokenFallback && session?.staticDirect) {
    session = null;
    writeStoredAdminSession(storage,null);
  }
  let prefs = session ? readStoredAdminPrefs(storage) : { mapSource: 'standard', googleTheme: 'roadmap' };
  let googleMode = null; // 'tiles' | 'js-fallback' | null
  let regionalTileLimit = false;
  const regionalLimitNotice = 'Google imagery is unavailable at this zoom in this area. Showing the standard background.';
  let usingDirectGoogleTiles = false;
  let staticTokenModeRevealed = Boolean(session?.staticDirect);
  const directTileSessions = new Map();
  let fallbackApiKey = null;
  let mapsClassPromise = null;
  let gmap = null;
  let configuredKey = null;
  let sessionChecked = false;
  let viewportTimer = null;
  let viewportRequestId = 0;
  let activeSessionInitKey = null;
  let sessionInitGeneration = 0;
  let activeInitSession = null;
  let activeSessionPromise = null;

  const $ = id => doc?.getElementById?.(id) ?? null;

  function apiUrl(path) {
    return deploymentConfig.authBackendOrigin ? `${deploymentConfig.authBackendOrigin}${path}` : path;
  }

  function effectiveDirectGoogleKey() {
    if (deploymentConfig.googleMapsKey) return deploymentConfig.googleMapsKey;
    const viteKey = import.meta?.env?.VITE_GOOGLE_MAPS_API_KEY;
    return typeof viteKey === 'string' ? viteKey.trim() : '';
  }

  function setStatus(message, isError = false) {
    const statusEl = $('admin-status');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.hidden = !message;
    statusEl.classList.toggle('error', Boolean(message && isError));
  }

  function authHeaders(extra = {}) {
    return {
      ...extra,
      ...(session?.token && !session.staticDirect ? { Authorization: `Bearer ${session.token}` } : {}),
    };
  }

  function isGoogleActiveForBackground(background) {
    return Boolean(session) && prefs.mapSource === 'google' && ['map', 'satellite', 'hybrid'].includes(background);
  }

  function syncUI() {
    const unlocked = Boolean(session);
    const settings = getSettings?.() || { background: 'map' };
    const googleActive = isGoogleActiveForBackground(settings.background);
    const usingTiles = googleActive && googleMode === 'tiles' && !regionalTileLimit;
    const usingJsFallback = googleActive && googleMode === 'js-fallback';

    const signinBtn = $('admin-github-signin');
    const signoutBtn = $('admin-signout');
    const staticTokenRow = $('admin-static-token-row');
    const controlsWrap = $('admin-controls');
    const userLabel = $('admin-user-label');
    const sourceSelect = $('admin-map-source');
    const themeRow = $('admin-google-theme-row');
    const themeSelect = $('admin-google-theme');

    if (signinBtn) signinBtn.hidden = unlocked;
    if (signoutBtn) signoutBtn.hidden = !unlocked;
    if (staticTokenRow) staticTokenRow.hidden = unlocked || !staticTokenModeRevealed;
    if (controlsWrap) controlsWrap.hidden = !unlocked;
    if (userLabel) {
      userLabel.textContent = unlocked
        ? `Signed in as @${session.login || 'admin'} (${session.repo || deploymentConfig.adminRepo})`
        : 'Sign in with GitHub (repository admin access required) to unlock Google Maps data sources.';
    }
    if (sourceSelect && sourceSelect.value !== prefs.mapSource) {
      sourceSelect.value = prefs.mapSource;
    }
    if (themeRow) {
      themeRow.hidden = !(unlocked && prefs.mapSource === 'google');
    }
    if (themeSelect && themeSelect.value !== prefs.googleTheme) {
      themeSelect.value = prefs.googleTheme;
    }

    if (doc?.body) {
      if (usingTiles || usingJsFallback) doc.body.dataset.gmapsActive = 'true';
      else delete doc.body.dataset.gmapsActive;
    }

    const underlay = $('gmaps-underlay');
    if (underlay) underlay.hidden = !usingJsFallback;

    const attributionBar = $('gmaps-attribution');
    if (attributionBar) attributionBar.hidden = !usingTiles;
  }

  function emitStateChange() {
    syncUI();
    onStateChange?.({
      unlocked: Boolean(session),
      mapSource: session ? prefs.mapSource : 'standard',
      googleTheme: prefs.googleTheme,
      googleMode: session && prefs.mapSource === 'google' && !regionalTileLimit ? googleMode : null,
    });
  }

  function clearExpiredOrRevokedSession(message = '') {
    session = null;
    prefs = { mapSource: 'standard', googleTheme: 'roadmap' };
    googleMode = null;
    regionalTileLimit = false;
    usingDirectGoogleTiles = false;
    fallbackApiKey = null;
    activeSessionInitKey = null;
    activeSessionPromise = null;
    writeStoredAdminSession(storage, null);
    if (message) setStatus(message, true);
    emitStateChange();
  }

  async function ensureJsFallbackMap(isCurrent) {
    const underlay = $('gmaps-underlay');
    if (!underlay || !fallbackApiKey) return null;
    if (!mapsClassPromise) {
      mapsClassPromise = (async () => {
        if (typeof loadMapsLibrary === 'function') {
          return loadMapsLibrary(fallbackApiKey);
        }
        const loaderUrl = new URL(`./vendor/google-maps-loader.js?v=${encodeURIComponent(assetVersion)}`, import.meta.url);
        const { setOptions, importLibrary } = await import(loaderUrl.href);
        if (configuredKey !== fallbackApiKey) {
          setOptions({ key: fallbackApiKey, v: 'weekly' });
          configuredKey = fallbackApiKey;
        }
        return importLibrary('maps');
      })().catch(err => {
        mapsClassPromise = null;
        throw err;
      });
    }
    const { Map: GoogleMap } = await mapsClassPromise;
    if (!isCurrent()) return null;
    const camera = getCamera?.() || { center: { lat: 23, lng: 15 }, zoom: 2.8 };
    const settings = getSettings?.() || { background: 'map', googleTheme: prefs.googleTheme };
    const { mapTypeId, styles } = googleMapOptionsForSettings(settings);

    if (!gmap) {
      gmap = new GoogleMap(underlay, {
        center: camera.center,
        zoom: camera.zoom,
        heading: 0,
        tilt: 0,
        mapTypeId,
        styles,
        isFractionalZoomEnabled: true,
        disableDefaultUI: true,
        keyboardShortcuts: false,
        gestureHandling: 'none',
        clickableIcons: false,
        backgroundColor: 'transparent',
        internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
      });
    } else {
      gmap.setOptions({ mapTypeId, styles });
      gmap.moveCamera({ center: camera.center, zoom: camera.zoom, heading: 0, tilt: 0 });
    }
    return gmap;
  }

  async function ensureDirectBrowserTileSession(variant, language = 'en-US') {
    const apiKey = effectiveDirectGoogleKey();
    if (!apiKey) {
      return {
        ok: false,
        status: 503,
        error: 'Google Maps API key is not configured. Set the GOOGLE_MAPS_API_KEY repository variable (restricted to https://10671435.xyz/*) in GitHub Actions settings.',
      };
    }
    const safeLang = language && language !== 'local' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)
      ? language
      : 'en-US';
    const cacheKey = `${apiKey.slice(0, 8)}:${variant}:${safeLang}`;
    const cached = directTileSessions.get(cacheKey);
    if (cached && cached.expiresAtMs - Date.now() > 5 * 60 * 1000) {
      return { ok: true, session: cached.session, apiKey };
    }

    const createUrl = `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(apiKey)}`;
    let res = await fetcher(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildDirectSessionBody(variant, safeLang, true)),
    });
    if (res.status === 400 && variant === 'terrain') {
      res = await fetcher(createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildDirectSessionBody(variant, safeLang, false)),
      });
    }
    await checkGmpQuotaResponse(res, win);
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const serviceDisabled = res.status === 403 && !/RESOURCE_EXHAUSTED|quota/i.test(text);
      return {
        ok: false,
        status: res.status,
        serviceDisabled,
        apiKey,
        error: text.slice(0, 300) || `Google Map Tiles createSession returned ${res.status}`,
      };
    }
    let parsed = {};
    try {
      parsed = JSON.parse(text);
    } catch {}
    if (!parsed.session) {
      return { ok: false, status: 502, error: 'Google Map Tiles response lacked a session token.' };
    }
    const expirySeconds = Number(parsed.expiry);
    const expiresAtMs = Number.isFinite(expirySeconds) && expirySeconds > 0
      ? expirySeconds * 1000
      : Date.now() + 24 * 60 * 60 * 1000;
    directTileSessions.set(cacheKey, { session: parsed.session, expiresAtMs });
    return { ok: true, session: parsed.session, apiKey };
  }

  async function initDirectGoogleSource(variant, language, isCurrent) {
    const direct = await ensureDirectBrowserTileSession(variant, language);
    if (!isCurrent()) return;
    if (direct.ok) {
      usingDirectGoogleTiles = true;
      regionalTileLimit = false;
      googleMode = 'tiles';
      setStatus('', false);
      emitStateChange();
      onViewportChange(true);
      return;
    }
    if (direct.serviceDisabled && direct.apiKey && allowJsFallback()) {
      usingDirectGoogleTiles = false;
      regionalTileLimit = false;
      googleMode = 'js-fallback';
      fallbackApiKey = direct.apiKey;
      setStatus(
        'Map Tiles API is not enabled on this API key; using Maps JavaScript API fallback in flat 2D view. Enable Map Tiles API in Google Cloud Console to drape Google tiles on 3D terrain and the 3D globe.',
        false,
      );
      emitStateChange();
      await ensureJsFallbackMap(isCurrent);
      if (isCurrent()) syncCamera();
      return;
    }
    activeSessionInitKey = null;
    activeSessionPromise = null;
    googleMode = null;
    regionalTileLimit = false;
    usingDirectGoogleTiles = false;
    prefs = { ...prefs, mapSource: 'standard' };
    writeStoredAdminPrefs(storage, prefs);
    setStatus(direct.error || 'Could not initialize Google Maps session.', true);
    emitStateChange();
  }

  async function ensureGoogleSourceReady() {
    const settings = getSettings?.() || { background: 'map', language: 'local' };
    if (!isGoogleActiveForBackground(settings.background)) {
      sessionInitGeneration++;
      activeSessionInitKey = null;
      activeSessionPromise = null;
      syncUI();
      return;
    }
    const variant = googleVariantForSettings({ ...settings, googleTheme: prefs.googleTheme });
    const language = settings.language || 'local';
    const requestedSession = session;
    const initKey = `${session.login || 'admin'}:${session.staticDirect ? 'direct' : 'api'}:${variant}:${language}`;
    if (activeSessionInitKey === initKey && activeInitSession === session && activeSessionPromise) {
      return activeSessionPromise;
    }
    activeSessionInitKey = initKey;
    activeInitSession = requestedSession;
    const generation = ++sessionInitGeneration;
    const isCurrent = () => {
      const current = getSettings?.() || { background: 'map', language: 'local' };
      return sessionInitGeneration === generation && activeSessionInitKey === initKey
        && session === requestedSession && isGoogleActiveForBackground(current.background)
        && (current.language || 'local') === language
        && googleVariantForSettings({ ...current, googleTheme: prefs.googleTheme }) === variant;
    };
    activeSessionPromise = (async () => {
      try {
        if (session.staticDirect) {
          await initDirectGoogleSource(variant, language, isCurrent);
          return;
        }
        const response = await fetcher(apiUrl('/api/gmaps/session'), {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ variant, language }),
          cache: 'no-store',
        });
        if (!isCurrent()) return;
        if ((response.status === 404 || response.status === 405) && effectiveDirectGoogleKey()) {
          await initDirectGoogleSource(variant, language, isCurrent);
          return;
        }
        await checkGmpQuotaResponse(response, win);
        const data = await response.json().catch(() => ({}));
        if (!isCurrent()) return;
        if (response.status === 401) {
          clearExpiredOrRevokedSession(data.error || 'Admin session expired. Sign in with GitHub again.');
          return;
        }
        if (!response.ok || !data.unlocked) {
          activeSessionInitKey = null;
          activeSessionPromise = null;
          googleMode = null;
          prefs = { ...prefs, mapSource: 'standard' };
          writeStoredAdminPrefs(storage, prefs);
          setStatus(data.error || `Google Maps could not start (${response.status}).`, true);
          emitStateChange();
          return;
        }
        if (!session || prefs.mapSource !== 'google') return;
        if (data.mode === 'js-fallback' && (!allowJsFallback() || !data.apiKey)) {
          googleMode = null;
          prefs = {...prefs,mapSource:'standard'};
          writeStoredAdminPrefs(storage,prefs);
          setStatus('Google 2D Map Tiles are unavailable; the standard background remains active.',true);
          emitStateChange();
          return;
        }
        if (data.mode === 'js-fallback') {
          usingDirectGoogleTiles = false;
          regionalTileLimit = false;
          googleMode = 'js-fallback';
          fallbackApiKey = data.apiKey || null;
          setStatus(data.note || 'Using Google Maps JS fallback.', false);
          emitStateChange();
          await ensureJsFallbackMap(isCurrent);
          if (isCurrent()) syncCamera();
          return;
        }
        usingDirectGoogleTiles = false;
        regionalTileLimit = false;
        googleMode = 'tiles';
        setStatus('', false);
        emitStateChange();
        onViewportChange(true);
      } catch (err) {
        if (!isCurrent()) return;
        if (effectiveDirectGoogleKey()) {
          try {
            await initDirectGoogleSource(variant, language, isCurrent);
            return;
          } catch (directError) {
            if (!isCurrent()) return;
            err = directError;
          }
        }
        activeSessionInitKey = null;
        activeSessionPromise = null;
        googleMode = null;
        prefs = {...prefs,mapSource:'standard'};
        writeStoredAdminPrefs(storage,prefs);
        setStatus(err?.message || 'Could not initialize Google Maps session.', true);
        emitStateChange();
      }
    })();
    return activeSessionPromise;
  }

  async function fetchTile(params, abortController) {
    if (session && session.expiresAt <= Date.now()) clearExpiredOrRevokedSession('Admin session expired.');
    if (!session || prefs.mapSource !== 'google' || googleMode !== 'tiles') throw new Error('Google Maps requires an active admin tile session.');
    if (regionalTileLimit) throw new Error('Google tiles are not available for this viewport.');
    const requestSession = session;
    const raw = String(params?.url || '').slice(`${GOOGLE_PROTOCOL}://`.length);
    const [pathPart, queryPart = ''] = raw.split('?');
    const match = /^(satellite|roadmap|terrain)\/(\d+)\/(\d+)\/(\d+)$/.exec(pathPart);
    if (!match) throw new Error('Invalid Google tile coordinate.');
    const [, variant, z, x, y] = match;
    const lang = new URLSearchParams(queryPart).get('lang') || 'local';

    if (usingDirectGoogleTiles || session.staticDirect) {
      const direct = await ensureDirectBrowserTileSession(variant, lang);
      if (!direct.ok) throw new Error(direct.error || `Google tile session failed (${direct.status})`);
      const tileUrl = `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(direct.session)}&key=${encodeURIComponent(direct.apiKey)}`;
      const res = await fetcher(tileUrl, { signal: abortController?.signal });
      await checkGmpQuotaResponse(res, win);
      if (!res.ok) throw new Error(`Google tile returned ${res.status}`);
      return { data: await res.arrayBuffer() };
    }

    const response = await fetcher(
      apiUrl(`/api/gmaps/tiles/${variant}/${z}/${x}/${y}?lang=${encodeURIComponent(lang)}`),
      {
        method: 'GET',
        headers: authHeaders(),
        cache: 'no-store',
        signal: abortController?.signal,
      },
    );
    await checkGmpQuotaResponse(response, win);
    if (response.status === 401 && session === requestSession) {
      clearExpiredOrRevokedSession('Admin session expired. Sign in with GitHub again.');
      throw new Error('Admin session expired.');
    }
    if (!response.ok) {
      throw new Error(`Google tile returned ${response.status}`);
    }
    return { data: await response.arrayBuffer() };
  }

  function buildDirectTileUrl(variant, z, x, y) {
    if (!session) return null;
    const safeVariant = variant === 'roadmap' || variant === 'terrain' ? variant : 'satellite';
    const lang = getSettings?.()?.language || 'local';
    if (usingDirectGoogleTiles || session.staticDirect) {
      const apiKey = effectiveDirectGoogleKey();
      if (!apiKey) return null;
      const safeLang = lang && lang !== 'local' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(lang) ? lang : 'en-US';
      const cached = directTileSessions.get(`${apiKey.slice(0, 8)}:${safeVariant}:${safeLang}`);
      if (!cached?.session) return null;
      return `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(cached.session)}&key=${encodeURIComponent(apiKey)}`;
    }
    // The current Canvas renderer uses fetchTile and an Authorization header.
    // Never place a backend bearer session in a URL.
    return null;
  }

  function onViewportChange(immediate = false) {
    const requestId = ++viewportRequestId;
    if (viewportTimer) clearTimeout(viewportTimer);
    const settings = getSettings?.() || { background: 'map', language: 'local' };
    if (!isGoogleActiveForBackground(settings.background) || googleMode !== 'tiles') return;
    const requestSession = session;
    const variant = googleVariantForSettings({ ...settings, googleTheme: prefs.googleTheme });
    const language = settings.language || 'local';
    const isCurrent = () => {
      const current = getSettings?.() || { background: 'map', language: 'local' };
      return requestId === viewportRequestId && requestSession === session
        && googleMode === 'tiles' && isGoogleActiveForBackground(current.background)
        && variant === googleVariantForSettings({ ...current, googleTheme: prefs.googleTheme })
        && language === (current.language || 'local');
    };
    const run = async () => {
      viewportTimer = null;
      if (!isCurrent()) return;
      try {
        const bounds = getViewportBounds?.();
        if (!bounds || !Number.isFinite(bounds.zoom)) return;
        const zoom = String(Math.max(0, Math.min(22, Math.round(bounds.zoom))));
        const north = String(Math.max(bounds.north ?? 85, bounds.south ?? -85));
        const south = String(Math.min(bounds.north ?? 85, bounds.south ?? -85));
        const east = String(bounds.east ?? 180);
        const west = String(bounds.west ?? -180);
        let res;
        if (usingDirectGoogleTiles || session.staticDirect) {
          const direct = await ensureDirectBrowserTileSession(variant, language);
          if (!direct.ok || !isCurrent()) return;
          const vpUrl = new URL('https://tile.googleapis.com/tile/v1/viewport');
          vpUrl.searchParams.set('session', direct.session);
          vpUrl.searchParams.set('key', direct.apiKey);
          vpUrl.searchParams.set('zoom', zoom);
          vpUrl.searchParams.set('north', north);
          vpUrl.searchParams.set('south', south);
          vpUrl.searchParams.set('east', east);
          vpUrl.searchParams.set('west', west);
          res = await fetcher(vpUrl.href);
        } else {
          const params = new URLSearchParams({
            variant,
            zoom,
            north,
            south,
            east,
            west,
            lang: language,
          });
          res = await fetcher(apiUrl(`/api/gmaps/viewport?${params}`), {
            method: 'GET',
            headers: authHeaders(),
            cache: 'no-store',
          });
        }
        if (!res?.ok) return;
        const data = await res.json().catch(() => ({}));
        if (!isCurrent()) return;
        const copyEl = $('gmaps-copyright');
        if (copyEl) {
          copyEl.textContent = typeof data.copyright === 'string' && data.copyright
            ? data.copyright
            : 'Map data © Google';
        }
        const limited = googleViewportHasProvenZoomLimit(data.maxZoomRects,
          {north:Number(north),south:Number(south),east:Number(east),west:Number(west)}, Number(zoom));
        if (limited !== regionalTileLimit) {
          regionalTileLimit = limited;
          setStatus(limited ? regionalLimitNotice : '');
          emitStateChange();
        }
      } catch {}
    };
    if (immediate) void run();
    else viewportTimer = setTimeout(run, 350);
  }

  function syncCamera() {
    const settings = getSettings?.() || { background: 'map' };
    if (!gmap || !isGoogleActiveForBackground(settings.background) || googleMode !== 'js-fallback') return;
    const camera = getCamera?.();
    if (!camera) return;
    gmap.moveCamera({
      center: camera.center,
      zoom: camera.zoom,
      heading: 0,
      tilt: 0,
    });
  }

  function resize() {
    const settings = getSettings?.() || { background: 'map' };
    if (!gmap || !isGoogleActiveForBackground(settings.background) || googleMode !== 'js-fallback') return;
    win?.google?.maps?.event?.trigger?.(gmap, 'resize');
    syncCamera();
  }

  async function checkSessionIfNeeded() {
    if (sessionChecked) return;
    sessionChecked = true;
    if (session?.staticDirect) {
      if (prefs.mapSource === 'google') void ensureGoogleSourceReady();
      return;
    }
    try {
      const response = await fetcher(apiUrl('/api/auth/session'), {
        method: 'GET',
        headers: authHeaders(),
        cache: 'no-store',
      });
      if (!response.ok) return;
      const data = await response.json().catch(() => ({}));
      if (data.authenticated && data.admin) {
        if (!session) {
          session = {
            token: '',
            login: data.login,
            repo: data.repo,
            expiresAt: data.expiresAt || Date.now() + 3600_000,
          };
          prefs = readStoredAdminPrefs(storage);
        }
        emitStateChange();
        if (prefs.mapSource === 'google') void ensureGoogleSourceReady();
      } else if (session) {
        clearExpiredOrRevokedSession('');
      }
    } catch {}
  }

  function revealStaticTokenFallback() {
    if (!allowStaticTokenFallback) {
      setStatus('The administrator authentication backend is unavailable.',true);
      return;
    }
    staticTokenModeRevealed = true;
    syncUI();
    setStatus(
      `Static GitHub Pages mode (${win?.location?.hostname || '10671435.xyz'}): enter a GitHub token with repository read access to verify admin permission on ${deploymentConfig.adminRepo}.`,
      false,
    );
    $('admin-github-token')?.focus?.();
  }

  async function verifyWithGitHubToken(rawToken) {
    if (!allowStaticTokenFallback) return false;
    const pat = String(rawToken || '').trim();
    if (!pat) {
      setStatus('Paste a GitHub personal access token to verify repository admin access.', true);
      return false;
    }
    const verifyBtn = $('admin-github-token-verify');
    if (verifyBtn) verifyBtn.disabled = true;
    setStatus('Verifying GitHub repository admin permission…', false);

    const ghHeaders = {
      Authorization: `Bearer ${pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const targetRepo = deploymentConfig.adminRepo || DEFAULT_ADMIN_REPO;

    try {
      const [userRes, repoRes] = await Promise.all([
        fetcher('https://api.github.com/user', { headers: ghHeaders, cache: 'no-store' }),
        fetcher(`https://api.github.com/repos/${targetRepo}`, { headers: ghHeaders, cache: 'no-store' }),
      ]);
      if (!userRes.ok) {
        setStatus('Invalid or expired GitHub token. Check the token and try again.', true);
        return false;
      }
      const userData = await userRes.json().catch(() => ({}));
      const login = String(userData?.login || '').trim();
      if (!login) {
        setStatus('GitHub profile returned no username.', true);
        return false;
      }

      const repoData = repoRes.ok ? await repoRes.json().catch(()=>({})) : {};
      const isAdmin = Number.isSafeInteger(userData.id) && userData.id === repoData.owner?.id;
      if (!isAdmin) {
        setStatus(
          `@${login} does not have admin permission on ${targetRepo} (ensure the token includes public_repo / Metadata read access).`,
          true,
        );
        return false;
      }

      const tokenInput = $('admin-github-token');
      if (tokenInput) tokenInput.value = '';
      session = {
        token: 'static-github-verified',
        staticDirect: true,
        login,
        repo: targetRepo,
        expiresAt: Date.now() + DIRECT_SESSION_TTL_MS,
      };
      sessionChecked = true;
      writeStoredAdminSession(storage, session);
      prefs = readStoredAdminPrefs(storage);
      setStatus('', false);
      emitStateChange();
      if (prefs.mapSource === 'google') {
        void ensureGoogleSourceReady();
      }
      return true;
    } catch {
      setStatus('Could not reach api.github.com to verify repository permissions.', true);
      return false;
    } finally {
      if (verifyBtn) verifyBtn.disabled = false;
    }
  }

  async function signInWithGitHub() {
    const btn = $('admin-github-signin');
    if (btn) btn.disabled = true;
    setStatus('Connecting to GitHub…', false);

    // Open popup synchronously inside user gesture to prevent popup blockers.
    const popup = win?.open?.('about:blank', 'github_oauth_popup', 'width=620,height=720');
    if (!popup) {
      if (btn) btn.disabled = false;
      setStatus('Popup was blocked by the browser. Allow popups for this site and click Sign in with GitHub again.', true);
      return false;
    }

    try {
      const origin = win?.location?.origin || CANONICAL_SITE_ORIGIN;
      const response = await fetcher(apiUrl(`/api/auth/github/url?origin=${encodeURIComponent(origin)}`), {
        method: 'GET',
        cache: 'no-store',
      });
      if (response.status === 404 || response.status === 405) {
        popup.close?.();
        revealStaticTokenFallback();
        return false;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        popup.close?.();
        setStatus(data.error || `GitHub sign-in unavailable (${response.status}).`, true);
        return false;
      }

      if (data.mode === 'manifest' && data.actionUrl && data.manifest && doc?.body) {
        setStatus('Complete one-time GitHub App setup & authorization in the popup window…', false);
        const form = doc.createElement('form');
        form.method = 'POST';
        form.action = data.actionUrl;
        form.target = 'github_oauth_popup';
        form.hidden = true;
        const input = doc.createElement('input');
        input.type = 'hidden';
        input.name = 'manifest';
        input.value = data.manifest;
        form.append(input);
        doc.body.append(form);
        form.submit();
        form.remove();
        return true;
      }

      if (!data.url) {
        popup.close?.();
        setStatus('GitHub authorization URL was missing.', true);
        return false;
      }

      popup.location.href = data.url;
      setStatus('Waiting for GitHub sign-in in the popup window…', false);
      return true;
    } catch {
      popup.close?.();
      if (!deploymentConfig.authBackendOrigin) {
        revealStaticTokenFallback();
        return false;
      }
      setStatus('Could not start GitHub sign-in. Check your connection and try again.', true);
      return false;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function signOut() {
    const wasStatic = Boolean(session?.staticDirect);
    session = null;
    prefs = { mapSource: 'standard', googleTheme: 'roadmap' };
    googleMode = null;
    regionalTileLimit = false;
    usingDirectGoogleTiles = false;
    fallbackApiKey = null;
    activeSessionInitKey = null;
    activeSessionPromise = null;
    directTileSessions.clear();
    writeStoredAdminSession(storage, null);
    writeStoredAdminPrefs(storage, null);
    setStatus('Signed out of admin session.', false);
    if (!wasStatic) {
      fetcher(apiUrl('/api/auth/logout'), { method: 'POST', cache: 'no-store', credentials:'include' }).catch(() => {});
    }
    emitStateChange();
  }

  function handleOAuthMessage(event) {
    if (!isAllowedMessageOrigin(event?.origin, win?.location?.origin, deploymentConfig.authBackendOrigin)) return;
    const payload = event?.data;
    if (!payload || typeof payload !== 'object') return;
    if (payload.type === 'OAUTH_AUTH_SUCCESS' && payload.session?.token) {
      session = {
        token: payload.session.token,
        login: payload.session.login,
        repo: payload.session.repo,
        expiresAt: payload.session.expiresAt,
      };
      sessionChecked = true;
      writeStoredAdminSession(storage, session);
      prefs = readStoredAdminPrefs(storage);
      setStatus('', false);
      emitStateChange();
      if (prefs.mapSource === 'google') {
        void ensureGoogleSourceReady();
      }
    } else if (payload.type === 'OAUTH_AUTH_ERROR') {
      setStatus(payload.error || 'GitHub sign-in did not complete.', true);
    }
  }

  function setDeploymentConfig(nextConfig = {}) {
    if (!nextConfig || typeof nextConfig !== 'object') return;
    deploymentConfig = {
      googleMapsKey: typeof nextConfig.googleMapsKey === 'string' && nextConfig.googleMapsKey
        ? nextConfig.googleMapsKey
        : deploymentConfig.googleMapsKey,
      githubClientId: typeof nextConfig.githubClientId === 'string' && nextConfig.githubClientId
        ? nextConfig.githubClientId
        : deploymentConfig.githubClientId,
      adminRepo: typeof nextConfig.adminRepo === 'string' && nextConfig.adminRepo
        ? nextConfig.adminRepo
        : deploymentConfig.adminRepo,
      authBackendOrigin: typeof nextConfig.authBackendOrigin === 'string' && nextConfig.authBackendOrigin
        ? nextConfig.authBackendOrigin.replace(/\/+$/, '')
        : deploymentConfig.authBackendOrigin,
    };
    activeSessionInitKey = null;
    if (session && prefs.mapSource === 'google') {
      void ensureGoogleSourceReady();
    }
  }

  function bindDOM() {
    win?.addEventListener?.('message', handleOAuthMessage);

    $('admin-settings')?.addEventListener('toggle', event => {
      if (event.currentTarget?.open) void checkSessionIfNeeded();
    });

    $('admin-github-signin')?.addEventListener('click', () => {
      void signInWithGitHub();
    });

    $('admin-github-token-verify')?.addEventListener('click', () => {
      void verifyWithGitHubToken($('admin-github-token')?.value);
    });

    $('admin-github-token')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void verifyWithGitHubToken(event.currentTarget.value);
      }
    });

    $('admin-signout')?.addEventListener('click', () => {
      void signOut();
    });

    $('admin-map-source')?.addEventListener('change', event => {
      if (!session) return;
      const nextSource = event.currentTarget.value === 'google' ? 'google' : 'standard';
      prefs = { ...prefs, mapSource: nextSource };
      googleMode = null;
      if (regionalTileLimit) setStatus('');
      regionalTileLimit = false;
      activeSessionInitKey = null;
      activeSessionPromise = null;
      writeStoredAdminPrefs(storage, prefs);
      emitStateChange();
      if (nextSource === 'google') {
        void ensureGoogleSourceReady();
      }
    });

    $('admin-google-theme')?.addEventListener('change', event => {
      if (!session) return;
      const nextTheme = event.currentTarget.value === 'terrain' ? 'terrain' : 'roadmap';
      prefs = { ...prefs, googleTheme: nextTheme };
      activeSessionInitKey = null;
      writeStoredAdminPrefs(storage, prefs);
      emitStateChange();
      if (prefs.mapSource === 'google') {
        void ensureGoogleSourceReady();
      }
    });

    emitStateChange();
    if (session) {
      void checkSessionIfNeeded();
      if (prefs.mapSource === 'google') {
        void ensureGoogleSourceReady();
      }
    }
  }

  return {
    get isUnlocked() {
      return Boolean(session);
    },
    get mapSource() {
      return session ? prefs.mapSource : 'standard';
    },
    get googleTheme() {
      return prefs.googleTheme;
    },
    get googleMode() {
      return session && prefs.mapSource === 'google' && !regionalTileLimit ? googleMode : null;
    },
    setDeploymentConfig,
    verifyWithGitHubToken,
    bindDOM,
    checkSessionIfNeeded,
    signInWithGitHub,
    signOut,
    ensureGoogleSourceReady,
    fetchTile,
    buildDirectTileUrl,
    onViewportChange,
    syncCamera,
    resize,
    syncUI,
  };
}
