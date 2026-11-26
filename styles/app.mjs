import {installSovietStyle, sovietTile} from './soviet-topo.mjs?v=20261126-canvas-basemap-sync-1';
import {bindTerrainViewport} from './viewport-settle.mjs?v=20261126-canvas-basemap-sync-1';
import {pruneModeTiles} from './mode-tile-cache.mjs?v=20261126-canvas-basemap-sync-1';
import {updateMapStatus} from './status-ui.mjs?v=20261126-canvas-basemap-sync-1';
import {renderLegendUI} from './legend-ui.mjs?v=20261126-canvas-basemap-sync-1';
import {createInspectorRows, createFeatureInspector} from './feature-inspector.mjs?v=20261126-canvas-basemap-sync-1';

import {dataAgeRows, staleNotice} from './data-ages.mjs?v=20261126-canvas-basemap-sync-1';
import {installHiddenTileMaskGuard, installControlLayout, rememberAttribution, installPwaInstall, backportMapLibre524, MAPLIBRE_BACKPORT} from './map-controls.mjs?v=20261126-canvas-basemap-sync-1';
import {CJK_FONTS, PROBE_FAMILY, PROBE_FONT, PROBE_SETS, familyNames, chooseCjkFont, isLocalFamily} from './cjk-font.mjs?v=20261126-canvas-basemap-sync-1';
import {RARE_HAN_FAMILY, createRareHanFonts, rareHanBlocks} from './rare-han.mjs?v=20261126-canvas-basemap-sync-1';
import {createWorldFonts} from './world-font.mjs?v=20261126-canvas-basemap-sync-1';
import {hasMongolian, mongolianBlocks, mongolianFontRequests, nameFragment} from './mongolian-text.mjs?v=20261126-canvas-basemap-sync-1';

import {contextIcon, contextLayerInteractive, nearbyTransport} from './context.mjs?v=20261126-canvas-basemap-sync-1';
import {SETTING_KEYS, SETTING_PARAMS, settingsQuery, UNKNOWN_COLOR, INFRASTRUCTURE, controlColor, trainProtection, trainProtectionShort, trainProtectionSystems, gaugeColor, axleLoad, formatAxleLoad, axleLabel, loadingGauge, loadingDimensions, VIEW_LINE_LAYERS, viewLinePaint, viewLineWidth, inactivePaint, describeCurrent, DEM_URL, contourOptions, speedPaint, speedLabel, SEARCH_API, PLACE_SEARCH_API, searchResponse, searchResults, railwaySearchRows, tileStations, drawnStationQueries, LANGUAGES, chooseName, labelExpression, displayName, legendRows, autoProjection, ORM, DETAIL_LEVELS, formatReadout, osmObject, createPlatformLengths, createPlatformTileGeometry, platformLengthLabel, formatPlatformLength, readSettings, formatSpeed, stationRank, decodeLifecycleTile, isNeutralRailReference} from './map-model.mjs?v=20261126-canvas-basemap-sync-1';

import {Drawing, Measure, readDrawing, lengthKm, formatLength, formatClimb, climb} from './draw.mjs?v=20261126-canvas-basemap-sync-1';
import {createElevation, createSurfaceElevation, alongLine, profileStats, profileSegments} from './elevation.mjs?v=20261126-canvas-basemap-sync-1';
import {stationDepartures, plannerLink, TRANSITOUS_SOURCES} from './departures.mjs?v=20261126-canvas-basemap-sync-1';
import {departureItem} from './departures-ui.mjs?v=20261126-canvas-basemap-sync-1';
import {installGlobeDrag, allowPolarCentres, readoutZoom, viewHash, parseViewHash} from './globe-drag.mjs?v=20261126-canvas-basemap-sync-1';
import {installBathymetry, shareArchiveRequests, seabedContourOpacity} from './bathymetry.mjs?v=20261126-canvas-basemap-sync-1';
import {installTerrain3D, syncTerrain3D, terrain3DEnabled, terrain3DSelectedForPitch, terrain3DViewTarget, terrainExaggeration, syncHighPitchTileBudget, TERRAIN_3D_MAX_PITCH, HIGH_PITCH_TILE_CACHE_LIMIT} from './terrain-3d.mjs?v=20261126-canvas-basemap-sync-1';
import {installKeyboardPan} from './keyboard-pan.mjs?v=20261126-canvas-basemap-sync-1';
import {annotateLayers, layerVisibility, shouldLocalizeLayer, installHybridRailCasings} from './layer-semantics.mjs?v=20261126-canvas-basemap-sync-1';
import {createPowerFacilityLoader, electricitySignalRows, POWER_FACILITY_EXPLANATION} from './power-facilities.mjs?v=20261126-canvas-basemap-sync-1';
import {serviceFrequencyPaint, nearestServiceFeature, frequencyAvailability, frequencyAttribution, selectedFrequencyProfile, FREQUENCY_LABELS, HOURLY_PROFILES, installFrequencyExpiry} from './service-frequency.mjs?v=20261126-canvas-basemap-sync-1';
import {installWatchGesture} from './watch-map.mjs?v=20261126-canvas-basemap-sync-1';
import {createRailProviderRecovery, createSourceFailures} from './rail-provider-recovery.mjs?v=20261126-canvas-basemap-sync-1';
import {createEnergyNetworkProtocol} from './energy-network.mjs?v=20261126-canvas-basemap-sync-1';
import {createBundleReader} from './tile-bundles.mjs?v=20261126-canvas-basemap-sync-1';
import {createReferenceReader} from './mainline-reference.mjs?v=20261126-canvas-basemap-sync-1';
import {addStationFallbackLayers, createStationFallbackState, createRailReferenceState, createReferenceRefresh, stationFallbackFilter, stationFallbackNamesEnabled, stationFallbackMarkersEnabled, shouldRefreshCuratedStationSource} from './station-fallback.mjs?v=20261126-canvas-basemap-sync-1';
import {installWorldStationLifecycle, createStationViewPaint, WORLD_STATION_SOURCE, WORLD_STATION_DOTS, WORLD_STATION_SUPERSEDED_DOTS} from './station-world.mjs?v=20261126-canvas-basemap-sync-1';
import {loadImageryConfig, applyImageryConfig, createImageryProtocol, installImageryAttribution, PROVIDER_ATTRIBUTION} from './imagery.mjs?v=20261126-canvas-basemap-sync-1';
import {createSharedTileProtocols} from './shared-tile-protocols.mjs?v=20261126-canvas-basemap-sync-1';

const $ = id => document.getElementById(id);
$('help-power').textContent = POWER_FACILITY_EXPLANATION;
// The controls work as soon as this small module runs; the map libraries and
// label code load in the background (index.html reports a failure to load
// this module itself).
document.body.dataset.appStarted = 'true';
installPwaInstall({window, document});
// Installable as an app (manifest.webmanifest); the service worker keeps the
// app's own files for opening without a connection.
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register(new URL('sw.js', import.meta.url)).catch(() => {});
// Display settings are remembered in a cookie, not the address; settings in a
// shared link apply once and are then saved and removed from the address.
const SETTINGS_COOKIE = 'atlas_settings', LANGUAGE_COOKIE = 'atlas_language';
// The last position, heading and globe/flat choice, reopened next time.
// Kept in this browser's local storage (not a cookie, so it is never sent
// with page requests). A link with a position (#zoom/lat/lng) still wins.
const VIEW_STORE = 'atlas_view';
const rememberedView = (() => { try { const v = JSON.parse(localStorage.getItem(VIEW_STORE) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } })();
// Map rendering mode is independent of pitch. Accept an explicit mode from a
// shared link; older locally saved views without a mode retain tilt-based 3D.
const linkedTerrainMode = new URL(location.href).searchParams.get('terrain3d');
let terrain3DSelected = linkedTerrainMode === '1' ? true : linkedTerrainMode === '0' ? false
  : typeof rememberedView.t === 'boolean' ? rememberedView.t : terrain3DSelectedForPitch(rememberedView.p);
// Ignore intermediate pitch frames while explicitly switching back to 2D.
// A later manual tilt may enable 3D, but a top-down view never disables it.
let terrain3DExitPending = false;
let deferStatusCensus = false;
let restoringTerrainView = false;
// Capture the latest valid map link before URL normalization, including
// explicit navigation while libraries or startup data are still loading.
let linkedViewHash = parseViewHash(location.hash) ? location.hash : '';
function captureViewHash() {
  if (parseViewHash(location.hash)) linkedViewHash = location.hash;
  return linkedViewHash;
}
addEventListener('hashchange', captureViewHash);
function saveView() {
  if (!map) return;
  const c = map.getCenter();
  try { localStorage.setItem(VIEW_STORE, JSON.stringify({c: [+c.lng.toFixed(5), +c.lat.toFixed(5)], z: +map.getZoom().toFixed(2), b: +map.getBearing().toFixed(1), p: +map.getPitch().toFixed(1), g: onGlobe(), t: terrain3DSelected})); } catch {}
}
const readCookie = name => { try { return decodeURIComponent(document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1] || ''); } catch { return ''; } };
const writeCookie = (name, value) => { try { document.cookie = `${name}=${encodeURIComponent(value)}; max-age=31536000; path=/; SameSite=Lax`; } catch {} };
const remembered = (() => { try { const value = JSON.parse(readCookie(SETTINGS_COOKIE) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } })();
const settings = readSettings(location.search, {language: readCookie(LANGUAGE_COOKIE), ...remembered});
// The compact attribution/info control is UI state rather than a shareable map
// setting. Keep it in the same settings cookie, closed on a first visit.
settings.attributionOpen = typeof remembered.attributionOpen === 'boolean' ? remembered.attributionOpen : false;
const status = $('map-status');
const legendState = {help: false, service: false};
let platformLengths,frequencyExpiry;
let powerFacilities, powerMethods, electricitySignals;
let railRecovery, stationFailures, railReferenceFailures, wakeRailRecovery = () => {};
let stationWorldActive = false, stationWorldLifecycle;
const stationViewPaint = createStationViewPaint();
let map, ready = false, currentFeature, searchController, searchPausedUntil = 0, dem, scale, styleLanguage, pendingView, clickable = [], hoverFrame, drawing, measuring;
const assetVersion = new URL(import.meta.url).searchParams.get('v') || '20261126-canvas-basemap-sync-1';
// An old active worker can save this new page before its replacement has
// installed. If that update is interrupted, only old first-party/CDN copies
// may be available offline. Read exact saved responses without contacting the
// CDN; first visits and successful upgrades use the first-party files below.
async function cachedLegacyLibrary(name) {
  // Match scripts/browser-libraries.mjs. Cache Storage is not a trusted source
  // of executable bytes: verify each pinned distribution before using it as
  // a same-origin blob or stylesheet, and fail closed without Web Crypto.
  const library = {
    'maplibre-js': {local: 'vendor/maplibre-gl-5.24.0.js', url: 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.js', sha256: '45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb'},
    'maplibre-css': {local: 'vendor/maplibre-gl-5.24.0.css', url: 'https://cdn.jsdelivr.net/npm/maplibre-gl@5.24.0/dist/maplibre-gl.css', sha256: 'ab1e70d59ec40465bae7e7030da2f3ccf28133fd502e62bd598eefbadfd7a732'},
    'pmtiles-js': {local: 'vendor/pmtiles-4.2.1.js', url: 'https://cdn.jsdelivr.net/npm/pmtiles@4.2.1/dist/pmtiles.js', sha256: 'afc49d216fd24c0a3c0ff3cd2e0c62d6cdaf062854c3dced778dcab168824f79'},
  }[name];
  if (!library || !window.caches || !window.crypto?.subtle) return null;
  try {
    const names = (await window.caches.keys()).filter(key => /^atlas-shell-\d+$/.test(key));
    names.sort((a,b) => Number(b.split('-').at(-1)) - Number(a.split('-').at(-1)));
    for (const key of names) {
      const cache = await window.caches.open(key);
      if (!await cache.match(new URL('./', import.meta.url).href)) continue;
      const urls = [...(name === 'maplibre-js' ? [new URL(MAPLIBRE_BACKPORT.target, import.meta.url).href, new URL('vendor/maplibre-gl-5.24.0-atlas.3.js', import.meta.url).href] : []),
        new URL(library.local, import.meta.url).href, library.url];
      for (const url of urls) {
        const response = await cache.match(url);
        if (!response?.ok || response.type === 'opaque') continue;
        const type = (response.headers.get('content-type') || '').split(';')[0].trim();
        if (!(name.endsWith('-css') ? /^text\/css$/i.test(type) : /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/i.test(type))) continue;
        const digest = await window.crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
        const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (name === 'maplibre-js' && sha256 === MAPLIBRE_BACKPORT.sha256) return response;
        if (sha256 !== library.sha256 && !(name === 'maplibre-js' && sha256 === MAPLIBRE_BACKPORT.previousSha256)) continue;
        if (name === 'maplibre-js') {
          // Never execute the old distribution, even when its hash is genuine.
          const patched = await backportMapLibre524(await response.arrayBuffer(), window.crypto.subtle);
          return new Response(patched, {headers: {'content-type': 'text/javascript'}});
        }
        return response;
      }
    }
  } catch {}
  return null;
}
const appendLibraryScript = src => new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = src; script.onload = resolve;
  script.onerror = () => {script.remove(); reject(new Error('Map libraries could not load. Check your connection and reload.'));};
  document.head.append(script);
});
async function loadScript(src, global, legacy) {
  if (window[global]) return;
  try { await appendLibraryScript(src); }
  catch (error) {
    const saved = await cachedLegacyLibrary(legacy);
    if (!saved) throw error;
    const blob = URL.createObjectURL(new Blob([await saved.blob()], {type: 'text/javascript'}));
    try { await appendLibraryScript(blob); }
    finally { URL.revokeObjectURL(blob); }
  }
}
let legacyStyle;
const mapStyleReady = link => {
  // A blocked stylesheet can leave a non-null sheet whose rules are
  // inaccessible. Only readable rules establish that this local CSS loaded.
  try { return Boolean(link?.sheet?.cssRules.length); } catch { return false; }
};
function restoreCachedMapStyle() {
  return legacyStyle ||= (async () => {
    const link = $('maplibre-css');
    if (!link || mapStyleReady(link)) return;
    const saved = await cachedLegacyLibrary('maplibre-css');
    if (!saved || mapStyleReady(link)) return;
    const style = document.createElement('style');
    style.dataset.cachedMaplibre='';
    style.textContent = await saved.text();
    link.after(style);
  })();
}
// The preview server opts in through its copy of the real page. Do not expose
// the partial renderer as a released feature before the other controls work.
const stagedFlatEntry = document.documentElement.dataset.flatEntry === 'staged';
const RENDERER_STORE = 'atlas_disable_webgl';
const RENDERER_WORK_HANDOFF = 'atlas_renderer_work_v1';
let cancelSelectionRestore;
let explicitFlat = false;
try { explicitFlat = stagedFlatEntry && localStorage.getItem(RENDERER_STORE) === '1'; } catch {}
function webglAvailable() {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {return false;}
}
let useFlat = stagedFlatEntry && (explicitFlat || !webglAvailable());
let webglStartupFailure = '';
if (stagedFlatEntry) {
  $('flat-preview-preference').hidden=false;
  const toggle=$('disable-webgl');
  toggle.checked=explicitFlat;
  toggle.addEventListener('change',()=>{
    const drawingDraft = drawing && (drawing.draft.length > 0 || drawing.extending) ? drawing.rendererDraft() : null;
    const measurement = measuring?.rendererMeasurement();
    const selection = !$('details').hidden ? rendererSelection(currentFeature) : null;
    const transferring = drawingDraft || measurement || selection;
    try {
      if (transferring) sessionStorage.setItem(RENDERER_WORK_HANDOFF, JSON.stringify({drawing:drawingDraft,measurement,selection}));
    } catch {
      if(drawingDraft) $('draw-status').textContent='The browser could not keep this drawing across a renderer switch. Finish the drawing before switching.';
      else if(measurement) $('measure-status').textContent='The browser could not keep this measurement across a renderer switch. Clear the measurement before switching.';
      else status.textContent='The browser could not keep this selection across a renderer switch.';
      toggle.checked=explicitFlat;return;
    }
    try {localStorage.setItem(RENDERER_STORE,toggle.checked?'1':'0');}
    catch {
      if(transferring)try{sessionStorage.removeItem(RENDERER_WORK_HANDOFF);}catch{}
      status.textContent='The browser could not save the WebGL preference.';
      toggle.checked=explicitFlat;return;
    }
    // Traditional camera persistence is already shared by both renderers.
    saveView();
    location.reload();
  });
}
function loadStagedWebGLStyle() {
  const link=$('maplibre-css');
  if(!link?.dataset.href)return Promise.reject(new Error('WebGL stylesheet unavailable'));
  return new Promise((resolve,reject)=>{
    link.addEventListener('load',resolve,{once:true});
    link.addEventListener('error',reject,{once:true});
    link.href=link.dataset.href;
  }).catch(async error=>{
    await restoreCachedMapStyle();
    if(!mapStyleReady(link)&&!link.nextElementSibling?.matches('style[data-cached-maplibre]'))throw error;
  });
}
let webglLibraries;
if (!useFlat) {
  const renderer=loadScript(new URL('vendor/maplibre-gl-5.24.0-atlas.4.js', import.meta.url).href, 'maplibregl', 'maplibre-js');
  if(stagedFlatEntry){
    // This failure is specific to the renderer pair. Do not catch failures
    // of PMTiles, the common style or any map-data request as WebGL errors.
    webglLibraries=Promise.allSettled([renderer,loadStagedWebGLStyle()]).then(results=>{
      if(results.every(result=>result.status==='fulfilled')&&window.maplibregl)return;
      $('maplibre-css')?.removeAttribute('href');
      document.querySelector('style[data-cached-maplibre]')?.remove();
      webglStartupFailure='the WebGL renderer files could not load';
      useFlat=true;
    });
  }else{
    webglLibraries=renderer;
    const link=$('maplibre-css');
    link?.addEventListener('error', () => restoreCachedMapStyle().catch(() => {}), {once:true});
    if (link?.dataset.href) link.href=link.dataset.href;
    restoreCachedMapStyle().catch(() => {});
  }
}
const pmtilesLibrary=loadScript(new URL('vendor/pmtiles-4.2.1.js', import.meta.url).href, 'pmtiles', 'pmtiles-js');
const libraries = Promise.all([
  webglLibraries, pmtilesLibrary,
  loadScript(new URL(`vendor/maplibre-contour.js?v=${assetVersion}`, import.meta.url).href, 'mlcontour'),
]);
const labels = import(`./vendor/tile-labels.js?v=${assetVersion}`);
libraries.catch(() => {}); labels.catch(() => {});
// Han characters are drawn with local fonts. One font per label language keeps
// glyph styles consistent: with a generic family, browsers mix fonts, e.g.
// a Japanese font for shared characters and a Chinese one for the rest.
function cjkScript(lang) {
  if (CJK_FONTS[lang]) return lang;
  // Other label languages follow the browser's language, else Simplified
  // Chinese, whose fonts also cover Traditional characters.
  const browser = (navigator.languages || [navigator.language]).map(l => l || '').find(l => /^(zh|ja|ko)/i.test(l)) || '';
  return /^zh-(Hant|TW|HK|MO)/i.test(browser) ? 'zh-Hant' : /^ja/i.test(browser) ? 'ja' : /^ko/i.test(browser) ? 'ko' : 'zh-Hans';
}
const loadedCjkFonts=new Set(),cjkFontLoads=new Map(),cjkChoices=new Map(),cjkFontFailures=new Map();let cjkFontRefresh=false;
const bundledCjkFamily=script=>`Atlas CJK ${script==='zh-Hant'?'TC':'SC'}`;
// Frequency periods that some applied source covers (frequency-manifest.json);
// a period no source covers is not offered. Unknown until the manifest loads,
// or for a snapshot without the list: every period stays available.
let coveredProfiles=null,serviceDataStatus={state:'loading'};
const profileCovered=profile=>!coveredProfiles||coveredProfiles.has(profile);
const periodCovered=period=>period==='peak'?profileCovered('am')||profileCovered('pm'):period==='hour'?HOURLY_PROFILES.some(profileCovered):profileCovered(period);
// Rare Han glyph slices, loaded for the labels of each tile before it is drawn;
// one that arrives after a label was drawn without it redraws the labels.
const rareHanFonts=createRareHanFonts({root:new URL('fonts/rare-han-v1/', import.meta.url),fetcher:(...args)=>fetch(...args),FontFace:window.FontFace,fonts:document.fonts,onLoad:()=>refreshCjkFont()});
// Packaged world label fonts (world-font.mjs) and the glyphs generated
// from them (glyph-fallback.mjs, created through the label bundle in
// initialize): the remote glyph source leaves whole scripts empty, so
// the atlasglyph protocol generates those glyphs from these slices on
// the device, with no dependence on fonts the device has. A slice that
// arrives after its glyphs were drawn without it drops the cached
// glyphs and redraws the labels, like a rare Han slice.
let worldGlyphFallback;
let refreshFlatLabels;
const worldFonts=createWorldFonts({root:new URL('fonts/world-v1/', import.meta.url),fetcher:(...args)=>fetch(...args),FontFace:window.FontFace,fonts:document.fonts,onLoad:keys=>{worldGlyphFallback?.invalidate(keys);refreshFlatLabels?.();refreshCjkFont();}});
// The packaged font when loaded, else the installed font chosen by probing,
// else the script's candidate list for the system to resolve.
// Rare Han slices (rare-han.mjs) fill characters the Han font lacks; they
// come before the generic family, after which no family is consulted.
const withRareHan = stack => /,\s*sans-serif\s*$/.test(stack) ? stack.replace(/,\s*sans-serif\s*$/,`,"${RARE_HAN_FAMILY}",sans-serif`) : `${stack},"${RARE_HAN_FAMILY}"`;
const cjkFont = lang => {
  const script=cjkScript(lang),family=cjkChoices.get(script)?.family;
  return withRareHan(loadedCjkFonts.has(script)?`"${bundledCjkFamily(script)}"`:family?`"${family}",sans-serif`:CJK_FONTS[script]);
};
// Installed fonts are probed once per script (cjk-font.mjs). Nothing is
// downloaded for a device whose own font covers every character set.
let probeMeasure;
function cjkMeasure(){
  probeMeasure ||= (async()=>{
    if(!window.FontFace||!document.fonts)return null;
    const face=new FontFace(PROBE_FAMILY,`url("${PROBE_FONT}")`);await face.load();document.fonts.add(face);
    const canvas=typeof OffscreenCanvas==='function'?new OffscreenCanvas(64,64):document.createElement('canvas'),ctx=canvas.getContext('2d');
    if(!ctx?.measureText)return null;
    ctx.atlasProbe=true;
    return (family,character)=>{ctx.font=`32px "${family}","${PROBE_FAMILY}"`;return ctx.measureText(character).width;};
  })().catch(()=>null);
  return probeMeasure;
}
function refreshCjkFont(){updateDetailGlyphs();if(ready)reloadLanguage();else if(map)cjkFontRefresh=true;}
function ensureCjkChoice(script){
  if(cjkChoices.has(script))return;
  cjkChoices.set(script,null);
  const candidates=familyNames(CJK_FONTS[script]);
  cjkMeasure().then(async measure=>{
    // A family provided as a page font must load before it can be measured;
    // installed fonts need no request.
    if(measure)await Promise.all(candidates.map(f=>document.fonts.load?.(`32px "${f}"`,Object.values(PROBE_SETS).join('')).catch(()=>{})));
    const choice=measure?chooseCjkFont(candidates,measure):null;
    cjkChoices.set(script,choice);
    if(choice?.family&&cjkScript(settings.language)===script)refreshCjkFont();
  });
}
// The packaged Chinese font is fetched only when Han labels or feature
// details are shown and the installed font misses some character set. Japanese
// and Korean keep their installed fonts: the packaged ones are Chinese designs.
function loadCjkFont(script){
  const choice=cjkChoices.get(script);
  if(!['zh-Hant','zh-Hans'].includes(script)||!choice?.family||choice.complete||!window.FontFace||!document.fonts)return;
  if(cjkFontLoads.has(script)||Date.now()<(cjkFontFailures.get(script)?.until??0))return;
  const code=script==='zh-Hant'?'tc':'sc',face=new FontFace(bundledCjkFamily(script),`url("${new URL(`fonts/atlas-cjk-${code}-v1.woff2`,import.meta.url).href}")`);
  document.fonts.add(face);
  const pending=face.load().then(()=>{
    loadedCjkFonts.add(script);
    if(cjkScript(settings.language)===script)refreshCjkFont();
  }).catch(error=>{
    // Labels keep the installed font meanwhile. Each failure doubles the wait
    // before the next attempt (30 s to 10 min); going back online retries.
    document.fonts.delete(face);cjkFontLoads.delete(script);
    const delay=Math.min(2*(cjkFontFailures.get(script)?.delay??15000),600000);
    cjkFontFailures.set(script,{delay,until:Date.now()+delay});
    console.warn('Chinese label font unavailable:',error?.message||String(error));
  });
  cjkFontLoads.set(script,pending);
}
window.addEventListener?.('online',()=>cjkFontFailures.clear());
ensureCjkChoice(cjkScript(settings.language));
// Named fonts are missing on many systems (Android exposes none), and the
// generic fallback then picks glyph shapes by language. MapLibre draws on a
// canvas outside the page, which has no language, so the browser's default
// applies: often Japanese shapes for Chinese names (e.g. 门). Give the canvas
// the label language whenever MapLibre sets up one of these fonts.
const CANVAS_LANG = {'zh-Hans':'zh-CN', 'zh-Hant':'zh-TW', ja:'ja', ko:'ko'};
const DETAIL_CJK_CHARACTER = String.raw`[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]`;
// The neutral Bopomofo tone can precede its syllable; other tones follow it.
const DETAIL_CJK_START = `(?:${DETAIL_CJK_CHARACTER}|˙(?=\\p{Script=Bopomofo}))`;
const detailRunPattern = separators => new RegExp(`${DETAIL_CJK_START}(?:${DETAIL_CJK_CHARACTER}|[\\p{Mark}ーｰﾞﾟ゛゜ˉˊˇˋ˙˪˫]|${separators}+(?=${DETAIL_CJK_START}))*`, 'gu');
// Internal separators and line numbers belong to the CJK name when followed
// by another CJK character. Latin letters and line breaks remain boundaries.
const DETAIL_GLYPH_RUNS = detailRunPattern(String.raw`[\p{Punctuation}\p{Space_Separator}\p{Number}]`);
const DETAIL_LANGUAGE_HINTS = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|˙?\p{Script=Bopomofo}/gu;
const DETAIL_CONNECTORS = /[\p{Punctuation}\p{Space_Separator}\p{Number}]+/gu;
const detailGlyphHints = text => [
  /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text) && 'ja',
  /\p{Script=Hangul}/u.test(text) && 'ko',
  /\p{Script=Bopomofo}/u.test(text) && 'zh-TW',
].filter(Boolean);
const detailGlyphLanguage = text => detailGlyphHints(text)[0] || CANVAS_LANG[cjkScript(settings.language)];
function splitDetailGlyphLanguages(run) {
  if (detailGlyphHints(run[0]).length < 2) return [run];
  const parts = [];
  let start = 0, previousEnd = 0, previousLanguage;
  const append = end => {
    const part = [run[0].slice(start, end)]; part.index = run.index + start; parts.push(part);
  };
  for (const hint of run[0].matchAll(DETAIL_LANGUAGE_HINTS)) {
    const language = detailGlyphLanguage(hint[0]);
    if (previousLanguage && language !== previousLanguage) {
      const gap = run[0].slice(previousEnd, hint.index);
      const connectors = [...gap.matchAll(DETAIL_CONNECTORS)];
      // A slash/semicolon separates aliases. Otherwise the first connector
      // keeps the next name's leading Han with its identified language.
      const separator = connectors.find(part => /[\/／;；]/u.test(part[0])) || connectors[0];
      const end = separator ? previousEnd + separator.index : hint.index;
      append(end);
      start = separator ? end + separator[0].length : hint.index;
    }
    previousEnd = hint.index + hint[0].length; previousLanguage = language;
  }
  append(run[0].length); return parts;
}
function detailGlyphRuns(text) {
  // Split aliases at their language boundary, retaining spaces within each
  // complete name instead of labeling isolated Han words independently.
  return [...text.matchAll(DETAIL_GLYPH_RUNS)].flatMap(splitDetailGlyphLanguages);
}
const detailFontObserver = new MutationObserver(updateDetailGlyphs);
// CJK text in feature details shares the map's chosen family. Kana or Hangul
// identifies a mixed name's language; Han-only names use the map's language
// for system glyph fallback. Both styles stay on CJK runs so installed fonts
// cannot also replace Latin UI text.
function updateDetailGlyphs() {
  const panel = $('detail-content');
  const family = cjkFont(settings.language).replace(/,\s*sans-serif\s*$/, '');
  const fontFamily = `${family},system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif`;
  // Only CJK runs need a regional language for glyph fallback. Fixed English
  // UI and Latin text keep their inherited language for assistive technology.
  // Disconnect while wrapping our own text to avoid observing ourselves.
  detailFontObserver.disconnect();
  try {
    for (const span of panel.querySelectorAll('[data-cjk-glyphs]')) {
      const runs = detailGlyphRuns(span.textContent);
      if (runs.length === 1 && runs[0][0] === span.textContent) {
        span.lang = detailGlyphLanguage(span.textContent); span.style.fontFamily = fontFamily;
      }
      else span.replaceWith(...span.childNodes);
    }
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT), nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.namespaceURI === 'http://www.w3.org/1999/xhtml' && !node.parentElement.closest('[data-cjk-glyphs]')) nodes.push(node);
    }
    for (const node of nodes) {
      const runs = detailGlyphRuns(node.data);
      if (!runs.length) continue;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      for (const run of runs) {
        fragment.append(node.data.slice(offset, run.index));
        const span = document.createElement('span');
        span.dataset.cjkGlyphs = ''; span.lang = detailGlyphLanguage(run[0]); span.style.fontFamily = fontFamily; span.textContent = run[0];
        fragment.append(span); offset = run.index + run[0].length;
      }
      fragment.append(node.data.slice(offset)); node.replaceWith(fragment);
    }
    // Traditional Mongolian runs stand vertically (mongolian-text.mjs).
    // A fresh walk, because the CJK pass above replaced its text nodes;
    // text inside either kind of wrapped run is already handled.
    const mongolianWalker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT), mongolianNodes = [];
    while (mongolianWalker.nextNode()) {
      const node = mongolianWalker.currentNode;
      if (node.parentElement?.namespaceURI === 'http://www.w3.org/1999/xhtml' && !node.parentElement.closest('[data-cjk-glyphs], .atlas-mongolian') && hasMongolian(node.data)) mongolianNodes.push(node);
    }
    for (const node of mongolianNodes) node.replaceWith(nameFragment(document, node.data));
  } finally {
    // All renderers share this container, including asynchronous departures
    // and nearby names. Existing text-node edits need the same treatment.
    detailFontObserver.observe(panel, {childList:true, subtree:true, characterData:true});
  }
  loadDetailFonts();
}
function loadDetailFonts() {
  if ($('details').hidden) return;
  const text = $('detail-content').textContent;
  if (/\p{Script=Han}/u.test(text)) loadCjkFont(cjkScript(settings.language));
  const blocks = rareHanBlocks(text);
  if (blocks.size) void rareHanFonts.ensure(blocks);
  const mongolian = mongolianFontRequests(text);
  if (mongolian.size) void worldFonts.ensure(mongolian);
}
updateDetailGlyphs();
// MapLibre may draw glyphs on an OffscreenCanvas, whose context is another class.
for (const context of [window.CanvasRenderingContext2D?.prototype, window.OffscreenCanvasRenderingContext2D?.prototype]) {
  const font = context && Object.getOwnPropertyDescriptor(context, 'font');
  if (font?.set) Object.defineProperty(context, 'font', {...font, set(value) {
    font.set.call(this, value);
    if (this.atlasProbe) return;
    const text = String(value), chosen = key => cjkChoices.get(key)?.family;
    const script = Object.keys(CJK_FONTS).find(key => text.includes(CJK_FONTS[key])||text.includes(withRareHan(CJK_FONTS[key]))||text.includes(bundledCjkFamily(key))||(chosen(key)&&text.includes(chosen(key))));
    // MapLibre is drawing Han glyphs in this script's font.
    if (script) {if ('lang' in this) this.lang = CANVAS_LANG[script]; loadCjkFont(script);}
  }});
}
// Run once the map has loaded, or now if it has.
function whenReady(action) {
  if (ready) action();
  else pendingView = action;
}
const errors = new Map(), sourceFailureStates = new Map();
const textNode = (tag, value, className) => {
  const el = document.createElement(tag); el.textContent = value;
  if (className) el.className = className;
  return el;
};
// A display name that may carry traditional Mongolian: its runs stand
// vertically (mongolian-text.mjs) and the packaged slices are requested
// (they swap in when loaded; rendering never waits on them). Names
// without Mongolian keep the plain text-node path unchanged. The
// detail panel needs no such helper: updateDetailGlyphs treats every
// text node rendered into it, whichever renderer produced it.
const nameNode = (tag, value, className) => {
  if (!hasMongolian(value)) return textNode(tag, value, className);
  const el = document.createElement(tag); if (className) el.className = className;
  el.append(nameFragment(document, value));
  const requests = mongolianFontRequests(value);
  if (requests.size) void worldFonts.ensure(requests);
  return el;
};
const {row, controlSystemLabel, controlSystemRow} = createInspectorRows(textNode);
const {showAerialwayDetails, showRailwayPointDetails, showPowerFacilityDetails, showInfrastructureContext, showContextDetails} = createFeatureInspector({
  document, $, textNode, row, settings, osmLink, signalSources: () => SIGNAL_SOURCES,
  getCurrentFeature: () => currentFeature, nearestCrossing, crossingDataHasTags: () => crossingDataHasTags(),
});
// Power, train control, gauge and loading gauge legends name exactly what
// is drawn in the current view, most common first: systems are regional,
// and a fixed list would be long and mostly irrelevant.
let inView = [], legendTimer, flatLegendFeatures = [];
// Waits for the view's tiles rather than map idle, which any slow tile
// (e.g. relief) can hold back.
function scheduleLegend() {
  clearTimeout(legendTimer);
  if (IN_VIEW[settings.mode]) legendTimer = setTimeout(updateInView, 250);
}
const GAUGE_NAMES = {600:'', 762:'2 ft 6 in', 914:'3 ft', 1000:'metre', 1067:'3 ft 6 in', 1372:'Scotch', 1435:'standard', 1520:'Russian', 1524:'Finnish', 1600:'Irish', 1668:'Iberian', 1676:'Indian'};
const IN_VIEW = {
  // Railway power has a fixed key (see renderLegend), not an in-view list.
  control: p => {
    const drawn = Object.fromEntries([0,1,2].map(i => [`train_protection${i}`,p[`train_protection${i}`]]));
    const rows = trainProtectionSystems(drawn).filter(code => code !== 'none').map(code => {
      const system = trainProtection(code);
      return [system ? controlColor(system[2], system[3]) : UNKNOWN_COLOR, trainProtectionShort(code), system?.[3] ?? 5, code];
    });
    return rows.length ? rows : null;
  },
  // Both halves of a dual-gauge track are drawn, so both gauges are listed
  // (a third gauge is not drawn; clicking the track lists it).
  gauge: p => {
    const rows = [p.gaugeint0, p.gaugeint1].filter(mm => mm > 0)
      .map(mm => [gaugeColor(mm), `${gauge(mm)}${GAUGE_NAMES[mm] && settings.units !== 'imperial' ? ` (${GAUGE_NAMES[mm]})` : ''}`, mm]);
    return rows.length ? rows : null;
  },
  axle: p => {const a=axleLoad(p);return a?[a.colour,formatAxleLoad(a,settings.units),a.tonnes]:null;},
  loading: p => { const g = loadingGauge(p.loading_gauge); return g ? [g.color, g.name, g.rank, loadingDimensions(g, settings.units)] : null; },
  // Owners in view, most track first.
  owner: p => p.owner && p.owner_color ? [p.owner_color, p.owner, 0] : null,
  // Services in view, by colour (a line's branches usually share one).
  service: p => p.kind ? [p.colour || SERVICE_UNCOLOURED, displayName(p, settings.language) || p.ref, SERVICE_ORDER[p.kind]] : null,
};
const SERVICE_ORDER = {rail:0,commuter: 0, subway: 1, monorail: 2, light_rail: 3, tram: 4,funicular:5}, SERVICE_UNCOLOURED = '#5d6b73';
const SERVICE_KINDS = {rail:'Rail',commuter: 'Commuter rail', subway: 'Metro', monorail: 'Monorail', light_rail: 'Light rail', tram: 'Tram',funicular:'Funicular'};
function inViewLegendLayers(mode) {
  // Aerialways and escalators carry their own owner, so they join the Owner list.
  return mode === 'service' ? ['service-routes'] : [`${mode}-branch-overview`, `${mode}-overview`, `${mode}-tracks`, `${mode}-metro-overview`, ...Object.keys(VIEW_LINE_LAYERS)];
}
function updateInView() {
  const describe = IN_VIEW[settings.mode];
  if ((!ready && !useFlat) || !describe) return;
  const features = useFlat ? flatLegendFeatures : map.queryRenderedFeatures({
    layers:inViewLegendLayers(settings.mode).filter(id=>map.getLayer(id)),
  });
  const counts = new Map();
  for (const f of features) {
    const described = describe(f.properties);
    if (!described) continue;
    for (const row of Array.isArray(described[0]) ? described : [described]) {
      const key = row.slice(0, 2).join('|'), entry = counts.get(key) || {row, n: 0};
      entry.n++; counts.set(key, entry);
    }
  }
  const rows = settings.mode === 'control'
    ? [...counts.values()].sort((a,b) => b.n-a.n).slice(0,12).sort((a,b) => a.row[2]-b.row[2]).map(({row}) => [row[0],row[1],`control-${row[3]}`])
    : legendRows([...counts.values()]);
  if (settings.mode === 'control' && counts.size > 12) rows.push(['transparent',`${counts.size-12} less common systems in view; zoom in for them`,'empty']);
  if (rows.join() !== inView.join()) { inView = rows; renderLegend(); }
}
// The same pictogram and tile as on the map: filled when operating, light
// with a dashed edge when planned or former.
// The same drawing as on the map: a neutral outlined area or a plain dot,
// with its faint dashed planned/former form beside it when that is shown.
// A position within a facility's extent (points, lines and areas alike).
function makePowerLoaders(adapter,active,{glyphs,reportError=()=>{}}={}) {
  const source=(id,file,zoom,message,options)=>createPowerFacilityLoader(adapter,{
    sourceId:id,url:new URL(file,import.meta.url),active:()=>active(zoom),
    onError(error){reportError(id);console.warn(message,error.message);},...options,
  });
  const language=()=>settings.language;
  return [
    source('electricFacilities','./data/traction/power/power-facilities.geojson.gz',10,'Railway energy supplies unavailable:',{
      language,glyphs,localize:(data,lang)=>({...data,features:data.features.map(f=>{
        const properties={...f.properties,...locate(...shapeCenter(f.geometry))};
        return {...f,properties:{...properties,atlas_name:chooseName(properties,lang),atlas_language:lang}};
      })}),
    }),
    source('electricMethods','./data/traction/power/power-methods.geojson.gz',10,'Conductor rails and railway charging unavailable:',{
      language,glyphs,localize:(data,lang)=>({...data,features:data.features.map(f=>
        ({...f,properties:{...f.properties,atlas_name:chooseName(f.properties,lang)}}))}),
    }),
    source('electricSignals','./data/traction/power/electricity-signals.geojson.gz',13,'Electrification signals unavailable:'),
  ];
}

function shapeCenter(geometry) {
  if (geometry.type==='Point') return geometry.coordinates;
  const box=[Infinity,Infinity,-Infinity,-Infinity];
  const walk=c=>{if(typeof c[0]==='number'){box[0]=Math.min(box[0],c[0]);box[1]=Math.min(box[1],c[1]);box[2]=Math.max(box[2],c[0]);box[3]=Math.max(box[3],c[1]);}else c.forEach(walk);};
  walk(geometry.coordinates);
  return [(box[0]+box[2])/2,(box[1]+box[3])/2];
}
function renderLegend() {
  renderLegendUI({document, $, textNode, settings, inView, legendState,
    serviceDataStatus, periodCovered, controlSystemLabel});
}
function saveSettings() {
  writeCookie(SETTINGS_COOKIE, JSON.stringify({...Object.fromEntries(SETTING_KEYS.map(key => [key, settings[key]])), attributionOpen: settings.attributionOpen}));
  const url = new URL(location.href);
  const hasSettings = SETTING_PARAMS.some(key => url.searchParams.has(key)) || url.searchParams.has('terrain3d');
  const hasView = Boolean(parseViewHash(url.hash));
  if (hasView) linkedViewHash = url.hash;
  // Normalize shared links once, not on every pan/zoom. Preserve unrelated
  // query parameters, non-map anchors and the current browser history state.
  if (hasSettings || (hasView && !useFlat)) {
    for (const key of SETTING_PARAMS) url.searchParams.delete(key);
    url.searchParams.delete('terrain3d');
    if (hasView && !useFlat) url.hash = '';
    history.replaceState(history.state, '', url);
  }
}
// Build a link on demand rather than writing each map position into history.
let flatCurrentView, flatNavigation, flatRefreshStyle, flatSourceContext, pendingFlatNavigation;
let flatServiceFeatures=[], flatExpiryQueued=false;
function shareURL() {
  const url = new URL(location.href);
  for (const [key, value] of settingsQuery(settings)) url.searchParams.set(key, value);
  url.searchParams.set('terrain3d', terrain3DSelected ? '1' : '0');
  if (map) {
    const {lat, lng} = map.getCenter();
    url.hash = viewHash({zoom: map.getZoom(), lat, lng, bearing: map.getBearing(), pitch: map.getPitch()});
  } else if (flatCurrentView) {
    const {c:[lng,lat],z:zoom,b:bearing}=flatCurrentView;
    url.searchParams.set('terrain3d','0');
    url.hash=viewHash({zoom,lat,lng,bearing,pitch:0});
  } else if (captureViewHash()) {
    // The share control is available while map libraries are still loading.
    url.hash = linkedViewHash;
  } else if (Array.isArray(rememberedView.c) && rememberedView.c.length === 2
      && rememberedView.c.every(Number.isFinite) && Number.isFinite(rememberedView.z)) {
    url.hash = viewHash({zoom: rememberedView.z, lat: rememberedView.c[1], lng: rememberedView.c[0],
      bearing: rememberedView.b ?? 0, pitch: rememberedView.p ?? 0});
  }
  return url.href;
}
saveSettings();
const CHECKBOXES = ['stations', 'stationImportanceColors', 'trackCounts', 'labels', 'inactive', 'relief', 'names', 'autoGlobe', 'readout', 'transport', 'destinations', 'constraints'];
const DEFAULT_STATION_TEXT_COLOR = ['match', ['get','station_size'], 'large', '#123e52', '#0865c0'];
const LOW_ZOOM_STATION_TEXT_COLOR = '#123e52';
const isLowZoomStationLayer = id => id.endsWith('-names') && (id.startsWith('station-major-') || id.startsWith('station-stationLow-') || id.startsWith('station-stationMed-'));
const lowZoomStationTextColor = () => settings.stationImportanceColors
  ? DEFAULT_STATION_TEXT_COLOR
  : ['step', ['zoom'], LOW_ZOOM_STATION_TEXT_COLOR, 7, DEFAULT_STATION_TEXT_COLOR];
// Curated hubs (major-stations.geojson) decide which station is shown at
// zooms 3–6. Their names come, like every other station label, from the
// provider's station tiles through the same language handling: zoom 8 is
// the first zoom whose tiles hold every railway station. A tile entry is the curated
// station when its OSM identity is the curated object or one of its aliases.
const MAJOR_NAME_ZOOMS=[8],MAJOR_NAME_TILES=256;
let majorStationData,majorStationSearchData,majorStationsPromise,stationTileFor=null,stationTileURL=null,majorStationGeneration=0;
const majorStationTiles=new Map();
const tileIdentity=id=>/^(node|way|relation)-[1-9]\d*/.exec(String(id??''))?.[0];
function majorNameTile(language,z,x,y){
 const key=`${language}/${z}/${x}/${y}`;
 if(majorStationTiles.has(key)){const value=majorStationTiles.get(key);majorStationTiles.delete(key);majorStationTiles.set(key,value);return value;}
 const url=stationTileURL.replace('{z}',z).replace('{x}',x).replace('{y}',y);
 const promise=Promise.all([stationTileFor(url,language),labels]).then(([data,code])=>{
  const byIdentity=new Map();
  for(const layer of Object.values(code.readTile(data).layers))for(let i=0;i<layer.length;i++){
   const p=layer.feature(i).properties,identity=tileIdentity(p.id);
   if(identity&&p.atlas_name&&!byIdentity.has(identity))byIdentity.set(identity,p);
  }
  return byIdentity;
 });
 promise.catch(()=>majorStationTiles.delete(key));
 majorStationTiles.set(key,promise);
 while(majorStationTiles.size>MAJOR_NAME_TILES)majorStationTiles.delete(majorStationTiles.keys().next().value);
 return promise;
}
// The tile holding a point, and its four neighbours: the provider places a
// grouped station at the group's centre, which can lie across an edge.
function majorNameTiles([lon,lat],z){
 const n=2**z,s=Math.sin(Math.max(-85.05,Math.min(85.05,lat))*Math.PI/180);
 const x=((Math.floor((lon+180)/360*n))%n+n)%n,y=Math.max(0,Math.min(n-1,Math.floor((.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n)));
 return [[x,y],[(x+1)%n,y],[(x+n-1)%n,y],[x,Math.min(n-1,y+1)],[x,Math.max(0,y-1)]];
}
async function majorStationName(feature,language){
 const identities=new Set(String(feature.properties.osm_ids||feature.properties.id||'').split(';').filter(Boolean));
 for(const z of MAJOR_NAME_ZOOMS)for(const [x,y] of majorNameTiles(feature.geometry.coordinates,z)){
  // A tile that fails is skipped; the remaining candidates may still name it.
  const found=await majorNameTile(language,z,x,y).catch(()=>null);
  for(const id of identities){const p=found?.get(id);if(p)return p;}
 }
 return null;
}
function updateMajorStations(){
 if(!shouldRefreshCuratedStationSource({ready,stationsEnabled:settings.stations,background:settings.background,zoom:map.getZoom()}))return;
 const source=map.getSource('stationMajor'),language=settings.language;
 stationTileURL ||= map.getSource('stations')?.tiles?.[0]?.replace(/^atlasstation:\/\/[^/]+\//,'');
 if(!source)return;
 const generation=++majorStationGeneration,zoom=map.getZoom(),bounds=map.getBounds();
 majorStationsPromise ||= majorStationData?Promise.resolve(majorStationData):fetch(new URL(`major-stations.geojson?v=${assetVersion}`,import.meta.url)).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}).catch(error=>{majorStationsPromise=undefined;throw error;});
 majorStationsPromise.then(async data=>{
  // Keep every curated location, but fetch names only at their label tier.
  // A dot must not disappear just because a hub's name is deferred.
  const west=bounds.getWest()-10,east=bounds.getEast()+10,south=bounds.getSouth()-10,north=bounds.getNorth()+10;
  // Into the world copy the view shows, however far it was panned.
  const centre=(west+east)/2;
  const visible=data.features.filter(f=>{const [lon,lat]=f.geometry.coordinates,l=lon+360*Math.round((centre-lon)/360);return l>=west&&l<=east&&lat>=south&&lat<=north;});
  const visibleIDs=new Set(visible.map(f=>f.id));
  const wanted=zoom<7?visible.filter(f=>(f.properties.tier??7)<=Math.floor(zoom)):[];
  if(generation!==majorStationGeneration||!ready||language!==settings.language||source!==map.getSource('stationMajor'))return;
  // Publish locations immediately, before provider requests or rare-Han fonts
  // settle. Only already-renderable names from this language may be reused.
  const existing=new Map((majorStationSearchData?.language===language?majorStationSearchData.features:[]).map(f=>[f.id,f]));
  const points=data.features.map(f=>existing.get(f.id)||(visibleIDs.has(f.id)?{...f,properties:{...f.properties,name:'',atlas_name:''}}:null)).filter(Boolean);
  majorStationSearchData={type:'FeatureCollection',language,features:points};
  source.setData({type:'FeatureCollection',features:points});
  // Provider metadata and the name adapter are optional for local geometry.
  if(zoom>=7||!stationTileFor||!stationTileURL)return;
  const named=await Promise.all(wanted.map(f=>majorStationName(f,language).catch(()=>null)));
  if(generation!==majorStationGeneration||!ready||language!==settings.language||source!==map.getSource('stationMajor'))return;
  const names=new Map(wanted.map((f,i)=>[f.id,named[i]]));
  // Hubs named earlier for this language keep their names off-view, so
  // panning back does not blank them while their tiles are read again.
  const previous=new Map((majorStationSearchData?.language===language?majorStationSearchData.features:[]).map(f=>[f.id,f]));
  const features=data.features.map(f=>{
   const p=names.get(f.id);
   if(p)return {...f,properties:{...f.properties,name:p.name,localized_name:p.localized_name,atlas_name:p.atlas_name,atlas_language:language,atlas_name_source:'provider'}};
   // A location is always present when in view, independently of whether
   // its translated name has been fetched or has label priority yet.
   return previous.get(f.id)||(visibleIDs.has(f.id)?{...f,properties:{...f.properties,name:'',atlas_name:''}}:null);
  }).filter(Boolean);
  // These names reach the map as GeoJSON, not through a tile protocol, so
  // their rare Han slices load here (the layers draw atlas_name, else name).
  const glyphs=new Set();for(const f of features)rareHanBlocks(f.properties.atlas_name||f.properties.name,glyphs);
  if(glyphs.size){await rareHanFonts.ensure(glyphs);if(generation!==majorStationGeneration||!ready||language!==settings.language||source!==map.getSource('stationMajor'))return;}
  majorStationSearchData={type:'FeatureCollection',language,features};
  source.setData({type:'FeatureCollection',features});
 }).catch(error=>console.warn('Major station names unavailable:',error.message));
}
// Selecting an unnamed curated dot resolves only that hub. The same guarded
// path follows language changes, even outside the overview's label tier.
function renameOpenMajorStation(){
 const open=currentFeature;
 const curatedData=majorStationsPromise||(majorStationData&&Promise.resolve(majorStationData));
 if(open?.source!=='stationMajor'||$('details').hidden||!stationTileFor||!curatedData)return;
 stationTileURL ||= map.getSource('stations')?.tiles?.[0]?.replace(/^atlasstation:\/\/[^/]+\//,'');
 if(!stationTileURL)return;
 const language=settings.language;
 if(open.properties?.atlas_language===language&&open.properties?.atlas_name)return;
 curatedData.then(data=>{
  if(currentFeature!==open||language!==settings.language||$('details').hidden)return;
  const curated=data.features.find(f=>f.properties.id===open.properties?.id);
  return curated&&majorStationName(curated,language).then(p=>{
   if(!p||currentFeature!==open||language!==settings.language||$('details').hidden)return;
   open.properties={...curated.properties,name:p.name,localized_name:p.localized_name,atlas_name:p.atlas_name,atlas_language:language,atlas_name_source:'provider'};
   showDetails(open);
  });
 }).catch(()=>{});
}
let previousTileMode;
function applySettings() {
  $('service-frequency-options').hidden = settings.mode !== 'service';
  $('frequency-profile-options').hidden = settings.serviceWidth !== 'frequency';
  $('peak-phase-options').hidden = settings.frequencyPeriod !== 'peak';
  $('frequency-hour-options').hidden = settings.frequencyPeriod !== 'hour';
  $('frequency-hour').value = settings.frequencyHour;
  $('service-width').value = settings.serviceWidth;
  $('frequency-period').value = settings.frequencyPeriod;
  $('peak-phase').value = settings.peakPhase;
  syncWatchLayout();
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.mode === settings.mode)));
  document.querySelectorAll('[data-background]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.background === settings.background)));
  $('legend').hidden = settings.background === 'satellite';
  updateAttribution();
  for (const key of CHECKBOXES) $(key).checked = settings[key];
  $('units').value = settings.units;
  $('terrain-exaggeration').value = String(settings.terrainExaggeration);
  readout.hidden = !settings.readout; updateReadout();
  if (ready) clickable = [];
  const frequencyPaint=serviceFrequencyPaint(settings);
  if (ready) for (const layer of map.getStyle().layers) {
    const stationPaint = stationViewPaint(layer, settings.mode, map.getZoom());
    if (stationPaint) for (const [property, value] of Object.entries(stationPaint)) map.setPaintProperty(layer.id, property, value);
    // Shown unless a setting hides it (a layer hidden under the imagery comes
    // back with the map).
    if(layer.id==='polar-caps')map.triggerRepaint();
    if(layer.id==='service-routes')for(const [property,value] of [['line-width',frequencyPaint.width],['line-offset',frequencyPaint.offset],['line-opacity',frequencyPaint.opacity]])map.setPaintProperty(layer.id,property,value);
    if(layer.id==='service-names')map.setLayoutProperty(layer.id,'text-offset',frequencyPaint.labelOffset);
    const visible = isNeutralRailReference(layer) ? false : layerVisibility(layer, settings);
    // The verified, complete source replaces selective dots at z3–11. The
    // corresponding provider/curated name symbols stay eligible; the normal
    // high-detail dots still begin at z12. An incomplete snapshot changes none.
    const replaced = stationWorldActive && WORLD_STATION_SUPERSEDED_DOTS.includes(layer.id);
    const enabled = replaced || (layer.id === WORLD_STATION_DOTS && !stationWorldActive)
      || (layer.id.includes('-fallback-') && layer.id.startsWith('station-'))
      ? false : visible;
    if (enabled !== undefined) map.setLayoutProperty(layer.id, 'visibility', enabled ? 'visible' : 'none');
    if (isLowZoomStationLayer(layer.id)) map.setPaintProperty(layer.id, 'text-color', lowZoomStationTextColor());
    if (/^inactive-(regional|railways)-/.test(layer.id) && layer.type === 'line' && !layer.id.includes('bridge')) map.setPaintProperty(layer.id, 'line-color', inactivePaint(settings.mode, settings.units));
    if (VIEW_LINE_LAYERS[layer.id]) { map.setPaintProperty(layer.id, 'line-color', viewLinePaint(layer.id, settings.mode, settings.units)); map.setPaintProperty(layer.id, 'line-width', viewLineWidth(layer.id, settings.mode)); }
    if ((enabled ?? true) && isClickable(layer.id)) clickable.push(layer.id);
  }
  if (ready) { pruneModeTiles(map, previousTileMode, settings.mode); previousTileMode = settings.mode; }
  else flatRefreshStyle?.();
  // Clear the previous view's values before drawing the legend: if the new
  // view has nothing in view, the in-view list never changes and the legend
  // would keep the old rows.
  inView = [];
  renderLegend();
  if (ready) { syncTerrain3D(map, settings.relief, settings.terrainExaggeration, terrain3DSelected);applyRailReferenceState();applyStationFallbackState();scheduleLegend(); scheduleNearbyTransport();updateMajorStations();platformLengths?.update();powerFacilities?.();powerMethods?.();electricitySignals?.(); }
  // The button must reflect the mesh AFTER its state is reconciled. When
  // relief is re-enabled while already tilted, no new pitch event occurs.
  updateTerrainButton();
  frequencyExpiry?.update();
  if (ready) wakeRailRecovery();
}
let attribution, flatCredits, attributionStateCleanup, controlLayout, servedBuild;
function codeAttribution() {
  const span=document.createElement('span');span.className='atlas-build';
  span.append(`Build ${assetVersion} · `);
  if (servedBuild?.version && servedBuild.version !== assetVersion) span.append(`Label build ${servedBuild.version} · `);
  if (/^[a-f0-9]{40}$/i.test(servedBuild?.commit || '')) {
    const link=document.createElement(servedBuild.sourceUrl ? 'a' : 'span');
    if(servedBuild.sourceUrl)link.href=servedBuild.sourceUrl;
    link.textContent=`Code ${servedBuild.commit.slice(0,10)}`;link.title=servedBuild.commit;
    link.target='_blank';link.rel='noopener';span.append(link);
  } else span.append('Development build');
  return span.outerHTML;
}
function updateAttribution() {
  if (!map || attribution) return;
  attribution = new maplibregl.AttributionControl({compact: true, customAttribution: codeAttribution()});
  map.addControl(attribution, 'bottom-right');
  attributionStateCleanup = rememberAttribution(
    $('map').querySelector('.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib'),
    {open: settings.attributionOpen, changed: open => {settings.attributionOpen = open; saveSettings();}}
  );
}
const SIGNAL_SOURCES = ['railwaySignals','railwaySignalSupplement','railwaySignalSupplementOverview'];
const featurePickRank = f => [...SIGNAL_SOURCES,'stationEntrances','electricSignals','electricFacilities','electricMethods','electricCatenary','electricSubstations'].includes(f.source) ? -1 : (f.source?.startsWith('station') || f.layer?.id.startsWith('station-basemap-fallback-')) ? 0 : f.layer?.id.startsWith('context-') ? (f.geometry?.type === 'Point' ? 1 : 3) : 2;
const INFRASTRUCTURE_POINTS = ['infrastructure-level-crossings','infrastructure-crossing-overview','infrastructure-crossing-dots','infrastructure-crossing-marks','infrastructure-street-running','infrastructure-signal-points','infrastructure-signal-references','infrastructure-signal-supplement-overview','infrastructure-signal-supplement-points','infrastructure-signal-supplement-references','infrastructure-entrance-points','infrastructure-entrance-references'];
// Clickable: stations, tracks, level crossings, inactive lines, and transport
// and destination points; land-use areas, protected, heritage and other
// planning areas, jurisdictions and buildings are drawn for context only.
const isClickable = id => /^energy-(?:overview|context|detail)(?:-former)?-(?:areas|civil-outlines|rail-outlines|points|badges|(?:grid|cable|traction|fuel|hydrogen|water|coal|other)-lines)$/.test(id) || /^aerialway-(?:cableway|lift)-cable$/.test(id) || /^electrification-(?:(?:former-)?(?:conductor-rails|fourth-rails|ground-supply|inductive-supply|linear-motors|rack-traction|cable-traction|provider-rack|provider-cable|trolley-contact|rigid-contact|(?:steam|maglev|battery|hydrogen)-propulsion|dual-voltage-(?:primary|secondary)|charging-(?:areas|outlines|points)|(?:former-)?signal-points)|catenary-(?:masts|portals|references))$/.test(id) || id.startsWith('platform-') || INFRASTRUCTURE_POINTS.includes(id) || /^electrification-(substation-(areas|edges)|(?:former-)?supply-(areas|outlines|points))$/.test(id) || contextLayerInteractive(id) || id.startsWith('station-') || (id.startsWith('inactive-') && !id.includes('bridge')) || /^(speed|infrastructure|electrification|control|gauge|loading|axle|owner|service)-(tracks|overview|branch-overview|metro-overview)$/.test(id) || /^control-(tracks|overview|branch-overview|metro-overview)-system-[23]$/.test(id) || id === 'service-routes';
// A link to the feature's own OpenStreetMap object, or to its location when
// the tiles do not identify one.
function osmLink(panel, feature) {
  const object = osmObject(feature), link = document.createElement('a');
  const toObject = ({type, id}) => { link.textContent = `Open this ${type} on OpenStreetMap ↗`; link.href = `https://www.openstreetmap.org/${type}/${id}`; };
  if (object) toObject(object);
  else if (feature.geometry?.type === 'Point') {
    const [lng, lat] = feature.geometry.coordinates;
    link.textContent = 'View location on OpenStreetMap ↗';
    link.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
    // A search result gives a bare OSM id without its type: the station tiles
    // name it (node-…, way-…) once the map has drawn the place. The first
    // look runs before the link is in the panel, and often finds it then.
    if (feature.kind === 'station' && /^\d+$/.test(String(feature.properties?.osm_id ?? ''))) {
      const resolve = () => { const found = ready && stationObject(feature.properties.osm_id); if (found) toObject(found); return found; };
      // Otherwise as station tiles arrive: the map goes idle only once every
      // tile (relief and contours too) has loaded, which can take long.
      const lookUp = () => {
        if (resolve()) return;
        const stop = () => { map.off('sourcedata', onData); clearTimeout(timer); };
        const onData = event => { if (event.tile && STATION_SOURCES.includes(event.sourceId) && resolve()) stop(); };
        const timer = setTimeout(stop, 60_000);
        map.on('sourcedata', onData);
      };
      // After any queued action (a search result's fly-to), not instead of it.
      if (ready) lookUp(); else { const queued = pendingView; pendingView = () => { queued?.(); lookUp(); }; }
    }
  } else return;
  link.target = '_blank'; link.rel = 'noopener'; link.className = 'osm-link';
  panel.append(link);
}
const STATION_SOURCES = ['stations', 'stationMed', 'stationLow'];
function stationObject(osmId) {
  const pattern = new RegExp(`^(node|way|relation)-${osmId}(-|$)`), seen = new Set();
  for (const layer of map.getStyle().layers) {
    const key = `${layer.source}/${layer['source-layer']}`;
    if (!layer.id.startsWith('station-') || !map.getSource(layer.source) || seen.has(key)) continue;
    seen.add(key);
    for (const f of map.querySourceFeatures(layer.source, {sourceLayer: layer['source-layer']})) {
      const match = pattern.exec(String(f.properties.id ?? ''));
      if (match) return {type: match[1], id: String(osmId)};
    }
  }
  return null;
}
function showDetails(feature) {
  cancelSelectionRestore?.();
  cancelProfile();
  platformLengths?.prioritizeEdge(['platformEdges','platformLengths'].includes(feature.source)?feature:null);
  if(['platformEdges','platformLengths','platforms','platformNumbers'].includes(feature.source))feature=platformLengths?.enrich(feature)||feature;
  currentFeature = feature;
  // Track power methods; chargers in the same source (any mapped shape) carry power_kind.
  if (feature.source==='electricMethods' && !feature.properties?.power_kind) {
    const p=feature.properties,panel=$('detail-content');
    panel.replaceChildren(textNode('div','RAILWAY POWER','eyebrow'),textNode('h2',p.power_method_label));
    const dl=document.createElement('dl');row(dl,'Status',p.power_state);row(dl,'Electrification method',p.power_method);
    // Older snapshots lack the per-lifecycle values; read the raw tags there.
    const own=key=>Object.hasOwn(p,`power_${key}`)?p[`power_${key}`]||undefined:p[key];
    row(dl,'Propulsion',own('propulsion'));row(dl,'Traction',own('traction'));
    row(dl,'Current',describeCurrent(typeof p.voltage==='number'?p.voltage:undefined,typeof p.frequency==='number'?p.frequency:undefined));
    row(dl,'Voltage',p.voltage);row(dl,'Frequency',p.frequency===undefined?undefined:`${p.frequency} Hz`);
    row(dl,'Secondary voltages',p.voltages_secondary);row(dl,'Contact line',p.contact_line_type);row(dl,'Conductor contact',p.rail_contact||p['electrified:rail']);panel.append(dl);osmLink(panel,feature);$('details').hidden=false;return;
  }
  if (feature.source==='electricSignals') {
    const p=feature.properties,panel=$('detail-content');
    panel.replaceChildren(textNode('div','ELECTRIFICATION SIGNAL','eyebrow'),textNode('h2',p.ref?`Signal ${p.ref}`:p.electricity_label?p.electricity_label[0].toUpperCase()+p.electricity_label.slice(1):'Electrification signal'));
    const dl=document.createElement('dl');for(const [label,value] of electricitySignalRows(p))row(dl,label,value);
    panel.append(dl,textNode('p','A mapped signal location and its recorded electricity function. The marker does not show a live signal aspect.','small'));osmLink(panel,feature);$('details').hidden=false;return;
  }
  if (['electricFacilities','electricMethods','electricCatenary','electricSubstations','energyNetworkOverview','energyNetworkContext','energyNetworkDetail'].includes(feature.source)) { showPowerFacilityDetails(feature); return; }
  if([...SIGNAL_SOURCES,'stationEntrances'].includes(feature.source)){showRailwayPointDetails(feature);return;}
  if (INFRASTRUCTURE_POINTS.includes(feature.layer?.id)) { showInfrastructureContext(feature); return; }
  if (feature.layer?.id.startsWith('context-')) { showContextDetails(feature); return; }
  if (feature.layer?.id.startsWith('aerialway-')) { showAerialwayDetails(feature); return; }
  if (feature.layer?.id === 'service-routes') { showServiceDetails(feature); frequencyExpiry?.update(); return; }
  const p = feature.properties;
  const isPlatform=['platformLengths','platformEdges','platforms','platformNumbers'].includes(feature.source);
  const isBasemapStation = feature.layer?.id.startsWith('station-basemap-fallback-');
  const isStation = feature.source?.startsWith('station') || feature.kind === 'station' || isBasemapStation;
  const panel = $('detail-content'); panel.replaceChildren();
  panel.append(textNode('div', isPlatform?'RAILWAY PLATFORM':isStation ? 'RAILWAY STATION' : 'RAILWAY INFRASTRUCTURE', 'eyebrow'));
  panel.append(textNode('h2', displayName(p, settings.language) || (isPlatform ? (p.ref ? `Platform ${p.ref}` : 'Platform') : isStation ? 'Unnamed station' : 'Unnamed railway')));
  const dl = document.createElement('dl');
  row(dl, 'Type', p.feature || (isBasemapStation ? p.subclass : p.railway) || (isStation ? 'station' : undefined));
  row(dl, 'Status', p.state || (isBasemapStation ? 'Not verified by this source' : 'present'));
  row(dl, 'Reference', p.label || p.ref || p.railway_ref || p['railway:ref']);
  if(isPlatform){
    const edge=p.feature==='platform_edge',tileEdge=edge&&p.length_basis==='complete_edge_tile';
    const length=formatPlatformLength(Number(p.platform_length),settings.units);
    row(dl,edge?'Boarding edge length':p.length_estimated?'Estimated platform extent':'Mapped platform length',tileEdge&&length?`≈${length}`:length);
    if(p.length_estimated)panel.append(textNode('p',tileEdge?'Approximate length of the complete mapped edge from the map tile.':'Approximate longitudinal extent of the complete mapped platform area; usable boarding length can differ.','small'));
    row(dl,'Platform',p.ref);
  }
  else if (isStation) {
    row(dl, 'Station type', p.station || (isBasemapStation ? p.subclass : undefined));
    if(isBasemapStation) panel.append(textNode('p','Station location from basemap POI data. Its operating status and identity match with timetable stops have not been verified; departures are unavailable for this fallback marker.','small'));
    if (feature.source===WORLD_STATION_SOURCE) panel.append(textNode('p','Independent worldwide OpenStreetMap station-point snapshot. This marker does not establish that trains currently stop here or that a timetable match exists.','small'));
    if(p.curated){row(dl,'Selection',p.basis);row(dl,'Mapped object',p.mapped_feature);}else if(!p.curated) row(dl, 'Mapped size', p.station_size);
    if (p.station_size&&!p.curated) panel.append(textNode('p', 'Size follows mapped route importance, not passenger numbers.', 'small'));
  } else {
    const speed = formatSpeed(p, settings.units);
    if (!p.state || p.state === 'present') {
      panel.append(textNode('p', speed.mapped, 'speed-value'));
      row(dl, 'Speed label', speed.tagged);
    } else if (typeof p.maxspeed === 'number') {
      row(dl, ['construction', 'proposed'].includes(p.state) ? 'Planned speed' : 'Former speed', speed.mapped);
    }
    row(dl, 'Direction', p.preferred_direction);
    row(dl, 'Usage', p.usage);
    row(dl, 'Service', p.service);
    row(dl, 'Track', p.track_ref);
    row(dl, 'Current', describeCurrent(p.voltage, p.frequency));
    row(dl, 'Electrification', p.electrification_state);
    // rack=* from the provider: the rack system (abt, strub, riggenbach…) or yes.
    row(dl, 'Rack', p.rack && String(p.rack).toLowerCase() !== 'no' ? p.rack : undefined);
    row(dl, 'Planned current', p.electrification_state === 'present' ? undefined : describeCurrent(p.future_voltage, p.future_frequency));
    controlSystemRow(dl, 'Train protection', trainProtectionSystems(p));
    controlSystemRow(dl, 'Protection being built', trainProtectionSystems({train_protection: p.train_protection_construction}));
    const gauges = p.gauges ? String(p.gauges).split(/[;,]\s*/) : [p.gauge0, p.gauge1, p.gauge2].filter(Boolean);
    row(dl, 'Gauge', gauges.length ? gauges.map(gauge).join(', ') : undefined);
    // Other views have no country annotation from the axle lookup. Their
    // explicit load tags remain usable; their national class codes do not.
    const axle = axleLoad({...p,axle_system:p.axle_system || (feature.source?.startsWith('axle') ? undefined : 'unknown')});
    row(dl,'Axle load',axle ? formatAxleLoad(axle,settings.units) : undefined);
    row(dl,'Mapped axle capacity',p.axle_load);
    row(dl,'Legal axle limit',p.maxaxleload);
    row(dl,'Track class',p['railway:track_class'] || p.track_class);
    if(!axle && (p.track_class || p['railway:track_class'])) row(dl,'Class interpretation',p.axle_system==='fi' ? 'Finnish superstructure class; axle load not inferred' : 'Axle load not established from this class');
    const loading = loadingGauge(p.loading_gauge);
    row(dl, 'Loading gauge', loading ? [loading.name, loadingDimensions(loading, settings.units), loading.note].filter(Boolean).join(' · ') + (p.loading_gauge !== loading.code ? ` (tagged: ${p.loading_gauge})` : '') : undefined);
    row(dl, 'Tunnel', p.tunnel === true ? 'Yes' : undefined);
    row(dl, 'Bridge', p.bridge === true ? 'Yes' : undefined);
    if (!p.state || p.state === 'present') panel.append(textNode('p', 'Colour uses the preferred-direction limit, or the larger directional limit if no preference is mapped. The source label above retains both directions. Bare numbers are km/h.', 'small'));
  }
  row(dl, 'Operator', Array.isArray(p.operator) ? p.operator.join(', ') : p.primary_operator || p.operator);
  row(dl, 'Owner', p.owner);
  panel.append(dl);
  if (!isStation && map?.getZoom() < 7) panel.append(textNode('p', 'This is a generalized overview. Zoom in for individual tracks and full details.', 'small'));
  osmLink(panel, feature);
  if (isStation) {
    const nearby = document.createElement('section'); nearby.id = 'nearby-transport'; panel.append(nearby);
    updateNearbyTransport();
    // Departures only for operating stations: a former or planned one near a
    // current stop would otherwise show that stop's trains as its own.
    if (!isBasemapStation && feature.geometry?.type === 'Point' && (!p.state || p.state === 'present')) showDepartures(panel, feature);
  }
  $('details').hidden = false;
}
// Of services found around a click, the one whose drawn line (its track
// shifted sideways by its place in the bundle, as service-routes draws it)
// passes nearest the point.
function nearestService(services, point) {
  return nearestServiceFeature(services,point,p=>map.project(p),map.getZoom(),settings);
}
// An urban rail service (Service view): the route, its network and operator.
function showServiceDetails(feature) {
  const p = feature.properties, panel = $('detail-content'); panel.replaceChildren();
  panel.append(textNode('div', 'RAIL SERVICE', 'eyebrow'), textNode('h2', displayName(p, settings.language) || p.ref || 'Unnamed service'));
  const dl = document.createElement('dl');
  row(dl, 'Type', SERVICE_KINDS[p.kind]);
  row(dl, 'Reference', p.ref);
  row(dl, 'Network', p.network);
  row(dl, 'Operator', p.operator);
  const standardProfiles=new Set(['am','pm','offpeak','overnight',selectedFrequencyProfile(settings)]);
  // Selector coverage describes usable widths, not all evidence on this route.
  // Retain recorded expiry rows even when no current source offers the period.
  const profiles=Object.keys(FREQUENCY_LABELS).filter(profile=>standardProfiles.has(profile)&&profileCovered(profile)||p[`frequency_status_${profile}`]==='expired'),sources=new Map();
  for(const profile of profiles){
    row(dl,FREQUENCY_LABELS[profile],frequencyAvailability(p,profile).text);
    if(p[`frequency_${profile}`]===undefined)continue;
    const attribution=frequencyAttribution(p,profile),key=JSON.stringify(attribution);
    if(!sources.has(key))sources.set(key,{...attribution,periods:[]});sources.get(key).periods.push(FREQUENCY_LABELS[profile]);
  }
  if(!sources.size&&p.frequency_source)sources.set('',frequencyAttribution(p,selectedFrequencyProfile(settings)));
  for(const source of sources.values()){
    if(source.frequency_source){row(dl,'Frequency source',`${source.frequency_source}${source.periods?.length?' · '+source.periods.join(', '):''} · checked ${source.frequency_checked}`);row(dl,'Period definitions',source.frequency_definition);row(dl,'Source credit',source.frequency_credit);row(dl,'Licence',source.frequency_license);row(dl,'Schedule note',source.frequency_note);}
    if(/^https:\/\//.test(source.frequency_url||'')){const link=textNode('a','Frequency source and terms');link.href=source.frequency_url;link.target='_blank';link.rel='noopener';panel.append(link);}
  }
  row(dl,'Geometry',p.geometry_source);
  if (p.n > 1) row(dl, 'Services on this track', String(p.n));
  panel.append(dl);
  serviceSourceRelations(panel, feature);
  $('details').hidden = false;
}
// Group identity is not proof that every relation runs on the clicked segment,
// has the same stops or has a matched timetable. Old tiles disclose their limit.
function serviceSourceRelations(panel, feature) {
  const p = feature.properties;
  const ids = value => {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) && parsed.length && parsed.every(id => Number.isSafeInteger(id) && id > 0)
        ? [...new Set(parsed)].sort((a, b) => a - b) : null;
    } catch { return null; }
  };
  const group = ids(p.group_relation_ids), segment = ids(p.segment_relation_ids);
  const representative = /^relation-([1-9]\d*)$/.exec(p.id || '')?.[1];
  if (!group || !segment || Number(representative) !== group[0] || !segment.every(id => group.includes(id))) {
    osmLink(panel, feature);
    panel.append(textNode('p', 'Constituent source relations are unavailable in this tile. The linked representative does not establish which relations contribute to this segment.', 'small'));
    return;
  }
  const section = textNode('section', '', 'service-source-relations');
  section.append(textNode('h3', 'OpenStreetMap source relations'));
  for (const [scope, label, values] of [['group', 'Relations in this service group', group], ['segment', 'Relations contributing to this segment', segment]]) {
    section.append(textNode('h4', label));
    const list = document.createElement('ul'); list.dataset.relationScope = scope;
    for (const id of values) {
      const item = document.createElement('li'), link = textNode('a', `Relation ${id}${scope === 'group' && id === Number(representative) ? ' (display identity)' : ''} ↗`);
      link.href = `https://www.openstreetmap.org/relation/${id}`; link.target = '_blank'; link.rel = 'noopener';
      item.append(link); list.append(item);
    }
    section.append(list);
  }
  section.append(textNode('p', 'Grouping records mapped service identity; it does not establish identical stops, timetable matches or frequency for every relation.', 'small'));
  panel.append(section);
}
// Departures from Transitous, live where the operator publishes real-time
// data, and journey links. Fetched once a minute at most per station (the
// panel is redrawn when settings change).
const departureBoards = new Map();
// Station identity usually outlives a timetable snapshot. Keep only short-
// lived, successful name matches in this tab, not timetable rows or guesses.
const departureStopMatches = new Map();
const STOP_MATCH_TTL = 15 * 60_000, STOP_MATCH_MAX = 128;
function departureBoardKey(feature, names) {
  const p = feature.properties, object = osmObject(feature);
  const id = [p.id, p.osm_id, feature.id].find(value =>
    (typeof value === 'string' && value !== '') || (typeof value === 'number' && Number.isFinite(value)));
  const rawNames = [p.name, p.full_name].filter(Boolean);
  const fallbackNames = rawNames.length ? rawNames : Object.entries(p)
    .filter(([key, value]) => key.startsWith('name:') && value).map(([, value]) => value);
  const identity = object ? ['osm', object.type, object.id] :
    ['source', feature.source ?? null, feature.sourceLayer ?? null, id ??
      [...new Set(fallbackNames.length ? fallbackNames : names)].sort()];
  // Translation changes presentation, not station identity. Keep a separate
  // unnamed lookup so resolving a deferred hub can still improve stop matching.
  // A known OSM object survives coordinate quantization across map sources.
  // Scoped or missing IDs still need the exact point to avoid local-ID aliases.
  return JSON.stringify([identity, object ? null : feature.geometry.coordinates, names.length > 0]);
}
function showDepartures(panel, feature) {
  const p = feature.properties, [lon, lat] = feature.geometry.coordinates;
  const names = [displayName(p, settings.language), p.name, p.localized_name, p['name:en'], p.full_name].filter(Boolean);
  const section = document.createElement('section'); section.className = 'departures';
  section.append(textNode('h3', 'Departures'), textNode('p', 'Loading departures…', 'small'));
  panel.append(section);
  // Matching names stay local to the request; translated redraws reuse its
  // outcome until expiry rather than bypassing the per-station cache.
  const key = departureBoardKey(feature, names);
  let board = departureBoards.get(key);
  if (!board || Date.now() - board.at > 60_000) {
    const entry = {at: Date.now(), progress: null, listeners: new Set()};
    const match = departureStopMatches.get(key);
    const identifiedStops = match && entry.at - match.at < STOP_MATCH_TTL ? match.stops : undefined;
    if (!identifiedStops) departureStopMatches.delete(key);
    let namedStops;
    entry.promise = stationDepartures({lat, lon, names}, {
      identifiedStops, onNamedStops: stops => {namedStops=stops;},
      signal: AbortSignal.timeout(15000), onProgress: progress => {
        entry.progress = progress;
        for (const listener of entry.listeners) {
          try {listener(progress);} catch (error) {console.error('Could not render provisional departures', error);}
        }
      },
    });
    board = entry;
    departureBoards.set(key, entry);
    entry.promise.then(({stopResults}) => {
      entry.progress = null; entry.listeners.clear();
      if (departureBoards.get(key) !== entry) return;
      if (stopResults.some(r=>r.status==='rejected'))departureStopMatches.delete(key);
      else if (namedStops) {
        departureStopMatches.set(key,{at:entry.at,stops:namedStops});
        while (departureStopMatches.size>STOP_MATCH_MAX)departureStopMatches.delete(departureStopMatches.keys().next().value);
      }
    }, () => {
      entry.progress = null; entry.listeners.clear();
      if (departureBoards.get(key) === entry) {
        departureStopMatches.delete(key); departureBoards.delete(key);
      }
    });
  }
  function render({stops, rows, stopResults}) {
    if (!section.isConnected) return;
    section.replaceChildren(textNode('h3', 'Departures'));
    const pending = stopResults.filter(result => result.status === 'pending').length;
    const partial = stopResults.some(result => result.status === 'rejected');
    if (pending) {
      const status = textNode('p', rows.length ? 'Departures from the first loaded timetable. Still checking another stop…' :
        pending === 1 ? 'Loading one stop timetable…' : 'Loading the matching stop timetables…', 'small departure-progress');
      status.setAttribute('role', 'status'); section.append(status);
    }
    if (partial) section.append(textNode('p', 'Some departures could not load. The board may be incomplete.', 'small departure-warning'));
    if (!rows.length && !partial && !pending) section.append(textNode('p', stops.length ? 'No rail departures in the published timetable soon.' : 'No matching rail timetable stop was found within 400 m.', 'small'));
    if (rows.length) {
      const live = rows.filter(r => r.live).length;
      section.append(textNode('p', live ? `Live times for ${live} of ${rows.length} departures; the rest are timetabled.` : 'Timetabled times: no live data for these departures.', 'small'));
      if (settings.serviceWidth === 'frequency') section.append(textNode('p', 'These departure timetables are available independently of the map’s matched frequency profiles.', 'small'));
      if (!pending) section.append(textNode('p', 'Click a departure to see its full train schedule. Drag over text to select and copy it.', 'small'));
      const list = document.createElement('ol'); list.className = 'departure-list';
      for (const r of rows) {
        list.append(departureItem(document, r, {provisional:pending>0}));
      }
      section.append(list);
    }
    if (pending) return;
    const place = stops[0]?.id || `${lat},${lon}`, name = names[0];
    const links = textNode('p', '', 'departure-links');
    for (const [direction, label] of [['from', 'Journey from here ↗'], ['to', 'Journey to here ↗']]) {
      const a = textNode('a', label); a.href = plannerLink(direction, place, name); a.target = '_blank'; a.rel = 'noopener'; links.append(a, ' ');
    }
    const source = textNode('a', 'Transitous'); source.href = TRANSITOUS_SOURCES; source.target = '_blank'; source.rel = 'noopener';
    const credit = textNode('p', 'Timetables and live data: ', 'small'); credit.append(source, ' (see its sources and licences).');
    section.append(links, credit);
  }
  const onProgress = progress => {
    if (section.isConnected) render(progress);
    else board.listeners.delete(onProgress);
  };
  if (board.progress) onProgress(board.progress);
  board.listeners.add(onProgress);
  board.promise.then(render).catch(() => {
    if (section.isConnected) section.replaceChildren(textNode('h3', 'Departures'), textNode('p', 'Departures could not load. Try again later.', 'small'));
  }).finally(() => board.listeners.delete(onProgress));

}
// Level-crossing equipment as tagged on the OSM node, read from the
// OpenStreetMap API when a crossing is opened (the crossing tiles hold only
// its kind and id).
const DETAIL_CROSSING_ZOOM = 9;
// Older crossing snapshots have no tags in their tiles; their manifest
// lacks the flag, so an untagged crossing is not reported as unequipped.
let crossingTagsKnown;
const crossingDataHasTags=()=>crossingTagsKnown||=fetch(new URL('./data/level-crossings/manifest.json',import.meta.url)).then(r=>r.ok?r.json():{}).then(m=>m.tags===true).catch(()=>{crossingTagsKnown=undefined;return false;});
async function nearestCrossing(lngLat) {
  // Columns wrap (world copies of the flat map, and 180° itself).
  const z=DETAIL_CROSSING_ZOOM, n=2**z, x=((Math.floor((lngLat.lng+180)/360*n)%n)+n)%n, lat=lngLat.lat*Math.PI/180;
  const y=Math.floor((1-Math.asinh(Math.tan(lat))/Math.PI)/2*n);
  try {
    const response=await fetch(new URL(`./data/level-crossings/${z}/${x}/${y}.pbf.gz`, import.meta.url));
    if(!response.ok) return null;
    const layer=(await labels).readTile(await decodeLifecycleTile(await response.arrayBuffer())).layers.level_crossings;
    if(!layer) return null;
    const click=map.project(lngLat);let best=null,bestDistance=12;
    for(let i=0;i<layer.length;i++) {
      const f=layer.feature(i);if(f.properties.minor) continue;
      const [{x:px,y:py}]=f.loadGeometry()[0], tx=x+px/f.extent, ty=y+py/f.extent;
      const point=[tx/n*360-180, Math.atan(Math.sinh(Math.PI*(1-2*ty/n)))*180/Math.PI];
      point[0]+=Math.round((lngLat.lng-point[0])/360)*360; // into the clicked world copy
      const screen=map.project(point);
      const distance=Math.hypot(screen.x-click.x,screen.y-click.y);
      if(distance<bestDistance) {bestDistance=distance;best={id:f.id,properties:{...f.properties},geometry:{type:'Point',coordinates:point}};}
    }
    return best;
  } catch { return null; }
}
function updateNearbyTransport() {
  const target = $('nearby-transport');
  if (!target || currentFeature?.geometry?.type !== 'Point') return;
  target.replaceChildren(textNode('h3','Nearby transport'));
  if (!settings.transport) { target.append(textNode('p','Enable “Other transport & interchanges” to see nearby facilities.','small')); return; }
  const zoom=useFlat?flatSourceContext?.getZoom():ready?map.getZoom():undefined;
  if (!(zoom>=14)) { target.append(textNode('p','Zoom in closer to list nearby terminals, stops, taxi stands and bike rental.','small')); return; }
  const sourceLayers=['poi','aerodrome_label'];
  const context=useFlat?flatSourceContext.readSourcePoints('openmaptiles',sourceLayers):{
    state:map.isSourceLoaded('openmaptiles')?'ready':'loading',
    features:sourceLayers.flatMap(sourceLayer=>map.querySourceFeatures('openmaptiles',{sourceLayer})
      .map(f=>({id:f.id,properties:f.properties,geometry:f.geometry,sourceLayer}))),
  };
  const nearby=nearbyTransport(currentFeature.geometry.coordinates,context.features,500,zoom);
  if (!nearby.length) {
    const messages={
      inactive:'Nearby transport data is not loaded in this view.',
      failed:'Nearby transport data could not be loaded.',
      ready:'No nearby transport facility appears in the loaded map data.',
      loading:'Loading nearby transport…',
    };
    target.append(textNode('p',messages[context.state],'small')); return;
  }
  const list = document.createElement('ul');list.className='nearby-list';
  for (const {feature,category,distance} of nearby) {
    const item = document.createElement('li'), button = textNode('button',displayName(feature.properties,settings.language) || category.label);
    button.type='button';button.addEventListener('click',()=>{
      if(useFlat)flatNavigation?.({center:feature.geometry.coordinates,zoom:Math.max(14,zoom)});
      else map.easeTo({center:feature.geometry.coordinates,zoom:Math.max(14,map.getZoom())});
      showDetails({...feature,source:'openmaptiles',layer:{id:`context-transport-${category.id}-label`}});
    });
    item.append(button,textNode('span',`${category.label} · ${settings.units === 'imperial' ? Math.round(distance*3.28084/50)*50+' ft' : Math.round(distance/10)*10+' m'}`,'small'));
    list.append(item);
  }
  target.append(list,textNode('p','Within 500 m in a straight line. Walking access and interchange connections are not verified.','small'));
}
let nearbyTimer;
function scheduleNearbyTransport() {
  clearTimeout(nearbyTimer);
  if ($('nearby-transport')) nearbyTimer=setTimeout(updateNearbyTransport,250);
}
const EIGHTHS = ['','⅛','¼','⅜','½','⅝','¾','⅞'];
function gauge(value) {
  const mm = Number(value);
  if (!Number.isFinite(mm) || mm <= 0) return value;
  if (settings.units !== 'imperial') return `${mm} mm`;
  const eighths = Math.round(mm/25.4*8), feet = Math.floor(eighths/96), inches = Math.floor(eighths%96/8);
  return `${feet ? `${feet} ft ` : ''}${inches}${EIGHTHS[eighths%8]} in (${mm} mm)`;
}
// Units change speed colours and labels, contour intervals and the scale bar.
function unitStyle(style) {
  const frequencyPaint=serviceFrequencyPaint(settings);
  for (const layer of style.layers) {
    const stationPaint = stationViewPaint(layer, settings.mode, map?.getZoom() ?? 1.8);
    if (stationPaint) Object.assign(layer.paint, stationPaint);
    if(layer.id==='service-routes')Object.assign(layer.paint,{'line-width':frequencyPaint.width,'line-offset':frequencyPaint.offset,'line-opacity':frequencyPaint.opacity});
    if(layer.id==='service-names')layer.layout['text-offset']=frequencyPaint.labelOffset;
    if (/^speed-(branch-overview|metro-overview|overview|tracks)$/.test(layer.id)) layer.paint['line-color'] = speedPaint(settings.units);
    if(['platform-lengths','platform-numbers'].includes(layer.id))layer.layout['text-field']=platformLengthLabel(settings.units);
    if (layer.id === 'axle-labels') layer.layout['text-field'] = axleLabel(settings.units);
    if (layer.id === 'speed-labels') layer.layout['text-field'] = speedLabel(settings.units);
    if (/^inactive-(regional|railways)-/.test(layer.id) && layer.type === 'line' && !layer.id.includes('bridge')) layer.paint['line-color'] = inactivePaint(settings.mode, settings.units);
    if (VIEW_LINE_LAYERS[layer.id]) Object.assign(layer.paint, {'line-color': viewLinePaint(layer.id, settings.mode, settings.units), 'line-width': viewLineWidth(layer.id, settings.mode)});
    if (/^terrain-(seabed-)?contour-labels/.test(layer.id)) layer.layout['text-field'] = ['concat', ['to-string', ['get','ele']], settings.units === 'imperial' ? ' ft' : ' m'];
    if (/^terrain-seabed-contours(?:-close)?$/.test(layer.id)) layer.paint['line-opacity'] = seabedContourOpacity(settings.units);
  }
  if (dem) {
    style.sources.contours.tiles = [dem.contourProtocolUrl(contourOptions(settings.units))];
    style.sources.seabedContours.tiles = [dem.contourProtocolUrl(contourOptions(settings.units, 'shelf'))];
    style.sources.seabedContoursClose.tiles = [dem.contourProtocolUrl(contourOptions(settings.units, 'close'))];
  }
}
// The scale bar measures the map in layout pixels, but More detail draws the
// map at 1/k of its size while the controls keep their normal size. Measure
// across k times the width, then draw the bar at 1/k of MapLibre's length.
function fitScale() {
  if (!scale) return;
  const k = 2 ** settings.detail, bar = map?.getContainer().querySelector?.('.maplibregl-ctrl-scale');
  if (scale.options) scale.options.maxWidth = 100 * k;
  scale.setUnit(settings.units);
  if (bar) bar.style.width = `${parseFloat(bar.style.width) / k}px`;
}
function applyUnits() {
  fitScale();
  updateFlatScale();
  if (!ready) return;
  const style = {layers: map.getStyle().layers, sources: {contours: {}, seabedContours: {}, seabedContoursClose: {}}};
  unitStyle(style);
  for (const layer of style.layers) {
    if (/^speed-(branch-overview|metro-overview|overview|tracks)$/.test(layer.id) || (/^inactive-(regional|railways)-/.test(layer.id) && !layer.id.includes('bridge'))) map.setPaintProperty(layer.id, 'line-color', layer.paint['line-color']);
    if (layer.id === 'speed-labels' || layer.id === 'axle-labels' || ['platform-lengths','platform-numbers'].includes(layer.id) || /^terrain-(seabed-)?contour-labels/.test(layer.id)) map.setLayoutProperty(layer.id, 'text-field', layer.layout['text-field']);
    if (layer.id === 'speed-labels' || layer.id === 'axle-labels' || layer.id === 'platform-lengths' || /^terrain-(seabed-)?contour-labels/.test(layer.id)) map.setLayoutProperty(layer.id, 'text-field', layer.layout['text-field']);
    if (/^terrain-seabed-contours(?:-close)?$/.test(layer.id)) map.setPaintProperty(layer.id, 'line-opacity', layer.paint['line-opacity']);
  }
  map.getSource('contours')?.setTiles(style.sources.contours.tiles);
  map.getSource('seabedContours')?.setTiles(style.sources.seabedContours.tiles);
  map.getSource('seabedContoursClose')?.setTiles(style.sources.seabedContoursClose.tiles);
}
function applyRailReferenceState() {
  if (!ready || !map) return;
  const area = railReferenceFailures?.area(map.getZoom());
  const failed = area === true || Boolean(area?.coordinates.length);
  for (const layer of map.getStyle().layers) if (isNeutralRailReference(layer)) {
    const visibility = failed && layerVisibility(layer,settings) ? 'visible' : 'none';
    if (map.getLayoutProperty(layer.id,'visibility') !== visibility)
      map.setLayoutProperty(layer.id,'visibility',visibility);
  }
}
function applyStationFallbackState() {
  if (!ready || !map?.getLayer('station-basemap-fallback-names')) return;
  const area=stationFailures?.area(map.getZoom());
  const options={zoom:map.getZoom(),stationsEnabled:settings.stations,background:settings.background,
    failedSources:new Set(area?[map.getZoom()>=8?'stations':'stationMed']:[])};
  const showMarkers=!stationWorldActive && stationFallbackMarkersEnabled(options);
  const showNames=stationFallbackNamesEnabled(options);
  for (const id of ['station-basemap-fallback-dots','station-curated-fallback-dots','station-basemap-fallback-names']) {
    const filter=stationFallbackFilter(id,area);
    if (JSON.stringify(map.getFilter(id))!==JSON.stringify(filter)) map.setFilter(id,filter);
    const visible=((id.endsWith('-names')?showNames:showMarkers) ? 'visible' : 'none');
    if (map.getLayoutProperty(id,'visibility')!==visible)
      map.setLayoutProperty(id,'visibility',visible);
    // Fallback visibility changes on source events as well as settings.
    // Keep hit testing in sync, including removal after recovery or hiding.
    clickable=clickable.filter(layerId=>layerId!==id);
    if(visible==='visible' && isClickable(id))clickable.push(id);
  }
}
function updateStatus() {
  updateMapStatus({railRecovery, stationFailures, errors, sourceFailureStates,
    applyRailReferenceState, applyStationFallbackState, status, map, ready, settings, terrain3DSelected, deferStatusCensus});
}
const unwrap = url => url.replace(/^atlas(?:base|station):\/\/[^/]+\//,'').replace(/^atlas(?:rail|lg|owner|axle|text):\/\//,'');
function localizeStyle(style) {
  // MapLibre draws Han glyphs with each layer's own font stack, so the Han
  // font (packaged or chosen installed) joins every explicit stack.
  const script=cjkScript(settings.language),family=loadedCjkFonts.has(script)?bundledCjkFamily(script):cjkChoices.get(script)?.family||null;
  for (const layer of style.layers) {
    if (shouldLocalizeLayer(layer)) layer.layout['text-field'] = labelExpression(settings.language);
    const fonts=layer.layout?.['text-font'];
    if(Array.isArray(fonts)&&fonts.every(f=>typeof f==='string')){
      const original=fonts.filter(f=>!isLocalFamily(f));
      layer.layout['text-font']=[...original,...(family?[family]:[]),RARE_HAN_FAMILY];
    }
  }
  if(style.glyphs)style.glyphs='atlasglyph://'+style.glyphs.replace(/^atlasglyph:\/\//,'');
  style.sources.openmaptiles.url = `atlasbase://${settings.language}/${unwrap(style.sources.openmaptiles.url).replace(/^pmtiles:\/\//,'')}`;
  for(const id of ['stationLow','stationMed','stations']) style.sources[id].url = `atlasstation://${settings.language}/${unwrap(style.sources[id].url)}`;
  style.sources.streetRunning.tiles = [`streettiles://{z}/{x}/{y}?lang=${settings.language}`];
  style.sources.aerialways.tiles = [`aerialwaytiles://{z}/{x}/{y}?lang=${settings.language}`];
  style.sources.inactiveRegional.tiles = [`railtiles://{z}/{x}/{y}?lang=${settings.language}`];
  style.sources.heritageAreas.tiles = [`heritagetiles://{z}/{x}/{y}?lang=${settings.language}`];
  style.sources.railway.url = `atlasrail://${unwrap(style.sources.railway.url)}`;
  style.sources.loadingLow.url = `atlaslg://${unwrap(style.sources.loadingLow.url)}`;
  style.sources.ownerLow.url = `atlasowner://${unwrap(style.sources.ownerLow.url)}`;
  style.sources.axleLow.url = `atlasaxle://${unwrap(style.sources.axleLow.url)}`;
  style.sources.axleRail.url = `atlasaxle://${unwrap(style.sources.axleRail.url)}`;
  style.sources.ownerRail.url = `atlasowner://${unwrap(style.sources.ownerRail.url)}`;
  // Every other provider source with labels is drawn as stored; its tiles
  // still pass through the rare Han glyph scan.
  const labelled=new Set(style.layers.filter(l=>l.type==='symbol'&&l.layout?.['text-field']).map(l=>l.source));
  for(const id of labelled){
    const source=style.sources[id];
    if(source?.type!=='vector')continue;
    if(/^https?:\/\//.test(source.url||''))source.url=`atlastext://${source.url}`;
    if(Array.isArray(source.tiles))source.tiles=source.tiles.map(t=>/^https?:\/\//.test(t)?`atlastext://${t}`:t);
  }
  // Known rail metadata is local; only visible tiles enter the shared queue.
  // Include unlabelled overview/platform sources, not only text sources.
  for (const source of Object.values(style.sources)) {
    if (source.type === 'vector' && source.url?.startsWith(ORM+'/')) source.url='atlasrail://'+source.url;
  }
  unitStyle(style);
  styleLanguage = settings.language;
}
// More detail: draw the map at twice (four times) the size, scaled to half
// (a quarter), one (two) zoom levels further in. The same area shows more
// tiles, features and smaller labels; the canvas keeps its pixel count.
// Controls are scaled back to normal size. The button cycles through the
// levels; its title gives the scale the map is drawn at.
// Under the scale bar: the coordinates under the cursor (the map's centre
// without one, as on a touch screen) and the zoom, where More detail adds the
// scale the map is drawn at. Turned off in the settings.
const readout = Object.assign(textNode('div', '', 'maplibregl-ctrl map-readout'), {hidden: !settings.readout});
let readoutPoint = null, flatReadout, flatScale;
function updateFlatScale() {
  if (!flatScale) return;
  const bar = flatSourceContext.scaleBar(settings.units);
  flatScale.hidden = !bar;
  if (!bar) return;
  const label = bar.value + ' ' + bar.unit;
  const width = bar.width.toFixed(2) + 'px';
  if (flatScale.textContent !== label) flatScale.textContent = label;
  if (flatScale.style.width !== width) flatScale.style.width = width;
}
function updateReadout() {
  if (readout.hidden) return;
  if (useFlat) {
    if (flatReadout) {
      const [[lng,lat],zoom]=flatReadout;
      readout.textContent=formatReadout({lng,lat},zoom,0);
    }
    return;
  }
  if (!map) return;
  const center=map.getCenter(),zoom=map.getProjection()?.type==='globe'?readoutZoom(map.getZoom(),center.lat):map.getZoom();
  readout.textContent = formatReadout(readoutPoint ? map.unproject(readoutPoint) : center, zoom, settings.detail);
}
// Track-count badges (see build-style.mjs): running tracks, a group wholly
// in tunnels, and all the tracks at a station.
const TRACK_BADGES = {'track-badge': {edge: '#173e47', fill: '#fffef8'}, 'track-badge-tunnel': {edge: '#7d949c', fill: '#e3eaec'}, 'track-badge-station': {edge: '#c47d12', fill: '#fff3da'}};
const detailButton = Object.assign(document.createElement('button'), {type:'button', className:'atlas-ctrl', textContent:'⊞'});
const detailScale = level => 100 / 2 ** level;
const drawButton = Object.assign(document.createElement('button'), {type:'button', className:'atlas-ctrl', textContent:'✎', title:'Drawing tools'});
// Globe or flat map. Web Mercator stretches high latitudes without limit;
// the globe (MapLibre's vertical-perspective projection) shows every region
// at its true shape. The button switches either way; automatically (unless
// turned off in the settings) the map becomes the globe below zoom 4 and
// the flat map from zoom 4, except where most of the view is beyond 60° N or
// S (autoProjection). It acts only when that choice changes, so a manual
// switch holds until then.
const polarButton = Object.assign(document.createElement('button'), {
  type:'button', className:'atlas-ctrl', id:'globe-toggle', textContent:'🌍',
  title:'Globe view. Zoom out to see curvature; close views render flat.',
});
polarButton.setAttribute('aria-label','Globe view');
polarButton.setAttribute('aria-description','Zoom out to see curvature. Close views render flat.');
let lastAutoProjection;
function polarShare() {
  // Layout size, not on-screen size: More detail draws the map scaled.
  const {clientWidth: width, clientHeight: height} = map.getContainer();
  let polar = 0, total = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const {lat} = map.unproject([width * i / 10, height * j / 10]);
    total++; if (Math.abs(lat) > 60) polar++;
  }
  return polar / total;
}
const onGlobe = () => map?.getProjection?.()?.type === 'globe';
function wantedProjection() {
  // More detail draws one zoom level further in.
  const zoom = map.getZoom() - settings.detail;
  return autoProjection(zoom, zoom < 4 ? 0 : polarShare());
}
let syncPanning = () => {}, globeDragged = () => false, globePan = () => false, polarCentres;
function updatePolar() {
  if (!map) return;
  if (settings.autoGlobe) {
    const wanted = wantedProjection();
    if (wanted !== lastAutoProjection) {
      lastAutoProjection = wanted;
      if (wanted && wanted !== (onGlobe() ? 'globe' : 'mercator')) map.setProjection({type: wanted});
    }
  }
  const globe = onGlobe();
  polarButton.setAttribute('aria-pressed', String(globe));
  syncPanning(); saveView();
}
polarButton.addEventListener('click', () => { map.setProjection({type: onGlobe() ? 'mercator' : 'globe'}); updatePolar(); });
const measureButton = Object.assign(document.createElement('button'), {type:'button', className:'atlas-ctrl', textContent:'📏', title:'Measure'});
measureButton.setAttribute('aria-label','Measure');
// Native 3D relief control. Use a genuine vector mountain/bathymetry glyph
// rather than rendering the literal text "3D" in a MapLibre icon button.
const terrainButton = Object.assign(document.createElement('button'), {
  type:'button', className:'atlas-ctrl atlas-terrain-toggle', id:'terrain-toggle',
});
const terrainIcon = document.createElementNS('http://www.w3.org/2000/svg','svg');
terrainIcon.setAttribute('viewBox','0 0 24 24');
terrainIcon.setAttribute('aria-hidden','true');
for (const d of [
  'M2 18.5 7.5 7l3.6 6.4L15 4l7 14.5H2Z',
  'M5.2 11.3 7.5 13.7l1.4-1.3',
  'M13.3 9l1.7 2 1.7-1.6',
  'M3 21c2-1 4-1 6 0s4 1 6 0 4-1 6 0',
]) {
  const path = document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',d); terrainIcon.append(path);
}
terrainButton.append(terrainIcon);
const terrainScaleIndicator = Object.assign(document.createElement('span'),{
  className:'terrain-scale-indicator',
});
terrainScaleIndicator.setAttribute('aria-hidden','true');
terrainButton.append(terrainScaleIndicator);
function updateTerrainButton() {
  const enabled = terrain3DEnabled(settings.relief, terrain3DSelected) &&
    map?.getTerrain?.()?.source === 'terrain3d';
  terrainButton.setAttribute('aria-pressed', String(Boolean(enabled)));
  const scale = settings.terrainExaggeration;
  terrainScaleIndicator.textContent = `${scale}×`;
  terrainButton.title = enabled ? `Switch to 2D map (current 3D relief: ${scale}× vertical; keep current zoom)` :
    `Inspect 3D terrain and seabed (${scale}× vertical; change in Settings)`;
  terrainButton.setAttribute('aria-label',terrainButton.title);
}
terrainButton.addEventListener('click', () => {
  if (!map) return;
  const was3D = terrain3DEnabled(settings.relief, terrain3DSelected);
  if (!settings.relief) {settings.relief = true; applySettings(); saveSettings();}
  if (was3D && !deferStatusCensus) {
    // moveend may run synchronously from stop() or from the flat camera.
    // The previous frame still contains the terrain depth framebuffer.
    deferStatusCensus = true;
    map.once('render', () => { deferStatusCensus = false; updateStatus(); });
  }
  // easeTo stops any older camera animation and emits its moveend first.
  // Finish that animation before arming suppression for the new 2D exit.
  map.stop?.();
  terrain3DSelected = !was3D;
  terrain3DExitPending = was3D && terrain3DSelectedForPitch(map.getPitch());
  syncTerrain3D(map, settings.relief, settings.terrainExaggeration, terrain3DSelected);
  updateTerrainButton();
  saveView();
  const view = terrain3DViewTarget({zoom:map.getZoom(),detail:settings.detail,active:was3D,
    globe:onGlobe(), latitude:map.getCenter().lat});
  // Intermediate 3D camera poses make MapLibre synchronously read terrain
  // coordinates for scale and other map UI before the next frame. Apply the
  // final camera in one input turn; normal terrain loading and diagnostics
  // still run, and exiting keeps the current zoom as before.
  map.easeTo({...view,duration:0});
});
updateTerrainButton();
const MIN_ZOOM = 1, MAX_ZOOM = 20;
function applyDetail(from = settings.detail) {
  const level = settings.detail, next = (level + 1) % (DETAIL_LEVELS + 1);
  $('map').classList.toggle('detail', level > 0);
  $('map').classList.toggle('detail-2', level === 2);
  detailButton.setAttribute('aria-pressed', String(level > 0));
  detailButton.title = `More detail: map drawn at ${detailScale(level)}%. Click for ${next ? `${detailScale(next)}%` : '100% (normal)'}.`;
  detailButton.setAttribute('aria-label', detailButton.title);
  if (!map) return;
  map.setPixelRatio(devicePixelRatio / 2 ** level);
  // The zoom range shifts with the level, so a change always moves exactly
  // that many levels and keeps the viewport, even at the zoom limits.
  const shift = level - from;
  if (shift > 0) { map.setMaxZoom(MAX_ZOOM + level); map.jumpTo({zoom: map.getZoom() + shift}); map.setMinZoom(MIN_ZOOM + level); }
  else { map.setMinZoom(MIN_ZOOM + level); if (shift) map.jumpTo({zoom: map.getZoom() + shift}); map.setMaxZoom(MAX_ZOOM + level); }
  // On the globe the smallest zoom follows the latitude (globe-drag.mjs).
  polarCentres?.refresh();
  fitScale();
}
detailButton.addEventListener('click', () => { const from = settings.detail; settings.detail = (from + 1) % (DETAIL_LEVELS + 1); applyDetail(from); saveSettings(); });
applyDetail();
class ButtonControl {
  constructor(buttons) { this.buttons = buttons; }
  onAdd() { this.container = Object.assign(document.createElement('div'), {className:'maplibregl-ctrl maplibregl-ctrl-group'}); this.container.append(...this.buttons); return this.container; }
  onRemove() { this.container.remove(); }
}
// Drawing tools: points, lines and areas, kept in this browser and saved or
// opened as GeoJSON.
function updateDrawing() {
  drawButton.setAttribute('aria-pressed', String(!$('draw-toolbar').hidden));
  measureButton.setAttribute('aria-pressed', String(!$('measure-toolbar').hidden));
  document.querySelectorAll('[data-draw]').forEach(b => b.setAttribute('aria-pressed', String(drawing?.mode === b.dataset.draw && !drawing.paused)));
  $('draw-pan').setAttribute('aria-pressed', String(Boolean(drawing?.paused)));
  $('draw-pan').disabled = !drawing?.mode;
  // Curve points apply to lines; the selected point's actions.
  $('draw-curved').disabled = drawing?.mode !== 'line';
  $('draw-curved').setAttribute('aria-pressed', String(Boolean(drawing?.curved)));
  const selected = drawing?.selection();
  $('draw-node').hidden = !selected;
  if (selected) {
    $('node-curve').hidden = !selected.canCurve;
    $('node-curve').textContent = selected.curved ? 'Make corner' : 'Make curved';
    $('node-extend').hidden = !selected.canExtend;
  }
  $('measure-delete').hidden = measuring?.selected === null || measuring?.selected === undefined;
  $('measure-profile').hidden = !measuring?.profileCoordinates();
  $('measure-finish').hidden = measuring?.mode !== 'distance';
  $('measure-finish').disabled = !(measuring?.points.length >= 2) || measuring.ended;
  if ($('measure-retry')) $('measure-retry').hidden = !measuring?.canRetryHeights;
  document.querySelectorAll('[data-measure]').forEach(b => b.setAttribute('aria-pressed', String(measuring?.mode === b.dataset.measure)));
}
// Drawing and measuring are exclusive: opening one closes the other.
function openTools(id) {
  for (const [toolbar, tool] of [['draw-toolbar', drawing], ['measure-toolbar', measuring]]) {
    const show = toolbar === id && $(toolbar).hidden;
    $(toolbar).hidden = !show;
    if (!show && tool?.active) tool.setMode(tool.mode);
    if (show && toolbar === 'measure-toolbar' && measuring && !measuring.active) measuring.setMode('distance');
  }
  updateDrawing();
}
drawButton.addEventListener('click', () => openTools('draw-toolbar'));
measureButton.addEventListener('click', () => openTools('measure-toolbar'));
$('draw-close').addEventListener('click', () => openTools(null));
$('measure-close').addEventListener('click', () => openTools(null));
document.querySelectorAll('[data-measure]').forEach(b => b.addEventListener('click', () => measuring?.setMode(b.dataset.measure)));
$('measure-finish').addEventListener('click', () => measuring?.end());
$('measure-undo').addEventListener('click', () => measuring?.undo());
$('measure-clear').addEventListener('click', () => measuring?.clear());
$('measure-retry')?.addEventListener('click', () => measuring?.retryHeights());
$('measure-profile').addEventListener('click', () => {
  const coordinates = measuring?.profileCoordinates();
  if (!coordinates) return;
  const name = measuring.mode === 'radius' ? 'Curve radius elevation profile' : 'Distance elevation profile';
  void showProfile({geometry: {type:'LineString', coordinates}, properties: {name}}, {measured:true});
});
// Selected points: delete after confirmation.
$('measure-delete').addEventListener('click', () => { if (confirm('Delete this point?')) measuring?.deleteSelected(); });
$('node-delete').addEventListener('click', () => { if (confirm('Delete this point?')) drawing?.deleteSelected(); });
$('node-curve').addEventListener('click', () => drawing?.toggleSelectedCurve());
$('node-extend').addEventListener('click', () => {
  drawing?.extendSelected();
  // The extended line keeps its own style; show it in the style controls.
  if (drawing) { drawStyle({color: drawing.style.color}); $('draw-dash').value = drawing.style.dash; $('draw-width').value = String(drawing.style.width); }
});
$('draw-curved').addEventListener('click', () => drawing?.setCurved(!drawing.curved));
// Drawing style: colour, line style and width for new drawings.
function reflectDrawingColor(color) {
  $('draw-color').value = color;
  document.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === color)));
}
function drawStyle(style) {
  whenMap(() => drawing.setStyle(style));
  if (style.color) reflectDrawingColor(style.color);
}
function inspectionIdentity(feature) {
  const source=feature?.source, sourceLayer=feature?.sourceLayer??feature?.layer?.['source-layer'];
  if(!feature) return null;
  const raw=feature.id;
  const hasID=typeof raw==='number'&&Number.isSafeInteger(raw)||typeof raw==='string'&&raw.length;
  const osm=hasID ? null : osmObject(feature);
  const id=hasID ? String(raw) : osm ? `${osm.type}:${osm.id}` : '';
  const geometry=feature?.geometry?.type?.replace(/^Multi/,'');
  return typeof source==='string'&&source.length&&source.length<=100&&
    (sourceLayer===undefined||typeof sourceLayer==='string'&&sourceLayer.length<=100)&&
    id.length&&id.length<=100&&['Point','LineString','Polygon'].includes(geometry)
      ? {source,sourceLayer:sourceLayer??'',id,geometry} : null;
}
function rendererSelection(feature) {
  const key=inspectionIdentity(feature);
  const location=feature?.geometry?.type==='Point'?feature.geometry.coordinates:
    [feature?.clickLngLat?.lng,feature?.clickLngLat?.lat];
  const at=Array.isArray(location) ? location.slice(0,2) : null;
  return key&&at?.length===2&&at.every(Number.isFinite)&&Math.abs(at[0])<=540&&Math.abs(at[1])<=90 ? {key,at} : null;
}
function restoreRendererSelection(selection, query) {
  const {key,at}=selection||{};
  if (!query||settings.ui==='watch'||!key||!Array.isArray(at)||at.length!==2||
      !at.every(Number.isFinite)||Math.abs(at[0])>540||Math.abs(at[1])>90) return;
  const mount=$('map');
  const cancel=()=>{
    clearInterval(retry);clearTimeout(deadline);
    mount.removeEventListener('pointerdown',cancel,true);
    if(cancelSelectionRestore===cancel)cancelSelectionRestore=null;
  };
  // Ask only for hits at the saved location and only while a pending handoff
  // exists. Re-resolve from painted, selectable features, not saved details.
  const retry=setInterval(()=>{
    if(settings.ui==='watch'){cancel();return;}
    const feature=query(at)?.find(candidate=>{
      const other=inspectionIdentity(candidate);
      return other&&other.source===key.source&&other.sourceLayer===key.sourceLayer&&
        other.id===key.id&&other.geometry===key.geometry;
    });
    if (!feature) return;
    cancel();
    const [lng,lat]=at;
    feature.properties=feature.properties?.atlas_han ? feature.properties : {...feature.properties,...locate(lng,lat)};
    feature.clickLngLat={lng,lat};
    showDetails(feature);
    if(!useFlat)renameOpenMajorStation();
  },125);
  const deadline=setTimeout(cancel,12000);
  cancelSelectionRestore=cancel;
  mount.addEventListener('pointerdown',cancel,{capture:true,once:true});
}
function restoreRendererWork(querySelection) {
  if (!stagedFlatEntry) return;
  let pending,state;
  const consume = () => {
    try { if (sessionStorage.getItem(RENDERER_WORK_HANDOFF) === pending) sessionStorage.removeItem(RENDERER_WORK_HANDOFF); } catch {}
  };
  try {
    pending=sessionStorage.getItem(RENDERER_WORK_HANDOFF);
    if (pending===null) return;
    state=JSON.parse(pending);
  } catch { if (pending) consume(); return; }
  restoreRendererSelection(state?.selection,querySelection);
  if (state?.measurement && !state.drawing) {
    $('measure-toolbar').hidden=false;
    if(!measuring.restoreRendererMeasurement(state.measurement)){
      $('measure-status').textContent='The measurement could not be resumed.';
      updateDrawing();
    }
    consume();
    return;
  }
  if (!state?.drawing) {consume();return;}
  $('draw-toolbar').hidden=false;
  if(!drawing.restoreRendererDraft(state.drawing)){
    if (!drawing.recoverRendererLine(state.drawing)) {
      $('draw-status').textContent='The unfinished drawing could not be resumed. Saved drawings remain unchanged.';
      updateDrawing();
      return;
    }
    $('draw-status').textContent='The original line could not be identified. Finish to save the recovered draft as a new line. Saved drawings remain unchanged.';
  }
  consume();
  reflectDrawingColor(drawing.style.color);
  $('draw-dash').value=drawing.style.dash;
  $('draw-width').value=String(drawing.style.width);
}
document.querySelectorAll('[data-color]').forEach(b => { b.style.setProperty('--c', b.dataset.color); b.addEventListener('click', () => drawStyle({color: b.dataset.color})); });
$('draw-color').addEventListener('input', () => drawStyle({color: $('draw-color').value}));
$('draw-dash').addEventListener('change', () => drawStyle({dash: $('draw-dash').value}));
$('draw-width').addEventListener('change', () => drawStyle({width: Number($('draw-width').value)}));
document.querySelectorAll('[data-draw]').forEach(b => b.addEventListener('click', () => whenMap(() => drawing.setMode(b.dataset.draw))));
$('draw-pan').addEventListener('click', () => drawing?.setPaused(!drawing.paused));
$('draw-undo').addEventListener('click', () => drawing?.undo());
$('draw-finish').addEventListener('click', () => drawing?.finish());
$('draw-clear').addEventListener('click', () => {
  // A first unfinished shape, or the original held by an extension, can
  // exist without any finished features. Clear covers those drawings too.
  if (drawing && (drawing.features.length || drawing.draft.length || drawing.extending) && confirm('Delete all drawings?')) drawing.clear();
});
$('draw-save').addEventListener('click', () => {
  if (!drawing) return;
  const link = Object.assign(document.createElement('a'), {href:URL.createObjectURL(drawing.file()), download:`railway-atlas-drawing-${new Date().toISOString().slice(0,10)}.geojson`});
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
$('draw-open').addEventListener('click', () => $('draw-file').click());
$('draw-file').addEventListener('change', async () => {
  const file = $('draw-file').files[0]; $('draw-file').value = '';
  if (!file || !drawing) return;
  try {
    const features = readDrawing(JSON.parse(await file.text()));
    drawing.add(features);
    $('draw-status').textContent = features.length ? `Opened ${features.length} drawing${features.length > 1 ? 's' : ''}.` : 'No points, lines or areas found in that file.';
  } catch { $('draw-status').textContent = 'That file is not valid GeoJSON.'; }
});
addEventListener('keydown', event => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName) ||
      event.target.closest?.('.atlas-flat-compass, .atlas-flat-zoom-button, .atlas-flat-location')) return;
  if (measuring?.active) { if (event.key === 'Enter') measuring.end(); if (event.key === 'Escape') measuring.clear(); return; }
  if (!drawing?.active) return;
  if (event.key === 'Enter') drawing.finish();
  if (event.key === 'Escape') drawing.cancel();
});
// A drawing-layer failure must not stop the map from loading.
function installDrawing() {
  try { drawing.install(); measuring.install(); } catch (error) { console.error('Drawing tools unavailable:', error?.message || String(error)); }
  installPolar();
}
// The polar caps beyond 85.05°, which Web Mercator tiles do not reach, drawn
// on the globe from data prepared in a polar projection (polar-layer.mjs).
// Added below roads, borders, labels and railways; again after each style
// replacement. Place names there are markers.
let polarLayer, polarLoading, polarMarkers = new Map();
function showPolarPlaces(places) {
  const wanted = new Map(places.map(p => [`${p.lngLat[0]},${p.lngLat[1]},${settings.language},${p.contour ? p.name : ''}`, p]));
  for (const [key, marker] of polarMarkers) if (!wanted.has(key)) { marker.remove(); polarMarkers.delete(key); }
  for (const [key, place] of wanted) {
    if (polarMarkers.has(key)) continue;
    const element = textNode('span', displayName(place, settings.language) || place.name || '', 'polar-place');
    polarMarkers.set(key, new maplibregl.Marker({element}).setLngLat(place.lngLat).addTo(map));
  }
  // Labels that would overlap give way, the larger kinds of place first.
  const rank = place => {const k = POLAR_PLACE_ORDER.indexOf(place.place); return k < 0 ? POLAR_PLACE_ORDER.length : k;};
  const taken = [];
  for (const [key, place] of [...wanted].sort((a, b) => rank(a[1]) - rank(b[1]))) {
    const element = polarMarkers.get(key).getElement(), at = map.project(place.lngLat);
    const w = element.offsetWidth / 2 + 2, h = element.offsetHeight / 2 + 2;
    const clash = taken.some(([x, y, tw, th]) => Math.abs(x - at.x) < w + tw && Math.abs(y - at.y) < h + th);
    element.style.visibility = clash ? 'hidden' : '';
    if (!clash) taken.push([at.x, at.y, w, h]);
  }
}
const POLAR_PLACE_ORDER = ['continent', 'country', 'state', 'region', 'province', 'city', 'town', 'village', 'hamlet', 'locality', 'isolated_dwelling', 'island', 'islet'];
function installPolar() {
  if (!map) return;
  if (polarLayer) { if (!map.getLayer(polarLayer.id)) map.addLayer(polarLayer, map.getLayer('waterway-tunnel') ? 'waterway-tunnel' : undefined); return; }
  polarLoading ||= import(`./vendor/polar-layer.js?v=${assetVersion}`).then(({PolarLayer}) => {
    polarLayer = new PolarLayer({data: new URL('./data/polar/', import.meta.url), units: () => settings.units, relief: () => settings.relief, places: showPolarPlaces, overlayVisibility: layer => layerVisibility(layer,{...settings,background:'map'}), imagery: () => ['satellite','hybrid'].includes(settings.background), palette: () => settings.background});
    installPolar();
  }).catch(error => console.warn('Polar caps unavailable:', error?.message || error));
}
// Once the map object exists (drawing needs it; loading can still be under way).
function whenMap(action) { if (drawing) action(); else pendingDraw = action; }
let pendingDraw;
let locate = () => ({});
async function initialize() {
  // First-party inputs do not depend on the rendering libraries. Fetch them
  // while those scripts and the label bundle load, but create no map until
  // all four inputs are ready. Promise.all also observes early fetch errors.
  const styleURL = new URL(`world.style.json?v=${encodeURIComponent(assetVersion)}`, import.meta.url);
  const styleResponse = fetch(styleURL).then(async response => {
    if (!response.ok) throw new Error('The map style could not load. Reload to try again.');
    return response.json();
  });
  // Esri imagery only when the deployment configures a key; EOX otherwise.
  const imageryConfig=loadImageryConfig(new URL('./imagery-config.json',import.meta.url),{fetcher:fetch});
  const prepareBasemap = Promise.all([pmtilesLibrary, labels, styleResponse]).then(([, code, style])=>{
    const source=code.createBasemapSourceFactory(pmtiles);
    const archive=url=>new pmtiles.PMTiles(code.timedSource(source(url),20000));
    return code.warmInitialBasemapArchive(archive,{
      sourceURL:style.sources.openmaptiles?.url, background:settings.background,
    });
  });
  const [, labelCode, style, imagery, basemapArchive] = await Promise.all([libraries, labels, styleResponse, imageryConfig, prepareBasemap]);
  const {installLabelProtocols, localizeTile, tileTextBlocks} = labelCode;
  locate = labelCode.locate;
  servedBuild = labelCode.buildInfo;
  if ((!useFlat && !window.maplibregl) || !window.pmtiles) throw new Error('Map libraries could not load. Check your connection and reload.');
  // MapLibre 5 has no top-level supported() export. The Map constructor checks
  // WebGL itself; initialization errors are caught by the handler below.
  // Register providers once; MapLibre receives the same handlers the flat renderer can read.
  const tileProtocols = createSharedTileProtocols(useFlat ? {} : {forward: maplibregl.addProtocol.bind(maplibregl)});
  const protocol = new pmtiles.Protocol();
  protocol.tile = shareArchiveRequests(protocol.tile.bind(protocol));
  tileProtocols.addProtocol('pmtiles', protocol.tile);
  // Both the labelled basemap and bathymetry read the same PMTiles archive.
  // Create it with the timeout wrapper once, before either consumer can ask
  // Protocol.tile() to create an untimed default FetchSource for that URL.
  const requestRefresh=createReferenceRefresh(()=>{if(ready)applyRailReferenceState();});
  worldGlyphFallback = labelCode.createGlyphFallback({worldFonts, language: () => settings.language});
  const labelProtocols = installLabelProtocols(tileProtocols,protocol,fetch,{dataRoot:new URL('./data/', import.meta.url), basemapArchive, rareGlyphs:rareHanFonts.ensure, glyphFallback: worldGlyphFallback,
    onRequestChange:requestRefresh.notify, isMoving:() => Boolean(map?.isMoving() || map?.isZooming())});
  const reference=createReferenceReader({root:new URL('./data/mainline-reference/',import.meta.url)});
  tileProtocols.addProtocol('mainlinetiles',async(params,controller)=>({
    data:await reference.tile(params.url.slice('mainlinetiles://'.length),controller.signal),
  }));
  // Reuse the renderer's rail provider protocol: it resolves the published
  // composite tile path, validates vector data and shares the request cache.
  const platformGeometryFor=(tileURL,source,zoom)=>createPlatformTileGeometry({
    zoom,tileURL,
    fetcher:async(url,{signal})=>{
      const protocolURL=url.startsWith('atlasrail://')||url.startsWith('atlastext://')?url:'atlasrail://'+url;
      const {data}=await tileProtocols.read({url:protocolURL,type:'arrayBuffer'},{signal});
      return {ok:true,arrayBuffer:async()=>data};
    },
    decode:data=>labelCode.platformTilePieces(data,source),
  });
  const edgeGeometryFor=tileURL=>platformGeometryFor(tileURL,'standard_railway_platform_edges',17);
  stationTileFor=labelProtocols?.stationTile||null;
  if(ready)updateMajorStations();
  // The contour worker with the terrain tiles' bad pixels repaired
  // (dem-worker.mjs); relief shading reads its tiles through it too.
  mlcontour.workerUrl = new URL(`vendor/dem-worker.js?v=${assetVersion}`, import.meta.url).href;
  dem = new mlcontour.DemSource({url:DEM_URL,encoding:'terrarium',maxzoom:15,worker:true,cacheSize:200,timeoutMs:20000,id:'atlas'});
  dem.setupMaplibre(tileProtocols);
  // Level crossings, branch lines, service routes and signals are served as
  // stored (names not localized); the rare Han in their text still loads.
  for (const [scheme,folder,names = true] of [['railtiles','lifecycle'],['streettiles','street-running'],['crossingtiles','level-crossings',false],['branchtiles','branch-lines',false],['axlebranch','branch-lines',false],['servicetiles','service-routes',false],['signaltiles','traction/signals',false],['conveyingtiles','conveying',false],['aerialwaytiles','aerialways']]) {
  const lifecycleRoot = new URL(`./data/${folder}/`, import.meta.url);
  let tileIndex;
  tileProtocols.addProtocol(scheme, async (params, controller) => {
    const [key,query] = params.url.slice((scheme+'://').length).split('?');
    const lang = new URLSearchParams(query).get('lang') || 'local';
    if (!/^\d+\/\d+\/\d+$/.test(key)) throw new Error('Invalid lifecycle tile');
    tileIndex ||= fetch(new URL('index.json', lifecycleRoot)).then(async response => {
      if (!response.ok) throw new Error('The railway tile index could not load');
      return new Set((await response.json()).tiles);
    }).catch(error => { tileIndex = undefined; throw error; });
    if (!(await tileIndex).has(key)) return {data: new ArrayBuffer(0)};
    const response = await fetch(new URL(`${key}.pbf.gz`, lifecycleRoot), {signal: controller.signal});
    if (!response.ok) throw new Error(`Railway tile returned ${response.status}`);
    const [z,x,y] = key.split('/').map(Number);
    const data = await decodeLifecycleTile(await response.arrayBuffer());
    if (!names) {
      const stored = scheme==='axlebranch' ? await labelProtocols.axleTile(data) : data, found = tileTextBlocks(stored);
      if (found.size) await rareHanFonts.ensure(found);
      return {data: stored};
    }
    const found = new Set(), localized = localizeTile(data,lang,{z,x,y},found);
    if (found.size) await rareHanFonts.ensure(found);
    return {data: localized};
  });
  }
  // Historic areas come in bundles of tiles (tile-bundles.mjs); a snapshot in
  // the earlier one-file-per-tile layout, or none yet, still reads.
  tileProtocols.addProtocol('energynetwork',createEnergyNetworkProtocol({root:new URL('./data/energy-network/',import.meta.url),active:()=>settings.mode==='electrification'}));
  const heritage = createBundleReader({root:new URL('./data/heritage/', import.meta.url)});
  tileProtocols.addProtocol('heritagetiles', async (params, controller) => {
    const [key,query] = params.url.slice('heritagetiles://'.length).split('?');
    if (!/^\d+\/\d+\/\d+$/.test(key)) throw new Error('Invalid historic area tile');
    const [z,x,y] = key.split('/').map(Number);
    const data = await heritage.tile(z,x,y,controller.signal);
    if (!data) return {data: new ArrayBuffer(0)};
    const found = new Set(), localized = localizeTile(data,new URLSearchParams(query).get('lang') || 'local',{z,x,y},found);
    if (found.size) await rareHanFonts.ensure(found);
    return {data: localized};
  });
  installSovietStyle(style);
  tileProtocols.addProtocol('atlassoviet', sovietTile);
  const imageryProtocol=createImageryProtocol({esriKey:imagery.esriKey}),eoxAttribution=style.sources.satellite.attribution;
  tileProtocols.addProtocol('atlasimagery',imageryProtocol.tile);
  applyImageryConfig(style.sources.satellite, imagery);
  // Independent fallback uses only existing basemap tiles and vetted hubs.
  // It is not a complete replacement for a worldwide station inventory.
  addStationFallbackLayers(style,{annotateLayers,labelExpression});
  installHybridRailCasings(style);
  // Keep the style's version-matched station copy available during the first
  // upgrade from a worker whose fixed precache does not know the new file.
  // Parsing/rendering its GeoJSON in MapLibre remains deferred to the overview.
  majorStationData=style.sources.stationMajor.data;
  style.sources.stationMajor.data={type:'FeatureCollection',features:[]};
  // The tile painter and the water mask must share the same absolute archive
  // key. A relative local PMTiles source is supported, but the timed range
  // source needs an absolute URL to identify its origin.
  for (const source of Object.values(style.sources)) {
    if (source.url?.startsWith('pmtiles://data/')) source.url = 'pmtiles://' + new URL(source.url.slice(10), styleURL).href;
  }
  const waterArchive = style.sources.openmaptiles.url;
  const waterArchiveKey = waterArchive.replace(/^pmtiles:\/\//,'');
  if (waterArchiveKey !== waterArchive && !protocol.tiles.has(waterArchiveKey)) protocol.tiles.set(waterArchiveKey, basemapArchive(waterArchiveKey));
  const readWaterTile = (z, x, y, controller) => {
    // A label retry may remove the shared archive during its backoff.
    if (!protocol.tiles.has(waterArchiveKey)) protocol.tiles.set(waterArchiveKey, basemapArchive(waterArchiveKey));
    return protocol.tile({url: `${waterArchive}/${z}/${x}/${y}`, type: 'arrayBuffer'}, controller);
  };
  const readWater = data => labelCode.readTile(data, ['water']);
  surfaceElevation = createSurfaceElevation(DEM_URL, {waterTile:readWaterTile, readTile:readWater});
  installBathymetry(tileProtocols, dem, {
    isMoving:() => Boolean(map?.isMoving() || map?.isZooming()),
    waterTile: readWaterTile, readTile: readWater,
    createWorker: () => new Worker(new URL(`vendor/depth-worker.js?v=${assetVersion}`, import.meta.url)),
  });
  // Distinct 3D mesh: fine DEM loses sea depth above zoom 10. The original
  // repair and ocean polygons restore correct land and seabed heights.
  installTerrain3D(tileProtocols, dem, {
    waterTile: readWaterTile, readTile: readWater,
    createWorker: () => new Worker(new URL(`vendor/terrain-3d-worker.js?v=${assetVersion}`, import.meta.url)),
  });
  const flatTemplate=stagedFlatEntry?structuredClone(style):null;
  // Apply language before constructing the map, avoiding an initial duplicate
  // station-tile download in the wrong language.
  // This also sets the contour sources (unitStyle). Relief and all contours
  // share one elevation loader and tile cache.
  localizeStyle(style);
  style.sources.relief.tiles = [dem.sharedDemProtocolUrl];
  // Resolve the same initial visibility policy for both renderers. Canvas
  // can recompute it from source when a setting changes without remounting.
  const applyInitialVisibility=(style,canvas=false)=>{
    for (const layer of style.layers) {
      const visible=isNeutralRailReference(layer)&&!canvas ? false : layerVisibility(layer, settings);
      // Station fallback names are used only after the ORM station source fails.
      // Avoid flashing fallback names during the first frame of a healthy load.
      const independent=['station-basemap-fallback-dots','station-basemap-fallback-names','station-curated-fallback-dots'].includes(layer.id);
      const enabled=layer.id.startsWith('station-') && layer.id.includes('-fallback-')
        ?canvas&&independent&&settings.stations&&settings.background!=='satellite':visible;
      if(enabled!==undefined)(layer.layout ||= {}).visibility=enabled?'visible':'none';
      if (isLowZoomStationLayer(layer.id)) (layer.paint ||= {})['text-color'] = lowZoomStationTextColor();
    }
  };
  applyInitialVisibility(style);
  // Reopen where the last visit ended, unless the link gives a position; start
  // on the globe (or as last left) so the first frame is not the flat map.
  const linkedView = parseViewHash(captureViewHash()), linked = Boolean(linkedView), start = linked ? {} : rememberedView;
  if (linked && linkedTerrainMode === null && terrain3DSelectedForPitch(linkedView.pitch))
    terrain3DSelected = true;
  const startZoom = linked ? readoutZoom(linkedView.zoom, linkedView.center[1]) : Number.isFinite(start.z) ? start.z : 1.8;
  // A centre beyond 85.05° exists only on the globe: open there, or the flat
  // map would pull it back to its edge.
  const startLat = linked ? linkedView.center[1] : Array.isArray(start.c) ? start.c[1] : 0;
  const startGlobe = Math.abs(startLat) > 85.051129 || (typeof rememberedView.g === 'boolean' ? rememberedView.g : settings.autoGlobe && startZoom - settings.detail < 4);
  style.projection = {type: startGlobe ? 'globe' : 'mercator'};
  // Restore the selected rendering mode even for a directly overhead view.
  // Fresh 2D visits still avoid terrain mesh requests.
  if (terrain3DEnabled(settings.relief, terrain3DSelected)) style.terrain = {source:'terrain3d', exaggeration:terrainExaggeration(settings.terrainExaggeration)};
  const validCenter = Array.isArray(start.c) && start.c.length === 2 && start.c.every(Number.isFinite);
  // Use the constructor's actual zoom before its first frame. Linked camera
  // restoration and every later zoom refresh the same scalar width below.
  for(const layer of style.layers){
    const paint=stationViewPaint(layer,settings.mode,Number.isFinite(start.z)?start.z:1.8);
    if(paint)Object.assign(layer.paint,paint);
  }
  if (!useFlat) {
    // MapLibre adds DOM and a scroll handler before its actual context
    // request. Keep a failed staged attempt off the shared map element.
    const container = stagedFlatEntry ? document.createElement('div') : 'map';
    if (stagedFlatEntry) {
      Object.assign(container.style,{position:'absolute',inset:'0'});
      $('map').append(container);
    }
    try {
      map = new maplibregl.Map({
        container, style, localIdeographFontFamily: cjkFont(settings.language), pixelRatio: devicePixelRatio / 2 ** settings.detail,
        center: validCenter ? start.c : [15,23], zoom: Number.isFinite(start.z) ? start.z : 1.8, bearing: Number.isFinite(start.b) ? start.b : 0, pitch: Number.isFinite(start.p) ? start.p : 0, hash: false, minZoom: MIN_ZOOM + settings.detail, maxZoom: MAX_ZOOM + settings.detail,
        maxPitch: TERRAIN_3D_MAX_PITCH, maxTileCacheSize: HIGH_PITCH_TILE_CACHE_LIMIT,
        renderWorldCopies: true, attributionControl: false,
      });
    } catch (error) {
      if (!stagedFlatEntry) throw error;
      container.remove();
      const failure = error?.message;
      let detail;
      try { detail = JSON.parse(failure); } catch {}
      if (failure !== 'Failed to initialize WebGL' && detail?.message !== 'Failed to initialize WebGL') throw error;
      $('maplibre-css')?.removeAttribute('href');
      webglStartupFailure = 'the WebGL map could not start';
      useFlat = true;
    }
  }
  if (useFlat) {
    applyInitialVisibility(style,true);
    const {mountFlatMap,connectFlatLocation,appendFlatCredits,canvasMapStatus}=await import(`./vendor/flat-browser.js?v=${assetVersion}`);
    const requestedView={
      center:linked?linkedView.center:validCenter?start.c:[15,23],
      zoom:startZoom,
      bearing:linked?linkedView.bearing:Number.isFinite(start.b)?start.b:0,
    };
    const compass=textNode('button','','atlas-flat-compass');
    compass.type='button';
    compass.title='Reset map to north';
    compass.setAttribute('aria-label',compass.title);
    const needle=textNode('span','↑');
    needle.setAttribute('aria-hidden','true');
    compass.append(needle);
    let flatLocation, refreshFlatPower;
    const creditsBox=textNode('details','','atlas-flat-credit-box');
    creditsBox.open=settings.attributionOpen;
    creditsBox.addEventListener('toggle',()=>{
      if(settings.attributionOpen===creditsBox.open)return;
      settings.attributionOpen=creditsBox.open;
      saveSettings();
    });
    const creditSummary=textNode('summary','Map credits');
    flatCredits=textNode('div','','atlas-flat-credit-content');
    creditsBox.append(creditSummary,flatCredits);
    const buildCredit=codeAttribution();
    let creditSignature;
    const requestedMongolian=new Set();
    const getMongolianFont=(text,size)=>{
      const blocks=mongolianBlocks(text);
      const keys=[...blocks].map(block=>({family:'mongolian',weight:400,block}));
      const missing=keys.filter(key=>!worldFonts.isLoaded(key));
      const request=missing.filter(key=>!requestedMongolian.has(key.block));
      if(request.length){
        for(const key of request)requestedMongolian.add(key.block);
        void worldFonts.ensure(new Set(request)).then(()=>refreshFlatLabels?.());
      }
      return missing.length?null:`${size}px "Atlas Mongolian"`;
    };
    const flat=mountFlatMap({
      mount:$('map'),style,styleURL,protocols:tileProtocols,requestedView,
      curatedStationData:majorStationData,getMongolianFont,
      readDem:({z,x,y},controller)=>dem.getDemTile(z,x,y,controller),
      pointSources:{electricSignals:13},
      shapeSources:['electricFacilities','electricMethods','platformLengths','platformNumbers'],
      onPlatformFrame:()=>platformLengths?.update(),
      railTrackLayer:zoom=>`${settings.mode}-${zoom<7?'overview':'tracks'}`,
      interactiveLayer:isClickable,
      legendLayers:()=>settings.mode==='service'?new Set(['service-routes']):
        IN_VIEW[settings.mode]?new Set(inViewLegendLayers(settings.mode)):undefined,
      onLegendFrame(features) {
        const service=settings.mode==='service';
        flatLegendFeatures=service?[]:features;
        flatServiceFeatures=service?features:[];
        scheduleLegend();
        // Applying a style renders immediately. Schedule timer reconciliation
        // after that frame rather than reentering it from the expiry callback.
        if(!flatExpiryQueued&&(service||currentFeature?.layer?.id==='service-routes')){
          flatExpiryQueued=true;
          queueMicrotask(()=>{flatExpiryQueued=false;frequencyExpiry?.update();});
        }
      },
      imageryCredit(url,tile){
        if(!url.startsWith('atlasimagery://'))return;
        const provider=imageryProtocol.providerFor(tile);
        return provider==='EOX'?eoxAttribution:PROVIDER_ATTRIBUTION[provider];
      },
      onCredits(inUse) {
        const credits=[...new Set(inUse.filter(Boolean))].sort();
        const signature=JSON.stringify(credits);
        if(signature===creditSignature)return;
        creditSignature=signature;
        appendFlatCredits(flatCredits,[...credits,buildCredit],location.href);
        creditSummary.textContent=flatCredits.querySelector('a[href="https://www.openstreetmap.org/copyright"]')
          ? '© OpenStreetMap · Map credits' : 'Map credits';
      },
      onCamera({bearing}) {
        needle.style.transform=`rotate(${-bearing}deg)`;
        updateFlatScale();
        refreshFlatPower?.();
      },
      onReadout(position,zoom) {flatReadout=[position,zoom];updateReadout();},
      onDrawingProfile:line=>{if(settings.ui!=='watch')void showProfile(line);},
      onInspect(hits,[lng,lat]) {
        if (settings.ui==='watch') return;
        const feature=hits.sort((a,b)=>featurePickRank(a)-featurePickRank(b)||
          stationRank(a.properties)-stationRank(b.properties)||a.distance-b.distance)[0];
        if (!feature) return;
        feature.properties=feature.properties.atlas_han?feature.properties:{...feature.properties,...locate(lng,lat)};
        feature.clickLngLat={lng,lat};
        showDetails(feature);
      },
      onNavigate(view,reason) {
        flatCurrentView=view;
        if(reason!=='location' && reason!=='rotation') flatLocation?.pause();
        scheduleNearbyTransport();
        linkedViewHash='';
        // Location following changes the live view but does not write position history.
        if(reason!=='location') try {localStorage.setItem(VIEW_STORE,JSON.stringify(view));} catch {}
        if (parseViewHash(location.hash)) {
          const url=new URL(location.href);url.hash='';
          history.replaceState(history.state,'',url);
        }
      },
      onStatus({errors,loading,clamped,railFallback}) {
        scheduleNearbyTransport();
        status.classList.toggle('error',errors.length>0);
        const state=canvasMapStatus({errors,loading,clamped,railFallback});
        status.textContent=webglStartupFailure
          ? 'Canvas preview: '+webglStartupFailure+'; '+state : 'Canvas preview: '+state;
      },
    });
    refreshFlatLabels=flat.invalidateLabels;
    platformLengths=createPlatformLengths({
      ...flat.platformProjection,getZoom:flat.getZoom,getSource:flat.getSource,
      getLayer:flat.getPlatformLayer,
      queryRenderedFeatures:({layers})=>flat.platformCandidates(layers),
    },{
      active:()=>settings.mode==='infrastructure'&&settings.labels&&settings.background!=='satellite',
      edgeGeometry:edgeGeometryFor(()=>flat.getTileTemplate('platformEdges')),
      geometry:platformGeometryFor(()=>flat.getTileTemplate('platforms'),'standard_railway_platforms'),
      onPlatform:id=>{
        if(['platforms','platformNumbers'].includes(currentFeature?.source)&&String(currentFeature.properties.id)===id)showDetails(currentFeature);
      },
      onLength:(id,length)=>{
        if(length>0&&['platformEdges','platformLengths'].includes(currentFeature?.source)&&
          String(osmObject(currentFeature)?.id)===id)showDetails(currentFeature);
      },
    });
    addEventListener('pagehide',event=>{if(!event.persisted)platformLengths.destroy();});
    const flatPowerLoaders=makePowerLoaders(flat,zoom=>settings.mode==='electrification'&&
      settings.background!=='satellite'&&flat.getZoom()>=zoom,{
      reportError(id){flat.getSource(id)?.setError();},
    });
    refreshFlatPower=()=>{for(const refresh of flatPowerLoaders)void refresh();};
    flatNavigation=flat.moveTo;
    flatSourceContext=flat;
    const corner = textNode('div', '', 'atlas-flat-map-tools');
    readout.classList.add('atlas-flat-readout');
    flatScale = textNode('div', '', 'atlas-flat-scale');
    const scaleLabel = textNode('span', 'Map scale', 'sr-only');
    scaleLabel.id = 'flat-scale-label';
    flatScale.setAttribute('role', 'group');
    flatScale.setAttribute('aria-labelledby', scaleLabel.id);
    corner.append(scaleLabel, flatScale, readout);
    $('map').append(corner,creditsBox);
    updateReadout();
    updateFlatScale();
    controlLayout = installControlLayout({frame: $('map-frame'), mapElement: $('map'), corner,
      panel: document.querySelector('.panel'), status, readout, details: $('details')});
    measuring=new Measure(flat.measurementMap,{
      units:()=>settings.units,
      status:text=>{$('measure-status').textContent=text;},
      changed:updateDrawing,
      geometryChanged:()=>{if(profileFromMeasure)closeDetails();},
      heights:(points,options)=>surfaceElevation.heights(points,options),
    });
    drawing=new Drawing(flat.drawingMap,{
      units:()=>settings.units,
      status:text=>{$('draw-status').textContent=text;},
      changed:updateDrawing,
    });
    drawing.install();
    flat.connectDrawing(drawing);
    flat.connectMeasure(measuring);
    const toolButtons=document.createElement('div');
    toolButtons.className='atlas-flat-tool-buttons';
    drawButton.setAttribute('aria-label','Drawing tools');
    compass.addEventListener('click',flat.resetNorth);
    toolButtons.append(drawButton,measureButton,compass);
    for (const [symbol,label,delta] of [['+','Zoom in',1],['−','Zoom out',-1]]) {
      const button=textNode('button',symbol,'atlas-flat-zoom-button');
      button.type='button';
      button.title=label;
      button.setAttribute('aria-label',label);
      button.addEventListener('click',()=>flat.zoomBy(delta));
      toolButtons.append(button);
    }
    const locateButton=textNode('button','⌾','atlas-flat-location');
    locateButton.type='button';
    locateButton.setAttribute('aria-label','My location');
    const locationStatus=textNode('div','','atlas-flat-location-status');
    locationStatus.setAttribute('role','status');
    flatLocation=connectFlatLocation({
      button:locateButton,status:locationStatus,window,geolocation:navigator.geolocation,
      showFix:flat.showLocation,followFix:flat.followLocation,
    });
    toolButtons.append(locateButton,locationStatus);
    $('map').append(toolButtons);
    restoreRendererWork(flat.inspectionAt);
    const action=pendingDraw;pendingDraw=undefined;action?.();
    updateDrawing();
    let applied=JSON.stringify(settings);
    flatRefreshStyle=(force=false)=>{
      const signature=JSON.stringify(settings);
      if(!force&&applied===signature)return;
      const next=structuredClone(flatTemplate);
      localizeStyle(next);
      next.sources.relief.tiles=[dem.sharedDemProtocolUrl];
      applyInitialVisibility(next,true);
      for(const layer of next.layers){
        const paint=stationViewPaint(layer,settings.mode,flat.getZoom());
        if(paint)Object.assign(layer.paint,paint);
      }
      flat.setStyle(next);
      if(force)return; // Timer refresh does not change interactive tools or other datasets.
      refreshFlatPower();
      drawing.refresh();
      if(measuring?.active)measuring.refresh();
      applied=signature;
      frequencyExpiry?.update();
    };
    if(pendingFlatNavigation) {flatNavigation(pendingFlatNavigation);pendingFlatNavigation=null;}
    frequencyExpiry?.update();
    refreshFlatPower();
    return;
  }
  installImageryAttribution(map,imageryProtocol,{eoxAttribution,polarImagery:()=>
    ['satellite','hybrid'].includes(settings.background) && Boolean(polarLayer &&
      ['north','south'].some(cap=>polarLayer.visible()[cap] && polarLayer.caps[cap]?.satellite && !polarLayer.caps[cap]?.satelliteFailed))});
  bindTerrainViewport(map, dem);
  installHiddenTileMaskGuard(map);
  map.on('zoom',()=>{
    if(!ready)return;
    for(const layer of map.getStyle().layers){
      const paint=stationViewPaint(layer,settings.mode,map.getZoom());
      if(paint)for(const key of ['circle-radius','circle-stroke-width'])map.setPaintProperty(layer.id,key,paint[key]);
    }
  });
  // MapLibre replaces the painter when WebGL recovers. Its public event is
  // synchronous and precedes the next scheduled frame on the new painter.
  map.on('webglcontextrestored', () => installHiddenTileMaskGuard(map));
  // Tilt may change via touch, compass, keyboard or a linked view.
  // High-pitch tile detail is bounded separately from the camera angle.
  // A style replacement recreates source objects, so reapply per style load.
  map.on('style.load', () => syncHighPitchTileBudget(map));
  map.on('pitch', () => {
    syncHighPitchTileBudget(map);
    const tilted = terrain3DSelectedForPitch(map.getPitch());
    if (restoringTerrainView) {
      // Applying a saved/shared camera must not override its explicit mode.
    } else if (terrain3DExitPending) {
      if (!tilted) terrain3DExitPending = false;
    } else if (tilted) terrain3DSelected = true;
    syncTerrain3D(map, settings.relief, settings.terrainExaggeration, terrain3DSelected);
    updateTerrainButton();
  });
  // Reset the temporary suppression even if the 2D transition is interrupted
  // before reaching 0°; a later intentional tilt may enter 3D as normal.
  map.on('moveend', () => { terrain3DExitPending = false; });
  [powerFacilities,powerMethods,electricitySignals]=makePowerLoaders(map,zoom=>ready&&
    settings.mode==='electrification'&&settings.background!=='satellite'&&map.getZoom()>=zoom,{
    glyphs:async data=>{const found=new Set();for(const f of data.features)rareHanBlocks(f.properties.atlas_name,found);if(found.size)await rareHanFonts.ensure(found);},
  });
  updateAttribution();
  // The globe may be centred beyond 85° (globe-drag.mjs); a view left or
  // linked there is applied again once that is allowed. So is any view
  // opening on the globe: MapLibre limits the opening view as on the flat
  // map, where at low zoom the centre stays far from the poles (84° N at
  // zoom 3 opened at 80° N on a phone).
  polarCentres = allowPolarCentres(map, maplibregl.LngLat, () => MIN_ZOOM + settings.detail);
  const wanted = linked ? linkedView : validCenter ? {center: start.c, zoom: start.z} : null;
  if (wanted && (linked || startGlobe || Math.abs(wanted.center[1]) > 85) && wanted.center.every(Number.isFinite)) {
    // Again once the style has put the map on the globe.
    const restoreCamera = view => {
      restoringTerrainView = true;
      try { map.jumpTo(view); } finally { restoringTerrainView = false; }
    };
    restoreCamera(wanted); map.once('style.load', () => restoreCamera(parseViewHash(captureViewHash()) || wanted));
  }
  // Ordinary navigation updates the persisted local view through updatePolar.
  // Only explicitly navigating to a link fragment changes the browser URL.
  addEventListener('hashchange', () => {
    const view = parseViewHash(location.hash);
    if (!view) return;
    // A centre beyond 85.05° exists only on the globe.
    if (Math.abs(view.center[1]) > 85.051129 && !onGlobe()) map.setProjection({type: 'globe'});
    map.jumpTo(view); updatePolar();
  });
  map.on('styleimagemissing', event => {
    if (event.id.startsWith('context-')) {
      const icon = contextIcon(event.id,document);
      if (icon) map.addImage(event.id,icon,{pixelRatio:2});
      return;
    }
    if (TRACK_BADGES[event.id]) {
      // Track-count badge: a rounded box with an edge, stretched around its
      // number.
      const {edge: edgeColor, fill: fillColor} = TRACK_BADGES[event.id], rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
      const [e, f] = [rgb(edgeColor), rgb(fillColor)];
      const size = 24, radius = 7, edge = 2, data = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const qx = Math.max(radius - x - 0.5, x + 0.5 - (size - radius), 0), qy = Math.max(radius - y - 0.5, y + 0.5 - (size - radius), 0);
        const d = radius - Math.hypot(qx, qy); // distance inside the outline
        const alpha = Math.max(0, Math.min(1, d)), fill = Math.max(0, Math.min(1, d - edge));
        const c = e.map((v, i) => v + (f[i] - v) * fill);
        data.set([...c.map(Math.round), Math.round(alpha * 255)], (y * size + x) * 4);
      }
      map.addImage(event.id, {width: size, height: size, data}, {pixelRatio: 2, stretchX: [[8, 16]], stretchY: [[8, 16]], content: [6, 5, 18, 19]});
      return;
    }
    if (event.id === 'conveying-arrow') {
      // Travel-direction chevron pointing along the line (+x): a distance
      // field, so the style colours it and gives it a halo.
      const size = 32, stroke = 2.2, data = new Uint8Array(size * size * 4);
      const segment = (px, py, [ax, ay], [bx, by]) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const px = x + 0.5, py = y + 0.5, d = Math.min(segment(px, py, [11, 8], [21, 16]), segment(px, py, [21, 16], [11, 24])) - stroke;
        data[(y * size + x) * 4 + 3] = Math.max(0, Math.min(255, Math.round(191 - d * 32)));
      }
      map.addImage(event.id, {width: size, height: size, data}, {pixelRatio: 2, sdf: true});
      return;
    }
    if (event.id === 'crossing-x') {
      // Level-crossing ×: a distance field (edge at 0.75, 8 pixels of
      // falloff), so the style colours it by kind and gives it a halo.
      const size = 32, half = 8, stroke = 2, data = new Uint8Array(size * size * 4);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const px = Math.abs(x + 0.5 - size / 2), py = Math.abs(y + 0.5 - size / 2);
        // Distance to the diagonal from the centre to (half, half).
        const t = Math.min(half, (px + py) / 2), d = Math.hypot(px - t, py - t) - stroke;
        data[(y * size + x) * 4 + 3] = Math.max(0, Math.min(255, Math.round(191 - d * 32)));
      }
      map.addImage(event.id, {width: size, height: size, data}, {pixelRatio: 2, sdf: true});
      return;
    }
    if (event.id !== 'station-dot') return;
    const width = 32, data = new Uint8Array(width * width * 4);
    for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
      const r = Math.hypot(x + 0.5 - width / 2, y + 0.5 - width / 2);
      const offset = (y * width + x) * 4;
      const color = r < 8.5 ? [255,163,35] : [18,62,82];
      data.set([...color, Math.round(Math.max(0, Math.min(1, 12 - r)) * 255)], offset);
    }
    map.addImage('station-dot', {width,height:width,data}, {pixelRatio:2});
  });
  // Compass above the zoom buttons: shows the heading; click to face north.
  map.addControl(new maplibregl.NavigationControl({ showZoom: false, showCompass: true, visualizePitch: true }), 'top-right');
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  // Your position: the first press shows it and follows it as it moves
  // (with the direction of travel where the device reports one); moving the
  // map stops following, and a press resumes it.
  map.addControl(new maplibregl.GeolocateControl({positionOptions: {enableHighAccuracy: true}, trackUserLocation: true, showUserHeading: true, fitBoundsOptions: {maxZoom: 15 + settings.detail}}), 'top-right');
  map.addControl(new ButtonControl([detailButton, drawButton, measureButton, terrainButton, polarButton]), 'top-right');
  // Controls in the bottom corners stack upwards: added first, it sits below the scale bar.
  map.addControl({onAdd: () => readout, onRemove: () => readout.remove()}, 'bottom-left');
  map.on('mousemove', event => { readoutPoint = event.point; updateReadout(); });
  map.getCanvasContainer().addEventListener('mouseleave', () => { readoutPoint = null; updateReadout(); });
  map.on('move', updateReadout); updateReadout();
  scale = new maplibregl.ScaleControl({ unit: settings.units });
  map.addControl(scale, 'bottom-left');
  map.on('move', fitScale); fitScale();
  controlLayout = installControlLayout({frame: $('map-frame'), mapElement: $('map'),
    panel: document.querySelector('.panel'), status: document.querySelector('.map-status'), readout, details: $('details')});
  map.on('remove', () => {controlLayout.destroy(); attributionStateCleanup?.();});
  installKeyboardPan(map, {reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches, pan: (dx, dy, eventData) => globePan(dx, dy, eventData)});
  drawing = new Drawing(map, {units: () => settings.units, status: text => { $('draw-status').textContent = text; }, changed: updateDrawing});
  measuring = new Measure(map, {units: () => settings.units,
    status: text => { $('measure-status').textContent = text; },
    changed: updateDrawing, geometryChanged: () => { if (profileFromMeasure) closeDetails(); },
    heights: (points, options) => surfaceElevation.heights(points, options)});
  map.on('style.load', installDrawing);
  // Do not install or request the optional point tiles until the complete
  // release manifest and bundle index are verified against each other. A
  // partial/unpublished OSM crawl leaves the existing dot layers untouched.
  stationWorldLifecycle=installWorldStationLifecycle({map,maplibregl:tileProtocols,
    root:new URL('./data/station-points/',import.meta.url),fetcher:fetch,
    onChange:(active,styleReady)=>{
      stationWorldActive=active;
      // This source is installed asynchronously after style.load. MapLibre
      // does not apply its previous all-source LOD parameters retroactively.
      if(active&&styleReady)syncHighPitchTileBudget(map,WORLD_STATION_SOURCE);
      if(ready&&styleReady)applySettings();
    },
  });
  map.on('dblclick', event => {
    if (measuring.mode === 'distance') { event.preventDefault(); measuring.end(); }
    else if (drawing.multiPoint && !drawing.paused) { event.preventDefault(); drawing.finish(); }
  });
  restoreRendererWork(at=>{
    if(!ready||!clickable.length)return [];
    const p=map.project(at), canvas=map.getCanvas();
    if(p.x<0||p.x>canvas.clientWidth||p.y<0||p.y>canvas.clientHeight)return [];
    return map.queryRenderedFeatures([[p.x-7,p.y-7],[p.x+7,p.y+7]],{layers:clickable});
  });
  const action = pendingDraw; pendingDraw = undefined; action?.();
  let recoveryRemoved = false, recoveryStatusPending = false;
  stationFailures = createStationFallbackState(map);
  railReferenceFailures = createRailReferenceState(map,settings,{sourcePaused:source=>Boolean(source.url && labelProtocols.originPaused(unwrap(source.url)))});
  railRecovery = createRailProviderRecovery(map, {provider: ORM, onChange: () => {
    // Timer-driven retirement also changes status. Defer/coalesce notifications
    // so source handlers finish their error bookkeeping before reconciliation.
    if (recoveryRemoved || recoveryStatusPending) return;
    recoveryStatusPending = true;
    queueMicrotask(() => { recoveryStatusPending = false; if (!recoveryRemoved) updateStatus(); });
  }});
  wakeRailRecovery = () => { if (!recoveryRemoved) { railRecovery.wake(); updateStatus(); } };
  // Keep the pre-existing finite retry for non-rail metadata providers; only
  // OpenRailwayMap uses demand-driven failed-tile retries with prolonged backoff.
  const otherMetadataRetries = labelCode.createMetadataRetries(map, {provider: ORM});
  document.addEventListener('visibilitychange', wakeRailRecovery);
  window.addEventListener('online', wakeRailRecovery);
  map.on('moveend', wakeRailRecovery);
  map.on('remove', () => {requestRefresh.dispose();recoveryRemoved=true;document.removeEventListener('visibilitychange',wakeRailRecovery);window.removeEventListener('online',wakeRailRecovery);railRecovery.dispose();otherMetadataRetries.dispose();labelProtocols.dispose?.();});
  map.on('error', e => {
    // Any failed complete-snapshot tile returns to the original station dots,
    // rather than making its geographic region blank or misreporting coverage.
    if(e.sourceId===WORLD_STATION_SOURCE) {
      // A cancelled offscreen or superseded tile is not a station data failure.
      if(e.error?.name==='AbortError' || /aborterror|operation was aborted/i.test(e.error?.message || '')) return;
      stationWorldLifecycle.disable();
      console.warn('Worldwide station-point source unavailable; previous sources restored:',e.error?.message);
      return;
    }
    // Panning and replacing language sources intentionally cancel old tiles.
    if (e.error?.name === 'AbortError' || /^AbortError$|operation was aborted/i.test(e.error?.message || '')) {
      otherMetadataRetries.noteError(e); return;
    }
    // Log text as well as the object: errors passed back from map workers
    // carry no stack, and plain logs of them show only "Error".
    console.error('Map resource error:', e.sourceId || 'map', e.error?.message || String(e.error), e.error);
    railReferenceFailures.noteError(e);
    const railError = railRecovery.noteError(e);
    const stationError = stationFailures.noteError(e);
    const id = e.sourceId || 'resource', instance = e.sourceId && map.getSource(e.sourceId), previous = errors.get(id);
    const savedFailures = sourceFailureStates.get(id);
    const failures = e.sourceId && (savedFailures?.current() ? savedFailures : createSourceFailures(map, id));
    if (failures) sourceFailureStates.set(id, failures);
    if (failures && !railError && !stationError) failures.noteError(e);
    // A retryable error cannot take ownership of a nonretryable error on the
    // same source instance; pruning must not erase that independent failure.
    errors.set(id, {source:instance, failures,
      stationOwned:stationError && (!previous || previous.source !== instance || previous.stationOwned),
      recoveryOwned:railError && (!previous || previous.source !== instance || previous.recoveryOwned)});
    updateStatus();
    // Rail and basemap protocols own their recovery budgets. Other metadata
    // gets at most three source reloads, only for transient failures.
    otherMetadataRetries.noteError(e);
  });
  map.on('sourcedata', e => {
    // A provider/source can be added after style.load (or replaced under the
    // same ID). Apply the near-horizon LOD to its new instance once; routine
    // tile content notifications do not reset LOD or change the camera.
    if(e.sourceId && ['metadata','content'].includes(e.sourceDataType))
      syncHighPitchTileBudget(map,e.sourceId);
    if (e.sourceId && e.sourceDataType === 'metadata') otherMetadataRetries.clear(e.sourceId);
    const recovered = railRecovery.noteSourceData(e);
    const stationChanged = stationFailures.noteSourceData(e);
    const referenceChanged = railReferenceFailures.noteSourceData(e);
    // MapLibre also reports isSourceLoaded after errors settle. Require actual
    // success, and keep a source's error until all its failed tiles recover.
    const successful = e.sourceDataType === 'metadata' || e.tile?.state === 'loaded';
    let cleared = false;
    const failures = sourceFailureStates.get(e.sourceId);
    failures?.noteSourceData(e);
    if (e.sourceId && (recovered || successful) && !failures?.hasFailures() &&
      !railRecovery.failedSourceIds().includes(e.sourceId) && !stationFailures.hasSourceFailure(e.sourceId)) {
      cleared = errors.delete(e.sourceId);
      otherMetadataRetries.clear(e.sourceId);
    }
    // Refresh after BOTH recovery state and app bookkeeping change. A callback
    // inside noteSourceData would observe stale errors; idle may never arrive.
    if (recovered || cleared || stationChanged || referenceChanged || failures) updateStatus();
  });
  // Native tile removal can report abort instead of successful source data.
  // Reconcile presentation only; an abort is not provider recovery evidence.
  map.on('sourcedataabort', e => {
    const referenceChanged = railReferenceFailures.noteSourceData(e);
    if (stationFailures.noteSourceData(e) || referenceChanged || sourceFailureStates.has(e.sourceId)) updateStatus();
  });
  // Apply settings as soon as the style is in place, not at MapLibre's
  // 'load', which waits for every initial tile: zoomed out that is dozens of
  // large overview tiles, and a source whose metadata request fails never
  // loads at all, which left view changes unapplied.
  const styleReady = () => {
    ready = true;
    // Settings changed while the map was loading take effect now.
    if (styleLanguage !== settings.language||cjkFontRefresh) {cjkFontRefresh=false;reloadLanguage(); return; }
    installDrawing();
    // A remembered globe/flat choice holds until the automatic choice changes.
    if (typeof rememberedView.g === 'boolean') lastAutoProjection = wantedProjection();
    applySettings(); applyUnits(); updateStatus(); updatePolar();
    document.body.dataset.mapReady = 'true';
    const action = pendingView; pendingView = undefined; action?.();
  };
  if (map.isStyleLoaded?.()) styleReady(); else map.once('style.load', styleReady);
  // Cached tiles can re-enter the inventory after moveend without a source
  // event. Recheck retry demand once that render has settled, as well as status.
  map.on('idle', wakeRailRecovery);
  platformLengths=createPlatformLengths(map,{edgeGeometry:edgeGeometryFor(()=>map.getSource('platformEdges')?.tiles?.[0]),geometry:createPlatformTileGeometry({tileURL:()=>{const url=map.getSource('platforms')?.tiles?.[0];return url&&unwrap(url);},decode:async data=>(await labels).platformTilePieces(data,'standard_railway_platforms')}),active:()=>ready&&settings.mode==='infrastructure'&&settings.labels&&settings.background!=='satellite',onLength:(id,length)=>{if(length>0&&['platformEdges','platformLengths'].includes(currentFeature?.source)&&String(osmObject(currentFeature)?.id)===id)showDetails(currentFeature);},onPlatform:(id)=>{if(['platforms','platformNumbers'].includes(currentFeature?.source)&&String(currentFeature.properties.id)===id)showDetails(currentFeature);}});
  map.on('moveend',()=>platformLengths.update());
  map.on('remove',()=>platformLengths.destroy());
  let platformFramePending=false;
  map.on('sourcedata',e=>{
    if(!['platformEdges','platforms'].includes(e.sourceId)||!e.tile||platformFramePending)return;
    // A loaded tile is queryable after the next render, even if no other tile
    // arrives and the map remains stationary. Coalesce neighbouring tiles.
    platformFramePending=true;
    map.once('render',()=>{platformFramePending=false;platformLengths.update();});
  });
  map.on('moveend', scheduleLegend);
  map.on('moveend', () => {powerFacilities?.();powerMethods?.();electricitySignals?.();});
  map.on('moveend',updateMajorStations);
  // Curated names need the station source's tile address, known once its
  // TileJSON arrives (possibly after the first frame, with no move to follow).
  map.on('sourcedata',e=>{if(e.sourceId==='stations'&&e.sourceDataType==='metadata'&&!stationTileURL){updateMajorStations();renameOpenMajorStation();}});
  map.on('moveend', scheduleNearbyTransport);
  map.on('sourcedata', e => { if (e.sourceId === 'openmaptiles' && e.isSourceLoaded) scheduleNearbyTransport(); });
  map.on('moveend', updatePolar);
  // Drag the globe as a globe, over the poles (globe-drag.mjs); editable
  // points keep their own dragging.
  const globeDrag = installGlobeDrag(map, {active: onGlobe, ignore: point => {
    const layers = ['drawing-handle-targets', 'measure-point-targets'].filter(id => map.getLayer(id));
    return layers.length > 0 && map.queryRenderedFeatures([point.x, point.y], {layers}).length > 0;
  }});
  syncPanning = globeDrag.sync; globeDragged = globeDrag.justDragged; globePan = globeDrag.pan;
  syncPanning();
  map.on('sourcedata', e => { if (['electric', 'control', 'gaugeLow', 'loadingLow', 'ownerLow', 'ownerRail', 'axleLow', 'axleRail', 'axleBranch', 'railway', 'branchLines', 'serviceRoutes'].includes(e.sourceId) && e.tile) scheduleLegend();if(e.sourceId==='serviceRoutes')frequencyExpiry?.update(); });
  map.on('click', event => {
    if(settings.ui==='watch')return;
    // The release that ends a globe drag is not a click.
    if (globeDragged()) return;
    if (measuring.active) { measuring.click(event.lngLat, event.point); return; }
    if (drawing.active) { drawing.click(event.lngLat, event.point); return; }
    const p = event.point;
    // A drawn line: its elevation profile.
    const lines = ['drawing-line', 'drawing-line-dashed', 'drawing-line-dotted'].filter(id => map.getLayer(id));
    const drawn = lines.length && map.queryRenderedFeatures([[p.x - 5, p.y - 5], [p.x + 5, p.y + 5]], {layers: lines}).find(f => f.geometry.type === 'LineString');
    const line = drawn && drawing.features.find(f => f.id === drawn.properties.drawing);
    if (line) { showProfile(line); return; }
    const features = map.queryRenderedFeatures([[p.x - 7, p.y - 7], [p.x + 7, p.y + 7]], {layers: clickable})
      .sort((a,b) => featurePickRank(a)-featurePickRank(b) || stationRank(a.properties)-stationRank(b.properties));
    if (!features[0]) return;
    // Services sharing a track are drawn side by side a few pixels apart:
    // the one whose drawn line is nearest the click.
    if (features[0].layer.id === 'service-routes') features.unshift(nearestService(features.filter(f => f.layer.id === 'service-routes'), p));
    // Operating-line tiles are not relabelled; locate them by the click.
    const {properties} = features[0];
    features[0].properties = properties.atlas_han ? properties : {...properties, ...locate(event.lngLat.lng, event.lngLat.lat)};
    features[0].clickLngLat = event.lngLat;
    showDetails(features[0]);
    renameOpenMajorStation();
  });
  // A full feature query on every mouse move is slow in dense areas and made
  // mouse panning stall. Skip it while dragging or moving, query only the
  // clickable layers, and at most once per frame.
  map.on('mousemove', event => {
    cancelAnimationFrame(hoverFrame);
    if (measuring.active) { if (!event.originalEvent.buttons) measuring.move(event.lngLat); return; }
    if (drawing.active) { if (!event.originalEvent.buttons) drawing.move(event.lngLat); return; }
    if (!ready || event.originalEvent.buttons || map.isMoving()) return;
    hoverFrame = requestAnimationFrame(() => {
      const hit = clickable.length && map.queryRenderedFeatures(event.point, {layers: clickable}).length > 0;
      map.getCanvas().style.cursor = hit ? 'pointer' : '';
    });
  });
}

document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
  settings.mode = button.dataset.mode; applySettings(); saveSettings();
}));
function applyCoveredPeriods(){
  for(const option of $('frequency-period').options)option.hidden=option.disabled=!periodCovered(option.value);
  if(!periodCovered(settings.frequencyPeriod)){const fallback=['offpeak','peak'].find(periodCovered);if(fallback){settings.frequencyPeriod=fallback;applySettings();}}
}
fetch(new URL('./data/service-routes/frequency-manifest.json',import.meta.url)).then(r=>{if(!r.ok)throw new Error('Service metadata unavailable');return r.json();}).then(manifest=>{
  serviceDataStatus={state:'loaded',manifest};
  if(manifest?.schema===3&&Array.isArray(manifest.profiles)){coveredProfiles=new Set(manifest.profiles);applyCoveredPeriods();}
  renderLegend();
}).catch(()=>{serviceDataStatus={state:'failed'};renderLegend();});
for(const [id,key] of [['service-width','serviceWidth'],['frequency-period','frequencyPeriod'],['peak-phase','peakPhase'],['frequency-hour','frequencyHour']])$(id).addEventListener('change',()=>{settings[key]=key==='frequencyHour'?Number($(id).value):$(id).value;applySettings();saveSettings();if(currentFeature?.layer?.id==='service-routes')showServiceDetails(currentFeature);});
document.querySelectorAll('[data-background]').forEach(button => button.addEventListener('click', () => {
  settings.background = button.dataset.background; applySettings(); saveSettings();
}));
$('terrain-exaggeration').addEventListener('change', () => {
  // Numeric whitelist is shared with readSettings and the terrain runtime.
  // The choice never edits DEM samples or the elevation/profile measurements.
  const next = Number($('terrain-exaggeration').value);
  try { settings.terrainExaggeration = terrainExaggeration(next); }
  catch { $('terrain-exaggeration').value = String(settings.terrainExaggeration); return; }
  if (ready) syncTerrain3D(map, settings.relief, settings.terrainExaggeration, terrain3DSelected);
  updateTerrainButton();
  saveSettings();
});
for (const key of CHECKBOXES) $(key).addEventListener('change', () => {
  settings[key] = $(key).checked; applySettings(); saveSettings();
  if (key === 'autoGlobe') { lastAutoProjection = undefined; updatePolar(); }
});
function reloadLanguage() {
  const appliedLanguage=settings.language;
  const style=map.getStyle();localizeStyle(style);
  ready=false;errors.clear();sourceFailureStates.clear();
  status.classList.remove('error');status.textContent='Updating map labels…';
  // Replace the style atomically. Incremental setUrl calls can leave stale
  // symbol-placement buckets after a language switch followed by a long pan.
  // Camera and display options persist; protocol/HTTP caches reuse the data.
  map.once('style.load',()=>{
    ready=true;
    if(appliedLanguage!==settings.language||cjkFontRefresh) {cjkFontRefresh=false;reloadLanguage();return;}
    applySettings();applyUnits();updateStatus();
    document.body.dataset.mapReady = 'true';
    if(currentFeature) {showDetails(currentFeature);renameOpenMajorStation();}
    const action = pendingView; pendingView = undefined; action?.();
  });
  map.setStyle(style,{diff:false,localIdeographFontFamily:cjkFont(appliedLanguage)});
}
{
  const select = $('language');
  for (const [code,name] of LANGUAGES) {const option=textNode('option',name);option.value=code;select.append(option);}
  select.value=settings.language;
  select.addEventListener('change',()=>{
    settings.language=select.value;
    ensureCjkChoice(cjkScript(settings.language));
    updateDetailGlyphs();
    if(ready) reloadLanguage();
    else flatRefreshStyle?.();
    saveSettings();
  });
}
$('units').addEventListener('change', () => {
  settings.units = $('units').value === 'imperial' ? 'imperial' : 'metric';
  applyUnits(); flatRefreshStyle?.(); updateInView(); renderLegend(); saveSettings(); drawing?.refresh(); measuring?.refresh();
  if (profileFromMeasure) closeDetails();
  if (currentFeature) showDetails(currentFeature);
});
const compactControls = () => matchMedia('(max-width: 650px), (max-height: 500px)').matches;
// Called when an explicit menu action changes its geometry; ResizeObserver
// handles status wrapping, readout size, font changes and window resizing.
function updateMapControlClearance() { controlLayout?.update(); }
function setControlsExpanded(expanded, focus = false) {
  $('controls').hidden = !expanded;
  document.querySelector('.panel').classList.toggle('collapsed', !expanded);
  $('collapse').textContent = expanded ? '−' : '+';
  $('collapse').setAttribute('aria-expanded', String(expanded));
  $('collapse').setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} map controls`);
  $('controls-open').setAttribute('aria-expanded', String(expanded));
  $('controls-open').setAttribute('aria-label', expanded ? 'Collapse map controls' : 'Open map controls');
  updateMapControlClearance();
  if (focus) (expanded || !compactControls() ? $('collapse') : $('controls-open')).focus();
}
$('collapse').addEventListener('click', () => setControlsExpanded($('controls').hidden, true));
$('controls-open').addEventListener('click', () => setControlsExpanded($('controls').hidden, true));
document.querySelector('.panel').addEventListener('keydown', event => {
  if (event.key === 'Escape' && compactControls() && !$('controls').hidden) {
    event.stopPropagation(); setControlsExpanded(false, true);
  }
});
// On phones and other small screens start with the controls folded away, so
// the map is visible at launch.
if (compactControls()) setControlsExpanded(false);
// Elevation profile of a drawn line: heights about every 10 m along it
// (20 to 200 samples), from the terrain tiles. Hovering the chart marks the
// place on the map.
const elevation = createElevation(DEM_URL);
let surfaceElevation = elevation;
let profileMarker, profileController, profileRequest = 0, profileFromMeasure = false;
function cancelProfile() {
  flatSourceContext?.setProfileMarker?.(null);
  profileFromMeasure = false;
  profileRequest++; profileController?.abort(); profileController = null; profileMarker?.remove();
}
async function showProfile(feature, {measured = false} = {}) {
  cancelProfile();
  profileFromMeasure = measured;
  const controller = profileController = new AbortController();
  const coordinates = feature.geometry.coordinates, units = settings.units, km = lengthKm(coordinates);
  const panel = $('detail-content'), request = ++profileRequest;
  const waiting = textNode('p', 'Finding heights…', 'small');
  panel.replaceChildren(textNode('div', measured ? 'MEASUREMENT' : 'DRAWN LINE', 'eyebrow'), textNode('h2', feature.properties.name || 'Elevation profile'), waiting);
  $('details').hidden = false; currentFeature = null;
  const samples = alongLine(coordinates, Math.max(20, Math.min(200, Math.round(km * 100))), lengthKm);
  let heights;
  try { heights = await surfaceElevation.heights(samples.map(s => s.point), {signal: controller.signal}); }
  catch (error) { if (controller.signal.aborted) return; throw error; }
  finally { if (profileController === controller) profileController = null; }
  // Only if this profile is still what the panel shows: not replaced by
  // another feature's details, another profile or closed meanwhile.
  if (request !== profileRequest || !waiting.isConnected || $('details').hidden) return;
  const profile = samples.map((s, i) => ({...s, height: heights[i]})), stats = profileStats(profile);
  waiting.remove();
  if (!stats) { panel.append(textNode('p', 'The terrain tiles could not load here.', 'small')); return; }
  const height = h => units === 'imperial' ? `${Math.round(h * 3.28084).toLocaleString('en')} ft` : `${Math.round(h).toLocaleString('en')} m`;
  const ends = climb(profile[0].height, profile.at(-1).height, km);
  const incomplete = profile.some(p => !Number.isFinite(p.height));
  if (incomplete) panel.append(textNode('p', 'Incomplete elevation profile: some terrain heights are unavailable. Gaps are left blank; statistics cover only the available samples and connected stretches.', 'small'));
  const dl = document.createElement('dl');
  row(dl, 'Length', formatLength(km, units)); row(dl, 'Lowest', height(stats.min)); row(dl, 'Highest', height(stats.max));
  row(dl, incomplete ? 'Ascent / descent (known stretches)' : 'Ascent / descent', stats.ascent === null ? 'Unavailable' : `${height(stats.ascent)} / ${height(stats.descent)}`);
  if (ends) row(dl, 'End to end', formatClimb(ends, units));
  row(dl, incomplete ? 'Steepest (known stretches)' : 'Steepest', stats.steepest === null ? 'Unavailable: no continuous height samples over the required distance' : `${(stats.steepest * 100).toFixed(1)}% (${(stats.steepest * 1000).toFixed(0)}‰) over ${formatLength(stats.over, units)}`);
  panel.append(profileChart(profile, km, units), dl, textNode('p', 'Ground and seabed elevations from repaired terrain data. Ocean depths use coarser bathymetry and a coastline mask, while overlapping or unavailable data leave gaps. These are not rail-track heights on bridges or in tunnels; ascent and descent include terrain noise.', 'small'));
}
function profileChart(profile, km, units) {
  const W = 280, H = 150, L = 44, R = 8, T = 10, B = 24, ns = 'http://www.w3.org/2000/svg';
  const k = units === 'imperial' ? 3.28084 : 1, unit = units === 'imperial' ? 'ft' : 'm';
  const segments = profileSegments(profile), known = segments.flat(), values = known.map(p => p.height * k);
  let lo = Math.min(...values), hi = Math.max(...values);
  if (hi - lo < 10) { const mid = (hi + lo) / 2; lo = mid - 5; hi = mid + 5; }
  const x = at => L + (W - L - R) * (km > 0 ? at / km : 0), y = h => T + (H - T - B) * (1 - (h * k - lo) / (hi - lo));
  const el = (name, attrs, text) => { const e = document.createElementNS(ns, name); for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v); if (text !== undefined) e.textContent = text; return e; };
  const svg = el('svg', {viewBox: `0 0 ${W} ${H}`, class: 'profile-chart', role: 'img', 'aria-label': 'Elevation along the line'});
  for (const segment of segments) {
    const line = segment.map(p => `${x(p.at).toFixed(1)},${y(p.height).toFixed(1)}`).join(' ');
    if (segment.length === 1) {
      svg.append(el('circle', {cx: x(segment[0].at), cy: y(segment[0].height), r: 1.5, class: 'profile-line'}));
    } else svg.append(
      el('polygon', {points: `${x(segment[0].at).toFixed(1)},${H - B} ${line} ${x(segment.at(-1).at).toFixed(1)},${H - B}`, class: 'profile-area'}),
      el('polyline', {points: line, class: 'profile-line'}));
  }
  svg.append(
    el('line', {x1: L, y1: H - B, x2: W - R, y2: H - B, class: 'profile-axis'}), el('line', {x1: L, y1: T, x2: L, y2: H - B, class: 'profile-axis'}),
    el('text', {x: L - 4, y: T + 4, 'text-anchor': 'end'}, `${Math.round(hi)} ${unit}`), el('text', {x: L - 4, y: H - B, 'text-anchor': 'end'}, `${Math.round(lo)} ${unit}`),
    el('text', {x: L, y: H - 8}, '0'), el('text', {x: W - R, y: H - 8, 'text-anchor': 'end'}, formatLength(km, units)));
  const cursor = el('line', {y1: T, y2: H - B, class: 'profile-cursor', visibility: 'hidden'}), readout = el('text', {x: L + 4, y: T + 10, class: 'profile-readout'});
  svg.append(cursor, readout);
  svg.addEventListener('pointermove', event => {
    const box = svg.getBoundingClientRect(), at = Math.max(0, Math.min(km, ((event.clientX - box.left) / box.width * W - L) / (W - L - R) * km));
    const p = profile.reduce((a, b) => Math.abs(b.at - at) < Math.abs(a.at - at) ? b : a);
    cursor.setAttribute('x1', x(p.at)); cursor.setAttribute('x2', x(p.at)); cursor.setAttribute('visibility', 'visible');
    readout.textContent = `${formatLength(p.at, units)} · ${Number.isFinite(p.height) ? `${Math.round(p.height * k)} ${unit}` : 'Height unavailable'}`;
    if(map){
      profileMarker ||= new maplibregl.Marker({element: textNode('div', '', 'profile-marker')});
      profileMarker.setLngLat(p.point).addTo(map);
    }else flatSourceContext?.setProfileMarker?.(p.point);
  });
  svg.addEventListener('pointerleave', () => { cursor.setAttribute('visibility', 'hidden'); readout.textContent = ''; profileMarker?.remove(); flatSourceContext?.setProfileMarker?.(null); });
  return svg;
}
function closeDetails() { cancelSelectionRestore?.(); cancelProfile(); $('details').hidden = true; currentFeature = null; platformLengths?.prioritizeEdge(null); profileMarker?.remove(); frequencyExpiry?.update(); }
$('details-close').addEventListener('click', closeDetails);
addEventListener('keydown', event => { if (event.key === 'Escape' && !$('details').hidden && !drawing?.active && !measuring?.active && !document.querySelector('dialog[open]')) closeDetails(); });
// The data dates are read each time Help opens, so a page left open shows
// current ages; a missing or unreadable file says so and nothing else fails.
let dataAgesRequest=0;
async function showDataAges() {
  const body = $('data-ages')?.tBodies[0], notice = $('data-ages-notice');
  if (!body || !notice) return;
  const request=++dataAgesRequest;
  try {
    const response = await fetch('data/data-ages.json', {cache: 'no-cache'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const ages = await response.json();
    if (request!==dataAgesRequest) return;
    const rows = dataAgeRows(ages);
    body.replaceChildren(...rows.map(row => {
      const tr = document.createElement('tr');
      tr.append(textNode('td', row.label), textNode('td', row.text, row.stale ? 'data-age-stale' : undefined));
      return tr;
    }));
    notice.textContent = staleNotice(rows, ages.staleAfterDays);
    notice.hidden = !notice.textContent;
  } catch {
    if (request!==dataAgesRequest) return;
    const tr = document.createElement('tr'), cell = textNode('td', 'Data dates are not available.');
    cell.colSpan = 2; tr.append(cell); body.replaceChildren(tr); notice.hidden = true;
  }
}
$('about-open').addEventListener('click', () => { $('about').showModal(); showDataAges(); });
$('about-close').addEventListener('click', () => $('about').close());
// Keep contents navigation inside the dialog without changing browser history.
$('about').querySelector('.help-contents')?.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  event.preventDefault();
  const section = document.getElementById(link.getAttribute('href').slice(1));
  section?.scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
  section?.focus({preventScroll: true});
});
// Copies text, or shows it selected for copying where the clipboard is
// unavailable.
async function copyText(text, done, label) {
  $('share-status').hidden = false;
  try { await navigator.clipboard.writeText(text); $('share-status').textContent = done; }
  catch { $('share-status').replaceChildren(textNode('span', `Copy this ${label}: `)); const input = document.createElement('input'); input.value = text; input.readOnly = true; input.setAttribute('aria-label', label); input.style.width = '100%'; $('share-status').append(input); input.select(); }
}
$('share').addEventListener('click', () => { saveSettings(); copyText(shareURL(), 'Map link copied, including position and display options.', 'map address'); });
// The map centre as latitude, longitude in decimal degrees (WGS 84), as GPS
// devices and map apps accept it.
// The new controls may be missing when the service worker falls back to an
// older saved page (offline, mid-update): their listeners are then skipped.
$('copy-coordinates')?.addEventListener('click', () => {
  if (!map) return;
  const {lat, lng} = map.getCenter().wrap();
  copyText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`, `Map centre copied: ${lat.toFixed(6)}, ${lng.toFixed(6)} (latitude, longitude).`, 'coordinates');
});
// Nominatim allows at most one request a second: searches submitted faster
// wait their turn, and a repeated search is answered from memory.
const placeCache = new Map();
let placeNext = 0;
async function placeSearch(url, json, signal) {
  const key = url.href;
  if (placeCache.has(key)) return placeCache.get(key);
  // The next second is taken only by a request about to be sent: a search
  // given up while it waits (a newer one replaces it) holds no place.
  while (Date.now() < placeNext) {
    await new Promise(resolve => setTimeout(resolve, placeNext - Date.now()));
    if (signal?.aborted) throw new Error('Search replaced');
  }
  if (signal?.aborted) throw new Error('Search replaced');
  placeNext = Date.now() + 1000;
  const items = await json(url);
  if (!items.invalid) placeCache.set(key, items);
  while (placeCache.size > 50) placeCache.delete(placeCache.keys().next().value);
  return items;
}
// Settings: a subpage of the panel, in place of the map controls.
const showSettings = open => {
  if (!$('main-view') || !$('settings-view')) return;
  $('main-view').hidden = open; $('settings-view').hidden = !open;
  $('settings-open').setAttribute('aria-expanded', String(open));
  (open ? $('settings-close') : $('settings-open')).focus();
};
$('admin-login')?.addEventListener('click', () => {
  const draw = Math.floor(window.Math.random() * 101);
  const unlocked = draw > 150;
  $('admin-providers').hidden = !unlocked;
  $('admin-notice').hidden = unlocked;
});
$('settings-open')?.addEventListener('click', () => showSettings(true));
$('settings-close')?.addEventListener('click', () => showSettings(false));
// Escape here only leaves the settings (an open detail panel stays).
$('settings-view')?.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); showSettings(false); } });
$('search-form').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('search-input').value.trim(); if (q.length < 2) return;
  searchController?.abort(); searchController = new AbortController();
  const controller = searchController;
  const timeout = setTimeout(() => controller.abort('timeout'), 8000);
  $('search-results').hidden = true;
  $('search-status').hidden = false; $('search-status').textContent = 'Searching railway facilities and places…';
  const json = async (url, signal = controller.signal) => {
    const response = await fetch(url, { signal });
    if (response.status === 429 && url.href.startsWith(SEARCH_API)) searchPausedUntil = Date.now() + 10 * 60_000;
    if (!response.ok) throw new Error(`Search returned ${response.status}`);
    const items = await response.json(); if (!Array.isArray(items)) throw new Error('Unexpected search response');
    return searchResponse(items, url.href.startsWith(SEARCH_API) ? 'facility' : 'place');
  };
  try {
    // Search must work while map labels are still downloading. The small
    // locate fallback is replaced when that bundle arrives.
    // The OpenRailwayMap API asks clients to stop after HTTP 429 and to give
    // up on requests after about 5 seconds; the geocoder is asked once per
    // submitted search (never as you type), within its usage policy.
    const facilityURL = new URL(SEARCH_API); facilityURL.searchParams.set('q', q); facilityURL.searchParams.set('limit', '8');
    const placeURL = new URL(PLACE_SEARCH_API);
    for (const [key, value] of Object.entries({q, format: 'jsonv2', limit: '10', namedetails: '1', extratags: '1'})) placeURL.searchParams.set(key, value);
    if (settings.language !== 'local') placeURL.searchParams.set('accept-language', settings.language);
    // The facility request is cancelled at its 5-second limit (and with the
    // whole search), not just left running.
    const facility = new AbortController();
    // (An abort that already fired is not
    // replayed to a new listener.)
    if (controller.signal.aborted) facility.abort();
    else controller.signal.addEventListener('abort', () => facility.abort(), {once: true});
    const facilityTimeout = setTimeout(() => facility.abort('timeout'), 5000);
    const [facilities, places] = await Promise.allSettled([
      Date.now() < searchPausedUntil ? Promise.reject(new Error('paused')) : json(facilityURL, facility.signal).finally(() => clearTimeout(facilityTimeout)),
      placeSearch(placeURL, json, controller.signal)]);
    if (controller !== searchController) return;
    // Stations the map has drawn whose name the search matches, for those
    // neither service finds (stations mapped as areas, partial names).
    // Below zoom 7 the curated principal stations are drawn too.
    // Only what the station layers draw at this zoom (no tram stops at zoom 8).
    const flat=useFlat?flatSourceContext:null;
    const zoom=flat?flat.getZoom():ready?map.getZoom():0;
    const drawn=flat
      ? drawnStationQueries(flat.getLayers(),zoom).flatMap(({source,sourceLayer,filter})=>
          sourceLayer?flat.readSourcePoints(source,[sourceLayer],filter).features:[])
      : ready ? drawnStationQueries(map.getStyle().layers, zoom).flatMap(({source, sourceLayer, filter}) =>
          source === 'stationMajor' ? (majorStationSearchData?.features || []).filter(f => (f.properties?.tier ?? 7) <= zoom)
            : map.getSource(source) ? map.querySourceFeatures(source,{sourceLayer,filter}) : []) : [];
    const local = flat||ready
      ? tileStations(drawn,q,flat?flat.getCenter():map.getCenter().toArray(),facilities.value?.items||[]) : [];
    if (facilities.status === 'rejected' && places.status === 'rejected' && !local.length) throw facilities.reason;
    const {rail, places: other} = searchResults([...(facilities.value?.items || []), ...local], places.value?.items || []);
    const results = $('search-results'); results.replaceChildren();
    const narrow = () => { results.hidden = true; $('search-status').hidden = true; if (matchMedia('(max-width: 650px)').matches && !$('controls').hidden) $('collapse').click(); };
    const entry = (title, detail, onClick) => {
      const li = document.createElement('li'); const button = document.createElement('button'); button.type = 'button';
      button.append(nameNode('span', title), nameNode('small', detail));
      button.addEventListener('click', () => { onClick(); narrow(); });
      li.append(button); results.append(li);
    };
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    const navigate=(center,zoom,bounds)=>{
      if(useFlat) {
        const next={center,zoom,bounds};
        if(flatNavigation) flatNavigation(next);
        else pendingFlatNavigation=next; // only the newest selection is relevant
        return;
      }
      whenReady(()=>{
        const duration=reduced()?0:1000;
        if(bounds) map.fitBounds(bounds,{maxZoom:15,padding:40,duration});
        else map.flyTo({center,zoom,duration});
      });
    };
    for (const item of rail) {
      try { Object.assign(item, locate(item.longitude,item.latitude)); } catch {}
    }
    for (const {item, title, detail} of railwaySearchRows(rail, item => displayName(item,settings.language))) {
      entry(title, detail, () => {
          const coordinates = [item.longitude, item.latitude];
          // Before the map has loaded, go there as soon as it has.
          navigate(coordinates,14);
          showDetails({ kind: 'station', properties: item, geometry: { type: 'Point', coordinates } });
        });
    }
    if (other.length) {
      const heading = textNode('li', 'Places · Nominatim / © OpenStreetMap contributors', 'search-heading'); heading.setAttribute('role', 'presentation'); results.append(heading);
      for (const item of other) {
        try { Object.assign(item, locate(item.longitude,item.latitude)); } catch {}
        entry(displayName(item,settings.language) || item.name, [item.place?.replaceAll('_', ' '), item.area].filter(Boolean).join(' · ').slice(0, 90), () => {
          const [south, north, west, east] = item.boundingbox || [];
          const bounds=[south,north,west,east].every(Number.isFinite)&&north>south?[[west,south],[east,north]]:undefined;
          navigate([item.longitude,item.latitude],13,bounds);
        });
      }
    }
    const count = rail.length + other.length;
    results.hidden = !count;
    const unavailable = [facilities.status === 'rejected' && 'station search', places.status === 'rejected' && 'place search'].filter(Boolean);
    const invalid = [facilities.value?.invalid && 'station search', places.value?.invalid && 'place search'].filter(Boolean);
    const incomplete = [unavailable.length && `${unavailable.join(' and ')} unavailable`, ...invalid.map(source => `${source} returned invalid results`)].filter(Boolean);
    // An empty healthy sibling does not establish a completed no-match search.
    // Keep usable rows, but make their incomplete source coverage explicit too.
    $('search-status').textContent = (count ? `${rail.length} railway ${rail.length === 1 ? 'result' : 'results'}, ${other.length} ${other.length === 1 ? 'place' : 'places'}`
      : incomplete.length ? 'No matches from the available sources.' : 'No matching facility or place found. Try a local name or railway code.')
      + (incomplete.length ? `${count ? '.' : ''} Search incomplete: ${incomplete.join('; ')}.` : '');
  } catch (error) {
    if (controller !== searchController) return;
    $('search-status').textContent = 'Search is unavailable. Try again, or browse by panning and zooming.';
  } finally { clearTimeout(timeout); }
});
frequencyExpiry=installFrequencyExpiry({
  active:()=>Boolean(useFlat?flatSourceContext:ready)&&document.visibilityState!=='hidden'&&(settings.mode==='service'||currentFeature?.layer?.id==='service-routes'),
  features:()=>[...(useFlat?flatServiceFeatures:map.querySourceFeatures('serviceRoutes',{sourceLayer:'service_routes'})),...(currentFeature?.layer?.id==='service-routes'?[currentFeature]:[])],
  refresh:()=>{
    if(useFlat){
      flatRefreshStyle?.(true);
      if(currentFeature?.layer?.id==='service-routes')showServiceDetails(currentFeature);
      return;
    }
    const p=serviceFrequencyPaint(settings);
    if(map.getStyle().layers.some(l=>l.id==='service-routes'))for(const [key,value] of [['line-width',p.width],['line-offset',p.offset],['line-opacity',p.opacity]])map.setPaintProperty('service-routes',key,value);
    if(map.getStyle().layers.some(l=>l.id==='service-names'))map.setLayoutProperty('service-names','text-offset',p.labelOffset);
    if(currentFeature?.layer?.id==='service-routes')showServiceDetails(currentFeature);
  }
});
document.addEventListener('visibilitychange',()=>document.visibilityState==='visible'?frequencyExpiry.resume():frequencyExpiry.pause());
addEventListener('pagehide',()=>frequencyExpiry.pause());
addEventListener('pageshow',()=>frequencyExpiry.resume());
// Watch controls occupy the screen only after deliberate invocation. Normal
// taps keep browsing the map rather than opening station/detail cards.
const watchGesture=installWatchGesture($('map'),{active:()=>settings.ui==='watch'&&$('watch-menu').hidden,open:()=>openWatchMenu()});
function closeWatchMenu() {
  $('watch-menu').hidden=true;$('map-frame').inert=false;
  const canvas=map?.getCanvas();canvas?.focus?.({preventScroll:true});
}
function syncWatchLayout() {
  const watch=settings.ui==='watch',changed=document.body.dataset.ui!==settings.ui;
  document.body.dataset.ui=settings.ui;$('watch-layout').checked=watch;
  document.querySelector('.panel').inert=watch;
  if(!changed)return;
  closeWatchMenu();watchGesture.cancel();
  if(watch){for(const tool of [drawing,measuring])if(tool?.active)tool.setMode(tool.mode);closeDetails();$('draw-toolbar').hidden=true;$('measure-toolbar').hidden=true;if($('about').open)$('about').close();}
  $('map').setAttribute('aria-label',watch?'Interactive railway map. Hold to open controls, or use Shift F10.':'Interactive worldwide railway map');
  map?.resize?.();
}
function openWatchMenu(page='main') {
  if(settings.ui!=='watch')return;
  const content=$('watch-content');content.replaceChildren();
  const button=(label,action,parent=content)=>{const b=textNode('button',label);b.type='button';b.addEventListener('click',action);parent.append(b);return b;};
  const select=(label,choices,value,change)=>{const s=document.createElement('select');s.setAttribute('aria-label',label);for(const [v,name] of choices){const o=textNode('option',name);o.value=v;s.append(o);}s.value=value;s.addEventListener('change',()=>change(s.value));content.append(s);return s;};
  const commit=()=>{applySettings();saveSettings();closeWatchMenu();};
  if(page==='main'){
    select('Railway view',Array.from(document.querySelectorAll('[data-mode]'),b=>[b.dataset.mode,b.textContent]),settings.mode,value=>{settings.mode=value;commit();});
    const choices=[['','Options'],['layers','Layers'],...(settings.mode==='service'?[['frequency','Frequency']]:[]),['info','Info'],['standard','Standard view']];
    select('Map options',choices,'',value=>{if(value==='standard'){settings.ui='standard';commit();}else if(value)openWatchMenu(value);});
  }else if(page==='frequency'){
    const selected=settings.serviceWidth==='equal'?'equal':settings.frequencyPeriod==='hour'?'hour':selectedFrequencyProfile(settings);
    select('Route width and time',['equal','am','pm','offpeak','overnight','hour'].filter(value=>value==='equal'||(value==='hour'?periodCovered('hour'):profileCovered(value))).map(value=>[value,value==='equal'?'Equal widths':value==='hour'?'Choose local hour':FREQUENCY_LABELS[value]]),selected,value=>{
      if(value==='hour'){openWatchMenu('hour');return;}
      settings.serviceWidth=value==='equal'?'equal':'frequency';
      if(value!=='equal'){settings.frequencyPeriod=['am','pm'].includes(value)?'peak':value;if(['am','pm'].includes(value))settings.peakPhase=value;}
      commit();
    });
  }else if(page==='hour'){
    select('Agency-local hour',Array.from({length:24},(_,hour)=>[String(hour),FREQUENCY_LABELS[`h${String(hour).padStart(2,'0')}`]]),String(settings.frequencyHour),value=>{settings.frequencyHour=Number(value);settings.frequencyPeriod='hour';settings.serviceWidth='frequency';commit();});
  }else {
    const scroll=textNode('div','','watch-scroll');content.append(scroll);
    if(page==='layers')for(const [key,label] of [['stations','Stations'],['names','Route names'],['labels','Value labels'],['trackCounts','Track counts'],['inactive','Inactive railways'],['transport','Transport'],['destinations','Destinations'],['constraints','Boundaries'],['relief','Terrain']]){
      const b=button(label,()=>{settings[key]=!settings[key];commit();},scroll);b.setAttribute('aria-pressed',String(settings[key]));
    }else {
      const credits=flatCredits||attribution?._container?.querySelector('.maplibregl-ctrl-attrib-inner');if(credits)scroll.append(credits.cloneNode(true));
      else scroll.append(textNode('p','Railway Atlas · OpenStreetMap contributors · Open Railway Styles'));
      if(status.classList.contains('error'))scroll.append(textNode('p',status.textContent));
      scroll.append(textNode('p','Hold the map for controls. Drag to pan; pinch or double tap to zoom.'));

    }
  }
  button('Map',closeWatchMenu);
  $('watch-menu').hidden=false;$('map-frame').inert=true;content.scrollTop=0;content.querySelector('select,button,a')?.focus();
}
$('watch-layout').addEventListener('change',()=>{settings.ui=$('watch-layout').checked?'watch':'standard';applySettings();saveSettings();});
$('watch-menu').addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();closeWatchMenu();}
  if(event.key==='Tab'){const items=Array.from($('watch-content').querySelectorAll('select,button,a[href]'));const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
});
applySettings();
initialize().catch(error => {
  console.error(error);
  status.classList.add('error');
  status.textContent = /WebGL|webglcontext/i.test(error.message)
    ? 'This browser could not start WebGL. Enable graphics acceleration in your browser settings, then reload the map.'
    : error.message;
});

// Named export lets integration tests inspect rendered features without
// adding test controls or global variables to the map interface.
export {map};

