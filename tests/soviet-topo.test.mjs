import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readSettings} from '../styles/map-model.mjs';
import {layerVisibility} from '../styles/layer-semantics.mjs';
import {installSovietStyle,SOVIET_SOURCE,SOVIET_LAYER,SOVIET_TILE_ORIGIN} from '../styles/soviet-topo.mjs';

const baseStyle=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url),'utf8'));
const source=()=>installSovietStyle(structuredClone(baseStyle));
const testSettings=(background,overrides={})=>({...readSettings('?background='+background),...overrides});

test('historic Soviet raster has a bounded direct source and cannot request unknown proxy URLs',()=>{
 const style=source();
 assert.equal(style.sources.sovietTopo.type,'raster');
 assert.equal(style.sources.sovietTopo.tileSize,256);
 assert.equal(style.sources.sovietTopo.maxzoom,13);
 assert.equal(style.sources.sovietTopo.minzoom,1);
 assert.deepEqual(style.sources.sovietTopo.tiles,SOVIET_SOURCE.tiles);
 assert.ok(SOVIET_SOURCE.tiles[0].startsWith(SOVIET_TILE_ORIGIN+'/topomapper/'));
 assert.ok(!SOVIET_SOURCE.tiles[0].includes('proxy.'));
 assert.match(style.sources.sovietTopo.attribution,/AtloMaps.*NaKarte/);
 assert.ok(!SOVIET_SOURCE.tiles[0].includes('?token='));
 assert.equal(style.layers.filter(l=>l.id===SOVIET_LAYER).length,1);
 assert.throws(()=>installSovietStyle(style),/already extended/);
 assert.throws(()=>installSovietStyle({sources:{},layers:[]}),/Seabed/);
});

test('Soviet scans draw above land fallback and below bathymetry, tracks and station nodes',()=>{
 const style=source(),ids=style.layers.map(l=>l.id);
 const idx=id=>ids.indexOf(id);
 assert.ok(idx('water')<idx(SOVIET_LAYER));
 assert.ok(idx(SOVIET_LAYER)<idx('terrain-bathymetry'));
 assert.ok(idx('terrain-bathymetry')<idx('infrastructure-overview'));
 assert.ok(idx(SOVIET_LAYER)<idx('station-major-dots'));
 const sov=style.layers.find(l=>l.id===SOVIET_LAYER);
 assert.equal(sov.layout.visibility,'none','hidden until selected');
 assert.equal(sov.metadata['atlas:background'],'soviet');
 assert.equal(sov.metadata['atlas:base-map'],false);
});

test('new background is linkable, persistent and does not hide modern rail and station overlays',()=>{
 assert.equal(readSettings('?background=soviet').background,'soviet');
 assert.equal(readSettings('',{background:'soviet'}).background,'soviet');
 const style=source();
 const sov=style.layers.find(l=>l.id===SOVIET_LAYER);
 const bath=style.layers.find(l=>l.id==='terrain-bathymetry');
 const city=style.layers.find(l=>l.id==='place_label_city');
 const rail=style.layers.find(l=>l.id==='infrastructure-overview');
 const station=style.layers.find(l=>l.id==='station-major-dots');
 const water=style.layers.find(l=>l.id==='water');
 assert.equal(layerVisibility(sov,testSettings('map')),false);
 assert.equal(layerVisibility(sov,testSettings('carto')),false);
 assert.equal(layerVisibility(sov,testSettings('soviet')),true);
 assert.equal(layerVisibility(city,testSettings('soviet')),false,'modern base place names do not obscure Cyrillic scan labels');
 assert.equal(layerVisibility(water,testSettings('soviet')),true,'modern fallback renders beneath missing tiles');
 assert.equal(layerVisibility(bath,testSettings('soviet',{relief:false})),true,'seafloor remains visible without enabling terrain tint');
 assert.equal(layerVisibility(rail,testSettings('soviet',{mode:'infrastructure'})),true);
 assert.equal(layerVisibility(station,testSettings('soviet',{stations:true})),true);
 assert.equal(layerVisibility(station,testSettings('soviet',{stations:false})),false);
});

test('fifth selector and historical coverage warning are present',async()=>{
 const html=await readFile(new URL('../styles/index.html',import.meta.url),'utf8');
 assert.equal((html.match(/data-background="soviet"/g)||[]).length,1);
 assert.match(html,/Soviet topo \(experimental\)/);
 assert.match(html,/bathymetry/);
 assert.match(html,/Russian words printed on the map/);
 assert.match(html,/tiles\.nakarte\.me|NaKarte/);
 const sw=await readFile(new URL('../styles/sw.js',import.meta.url),'utf8');
 assert.match(sw,/'soviet-topo\.mjs'/);
});
