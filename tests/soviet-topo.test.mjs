import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BACKGROUNDS,MODES,readSettings} from '../styles/map-model.mjs';
import {getLayerSemantics,layerVisibility} from '../styles/layer-semantics.mjs';
import {installSovietStyle,sovietPreviewAllowed,SOVIET_SOURCE,SOVIET_LAYER,SOVIET_TILE_ORIGIN} from '../styles/soviet-topo.mjs';

const baseStyle=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url),'utf8'));
const preview='http://127.0.0.1:4173/?sovietPreview=1';
const source=()=>installSovietStyle(structuredClone(baseStyle),preview);
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
 assert.throws(()=>installSovietStyle(style,preview),/already extended/);
 assert.throws(()=>installSovietStyle({sources:{},layers:[]},preview),/Seabed/);
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
 assert.match(html,/Printed Russian map text is part of the image/);
 assert.match(html,/tiles\.nakarte\.me|NaKarte/);
 const sw=await readFile(new URL('../styles/sw.js',import.meta.url),'utf8');
 assert.match(sw,/'soviet-topo\.mjs'/);
});

test('modern basemap overlays cannot cover scans and all other backgrounds retain their order and visibility',()=>{
 const style=source(),raster=style.layers.findIndex(l=>l.id===SOVIET_LAYER);
 const layers=style.layers.filter(l=>l.id!==SOVIET_LAYER);
 assert.deepEqual(layers.map(l=>l.id),baseStyle.layers.map(l=>l.id),'original layer order is unchanged');
 for(const [index,layer] of style.layers.entries()){
  const semantics=getLayerSemantics(layer);
  if(index>raster&&semantics['atlas:base-map']&&!semantics['atlas:terrain'])
   assert.equal(layerVisibility(layer,testSettings('soviet')),false,layer.id+' must not cover a scan');
 }
 for(const id of ['background','landuse-residential','landcover_grass','landcover_wood','water'])
  assert.equal(layerVisibility(style.layers.find(l=>l.id===id),testSettings('soviet')),true,id+' remains below missing tiles');
 for(const background of BACKGROUNDS.filter(bg=>bg!=='soviet'))for(const mode of MODES)for(const enabled of [false,true]){
  const settings=testSettings(background,{mode,relief:enabled,stations:enabled,labels:enabled,names:enabled,inactive:enabled,transport:enabled,destinations:enabled,constraints:enabled});
  for(const [index,layer] of layers.entries())
   assert.equal(layerVisibility(layer,settings),layerVisibility(baseStyle.layers[index],settings),`${background}/${mode}/${enabled}: ${layer.id}`);
 }
 for(const mode of MODES)for(const enabled of [false,true]){
  const settings=testSettings('soviet',{mode,stations:enabled,labels:enabled,names:enabled,inactive:enabled});
  for(const [index,layer] of layers.entries()){
   const semantics=getLayerSemantics(layer);
   if(!semantics['atlas:base-map']&&!semantics['atlas:background'])
    assert.equal(layerVisibility(layer,settings),layerVisibility(baseStyle.layers[index],{...settings,background:'map'}),`${mode}/${enabled}: retain ${layer.id}`);
  }
 }
});

test('scan overlay suppression respects declared roles and cached legacy metadata',()=>{
 for(const legacy of [false,true]){
  const style=structuredClone(baseStyle);
  if(legacy)for(const layer of style.layers)delete layer.metadata;
  const landuse=style.layers.find(l=>l.id==='landuse');
  if(!legacy){landuse.id='renamed-land-fill';landuse.source='renamed-basemap';}
  installSovietStyle(style,preview);
  assert.equal(layerVisibility(landuse,testSettings('soviet')),false);
  assert.equal(layerVisibility(landuse,testSettings('map')),true);
 }
});

test('publication hold rejects public query opt-ins and missing preview context',()=>{
 for(const href of [undefined,'','https://10671435.xyz/?sovietPreview=1',
   'https://c933103.github.io/openrailwaystyle/?sovietPreview=1',
   'http://localhost.evil.example/?sovietPreview=1','http://127.0.0.2/?sovietPreview=1',
   'http://localhost:4173/','file:///tmp/map?sovietPreview=1']){
  assert.equal(sovietPreviewAllowed(href),false,String(href));
  const style=structuredClone(baseStyle);
  assert.equal(installSovietStyle(style,href),style);
  assert.deepEqual(style,baseStyle,'denied preview must not change source or layers');
 }
 for(const host of ['localhost','127.0.0.1','[::1]'])
  assert.equal(sovietPreviewAllowed(`http://${host}:4173/?sovietPreview=1`),true);
});
