// Satellite provider selection in the real app and MapLibre: Sentinel-2 (EOX)
// where it has native detail, Esri World Imagery only beyond it when a key is
// configured, regional orthophotos or global fallbacks after refusal and
// without a key. Every provider response is a solid-colour local fixture.
import assert from 'node:assert/strict';
import {launchBrowser} from './browser.mjs';
import {detailTiles} from './polar-features.mjs';
import {CAP_RADIUS,fromPolar,encodeLine} from '../styles/polar.mjs';
import {installEmptyMapProviders} from './browser-renderer-fixture.mjs';

const base = (process.env.MAP_BASE_URL || 'http://127.0.0.1:4173/').replace(/\/?$/, '/');
const KEY = 'AAPTfixtureKeyForImageryBrowserCheck0000';
const RED = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const BLUE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMCbHYQAAAABJRU5ErkJggg==', 'base64');
const browser = await launchBrowser({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']});

async function open({config, esri}) {
  const context = await browser.newContext({viewport: {width: 800, height: 600}, serviceWorkers: 'block'});
  await installEmptyMapProviders(context, base);
  const requests = {esri: [], eox: 0, gibs: 0, regional: []}, errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`${base}imagery-config.json`, route => route.fulfill({json: config}));
  await page.route('https://ibasemaps-api.arcgis.com/**', route => {
    requests.esri.push(route.request().url());
    return esri === 'ok' ? route.fulfill({contentType: 'image/png', body: RED}) : route.fulfill({status: 403, contentType: 'application/json', body: '{"error":{"code":403}}'});
  });
  await page.route('https://tiles.maps.eox.at/**', route => { requests.eox++; return route.fulfill({contentType: 'image/png', body: BLUE}); });
  for(const pattern of ['https://wmts.geo.admin.ch/**','https://data.geopf.fr/**','https://basemap.nationalmap.gov/**'])await page.route(pattern,route=>{requests.regional.push(route.request().url());return route.fulfill({contentType:'image/png',body:RED});});
  await page.route('https://gibs.earthdata.nasa.gov/**', route=>{requests.gibs++;return route.fulfill({contentType:'image/png',body:RED});});
  return {context, page, requests, errors};
}
async function centre(page) {
  return page.evaluate(() => new Promise(resolve => {
    const map = window.imageryMap;
    map.once('render', () => {
      const gl = map.getCanvas().getContext('webgl2') || map.getCanvas().getContext('webgl'), out = new Uint8Array(4);
      gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      resolve([...out]);
    });
    map.triggerRepaint();
  }));
}
async function load(page, zoom) {
  await page.goto(`${base}?background=satellite&relief=0&stations=0&names=0#${zoom}/35.68/139.76`, {waitUntil: 'domcontentloaded'});
  await page.waitForSelector('body[data-map-ready="true"]', {state: 'attached', timeout: 90000});
  await page.evaluate(async () => {
    window.imageryMap = (await import(document.querySelector('script[type="module"]').src)).map;
    await new Promise(resolve => { const map = window.imageryMap; if (map.areTilesLoaded()) resolve(); map.on('idle', resolve); setTimeout(resolve, 20000); });
  });
}
const near = (pixel, rgb, label) => assert.ok(rgb.every((v, i) => Math.abs(pixel[i] - v) <= 8), `${label}: ${JSON.stringify(pixel)}`);

try {
  // Where EOX has native detail (z12 at Tokyo) it draws without any Esri
  // request; beyond it (z15) Esri draws.
  const healthy = await open({config: {esriKey: KEY}, esri: 'ok'});
  await load(healthy.page, 12);
  near(await centre(healthy.page), [0, 0, 255], 'Sentinel-2 where it has native detail, even with a key');
  assert.equal(healthy.requests.esri.length, 0, 'no Esri request where EOX covers the view');
  assert.doesNotMatch(await healthy.page.locator('.maplibregl-ctrl-attrib').textContent(),/Powered by Esri|swisstopo|NASA EOSDIS/,'unused providers are not credited');
  await healthy.page.evaluate(() => window.imageryMap.jumpTo({zoom: 15}));
  await healthy.page.evaluate(() => new Promise(resolve => { window.imageryMap.once('idle', resolve); setTimeout(resolve, 20000); }));
  near(await centre(healthy.page), [255, 0, 0], 'Esri imagery beyond Sentinel-2 detail');
  assert.ok(healthy.requests.esri.length > 0 && healthy.requests.esri.every(url => url.endsWith(`?token=${KEY}`)), 'keyed Esri requests');
  assert.ok(healthy.requests.esri.every(url => +/\/tile\/(\d+)\//.exec(url)[1] >= 14), 'Esri is requested only at zooms EOX cannot cover here');
  assert.equal(await healthy.page.evaluate(() => window.imageryMap.getStyle().sources.satellite.maxzoom), 19);
  assert.match(await healthy.page.locator('.maplibregl-ctrl-attrib').textContent(), /Powered by Esri.*Vantor/s, 'Esri attribution');
  await healthy.page.evaluate(()=>window.imageryMap.jumpTo({zoom:19}));
  await healthy.page.waitForFunction(()=>window.imageryMap.areTilesLoaded());
  near(await centre(healthy.page),[255,0,0],'Esri ancestor survives at zoom 19 outside regional coverage');
  assert.ok(healthy.requests.esri.some(url=>url.includes('/tile/18/')));
  assert.ok(healthy.requests.esri.every(url=>+/\/tile\/(\d+)\//.exec(url)[1]<=18));
  await healthy.page.evaluate(()=>window.imageryMap.jumpTo({zoom:12}));
  await healthy.page.waitForFunction(()=>window.imageryMap.areTilesLoaded());await centre(healthy.page);
  await healthy.page.waitForFunction(()=>!document.querySelector('.maplibregl-ctrl-attrib').textContent.includes('Powered by Esri'));
  assert.doesNotMatch(await healthy.page.locator('.maplibregl-ctrl-attrib').textContent(),/Powered by Esri/,'returning to cached EOX tiles retires Esri credit');
  assert.deepEqual(healthy.errors, []);
  await healthy.context.close();

  // z15 is beyond EOX's z14, so the fallback also crops the z14 ancestor.
  const refused = await open({config: {esriKey: KEY}, esri: 'forbidden'});
  await load(refused.page, 15);
  near(await centre(refused.page), [0, 0, 255], 'Sentinel-2 replaces refused Esri tiles');
  assert.ok(await refused.page.evaluate(() => Number(localStorage.getItem('atlas-imagery-esri-off-until')) > Date.now()), 'the device remembers the refusal');
  const afterRefusal = refused.requests.esri.length;
  assert.ok(afterRefusal > 0, 'Esri was tried before the device switched');
  assert.doesNotMatch(await refused.page.locator('.maplibregl-ctrl-attrib').textContent(),/Powered by Esri/,'refused provider does not earn imagery credit');
  await refused.page.evaluate(() => window.imageryMap.jumpTo({center: [2.35, 48.85], zoom: 15}));
  await refused.page.evaluate(() => new Promise(resolve => { window.imageryMap.once('idle', resolve); setTimeout(resolve, 20000); }));
  near(await centre(refused.page), [255, 0, 0], 'French orthophotos after panning during Esri cooldown');
  assert.ok(refused.requests.regional.some(url=>url.includes('data.geopf.fr')));
  assert.equal(refused.requests.esri.length, afterRefusal, 'no Esri request after the refusal');
  assert.deepEqual(refused.errors, []);
  await refused.context.close();

  const unconfigured = await open({config: {}, esri: 'ok'});
  await load(unconfigured.page, 12);
  near(await centre(unconfigured.page), [0, 0, 255], 'Sentinel-2 without a key');
  assert.equal(await unconfigured.page.evaluate(() => window.imageryMap.getStyle().sources.satellite.tiles[0]), 'atlasimagery://{z}/{x}/{y}', 'keyless imagery protocol enabled');
  assert.equal(unconfigured.requests.esri.length, 0);
  for(const [center,host] of [[[8.54,47.37],'wmts.geo.admin.ch'],[[-97.74,30.27],'basemap.nationalmap.gov']]) {
    await unconfigured.page.evaluate(center=>window.imageryMap.jumpTo({center,zoom:16}),center);
    await unconfigured.page.waitForFunction(()=>window.imageryMap.areTilesLoaded());
    near(await centre(unconfigured.page),[255,0,0],'keyless regional orthophoto');
    assert.ok(unconfigured.requests.regional.some(url=>url.includes(host)));
    assert.match(await unconfigured.page.locator('.maplibregl-ctrl-attrib').textContent(),host.includes('geo.admin')?/swisstopo/:/USGS/);
  }
  await unconfigured.page.evaluate(()=>window.imageryMap.jumpTo({center:[166.67,-77.85],zoom:12}));
  await unconfigured.page.waitForFunction(()=>window.imageryMap.areTilesLoaded());
  near(await centre(unconfigured.page),[255,0,0],'keyless NASA Antarctic fallback');
  assert.match(await unconfigured.page.locator('.maplibregl-ctrl-attrib').textContent(),/NASA EOSDIS GIBS/);
  await unconfigured.page.waitForFunction(()=>!/swisstopo|USGS The National Map/.test(document.querySelector('.maplibregl-ctrl-attrib').textContent));
  assert.doesNotMatch(await unconfigured.page.locator('.maplibregl-ctrl-attrib').textContent(),/swisstopo|USGS The National Map/,'leaving regional imagery retires its credit');
  assert.ok(unconfigured.requests.gibs>0);assert.equal(unconfigured.requests.esri.length,0);
  await unconfigured.context.close();

  // Full application integration: production world style, production
  // layerVisibility and the real background controls, with synthetic polar data.
  const hybrid=await open({config:{},esri:'ok'}),cap='south',cy=167;
  const geometry=points=>points.map(p=>{const [lon,lat]=fromPolar(cap,p);return {lon,lat};});
  const details=detailTiles(cap,[
    {type:'way',id:1,tags:{building:'yes'},geometry:geometry([[-0.08,cy-0.08],[0.08,cy-0.08],[0.08,cy+0.08],[-0.08,cy+0.08],[-0.08,cy-0.08]])},
    {type:'way',id:2,tags:{highway:'service'},geometry:geometry([[-1,cy-0.2],[1,cy-0.2]])},
    {type:'node',id:3,...geometry([[0,cy]])[0],tags:{man_made:'research_station',name:'Hybrid fixture station'}},
  ]);
  const fixture=new Map([
    [`${cap}-index.json`,{cap,radius:CAP_RADIUS,units:{metric:[{n:1,tiles:['0-0']}]},carto:{from:10,n:4,tiles:[...details.keys()]}}],
    [`${cap}-features.json`,{water:[],iceShelves:[],runways:[],places:[]}],
    [`${cap}-metric-0-0-0.json`,{lines:[[50,1,...encodeLine([[-1,cy+0.2],[1,cy+0.2]])]]}],
    ...[...details].map(([key,value])=>[`${cap}-carto-${key}.json`,value]),
  ]);
  await hybrid.page.route('**/data/polar/**',route=>{const value=fixture.get(new URL(route.request().url()).pathname.split('/').at(-1));return route.fulfill({status:value?200:404,contentType:'application/json',body:JSON.stringify(value||{})});});
  await load(hybrid.page,12);
  await hybrid.page.locator('[data-background="hybrid"]').first().click();
  await hybrid.page.locator('#settings-open').click();
  await hybrid.page.locator('#relief').check();
  await hybrid.page.locator('#transport').check();
  await hybrid.page.evaluate(center=>{
    const map=window.imageryMap;map.setProjection({type:'globe'});
    map.jumpTo({center,zoom:15+Math.log2(Math.cos(center[1]*Math.PI/180))});
    // Keep the production visibility policy. Lower only zoom thresholds so
    // the authored high-zoom geometry can be compared on the globe camera.
    for(const id of ['building-footprints','building-outlines','road-local','terrain-contours'])map.setLayerZoomRange(id,2);
    map.setPaintProperty('building-footprints','fill-color','#ff0000');map.setPaintProperty('building-footprints','fill-opacity',1);
  },fromPolar(cap,[0,cy]));
  await hybrid.page.waitForFunction(()=>{const layer=window.imageryMap.getLayer('polar-caps')?.implementation;return layer&&[...layer.tiles.values()].some(t=>t.detailed&&!t.loading&&!t.failed)&&[...layer.tiles.values()].every(t=>!t.loading);});
  const integration=await hybrid.page.evaluate(async()=>{
    const map=window.imageryMap,layer=map.getLayer('polar-caps').implementation,counts={buildings:0,roads:0,contours:0};
    const fill=layer.fill.bind(layer),line=layer.line.bind(layer);
    layer.fill=(mesh,...args)=>{if([...layer.tiles.values()].some(t=>t.buildings===mesh))counts.buildings++;return fill(mesh,...args);};
    layer.line=(mesh,...args)=>{for(const t of layer.tiles.values()){if(t.lineGroups?.some(g=>g.mesh===mesh))counts.roads++;if(mesh?.buffers&&t.landMajor?.buffers===mesh.buffers)counts.contours++;}return line(mesh,...args);};
    await new Promise(resolve=>{map.once('render',resolve);map.triggerRepaint();});
    return {counts,hidden:map.getLayoutProperty('building-footprints','visibility'),labels:[...document.querySelectorAll('.polar-place')].map(e=>e.textContent)};
  });
  assert.equal(integration.hidden,'none','Hybrid intentionally hides ordinary Mercator buildings');
  for(const kind of ['buildings','roads','contours'])assert.ok(integration.counts[kind]>0,`production Hybrid paints polar ${kind}`);
  assert.ok(integration.labels.includes('Hybrid fixture station'));
  near(await centre(hybrid.page),[255,0,0],'production Hybrid building fills actual framebuffer');
  await hybrid.page.locator('#relief').uncheck();
  const toggled=await hybrid.page.evaluate(async()=>{
    const {polarStylePaint}=await import('./polar-paint.mjs'),map=window.imageryMap,layer=map.getLayer('polar-caps').implementation;
    return polarStylePaint(map,map.getZoom(),layer.overlayVisibility).landContour({ele:50,level:1}).visible;
  });
  assert.equal(toggled,false,'production relief toggle suppresses polar contours');
  assert.deepEqual(hybrid.errors,[]);await hybrid.context.close();
  console.log('PASS: Sentinel-2 where it has native detail, Esri only beyond it with a key, Sentinel-2 after refusal (including z15 crop), keyless EOX and NASA Antarctic fallback');
} finally {
  await browser.close();
}
