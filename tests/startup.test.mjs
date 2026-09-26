import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import * as model from '../styles/map-model.mjs';

const html = await readFile(new URL('../styles/index.html', import.meta.url), 'utf8');
const appURL = new URL('../styles/app.mjs', import.meta.url);
const code = await readFile(appURL, 'utf8');
const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url), 'utf8'));

async function start({ failWebGL = false } = {}) {
  const dom = new JSDOM(html, {url:'https://example.org/openrailwaystyle/', runScripts:'outside-only'});
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
    setStyle(style) {this.options.style=style;this.handlers['style.load']?.();}
    addControl() {}
    addImage(id, data, options) { this.image = {id,data,options}; }
    off(name) { delete this.handlers[name]; }
    on(name, handler) { this.handlers[name] = handler; }
    getStyle() { return this.options.style; }
    getSource(id) { return {setUrl: url => {this.options.style.sources[id].url=url;},setTiles:tiles=>{this.options.style.sources[id].tiles=tiles;}}; }
    setLayoutProperty(id, property, value) { this.visibility[id] = value; }
    getZoom() { return 4; }
    queryRenderedFeatures() { return []; }
  }
  // This is the MapLibre 5 public surface used by the app. In particular,
  // supported() is absent: older Mapbox examples must not gate startup.
  window.maplibregl = {Map, addProtocol(){}, NavigationControl:class {}, ScaleControl:class {}};
  window.pmtiles = {Protocol:class { tile() {} }};
  window.mlcontour = {DemSource:class {setupMaplibre(){} contourProtocolUrl(){return 'atlas-contour://{z}/{x}/{y}';} sharedDemProtocolUrl='atlas-shared://{z}/{x}/{y}';}};
  window.fetch = async () => ({ok:true,json:async()=>structuredClone(style)});
  const context = dom.getInternalVMContext();
  const dependency = new vm.SyntheticModule(Object.keys(model), function() {
    for (const [key,value] of Object.entries(model)) this.setExport(key,value);
  }, {context});
  const app = new vm.SourceTextModule(code, {
    context,
    initializeImportMeta(meta) { meta.url = 'https://example.org/openrailwaystyle/app.mjs'; },
  });
  const protocols=new vm.SyntheticModule(['installLabelProtocols','localizeTile','locate'],function(){this.setExport('installLabelProtocols',()=>{});this.setExport('localizeTile',x=>x);this.setExport('locate',()=>({atlas_han:'none',atlas_zh:''}));},{context});
  await app.link(specifier=>specifier.includes('tile-labels')?protocols:dependency);
  await app.evaluate();
  await new Promise(resolve => setTimeout(resolve,0));
  return {dom,window,maps,errors};
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
    assert.match(window.location.search, /language=ko/);
    assert.equal(window.document.getElementById('region'),null);
    const former = window.document.getElementById('inactive');
    former.checked = false; former.dispatchEvent(new window.Event('change'));
    assert.equal(maps[0].visibility['inactive-railways'],'none');
    assert.equal(maps[0].visibility['inactive-regional'],'none');
  } finally {dom.window.close();}
});
test('real renderer initialization failures reach the visible error message', async () => {
  const {dom,window,errors} = await start({failWebGL:true});
  try {
    assert.equal(errors.length,1);
    assert.match(window.document.getElementById('map-status').textContent,/could not start WebGL/);
    assert.equal(window.document.body.dataset.mapReady,undefined);
  } finally {dom.window.close();}
});
