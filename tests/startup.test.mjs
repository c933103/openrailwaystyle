import test from 'node:test';
import * as labelModule from '../styles/tile-labels.mjs';
import encodeTile from 'vt-pbf';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import * as model from '../styles/map-model.mjs';
import * as draw from '../styles/draw.mjs';
import * as departuresModule from '../styles/departures.mjs';
import * as elevationModule from '../styles/elevation.mjs';
import * as contextFeatures from '../styles/context.mjs';
import * as powerFacilities from '../styles/power-facilities.mjs';
import * as controlFunctions from '../styles/map-controls.mjs';
import * as watchModule from '../styles/watch-map.mjs';
import * as layerSemantics from '../styles/layer-semantics.mjs';

const html = await readFile(new URL('../styles/index.html', import.meta.url), 'utf8');
const appURL = new URL('../styles/app.mjs', import.meta.url);
const code = await readFile(appURL, 'utf8');
const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url), 'utf8'));

async function start({ failWebGL = false, delayLibraries = false, delayLabels = false, fetcher, search = '', cookie = '', compact = false, labelBuild, assetQuery = '', stationTile } = {}) {
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
    removeControl(control) { this.controls = this.controls.filter(c => c !== control); }
    addControl(control) { (this.controls ||= []).push(control); }
    addImage(id, data, options) { this.image = {id,data,options}; }
    off(name, handler) {
      if (!handler) { delete this.handlers[name]; delete this.listeners?.[name]; return; }
      this.listeners?.[name]?.delete(handler);
    }
    on(name, handler) {
      const listeners=(this.listeners ||= {})[name] ||= new Set();listeners.add(handler);
      this.handlers[name]=(...args)=>{for(const listener of [...listeners])listener(...args);};
    }
    getStyle() { return this.options.style; }
    getSource(id) { return (this.sources ||= {})[id] ||= {setData:data=>{(this.sourceData ||= {})[id]=data;},setUrl:url=>{this.options.style.sources[id].url=url;},setTiles:tiles=>{this.options.style.sources[id].tiles=tiles;}}; }
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
    getCanvas() { return this.canvas ||= {style:{}}; }
    getCanvasContainer() { return this.canvasContainer ||= window.document.createElement('div'); }
    doubleClickZoom = {enable:()=>{this.doubleClickEnabled=true;}, disable:()=>{this.doubleClickEnabled=false;}};
    queryRenderedFeatures(geometry, options) {const {layers}=options||geometry||{};return (this.rendered||[]).filter(f=>!layers||layers.includes(f.layer?.id));}
    querySourceFeatures(id,{sourceLayer}) { return (this.sourceFeatures || []).filter(f=>f.sourceLayer===sourceLayer); }
    isSourceLoaded() { return true; }
    projection = {type:'mercator'};
    getProjection() { return this.projection; }
    setProjection(projection) { this.projection = projection; }
    getContainer() { return {clientWidth:1000, clientHeight:700}; }
    getCenter() { return {lng:0, lat:0}; }
    getBearing() { return 0; }
    getPitch() { return 0; }
    unproject() { return {lng:0, lat:0}; }
  }
  // This is the MapLibre 5 public surface used by the app. In particular,
  // supported() is absent: older Mapbox examples must not gate startup.
  const libraries = {};
  libraries.maplibregl = {Map, addProtocol(){}, NavigationControl:class { constructor(options) { maps.controls.push(options); } }, GeolocateControl:class { constructor(options) { maps.controls.push(options); } }, AttributionControl:class {constructor(options){this.options=options;}}, ScaleControl:class { constructor(options) { this.unit = options.unit; maps.scale = this; } setUnit(unit) { this.unit = unit; } }};
  maps.controls = [];
  libraries.pmtiles = {Protocol:class { tile() {} }};
  libraries.mlcontour = {DemSource:class {constructor(options){this.options=options; (maps.dems ||= []).push(options);} setupMaplibre(){} contourProtocolUrl(options){return `${this.options.id}-contour://${options.multiplier ? 'ft' : 'm'}/{z}/{x}/{y}`;} sharedDemProtocolUrl='atlas-shared://{z}/{x}/{y}';}};
  // Delayed libraries are provided later by loadLibraries().
  const loadLibraries = () => {
    Object.assign(window, libraries);
    for (const script of window.document.head.querySelectorAll('script')) script.onload?.();
  };
  if (!delayLibraries) Object.assign(window, libraries);
  window.fetch = fetcher || (async () => ({ok:true,json:async()=>structuredClone(style)}));
  window.matchMedia = () => ({matches:compact});
  const context = dom.getInternalVMContext();
  const dependency = new vm.SyntheticModule(Object.keys(model), function() {
    for (const [key,value] of Object.entries(model)) this.setExport(key,value);
  }, {context});
  const protocols=new vm.SyntheticModule(['installLabelProtocols','localizeTile','locate','buildInfo','readTile'],function(){this.setExport('buildInfo',labelBuild);this.setExport('readTile',labelModule.readTile);this.setExport('installLabelProtocols',()=>stationTile?{stationTile}:undefined);this.setExport('localizeTile',x=>x);this.setExport('locate',(lon,lat)=>{assert.ok(Number.isFinite(lon)&&Number.isFinite(lat),'label region lookup takes longitude and latitude separately');return {atlas_han:'none',atlas_zh:''};});},{context});
  // The label code is imported on demand, after the controls are wired.
  let loadLabels;
  const labelsReady=new Promise(resolve=>{loadLabels=resolve;});
  if(!delayLabels)loadLabels();
  const app = new vm.SourceTextModule(code, {
    context,
    initializeImportMeta(meta) { meta.url = 'https://example.org/openrailwaystyle/app.mjs'+assetQuery; },
    importModuleDynamically: async specifier => {
      await labelsReady;
      if (!specifier.includes('tile-labels')) throw new Error(`Unexpected import ${specifier}`);
      if (protocols.status === 'unlinked') await protocols.link(() => {});
      if (protocols.status === 'linked') await protocols.evaluate();
      return protocols;
    },
  });
  const drawing = new vm.SyntheticModule(Object.keys(draw), function() {
    for (const [key,value] of Object.entries(draw)) this.setExport(key,value);
  }, {context});
  const elevation = new vm.SyntheticModule(Object.keys(elevationModule), function() {
    for (const [key,value] of Object.entries(elevationModule)) this.setExport(key,value);
  }, {context});
  // Departures without the network: no timetable covers any station here.
  const departures = new vm.SyntheticModule(Object.keys(departuresModule), function() {
    for (const [key,value] of Object.entries(departuresModule)) this.setExport(key, key === 'stationDepartures' ? async () => ({stops: [], rows: []}) : value);
  }, {context});
  const globe = new vm.SyntheticModule(['installGlobeDrag','allowPolarCentres','readoutZoom'], function() { this.setExport('installGlobeDrag', () => ({sync() {}, justDragged: () => false})); this.setExport('allowPolarCentres', () => ({refresh() {}}));this.setExport('readoutZoom',zoom=>zoom);  }, {context});
  const keyboard = new vm.SyntheticModule(['installKeyboardPan'], function() { this.setExport('installKeyboardPan', () => {}); }, {context});
  const contextModule = new vm.SyntheticModule(Object.keys(contextFeatures),function() {
    for (const [key,value] of Object.entries(contextFeatures)) this.setExport(key,value);
  },{context});
  const powerModule = new vm.SyntheticModule(Object.keys(powerFacilities),function() {
    for (const [key,value] of Object.entries(powerFacilities)) this.setExport(key,value);
  },{context});
  const semantics = new vm.SyntheticModule(Object.keys(layerSemantics), function() {
    for (const [key,value] of Object.entries(layerSemantics)) this.setExport(key,value);
  }, {context});
  const mapControls = new vm.SyntheticModule(Object.keys(controlFunctions), function() {
    for (const [key,value] of Object.entries(controlFunctions)) this.setExport(key,value);
  }, {context});
  const watch = new vm.SyntheticModule(Object.keys(watchModule),function(){for(const [key,value] of Object.entries(watchModule))this.setExport(key,value);},{context});
  await app.link(specifier => specifier.includes('watch-map.mjs') ? watch : specifier.includes('map-controls.mjs') ? mapControls : specifier.includes('layer-semantics.mjs') ? semantics : specifier.includes('context.mjs') ? contextModule : specifier.includes('power-facilities.mjs') ? powerModule : specifier.includes('draw.mjs') ? drawing : specifier.includes('elevation.mjs') ? elevation : specifier.includes('departures.mjs') ? departures : specifier.includes('globe-drag.mjs') ? globe : specifier.includes('keyboard-pan.mjs') ? keyboard : dependency);
  await app.evaluate();
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve,0));
  return {dom,window,maps,errors,loadLibraries,loadLabels};
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
    maps[0].handlers['style.load']();
    assert.equal(window.document.body.dataset.mapReady,'true');
    // The Infrastructure view on a first visit, from the first frame.
    assert.equal(maps[0].options.style.layers.find(l => l.id === 'speed-tracks').layout.visibility,'none');
    assert.equal(maps[0].visibility['infrastructure-tracks'],'visible');
    assert.equal(maps[0].visibility['speed-tracks'],'none');
    maps[0].handlers.error({error:{name:'AbortError',message:'AbortError'}});
    assert.equal(window.document.getElementById('map-status').classList.contains('error'),false);
    assert.equal(errors.length,0);
    window.document.querySelector('[data-mode="speed"]').click();
    assert.equal(maps[0].visibility['speed-tracks'],'visible');
    window.document.querySelector('[data-mode="infrastructure"]').click();
    assert.equal(maps[0].visibility['speed-tracks'],'none');
    assert.equal(maps[0].visibility['infrastructure-tracks'],'visible');
    assert.equal(maps[0].visibility['station-stations-dots'],'visible');
    const importanceColours = window.document.getElementById('stationImportanceColors');
    assert.equal(importanceColours.checked,false,'low-zoom importance colours are off by default');
    const uniformLowZoom=['step',['zoom'],'#123e52',7,['match',['get','station_size'],'large','#123e52','#0865c0']];
    assert.equal(JSON.stringify(maps[0].paint['station-major-3-names']),JSON.stringify(uniformLowZoom));
    assert.equal(JSON.stringify(maps[0].paint['station-stationLow-large-names']),JSON.stringify(uniformLowZoom));
    assert.equal(JSON.stringify(maps[0].paint['station-stationMed-normal-names']),JSON.stringify(uniformLowZoom));
    importanceColours.checked = true; importanceColours.dispatchEvent(new window.Event('change'));
    const importance=['match',['get','station_size'],'large','#123e52','#0865c0'];
    assert.equal(JSON.stringify(maps[0].paint['station-major-3-names']),JSON.stringify(importance));
    assert.equal(JSON.stringify(maps[0].paint['station-stationLow-large-names']),JSON.stringify(importance));
    assert.equal(JSON.stringify(maps[0].paint['station-stationMed-normal-names']),JSON.stringify(importance));
    assert.match(decodeURIComponent(window.document.cookie),/"stationImportanceColors":true/);
    assert.equal(JSON.stringify(maps[0].options.style.layers.find(l=>l.id==='station-detail-large-names').paint['text-color']),JSON.stringify(importance),'detailed station colours are unchanged');
    // Track-count boxes can be switched off.
    assert.equal(maps[0].visibility['infrastructure-track-count'],'visible');
    const counts = window.document.getElementById('trackCounts');
    counts.checked = false; counts.dispatchEvent(new window.Event('change'));
    assert.equal(maps[0].visibility['infrastructure-track-count'],'none');
    assert.equal(maps[0].visibility['infrastructure-station-tracks'],'none');
    counts.checked = true; counts.dispatchEvent(new window.Event('change'));
    // Satellite: the imagery alone; hybrid: imagery under the railways; the
    // map brings everything back.
    window.document.querySelector('[data-background="satellite"]').click();
    assert.deepEqual(['satellite','water','infrastructure-tracks','station-stations-dots'].map(id => maps[0].visibility[id]), ['visible','none','none','none']);
    window.document.querySelector('[data-background="hybrid"]').click();
    assert.deepEqual(['satellite','water','terrain-relief','infrastructure-tracks','station-stations-dots'].map(id => maps[0].visibility[id]), ['visible','none','none','visible','visible']);
    window.document.querySelector('[data-background="map"]').click();
    assert.deepEqual(['satellite','water','terrain-relief','infrastructure-tracks','structure-bridge-edge'].map(id => maps[0].visibility[id]), ['none','visible','visible','visible','visible']);
    const language = window.document.getElementById('language');
    language.value='ko'; language.dispatchEvent(new window.Event('change'));
    assert.match(maps[0].options.style.sources.stations.url, /atlasstation:\/\/ko\//);
    assert.equal(window.location.search, '', 'settings stay out of the address');
    assert.match(decodeURIComponent(window.document.cookie), /atlas_settings=\{[^;]*"language":"ko"/);
    assert.equal(window.document.getElementById('region'),null);
    const former = window.document.getElementById('inactive');
    former.checked = false; former.dispatchEvent(new window.Event('change'));
    for (const state of ['construction','proposed','disused','former']) {
      assert.equal(maps[0].visibility[`inactive-railways-${state}`],'none');
      assert.equal(maps[0].visibility[`inactive-regional-${state}`],'none');
    }
    assert.equal(maps[0].visibility['inactive-bridge-edge'],'none');
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
    assert.equal(map.options.style.sources.railway.url,'atlasrail://https://openrailwaymap.app/railway_line_high','railway tiles gain track counts');
    assert.match(map.options.localIdeographFontFamily,/SC/,'Simplified Chinese labels use one Simplified Chinese font');
    assert.match(map.options.style.sources.contours.tiles[0],/\/ft\//);
    // Relief and every contour source share one elevation loader.
    assert.deepEqual(maps.dems.map(d => d.id), ['atlas']);
    assert.match(map.options.style.sources.seabedContours.tiles[0],/^atlas-contour:\/\/ft\//);
    assert.match(map.options.style.sources.seabedContoursClose.tiles[0],/^atlas-contour:\/\/ft\//);
    assert.equal(maps.scale.unit,'imperial');
    assert.deepEqual(maps.controls.slice(0,2).map(c=>[c.showZoom,c.showCompass]),[[false,true],[undefined,false]],'compass above the zoom buttons');
    map.handlers['style.load']();
    assert.equal(map.visibility['electrification-tracks'],'visible');
    units.value = 'metric'; units.dispatchEvent(new window.Event('change'));
    assert.equal(maps.scale.unit,'metric');
    assert.match(JSON.stringify(map.layout['terrain-contour-labels']),/ m"/);
    language.value='zh-Hant'; language.dispatchEvent(new window.Event('change'));
    assert.match(map.styleOptions.localIdeographFontFamily,/TC/);
  } finally {dom.window.close();}
});
test('more detail cycles: the next zoom level at half size, two levels at a quarter, then normal', async () => {
  const {dom,window,maps} = await start({search:'?detail=1'});
  try {
    const frame = window.document.getElementById('map');
    assert.equal(frame.classList.contains('detail'),true);
    assert.equal(maps[0].options.pixelRatio,(window.devicePixelRatio||1)/2,'the canvas keeps its pixel count');
    maps[0].handlers['style.load']();
    assert.ok(maps[0].added.includes('drawing-line'),'drawing layers are installed with the map');
    // Changing level at the zoom limit keeps the viewport: the range shifts.
    const map = maps[0];
    assert.deepEqual([map.options.minZoom,map.options.maxZoom],[2,21]);
    const detail = map.controls.find(c => c.onAdd && c.buttons).onAdd().querySelector('button[title^="More detail"]');
    assert.match(detail.title,/drawn at 50%\. Click for 25%/,'the title gives the scale now and next');
    map.zoom = 21;
    detail.click();
    assert.deepEqual([frame.classList.contains('detail'),frame.classList.contains('detail-2')],[true,true]);
    assert.deepEqual([map.zoom,map.minZoom,map.maxZoom],[22,3,22]);
    assert.equal(map.pixelRatio,(window.devicePixelRatio||1)/4);
    assert.match(detail.title,/drawn at 25%\. Click for 100%/);
    detail.click();
    assert.equal(frame.classList.contains('detail'),false);
    assert.deepEqual([map.zoom,map.minZoom,map.maxZoom],[20,1,20]);
    assert.match(detail.title,/drawn at 100%\. Click for 50%/);
    detail.click();
    assert.deepEqual([map.zoom,map.minZoom,map.maxZoom],[21,2,21]);
    detail.click(); detail.click();
    map.zoom = 1; detail.click();
    assert.deepEqual([map.zoom,map.minZoom],[2,2]);
    detail.click();
    assert.equal(map.zoom,3);
    detail.click();
    assert.equal(map.zoom,1,'back to normal from the lowest zoom');
  } finally {dom.window.close();}
});
test('settings are remembered in a cookie; a shared link applies once and leaves the address', async () => {
  // The older language-only cookie still applies.
  for (const [search, expected] of [['', 'ja'], ['?language=ru', 'ru']]) {
    const {dom,maps} = await start({search, cookie:'atlas_language=ja'});
    try { assert.match(maps[0].options.style.sources.stations.url, new RegExp(`atlasstation://${expected}/`)); }
    finally {dom.window.close();}
  }
  const saved = encodeURIComponent(JSON.stringify({mode:'electrification', relief:false, stationImportanceColors:true, units:'imperial', detail:true, language:'ko'}));
  {
    const {dom,window,maps} = await start({cookie:`atlas_settings=${saved}`});
    try {
      assert.match(maps[0].options.style.sources.stations.url, /atlasstation:\/\/ko\//);
      assert.equal(window.document.querySelector('[data-mode="electrification"]').getAttribute('aria-pressed'),'true');
      assert.equal(window.document.getElementById('relief').checked,false);
      assert.equal(window.document.getElementById('stationImportanceColors').checked,true);
      assert.equal(JSON.stringify(maps[0].options.style.layers.find(l=>l.id==='station-major-3-names').paint['text-color']),JSON.stringify(['match',['get','station_size'],'large','#123e52','#0865c0']),'saved importance colours apply before first render');
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
test('curated hubs take their names from the provider station tiles by OSM identity, without OSM API requests',async()=>{
 const penn=style.sources.stationMajor.data.features.find(f=>f.properties.wikidata==='Q54451');
 const [first,alias]=penn.properties.osm_ids.split(';').concat([penn.properties.id]);
 const requests=[],tileRequests=[];
 const fetcher=async url=>{requests.push(String(url));return {ok:true,status:200,json:async()=>structuredClone(style)};};
 // The provider names its grouped station after one member; here an alias.
 const member=(alias||first).replace(/^(node|way|relation)-/, '$1-');
 const stationTile=async(url,lang)=>{tileRequests.push([url,lang]);
  const feature=(id,name,x)=>({type:1,id:x,tags:{id,name,atlas_name:`${name} (${lang})`,atlas_language:lang},geometry:[[2048+x,2048]]});
  const result=encodeTile.fromGeojsonVt({standard_railway_text_stations:{features:[feature(`${member}-train-train-station`,'Provider Penn',1),feature('node-1-train-train-station','Elsewhere',2)]}},{version:2});
  return result.buffer.slice(result.byteOffset,result.byteOffset+result.byteLength);};
 const {dom,maps}=await start({search:'?language=en#3/40.75/-74',fetcher,stationTile});
 try{
  const map=maps[0],source=map.getSource.bind(map);
  map.getSource=id=>id==='stations'?{tiles:['atlasstation://en/https://tiles.test/stations/{z}/{x}/{y}']}:source(id);
  // New York two world copies east: the hub must still count as in view.
  map.getBounds=()=>({getWest:()=>640,getEast:()=>650,getSouth:()=>35,getNorth:()=>45});
  map.handlers['style.load']();
  for(let i=0;i<50&&!map.sourceData?.stationMajor?.features.length;i++)await new Promise(r=>setTimeout(r,0));
  const named=map.sourceData?.stationMajor?.features.find(f=>f.properties.wikidata==='Q54451');
  assert.ok(named,'the curated hub in view is named');
  assert.equal(named.properties.atlas_name,'Provider Penn (en)');
  assert.ok(tileRequests.every(([url,lang])=>/^https:\/\/tiles\.test\/stations\/(8|10)\/\d+\/\d+$/.test(url)&&lang==='en'),'zoom-8 station tiles through the station pipeline');
  assert.ok(!requests.some(url=>url.includes('openstreetmap.org')),'no OSM API requests');
  assert.ok(map.sourceData.stationMajor.features.every(f=>f.properties.atlas_name),'unnamed hubs stay hidden rather than showing a source note');
 }finally{dom.window.close();}
});

test('real renderer initialization failures reach the visible error message', async () => {
  const {dom,window,errors} = await start({failWebGL:true});
  try {
    assert.equal(errors.length,1);
    assert.match(window.document.getElementById('map-status').textContent,/could not start WebGL/);
    assert.equal(window.document.body.dataset.mapReady,undefined);
  } finally {dom.window.close();}
});


test('station inspection finds nearby interchanges and facility inspection avoids railway fields', async () => {
  const {dom,window,maps,errors}=await start();
  try {
    const map=maps[0];map.handlers['style.load']();map.zoom=14;
    const station={source:'stations',sourceLayer:'standard_railway_text_stations',layer:{id:'station-detail-large-names'},properties:{name:'Central',station_size:'large',state:'present'},geometry:{type:'Point',coordinates:[0,0]}};
    const bus={id:123,source:'openmaptiles',sourceLayer:'poi',layer:{id:'context-transport-bus-label'},properties:{name:'Central Bus Interchange',class:'bus',subclass:'bus_station'},geometry:{type:'Point',coordinates:[0.001,0]}};
    map.sourceFeatures=[bus,bus];map.rendered=[station];
    map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
    const nearby=window.document.getElementById('nearby-transport');
    assert.match(nearby.textContent,/Central Bus Interchange/);
    assert.match(nearby.textContent,/110 m/);
    assert.match(nearby.textContent,/not verified/);
    assert.equal(nearby.querySelectorAll('li').length,1);
    await new Promise(resolve => setTimeout(resolve, 0));
    const board = window.document.querySelector('#detail-content .departures');
    assert.match(board.textContent, /No published timetable covers this station/);
    assert.match(board.querySelector('.departure-links a').href, /^https:\/\/api\.transitous\.org\/\?fromPlace=/);
    assert.equal([...board.querySelectorAll('a')].at(-1).href, 'https://transitous.org/sources/');
    map.rendered=[bus];map.handlers.click({point:{x:500,y:400},lngLat:{lng:0.001,lat:0}});
    const detail=window.document.getElementById('detail-content');
    assert.match(detail.textContent,/TRANSPORT FACILITY/);
    assert.doesNotMatch(detail.textContent,/Speed|Not recorded|RAILWAY INFRASTRUCTURE/);
    assert.equal(errors.length,0);
  } finally {dom.window.close();}
});

test('museum and theatre context does not offer a pointer or intercept railway inspection',async()=>{
  const {dom,window,maps}=await start();
  try {
    const map=maps[0];map.handlers['style.load']();map.zoom=14;map.isMoving=()=>false;
    window.cancelAnimationFrame=()=>{};window.requestAnimationFrame=callback=>{callback();return 1;};
    const point=(layer,properties)=>({source:'openmaptiles',sourceLayer:'poi',layer:{id:layer},properties,geometry:{type:'Point',coordinates:[0,0]}});
    const event={point:{x:500,y:400},lngLat:{lng:0,lat:0},originalEvent:{buttons:0}};
    for (const subclass of ['museum','theatre']) {
      map.rendered=[point('context-destinations-culture-label',{name:`Test ${subclass}`,subclass})];
      map.handlers.mousemove(event);
      assert.equal(map.getCanvas().style.cursor,'',subclass);
      map.handlers.click(event);
      assert.equal(window.document.getElementById('details').hidden,true,subclass);
    }
    const station={source:'stations',sourceLayer:'standard_railway_text_stations',layer:{id:'station-detail-large-names'},properties:{name:'Station beneath theatre',station_size:'large',state:'present'},geometry:{type:'Point',coordinates:[0,0]}};
    map.rendered=[point('context-destinations-culture-label',{name:'Theatre',subclass:'theatre'}),station];
    map.handlers.click(event);
    assert.match(window.document.getElementById('detail-content').textContent,/Station beneath theatre/);
    const bus=point('context-transport-bus-label',{name:'Bus interchange',class:'bus',subclass:'bus_station'});
    map.rendered=[bus];map.handlers.mousemove(event);
    assert.equal(map.getCanvas().style.cursor,'pointer');
    map.handlers.click(event);
    assert.match(window.document.getElementById('detail-content').textContent,/TRANSPORT FACILITY/);
  } finally {dom.window.close();}
});

test('concurrent train-control systems use compact names with complete hover and native expandable descriptions',async()=>{
  const {dom,window,maps,errors}=await start({search:'?mode=control'});
  try {
    const map=maps[0];map.getLayer=id=>map.options.style.layers.find(layer=>layer.id===id);
    map.handlers['style.load']();map.zoom=18;
    const codes=['etcs_2','lzb','pzb'];
    const feature={source:'railway',sourceLayer:'railway',layer:{id:'control-tracks'},properties:{name:'Shared protection systems',state:'present',train_protection0:'etcs_2',train_protection1:'lzb',train_protection2:'pzb',train_protection:'etcs_2;lzb;pzb;etcs_2'},geometry:{type:'LineString',coordinates:[[0,0],[0.001,0]]}};
    map.rendered=[feature];
    map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
    map.handlers.moveend();await new Promise(resolve=>setTimeout(resolve,300));
    for (const container of [window.document.getElementById('detail-content'),window.document.getElementById('legend')]) {
      const labels=[...container.querySelectorAll('details.system-label')];
      assert.equal(labels.length,3,'all concurrent systems appear once despite repeated tags');
      assert.deepEqual(labels.map(label=>label.querySelector('summary').textContent).sort(),['ETCS L2','LZB','PZB'].sort());
      for (const code of codes) {
        const system=model.trainProtection(code),label=labels.find(label=>label.querySelector('summary').textContent===model.trainProtectionShort(code));
        const summary=label.querySelector('summary'),description=[system[1],model.CONTROL_LEVELS[system[3]],model.CONTROL_FAMILIES[system[2]].note].join(' · ');
        assert.equal(label.open,false,'full descriptions start collapsed');
        assert.equal(summary.title,description,'hover includes the complete name, level and compatibility explanation');
        assert.equal(label.querySelector('.system-description').textContent,description);
        assert.ok(label instanceof window.HTMLDetailsElement,'native details/summary keeps tap and keyboard access');
        summary.click();assert.equal(label.open,true,'tapping the summary exposes its description');
        summary.click();assert.equal(label.open,false);
      }
    }
    assert.equal(errors.length,0);
  } finally {dom.window.close();}
});

test('railway energy supplies download once at facility zoom and relocalize existing data on language changes',async()=>{
  const requests=[],collection={type:'FeatureCollection',features:[{type:'Feature',id:'node-91',properties:{power_kind:'fuel',name:'Local railway depot','name:en':'Railway fuel depot','name:ja':'鉄道給油所'},geometry:{type:'Point',coordinates:[0,0]}}]};
  const {dom,window,maps,errors}=await start({fetcher:async url=>{
    const power=String(url).includes('/data/traction/power/power-facilities.geojson');
    if(power)requests.push(String(url));
    return {ok:true,json:async()=>structuredClone(power?collection:style)};
  }});
  try {
    const map=maps[0];map.zoom=9;map.handlers['style.load']();
    assert.equal(requests.length,0,'Infrastructure does not request the Power dataset');
    window.document.querySelector('[data-mode="electrification"]').click();
    assert.equal(requests.length,0,'Power overview does not request detailed facilities');
    window.document.querySelector('[data-background="satellite"]').click();
    map.zoom=12;map.handlers.moveend();
    assert.equal(requests.length,0,'satellite without rail overlays does not request supplies');
    window.document.querySelector('[data-background="carto"]').click();
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(requests.length,1);
    const original=collection.features[0],loaded=map.sourceData.electricFacilities.features[0];
    assert.equal(loaded.id,original.id);assert.equal(loaded.type,original.type);assert.deepEqual(loaded.geometry,original.geometry);
    for(const [key,value] of Object.entries(original.properties))assert.equal(loaded.properties[key],value,'recorded supply tags are preserved');
    assert.equal(loaded.properties.atlas_name,original.properties.name);
    assert.equal(loaded.properties.atlas_language,'local');
    map.rendered=[{...loaded,source:'electricFacilities',layer:{id:'electrification-supply-points'}}];
    map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
    assert.equal(window.document.querySelector('#detail-content h2').textContent,original.properties.name);
    const language=window.document.getElementById('language');
    for(const code of ['en','ja']) {
      language.value=code;language.dispatchEvent(new window.Event('change'));
      await new Promise(resolve=>setTimeout(resolve,0));
      const localized=map.sourceData.electricFacilities.features[0].properties;
      assert.equal(localized.atlas_name,original.properties[`name:${code}`]);
      assert.equal(localized.atlas_language,code);
      for(const [key,value] of Object.entries(original.properties))assert.equal(localized[key],value,'language changes keep the original mapped tags');
      assert.equal(window.document.querySelector('#detail-content h2').textContent,original.properties[`name:${code}`]);
      assert.equal(requests.length,1,'language changes relocalize the loaded snapshot without another download');
    }
    map.handlers.moveend();map.handlers.moveend();
    window.document.querySelector('[data-mode="infrastructure"]').click();
    window.document.querySelector('[data-mode="electrification"]').click();
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(requests.length,1,'moving and returning to Power reuse the loaded snapshot');
    assert.equal(errors.length,0);
  } finally {dom.window.close();}
});

test('Power facilities inspect their supply type and source object without train speed or timetable fields',async()=>{
  const {dom,window,maps,errors}=await start({search:'?mode=electrification',fetcher:async url=>({ok:true,json:async()=>String(url).includes('power-facilities.geojson')?{type:'FeatureCollection',features:[]}:structuredClone(style)})});
  try {
    const map=maps[0];map.handlers['style.load']();map.zoom=18;
    const supplies=[
      ['fuel','node',91,{railway:'fuel',fuel:'diesel'}],
      ['coaling_facility','way',92,{railway:'coaling_facility'}],
      ['water_tank','relation',93,{railway:'water_tank',content:'water',capacity:'100 m³'}],
      ['plant','way',94,{power:'plant','plant:source':'hydro','plant:output:electricity':'20 MW'}],
    ];
    for (const [kind,type,id,tags] of supplies) {
      const feature={source:'electricFacilities',layer:{id:'electrification-supply-points'},properties:{...tags,name:`Test ${kind}`,power_kind:kind,power_state:'present',osm_type:type,osm_id:String(id)},geometry:{type:'Point',coordinates:[0,0]}};
      map.rendered=[feature];map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
      const detail=window.document.getElementById('detail-content');
      assert.match(detail.textContent,/RAILWAY ENERGY SUPPLY/);
      assert.ok(detail.textContent.includes(powerFacilities.POWER_FACILITY_KINDS[kind].label));
      assert.equal(detail.querySelector(`a[href="https://www.openstreetmap.org/${type}/${id}"]`)?.textContent,`Open this ${type} on OpenStreetMap ↗`);
      assert.doesNotMatch(detail.textContent,/Speed label|Train protection|Departures|RAILWAY INFRASTRUCTURE/);
      if(tags.fuel)assert.match(detail.textContent,/Fueldiesel/);
      if(tags.capacity)assert.match(detail.textContent,/Capacity100 m³/);
      if(tags['plant:output:electricity'])assert.match(detail.textContent,/Output20 MW/);
    }
    map.rendered=[{source:'electricSubstations',sourceLayer:'electrification_substation',layer:{id:'electrification-substation-areas'},properties:{name:'Traction footprint',voltage:'25000'},geometry:{type:'Polygon',coordinates:[[[0,0],[0.001,0],[0,0.001],[0,0]]]}}];
    map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
    assert.match(window.document.getElementById('detail-content').textContent,/Traction footprintTypeTraction substation/);
    assert.equal(errors.length,0);
  } finally {dom.window.close();}
});

test('close infrastructure details follow the mode, labels and background on the initial frame and after switching',async()=>{
 const {dom,window,maps}=await start({search:'?mode=speed&names=0'});
 try{
  const map=maps[0],ids=['platform-areas','platform-outlines','platform-points','platform-edges','platform-numbers','platform-lengths','infrastructure-signal-points','infrastructure-signal-references','infrastructure-entrance-points','infrastructure-entrance-references'];
  for(const id of ids)assert.equal(map.options.style.layers.find(l=>l.id===id).layout.visibility,'none',id);
  map.handlers['style.load']();window.document.querySelector('[data-mode="infrastructure"]').click();
  for(const id of ids)assert.equal(map.visibility[id],'visible',id);
  window.document.getElementById('labels').click();
  for(const id of ['platform-numbers','platform-lengths','infrastructure-signal-references','infrastructure-entrance-references'])assert.equal(map.visibility[id],'none',id);
  for(const id of ['platform-edges','infrastructure-signal-points','infrastructure-entrance-points'])assert.equal(map.visibility[id],'visible',id);
  window.document.querySelector('[data-background="satellite"]').click();for(const id of ids)assert.equal(map.visibility[id],'none',id);
  window.document.querySelector('[data-background="hybrid"]').click();assert.equal(map.visibility['infrastructure-entrance-points'],'visible');
  window.document.querySelector('[data-mode="control"]').click();for(const id of ids)assert.equal(map.visibility[id],id==='infrastructure-signal-points'?'visible':'none',id);
  window.document.getElementById('labels').click();
  for(const id of ids)assert.equal(map.visibility[id],id.startsWith('infrastructure-signal-')?'visible':'none',id);
 }finally{dom.window.close();}
});

test('signals and entrances inspect their mapped node and avoid track/timetable fields',async()=>{
 const {dom,window,maps,errors}=await start();
 try{
  const map=maps[0];map.handlers['style.load']();map.zoom=19;
  for(const feature of [
   {source:'railwaySignals',sourceLayer:'railway_signals',layer:{id:'infrastructure-signal-points'},properties:{id:123,railway:'signal',ref:'S12',category0:'main',category1:'distant',deactivated1:true,direction_both:true},geometry:{type:'Point',coordinates:[0,0]}},
   {source:'stationEntrances',sourceLayer:'standard_station_entrances',layer:{id:'infrastructure-entrance-points'},properties:{id:456,label:'Exit A8'},geometry:{type:'Point',coordinates:[0,0]}}
  ]){
   map.rendered=[feature];map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
   const detail=window.document.getElementById('detail-content');assert.match(detail.textContent,feature.source==='railwaySignals'?/Signal S12/:/Exit A8/);
   assert.equal(detail.querySelector(`a[href="https://www.openstreetmap.org/node/${feature.properties.id}"]`)?.textContent,'Open this node on OpenStreetMap ↗');
   assert.doesNotMatch(detail.textContent,/Speed label|Train protection|Departures|Track in shared roadway/);
   if(feature.source==='railwaySignals'){assert.match(detail.textContent,/main, distant/);assert.match(detail.textContent,/Inactive componentsdistant/);assert.match(detail.textContent,/Both directions/);}
  }
  assert.equal(errors.length,0);
 }finally{dom.window.close();}
});

test('Carto shows railway overlays, honours terrain, hides duplicate basemap labels and keeps compact attribution', async () => {
  const {dom,window,maps} = await start({search:'?background=carto'});
  try {
    const map=maps[0], layer=id=>map.options.style.layers.find(l=>l.id===id);
    assert.equal(layer('carto').layout.visibility,'visible');
    assert.equal(layer('satellite').layout.visibility,'none');
    assert.equal(layer('water').layout.visibility,'none');
    assert.ok(map.controls.some(c=>c.options?.compact===true),'Carto keeps the same compact info control');
    map.handlers['style.load']();
    assert.equal(map.visibility['infrastructure-tracks'],'visible');
    assert.equal(map.visibility['terrain-relief'],'visible');
    assert.equal(map.visibility['water'],'none');
    assert.equal(window.document.getElementById('legend').hidden,false);
    window.document.getElementById('relief').click();
    assert.equal(map.visibility['terrain-relief'],'none');
    window.document.querySelector('[data-background="map"]').click();
    assert.equal(map.visibility.carto,'none');
    assert.equal(map.visibility.water,'visible');
  } finally {dom.window.close();}
});

test('desktop brand announces collapse on its first activation',async()=>{
 const {dom,window}=await start();try{const icon=window.document.getElementById('controls-open');assert.equal(icon.getAttribute('aria-label'),'Collapse map controls');icon.click();assert.equal(window.document.getElementById('controls').hidden,true);assert.equal(icon.getAttribute('aria-label'),'Open map controls');}finally{dom.window.close();}
});

test('compact controls open from the icon and return focus to it on collapse and Escape', async () => {
  const {dom,window} = await start({compact:true});
  try {
    const d=window.document, icon=d.getElementById('controls-open'), collapse=d.getElementById('collapse'), panel=d.querySelector('.panel');
    assert.equal(d.getElementById('controls').hidden,true);
    assert.equal(panel.classList.contains('collapsed'),true);
    icon.click();
    assert.equal(d.getElementById('controls').hidden,false);
    assert.equal(icon.getAttribute('aria-expanded'),'true');
    assert.equal(d.activeElement,collapse);
    assert.equal(icon.getAttribute('aria-label'),'Collapse map controls');
    icon.click();
    assert.equal(d.getElementById('controls').hidden,true);
    icon.click();
    collapse.click();
    assert.equal(d.activeElement,icon);
    assert.equal(icon.getAttribute('aria-expanded'),'false');
    icon.click();collapse.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(d.getElementById('controls').hidden,true);
    assert.equal(d.activeElement,icon);
  } finally { dom.window.close(); }
});

test('saved hidden overlays are absent in the constructor before any tile request',async()=>{
 const {dom,maps}=await start({search:'?relief=0&inactive=0&stations=0&trackCounts=0&labels=0&transport=0&destinations=0&constraints=0&mode=speed'});
 try {
  const layers=maps[0].options.style.layers;
  for(const l of layers.filter(l=>/^terrain-|^inactive-|^station-|^context-/.test(l.id)||l.source==='trackCounts'||l.id==='speed-labels'))assert.equal(l.layout.visibility,'none',l.id);
  assert.equal(layers.find(l=>l.id==='speed-tracks').layout.visibility,'visible');
 }finally{dom.window.close();}
});
test('Causeway Bay search reaches both APIs before a delayed label bundle loads',async()=>{
 const calls=[];
 const places=[{osm_type:'way',osm_id:248971549,lat:'22.2802878',lon:'114.1841633',class:'railway',type:'station',name:'銅鑼灣 Causeway Bay',display_name:'銅鑼灣 Causeway Bay, Hong Kong',namedetails:{name:'銅鑼灣 Causeway Bay','name:en':'Causeway Bay'}}];
 const {dom,window,maps,loadLabels}=await start({delayLabels:true,fetcher:async url=>{
  calls.push(String(url));return {ok:true,json:async()=>String(url).includes('nominatim')?places:String(url).includes('/facility')?[]:structuredClone(style)};
 }});
 try {
  assert.equal(maps.length,0,'map waits for labels');
  window.document.getElementById('search-input').value='Causeway Bay';
  window.document.getElementById('search-form').dispatchEvent(new window.Event('submit',{cancelable:true}));
  for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,0));
  assert.ok(calls.some(u=>u.startsWith(model.SEARCH_API)));
  assert.ok(calls.some(u=>u.startsWith(model.PLACE_SEARCH_API)));
  assert.match(window.document.getElementById('search-results').textContent,/Causeway Bay/);
  assert.equal(window.document.getElementById('search-results').hidden,false);
 }finally{loadLabels();for(let i=0;i<5;i++)await new Promise(r=>setTimeout(r,0));dom.window.close();}
});


test('map info identifies the executing cached asset and links to its build repository across backgrounds',async()=>{
 const commit='a'.repeat(40),sourceUrl=`https://git.example.test/fork/railway/commit/${commit}`,{dom,window,maps}=await start({assetQuery:'?v=cached-42',labelBuild:{version:'cached-42',commit,sourceUrl}});
 try {
  const attribution=()=>maps[0].controls.find(c=>c.options?.customAttribution)?.options;
  let info=attribution();assert.equal(info.compact,true);assert.match(info.customAttribution,/Build cached-42/);assert.ok(info.customAttribution.includes(`href="${sourceUrl}"`));assert.match(info.customAttribution,/Code aaaaaaaaaa/);
  window.document.querySelector('[data-background="carto"]').click();info=attribution();assert.equal(info.compact,true);assert.match(info.customAttribution,/Build cached-42/);assert.match(info.customAttribution,new RegExp(commit));
 } finally {dom.window.close();}
});
test('map info exposes mismatched cached bundle versions and handles a missing commit',async()=>{
 const {dom,maps}=await start({assetQuery:'?v=cached-42',labelBuild:{version:'cached-41',commit:''}});
 try {const info=maps[0].controls.find(c=>c.options?.customAttribution).options.customAttribution;assert.match(info,/Build cached-42/);assert.match(info,/Label build cached-41/);assert.match(info,/Development build/);}finally{dom.window.close();}
});

test('every versioned file the page loads asks for the page version', async () => {
  // The installed app saves the shell under the page's version and answers
  // a versioned request only from that version: a module asking for another
  // version cannot load offline.
  const {readdir} = await import('node:fs/promises');
  const dir = new URL('../styles/', import.meta.url);
  const page = (await readFile(new URL('index.html', dir), 'utf8')).match(/src="app\.mjs\?v=([\w.-]+)"/)[1];
  const found = [];
  // data-check.html is a page of its own, with its own version.
  for (const name of (await readdir(dir)).filter(n => /\.(mjs|html)$/.test(n) && !n.startsWith('data-check'))) {
    for (const [, version] of (await readFile(new URL(name, dir), 'utf8')).matchAll(/\?v=([\w.-]+)/g)) if (version !== page) found.push(`${name}: ${version}`);
  }
  const fallback = (await readFile(new URL('app.mjs', dir), 'utf8')).match(/get\('v'\) \|\| '([\w.-]+)'/)[1];
  assert.deepEqual(found, [], `page version ${page}`);
  assert.equal(fallback, page);
});

test('watch starts map-only and deliberate controls return to the map after each action',async()=>{
  const {dom,window,maps,errors}=await start({search:'?ui=watch',cookie:'atlas_settings='+encodeURIComponent(JSON.stringify({attributionOpen:true}))});
  try {
    assert.equal(errors.length,0);const doc=window.document,map=maps[0];map.handlers['style.load']();
    assert.equal(doc.body.dataset.ui,'watch');assert.equal(doc.querySelector('.panel').inert,true);
    assert.equal(doc.getElementById('watch-menu').hidden,true);
    map.handlers.click({point:{x:10,y:10}});assert.equal(doc.getElementById('details').hidden,true);
    const open=()=>doc.getElementById('map').dispatchEvent(new window.Event('contextmenu',{cancelable:true}));
    open();assert.equal(doc.getElementById('watch-menu').hidden,false);assert.equal(doc.getElementById('map-frame').inert,true);
    let select=doc.querySelector('#watch-content select');select.value='service';select.dispatchEvent(new window.Event('change'));
    assert.equal(doc.getElementById('watch-menu').hidden,true);assert.equal(map.visibility['service-routes'],'visible');
    open();assert.equal(doc.querySelector('#watch-content option[value="frequency"]'),null,'basic watch view has no frequency dependency');
    doc.querySelector('#watch-content button').click();
    open();doc.getElementById('watch-menu').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(doc.getElementById('watch-menu').hidden,true);
    open();select=doc.querySelector('#watch-content select[aria-label="Map options"]');select.value='standard';select.dispatchEvent(new window.Event('change'));
    assert.equal(doc.body.dataset.ui,'standard');assert.equal(doc.querySelector('.panel').inert,false);assert.equal(doc.getElementById('map-frame').inert,false);
    assert.match(decodeURIComponent(doc.cookie),/"attributionOpen":true/);
    assert.match(decodeURIComponent(doc.cookie),/"ui":"standard"/);
  } finally {dom.window.close();}
});
test('entering watch mode deactivates hidden drawing and measurement input',async()=>{
  const {dom,window,maps}=await start();
  try {
    const doc=window.document,map=maps[0];map.handlers['style.load']();
    for(const selector of ['[data-draw="line"]','[data-measure="distance"]']){
      const tool=doc.querySelector(selector);tool.click();assert.equal(map.doubleClickEnabled,false);
      const watch=doc.getElementById('watch-layout');watch.checked=true;watch.dispatchEvent(new window.Event('change'));
      assert.equal(map.doubleClickEnabled,true,'watch mode restores direct double-tap zoom');
      assert.equal(tool.getAttribute('aria-pressed'),'false','the hidden tool is inactive');
      assert.equal(doc.getElementById('draw-toolbar').hidden,true);assert.equal(doc.getElementById('measure-toolbar').hidden,true);
      watch.checked=false;watch.dispatchEvent(new window.Event('change'));assert.equal(tool.getAttribute('aria-pressed'),'false','returning to normal does not restore hidden editing');
    }
  } finally {dom.window.close();}
});
