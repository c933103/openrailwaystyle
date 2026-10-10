import {installControlLayout, rememberAttribution, installPwaInstall, backportMapLibre524, MAPLIBRE_BACKPORT} from './map-controls.mjs?v=20261010-matched-frequency-1';
import {CJK_FONTS, PROBE_FAMILY, PROBE_FONT, PROBE_SETS, familyNames, chooseCjkFont, isLocalFamily} from './cjk-font.mjs?v=20261010-matched-frequency-1';
import {RARE_HAN_FAMILY, createRareHanFonts, rareHanBlocks} from './rare-han.mjs?v=20261010-matched-frequency-1';
import {CROSSING_TAGS} from './crossing-tags.mjs?v=20261010-matched-frequency-1';
import {contextIcon, contextDescription, contextLayerInteractive, nearbyTransport} from './context.mjs?v=20261010-matched-frequency-1';
import { SETTING_KEYS, SETTING_PARAMS, settingsQuery, speedBands, UNKNOWN_COLOR, INFRASTRUCTURE, NOT_ELECTRIFIED, TRAIN_PROTECTION, CONTROL_FAMILIES, CONTROL_LEVELS, NO_PROTECTION, controlColor, trainProtection, trainProtectionName, trainProtectionShort, trainProtectionSystems, electrificationColor, gaugeColor, axleLoad, formatAxleLoad, axleLabel, loadingGauge, loadingDimensions, INACTIVE_STATES, LIFECYCLE_PATTERNS, inactivePaint, describeCurrent, DEM_URL, contourOptions, speedPaint, speedLabel, SEARCH_API, PLACE_SEARCH_API, searchResults, tileStations, drawnStationQueries, LANGUAGES, chooseName, labelExpression, displayName, legendRows, autoProjection, ORM, MODES, DETAIL_LEVELS, formatReadout, osmObject, createPlatformLengths, createPlatformTileGeometry, platformLengthLabel, formatPlatformLength, readSettings, formatSpeed, numericSpeed, stationRank, decodeLifecycleTile } from './map-model.mjs?v=20261010-matched-frequency-1';

import { Drawing, Measure, readDrawing, lengthKm, formatLength, formatClimb, climb } from './draw.mjs?v=20261010-matched-frequency-1';
import { createElevation, alongLine, profileStats } from './elevation.mjs?v=20261010-matched-frequency-1';
import { stationDepartures, plannerLink, TRANSITOUS_SOURCES } from './departures.mjs?v=20261010-matched-frequency-1';
import {departureItem} from './departures-ui.mjs?v=20261010-matched-frequency-1';
import { installGlobeDrag, allowPolarCentres, readoutZoom, viewHash, parseViewHash } from './globe-drag.mjs?v=20261010-matched-frequency-1';
import { installBathymetry, shareArchiveRequests, seabedContourOpacity } from './bathymetry.mjs?v=20261010-matched-frequency-1';
import { installKeyboardPan } from './keyboard-pan.mjs?v=20261010-matched-frequency-1';
import { layerVisibility, shouldLocalizeLayer } from './layer-semantics.mjs?v=20261010-matched-frequency-1';
import {createPowerFacilityLoader, powerFacilityName, POWER_FACILITY_KINDS} from './power-facilities.mjs?v=20261010-matched-frequency-1';
import {serviceFrequencyPaint,nearestServiceFeature,frequencyDetails,frequencyAttribution,frequencyWidth,selectedFrequencyProfile,FREQUENCY_LABELS,HOURLY_PROFILES,installFrequencyExpiry} from './service-frequency.mjs?v=20261010-matched-frequency-1';
import { installWatchGesture } from './watch-map.mjs?v=20261010-matched-frequency-1';
import { createRailProviderRecovery } from './rail-provider-recovery.mjs?v=20261010-matched-frequency-1';
import { createBundleReader } from './tile-bundles.mjs?v=20261010-matched-frequency-1';

const $ = id => document.getElementById(id);
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
function saveView() {
  if (!map) return;
  const c = map.getCenter();
  try { localStorage.setItem(VIEW_STORE, JSON.stringify({c: [+c.lng.toFixed(5), +c.lat.toFixed(5)], z: +map.getZoom().toFixed(2), b: +map.getBearing().toFixed(1), p: +map.getPitch().toFixed(1), g: onGlobe()})); } catch {}
}
const readCookie = name => { try { return decodeURIComponent(document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1] || ''); } catch { return ''; } };
const writeCookie = (name, value) => { try { document.cookie = `${name}=${encodeURIComponent(value)}; max-age=31536000; path=/; SameSite=Lax`; } catch {} };
const remembered = (() => { try { const value = JSON.parse(readCookie(SETTINGS_COOKIE) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } })();
const settings = readSettings(location.search, {language: readCookie(LANGUAGE_COOKIE), ...remembered});
// The compact attribution/info control is UI state rather than a shareable map
// setting. Keep it in the same settings cookie, closed on a first visit.
settings.attributionOpen = typeof remembered.attributionOpen === 'boolean' ? remembered.attributionOpen : false;
const status = $('map-status');
let legendHelpOpen = false;
let platformLengths,frequencyExpiry;
let powerFacilities;
let railRecovery, wakeRailRecovery = () => {};
let map, ready = false, currentFeature, searchController, searchPausedUntil = 0, dem, scale, styleLanguage, pendingView, clickable = [], hoverFrame, drawing, measuring;
const assetVersion = new URL(import.meta.url).searchParams.get('v') || '20261010-matched-frequency-1';
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
      const urls = [...(name === 'maplibre-js' ? [new URL(MAPLIBRE_BACKPORT.target, import.meta.url).href] : []),
        new URL(library.local, import.meta.url).href, library.url];
      for (const url of urls) {
        const response = await cache.match(url);
        if (!response?.ok || response.type === 'opaque') continue;
        const type = (response.headers.get('content-type') || '').split(';')[0].trim();
        if (!(name.endsWith('-css') ? /^text\/css$/i.test(type) : /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/i.test(type))) continue;
        const digest = await window.crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
        const sha256 = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (name === 'maplibre-js' && sha256 === MAPLIBRE_BACKPORT.sha256) return response;
        if (sha256 !== library.sha256) continue;
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
    style.textContent = await saved.text();
    link.after(style);
  })();
}
// The link's error may precede module execution, so check its sheet now as
// well as listening for a later failure. Both copies have the same pinned
// version; a slow successful first-party link can safely finish afterwards.
$('maplibre-css')?.addEventListener('error', () => restoreCachedMapStyle().catch(() => {}), {once: true});
restoreCachedMapStyle().catch(() => {});
const libraries = Promise.all([
  loadScript(new URL('vendor/maplibre-gl-5.24.0-atlas.1.js', import.meta.url).href, 'maplibregl', 'maplibre-js'),
  loadScript(new URL('vendor/pmtiles-4.2.1.js', import.meta.url).href, 'pmtiles', 'pmtiles-js'),
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
let coveredProfiles=null;
const profileCovered=profile=>!coveredProfiles||coveredProfiles.has(profile);
const periodCovered=period=>period==='peak'?profileCovered('am')||profileCovered('pm'):period==='hour'?HOURLY_PROFILES.some(profileCovered):profileCovered(period);
// Rare Han glyph slices, loaded for the labels of each tile before it is drawn;
// one that arrives after a label was drawn without it redraws the labels.
const rareHanFonts=createRareHanFonts({root:new URL('fonts/rare-han-v1/', import.meta.url),fetcher:(...args)=>fetch(...args),FontFace:window.FontFace,fonts:document.fonts,onLoad:()=>refreshCjkFont()});
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
const errors = new Map();
const textNode = (tag, value, className) => {
  const el = document.createElement(tag); el.textContent = value;
  if (className) el.className = className;
  return el;
};
// Power, train control, gauge and loading gauge legends name exactly what
// is drawn in the current view, most common first: systems are regional,
// and a fixed list would be long and mostly irrelevant.
let inView = [], legendTimer;
// Waits for the view's tiles rather than map idle, which any slow tile
// (e.g. relief) can hold back.
function scheduleLegend() {
  clearTimeout(legendTimer);
  if (IN_VIEW[settings.mode]) legendTimer = setTimeout(updateInView, 250);
}
const GAUGE_NAMES = {600:'', 762:'2 ft 6 in', 914:'3 ft', 1000:'metre', 1067:'3 ft 6 in', 1372:'Scotch', 1435:'standard', 1520:'Russian', 1524:'Finnish', 1600:'Irish', 1668:'Iberian', 1676:'Indian'};
const IN_VIEW = {
  electrification: p => {
    if (['no', 'deelectrified'].includes(p.electrification_state) || p.voltage === 0) return null;
    const label = describeCurrent(p.voltage, p.frequency);
    // Sorted DC first, then AC by frequency, each by voltage.
    return label && !/not recorded/.test(label) ? [electrificationColor(p), label, (p.frequency || 0) * 1e6 + (p.voltage || 0)] : null;
  },
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
function updateInView() {
  const describe = IN_VIEW[settings.mode];
  if (!ready || !describe) return;
  const layers = settings.mode === 'service' ? ['service-routes'] : [`${settings.mode}-branch-overview`, `${settings.mode}-overview`, `${settings.mode}-tracks`, `${settings.mode}-metro-overview`].filter(id => map.getLayer(id));
  const counts = new Map();
  for (const f of map.queryRenderedFeatures({layers})) {
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
function renderLegend() {
  const box = $('legend'); box.replaceChildren();
  const nothing = [['transparent', 'Nothing recorded in view', 'empty']];
  const listed = rows => rows.length ? rows : nothing;
  const legends = {
    speed: { title: `Mapped maximum speed · ${settings.units === 'imperial' ? 'mph' : 'km/h'}`, rows: speedBands(settings.units).map(b => [b.color, b.label]) },
    infrastructure: { title: 'Railway infrastructure', rows: INFRASTRUCTURE },
    electrification: { title: 'Railway power · in view', rows: [...listed(inView), [NOT_ELECTRIFIED, 'Not electrified']] },
    control: { title: 'Train protection · in view', rows: [...listed(inView), [NO_PROTECTION, 'No train protection']] },
    gauge: { title: 'Track gauge · in view', rows: listed(inView) },
    axle: {title:'Axle load · in view',rows:listed(inView)},
    loading: { title: 'Loading gauge · in view', rows: listed(inView) },
    owner: { title: 'Infrastructure owner · in view', rows: listed(inView) },
    service: { title: 'Urban rail services · in view', rows: listed(inView) },
  };
  const legend = legends[settings.mode];
  box.append(textNode('h2', legend.title));
  const grid = textNode('div', '', 'legend-grid');
  const rows = [...legend.rows];
  if (settings.mode === 'gauge') rows.push(['#1f5fbf', 'Dual gauge (one half per gauge)', 'dual']);
  if (settings.mode === 'service') rows.push(['#b8c0c5', 'Other track']);
  else if (settings.mode !== 'infrastructure') rows.push([UNKNOWN_COLOR, 'Unknown']);
  rows.push(['#2356b6','Bridge','bridge'], ['#2356b6','Tunnel','tunnel']);
  if (settings.mode === 'control') rows.push(['#765484','Signal']);
  if (settings.mode === 'electrification') rows.push(...[['substation','Electricity supply'],['fuel','Locomotive fuel'],['coaling_facility','Coal supply'],['water_tank','Steam locomotive water']].map(([kind,label]) => [POWER_FACILITY_KINDS[kind].color,label]));
  if (settings.mode === 'infrastructure') rows.push(['#b68f55','Shared roadway','street-running'], ['#63332c','Level crossing','level-crossing'],['#765484','Signal'],['#167a78','Station entrance']);
  if (settings.inactive) rows.push(...INACTIVE_STATES.map(([state, color, label]) => [color, label, `inactive-${state}`]));
  for (const [color, label, extra] of rows) {
    const row = textNode('div', '', 'legend-item');
    const swatch = textNode('span', '', `swatch ${extra || ''}`); swatch.style.setProperty('--swatch', color);
    if (extra?.startsWith('inactive-')) {
      const pattern=LIFECYCLE_PATTERNS[extra.slice(9)];
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),line=document.createElementNS('http://www.w3.org/2000/svg','line');
      svg.setAttribute('viewBox','0 0 62 12');svg.setAttribute('aria-hidden','true');
      for(const [key,value] of Object.entries({x1:2,x2:60,y1:6,y2:6,stroke:color,'stroke-width':2,'stroke-dasharray':pattern.dash.map(n=>n*2).join(' '),'stroke-linecap':pattern.cap})) line.setAttribute(key,value);
      svg.append(line);swatch.append(svg);swatch.classList.add('pattern-swatch');
    }
    row.append(swatch, extra?.startsWith('control-') ? controlSystemLabel(extra.slice(8)) : textNode('span', label)); grid.append(row);
  }
  if (settings.stations) {
    const station = textNode('div', '', 'legend-item'); station.append(textNode('span', '', 'station-swatch'), textNode('span', 'Station')); grid.append(station);
  }
  if (settings.mode === 'infrastructure') {
    for (const [kind, label] of [['', 'Tracks side by side'], ['tunnel', 'All in tunnel'], ['station', 'Tracks at station']]) {
      const tracks = textNode('div', '', 'legend-item'); tracks.append(textNode('span', '2', `track-badge-swatch ${kind}`), textNode('span', label)); grid.append(tracks);
    }
  }
  box.append(grid);
  if(settings.mode==='service'&&settings.serviceWidth==='frequency'){
    const key=textNode('div','','frequency-key');
    key.append(textNode('p',FREQUENCY_LABELS[selectedFrequencyProfile(settings)],'small'));
    for(const rate of [1,6,12,24,30]){const sample=textNode('span','','frequency-sample'),mark=textNode('i');mark.style.height=frequencyWidth(rate)+'px';sample.append(mark,textNode('span',`${rate===30?'30+':rate}/h`));key.append(sample);}
    key.append(textNode('p','Subdued line: no matched frequency profile. Departure timetables may still be available. Rates are per direction; published headways are estimates.','small'));box.append(key);
  }
  const notes = {
    speed: settings.units === 'imperial' ? 'Labels in mph; limits tagged in mph keep their directional values. Grey means no numeric limit is recorded.' : 'Labels keep tagged units: bare numbers are km/h, mph is written out. Grey means no numeric limit is recorded.',
    electrification: 'Track hue is the current type (DC, or AC by frequency); darker is higher voltage. A train needs both to match, unless built for several systems. E/F/C/W markers identify railway electricity, fuel, coal and steam-water supplies. Hollow markers identify planned or former facilities when those are enabled. Grey means not recorded.',
    control: 'Hue groups related systems; darker is more advanced: warning only, spot transmission, continuous, radio. Parallel colour bands show each recorded system on a shared track. Hover a system name for its description, or tap/click it to expand. Purple dots mark mapped signals, not live aspects. Grey means nothing is recorded.',
    gauge: 'Gauges a few millimetres apart (e.g. 1432 and 1435, 1520 and 1524) share one colour and are generally compatible. Click a track for all recorded gauges. Grey means not recorded.',
    axle: 'Colour shows the mapped axle load or the load category’s reference axle load. Load per metre and additional operating restrictions also matter. Numeric US/Canadian classes describe speed, and Finnish superstructure classes do not give a single axle-load limit. Grey means not recorded.',
    loading: 'Colour follows the envelope’s height above rail, so equal sizes match across regions; Britain’s W gauges share one height and form their own ladder. Click a track for dimensions. Grey means not recorded.',
    owner: 'Each owner of the infrastructure, as recorded in OpenStreetMap, has its own colour, the same everywhere; the owner is not always the operator. Click a track for its owner and operator. Grey means no owner is recorded.',
    service: 'Urban rail services mapped in OpenStreetMap (metro, light rail, tram, monorail and commuter rail), each in its own colour along the tracks it runs on. Frequency widths use matched timetable counts on covered sections, with published headway estimates for missing periods. Frequency and OpenStreetMap service coverage are partial; grey tracks have no service mapped.',
    infrastructure: 'Numbers in boxes count mapped tracks: running tracks side by side (not sidings, yards or crossovers), on every level; at a station, sidings are included. Ochre marks shared roadway; crossings are brown. Zoom in for platform references and complete boarding-edge lengths, purple signal locations and teal station entrances. Signal markers do not show a live aspect.',
  };
  let note = notes[settings.mode];
  if(settings.mode==='service'&&settings.serviceWidth==='frequency')note+=' Width uses the same capped scale across periods, using the lower directional rate or the lower bound of a published range. Morning and evening peaks are separate.'+(periodCovered('overnight')||periodCovered('hour')?' Overnight and individual hours use each agency’s local time on the reference date; temporary operating changes may be absent.':'')+' Missing, expired or unmatched profiles remain unavailable.';
  if (settings.inactive && settings.mode === 'speed') note += ' Planned and former lines take the colour of their recorded limit, if any.';
  // Collapsed by default, so the legend stays short; stays open once opened.
  const help = Object.assign(textNode('details', '', 'legend-help'), {open: legendHelpOpen});
  help.append(textNode('summary', 'How to read this view'), textNode('p', note, 'legend-note'));
  help.addEventListener('toggle', () => { legendHelpOpen = help.open; });
  box.append(help);
}
function saveSettings() {
  writeCookie(SETTINGS_COOKIE, JSON.stringify({...Object.fromEntries(SETTING_KEYS.map(key => [key, settings[key]])), attributionOpen: settings.attributionOpen}));
  const url = new URL(location.href);
  if (SETTING_PARAMS.some(key => url.searchParams.has(key))) {
    for (const key of SETTING_PARAMS) url.searchParams.delete(key);
    history.replaceState(null, '', url);
  }
}
// The address of this view with its display settings, for sharing.
function shareURL() {
  const url = new URL(location.href);
  for (const [key, value] of settingsQuery(settings)) url.searchParams.set(key, value);
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
 if(!ready||!settings.stations||settings.background==='satellite'||map.getZoom()<3||map.getZoom()>=7)return;
 const source=map.getSource('stationMajor'),language=settings.language;
 stationTileURL ||= map.getSource('stations')?.tiles?.[0]?.replace(/^atlasstation:\/\/[^/]+\//,'');
 if(!source||!stationTileFor||!stationTileURL)return;
 const generation=++majorStationGeneration,zoom=map.getZoom(),bounds=map.getBounds();
 majorStationsPromise ||= majorStationData?Promise.resolve(majorStationData):fetch(new URL(`major-stations.geojson?v=${assetVersion}`,import.meta.url)).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}).catch(error=>{majorStationsPromise=undefined;throw error;});
 majorStationsPromise.then(async data=>{
  // Only the hubs this view can show are named; others wait for their view.
  const west=bounds.getWest()-10,east=bounds.getEast()+10,south=bounds.getSouth()-10,north=bounds.getNorth()+10;
  // Into the world copy the view shows, however far it was panned.
  const centre=(west+east)/2;
  const wanted=data.features.filter(f=>{const [lon,lat]=f.geometry.coordinates,l=lon+360*Math.round((centre-lon)/360);return (f.properties.tier??7)<=Math.floor(zoom)&&l>=west&&l<=east&&lat>=south&&lat<=north;});
  const named=await Promise.all(wanted.map(f=>majorStationName(f,language).catch(()=>null)));
  if(generation!==majorStationGeneration||!ready||language!==settings.language||source!==map.getSource('stationMajor'))return;
  const names=new Map(wanted.map((f,i)=>[f.id,named[i]]));
  // Hubs named earlier for this language keep their names off-view, so
  // panning back does not blank them while their tiles are read again.
  const previous=new Map((majorStationSearchData?.language===language?majorStationSearchData.features:[]).map(f=>[f.id,f]));
  const features=data.features.map(f=>{
   const p=names.get(f.id);
   if(p)return {...f,properties:{...f.properties,name:p.name,localized_name:p.localized_name,atlas_name:p.atlas_name,atlas_language:language,atlas_name_source:'provider'}};
   return previous.get(f.id)||null;
  }).filter(Boolean);
  // These names reach the map as GeoJSON, not through a tile protocol, so
  // their rare Han slices load here (the layers draw atlas_name, else name).
  const glyphs=new Set();for(const f of features)rareHanBlocks(f.properties.atlas_name||f.properties.name,glyphs);
  if(glyphs.size){await rareHanFonts.ensure(glyphs);if(generation!==majorStationGeneration||!ready||language!==settings.language||source!==map.getSource('stationMajor'))return;}
  majorStationSearchData={type:'FeatureCollection',language,features};
  source.setData({type:'FeatureCollection',features});
 }).catch(error=>console.warn('Major station names unavailable:',error.message));
}
// An open curated station's panel follows a language change on its own,
// whether or not the overview currently shows that hub.
function renameOpenMajorStation(){
 const open=currentFeature;
 const curatedData=majorStationsPromise||(majorStationData&&Promise.resolve(majorStationData));
 if(open?.source!=='stationMajor'||$('details').hidden||!stationTileFor||!curatedData)return;
 stationTileURL ||= map.getSource('stations')?.tiles?.[0]?.replace(/^atlasstation:\/\/[^/]+\//,'');
 if(!stationTileURL)return;
 const language=settings.language;
 curatedData.then(data=>{
  const curated=data.features.find(f=>f.properties.id===open.properties?.id);
  return curated&&majorStationName(curated,language).then(p=>{
   if(!p||currentFeature!==open||language!==settings.language||$('details').hidden)return;
   open.properties={...curated.properties,name:p.name,localized_name:p.localized_name,atlas_name:p.atlas_name,atlas_language:language,atlas_name_source:'provider'};
   showDetails(open);
  });
 }).catch(()=>{});
}
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
  readout.hidden = !settings.readout; updateReadout();
  if (ready) clickable = [];
  const frequencyPaint=serviceFrequencyPaint(settings);
  if (ready) for (const layer of map.getStyle().layers) {
    // Shown unless a setting hides it (a layer hidden under the imagery comes
    // back with the map).
    if(layer.id==='polar-caps')map.triggerRepaint();
    if(layer.id==='service-routes')for(const [property,value] of [['line-width',frequencyPaint.width],['line-offset',frequencyPaint.offset],['line-opacity',frequencyPaint.opacity]])map.setPaintProperty(layer.id,property,value);
    if(layer.id==='service-names')map.setLayoutProperty(layer.id,'text-offset',frequencyPaint.labelOffset);
    const visible = layerVisibility(layer, settings);
    if (visible !== undefined) map.setLayoutProperty(layer.id, 'visibility', visible ? 'visible' : 'none');
    if (isLowZoomStationLayer(layer.id)) map.setPaintProperty(layer.id, 'text-color', lowZoomStationTextColor());
    if (/^inactive-(regional|railways)-/.test(layer.id) && layer.type === 'line' && !layer.id.includes('bridge')) map.setPaintProperty(layer.id, 'line-color', inactivePaint(settings.mode, settings.units));
    if ((visible ?? true) && isClickable(layer.id)) clickable.push(layer.id);
  }
  // Clear the previous view's values before drawing the legend: if the new
  // view has nothing in view, the in-view list never changes and the legend
  // would keep the old rows.
  inView = [];
  renderLegend();
  if (ready) { scheduleLegend(); scheduleNearbyTransport();updateMajorStations();platformLengths?.update();powerFacilities?.(); }
  frequencyExpiry?.update();
  if (ready) wakeRailRecovery();
}
let attribution, attributionStateCleanup, controlLayout, servedBuild;
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
const featurePickRank = f => [...SIGNAL_SOURCES,'stationEntrances','electricFacilities','electricSubstations'].includes(f.source) ? -1 : f.source?.startsWith('station') ? 0 : f.layer?.id.startsWith('context-') ? (f.geometry?.type === 'Point' ? 1 : 3) : 2;
const INFRASTRUCTURE_POINTS = ['infrastructure-level-crossings','infrastructure-crossing-overview','infrastructure-crossing-dots','infrastructure-crossing-marks','infrastructure-street-running','infrastructure-signal-points','infrastructure-signal-references','infrastructure-signal-supplement-overview','infrastructure-signal-supplement-points','infrastructure-signal-supplement-references','infrastructure-entrance-points','infrastructure-entrance-references'];
// Clickable: stations, tracks, level crossings, inactive lines, and transport
// and destination points; land-use areas, protected, heritage and other
// planning areas, jurisdictions and buildings are drawn for context only.
const isClickable = id => id.startsWith('platform-') || INFRASTRUCTURE_POINTS.includes(id) || /^electrification-(substation-(areas|edges)|(?:former-)?supply-(points|marks|names))$/.test(id) || contextLayerInteractive(id) || id.startsWith('station-') || (id.startsWith('inactive-') && !id.includes('bridge')) || /^(speed|infrastructure|electrification|control|gauge|loading|axle|owner|service)-(tracks|overview|branch-overview|metro-overview)$/.test(id) || /^control-(tracks|overview|branch-overview|metro-overview)-system-[23]$/.test(id) || id === 'service-routes';
function row(dl, label, value) {
  if (value === undefined || value === null || value === '') return;
  dl.append(textNode('dt', label), textNode('dd', String(value)));
}
function controlSystemLabel(code) {
  const system = trainProtection(code), family = system && CONTROL_FAMILIES[system[2]];
  const description = system
    ? [system[1], CONTROL_LEVELS[system[3]], code !== 'none' && family?.note].filter(Boolean).join(' · ')
    : `${code} · Recorded system; classification is not available`;
  const details = textNode('details', '', 'system-label');
  const summary = textNode('summary', trainProtectionShort(code)); summary.title = description;
  details.append(summary, textNode('p', description, 'system-description'));
  return details;
}
function controlSystemRow(dl, label, codes) {
  if (!codes.length) return;
  const values = textNode('dd', '', 'system-list');
  for (const code of codes) values.append(controlSystemLabel(code));
  dl.append(textNode('dt', label), values);
}
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
  if(['platformEdges','platformLengths','platforms','platformNumbers'].includes(feature.source))feature=platformLengths?.enrich(feature)||feature;
  currentFeature = feature;
  if (['electricFacilities','electricSubstations'].includes(feature.source)) { showPowerFacilityDetails(feature); return; }
  if([...SIGNAL_SOURCES,'stationEntrances'].includes(feature.source)){showRailwayPointDetails(feature);return;}
  if (INFRASTRUCTURE_POINTS.includes(feature.layer?.id)) { showInfrastructureContext(feature); return; }
  if (feature.layer?.id.startsWith('context-')) { showContextDetails(feature); return; }
  if (feature.layer?.id === 'service-routes') { showServiceDetails(feature); frequencyExpiry?.update(); return; }
  const p = feature.properties;
  const isPlatform=['platformLengths','platformEdges','platforms','platformNumbers'].includes(feature.source);
  const isStation = feature.source?.startsWith('station') || feature.kind === 'station';
  const panel = $('detail-content'); panel.replaceChildren();
  panel.append(textNode('div', isPlatform?'RAILWAY PLATFORM':isStation ? 'RAILWAY STATION' : 'RAILWAY INFRASTRUCTURE', 'eyebrow'));
  panel.append(textNode('h2', displayName(p, settings.language) || (isPlatform ? (p.ref ? `Platform ${p.ref}` : 'Platform') : isStation ? 'Unnamed station' : 'Unnamed railway')));
  const dl = document.createElement('dl');
  row(dl, 'Type', p.feature || p.railway || (isStation ? 'station' : undefined));
  row(dl, 'Status', p.state || 'present');
  row(dl, 'Reference', p.label || p.ref || p.railway_ref || p['railway:ref']);
  if(isPlatform){row(dl,p.feature==='platform_edge'?'Boarding edge length':p.length_estimated?'Estimated platform extent':'Mapped platform length',formatPlatformLength(Number(p.platform_length),settings.units));if(p.length_estimated)panel.append(textNode('p','Approximate longitudinal extent of the complete mapped platform area; usable boarding length can differ.','small'));row(dl,'Platform',p.ref);}
  else if (isStation) {
    row(dl, 'Station type', p.station);
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
    if (feature.geometry?.type === 'Point' && (!p.state || p.state === 'present')) showDepartures(panel, feature);
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
  const profiles=[...new Set(['am','pm','offpeak','overnight',selectedFrequencyProfile(settings)])].filter(profileCovered),sources=new Map();
  for(const profile of profiles){
    row(dl,FREQUENCY_LABELS[profile],frequencyDetails(p,profile)||'No matched frequency profile');
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
  osmLink(panel, feature);
  $('details').hidden = false;
}
// Departures from Transitous, live where the operator publishes real-time
// data, and journey links. Fetched once a minute at most per station (the
// panel is redrawn when settings change).
const departureBoards = new Map();
function showDepartures(panel, feature) {
  const p = feature.properties, [lon, lat] = feature.geometry.coordinates;
  const names = [displayName(p, settings.language), p.name, p.localized_name, p['name:en'], p.full_name].filter(Boolean);
  const section = document.createElement('section'); section.className = 'departures';
  section.append(textNode('h3', 'Departures'), textNode('p', 'Loading departures…', 'small'));
  panel.append(section);
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  let board = departureBoards.get(key);
  if (!board || Date.now() - board.at > 60_000) {
    board = {at: Date.now(), promise: stationDepartures({lat, lon, names}, {signal: AbortSignal.timeout(15000)})};
    departureBoards.set(key, board);
    board.promise.catch(() => departureBoards.delete(key));
  }
  board.promise.then(({stops, rows}) => {
    if (!section.isConnected) return;
    section.replaceChildren(textNode('h3', 'Departures'));
    if (!rows.length) section.append(textNode('p', stops.length ? 'No rail departures in the published timetable soon.' : 'No published timetable covers this station.', 'small'));
    else {
      const live = rows.filter(r => r.live).length;
      section.append(textNode('p', live ? `Live times for ${live} of ${rows.length} departures; the rest are timetabled.` : 'Timetabled times: no live data for these departures.', 'small'));
      if (settings.serviceWidth === 'frequency') section.append(textNode('p', 'These departure timetables are available independently of the map’s matched frequency profiles.', 'small'));
      section.append(textNode('p', 'Click a departure to see its full train schedule. Drag over text to select and copy it.', 'small'));
      const list = document.createElement('ol'); list.className = 'departure-list';
      for (const r of rows) {
        list.append(departureItem(document, r));
      }
      section.append(list);
    }
    const place = stops[0]?.id || `${lat},${lon}`, name = names[0];
    const links = textNode('p', '', 'departure-links');
    for (const [direction, label] of [['from', 'Journey from here ↗'], ['to', 'Journey to here ↗']]) {
      const a = textNode('a', label); a.href = plannerLink(direction, place, name); a.target = '_blank'; a.rel = 'noopener'; links.append(a, ' ');
    }
    const source = textNode('a', 'Transitous'); source.href = TRANSITOUS_SOURCES; source.target = '_blank'; source.rel = 'noopener';
    const credit = textNode('p', 'Timetables and live data: ', 'small'); credit.append(source, ' (see its sources and licences).');
    section.append(links, credit);
  }).catch(() => {
    if (section.isConnected) section.replaceChildren(textNode('h3', 'Departures'), textNode('p', 'Departures could not load. Try again later.', 'small'));
  });
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
function showRailwayPointDetails(feature) {
  const p=feature.properties,signal=SIGNAL_SOURCES.includes(feature.source),panel=$('detail-content');
  panel.replaceChildren(textNode('div',signal?'RAILWAY SIGNAL':'STATION ENTRANCE','eyebrow'));
  panel.append(textNode('h2',signal?(p.ref?`Signal ${p.ref}`:'Railway signal'):(p.label||'Station entrance')));
  const dl=document.createElement('dl');
  row(dl,signal?'Reference':'Entrance label',signal?p.ref:p.label);
  if(signal){
    row(dl,'Caption',p.caption);
    const categories=[...new Set(Array.from({length:12},(_,i)=>p[`category${i}`]).filter(Boolean))];
    row(dl,'Mapped functions',categories.map(v=>String(v).replaceAll('_',' ')).join(', '));
    const inactive=[...new Set(Array.from({length:12},(_,i)=>p[`deactivated${i}`]===true?p[`category${i}`]:null).filter(Boolean))];
    row(dl,'Inactive components',inactive.map(v=>String(v).replaceAll('_',' ')).join(', '));
    row(dl,'Facing',p.direction_both===true?'Both directions':typeof p.azimuth==='number'&&Number.isFinite(p.azimuth)?`${Math.round(((p.azimuth%360)+360)%360)}° clockwise from north`:undefined);
  }
  panel.append(dl,textNode('p',signal?'A mapped signal location and its recorded functions. The marker does not show a live signal aspect.':'A station entrance recorded in OpenStreetMap.','small'));
  osmLink(panel,feature);$('details').hidden=false;
}
function showPowerFacilityDetails(feature) {
  const p=feature.properties, panel=$('detail-content'), label=feature.source==='electricSubstations'?'Traction substation':powerFacilityName(p);
  panel.replaceChildren(textNode('div','RAILWAY ENERGY SUPPLY','eyebrow'),textNode('h2',displayName(p,settings.language)||p.ref||label));
  const dl=document.createElement('dl');
  row(dl,'Type',label); row(dl,'Status',p.power_state||(feature.source==='electricSubstations'?'Not recorded':'present')); row(dl,'Reference',p.ref);
  row(dl,'Operator',p.operator); row(dl,'Owner',p.owner); row(dl,'Voltage',p.voltage); row(dl,'Frequency',p.frequency!==undefined&&p.frequency!==null&&p.frequency!=='' ? `${p.frequency} Hz` : undefined);
  row(dl,'Fuel',p.fuel || Object.entries(p).filter(([k,v])=>k.startsWith('fuel:')&&v==='yes').map(([k])=>k.slice(5)).join(', ') || p['generator:source'] || p['plant:source']); row(dl,'Stored contents',p.content);
  row(dl,'Output',p['plant:output:electricity'] || p['generator:output:electricity']); row(dl,'Capacity',p.capacity);
  row(dl,'Mapped as',p.railway || p.power || p.man_made); panel.append(dl); osmLink(panel,feature);
  $('details').hidden=false;
}
function showInfrastructureContext(feature) {
  const p=feature.properties,crossing=feature.sourceLayer==='points_of_interest';
  const panel=$('detail-content');panel.replaceChildren(textNode('div','RAILWAY INFRASTRUCTURE','eyebrow'));
  // An overview dot (crossings merged per tile, without ids): the nearest
  // crossing in the detailed crossing tiles.
  if(feature.sourceLayer==='level_crossings' && !Number.isInteger(feature.id) && feature.clickLngLat) {
    const pending=feature;
    nearestCrossing(feature.clickLngLat).then(found=>{ if(currentFeature===pending) showInfrastructureContext(found ? {...pending, ...found} : {...pending, clickLngLat: null}); });
    return;
  }
  // A dot from the worldwide crossing tiles: its kind and OSM node only.
  if(feature.sourceLayer==='level_crossings') {
    panel.append(textNode('h2',p.kind==='foot'?'Pedestrian level crossing':'Road level crossing'));
    osmLink(panel,feature);
    if(Number.isInteger(feature.id)) {
      // The crossing snapshot's detail tiles carry the tags themselves.
      const dl=document.createElement('dl');
      for(const [key,label] of CROSSING_TAGS) row(dl,label,typeof p[key]==='string'?p[key].replaceAll('_',' ').replaceAll(';',', '):undefined);
      if(p.tags_unreadable) panel.append(textNode('p','This crossing\'s tags could not be read into the map data; the crossing on OpenStreetMap shows them.','small'));
      else if(dl.children.length) panel.append(dl,textNode('p','From the crossing\'s OpenStreetMap tags; absence of a tag does not prove absence of equipment.','small'));
      else {
        const note=textNode('p','','small');panel.append(note);
        crossingDataHasTags().then(tags=>{note.textContent=tags?'No equipment is tagged on this crossing in OpenStreetMap.':'Equipment details come with the next crossing data update; the crossing on OpenStreetMap shows them now.';});
      }
    } else panel.append(textNode('p','Zoom in to pick out a single crossing.','small'));
    $('details').hidden=false;
    return;
  }
  panel.append(textNode('h2',crossing ? (p.feature==='general/crossing'?'Pedestrian level crossing':'Road level crossing') : 'Track in shared roadway'));
  const dl=document.createElement('dl');row(dl,'Name',displayName(p,settings.language));row(dl,'Reference',p.ref);
  if(crossing) {
    row(dl,'Mapped equipment',p.feature?.includes('light-barrier')?'Lights and barriers':p.feature?.includes('barrier')?'Barriers':p.feature?.includes('light')?'Lights':'No equipment specified in the tile');
  } else {row(dl,'Evidence',p.evidence);row(dl,'Access',p.access);row(dl,'Vehicle access',p.motor_vehicle);}
  panel.append(dl,textNode('p',crossing?'Equipment details follow the mapped feature; absence of a tag does not prove absence of equipment.':'Only explicitly mapped shared roadway is highlighted. Untagged street running can be missing.','small'));
  osmLink(panel,feature);
  $('details').hidden=false;
}
function showContextDetails(feature) {
  const p = feature.properties, category = contextDescription(p,feature.sourceLayer);
  const panel = $('detail-content'); panel.replaceChildren();
  panel.append(textNode('div',category?.group === 'transport' ? 'TRANSPORT FACILITY' : category?.group === 'constraints' ? 'PLANNING CONTEXT' : 'PASSENGER DESTINATION','eyebrow'));
  panel.append(textNode('h2',displayName(p,settings.language) || category?.label || 'Mapped area'));
  const dl = document.createElement('dl');
  row(dl,'Type',category?.label || p.subclass || p.class);
  row(dl,'Mapped as',p.subclass || p.class);
  row(dl,'Airport code',p.iata || p.icao);
  row(dl,'Reference',p.ref);
  row(dl,'Access',p.access);
  panel.append(dl);
  panel.append(textNode('p',category?.group==='constraints'?'Mapped boundaries and sites provide planning context. Consult the responsible authority for jurisdiction, access and development requirements.':'Mapped facilities and land use show potential trip destinations, not measured passenger demand.','small'));
  osmLink(panel, feature);
  $('details').hidden = false;
}
function updateNearbyTransport() {
  const target = $('nearby-transport');
  if (!target || currentFeature?.geometry?.type !== 'Point') return;
  target.replaceChildren(textNode('h3','Nearby transport'));
  if (!settings.transport) { target.append(textNode('p','Enable “Other transport & interchanges” to see nearby facilities.','small')); return; }
  if (!ready || map.getZoom() < 14) { target.append(textNode('p','Zoom in closer to list nearby terminals, stops, taxi stands and bike rental.','small')); return; }
  const features = ['poi','aerodrome_label'].flatMap(sourceLayer=>map.querySourceFeatures('openmaptiles',{sourceLayer}).map(f=>({id:f.id,properties:f.properties,geometry:f.geometry,sourceLayer})));
  const nearby = nearbyTransport(currentFeature.geometry.coordinates,features,500,map.getZoom());
  if (!nearby.length) {
    target.append(textNode('p',map.isSourceLoaded('openmaptiles') ? 'No nearby transport facility appears in the loaded map data.' : 'Loading nearby transport…','small')); return;
  }
  const list = document.createElement('ul');list.className='nearby-list';
  for (const {feature,category,distance} of nearby) {
    const item = document.createElement('li'), button = textNode('button',displayName(feature.properties,settings.language) || category.label);
    button.type='button';button.addEventListener('click',()=>{
      map.easeTo({center:feature.geometry.coordinates,zoom:Math.max(14,map.getZoom())});
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
    if(layer.id==='service-routes')Object.assign(layer.paint,{'line-width':frequencyPaint.width,'line-offset':frequencyPaint.offset,'line-opacity':frequencyPaint.opacity});
    if(layer.id==='service-names')layer.layout['text-offset']=frequencyPaint.labelOffset;
    if (/^speed-(branch-overview|metro-overview|overview|tracks)$/.test(layer.id)) layer.paint['line-color'] = speedPaint(settings.units);
    if(['platform-lengths','platform-numbers'].includes(layer.id))layer.layout['text-field']=platformLengthLabel(settings.units);
    if (layer.id === 'axle-labels') layer.layout['text-field'] = axleLabel(settings.units);
    if (layer.id === 'speed-labels') layer.layout['text-field'] = speedLabel(settings.units);
    if (/^inactive-(regional|railways)-/.test(layer.id) && layer.type === 'line' && !layer.id.includes('bridge')) layer.paint['line-color'] = inactivePaint(settings.mode, settings.units);
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
const mapErrorMessage = () => railRecovery?.hasFailures()
  ? 'OpenRailwayMap railway tiles are unavailable. Retrying automatically; some lines may be missing.'
  : 'Some map data could not load. Check your connection or reload to retry.';
function updateStatus() {
  const railFailed = railRecovery?.hasFailures(); // prune before reconciling ownership
  for (const [id, error] of errors) {
    if (error.recoveryOwned && !railRecovery?.hasSourceFailure(id, error.source)) errors.delete(id);
  }
  if (errors.size || railFailed) {
    status.classList.add('error'); status.textContent = mapErrorMessage(); return;
  }
  status.classList.remove('error');
  status.textContent = map.getZoom() < 4 ? 'Worldwide coverage · click a line' : 'Explore the rail network · click a line or station';
  // Early source events may precede style.load; status text is safe then,
  // but rendered-feature queries require the style to be ready.
  if (!ready) return;
  // Visible diagnostics make source availability inspectable without exposing
  // internal map objects or relying on a generic "loaded" flag.
  const features = map.queryRenderedFeatures();
  const tracks = features.filter(f => ['railway','speed','network','electric'].includes(f.source));
  const stations = features.filter(f => f.source.startsWith('station'));
  status.dataset.renderedTracks = String(tracks.length);
  status.dataset.renderedStations = String(stations.length);
  const regional = features.filter(f => f.source === 'inactiveRegional');
  status.dataset.lifecycleNames = JSON.stringify([...new Set(regional.map(f=>f.properties.name).filter(Boolean))]);
  status.dataset.renderedRailNames = String(features.filter(f=>f.layer.id.endsWith('-names') && !f.layer.id.startsWith('station-')).length);
  status.dataset.renderedPlanned = String(regional.filter(f => f.properties.state === 'proposed').length);
  status.dataset.renderedConstruction = String(regional.filter(f => f.properties.state === 'construction').length);
  status.dataset.renderedFormer = String(regional.filter(f => !['proposed','construction'].includes(f.properties.state)).length);
  status.dataset.numericSpeeds = String(tracks.filter(f => numericSpeed(f.properties.maxspeed) !== null).length);
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
let readoutPoint = null;
function updateReadout() {
  if (!map || readout.hidden) return;
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
const polarButton = Object.assign(document.createElement('button'), {type:'button', className:'atlas-ctrl'});
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
  polarButton.textContent = globe ? '🗺️' : '🌍';
  polarButton.title = globe ? 'Switch to the flat map' : 'Switch to the globe: every region at its true shape, without the flat map’s stretching near the poles';
  polarButton.setAttribute('aria-label', polarButton.title);
  syncPanning(); saveView();
}
polarButton.addEventListener('click', () => { map.setProjection({type: onGlobe() ? 'mercator' : 'globe'}); updatePolar(); });
const measureButton = Object.assign(document.createElement('button'), {type:'button', className:'atlas-ctrl', textContent:'📏', title:'Measure'});
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
  document.querySelectorAll('[data-measure]').forEach(b => b.setAttribute('aria-pressed', String(measuring?.mode === b.dataset.measure)));
}
// Drawing and measuring are exclusive: opening one closes the other.
function openTools(id) {
  for (const [toolbar, tool] of [['draw-toolbar', drawing], ['measure-toolbar', measuring]]) {
    const show = toolbar === id && $(toolbar).hidden;
    $(toolbar).hidden = !show;
    if (!show && tool?.active) tool.setMode(tool.mode);
  }
  updateDrawing();
}
drawButton.addEventListener('click', () => openTools('draw-toolbar'));
measureButton.addEventListener('click', () => openTools('measure-toolbar'));
$('draw-close').addEventListener('click', () => openTools(null));
$('measure-close').addEventListener('click', () => openTools(null));
document.querySelectorAll('[data-measure]').forEach(b => b.addEventListener('click', () => whenMap(() => measuring.setMode(b.dataset.measure))));
$('measure-undo').addEventListener('click', () => measuring?.undo());
$('measure-clear').addEventListener('click', () => measuring?.clear());
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
function drawStyle(style) {
  whenMap(() => drawing.setStyle(style));
  if (style.color) {
    $('draw-color').value = style.color;
    document.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === style.color)));
  }
}
document.querySelectorAll('[data-color]').forEach(b => { b.style.setProperty('--c', b.dataset.color); b.addEventListener('click', () => drawStyle({color: b.dataset.color})); });
$('draw-color').addEventListener('input', () => drawStyle({color: $('draw-color').value}));
$('draw-dash').addEventListener('change', () => drawStyle({dash: $('draw-dash').value}));
$('draw-width').addEventListener('change', () => drawStyle({width: Number($('draw-width').value)}));
document.querySelectorAll('[data-draw]').forEach(b => b.addEventListener('click', () => whenMap(() => drawing.setMode(b.dataset.draw))));
$('draw-pan').addEventListener('click', () => drawing?.setPaused(!drawing.paused));
$('draw-undo').addEventListener('click', () => drawing?.undo());
$('draw-finish').addEventListener('click', () => drawing?.finish());
$('draw-clear').addEventListener('click', () => { if (drawing?.features.length && confirm('Delete all drawings?')) drawing.clear(); });
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
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
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
  const wanted = new Map(places.map(p => [`${p.lngLat[0]},${p.lngLat[1]},${settings.language}`, p]));
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
    polarLayer = new PolarLayer({data: new URL('./data/polar/', import.meta.url), units: () => settings.units, relief: () => settings.relief, places: showPolarPlaces, imagery: () => ['satellite','hybrid'].includes(settings.background), palette: () => settings.background});
    installPolar();
  }).catch(error => console.warn('Polar caps unavailable:', error?.message || error));
}
// Once the map object exists (drawing needs it; loading can still be under way).
function whenMap(action) { if (drawing) action(); else pendingDraw = action; }
let pendingDraw;
let locate = () => ({});
async function initialize() {
  const [, labelCode] = await Promise.all([libraries, labels]);
  const {installLabelProtocols, localizeTile, tileTextBlocks} = labelCode;
  locate = labelCode.locate;
  servedBuild = labelCode.buildInfo;
  if (!window.maplibregl || !window.pmtiles) throw new Error('Map libraries could not load. Check your connection and reload.');
  // MapLibre 5 has no top-level supported() export. The Map constructor checks
  // WebGL itself; initialization errors are caught by the handler below.
  const protocol = new pmtiles.Protocol();
  protocol.tile = shareArchiveRequests(protocol.tile.bind(protocol));
  maplibregl.addProtocol('pmtiles', protocol.tile);
  // Both the labelled basemap and bathymetry read the same PMTiles archive.
  // Create it with the timeout wrapper once, before either consumer can ask
  // Protocol.tile() to create an untimed default FetchSource for that URL.
  const basemapArchive = url => new pmtiles.PMTiles(labelCode.timedSource(new pmtiles.FetchSource(url), 20000));
  const labelProtocols = installLabelProtocols(maplibregl,protocol,fetch,{dataRoot:new URL('./data/', import.meta.url), basemapArchive, rareGlyphs:rareHanFonts.ensure});
  stationTileFor=labelProtocols?.stationTile||null;
  if(ready)updateMajorStations();
  // The contour worker with the terrain tiles' bad pixels repaired
  // (dem-worker.mjs); relief shading reads its tiles through it too.
  mlcontour.workerUrl = new URL(`vendor/dem-worker.js?v=${assetVersion}`, import.meta.url).href;
  dem = new mlcontour.DemSource({url:DEM_URL,encoding:'terrarium',maxzoom:15,worker:true,cacheSize:200,timeoutMs:20000,id:'atlas'});
  dem.setupMaplibre(maplibregl);
  // Level crossings, branch lines, service routes and signals are served as
  // stored (names not localized); the rare Han in their text still loads.
  for (const [scheme,folder,names = true] of [['railtiles','lifecycle'],['streettiles','street-running'],['crossingtiles','level-crossings',false],['branchtiles','branch-lines',false],['axlebranch','branch-lines',false],['servicetiles','service-routes',false],['signaltiles','traction/signals',false]]) {
  const lifecycleRoot = new URL(`./data/${folder}/`, import.meta.url);
  let tileIndex;
  maplibregl.addProtocol(scheme, async (params, controller) => {
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
  const heritage = createBundleReader({root:new URL('./data/heritage/', import.meta.url)});
  maplibregl.addProtocol('heritagetiles', async (params, controller) => {
    const [key,query] = params.url.slice('heritagetiles://'.length).split('?');
    if (!/^\d+\/\d+\/\d+$/.test(key)) throw new Error('Invalid historic area tile');
    const [z,x,y] = key.split('/').map(Number);
    const data = await heritage.tile(z,x,y,controller.signal);
    if (!data) return {data: new ArrayBuffer(0)};
    const found = new Set(), localized = localizeTile(data,new URLSearchParams(query).get('lang') || 'local',{z,x,y},found);
    if (found.size) await rareHanFonts.ensure(found);
    return {data: localized};
  });
  const styleURL = new URL(`world.style.json?v=${encodeURIComponent(assetVersion)}`, import.meta.url);
  const response = await fetch(styleURL);
  if (!response.ok) throw new Error('The map style could not load. Reload to try again.');
  const style = await response.json();
  // Keep the style's version-matched station copy available during the first
  // upgrade from a worker whose fixed precache does not know the new file.
  // Parsing/rendering its GeoJSON in MapLibre remains deferred to the overview.
  majorStationData=style.sources.stationMajor.data;
  style.sources.stationMajor.data={type:'FeatureCollection',features:[]};
  const waterArchive = style.sources.openmaptiles.url;
  const waterArchiveKey = waterArchive.replace(/^pmtiles:\/\//,'');
  if (waterArchiveKey !== waterArchive && !protocol.tiles.has(waterArchiveKey)) protocol.tiles.set(waterArchiveKey, basemapArchive(waterArchiveKey));
  installBathymetry(maplibregl, dem, {
    waterTile: (z, x, y, controller) => {
      // A label retry may remove the shared archive during its backoff.
      if (!protocol.tiles.has(waterArchiveKey)) protocol.tiles.set(waterArchiveKey, basemapArchive(waterArchiveKey));
      return protocol.tile({url: `${waterArchive}/${z}/${x}/${y}`, type: 'arrayBuffer'}, controller);
    },
    readTile: data => labelCode.readTile(data, ['water']),
    createWorker: () => new Worker(new URL(`vendor/depth-worker.js?v=${assetVersion}`, import.meta.url)),
  });
  for (const source of Object.values(style.sources)) {
    if (source.url?.startsWith('pmtiles://data/')) source.url = 'pmtiles://' + new URL(source.url.slice(10), styleURL).href;
  }
  // Apply language before constructing the map, avoiding an initial duplicate
  // station-tile download in the wrong language.
  // This also sets the contour sources (unitStyle). Relief and all contours
  // share one elevation loader and tile cache.
  localizeStyle(style);
  style.sources.relief.tiles = [dem.sharedDemProtocolUrl];
  // Hidden sources must stay hidden before MapLibre starts its first requests.
  for (const layer of style.layers) {
    const visible=layerVisibility(layer, settings);
    if(visible!==undefined)(layer.layout ||= {}).visibility=visible?'visible':'none';
    if (isLowZoomStationLayer(layer.id)) (layer.paint ||= {})['text-color'] = lowZoomStationTextColor();
  }
  // Reopen where the last visit ended, unless the link gives a position; start
  // on the globe (or as last left) so the first frame is not the flat map.
  const linkedView = parseViewHash(location.hash), linked = Boolean(linkedView), start = linked ? {} : rememberedView;
  const startZoom = linked ? readoutZoom(linkedView.zoom, linkedView.center[1]) : Number.isFinite(start.z) ? start.z : 1.8;
  // A centre beyond 85.05° exists only on the globe: open there, or the flat
  // map would pull it back to its edge.
  const startLat = linked ? linkedView.center[1] : Array.isArray(start.c) ? start.c[1] : 0;
  const startGlobe = Math.abs(startLat) > 85.051129 || (typeof rememberedView.g === 'boolean' ? rememberedView.g : settings.autoGlobe && startZoom - settings.detail < 4);
  style.projection = {type: startGlobe ? 'globe' : 'mercator'};
  const validCenter = Array.isArray(start.c) && start.c.length === 2 && start.c.every(Number.isFinite);
  map = new maplibregl.Map({
    container: 'map', style, localIdeographFontFamily: cjkFont(settings.language), pixelRatio: devicePixelRatio / 2 ** settings.detail,
    center: validCenter ? start.c : [15,23], zoom: Number.isFinite(start.z) ? start.z : 1.8, bearing: Number.isFinite(start.b) ? start.b : 0, pitch: Number.isFinite(start.p) ? start.p : 0, hash: false, minZoom: MIN_ZOOM + settings.detail, maxZoom: MAX_ZOOM + settings.detail,
    renderWorldCopies: true, attributionControl: false,
  });
  powerFacilities = createPowerFacilityLoader(map, {url:new URL('./data/traction/power/power-facilities.geojson',import.meta.url),
    active:()=>ready&&settings.mode==='electrification'&&settings.background!=='satellite'&&map.getZoom()>=10,
    language:()=>settings.language,localize:(data,language)=>({...data,features:data.features.map(f=>{const properties={...f.properties,...locate(...f.geometry.coordinates)};return {...f,properties:{...properties,atlas_name:chooseName(properties,language),atlas_language:language}};})}),
    glyphs:async data=>{const found=new Set();for(const f of data.features)rareHanBlocks(f.properties.atlas_name,found);if(found.size)await rareHanFonts.ensure(found);},
    fetcher:fetch,onError:error=>console.warn('Railway energy supplies unavailable:',error.message)});
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
    map.jumpTo(wanted); map.once('style.load', () => map.jumpTo(wanted));
  }
  // The view in the address (viewHash in globe-drag.mjs, in place of
  // MapLibre's own, which near a pole wrote a negative zoom and rounded the
  // latitude to 90°).
  const writeHash = () => {
    const c = map.getCenter(), hash = viewHash({zoom: map.getZoom(), lat: c.lat, lng: c.lng, bearing: map.getBearing(), pitch: map.getPitch()});
    if (hash !== location.hash) { const url = new URL(location.href); url.hash = hash; history.replaceState(history.state, '', url); }
  };
  map.on('moveend', writeHash);
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
  map.addControl(new ButtonControl([detailButton, drawButton, measureButton, polarButton]), 'top-right');
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
  measuring = new Measure(map, {units: () => settings.units, status: text => { $('measure-status').textContent = text; }, changed: updateDrawing, heights: elevation.heights});
  map.on('style.load', installDrawing);
  map.on('dblclick', event => {
    if (measuring.mode === 'distance') { event.preventDefault(); measuring.end(); }
    else if (drawing.multiPoint && !drawing.paused) { event.preventDefault(); drawing.finish(); }
  });
  const action = pendingDraw; pendingDraw = undefined; action?.();
  let recoveryRemoved = false, recoveryStatusPending = false;
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
  const otherMetadataRetries = new Map();
  document.addEventListener('visibilitychange', wakeRailRecovery);
  window.addEventListener('online', wakeRailRecovery);
  map.on('moveend', wakeRailRecovery);
  map.on('remove', () => {recoveryRemoved=true;document.removeEventListener('visibilitychange',wakeRailRecovery);window.removeEventListener('online',wakeRailRecovery);railRecovery.dispose();labelProtocols.dispose?.();});
  map.on('error', e => {
    // Panning and replacing language sources intentionally cancel old tiles.
    if (e.error?.name === 'AbortError' || /^AbortError$|operation was aborted/i.test(e.error?.message || '')) return;
    // Log text as well as the object: errors passed back from map workers
    // carry no stack, and plain logs of them show only "Error".
    console.error('Map resource error:', e.sourceId || 'map', e.error?.message || String(e.error), e.error);
    const railError = railRecovery.noteError(e);
    const id = e.sourceId || 'resource', instance = e.sourceId && map.getSource(e.sourceId), previous = errors.get(id);
    // A retryable error cannot take ownership of a nonretryable error on the
    // same source instance; pruning must not erase that independent failure.
    errors.set(id, {source:instance, recoveryOwned:railError && (!previous || previous.source !== instance || previous.recoveryOwned)});
    updateStatus();
    // Demand-driven recovery handles failed railway metadata and tiles.
    // Preserve the existing three source-metadata retries for unrelated map
    // providers. A deliberate provider 403 is not retried as an outage.
    const source=e.sourceId && !e.tile && map.getSource(e.sourceId);
    const attempt=otherMetadataRetries.get(e.sourceId)||0;
    if (!railError && source?.url && !source.url.includes(new URL(ORM).host) &&
      typeof source.setUrl==='function' && !source.loaded?.() && attempt<3) {
      otherMetadataRetries.set(e.sourceId,attempt+1);
      setTimeout(()=>{
        const current=map.getSource(e.sourceId);
        if(current?.url&&!current.loaded?.())current.setUrl(current.url);
      },[5000,15000,45000][attempt]);
    }
  });
  map.on('sourcedata', e => {
    const recovered = railRecovery.noteSourceData(e);
    // MapLibre also reports isSourceLoaded after errors settle. Require actual
    // success, and keep a source's error until all its failed tiles recover.
    const successful = e.sourceDataType === 'metadata' || e.tile?.state === 'loaded';
    let cleared = false;
    if (e.sourceId && (recovered || successful && e.isSourceLoaded) &&
      !railRecovery.failedSourceIds().includes(e.sourceId)) {
      cleared = errors.delete(e.sourceId);
      otherMetadataRetries.delete(e.sourceId);
    }
    // Refresh after BOTH recovery state and app bookkeeping change. A callback
    // inside noteSourceData would observe stale errors; idle may never arrive.
    if (recovered || cleared) updateStatus();
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
  map.on('idle', updateStatus);
  platformLengths=createPlatformLengths(map,{geometry:createPlatformTileGeometry({tileURL:()=>{const url=map.getSource('platforms')?.tiles?.[0];return url&&unwrap(url);},decode:async data=>(await labels).platformTilePieces(data,'standard_railway_platforms')}),active:()=>ready&&settings.mode==='infrastructure'&&settings.labels&&settings.background!=='satellite',onLength:(id,length)=>{if(length>0&&['platformEdges','platformLengths'].includes(currentFeature?.source)&&String(osmObject(currentFeature)?.id)===id)showDetails(currentFeature);},onPlatform:(id)=>{if(['platforms','platformNumbers'].includes(currentFeature?.source)&&String(currentFeature.properties.id)===id)showDetails(currentFeature);}});
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
  map.on('moveend', () => powerFacilities?.());
  map.on('moveend',updateMajorStations);
  // Curated names need the station source's tile address, known once its
  // TileJSON arrives (possibly after the first frame, with no move to follow).
  map.on('sourcedata',e=>{if(e.sourceId==='stations'&&e.sourceDataType==='metadata'&&!stationTileURL)updateMajorStations();});
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
fetch(new URL('./data/service-routes/frequency-manifest.json',import.meta.url)).then(r=>r.ok?r.json():null).then(manifest=>{
  if(!Array.isArray(manifest?.profiles))return;
  coveredProfiles=new Set(manifest.profiles);applyCoveredPeriods();renderLegend();
}).catch(()=>{});
for(const [id,key] of [['service-width','serviceWidth'],['frequency-period','frequencyPeriod'],['peak-phase','peakPhase'],['frequency-hour','frequencyHour']])$(id).addEventListener('change',()=>{settings[key]=key==='frequencyHour'?Number($(id).value):$(id).value;applySettings();saveSettings();if(currentFeature?.layer?.id==='service-routes')showServiceDetails(currentFeature);});
document.querySelectorAll('[data-background]').forEach(button => button.addEventListener('click', () => {
  settings.background = button.dataset.background; applySettings(); saveSettings();
}));
for (const key of CHECKBOXES) $(key).addEventListener('change', () => {
  settings[key] = $(key).checked; applySettings(); saveSettings();
  if (key === 'autoGlobe') { lastAutoProjection = undefined; updatePolar(); }
});
function reloadLanguage() {
  const appliedLanguage=settings.language;
  const style=map.getStyle();localizeStyle(style);
  ready=false;errors.clear();
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
    saveSettings();
  });
}
$('units').addEventListener('change', () => {
  settings.units = $('units').value === 'imperial' ? 'imperial' : 'metric';
  applyUnits(); updateInView(); renderLegend(); saveSettings(); drawing?.refresh(); measuring?.refresh();
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
let profileMarker, profileRequest = 0;
async function showProfile(feature) {
  const coordinates = feature.geometry.coordinates, units = settings.units, km = lengthKm(coordinates);
  const panel = $('detail-content'), request = ++profileRequest;
  const waiting = textNode('p', 'Finding heights…', 'small');
  panel.replaceChildren(textNode('div', 'DRAWN LINE', 'eyebrow'), textNode('h2', feature.properties.name || 'Elevation profile'), waiting);
  $('details').hidden = false; currentFeature = null;
  const samples = alongLine(coordinates, Math.max(20, Math.min(200, Math.round(km * 100))), lengthKm);
  const heights = await elevation.heights(samples.map(s => s.point));
  // Only if this profile is still what the panel shows: not replaced by
  // another feature's details, another profile or closed meanwhile.
  if (request !== profileRequest || !waiting.isConnected || $('details').hidden) return;
  const profile = samples.map((s, i) => ({...s, height: heights[i]})), stats = profileStats(profile);
  waiting.remove();
  if (!stats) { panel.append(textNode('p', 'The terrain tiles could not load here.', 'small')); return; }
  const height = h => units === 'imperial' ? `${Math.round(h * 3.28084).toLocaleString('en')} ft` : `${Math.round(h).toLocaleString('en')} m`;
  const ends = climb(profile[0].height, profile.at(-1).height, km);
  const dl = document.createElement('dl');
  row(dl, 'Length', formatLength(km, units)); row(dl, 'Lowest', height(stats.min)); row(dl, 'Highest', height(stats.max));
  row(dl, 'Ascent / descent', `${height(stats.ascent)} / ${height(stats.descent)}`);
  if (ends) row(dl, 'End to end', formatClimb(ends, units));
  row(dl, 'Steepest', `${(stats.steepest * 100).toFixed(1)}% (${(stats.steepest * 1000).toFixed(0)}‰) over ${formatLength(stats.over, units)}`);
  panel.append(profileChart(profile, km, units), dl, textNode('p', 'Heights from the terrain tiles (Mapzen Terrarium): ground or seabed level, not track level on bridges or in tunnels; ascent and descent include the data’s small ups and downs.', 'small'));
}
function profileChart(profile, km, units) {
  const W = 280, H = 150, L = 44, R = 8, T = 10, B = 24, ns = 'http://www.w3.org/2000/svg';
  const k = units === 'imperial' ? 3.28084 : 1, unit = units === 'imperial' ? 'ft' : 'm';
  const known = profile.filter(p => p.height !== null), values = known.map(p => p.height * k);
  let lo = Math.min(...values), hi = Math.max(...values);
  if (hi - lo < 10) { const mid = (hi + lo) / 2; lo = mid - 5; hi = mid + 5; }
  const x = at => L + (W - L - R) * at / km, y = h => T + (H - T - B) * (1 - (h * k - lo) / (hi - lo));
  const el = (name, attrs, text) => { const e = document.createElementNS(ns, name); for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v); if (text !== undefined) e.textContent = text; return e; };
  const svg = el('svg', {viewBox: `0 0 ${W} ${H}`, class: 'profile-chart', role: 'img', 'aria-label': 'Elevation along the line'});
  const line = known.map(p => `${x(p.at).toFixed(1)},${y(p.height).toFixed(1)}`).join(' ');
  svg.append(
    el('polygon', {points: `${x(known[0].at).toFixed(1)},${H - B} ${line} ${x(known.at(-1).at).toFixed(1)},${H - B}`, class: 'profile-area'}),
    el('polyline', {points: line, class: 'profile-line'}),
    el('line', {x1: L, y1: H - B, x2: W - R, y2: H - B, class: 'profile-axis'}), el('line', {x1: L, y1: T, x2: L, y2: H - B, class: 'profile-axis'}),
    el('text', {x: L - 4, y: T + 4, 'text-anchor': 'end'}, `${Math.round(hi)} ${unit}`), el('text', {x: L - 4, y: H - B, 'text-anchor': 'end'}, `${Math.round(lo)} ${unit}`),
    el('text', {x: L, y: H - 8}, '0'), el('text', {x: W - R, y: H - 8, 'text-anchor': 'end'}, formatLength(km, units)));
  const cursor = el('line', {y1: T, y2: H - B, class: 'profile-cursor', visibility: 'hidden'}), readout = el('text', {x: L + 4, y: T + 10, class: 'profile-readout'});
  svg.append(cursor, readout);
  svg.addEventListener('pointermove', event => {
    const box = svg.getBoundingClientRect(), at = Math.max(0, Math.min(km, ((event.clientX - box.left) / box.width * W - L) / (W - L - R) * km));
    const p = known.reduce((a, b) => Math.abs(b.at - at) < Math.abs(a.at - at) ? b : a);
    cursor.setAttribute('x1', x(p.at)); cursor.setAttribute('x2', x(p.at)); cursor.setAttribute('visibility', 'visible');
    readout.textContent = `${formatLength(p.at, units)} · ${Math.round(p.height * k)} ${unit}`;
    profileMarker ||= new maplibregl.Marker({element: textNode('div', '', 'profile-marker')});
    profileMarker.setLngLat(p.point).addTo(map);
  });
  svg.addEventListener('pointerleave', () => { cursor.setAttribute('visibility', 'hidden'); readout.textContent = ''; profileMarker?.remove(); });
  return svg;
}
function closeDetails() { $('details').hidden = true; currentFeature = null; profileMarker?.remove(); frequencyExpiry?.update(); }
$('details-close').addEventListener('click', closeDetails);
addEventListener('keydown', event => { if (event.key === 'Escape' && !$('details').hidden && !drawing?.active && !measuring?.active && !document.querySelector('dialog[open]')) closeDetails(); });
$('about-open').addEventListener('click', () => $('about').showModal());
$('about-close').addEventListener('click', () => $('about').close());
// The contents links scroll within the dialog; following them would replace
// the address's map position (#zoom/lat/lon) with the section's name.
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
  placeCache.set(key, items);
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
    return items;
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
    const zoom = ready ? map.getZoom() : 0;
    const drawn = ready ? drawnStationQueries(map.getStyle().layers, zoom).flatMap(({source, sourceLayer, filter}) =>
      source === 'stationMajor' ? (majorStationSearchData?.features || []).filter(f => (f.properties?.tier ?? 7) <= zoom)
        : map.getSource(source) ? map.querySourceFeatures(source, {sourceLayer, filter}) : []) : [];
    const local = ready ? tileStations(drawn, q, map.getCenter().toArray(), facilities.value || []) : [];
    if (facilities.status === 'rejected' && places.status === 'rejected' && !local.length) throw facilities.reason;
    const {rail, places: other} = searchResults([...(facilities.value || []), ...local], places.value || []);
    const results = $('search-results'); results.replaceChildren();
    const narrow = () => { results.hidden = true; $('search-status').hidden = true; if (matchMedia('(max-width: 650px)').matches && !$('controls').hidden) $('collapse').click(); };
    const entry = (title, detail, onClick) => {
      const li = document.createElement('li'); const button = document.createElement('button'); button.type = 'button';
      button.append(textNode('span', title), textNode('small', detail));
      button.addEventListener('click', () => { onClick(); narrow(); });
      li.append(button); results.append(li);
    };
    const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const item of rail) {
      try { Object.assign(item, locate(item.longitude,item.latitude)); } catch {}
      entry(displayName(item,settings.language) || item.railway_ref || 'Unnamed facility',
        [item.station || item.feature || item.railway, item.railway_ref || item['railway:ref'], Array.isArray(item.operator) ? item.operator.join(', ') : item.operator].filter(Boolean).join(' · '), () => {
          const coordinates = [item.longitude, item.latitude];
          // Before the map has loaded, go there as soon as it has.
          whenReady(() => map.flyTo({ center: coordinates, zoom: 14, duration: reduced() ? 0 : 1000 }));
          showDetails({ kind: 'station', properties: item, geometry: { type: 'Point', coordinates } });
        });
    }
    if (other.length) {
      const heading = textNode('li', 'Places · Nominatim / © OpenStreetMap contributors', 'search-heading'); heading.setAttribute('role', 'presentation'); results.append(heading);
      for (const item of other) {
        try { Object.assign(item, locate(item.longitude,item.latitude)); } catch {}
        entry(displayName(item,settings.language) || item.name, [item.place?.replaceAll('_', ' '), item.area].filter(Boolean).join(' · ').slice(0, 90), () => whenReady(() => {
          const [south, north, west, east] = item.boundingbox || [];
          if ([south, north, west, east].every(Number.isFinite) && north > south) map.fitBounds([[west, south], [east, north]], { maxZoom: 15, padding: 40, duration: reduced() ? 0 : 1000 });
          else map.flyTo({ center: [item.longitude, item.latitude], zoom: 13, duration: reduced() ? 0 : 1000 });
        }));
      }
    }
    const count = rail.length + other.length;
    results.hidden = !count;
    const unavailable = [facilities.status === 'rejected' && 'station search', places.status === 'rejected' && 'place search'].filter(Boolean);
    $('search-status').textContent = (count ? `${rail.length} railway ${rail.length === 1 ? 'result' : 'results'}, ${other.length} ${other.length === 1 ? 'place' : 'places'}` : 'No matching facility or place found. Try a local name or railway code.')
      + (unavailable.length ? ` (${unavailable.join(' and ')} unavailable)` : '');
  } catch (error) {
    if (controller !== searchController) return;
    $('search-status').textContent = 'Search is unavailable. Try again, or browse by panning and zooming.';
  } finally { clearTimeout(timeout); }
});
frequencyExpiry=installFrequencyExpiry({
  active:()=>ready&&document.visibilityState!=='hidden'&&(settings.mode==='service'||currentFeature?.layer?.id==='service-routes'),
  features:()=>[...map.querySourceFeatures('serviceRoutes',{sourceLayer:'service_routes'}),...(currentFeature?.layer?.id==='service-routes'?[currentFeature]:[])],
  refresh:()=>{
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
      const credits=attribution?._container?.querySelector('.maplibregl-ctrl-attrib-inner');if(credits)scroll.append(credits.cloneNode(true));
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

