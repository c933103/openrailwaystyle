import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {featureFilter,expression} from '@maplibre/maplibre-gl-style-spec';
import {INFRASTRUCTURE} from '../styles/map-model.mjs';
import {powerMethodLayers} from '../scripts/style/layers/power-methods.mjs';
import {annotateLayers,layerVisibility} from '../styles/layer-semantics.mjs';

const style=JSON.parse(readFileSync(new URL('../styles/world.style.json',import.meta.url)));
const draws=(layer,properties,zoom=14)=>featureFilter(layer.filter).filter({zoom},{type:2,properties:{state:'present',feature:'rail',...properties},geometry:[]});

test('funiculars have their own Infrastructure colour; existing class colours keep their positions',()=>{
  assert.deepEqual(INFRASTRUCTURE.slice(0,6).map(([,label])=>label),['High-speed line','Railway','Branch line','Metro / light rail','Tram','Service tracks']);
  assert.deepEqual(INFRASTRUCTURE[6],['#c2185b','Funicular']);
  const tracks=style.layers.find(l=>l.id==='infrastructure-tracks');
  const colour=properties=>expression.createExpression(tracks.paint['line-color']).value.evaluate({zoom:14},{properties});
  assert.equal(colour({feature:'funicular'}),'#c2185b');
  assert.equal(colour({feature:'rail'}),INFRASTRUCTURE[1][0]);
  assert.equal(colour({feature:'tram'}),INFRASTRUCTURE[4][0]);
});

test('Infrastructure view shows rack railways as ladder ticks from the provider rack=* field',()=>{
  const rack=style.layers.find(l=>l.id==='infrastructure-rack');
  assert.equal(rack.source,'railway');assert.equal(rack['source-layer'],'railway_line_high');
  for(const value of ['yes','abt','Strub','riggenbach'])assert.equal(draws(rack,{rack:value}),true,value);
  for(const value of ['no','',undefined])assert.equal(draws(rack,{rack:value}),false,String(value));
  assert.equal(draws(rack,{rack:'abt',state:'disused'}),false,'former lines are drawn by the lifecycle layers');
  const settings={mode:'infrastructure',labels:true,inactive:true,background:'map'};
  assert.equal(layerVisibility(rack,settings),true);
  assert.equal(layerVisibility(rack,{...settings,mode:'electrification'}),false,'the Power view has its own rack stroke');
  assert.ok(style.layers.findIndex(l=>l.id==='infrastructure-rack')>style.layers.findIndex(l=>l.id==='infrastructure-tracks'),'ticks above the track');
});

test('Power view draws the cable stroke on funiculars, cable-hauled by definition',()=>{
  const layers=annotateLayers(powerMethodLayers());
  const present=layers.find(l=>l.id==='electrification-provider-cable'),former=layers.find(l=>l.id==='electrification-former-provider-cable');
  assert.equal(present.source,'railway');
  assert.equal(draws(present,{feature:'funicular'}),true);
  assert.equal(draws(present,{feature:'rail'}),false);
  assert.equal(draws(present,{feature:'funicular',state:'abandoned'}),false);
  assert.equal(draws(former,{feature:'funicular',state:'abandoned'}),true);
  assert.equal(layerVisibility(former,{mode:'electrification',labels:true,inactive:false,background:'map'}),false);
});
