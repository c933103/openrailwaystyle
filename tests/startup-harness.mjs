import * as globeModule from '../styles/globe-drag.mjs';
import test from 'node:test';
import * as labelModule from '../styles/tile-labels.mjs';
import encodeTile from 'vt-pbf';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {webcrypto,createHash} from 'node:crypto';
import vm from 'node:vm';
import {gzipSync} from 'node:zlib';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { JSDOM } from 'jsdom';
import * as model from '../styles/map-model.mjs';
import * as draw from '../styles/draw.mjs';
import * as departuresModule from '../styles/departures.mjs';
import * as departuresUiModule from '../styles/departures-ui.mjs';
import * as elevationModule from '../styles/elevation.mjs';
import * as contextFeatures from '../styles/context.mjs';
import * as cjkFontFeatures from '../styles/cjk-font.mjs';
import * as rareHanFeatures from '../styles/rare-han.mjs';
import * as bathymetryModule from '../styles/bathymetry.mjs';
import * as terrain3dModule from '../styles/terrain-3d.mjs';
import * as crossingTagFeatures from '../styles/crossing-tags.mjs';
import * as frequencyModule from '../styles/service-frequency.mjs';
import * as serviceStatusModule from '../styles/service-status.mjs';
import * as dataAgesModule from '../styles/data-ages.mjs';
import * as powerFacilities from '../styles/power-facilities.mjs';
import * as controlFunctions from '../styles/map-controls.mjs';
import * as watchModule from '../styles/watch-map.mjs';
import * as railRecoveryModule from '../styles/rail-provider-recovery.mjs';
import * as stationFallbackModule from '../styles/station-fallback.mjs';
import * as stationWorldModule from '../styles/station-world.mjs';
import * as imageryModule from '../styles/imagery.mjs';
import * as tileBundleModule from '../styles/tile-bundles.mjs';
import * as referenceModule from '../styles/mainline-reference.mjs';
import * as layerSemantics from '../styles/layer-semantics.mjs';
import {BROWSER_LIBRARIES} from '../scripts/browser-libraries.mjs';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';

// SyntheticModule exports keep their native Node realm, so window.fetch alone
// cannot isolate default fetch arguments in imported helpers. Never delegate
// unmocked requests to the network, even when application code catches errors.
const unmockedRequests=[];
const denyNetwork=target=>{unmockedRequests.push(target);throw new Error(`Startup harness blocked unmocked network: ${target}`);};
globalThis.fetch=async input=>denyNetwork(String(input?.url||input));
net.Socket.prototype.connect=()=>denyNetwork('socket');
http.request=http.get=https.request=https.get=()=>denyNetwork('HTTP');
test.after(()=>assert.deepEqual(unmockedRequests,[],'every startup request must use an explicit fixture'));
process.on('exit',()=>{if(unmockedRequests.length)process.exitCode=1;});

const html = await readFile(new URL('../styles/index.html', import.meta.url), 'utf8');
const appURL = new URL('../styles/app.mjs', import.meta.url);
const code = await readFile(appURL, 'utf8');
const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url), 'utf8'));
const legacyDistributions=await Promise.all(BROWSER_LIBRARIES.map(async library=>({...library,
  url:`https://cdn.jsdelivr.net/npm/${library.package}@${library.version}/${library.source}`,
  body:await readFile(new URL(`../node_modules/${library.package}/${library.source}`,import.meta.url)),
}))).then(async libraries=>Promise.all(libraries.map(async library=>({...library,
  patchedBody:library.sourceSha256?Buffer.from(await controlFunctions.backportMapLibre524(library.body,webcrypto.subtle)):null,
}))));

async function start({ styleLoaded = false, failWebGL = false, delayLibraries = false, delayLabels = false, fontFaces=false, installedFonts, fetcher, search = '', cookie = '', compact = false, labelBuild, assetQuery = '', stationTile, frequencyClock, recoveryClock, metadataClock, platformGeometryOptions, departureLoader, elevationOptions, cacheOnlyLibraries, noLegacyCrypto=false, controlSource, savedView } = {}) {
  const dom = new JSDOM(html, {url:`https://example.org/openrailwaystyle/${search}`, runScripts:'outside-only'});
  if (cookie) dom.window.document.cookie = `${cookie}; path=/`;
  const window = dom.window;
  if (savedView) window.localStorage.setItem('atlas_view', JSON.stringify(savedView));
  const errors = [], maps = [];
  const fonts=[];
  if(fontFaces){
    const registered=new Set();Object.defineProperty(window.document,'fonts',{value:{ready:Promise.resolve(),add:f=>registered.add(f),delete:f=>registered.delete(f)}});
    window.FontFace=class{constructor(family,url){this.family=family;this.url=url;fonts.push(this);}load(){return new Promise((resolve,reject)=>{this.finish=()=>resolve(this);this.fail=()=>reject(new Error('font offline'));});}};
  }
  if(installedFonts){
    // A 2D context measuring Han characters by the first listed family that
    // has them; the probe font ("Atlas Probe") draws nothing.
    const measure=(font,character)=>{const family=/"([^"]+)"/.exec(font)?.[1];return installedFonts[family]?.includes(character)?32:0;};
    window.OffscreenCanvas=class{getContext(){return {font:'',measureText(text){return {width:measure(this.font,text)};}};}};
    window.CanvasRenderingContext2D=class{constructor(){this.value='';}};
    Object.defineProperty(window.CanvasRenderingContext2D.prototype,'font',{configurable:true,get(){return this.value;},set(value){this.value=value;}});
    window.CanvasRenderingContext2D.prototype.lang='';
  }
  window.console.error = error => errors.push(error);
  class Map {
    constructor(options) {
      if (failWebGL) throw new Error('Failed to initialize WebGL');
      this.options = options; this.handlers = {}; this.visibility = {}; this.styleLoaded = styleLoaded;
      this.painter={transform:{zoom:options.zoom},maskCalls:0,_renderTileClippingMasks(){this.maskCalls++;}};
      maps.push(this);
    }
    once(name,handler) {((this.onceHandlers ||= {})[name] ||= []).push(handler);this.handlers[name]=(...args)=>{if(name==='style.load')this.styleLoaded=true;return handler(...args);};}
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
      this.handlers[name]=(...args)=>{if(name==='style.load')this.styleLoaded=true;for(const listener of [...listeners])listener(...args);};
    }
    getStyle() { return this.options.style; }
    getSource(id) { return (this.sources ||= {})[id] ||= {setData:data=>{(this.sourceData ||= {})[id]=data;},setUrl:url=>{this.options.style.sources[id].url=url;},setTiles:tiles=>{this.options.style.sources[id].tiles=tiles;}}; }
    setLayoutProperty(id, property, value) { if (property === 'visibility') { this.visibility[id] = value; const layer=this.options.style.layers.find(l=>l.id===id); if(layer)(layer.layout ||= {}).visibility=value; } else (this.layout ||= {})[id] = value; }
    getLayoutProperty(id, property) { return this.options.style.layers.find(layer=>layer.id===id)?.layout?.[property]; }
    getFilter(id) { return this.options.style.layers.find(layer=>layer.id===id)?.filter; }
    setFilter(id, filter) { this.options.style.layers.find(layer=>layer.id===id).filter=filter; }
    setPaintProperty(id, property, value) { (this.paint ||= {})[id] = value; ((this.paintProperties ||= {})[id] ||= {})[property] = value; }
    setPixelRatio(ratio) { this.pixelRatio = ratio; }
    zoom = 20;
    getZoom() { return this.zoom; }
    setMinZoom(z) { this.minZoom = z; this.zoom = Math.max(this.zoom, z); }
    setMaxZoom(z) { this.maxZoom = z; this.zoom = Math.min(this.zoom, z); }
    jumpTo(options) { this.lastJump=options;this.jumpCalls=(this.jumpCalls||0)+1;this.zoom = Math.min(Math.max(options.zoom, this.minZoom ?? -Infinity), this.maxZoom ?? Infinity); if (Number.isFinite(options.pitch)) this.setPitch(options.pitch); }
    easeTo(options) { this.lastEase=options; if (Number.isFinite(options.zoom)) this.zoom=options.zoom; if (Number.isFinite(options.pitch)) this.setPitch(options.pitch); }
    getLayer() {}
    addLayer(layer) { (this.added ||= []).push(layer.id); }
    addSource() {}
    getCanvas() { return this.canvas ||= {style:{}}; }
    getCanvasContainer() { return this.canvasContainer ||= window.document.createElement('div'); }
    doubleClickZoom = {enable:()=>{this.doubleClickEnabled=true;}, disable:()=>{this.doubleClickEnabled=false;}};
    queryRenderedFeatures(geometry, options) {const {layers}=options||geometry||{};return (this.rendered||[]).filter(f=>!layers||layers.includes(f.layer?.id));}
    querySourceFeatures(id,{sourceLayer}) { return (this.sourceFeatures || []).filter(f=>f.sourceLayer===sourceLayer); }
    isSourceLoaded() { return true; }
    // The terrain fixture must not make a cold map ready before style.load.
    isStyleLoaded() { return this.styleLoaded; }
    getTerrain() { return this.options.style.terrain || null; }
    setTerrain(terrain) { this.options.style.terrain = terrain; }
    setSourceTileLodParams(...args) { (this.tileLodCalls ||= []).push(args); return this; }
    getMaxPitch() { return this.options.maxPitch ?? 60; }
    projection = {type:'mercator'};
    getProjection() { return this.projection; }
    setProjection(projection) { this.projection = projection; }
    getContainer() { return {clientWidth:1000, clientHeight:700}; }
    getCenter() { return {lng:0, lat:0}; }
    getBounds() { return {getWest:()=>-180,getEast:()=>180,getSouth:()=>-85,getNorth:()=>85}; }
    getBearing() { return 0; }
    getPitch() { return this.pitch ?? this.options.pitch ?? 0; }
    setPitch(pitch) { this.pitch=pitch; this.handlers.pitch?.(); }
    unproject() { return {lng:0, lat:0}; }
  }
  // This is the MapLibre 5 surface used by the app, including the pinned
  // instance-local painter boundary. In particular,
  // supported() is absent: older Mapbox examples must not gate startup.
  const libraries = {};
  maps.protocols = {};
  libraries.maplibregl = {Map, addProtocol(id,handler){maps.protocols[id]=handler;}, NavigationControl:class { constructor(options) { maps.controls.push(options); } }, GeolocateControl:class { constructor(options) { maps.controls.push(options); } }, AttributionControl:class {constructor(options){this.options=options;}}, ScaleControl:class { constructor(options) { this.unit = options.unit; maps.scale = this; } setUnit(unit) { this.unit = unit; } }};
  maps.controls = [];
  libraries.pmtiles = {
    Protocol:class { constructor(){this.tiles=new globalThis.Map();maps.pmtiles=this;} tile() {} },
    FetchSource:class { constructor(url){this.url=url;} },
    PMTiles:class { constructor(source){this.source=source;} },
  };
  libraries.mlcontour = {DemSource:class {constructor(options){this.options=options; (maps.dems ||= []).push(options);} setupMaplibre(){} contourProtocolUrl(options){return `${this.options.id}-contour://${options.multiplier ? 'ft' : 'm'}/{z}/{x}/{y}`;} sharedDemProtocolUrl='atlas-shared://{z}/{x}/{y}';}};
  // Delayed libraries are provided later by loadLibraries().
  const loadLibraries = () => {
    Object.assign(window, libraries);
    for (const script of window.document.head.querySelectorAll('script')) script.onload?.();
  };
  const scriptLoads=[],revoked=[];
  if (cacheOnlyLibraries) {
    window.caches=cacheOnlyLibraries;
    window.Blob=Blob; window.Response=Response; window.TextDecoder=TextDecoder; window.TextEncoder=TextEncoder;
    Object.defineProperty(window.crypto,'subtle',{value:noLegacyCrypto?undefined:webcrypto.subtle});
    Object.assign(window,{mlcontour:libraries.mlcontour});
    const blobs=new globalThis.Map();let sequence=0;
    window.URL.createObjectURL=blob=>{const url=`blob:https://example.org/${++sequence}`;blobs.set(url,blob);return url;};
    window.URL.revokeObjectURL=url=>{revoked.push(url);blobs.delete(url);};
    const append=window.document.head.append.bind(window.document.head);
    window.document.head.append=(...nodes)=>{
      append(...nodes);
      for(const script of nodes.filter(node=>node.tagName==='SCRIPT')) {
        scriptLoads.push(script.src);
        queueMicrotask(async()=>{
          const saved=blobs.get(script.src);
          if(!saved){script.onerror?.();return;}
          try {
            const body=Buffer.from(await saved.arrayBuffer());
            const library=legacyDistributions.find(library=>(library.patchedBody || library.body).equals(body));
            // The real app has hashed the actual upstream bytes. This DOM
            // unit harness substitutes only the renderer API after accepting
            // those exact bytes; browser coverage also executes the real code.
            if(library)window[library.package==='maplibre-gl'?'maplibregl':'pmtiles']=libraries[library.package==='maplibre-gl'?'maplibregl':'pmtiles'];
            else window.eval(body.toString('utf8'));
            script.onload?.();
          }
          catch {script.onerror?.();}
        });
      }
    };
  } else if (!delayLibraries) Object.assign(window, libraries);
  window.fetch = fetcher || (async input => String(input).includes('/data/traction/power/')?new Response(JSON.stringify({type:'FeatureCollection',features:[]})):({ok:true,json:async()=>structuredClone(style)}));
  // Native imported factories must receive this window's mock explicitly;
  // their default parameters otherwise resolve Node's global fetch.
  const fixtureOptions=options=>({...options,fetcher:options?.fetcher??window.fetch});
  window.matchMedia = () => ({matches:compact});
  const context = dom.getInternalVMContext();
  const dependency = new vm.SyntheticModule(Object.keys(model), function() {
    for (const [key,value] of Object.entries(model)) this.setExport(key,
      key==='createPlatformTileGeometry'?options=>{platformGeometryOptions?.(options);return value(fixtureOptions(options));}:
      key==='createPlatformLengths'?(map,options)=>value(map,fixtureOptions(options)):value);
  }, {context});
  const protocols=new vm.SyntheticModule(['createMetadataRetries','installLabelProtocols','localizeTile','tileTextBlocks','locate','buildInfo','timedSource','readTile'],function(){this.setExport('createMetadataRetries',(map,options)=>labelModule.createMetadataRetries(map,{...options,...(metadataClock?{setTimer:metadataClock.setTimer,clearTimer:metadataClock.clearTimer}:{})}));this.setExport('buildInfo',labelBuild);this.setExport('readTile',labelModule.readTile);this.setExport('tileTextBlocks',labelModule.tileTextBlocks);this.setExport('installLabelProtocols',()=>stationTile?{stationTile}:{});this.setExport('timedSource',(inner,ms)=>({inner,ms,getKey:()=>inner.url}));this.setExport('localizeTile',x=>x);this.setExport('locate',(lon,lat)=>{assert.ok(Number.isFinite(lon)&&Number.isFinite(lat),'label region lookup takes longitude and latitude separately');return {atlas_han:'none',atlas_zh:''};});},{context});
  // The label code is imported on demand, after the controls are wired.
  let loadLabels;
  const labelsReady=new Promise(resolve=>{loadLabels=resolve;});
  if(!delayLabels)loadLabels();
  const app = new vm.SourceTextModule(code+'\nexport {libraries as __testLibraryLoads, legacyStyle as __testLegacyStyle};', {
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
  // A valid non-ocean MVT is necessary to exercise the new signed surface
  // sampler. An empty basemap body means *unknown*, not dry land, and must
  // not trigger an unmocked DEM request or fake an endpoint elevation.
  const nonOceanMVT=elevationOptions ? Uint8Array.from(encodeTile.fromGeojsonVt({water:{features:[{
    type:3,tags:{class:'lake'},geometry:[[[0,0],[4096,0],[4096,4096],[0,4096],[0,0]]],
  }]}})) : null;
  const elevation = new vm.SyntheticModule(Object.keys(elevationModule), function() {
    for (const [key,value] of Object.entries(elevationModule)) {
      if (key==='createElevation' && elevationOptions)
        this.setExport(key,url=>value(url,elevationOptions));
      else if (key==='createSurfaceElevation' && elevationOptions)
        this.setExport(key,url=>value(url,{
          ...elevationOptions,
          waterTile:async()=>({data:nonOceanMVT.buffer}),
          readTile:labelModule.readTile,
        }));
      else this.setExport(key,value);
    }
  }, {context});
  // Departures without the network; a test may supply a delayed local board.
  const departures = new vm.SyntheticModule(Object.keys(departuresModule), function() {
    for (const [key,value] of Object.entries(departuresModule)) this.setExport(key, key === 'stationDepartures' ? departureLoader || (async () => ({stops: [], rows: [], stopResults: []})) : value);
  }, {context});
  const globe = new vm.SyntheticModule(['installGlobeDrag','allowPolarCentres','readoutZoom','viewHash','parseViewHash'], function() { this.setExport('installGlobeDrag', () => ({sync() {}, justDragged: () => false, pan: () => false})); this.setExport('allowPolarCentres', () => ({refresh() {}}));this.setExport('readoutZoom',zoom=>zoom);this.setExport('viewHash',globeModule.viewHash);this.setExport('parseViewHash',globeModule.parseViewHash);  }, {context});
  const keyboard = new vm.SyntheticModule(['installKeyboardPan'], function() { this.setExport('installKeyboardPan', () => {}); }, {context});
  const rareHanModule = new vm.SyntheticModule(Object.keys(rareHanFeatures),function() {
    for (const [key,value] of Object.entries(rareHanFeatures)) this.setExport(key,value);
  },{context});
  const cjkFontModule = new vm.SyntheticModule(Object.keys(cjkFontFeatures),function() {
    for (const [key,value] of Object.entries(cjkFontFeatures)) this.setExport(key,value);
  },{context});
  const crossingTagModule = new vm.SyntheticModule(Object.keys(crossingTagFeatures),function() {
    for (const [key,value] of Object.entries(crossingTagFeatures)) this.setExport(key,value);
  },{context});
  const contextModule = new vm.SyntheticModule(Object.keys(contextFeatures),function() {
    for (const [key,value] of Object.entries(contextFeatures)) this.setExport(key,value);
  },{context});
  const bathymetry = new vm.SyntheticModule(Object.keys(bathymetryModule),function() {
    for (const [key,value] of Object.entries(bathymetryModule)) this.setExport(key,value);
  }, {context});
  const terrain3d = new vm.SyntheticModule(Object.keys(terrain3dModule),function() {
    for (const [key,value] of Object.entries(terrain3dModule)) this.setExport(key,value);
  }, {context});
  const frequency = new vm.SyntheticModule(Object.keys(frequencyModule),function(){for(const [key,value] of Object.entries(frequencyModule))this.setExport(key,frequencyClock&&key==='installFrequencyExpiry'?options=>value({...options,...frequencyClock}):frequencyClock&&['frequencyDetails','frequencyAvailability'].includes(key)?(properties,profile)=>value(properties,profile,frequencyClock.now()):value);},{context});
  const serviceStatus = new vm.SyntheticModule(Object.keys(serviceStatusModule),function(){for(const [key,value] of Object.entries(serviceStatusModule))this.setExport(key,value);},{context});
  const dataAges = new vm.SyntheticModule(Object.keys(dataAgesModule),function(){for(const [key,value] of Object.entries(dataAgesModule))this.setExport(key,value);},{context});
  const powerModule = new vm.SyntheticModule(Object.keys(powerFacilities),function() {
    for (const [key,value] of Object.entries(powerFacilities)) this.setExport(key,key==='createPowerFacilityLoader'?(map,options)=>value(map,fixtureOptions(options)):value);
  },{context});
  const semantics = new vm.SyntheticModule(Object.keys(layerSemantics), function() {
    for (const [key,value] of Object.entries(layerSemantics)) this.setExport(key,value);
  }, {context});
  const mapControls = controlSource ? new vm.SourceTextModule(controlSource, {context}) : new vm.SyntheticModule(Object.keys(controlFunctions), function() {
    for (const [key,value] of Object.entries(controlFunctions)) this.setExport(key,value);
  }, {context});
  const reference = new vm.SyntheticModule(Object.keys(referenceModule),function(){for(const [key,value] of Object.entries(referenceModule))this.setExport(key,key==='createReferenceReader'?options=>value(fixtureOptions(options)):value);},{context});
  const bundles = new vm.SyntheticModule(Object.keys(tileBundleModule),function(){for(const [key,value] of Object.entries(tileBundleModule))this.setExport(key,key==='createBundleReader'?options=>value(fixtureOptions(options)):value);},{context});
  const watch = new vm.SyntheticModule(Object.keys(watchModule),function(){for(const [key,value] of Object.entries(watchModule))this.setExport(key,value);},{context});
  const recovery = new vm.SyntheticModule(Object.keys(railRecoveryModule),function(){for(const [key,value] of Object.entries(railRecoveryModule))this.setExport(key,key==='createRailProviderRecovery'&&recoveryClock?(map,options)=>value(map,{...options,...recoveryClock}):value);},{context});
  const stationFallback = new vm.SyntheticModule(Object.keys(stationFallbackModule),function(){for(const [key,value] of Object.entries(stationFallbackModule))this.setExport(key,value);},{context});
  const imagery = new vm.SyntheticModule(Object.keys(imageryModule),function(){for(const [key,value] of Object.entries(imageryModule))this.setExport(key,value);},{context});
  const stationWorld = new vm.SyntheticModule(Object.keys(stationWorldModule),function(){
    for(const [key,value] of Object.entries(stationWorldModule))this.setExport(key,
      ['prepareWorldStationOverlay','installWorldStationLifecycle'].includes(key)?options=>value({...fixtureOptions(options),root:new URL(options.root.href)}):value);
  },{context});
  const departuresUi = new vm.SyntheticModule(Object.keys(departuresUiModule), function() {
    for (const [key,value] of Object.entries(departuresUiModule)) this.setExport(key,value);
  }, {context});
  await app.link(specifier => specifier.includes('imagery.mjs') ? imagery : specifier.includes('station-world.mjs') ? stationWorld : specifier.includes('station-fallback.mjs') ? stationFallback : specifier.includes('mainline-reference.mjs') ? reference : specifier.includes('departures-ui.mjs') ? departuresUi : specifier.includes('cjk-font.mjs') ? cjkFontModule : specifier.includes('rare-han.mjs') ? rareHanModule : specifier.includes('tile-bundles.mjs') ? bundles : specifier.includes('bathymetry.mjs') ? bathymetry : specifier.includes('terrain-3d.mjs') ? terrain3d : specifier.includes('service-frequency.mjs') ? frequency : specifier.includes('service-status.mjs') ? serviceStatus : specifier.includes('data-ages.mjs') ? dataAges : specifier.includes('watch-map.mjs') ? watch : specifier.includes('rail-provider-recovery.mjs') ? recovery : specifier.includes('map-controls.mjs') ? mapControls : specifier.includes('layer-semantics.mjs') ? semantics : specifier.includes('crossing-tags.mjs') ? crossingTagModule : specifier.includes('context.mjs') ? contextModule : specifier.includes('power-facilities.mjs') ? powerModule : specifier.includes('draw.mjs') ? drawing : specifier.includes('elevation.mjs') ? elevation : specifier.includes('departures.mjs') ? departures : specifier.includes('globe-drag.mjs') ? globe : specifier.includes('keyboard-pan.mjs') ? keyboard : dependency);
  await app.evaluate();
  if(cacheOnlyLibraries)await Promise.allSettled([app.namespace.__testLibraryLoads,app.namespace.__testLegacyStyle]);
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve,0));
  return {dom,window,maps,errors,loadLibraries,loadLabels,fonts,scriptLoads,revoked};
}

const ALL_PROBES='顿頓嘢冧𨋢俆㜏駅峠畑\uF900\uFA11㐀㙟𠮷';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const providerHubTile=(hub,language)=>{
 const id=hub.properties.osm_ids.split(';')[0],name=`Provider hub (${language})`;
 const bytes=encodeTile.fromGeojsonVt({standard_railway_text_stations:{features:[{type:1,id:1,
  tags:{id:`${id}-train-train-station`,name,atlas_name:name,atlas_language:language},geometry:[[2048,2048]]}]}},{version:2});
 return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
};
async function deferredHubHarness({tier=7,metadata=true,stationProtocol=true}={}){
 const hub=structuredClone(style.sources.stationMajor.data.features.find(f=>f.properties.wikidata==='Q54451'));
 hub.properties.tier=tier;
 const input=structuredClone(style);input.sources.stationMajor.data.features=[hub];
 const pending=[],departures=[];
 const state=await start({search:'?language=en#3/40.75/-74',fetcher:async()=>({ok:true,status:200,json:async()=>structuredClone(input)}),
  stationTile:stationProtocol?(url,language)=>new Promise((resolve,reject)=>pending.push({url,language,resolve,reject})):undefined,
  departureLoader:async station=>{departures.push(structuredClone(station));return {stops:[],rows:[],stopResults:[]};}});
 const map=state.maps[0],getSource=map.getSource.bind(map);
 const stationSource=metadata?{tiles:['atlasstation://en/https://tiles.test/stations/{z}/{x}/{y}']}:{};
 map.getSource=id=>id==='stations'?stationSource:getSource(id);
 map.getBounds=()=>({getWest:()=>-80,getEast:()=>-70,getSouth:()=>35,getNorth:()=>45});
 map.handlers['style.load']();
 const point=()=>map.sourceData?.stationMajor?.features.find(f=>f.id===hub.id);
 for(let i=0;i<50&&!point();i++)await tick();
 const click=()=>{
  map.rendered=[{...structuredClone(point()),source:'stationMajor',layer:{id:'station-major-dots'}}];
  map.handlers.click({point:{x:500,y:400},lngLat:{lng:hub.geometry.coordinates[0],lat:hub.geometry.coordinates[1]}});
 };
 return {...state,map,hub,pending,departures,point,click,stationSource};
}

function recoveryClock() {
  const timers = new Map(), retries = [];
  let next = 0;
  return {timers, retries, active:() => true,
    setTimer:(fn, delay) => {timers.set(++next, {fn, delay});return next;},
    clearTimer:id => timers.delete(id)};
}
const failedRailTile = (x = 1) => ({state:'errored', tileID:{canonical:{z:7, x, y:2}}});
async function recoveryApp({early = false} = {}) {
  const clock = recoveryClock(), app = await start({recoveryClock:clock, search:'?mode=speed'});
  const map = app.maps[0];
  if (!early) map.handlers['style.load']();
  map.zoom = 7;
  map.sources ||= {};
  map.sources.railway = {url:'atlasrail://https://openrailwaymap.app/railway_line_high', setUrl:() => clock.retries.push('metadata')};
  map.refreshTiles = (...args) => clock.retries.push(args);
  const status = app.window.document.getElementById('map-status');
  return {...app, map, clock, status,
    fail:tile => map.handlers.error({sourceId:'railway', tile, error:new Error('Map names returned 520')}),
    data:event => map.handlers.sourcedata({sourceId:'railway', ...event}),
    close:() => {map.handlers.remove();app.dom.window.close();}};
}

export {
  globeModule,test,encodeTile,assert,readFile,createHash,
  vm,gzipSync,net,https,model,frequencyModule,
  powerFacilities,stationFallbackModule,featureFilter,unmockedRequests,html,code,
  style,legacyDistributions,start,ALL_PROBES,tick,providerHubTile,
  deferredHubHarness,recoveryClock,failedRailTile,recoveryApp,
};
