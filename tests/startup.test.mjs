import * as globeModule from '../styles/globe-drag.mjs';
import test from 'node:test';
import * as labelModule from '../styles/tile-labels.mjs';
import encodeTile from 'vt-pbf';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {webcrypto,createHash} from 'node:crypto';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import * as model from '../styles/map-model.mjs';
import * as draw from '../styles/draw.mjs';
import * as departuresModule from '../styles/departures.mjs';
import * as elevationModule from '../styles/elevation.mjs';
import * as contextFeatures from '../styles/context.mjs';
import * as cjkFontFeatures from '../styles/cjk-font.mjs';
import * as rareHanFeatures from '../styles/rare-han.mjs';
import * as bathymetryModule from '../styles/bathymetry.mjs';
import * as crossingTagFeatures from '../styles/crossing-tags.mjs';
import * as frequencyModule from '../styles/service-frequency.mjs';
import * as powerFacilities from '../styles/power-facilities.mjs';
import * as controlFunctions from '../styles/map-controls.mjs';
import * as watchModule from '../styles/watch-map.mjs';
import * as railRecoveryModule from '../styles/rail-provider-recovery.mjs';
import * as tileBundleModule from '../styles/tile-bundles.mjs';
import * as layerSemantics from '../styles/layer-semantics.mjs';
import {BROWSER_LIBRARIES} from '../scripts/browser-libraries.mjs';

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

async function start({ failWebGL = false, delayLibraries = false, delayLabels = false, fontFaces=false, installedFonts, fetcher, search = '', cookie = '', compact = false, labelBuild, assetQuery = '', stationTile, frequencyClock, recoveryClock, platformGeometryOptions, departureLoader, cacheOnlyLibraries, noLegacyCrypto=false, controlSource } = {}) {
  const dom = new JSDOM(html, {url:`https://example.org/openrailwaystyle/${search}`, runScripts:'outside-only'});
  if (cookie) dom.window.document.cookie = `${cookie}; path=/`;
  const window = dom.window;
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
    setLayoutProperty(id, property, value) { if (property === 'visibility') { this.visibility[id] = value; const layer=this.options.style.layers.find(l=>l.id===id); if(layer)(layer.layout ||= {}).visibility=value; } else (this.layout ||= {})[id] = value; }
    setPaintProperty(id, property, value) { (this.paint ||= {})[id] = value; ((this.paintProperties ||= {})[id] ||= {})[property] = value; }
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
  window.fetch = fetcher || (async () => ({ok:true,json:async()=>structuredClone(style)}));
  window.matchMedia = () => ({matches:compact});
  const context = dom.getInternalVMContext();
  const dependency = new vm.SyntheticModule(Object.keys(model), function() {
    for (const [key,value] of Object.entries(model)) this.setExport(key,key==='createPlatformTileGeometry'&&platformGeometryOptions?options=>{platformGeometryOptions(options);return value(options);}:value);
  }, {context});
  const protocols=new vm.SyntheticModule(['installLabelProtocols','localizeTile','tileTextBlocks','locate','buildInfo','timedSource','readTile'],function(){this.setExport('buildInfo',labelBuild);this.setExport('readTile',labelModule.readTile);this.setExport('tileTextBlocks',labelModule.tileTextBlocks);this.setExport('installLabelProtocols',()=>stationTile?{stationTile}:{});this.setExport('timedSource',(inner,ms)=>({inner,ms,getKey:()=>inner.url}));this.setExport('localizeTile',x=>x);this.setExport('locate',(lon,lat)=>{assert.ok(Number.isFinite(lon)&&Number.isFinite(lat),'label region lookup takes longitude and latitude separately');return {atlas_han:'none',atlas_zh:''};});},{context});
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
  const elevation = new vm.SyntheticModule(Object.keys(elevationModule), function() {
    for (const [key,value] of Object.entries(elevationModule)) this.setExport(key,value);
  }, {context});
  // Departures without the network; a test may supply a delayed local board.
  const departures = new vm.SyntheticModule(Object.keys(departuresModule), function() {
    for (const [key,value] of Object.entries(departuresModule)) this.setExport(key, key === 'stationDepartures' ? departureLoader || (async () => ({stops: [], rows: []})) : value);
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
  const frequency = new vm.SyntheticModule(Object.keys(frequencyModule),function(){for(const [key,value] of Object.entries(frequencyModule))this.setExport(key,frequencyClock&&key==='installFrequencyExpiry'?options=>value({...options,...frequencyClock}):frequencyClock&&key==='frequencyDetails'?(properties,profile)=>value(properties,profile,frequencyClock.now()):value);},{context});
  const powerModule = new vm.SyntheticModule(Object.keys(powerFacilities),function() {
    for (const [key,value] of Object.entries(powerFacilities)) this.setExport(key,value);
  },{context});
  const semantics = new vm.SyntheticModule(Object.keys(layerSemantics), function() {
    for (const [key,value] of Object.entries(layerSemantics)) this.setExport(key,value);
  }, {context});
  const mapControls = controlSource ? new vm.SourceTextModule(controlSource, {context}) : new vm.SyntheticModule(Object.keys(controlFunctions), function() {
    for (const [key,value] of Object.entries(controlFunctions)) this.setExport(key,value);
  }, {context});
  const bundles = new vm.SyntheticModule(Object.keys(tileBundleModule),function(){for(const [key,value] of Object.entries(tileBundleModule))this.setExport(key,value);},{context});
  const watch = new vm.SyntheticModule(Object.keys(watchModule),function(){for(const [key,value] of Object.entries(watchModule))this.setExport(key,value);},{context});
  const recovery = new vm.SyntheticModule(Object.keys(railRecoveryModule),function(){for(const [key,value] of Object.entries(railRecoveryModule))this.setExport(key,key==='createRailProviderRecovery'&&recoveryClock?(map,options)=>value(map,{...options,...recoveryClock}):value);},{context});
  await app.link(specifier => specifier.includes('cjk-font.mjs') ? cjkFontModule : specifier.includes('rare-han.mjs') ? rareHanModule : specifier.includes('tile-bundles.mjs') ? bundles : specifier.includes('bathymetry.mjs') ? bathymetry : specifier.includes('service-frequency.mjs') ? frequency : specifier.includes('watch-map.mjs') ? watch : specifier.includes('rail-provider-recovery.mjs') ? recovery : specifier.includes('map-controls.mjs') ? mapControls : specifier.includes('layer-semantics.mjs') ? semantics : specifier.includes('crossing-tags.mjs') ? crossingTagModule : specifier.includes('context.mjs') ? contextModule : specifier.includes('power-facilities.mjs') ? powerModule : specifier.includes('draw.mjs') ? drawing : specifier.includes('elevation.mjs') ? elevation : specifier.includes('departures.mjs') ? departures : specifier.includes('globe-drag.mjs') ? globe : specifier.includes('keyboard-pan.mjs') ? keyboard : dependency);
  await app.evaluate();
  if(cacheOnlyLibraries)await Promise.allSettled([app.namespace.__testLibraryLoads,app.namespace.__testLegacyStyle]);
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve,0));
  return {dom,window,maps,errors,loadLibraries,loadLabels,fonts,scriptLoads,revoked};
}

const ALL_PROBES='顿頓嘢冧𨋢俆㜏駅峠畑\uF900\uFA11㐀㙟𠮷';

for (const previous of ['sw-before-first-party-libraries.js','sw-before-maplibre-backport.js']) test(`actual ${previous} keeps app/control versions coherent and safely recovers cached libraries`,async()=>{
  const [oldSource,newSource]=await Promise.all([
    readFile(new URL(`fixtures/${previous}`,import.meta.url),'utf8'),
    readFile(new URL('../styles/sw.js',import.meta.url),'utf8'),
  ]);
  const scope='https://example.org/openrailwaystyle/',stores=new Map(),fetched=[];
  const controlCode=await readFile(new URL('../styles/map-controls.mjs',import.meta.url),'utf8');
  const oldControlCode=controlCode.split('// MapLibre attribution hardening')[0];
  let deployed='old',offline=false,failReplacement=false,failControl=false;
  const caches={
    keys:async()=>[...stores.keys()],delete:async key=>stores.delete(key),
    open:async key=>{
      if(!stores.has(key))stores.set(key,new Map());const rows=stores.get(key);
      const keyOf=key=>typeof key==='string'?key:key.url;
      return {match:async key=>rows.get(keyOf(key))?.clone(),put:async(key,response)=>rows.set(keyOf(key),response.clone()),
        keys:async()=>[...rows.keys()].map(url=>new Request(url)),delete:async key=>rows.delete(keyOf(key))};
    },
  };
  const fetcher=async input=>{
    const url=new URL(typeof input==='string'?input:input.url||input.href);fetched.push(url.href);
    if(offline)throw Error('offline');
    if(failControl&&url.pathname.endsWith('/map-controls.mjs'))throw Error('control download interrupted');
    if(failReplacement&&url.pathname.endsWith('vendor/maplibre-gl-5.24.0-atlas.1.js'))throw Error('replacement library unavailable');
    const oldFirstParty=legacyDistributions.find(library=>url.pathname.endsWith('/'+library.target.replace('-atlas.1.js','.js')));
    if(url.hostname==='cdn.jsdelivr.net'||oldFirstParty) {
      const css=url.pathname.endsWith('.css');
      const library=oldFirstParty||legacyDistributions.find(library=>library.url===url.href);
      assert.ok(library,'only exact released dependencies enter the old cache');
      const body=library.body;
      assert.equal(createHash('sha256').update(body).digest('hex'),library.sourceSha256 || library.sha256);
      return new Response(body,{headers:{'content-type':css?'text/css':'application/javascript'}});
    }
    const body=url.href===scope?(deployed==='old'?'<script type="module" src="app.mjs?v=old"></script>':html)
      :url.pathname.endsWith('/app.mjs')&&deployed==='new'?code
      :url.pathname.endsWith('/map-controls.mjs')?(deployed==='new'?controlCode:oldControlCode):`${deployed}:${url.pathname}`;
    return new Response(body);
  };
  const worker=source=>{
    const handlers={};
    vm.runInNewContext(source,{URL,Response,Request,fetch:fetcher,caches,location:{origin:new URL(scope).origin},
      self:{registration:{scope},addEventListener:(name,handler)=>handlers[name]=handler,skipWaiting:async()=>{},clients:{claim:async()=>{}}}});
    return handlers;
  };
  const install=handlers=>{let result;handlers.install({waitUntil:promise=>result=promise});return result;};
  const request=(handlers,path)=>{let result;handlers.fetch({request:{method:'GET',url:new URL(path,scope).href,mode:path==='./'?'navigate':'cors'},respondWith:promise=>result=promise});return result;};
  const old=worker(oldSource);await install(old);deployed='new';
  failControl=true;
  assert.match(await (await request(old,'./')).text(),/app.mjs\?v=old/, 'failed updated control module keeps the complete old page');
  failControl=false;
  assert.equal(await (await request(old,'./')).text(),html,'old worker really admitted the new HTML');
  failReplacement=true;await assert.rejects(install(worker(newSource)),/replacement library unavailable/);
  offline=true;
  assert.equal(await (await request(old,'./')).text(),html);
  const version=html.match(/src="app\.mjs\?v=([\w.-]+)"/)[1];
  assert.equal(await (await request(old,`app.mjs?v=${version}`)).text(),code,'the tested app is exactly the copy kept by the old worker');
  if(previous==='sw-before-first-party-libraries.js')assert.equal(request(old,'vendor/maplibre-gl-5.24.0-atlas.1.js'),undefined,'the actual CDN-era worker cannot serve the new dotted vendor path');
  const savedControls=await (await request(old,`map-controls.mjs?v=${version}`)).text();
  assert.equal(savedControls,controlCode,'new app receives exact updated controls from its own version');
  assert.equal(await (await request(old,'map-controls.mjs?v=old')).text(),oldControlCode,'old tab still receives its own controls');
  const before=fetched.length;
  const result=await start({cacheOnlyLibraries:caches,controlSource:savedControls});
  try {
    assert.equal(result.maps.length,1,'cached legacy JavaScript can still initialize the app');
    assert.deepEqual(result.errors,[]);
    assert.equal(result.scriptLoads.filter(url=>url.startsWith('blob:')).length,2);
    assert.equal(result.revoked.length,2,'temporary script URLs are released');
    assert.ok(result.scriptLoads.filter(url=>!url.startsWith('blob:')).every(url=>url.startsWith(scope+'vendor/')));
    const link=result.window.document.getElementById('maplibre-css'),fallback=link.nextElementSibling;
    assert.equal(fallback.tagName,'STYLE');
    assert.match(fallback.textContent,/maplibregl-map/);
    assert.ok(fallback.nextElementSibling.href.includes('app.css'),'app styling keeps priority over recovered MapLibre CSS');
    assert.equal(fetched.length,before,'cache recovery makes no network request, including to the old CDN');
  } finally {result.dom.window.close();}
});

test('new app recovers verified already-patched first-party cache bytes without a second patch',async()=>{
  const scope='https://example.org/openrailwaystyle/';
  const caches={keys:async()=>['atlas-shell-24'],open:async()=>({match:async url=>{
    if(url===scope)return new Response(html,{headers:{'content-type':'text/html'}});
    const library=legacyDistributions.find(library=>new URL(library.target,scope).href===url);
    if(!library)return undefined;
    return new Response(library.patchedBody||library.body,{headers:{'content-type':library.target.endsWith('.css')?'text/css':'text/javascript'}});
  }})};
  const result=await start({cacheOnlyLibraries:caches});
  try {
    assert.equal(result.maps.length,1);
    assert.deepEqual(result.errors,[]);
    assert.equal(result.scriptLoads.filter(url=>url.startsWith('blob:')).length,2);
    assert.equal(result.revoked.length,2);
  } finally {result.dom.window.close();}
});

test('legacy startup recovery ignores unrelated caches and non-JavaScript saved responses',async()=>{
  const requested=[];
  const caches={keys:async()=>['unrelated-cache','atlas-shell-22'],open:async name=>{
    assert.equal(name,'atlas-shell-22');
    return {match:async url=>{requested.push(url);return new Response('not executable',{headers:{'content-type':'text/plain'}});}};
  }};
  const result=await start({cacheOnlyLibraries:caches});
  try {
    assert.equal(result.maps.length,0);
    assert.equal(result.scriptLoads.filter(url=>url.startsWith('blob:')).length,0);
    assert.equal(result.window.document.getElementById('maplibre-css').nextElementSibling.tagName,'LINK');
    assert.ok(result.scriptLoads.every(url=>url.startsWith('https://example.org/openrailwaystyle/vendor/')));
    assert.ok(requested.length>0);
  } finally {result.dom.window.close();}
});
for(const mode of ['tampered-bytes','crypto-unavailable'])test(`legacy startup recovery rejects ${mode} even with HTTP 200 and correct MIME`,async()=>{
  const served=[];
  const caches={keys:async()=>['atlas-shell-22'],open:async()=>({match:async url=>{
    if(url==='https://example.org/openrailwaystyle/')return new Response(html,{headers:{'content-type':'text/html'}});
    const library=legacyDistributions.find(library=>library.url===url);
    if (!library) return undefined;
    const body=mode==='tampered-bytes'?Buffer.concat([library.body,Buffer.from('\n/* modified cached distribution */')]):library.body;
    const type=library.target.endsWith('.css')?'text/css':'application/javascript';
    served.push({url,status:200,type});
    return new Response(body,{status:200,headers:{'content-type':type}});
  }})};
  const result=await start({cacheOnlyLibraries:caches,noLegacyCrypto:mode==='crypto-unavailable'});
  try {
    assert.equal(result.maps.length,0);
    assert.equal(result.scriptLoads.filter(url=>url.startsWith('blob:')).length,0,'unverified bytes must never become an executable blob');
    assert.equal(result.window.document.getElementById('maplibre-css').nextElementSibling.tagName,'LINK','unverified CSS must never be inserted');
    assert.ok(result.scriptLoads.every(url=>url.startsWith('https://example.org/openrailwaystyle/vendor/')),'there is no network fallback to the CDN');
    assert.equal(served.length,mode==='tampered-bytes'?3:0,'all three valid-MIME responses reach integrity verification, or fail closed before reading without crypto');
  } finally {result.dom.window.close();}
});
test('installation help works before renderer libraries load and after WebGL initialization fails', async t => {
  for (const options of [{delayLibraries: true}, {failWebGL: true}]) await t.test(JSON.stringify(options), async () => {
    const {dom, window, maps} = await start(options);
    try {
      const get = id => window.document.getElementById(id);
      assert.equal(maps.length, 0, 'the renderer is unavailable in both cases');
      assert.equal(get('pwa-install-open').hidden, false);
      get('pwa-install-open').focus();
      get('pwa-install-open').click();
      assert.equal(get('pwa-install').open, true);
      assert.equal(get('pwa-install-generic').hidden, false);
      get('pwa-install-close').click();
      assert.equal(get('pwa-install').open, false);
      assert.equal(window.document.activeElement, get('pwa-install-open'));
    } finally { dom.window.close(); }
  });
});
test('a complete installed Chinese font is used without any download',async()=>{
 const {dom,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true,installedFonts:{'Noto Sans CJK TC':ALL_PROBES}});
 try{
  assert.equal(fonts.length,1,'only the 676-byte probe font');assert.equal(fonts[0].family,'Atlas Probe');
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));
  const map=maps[0];map.handlers['style.load']();await new Promise(r=>setTimeout(r,0));
  assert.equal(map.styleOptions?.localIdeographFontFamily??map.options.localIdeographFontFamily,'"Noto Sans CJK TC","Atlas Rare Han",sans-serif');
  const glyphs=new dom.window.CanvasRenderingContext2D();glyphs.font='400 24px "Noto Sans CJK TC",sans-serif';
  assert.equal(glyphs.lang,'zh-TW');assert.equal(fonts.length,1,'drawing Han labels with a complete font downloads nothing');assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('a partial installed Chinese font fetches the packaged font only once Han labels are drawn, for the current script',async()=>{
 // Microsoft JhengHei: Big5 without Simplified forms or Extension B.
 const {dom,window,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true,installedFonts:{'Microsoft JhengHei':'頓嘢冧俆㜏駅峠畑\uF900\uFA11㐀㙟','Microsoft YaHei':'顿頓嘢冧俆㜏駅峠畑\uF900\uFA11㐀㙟'}});
 try{
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));
  const map=maps[0];map.handlers['style.load']();await new Promise(r=>setTimeout(r,0));
  assert.equal(map.styleOptions.localIdeographFontFamily,'"Microsoft JhengHei","Atlas Rare Han",sans-serif','the best installed font meanwhile');
  assert.equal(fonts.length,1,'nothing is fetched before Han labels are drawn');
  const glyphs=new window.CanvasRenderingContext2D();glyphs.font='400 24px "Microsoft JhengHei",sans-serif';
  assert.equal(fonts.length,2);assert.match(fonts[1].url,/atlas-cjk-tc-v1\.woff2/);
  const language=window.document.getElementById('language');language.value='zh-Hans';language.dispatchEvent(new window.Event('change'));
  await new Promise(r=>setTimeout(r,0));
  fonts[1].finish();await new Promise(r=>setTimeout(r,0));assert.ok(!map.styleOptions.localIdeographFontFamily.includes('Atlas CJK TC'),'a stale download cannot overwrite the selected script');
  glyphs.font='400 24px "Microsoft YaHei",sans-serif';
  assert.equal(fonts.length,3);assert.match(fonts[2].url,/atlas-cjk-sc-v1\.woff2/);
  fonts[2].finish();await new Promise(r=>setTimeout(r,0));assert.equal(map.styleOptions.localIdeographFontFamily,'"Atlas CJK SC","Atlas Rare Han"');
  assert.ok(map.options.style.layers.filter(l=>l.type==='symbol'&&l.layout?.['text-font']).every(l=>l.layout['text-font'].includes('Atlas CJK SC')),'explicit Noto stacks must also include the loaded Han font');
  assert.match(map.options.style.glyphs,/^atlasglyph:\/\//,'Latin glyph requests strip the added local family');
  language.value='zh-Hant';language.dispatchEvent(new window.Event('change'));assert.equal(fonts.length,3);assert.equal(map.styleOptions.localIdeographFontFamily,'"Atlas CJK TC","Atlas Rare Han"','previously loaded font is reused');
  assert.ok(map.options.style.layers.filter(l=>l.type==='symbol'&&l.layout?.['text-font']).every(l=>l.layout['text-font'].includes('Atlas CJK TC')&&!l.layout['text-font'].includes('Atlas CJK SC')),'switching script replaces every explicit local font');
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('a failed packaged Chinese font download waits before trying again, and retries when back online',async()=>{
 const {dom,window,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true,installedFonts:{'Microsoft JhengHei':'頓嘢冧俆㜏駅峠畑\uF900\uFA11㐀㙟'}});
 const warn=console.warn;console.warn=()=>{};
 try{
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));maps[0].handlers['style.load']();await new Promise(r=>setTimeout(r,0));
  const glyphs=new window.CanvasRenderingContext2D();glyphs.font='400 24px "Microsoft JhengHei",sans-serif';
  assert.equal(fonts.length,2);fonts[1].fail();await new Promise(r=>setTimeout(r,0));
  for(let i=0;i<5;i++)glyphs.font='400 24px "Microsoft JhengHei",sans-serif';
  assert.equal(fonts.length,2,'later label drawing does not fetch the font again at once');
  assert.equal(maps[0].styleOptions.localIdeographFontFamily,'"Microsoft JhengHei","Atlas Rare Han",sans-serif','the installed font stays in use');
  window.dispatchEvent(new window.Event('online'));glyphs.font='400 24px "Microsoft JhengHei",sans-serif';
  assert.equal(fonts.length,3,'going back online retries');
  assert.deepEqual(errors,[]);
 }finally{console.warn=warn;dom.window.close();}
});

test('Japanese labels keep the installed Japanese font even when it is partial',async()=>{
 const {dom,window,maps,fonts}=await start({search:'?language=ja',fontFaces:true,installedFonts:{'Yu Gothic':'頓駅峠畑\uF900\uFA11㐀'}});
 try{
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));maps[0].handlers['style.load']();await new Promise(r=>setTimeout(r,0));
  const glyphs=new window.CanvasRenderingContext2D();glyphs.font='400 24px "Yu Gothic",sans-serif';
  assert.equal(glyphs.lang,'ja');assert.equal(fonts.length,1,'the packaged fonts are Chinese designs');
 }finally{dom.window.close();}
});

test('unavailable Chinese font preserves a working map and system fallback',async()=>{
 const {dom,window,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true});
 try{assert.deepEqual(errors,[]);maps[0].handlers['style.load']();fonts[0].fail();await new Promise(r=>setTimeout(r,0));assert.equal(window.document.body.dataset.mapReady,'true');assert.match(maps[0].options.localIdeographFontFamily,/Noto Sans TC/);}finally{dom.window.close();}
});

test('clicked station, service, entrance, power and context details share the selected regional font',async()=>{
 const fetcher=async url=>({ok:true,json:async()=>String(url).includes('power-facilities.geojson')?{type:'FeatureCollection',features:[]}:structuredClone(style)});
 const {dom,window,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true,installedFonts:{'Noto Sans CJK TC':ALL_PROBES,'Yu Gothic':ALL_PROBES,'Malgun Gothic':ALL_PROBES},fetcher});
 try{
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));
  const doc=window.document,map=maps[0],panel=doc.getElementById('detail-content');map.handlers['style.load']();
  map.project=([lng,lat])=>({x:500+lng*100,y:400+lat*100});
  const point={type:'Point',coordinates:[0,0]};
  const cases=[
   ['speed',{source:'stations',layer:{id:'station-detail-large-names'},properties:{name:'中央站',state:'disused'},geometry:point},'中央站'],
   ['service',{source:'serviceRoutes',layer:{id:'service-routes'},properties:{name:'山海線',kind:'rail',i:0,n:1},geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}},'山海線'],
   ['infrastructure',{source:'stationEntrances',layer:{id:'infrastructure-entrance-points'},properties:{id:456,label:'北出口'},geometry:point},'北出口'],
   ['electrification',{source:'electricFacilities',layer:{id:'electrification-supply-points'},properties:{name:'南部水塔',power_kind:'water_tank'},geometry:point},'南部水塔'],
   ['infrastructure',{source:'openmaptiles',sourceLayer:'poi',layer:{id:'context-transport-bus-label'},properties:{name:'東部轉車站',class:'bus',subclass:'bus_station'},geometry:point},'東部轉車站'],
  ];
  for(const [mode,feature,name] of cases){
   doc.querySelector(`[data-mode="${mode}"]`).click();map.rendered=[feature];
   map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
   await new Promise(r=>setTimeout(r,0));
   assert.equal(doc.getElementById('details').hidden,false);
   assert.equal(panel.querySelector('h2').textContent,name);
   assert.equal(panel.querySelector('h2 [lang]').lang,'zh-TW');assert.match(panel.querySelector('h2 [lang]').style.fontFamily,/^"?Noto Sans CJK TC"?,/);
   assert.equal(panel.style.fontFamily,'','the shared panel does not override the interface font');
   for(const node of panel.querySelectorAll('.eyebrow,dt,p.small,a'))assert.equal(node.closest('[lang]')?.lang,'en','fixed English infobox text keeps its language');
   assert.match(panel.querySelector('h2 [lang]').style.fontFamily,/Atlas Rare Han/);
  }
  const language=doc.getElementById('language');
  for(const [code,family] of [['ja','Yu Gothic'],['ko','Malgun Gothic']]){
   language.value=code;language.dispatchEvent(new window.Event('change'));
   await new Promise(r=>setTimeout(r,0));
   assert.equal(panel.querySelector('h2 [lang]').lang,code,'Han runs follow the selected glyph language after the infobox redraw');
   assert.equal(panel.querySelector('h2 [lang]').style.fontFamily.split(',')[0].replaceAll('"',''),family);
  }
  language.value='zh-Hant';language.dispatchEvent(new window.Event('change'));
  doc.querySelector('[data-mode="speed"]').click();
  map.rendered=[{source:'stations',layer:{id:'station-detail-large-names'},properties:{name:'Central',state:'disused',operator:'Regional Rail 東京'},geometry:point}];
  map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});await new Promise(r=>setTimeout(r,0));
  assert.equal(panel.querySelector('h2').textContent,'Central');assert.equal(panel.querySelector('h2').style.fontFamily,'');
  const han=panel.querySelector('dd [lang]');assert.equal(han.textContent,'東京');assert.match(han.style.fontFamily,/^"?Noto Sans CJK TC"?,/);
  assert.deepEqual([...panel.querySelectorAll('[style]')].filter(node=>node.style.fontFamily),[han],'even a complete installed CJK font is applied only to the Han text, never Latin names or English UI');
  assert.equal(doc.documentElement.lang,'en','the surrounding English interface keeps its language');
  assert.equal(panel.closest('[lang]')?.lang,'en','the infobox container retains the interface language');
  assert.equal(fonts.length,1,'complete regional fonts need only the small probe');assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('English and local infoboxes scope script languages to CJK runs and preserve English text',async()=>{
 for(const language of ['en','local','zh-Hant']){
  const {dom,window,maps,errors}=await start({search:`?language=${language}`});
  try{
   const doc=window.document,map=maps[0],panel=doc.getElementById('detail-content');map.handlers['style.load']();
   const station={source:'stations',layer:{id:'station-detail-large-names'},properties:{name:'Central 東京 | 東京メトロ | 東京・テレポート | 東京･ﾒﾄﾛ | 首都圈·전철 | 경의-中央線 | 東京　メトロ | 大韓민국 | 北ㄅ | カナ | ｶﾞ | ﾊﾟ | カ゛ | ハ゜ | 한글 | ㄅㄆ | 東京・Metro',state:'disused',station_size:'large',operator:'Regional Rail'},geometry:{type:'Point',coordinates:[0,0]}};
   map.rendered=[station];map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
   await new Promise(r=>setTimeout(r,0));
   const heading=panel.querySelector('h2');assert.equal(heading.textContent,station.properties.name,'wrapping never changes the recorded text');
   assert.equal(heading.firstChild.data,'Central ');assert.equal(heading.firstChild.parentElement.closest('[lang]')?.lang,'en','the Latin part of a mixed name keeps English');
   const hanLanguage=language==='zh-Hant'?'zh-TW':'zh-CN';
   assert.deepEqual([...heading.querySelectorAll('[lang]')].map(span=>[span.textContent,span.lang]),[['東京',hanLanguage],['東京メトロ','ja'],['東京・テレポート','ja'],['東京･ﾒﾄﾛ','ja'],['首都圈·전철','ko'],['경의-中央線','ko'],['東京　メトロ','ja'],['大韓민국','ko'],['北ㄅ','zh-TW'],['カナ','ja'],['ｶﾞ','ja'],['ﾊﾟ','ja'],['カ゛','ja'],['ハ゜','ja'],['한글','ko'],['ㄅㄆ','zh-TW'],['東京',hanLanguage]],'internal punctuation and ideographic spaces keep mixed CJK names in one language');
   const latinSuffix=[...heading.childNodes].find(node=>node.nodeType===3&&node.data.includes('・Metro'));
   assert.ok(latinSuffix,'a separator followed by Latin text stays outside the CJK span');assert.equal(latinSuffix.parentElement.closest('[lang]')?.lang,'en');
   for(const node of [panel,heading,...panel.querySelectorAll('.eyebrow,dt,p.small,a')])assert.equal(node.closest('[lang]')?.lang,'en',`${language}: the CJK fallback must not relabel the English interface`);
   assert.equal(panel.style.fontFamily,'');assert.equal(heading.style.fontFamily,'');
   for(const [name,scriptLanguage] of [['東京',hanLanguage],['東京 テレポート','ja'],['東京\u00a0テレポート','ja'],['경의 중앙線','ko'],['首都圈 전철','ko'],['首都圈\u00a0전철','ko'],['東京メトロ1号線','ja'],['東京メトロ 1号線','ja'],['ㄊㄞˊ ㄅㄟˇ','zh-TW'],['ㄅˉ ㄅˊ ㄅˇ ㄅˋ ㄅ˙ ㄅ˪ ㄅ˫','zh-TW'],['˙ㄉㄜ','zh-TW'],['ㄊㄞˊ ˙ㄉㄜ','zh-TW']]){
    station.properties.name=name;map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
    await new Promise(r=>setTimeout(r,0));
    const spacedHeading=panel.querySelector('h2');
    assert.equal(spacedHeading.textContent,name,'wrapping preserves name whitespace and numbers');
    assert.deepEqual([...spacedHeading.querySelectorAll('[data-cjk-glyphs]')].map(span=>[span.textContent,span.lang]),[[name,scriptLanguage]],`${name}: internal spaces and numbers keep a name in one identified language`);
    assert.equal(spacedHeading.closest('[lang]')?.lang,'en','only the name span carries the script language');
   }
   for(const [name,names] of [
    ['東京・テレポート/서울교통공사',[['東京・テレポート','ja'],['서울교통공사','ko']]],
    ['東京メトロ;大韓민국',[['東京メトロ','ja'],['大韓민국','ko']]],
    ['東京メトロ・서울교통공사',[['東京メトロ','ja'],['서울교통공사','ko']]],
    ['東京メトロ서울교통공사',[['東京メトロ','ja'],['서울교통공사','ko']]],
    ['서울교통공사/東京・テレポート',[['서울교통공사','ko'],['東京・テレポート','ja']]],
    ['東京 メトロ / 서울교통공사',[['東京 メトロ','ja'],['서울교통공사','ko']]],
    ['東京メトロ / 경의 중앙線',[['東京メトロ','ja'],['경의 중앙線','ko']]],
    ['서울교통공사；東京\u00a0テレポート',[['서울교통공사','ko'],['東京\u00a0テレポート','ja']]],
    ['東京 メトロ・경의 중앙線',[['東京 メトロ','ja'],['경의 중앙線','ko']]],
    ['東京 メトロ 서울교통공사',[['東京 メトロ','ja'],['서울교통공사','ko']]],
    ['カナ˙ㄉㄜ',[['カナ','ja'],['˙ㄉㄜ','zh-TW']]],
   ]){
    station.properties.name=name;map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
    await new Promise(r=>setTimeout(r,0));
    const mixedHeading=panel.querySelector('h2');
    assert.equal(mixedHeading.textContent,name,'splitting languages preserves exact punctuation and text');
    assert.deepEqual([...mixedHeading.querySelectorAll('[data-cjk-glyphs]')].map(span=>[span.textContent,span.lang]),names,`${name}: conflicting script hints keep separate name languages`);
    assert.equal(mixedHeading.closest('[lang]')?.lang,'en','separators keep the surrounding interface language');
   }
   station.properties.name='Central';map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
   await new Promise(r=>setTimeout(r,0));
   assert.equal(panel.querySelector('h2').closest('[lang]')?.lang,'en','a Latin-only feature name keeps its inherited language');
   assert.equal(panel.querySelectorAll('[lang]').length,0,'English-only content needs no script wrappers');assert.deepEqual(errors,[]);
  }finally{dom.window.close();}
 }
});

test('infobox Han text requests the packaged font after probing without requiring map glyph drawing',async()=>{
 const {dom,window,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true,installedFonts:{'Microsoft JhengHei':'頓嘢冧俆㜏駅峠畑\uF900\uFA11㐀㙟'}});
 try{
  const doc=window.document,map=maps[0],panel=doc.getElementById('detail-content');map.handlers['style.load']();
  const station={source:'stations',layer:{id:'station-detail-large-names'},properties:{name:'Central',state:'disused'},geometry:{type:'Point',coordinates:[0,0]}};
  map.rendered=[station];map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
  await new Promise(r=>setTimeout(r,0));assert.equal(fonts.length,1,'an English-only infobox does not request a CJK bundle');
  station.properties.operator='東海旅客鉄道';map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
  await new Promise(r=>setTimeout(r,0));assert.equal(fonts.length,1,'the probe is still pending');
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));
  assert.equal(panel.querySelector('h2').textContent,'Central');assert.match(panel.textContent,/東海旅客鉄道/);
  assert.equal(panel.querySelector('h2').closest('[lang]')?.lang,'en');
  assert.equal(panel.querySelector('dd [lang]').lang,'zh-TW','the Han operator value carries its own regional language');
  const packaged=fonts.find(f=>f.family==='Atlas CJK TC');assert.ok(packaged,'Han in a body value needs the font even though the heading is Latin');
  assert.match(panel.querySelector('dd [lang]').style.fontFamily,/^"?Microsoft JhengHei"?,/);
  packaged.finish();await new Promise(r=>setTimeout(r,0));
  assert.match(panel.querySelector('dd [lang]').style.fontFamily,/^"?Atlas CJK TC"?,/);assert.match(panel.querySelector('dd [lang]').style.fontFamily,/Atlas Rare Han/);
  assert.equal(panel.style.fontFamily,'','English text keeps its interface font while the CJK-only package is loaded');
  assert.equal(fonts.length,2,'the infobox and redraw share one package load');assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('an open infobox follows language and font changes while map style loading is delayed',async()=>{
 const {dom,window,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true,installedFonts:{'Microsoft JhengHei':'頓嘢冧俆㜏駅峠畑\uF900\uFA11㐀㙟','Microsoft YaHei':'顿頓嘢冧俆㜏駅峠畑\uF900\uFA11㐀㙟'}});
 try{
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));
  const doc=window.document,map=maps[0],panel=doc.getElementById('detail-content'),language=doc.getElementById('language');map.handlers['style.load']();
  map.rendered=[{source:'stations',layer:{id:'station-detail-large-names'},properties:{name:'漢岛',state:'disused'},geometry:{type:'Point',coordinates:[0,0]}}];
  map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});await new Promise(r=>setTimeout(r,0));
  const traditional=fonts.find(f=>f.family==='Atlas CJK TC');assert.ok(traditional);
  // Keep the style callback pending as it is when map resources load slowly.
  map.setStyle=(style,options)=>{map.options.style=style;map.styleOptions=options;};
  language.value='zh-Hans';language.dispatchEvent(new window.Event('change'));
  assert.equal(panel.querySelector('h2 [lang]').lang,'zh-CN');assert.doesNotMatch(panel.querySelector('h2 [lang]').style.fontFamily,/JhengHei|CJK TC/);
  await new Promise(r=>setTimeout(r,0));
  assert.match(panel.querySelector('h2 [lang]').style.fontFamily,/^"?Microsoft YaHei"?,/);
  const simplified=fonts.find(f=>f.family==='Atlas CJK SC');assert.ok(simplified);
  traditional.finish();await new Promise(r=>setTimeout(r,0));
  assert.doesNotMatch(panel.querySelector('h2 [lang]').style.fontFamily,/CJK TC/,'a stale Traditional download cannot replace the selected Simplified font');
  simplified.finish();await new Promise(r=>setTimeout(r,0));
  assert.match(panel.querySelector('h2 [lang]').style.fontFamily,/^"?Atlas CJK SC"?,/,'the loaded font reaches the open infobox before the map style finishes');
  language.value='zh-Hant';language.dispatchEvent(new window.Event('change'));
  assert.equal(panel.querySelector('h2 [lang]').lang,'zh-TW');assert.match(panel.querySelector('h2 [lang]').style.fontFamily,/^"?Atlas CJK TC"?,/,'switching back immediately reuses the finished font');
  assert.equal(panel.style.fontFamily,'');
  assert.equal(panel.closest('[lang]')?.lang,'en');
  assert.equal(fonts.length,3);assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('rare Han in infobox body values and later departure text loads only the displayed slices',async()=>{
 let completeBoard;
 const board=new Promise(resolve=>{completeBoard=resolve;}),requests=[];
 const fetcher=async url=>{requests.push(String(url));return {ok:true,status:200,json:async()=>String(url).includes('rare-han-v1/index.json')?{blocks:[0x2a7,0x2a8,0x2a9,0x2aa]}:structuredClone(style)};};
 const {dom,window,maps,fonts,errors}=await start({search:'?language=zh-Hant',fontFaces:true,installedFonts:{'Noto Sans CJK TC':ALL_PROBES},fetcher,departureLoader:()=>board});
 const slice=block=>fonts.find(f=>f.url.includes(`rare-han-v1/${block}.woff2`));
 const waitForSlice=async block=>{for(let i=0;i<100&&!slice(block);i++)await new Promise(r=>setTimeout(r,0));assert.ok(slice(block),`${block}: displayed text requests its glyph slice`);slice(block).finish();await new Promise(r=>setTimeout(r,0));};
 try{
  fonts[0].finish();await new Promise(r=>setTimeout(r,0));
  const doc=window.document,map=maps[0],panel=doc.getElementById('detail-content');map.handlers['style.load']();
  assert.ok(!requests.some(url=>url.includes('rare-han-v1')),'no slices are needed before inspecting the feature');
  map.rendered=[{source:'stations',layer:{id:'station-detail-large-names'},properties:{name:'Central',operator:'Operator \u{2A700}',description:'Unshown \u{2AA00}'},geometry:{type:'Point',coordinates:[0,0]}}];
  map.handlers.click({point:{x:500,y:400},lngLat:{lng:0,lat:0}});
  assert.equal(doc.getElementById('details').hidden,false,'the infobox opens without waiting for a font');
  assert.equal(panel.querySelector('h2').textContent,'Central');await waitForSlice('2a7');
  completeBoard({stops:[{id:'fixture:central'}],rows:[{line:'R',headsign:'Destination \u{2A800}',departure:0,tz:'UTC',mode:'RAIL'}]});
  await waitForSlice('2a8');
  const headsign=panel.querySelector('.departure-headsign');assert.equal(headsign.textContent,'Destination \u{2A800}');
  assert.equal(headsign.firstChild.data,'Destination ');assert.equal(headsign.closest('[lang]')?.lang,'en');
  const han=headsign.querySelector('[lang]');assert.equal(han.lang,'zh-TW');
  han.firstChild.data='\u{2A900}';await waitForSlice('2a9');assert.equal(headsign.textContent,'Destination \u{2A900}');
  han.firstChild.data='Extra \u{2A900}';await new Promise(r=>setTimeout(r,0));
  assert.equal(headsign.textContent,'Destination Extra \u{2A900}');assert.equal(headsign.querySelector('[lang]').textContent,'\u{2A900}','changing a CJK run to mixed text leaves its new English part outside the language span');
  headsign.querySelector('[lang]').firstChild.data='Central';await new Promise(r=>setTimeout(r,0));
  assert.equal(headsign.textContent,'Destination Extra Central');assert.equal(headsign.querySelector('[lang]'),null,'a run changed entirely to Latin no longer carries a CJK language');
  assert.equal(slice('2aa'),undefined,'unrendered feature properties do not download extra font slices');
  assert.equal(fonts.filter(f=>f.family==='Atlas Rare Han').length,3,'the original body is not downloaded again as asynchronous content arrives');
  assert.equal(requests.filter(url=>url.includes('rare-han-v1/index.json')).length,1);assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('service frequency profile is applied on the first frame and controls persist independently',async()=>{
  const {dom,window,maps,errors}=await start({search:'?mode=service&serviceWidth=frequency&frequencyPeriod=peak&peakPhase=pm'});
  try {
    assert.equal(errors.length,0);
    const doc=window.document, map=maps[0];
    assert.equal(doc.getElementById('service-frequency-options').hidden,false);
    assert.equal(doc.getElementById('peak-phase-options').hidden,false);
    assert.equal(doc.getElementById('peak-phase').value,'pm');
    const first=map.options.style.layers.find(l=>l.id==='service-routes').paint;
    assert.match(JSON.stringify(first['line-width']),/frequency_width_pm/);
    map.handlers['style.load']();
    const period=doc.getElementById('frequency-period');period.value='offpeak';period.dispatchEvent(new window.Event('change'));
    assert.match(JSON.stringify(map.paintProperties['service-routes']['line-offset']),/frequency_offset_offpeak/);
    assert.equal(doc.getElementById('peak-phase-options').hidden,true);
    assert.match(decodeURIComponent(doc.cookie),/"frequencyPeriod":"offpeak"/);
    period.value='overnight';period.dispatchEvent(new window.Event('change'));
    assert.match(JSON.stringify(map.paintProperties['service-routes']['line-width']),/frequency_width_overnight/);
    period.value='hour';period.dispatchEvent(new window.Event('change'));
    const hour=doc.getElementById('frequency-hour');hour.value='1';hour.dispatchEvent(new window.Event('change'));
    assert.equal(doc.getElementById('frequency-hour-options').hidden,false);
    assert.match(JSON.stringify(map.paintProperties['service-routes']['line-width']),/frequency_width_h01/);
    assert.match(decodeURIComponent(doc.cookie),/"frequencyHour":1/);
    const width=doc.getElementById('service-width');width.value='equal';width.dispatchEvent(new window.Event('change'));
    assert.equal(doc.getElementById('frequency-profile-options').hidden,true);
    assert.doesNotMatch(JSON.stringify(map.paintProperties['service-routes']['line-width']),/frequency_width/);
    doc.querySelector('[data-mode="speed"]').click();
    assert.equal(doc.getElementById('service-frequency-options').hidden,true);
  } finally {dom.window.close();}
});
test('frequency periods no applied source covers are not offered, and a link to one falls back',async()=>{
  const fetcher=async url=>String(url).includes('frequency-manifest.json')?{ok:true,json:async()=>({profiles:['am','pm','offpeak']})}:{ok:true,json:async()=>structuredClone(style)};
  const {dom,window,errors}=await start({search:'?mode=service&serviceWidth=frequency&frequencyPeriod=overnight',fetcher});
  try {
    assert.equal(errors.length,0);
    for(let i=0;i<20&&!window.document.querySelector('#frequency-period option[value="overnight"]').hidden;i++)await new Promise(r=>setTimeout(r,0));
    const options=Object.fromEntries([...window.document.getElementById('frequency-period').options].map(o=>[o.value,o.hidden]));
    assert.deepEqual(options,{offpeak:false,peak:false,overnight:true,hour:true});
    assert.equal(window.document.getElementById('frequency-period').value,'offpeak','a period without a source falls back');
    assert.doesNotMatch(window.document.getElementById('legend').textContent,/Overnight and individual hours/,'the legend does not describe uncovered periods');
  } finally {dom.window.close();}
});
test('equal-width service details expire even after the inspected route leaves loaded tiles',async()=>{
  let stamp=1000,scheduled;
  const frequencyClock={now:()=>stamp,setTimer:(fn,delay)=>(scheduled={fn,delay}),clearTimer:()=>{scheduled=undefined;}};
  const {dom,window,maps,errors}=await start({search:'?mode=service',frequencyClock});
  try{
    const map=maps[0],doc=window.document;map.handlers['style.load']();
    map.project=([lng,lat])=>({x:500+lng*100,y:400+lat*100});
    const feature={source:'serviceRoutes',sourceLayer:'service_routes',layer:{id:'service-routes'},properties:{id:'gtfs:fixture:R',ref:'R',kind:'rail',i:0,n:1,frequency_until:2,frequency_offpeak:2,frequency_high_offpeak:2,frequency_quality_offpeak:'scheduled'},geometry:{type:'LineString',coordinates:[[0,0],[1,0]]}};
    map.rendered=[feature];map.sourceFeatures=[feature];map.handlers.sourcedata({sourceId:'serviceRoutes',tile:{}});
    map.handlers.click({point:{x:550,y:400},lngLat:{lng:.5,lat:0}});
    assert.match(doc.getElementById('detail-content').textContent,/2\/h\/direction/);
    map.sourceFeatures=[];map.handlers.sourcedata({sourceId:'serviceRoutes',tile:{}});
    assert.equal(scheduled?.delay,1001,'the open panel keeps its expiry when the route leaves the viewport');
    stamp=2001;scheduled.fn();
    assert.doesNotMatch(doc.getElementById('detail-content').textContent,/2\/h\/direction/);
    assert.match(doc.getElementById('detail-content').textContent,/Frequency unavailable/);
    assert.equal(errors.length,0);
    window.dispatchEvent(new window.Event('pagehide'));
  }finally{dom.window.close();}
});
test('app starts with the MapLibre 5 API and enables map controls', async () => {
  const {dom,window,maps,errors} = await start();
  try {
    assert.equal(maps.length,1,'startup must reach the map constructor');
    assert.equal(errors.length,0);
    // Bathymetry must not win a startup race by making the basemap PMTiles
    // archive with PMTiles' untimed default FetchSource.
    assert.equal(maps.pmtiles.tiles.size,1);
    const [[basemapKey,basemap]]=[...maps.pmtiles.tiles];
    assert.match(basemapKey,/planet\.pmtiles$/);
    assert.equal(basemap.source.ms,20000);
    assert.equal(basemap.source.inner.url,basemapKey);
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
    assert.deepEqual(['satellite','water','terrain-bathymetry','infrastructure-tracks','station-stations-dots'].map(id => maps[0].visibility[id]), ['visible','none','none','none','none']);
    window.document.querySelector('[data-background="hybrid"]').click();
    assert.deepEqual(['satellite','water','terrain-relief','terrain-bathymetry','infrastructure-tracks','station-stations-dots'].map(id => maps[0].visibility[id]), ['visible','none','none','none','visible','visible']);
    window.document.querySelector('[data-background="map"]').click();
    assert.deepEqual(['satellite','water','terrain-relief','terrain-bathymetry','infrastructure-tracks','structure-bridge-edge'].map(id => maps[0].visibility[id]), ['none','visible','visible','visible','visible','visible']);
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

test('curated hub names with rare Han wait for their slices before reaching the map',async()=>{
 const penn=style.sources.stationMajor.data.features.find(f=>f.properties.wikidata==='Q54451');
 const member=penn.properties.osm_ids.split(';').concat([penn.properties.id])[0];
 const fetcher=async url=>String(url).includes('rare-han-v1/index.json')?{ok:true,status:200,json:async()=>({blocks:[0x2a7]})}:{ok:true,status:200,json:async()=>structuredClone(style)};
 const stationTile=async(url,lang)=>{
  const result=encodeTile.fromGeojsonVt({standard_railway_text_stations:{features:[{type:1,id:1,tags:{id:`${member}-train-train-station`,name:'\u{2A700}站',atlas_name:'\u{2A700}站',atlas_language:lang},geometry:[[2049,2048]]}]}},{version:2});
  return result.buffer.slice(result.byteOffset,result.byteOffset+result.byteLength);};
 const {dom,maps,fonts}=await start({search:'?language=local#3/40.75/-74',fetcher,stationTile,fontFaces:true});
 try{
  const map=maps[0],source=map.getSource.bind(map);
  map.getSource=id=>id==='stations'?{tiles:['atlasstation://local/https://tiles.test/stations/{z}/{x}/{y}']}:source(id);
  map.getBounds=()=>({getWest:()=>-80,getEast:()=>-70,getSouth:()=>35,getNorth:()=>45});
  map.handlers['style.load']();
  const slice=()=>fonts.find(f=>/rare-han-v1\/2a7\.woff2/.test(f.url));
  for(let i=0;i<100&&!slice();i++)await new Promise(r=>setTimeout(r,0));
  assert.ok(slice(),'the slice of the hub name is requested');
  const named=()=>map.sourceData?.stationMajor?.features.find(f=>f.properties.wikidata==='Q54451');
  assert.equal(named(),undefined,'the name waits for its slice');
  slice().finish();
  for(let i=0;i<50&&!named();i++)await new Promise(r=>setTimeout(r,0));
  assert.equal(named()?.properties.atlas_name,'\u{2A700}站');
 }finally{dom.window.close();}
});

test('tiles served as stored load the rare Han slices of their text, such as service route names',async()=>{
 const tile=name=>{const result=encodeTile.fromGeojsonVt({service_routes:{features:[{type:2,id:1,tags:{name,trains:268439664},geometry:[[[0,0],[4096,4096]]]}]}},{version:2});return result.buffer.slice(result.byteOffset,result.byteOffset+result.byteLength);};
 const tiles={'8/1/1':tile('\u{2A700}線'),'8/1/2':tile('Plain line')};
 const fetcher=async url=>{url=String(url);
  if(url.includes('rare-han-v1/index.json'))return {ok:true,status:200,json:async()=>({blocks:[0x2a7]})};
  if(url.includes('service-routes/index.json'))return {ok:true,status:200,json:async()=>({tiles:Object.keys(tiles)})};
  const key=/service-routes\/(\d+\/\d+\/\d+)\.pbf\.gz/.exec(url)?.[1];
  if(key)return {ok:true,status:200,arrayBuffer:async()=>tiles[key].slice(0)};
  return {ok:true,status:200,json:async()=>structuredClone(style)};};
 const {dom,maps,fonts}=await start({fetcher,fontFaces:true});
 try{
  for(let i=0;i<100&&!maps.protocols.servicetiles;i++)await new Promise(r=>setTimeout(r,0));
  const plain=await maps.protocols.servicetiles({url:'servicetiles://8/1/2'},new AbortController());
  assert.ok(plain.data.byteLength>0);assert.equal(fonts.filter(f=>/rare-han/.test(f.url)).length,0,'a number whose bytes look like UTF-8 loads nothing');
  let done=false;const pending=maps.protocols.servicetiles({url:'servicetiles://8/1/1'},new AbortController()).then(r=>{done=true;return r;});
  const slice=()=>fonts.find(f=>/rare-han-v1\/2a7\.woff2/.test(f.url));
  for(let i=0;i<100&&!slice();i++)await new Promise(r=>setTimeout(r,0));
  assert.ok(slice(),'the route name requests its slice');assert.equal(done,false,'the tile waits for it');
  slice().finish();assert.ok((await pending).data.byteLength>0);
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
    assert.deepEqual(errors,[]);const map=maps[0];map.handlers['style.load']();map.zoom=14;
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
  assert.deepEqual(errors,[]);const map=maps[0];map.handlers['style.load']();map.zoom=19;
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
    assert.equal(doc.getElementById('service-width').value,'equal','basic Service remains the default in watch mode');
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

test('rail tile recovery updates visible app status without idle, after bookkeeping, including early style events', async () => {
  for (const early of [false, true]) {
    const f = await recoveryApp({early});
    try {
      if (early) f.map.queryRenderedFeatures = () => {throw new Error('style is not ready');};
      const tile = failedRailTile();f.fail(tile);
      assert.equal(f.status.classList.contains('error'), true);
      tile.state = 'loaded';f.data({tile, isSourceLoaded:true});
      assert.equal(f.status.classList.contains('error'), false, 'recovered tile clears status without an idle event');
      assert.match(f.status.textContent, /Explore the rail network/);
      f.data({tile, isSourceLoaded:true});
      assert.equal(f.status.classList.contains('error'), false, 'duplicate success is harmless');
      assert.equal(f.clock.timers.size, 0);assert.deepEqual(f.clock.retries, []);
    } finally {f.close();}
  }
});

test('partial rail recovery and loaded-but-errored sources retain the outage state without extra retries', async () => {
  const f = await recoveryApp();
  try {
    const a = failedRailTile(), b = failedRailTile(2);f.fail(a);f.fail(b);
    f.data({isSourceLoaded:true});f.data({tile:a, isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), true);
    a.state = 'loaded';f.data({tile:a, isSourceLoaded:true});
    assert.match(f.status.textContent, /Retrying automatically/);
    assert.equal(f.clock.timers.size, 1);
    b.state = 'loaded';f.data({tile:b, isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), false);
    assert.equal(f.clock.timers.size, 0);assert.deepEqual(f.clock.retries, []);
  } finally {f.close();}
});

test('rail recovery preserves unrelated app errors until actual unrelated success', async () => {
  const f = await recoveryApp();
  try {
    const tile = failedRailTile();f.fail(tile);
    f.map.handlers.error({sourceId:'openmaptiles', tile:{}, error:new Error('unrelated error')});
    tile.state = 'loaded';f.data({tile, isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), true);
    assert.match(f.status.textContent, /Some map data could not load/);
    f.map.handlers.sourcedata({sourceId:'openmaptiles', isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), true, 'loaded flag alone is not recovery');
    f.map.handlers.sourcedata({sourceId:'openmaptiles', tile:{state:'loaded'}, isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), false);
    assert.deepEqual(f.clock.retries, []);
  } finally {f.close();}
});

test('metadata recovery clears app bookkeeping without idle and cancellation is not an outage', async () => {
  const f = await recoveryApp();
  try {
    f.fail(undefined);f.data({isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), true);
    f.data({sourceDataType:'metadata', isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), false);
    f.map.handlers.error({sourceId:'railway', error:{name:'AbortError', message:'AbortError'}});
    assert.equal(f.status.classList.contains('error'), false);
    assert.equal(f.clock.timers.size, 0);assert.deepEqual(f.clock.retries, []);
  } finally {f.close();}
});

test('source replacement retires old recovery and disposal cancels every scheduled retry', async () => {
  const f = await recoveryApp();
  try {
    f.fail(failedRailTile());
    f.map.sources.railway = {url:'atlasrail://https://openrailwaymap.app/railway_line_high'};
    f.data({sourceDataType:'metadata', isSourceLoaded:true});
    assert.equal(f.status.classList.contains('error'), false);
    assert.equal(f.clock.timers.size, 0);
    f.fail(failedRailTile(3));assert.equal(f.clock.timers.size, 1);
    f.map.handlers.remove();assert.equal(f.clock.timers.size, 0);
    f.map.handlers.moveend();assert.equal(f.clock.timers.size, 0);
    assert.deepEqual(f.clock.retries, []);
  } finally {f.close();}
});


test('platform measurement fetches HTTP templates rather than MapLibre protocol URLs', async () => {
  let options;
  const {dom,maps}=await start({platformGeometryOptions:value=>{options=value;}});
  try {
    const map=maps[0];map.sources ||= {};
    assert.ok(options);
    for(const raw of ['https://openrailwaymap.app/standard_railway_platforms/{z}/{x}/{y}',
      'http://127.0.0.1:4173/review-station-tiles/standard_railway_platforms/{z}/{x}/{y}.pbf']) {
      map.sources.platforms={tiles:[`atlasrail://${raw}`]};
      assert.equal(options.tileURL(),raw,'measurement uses native fetch, not the renderer protocol dispatcher');
      map.sources.platforms={tiles:[raw]};assert.equal(options.tileURL(),raw,'unwrapped fallback stays valid');
    }
    map.sources.platforms={};assert.equal(options.tileURL(),undefined,'metadata not ready stays pending');
  } finally {maps[0].handlers.remove();dom.window.close();}
});

test('settings hide and show failed layers without pan or idle resumes exactly one recovery timer',async()=>{
 const f=await recoveryApp();
 try{
  f.fail(failedRailTile());assert.equal(f.clock.timers.size,1);
  const doc=f.window.document;
  for(let i=0;i<2;i++){
   doc.querySelector('[data-background="satellite"]').click();assert.equal(f.clock.timers.size,0);
   assert.equal(f.status.classList.contains('error'),true,'hidden failures remain retained');
   doc.querySelector('[data-background="map"]').click();assert.equal(f.clock.timers.size,1);
   const id=[...f.clock.timers.keys()][0];doc.querySelector('[data-mode="infrastructure"]').click();assert.deepEqual([...f.clock.timers.keys()],[id],'settings do not postpone an existing timer');
  }
  f.map.sources.railwaySignals={url:'atlastext://https://openrailwaymap.app/railway_signals'};f.map.zoom=18;
  f.map.handlers.error({sourceId:'railwaySignals',tile:failedRailTile(),error:{status:520}});
  const railway=f.map.sources.railway;f.map.sources.railway={url:railway.url};
  doc.querySelector('[data-mode="speed"]').click();assert.equal(f.clock.timers.size,0);
  doc.querySelector('[data-mode="infrastructure"]').click();assert.equal(f.clock.timers.size,1);
  f.map.handlers.remove();doc.querySelector('[data-mode="speed"]').click();doc.querySelector('[data-mode="infrastructure"]').click();assert.equal(f.clock.timers.size,0);
 }finally{f.close();}
});

test('off-screen retirement reconciles owned errors without source success and retains other failures',async()=>{
 const f=await recoveryApp();
 try{
  const a=failedRailTile(1),b=failedRailTile(2);f.fail(a);f.fail(b);
  f.map.getBounds=()=>({getWest:()=>-174,getEast:()=>-172,getSouth:()=>80,getNorth:()=>85});
  f.map.handlers.moveend();assert.match(f.status.textContent,/Retrying automatically/,'one remaining tile retains the warning');
  f.map.getBounds=()=>({getWest:()=>0,getEast:()=>10,getSouth:()=>-10,getNorth:()=>10});
  f.map.handlers.moveend();assert.equal(f.status.classList.contains('error'),false);assert.equal(f.clock.timers.size,0);
  f.map.getBounds=()=>undefined;f.fail(failedRailTile());
  f.map.handlers.error({sourceId:'openmaptiles',error:new Error('unrelated')});
  f.map.getBounds=()=>({getWest:()=>0,getEast:()=>10,getSouth:()=>-10,getNorth:()=>10});f.map.handlers.moveend();
  assert.match(f.status.textContent,/Some map data could not load/);assert.equal(f.status.classList.contains('error'),true);assert.equal(f.clock.timers.size,0);
 }finally{f.close();}
});

test('retirement cannot clear nonretryable or newer same-ID errors',async()=>{
 for(const replace of [false,true]){
  const f=await recoveryApp();try{
   f.fail(failedRailTile());if(replace)f.map.sources.railway={url:f.map.sources.railway.url};
   f.map.handlers.error({sourceId:'railway',tile:failedRailTile(3),error:{status:403,message:'HTTP 403'}});
   f.fail(failedRailTile(4));
   f.map.getBounds=()=>({getWest:()=>0,getEast:()=>10,getSouth:()=>-10,getNorth:()=>10});f.map.handlers.moveend();
   assert.equal(f.status.classList.contains('error'),true);assert.match(f.status.textContent,/Some map data could not load/);assert.equal(f.clock.timers.size,0);
  }finally{f.close();}
 }
});

test('timer retirement reconciles status after its transaction and queued notifications are inert after disposal',async()=>{
 const f=await recoveryApp();
 try{
  f.fail(failedRailTile());
  f.map.getBounds=()=>({getWest:()=>0,getEast:()=>10,getSouth:()=>-10,getNorth:()=>10});
  const [id,timer]=f.clock.timers.entries().next().value;f.clock.timers.delete(id);timer.fn();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.status.classList.contains('error'),false);assert.equal(f.clock.timers.size,0);assert.deepEqual(f.clock.retries,[]);
  f.map.getBounds=()=>undefined;f.fail(failedRailTile());
  const before=f.status.textContent;f.map.handlers.remove();
  f.map.queryRenderedFeatures=()=>{throw new Error('disposed map must not be queried');};
  f.window.dispatchEvent(new f.window.Event('online'));f.window.document.dispatchEvent(new f.window.Event('visibilitychange'));f.map.handlers.moveend();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.status.textContent,before);assert.equal(f.clock.timers.size,0);
 }finally{f.close();}
});
