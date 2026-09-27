import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import * as model from '../styles/map-model.mjs';
import * as draw from '../styles/draw.mjs';

const html = await readFile(new URL('../styles/index.html', import.meta.url), 'utf8');
const appURL = new URL('../styles/app.mjs', import.meta.url);
const code = await readFile(appURL, 'utf8');
const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url), 'utf8'));

async function start({ failWebGL = false, delayLibraries = false, search = '', cookie = '' } = {}) {
  const dom = new JSDOM(html, {url:`https://example.org/openrailwaystyle/${search}`, runScripts:'outside-only'});
  if (cookie) dom.window.document.cookie = `${cookie}; path=/`;
  const window = dom.window;
  const errors = [], maps = [];
  window.console.error = error => errors.push(error);
  class Map {
    constructor(options) {
      if (failWebGL) throw new Error('Failed to initialize WebGL');
      this.options = options; this.handlers = {}; this.visibility = {};
      maps.push(this);
    }
    once(name,handler) {this.handlers[name]=handler;}
    setStyle(style, options) {this.options.style=style;this.styleOptions=options;this.handlers['style.load']?.();}
    addControl(control) { (this.controls ||= []).push(control); }
    addImage(id, data, options) { this.image = {id,data,options}; }
    off(name) { delete this.handlers[name]; }
    on(name, handler) { this.handlers[name] = handler; }
    getStyle() { return this.options.style; }
    getSource(id) { return {setData(){},setUrl: url => {this.options.style.sources[id].url=url;},setTiles:tiles=>{this.options.style.sources[id].tiles=tiles;}}; }
    setLayoutProperty(id, property, value) { if (property === 'visibility') this.visibility[id] = value; else (this.layout ||= {})[id] = value; }
    setPaintProperty(id, property, value) { (this.paint ||= {})[id] = value; }
    setPixelRatio(ratio) { this.pixelRatio = ratio; }
    zoom = 20;
    getZoom() { return this.zoom; }
    setMinZoom(z) { this.minZoom = z; this.zoom = Math.max(this.zoom, z); }
    setMaxZoom(z) { this.maxZoom = z; this.zoom = Math.min(this.zoom, z); }
    jumpTo(options) { this.zoom = Math.min(Math.max(options.zoom, this.minZoom ?? -Infinity), this.maxZoom ?? Infinity); }
    getLayer() {}
    addLayer(layer) { (this.added ||= []).push(layer.id); }
    addSource() {}
    getCanvas() { return {style:{}}; }
    doubleClickZoom = {enable(){}, disable(){}};
    queryRenderedFeatures() { return []; }
  }
  // This is the MapLibre 5 public surface used by the app. In particular,
  // supported() is absent: older Mapbox examples must not gate startup.
  const libraries = {};
  libraries.maplibregl = {Map, addProtocol(){}, NavigationControl:class { constructor(options) { maps.controls.push(options); } }, ScaleControl:class { constructor(options) { this.unit = options.unit; maps.scale = this; } setUnit(unit) { this.unit = unit; } }};
  maps.controls = [];
  libraries.pmtiles = {Protocol:class { tile() {} }};
  libraries.mlcontour = {DemSource:class {setupMaplibre(){} contourProtocolUrl(options){return `atlas-contour://${options.multiplier ? 'ft' : 'm'}/{z}/{x}/{y}`;} sharedDemProtocolUrl='atlas-shared://{z}/{x}/{y}';}};
  // Delayed libraries are provided later by loadLibraries().
  const loadLibraries = () => {
    Object.assign(window, libraries);
    for (const script of window.document.head.querySelectorAll('script')) script.onload?.();
  };
  if (!delayLibraries) Object.assign(window, libraries);
  window.fetch = async () => ({ok:true,json:async()=>structuredClone(style)});
  const context = dom.getInternalVMContext();
  const dependency = new vm.SyntheticModule(Object.keys(model), function() {
    for (const [key,value] of Object.entries(model)) this.setExport(key,value);
  }, {context});
  const protocols=new vm.SyntheticModule(['installLabelProtocols','localizeTile','locate'],function(){this.setExport('installLabelProtocols',()=>{});this.setExport('localizeTile',x=>x);this.setExport('locate',()=>({atlas_han:'none',atlas_zh:''}));},{context});
  // The label code is imported on demand, after the controls are wired.
  const app = new vm.SourceTextModule(code, {
    context,
    initializeImportMeta(meta) { meta.url = 'https://example.org/openrailwaystyle/app.mjs'; },
    importModuleDynamically: async specifier => {
      if (!specifier.includes('tile-labels')) throw new Error(`Unexpected import ${specifier}`);
      if (protocols.status === 'unlinked') await protocols.link(() => {});
      if (protocols.status === 'linked') await protocols.evaluate();
      return protocols;
    },
  });
  const drawing = new vm.SyntheticModule(Object.keys(draw), function() {
    for (const [key,value] of Object.entries(draw)) this.setExport(key,value);
  }, {context});
  await app.link(specifier => specifier.includes('draw.mjs') ? drawing : dependency);
  await app.evaluate();
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve,0));
  return {dom,window,maps,errors,loadLibraries};
}

test('app starts with the MapLibre 5 API and enables map controls', async () => {
  const {dom,window,maps,errors} = await start();
  try {
    assert.equal(maps.length,1,'startup must reach the map constructor');
    assert.equal(errors.length,0);
    assert.equal(maps[0].options.style.sources.inactiveRegional.tiles[0],'railtiles://{z}/{x}/{y}?lang=local');
    maps[0].handlers.styleimagemissing({id:'station-dot'});
    assert.equal(maps[0].image.id,'station-dot');
    assert.equal(maps[0].image.data.data.length,32*32*4);
    maps[0].handlers.load();
    assert.equal(window.document.body.dataset.mapReady,'true');
    assert.equal(maps[0].visibility['speed-tracks'],'visible');
    maps[0].handlers.error({error:{name:'AbortError',message:'AbortError'}});
    assert.equal(window.document.getElementById('map-status').classList.contains('error'),false);
    assert.equal(errors.length,0);
    window.document.querySelector('[data-mode="infrastructure"]').click();
    assert.equal(maps[0].visibility['speed-tracks'],'none');
    assert.equal(maps[0].visibility['infrastructure-tracks'],'visible');
    assert.equal(maps[0].visibility['station-stations-dots'],'visible');
    const language = window.document.getElementById('language');
    language.value='ko'; language.dispatchEvent(new window.Event('change'));
    assert.match(maps[0].options.style.sources.stations.url, /atlasstation:\/\/ko\//);
    assert.equal(window.location.search, '', 'settings stay out of the address');
    assert.match(decodeURIComponent(window.document.cookie), /atlas_settings=\{[^;]*"language":"ko"/);
    assert.equal(window.document.getElementById('region'),null);
    const former = window.document.getElementById('inactive');
    former.checked = false; former.dispatchEvent(new window.Event('change'));
    assert.equal(maps[0].visibility['inactive-railways'],'none');
    assert.equal(maps[0].visibility['inactive-regional'],'none');
  } finally {dom.window.close();}
});
test('controls work while the map is still loading, and settings take effect once it loads', async () => {
  const {dom,window,maps,errors,loadLibraries} = await start({delayLibraries:true});
  try {
    assert.equal(maps.length,0,'the map waits for its libraries');
    assert.equal(window.document.head.querySelectorAll('script').length,3,'libraries load from the app, not blocking the page');
    window.document.querySelector('[data-mode="electrification"]').click();
    assert.equal(window.document.querySelector('[data-mode="electrification"]').getAttribute('aria-pressed'),'true');
    const units = window.document.getElementById('units');
    units.value = 'imperial'; units.dispatchEvent(new window.Event('change'));
    window.document.querySelector('[data-mode="speed"]').click();
    assert.match(window.document.getElementById('legend').textContent,/mph.*< 25/);
    window.document.querySelector('[data-mode="electrification"]').click();
    assert.match(decodeURIComponent(window.document.cookie),/"units":"imperial"/);
    const language = window.document.getElementById('language');
    language.value='zh-Hans'; language.dispatchEvent(new window.Event('change'));
    loadLibraries();
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve,0));
    assert.equal(maps.length,1);
    assert.equal(errors.length,0);
    const map = maps[0];
    assert.match(map.options.style.sources.stations.url,/atlasstation:\/\/zh-Hans\//);
    assert.match(map.options.localIdeographFontFamily,/SC/,'Simplified Chinese labels use one Simplified Chinese font');
    assert.match(map.options.style.sources.contours.tiles[0],/\/ft\//);
    assert.equal(maps.scale.unit,'imperial');
    assert.deepEqual(maps.controls.slice(0,2).map(c=>[c.showZoom,c.showCompass]),[[false,true],[undefined,false]],'compass above the zoom buttons');
    map.handlers.load();
    assert.equal(map.visibility['electrification-tracks'],'visible');
    units.value = 'metric'; units.dispatchEvent(new window.Event('change'));
    assert.equal(maps.scale.unit,'metric');
    assert.match(JSON.stringify(map.layout['terrain-contour-labels']),/ m"/);
    language.value='zh-Hant'; language.dispatchEvent(new window.Event('change'));
    assert.match(map.styleOptions.localIdeographFontFamily,/TC/);
  } finally {dom.window.close();}
});
test('more detail draws the next zoom level at half size', async () => {
  const {dom,window,maps} = await start({search:'?detail=1'});
  try {
    assert.equal(window.document.getElementById('map').classList.contains('detail'),true);
    assert.equal(maps[0].options.pixelRatio,(window.devicePixelRatio||1)/2,'the canvas keeps its pixel count');
    maps[0].handlers.load();
    assert.ok(maps[0].added.includes('drawing-line'),'drawing layers are installed with the map');
    // Toggling at the zoom limit keeps the viewport: the range shifts by one.
    const map = maps[0];
    assert.deepEqual([map.options.minZoom,map.options.maxZoom],[2,21]);
    const detail = map.controls.find(c => c.onAdd && c.buttons).onAdd().querySelector('button[title^="More detail"]');
    map.zoom = 21;
    detail.click();
    assert.equal(window.document.getElementById('map').classList.contains('detail'),false);
    assert.deepEqual([map.zoom,map.minZoom,map.maxZoom],[20,1,20]);
    detail.click();
    assert.deepEqual([map.zoom,map.minZoom,map.maxZoom],[21,2,21]);
    map.zoom = 2; detail.click();
    assert.equal(map.zoom,1);
  } finally {dom.window.close();}
});
test('settings are remembered in a cookie; a shared link applies once and leaves the address', async () => {
  // The older language-only cookie still applies.
  for (const [search, expected] of [['', 'ja'], ['?language=ru', 'ru']]) {
    const {dom,maps} = await start({search, cookie:'atlas_language=ja'});
    try { assert.match(maps[0].options.style.sources.stations.url, new RegExp(`atlasstation://${expected}/`)); }
    finally {dom.window.close();}
  }
  const saved = encodeURIComponent(JSON.stringify({mode:'electrification', relief:false, units:'imperial', detail:true, language:'ko'}));
  {
    const {dom,window,maps} = await start({cookie:`atlas_settings=${saved}`});
    try {
      assert.match(maps[0].options.style.sources.stations.url, /atlasstation:\/\/ko\//);
      assert.equal(window.document.querySelector('[data-mode="electrification"]').getAttribute('aria-pressed'),'true');
      assert.equal(window.document.getElementById('relief').checked,false);
      assert.equal(window.document.getElementById('units').value,'imperial');
      assert.equal(window.document.getElementById('map').classList.contains('detail'),true);
    } finally {dom.window.close();}
  }
  {
    const {dom,window,maps} = await start({search:'?mode=infrastructure&language=fr&v=1', cookie:`atlas_settings=${saved}`});
    try {
      assert.match(maps[0].options.style.sources.stations.url, /atlasstation:\/\/fr\//, 'a link wins over the cookie');
      assert.equal(window.location.search, '?v=1', 'setting parameters are removed from the address; others stay');
      const cookie = JSON.parse(decodeURIComponent(window.document.cookie).match(/atlas_settings=([^;]*)/)[1]);
      assert.deepEqual([cookie.mode, cookie.language, cookie.units], ['infrastructure','fr','imperial']);
    } finally {dom.window.close();}
  }
});
test('real renderer initialization failures reach the visible error message', async () => {
  const {dom,window,errors} = await start({failWebGL:true});
  try {
    assert.equal(errors.length,1);
    assert.match(window.document.getElementById('map-status').textContent,/could not start WebGL/);
    assert.equal(window.document.body.dataset.mapReady,undefined);
  } finally {dom.window.close();}
});
