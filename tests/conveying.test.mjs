import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {conveying} from '../styles/conveying.mjs';
import {CONVEYING_QUERY,conveyingGeoJSON,conveyingTiles,CONVEYING_ZOOM,CONVEYING_EXTENT} from '../scripts/conveying-data.mjs';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {layerVisibility} from '../styles/layer-semantics.mjs';

const style=JSON.parse(readFileSync(new URL('../styles/world.style.json',import.meta.url)));
const layer=id=>style.layers.find(l=>l.id===id);
const way=(id,tags,coords=[[114.1531,22.2817],[114.1533,22.2815],[114.1536,22.2812]])=>({type:'way',id,tags,geometry:coords.map(([lon,lat])=>({lon,lat}))});
// Tags of a Central-Mid-Levels Escalator piece (OSM API, October 2026).
const midLevels={conveying:'reversible','conveying:conditional':'forward @ (06:00-10:00); backward @ (10:00-24:00)',covered:'yes',highway:'steps',incline:'down',name:'中環至半山自動扶手電梯系統 Central-Mid-Levels Escalator System'};

test('escalators, moving walkways and elevators are read from explicit tags only',()=>{
  assert.deepEqual(conveying(midLevels),{kind:'escalator',direction:'reversible'});
  assert.deepEqual(conveying({highway:'steps',conveying:'forward'}),{kind:'escalator',direction:'forward'});
  assert.deepEqual(conveying({highway:'footway',conveying:'backward'}),{kind:'travelator',direction:'backward'});
  assert.deepEqual(conveying({highway:'footway',conveying:'yes'}),{kind:'travelator',direction:''},'no mapped direction, no arrow');
  for(const value of ['forward;backward','forward;yes','no;backward','Backward; yes'])assert.deepEqual(conveying({highway:'steps',conveying:value}),{kind:'escalator',direction:''},`mixed ${value} draws no arrow`);
  assert.deepEqual(conveying({highway:'steps',conveying:' Backward '}),{kind:'escalator',direction:'backward'},'case and spaces do not matter');
  assert.deepEqual(conveying({highway:'elevator'}),{kind:'elevator',direction:''});
  for(const tags of [{highway:'steps'},{highway:'steps',conveying:'no'},{highway:'footway'},{railway:'funicular'}])assert.equal(conveying(tags),null,JSON.stringify(tags));
});

test('every such way is kept, with no length threshold; a backward one is stored reversed so its arrow follows the line',()=>{
  assert.match(CONVEYING_QUERY,/way\[conveying\]\[conveying!=no\]/);assert.match(CONVEYING_QUERY,/way\[highway=elevator\]/);assert.match(CONVEYING_QUERY,/out tags geom;$/);
  const tiny=[[0,0],[0.000009,0]]; // about 1 m
  const data=conveyingGeoJSON({elements:[
    way(1,midLevels),way(2,{highway:'steps',conveying:'backward'}),way(3,{highway:'footway',conveying:'yes'}),way(4,{highway:'elevator'},tiny),
    way(5,{highway:'steps'}),way(8,{highway:'steps',conveying:'no;backward'}),{type:'node',id:6,lat:0,lon:0,tags:{highway:'elevator'}},
  ]});
  assert.deepEqual(data.features.map(f=>[f.id,f.properties.kind,f.properties.arrows]),[[1,'escalator','two_way'],[2,'escalator','one_way'],[3,'travelator',''],[4,'elevator',''],[8,'escalator','']]);
  assert.deepEqual(data.features[4].geometry.coordinates[0],[114.1531,22.2817],'a mixed value is not reversed');
  assert.deepEqual(data.features[1].geometry.coordinates,[[114.1536,22.2812],[114.1533,22.2815],[114.1531,22.2817]],'backward reversed');
  assert.deepEqual(data.features[0].geometry.coordinates[0],[114.1531,22.2817],'reversible keeps its mapped order');
  assert.deepEqual(Object.keys(data.features[0].properties).sort(),['arrows','kind','osm_id'],'tiles carry only what is drawn, plus provenance');
  assert.throws(()=>conveyingGeoJSON({remark:'runtime error: Query timed out',elements:[]}),/timed out/);
  assert.throws(()=>conveyingGeoJSON({elements:[way(7,{highway:'elevator'},[[0,0]])]}),/Incomplete geometry/);
});

test('conveying lines and arrows show in every view and with every setting off, over hybrid imagery',async()=>{
  const ids=['conveying-lines','conveying-arrows','conveying-arrows-back'];
  assert.deepEqual(style.layers.filter(l=>l.source==='conveying').map(l=>l.id),ids);
  assert.deepEqual(style.sources.conveying.tiles,['conveyingtiles://{z}/{x}/{y}']);
  assert.equal(style.sources.conveying.minzoom,CONVEYING_ZOOM);assert.equal(style.sources.conveying.maxzoom,CONVEYING_ZOOM);
  assert.equal(layer('conveying-lines').minzoom,CONVEYING_ZOOM,'tiles start where the lines start');
  const settings={mode:'speed',labels:false,inactive:false,stations:false,names:false,background:'map'};
  for(const l of ids.map(layer)){
    assert.notEqual(l.layout?.visibility,'none');
    for(const mode of ['speed','infrastructure','electrification','control','gauge','loading','axle','owner','service'])assert.equal(layerVisibility(l,{...settings,mode}),true,`${l.id} ${mode}`);
    assert.equal(layerVisibility(l,{...settings,background:'hybrid'}),true);
    assert.equal(layerVisibility(l,{...settings,background:'satellite'}),false);
  }
  assert.equal(layer('conveying-lines').minzoom,14);assert.equal(layer('conveying-arrows').minzoom,16);
  const draws=(l,arrows)=>featureFilter(l.filter).filter({zoom:17},{type:2,properties:{kind:'escalator',arrows},geometry:[]});
  assert.deepEqual(['one_way','two_way',''].map(a=>draws(layer('conveying-arrows'),a)),[true,true,false]);
  assert.deepEqual(['one_way','two_way',''].map(a=>draws(layer('conveying-arrows-back'),a)),[false,true,false],'reversible: a second arrow the other way');
  for(const id of ['conveying-arrows','conveying-arrows-back']){
    const l=layer(id);assert.equal(l.layout['icon-image'],'conveying-arrow');assert.equal(l.layout['text-field'],undefined,'no text on the map');
    assert.equal(l.layout['icon-allow-overlap'],true);assert.equal(l.layout['icon-ignore-placement'],true,'arrows never push labels away');
  }
  assert.equal(layer('conveying-arrows-back').layout['icon-rotate'],180);
  const {expression}=await import('@maplibre/maplibre-gl-style-spec');
  const offset=arrows=>expression.createPropertyExpression(layer('conveying-arrows').layout['icon-offset'],{type:'array',value:'number',length:2,'property-type':'data-driven',expression:{parameters:['zoom','feature']}}).value.evaluate({zoom:17},{properties:{arrows}});
  assert.deepEqual(offset('two_way'),[7,0],'the two arrows of a reversible piece do not overlap');assert.deepEqual(offset('one_way'),[0,0]);
});

test('the site deploys without a conveying snapshot, and only main publishes one',()=>{
  const site=readFileSync(new URL('../.github/workflows/site.yml',import.meta.url),'utf8');
  assert.match(site,/conveying-data[\s\S]*echo '\{"tiles":\[\]\}' > styles\/data\/conveying\/index\.json/);
  const workflow=readFileSync(new URL('../.github/workflows/conveying.yml',import.meta.url),'utf8');
  assert.match(workflow,/Publish complete data snapshot\n\s+# Only main publishes the shared snapshot\.\n\s+if: github\.ref == 'refs\/heads\/main'/);
  const app=readFileSync(new URL('../styles/app.mjs',import.meta.url),'utf8');
  assert.match(app,/\['conveyingtiles','conveying',false\]/);assert.match(app,/event\.id === 'conveying-arrow'/);
});

test('short pieces survive tile encoding: about 1 m stays a line with two distinct ends, also on the renderer grid',()=>{
  // MapLibre rounds tile coordinates to an 8192 grid, so the stored grid must be at least that fine.
  assert.equal(CONVEYING_ZOOM,14);assert.ok(CONVEYING_EXTENT>=8192);
  const pieces=[[1,[[114.15310,22.28170],[114.153109,22.28170]]],[2,[[114.15320,22.28170],[114.15320,22.281705]]],[3,[[114.15330,22.28170],[114.153303,22.28170]]]]; // ~0.9 m, ~0.55 m, ~0.31 m
  const {features}=conveyingGeoJSON({elements:pieces.map(([id,coords])=>way(id,{highway:'elevator'},coords))});
  const tiles=conveyingTiles(features);
  assert.ok([...tiles.keys()].every(key=>key.startsWith(`${CONVEYING_ZOOM}/`)));
  const seen=new Map();
  for(const bytes of tiles.values()){
    const layer=new VectorTile(new Pbf(bytes)).layers.conveying;
    for(let i=0;i<layer.length;i++){
      const f=layer.feature(i),[line]=f.loadGeometry(),scale=8192/layer.extent;
      const ends=[line[0],line.at(-1)].map(p=>[Math.round(p.x*scale),Math.round(p.y*scale)]);
      if(ends.every(([x,y])=>x>=0&&x<8192&&y>=0&&y<8192))seen.set(f.id,ends);
    }
  }
  assert.deepEqual([...seen.keys()].sort(),[1,2,3],'every piece is in its tile, none simplified away');
  for(const [id,[a,b]] of seen)assert.notDeepEqual(a,b,`way ${id} keeps two distinct ends`);
});
