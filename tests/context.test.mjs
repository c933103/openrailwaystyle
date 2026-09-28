import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {contextCategory, nearbyTransport, distanceMetres} from '../styles/context.mjs';
import {readSettings,settingsQuery} from '../styles/map-model.mjs';
const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
const visible=(layer,properties,zoom=14)=>zoom>=layer.minzoom && featureFilter(layer.filter).filter({zoom},{type:1,properties});
test('transport distinguishes interchanges from ordinary stops and private airfields',()=>{
  const bus=style.layers.find(l=>l.id==='context-transport-bus-label');
  assert.ok(visible(bus,{class:'bus',subclass:'bus_station'}));
  assert.ok(!visible(bus,{class:'bus',subclass:'bus_stop',agg_stop:1}));
  assert.equal(contextCategory({class:'bus',subclass:'bus_stop'},'poi'),null);
  assert.equal(contextCategory({class:'ferry_terminal'},'poi').id,'ferry');
  assert.equal(contextCategory({class:'aerialway',subclass:'station'},'poi').id,'aerialway');
  const airport=style.layers.find(l=>l.id==='context-transport-airport-label');
  assert.ok(visible(airport,{class:'international'},8));
  assert.ok(!visible(airport,{class:'private',iata:'ABC'},14));
  assert.ok(!visible(airport,{class:'military'},14));
});
test('requested destination types are selected without turning every shop or sports pitch into a magnet',()=>{
  const labels=style.layers.filter(l=>l.id.startsWith('context-destinations-')&&l.type==='symbol');
  for (const subclass of ['mall','hospital','school','university','stadium','theme_park','government','community_centre','castle','attraction','museum']) {
    const p={class:'generic',subclass};
    assert.ok(labels.some(l=>visible(l,p)),subclass);
    assert.equal(contextCategory(p,'poi')?.group,'destinations');
  }
  for (const subclass of ['convenience','clothes','cafe','pitch','soccer','clinic','viewpoint']) assert.ok(!labels.some(l=>visible(l,{subclass})),subclass);
  const areas=style.layers.filter(l=>l.id.startsWith('context-destinations-')&&l.type==='fill');
  for (const cls of ['industrial','commercial','retail','hospital','school','university','stadium','theme_park']) assert.ok(areas.some(l=>visible(l,{class:cls},12)),cls);
  assert.ok(!areas.some(l=>visible(l,{class:'residential'},14)));
  const lastContext=Math.max(...style.layers.map((l,i)=>l.id.startsWith('context-')&&l.type==='symbol'?i:-1));
  assert.ok(style.layers.findIndex(l=>l.id==='station-detail-large-names')>lastContext,'rail stations keep placement priority');
});
test('nearby transport deduplicates buffered tiles, respects distance and excludes ordinary stops and marinas',()=>{
  const point=(id,subclass,x=0,y=0,sourceLayer='poi')=>({id,sourceLayer,properties:{subclass},geometry:{type:'Point',coordinates:[x,y]}});
  const bus=point(1,'bus_station',0.001);
  const found=nearbyTransport([0,0],[bus,bus,point(2,'ferry_terminal',0.002),point(3,'bus_station',0.01),point(4,'bus_stop'),point(5,'marina')]);
  assert.deepEqual(found.map(f=>f.category.id),['bus','ferry']);
  assert.ok(found[0].distance>110&&found[0].distance<112);
  assert.ok(distanceMetres([179.999,0],[-179.999,0])<225,'date line wrap');
  assert.equal(nearbyTransport([0,0],[{...bus,geometry:{type:'Polygon',coordinates:[]}}]).length,0);
});
test('context settings default on for existing users and round-trip in shared links',()=>{
  assert.equal(readSettings('',{language:'ja'}).transport,true);
  const settings=readSettings('?transport=0&destinations=1',{destinations:false});
  assert.equal(settings.transport,false);assert.equal(settings.destinations,true);
  assert.deepEqual(readSettings('?'+settingsQuery(settings)),settings);
});
