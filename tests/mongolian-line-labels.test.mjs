import test from 'node:test';
import assert from 'node:assert/strict';
import {markMongolianTextFields,mongolianFieldFilter,splitMongolianLineLabels,isMongolianLineLabelOf,mongolianRouteAnchor,withMongolianVectorLayers} from '../styles/mongolian-line-labels.mjs';
import encode from 'vt-pbf';
import {markStoredMongolianLines,localizeTile,readTile,installLabelProtocols} from '../styles/tile-labels.mjs';
import {createExpression} from '@maplibre/maplibre-gl-style-spec';
const keys=['atlas_name','name:en','name','ref'];
const mongolian='ᠤᠯᠠᠭᠠᠨᠪᠠᠭᠠᠲᠤᠷ';
const evalFilter=(expression,properties)=>{
  const compiled=createExpression(expression,{type:'boolean','property-type':'data-driven',expression:{parameters:['feature']}});
  assert.equal(compiled.result,'success',JSON.stringify(compiled.value));
  return compiled.value.evaluate({}, {properties});
};
test('route renderer uses the script of the selected field and falls back unchanged',()=>{
  const mgl=mongolianFieldFilter(keys);
  for(const [input,expected] of [[{name:mongolian},true],[{name:mongolian,'name:en':'English'},false],
    [{atlas_name:'УБ '+mongolian,name:'Ulaanbaatar'},true],[{'name:mn-Mong':mongolian,name:'Ulaanbaatar'},false],
    [{ref:mongolian},true],[{name:'᠎'},false],[{name:'Улаанбаатар'},false],[{},false]]) {
    assert.equal(evalFilter(mgl,markMongolianTextFields(input)),expected);
  }
});
test('named line splits are disjoint, preserve filters, and are idempotent on reload',()=>{
  const line={id:'railway-names',type:'symbol',source:'railway','source-layer':'railway_line_high',layout:{'symbol-placement':'line','text-field':['get','name']},
    filter:['==',['get','active'],true],metadata:{'atlas:feature':'names'}};
  const ordinary={id:'speed-label',type:'symbol',source:'railway','source-layer':'railway_line_high',layout:{'symbol-placement':'line','text-field':['get','speed']}};
  const style={layers:[line,ordinary]};
  const split=()=>splitMongolianLineLabels(style,keys,layer=>layer.id==='railway-names');
  split();
  const [path,anchor,numeric]=style.layers;
  const input=markMongolianTextFields({name:mongolian,active:true});
  assert.equal(evalFilter(path.filter,input),false);
  assert.equal(evalFilter(anchor.filter,input),true);
  assert.equal(evalFilter(anchor.filter,{...input,active:false}),false);
  assert.equal(evalFilter(path.filter,{name:'Track',active:true}),true);
  assert.equal(evalFilter(anchor.filter,{name:'Track',active:true}),false);
  assert.equal(anchor['source-layer'],'railway_line_high__atlas_mongolian_anchors');
  assert.equal(anchor.layout['symbol-placement'],'point');
  assert.equal(anchor.layout['text-rotation-alignment'],'viewport');
  assert.equal(anchor.layout['text-pitch-alignment'],'viewport');
  assert.equal(isMongolianLineLabelOf(anchor,'railway-names'),true);
  assert.deepEqual(numeric,ordinary);
  const snapshot=structuredClone(style);
  assert.deepEqual(split(),snapshot);
});

test('anchors ignore off-tile buffered geometry and follow the line by length',()=>{
  const line=[{x:-200,y:400},{x:200,y:400},{x:3000,y:400},{x:7000,y:400}];
  assert.deepEqual(mongolianRouteAnchor([line],4096),{x:2048,y:400});
  assert.deepEqual(mongolianRouteAnchor([[...line].reverse()],4096),{x:2048,y:400});
  assert.equal(mongolianRouteAnchor([[{x:-200,y:2},{x:-100,y:2}]],4096),null);
  assert.equal(mongolianRouteAnchor([[{x:3,y:3},{x:4,y:4}]],4096),null);
});

test('original railway geometry and properties survive companion-anchor encoding',()=>{
  const rows=[
    {id:71,type:2,tags:{name:mongolian,'name:en':'Ulaanbaatar',gauge:1520},geometry:[[[-100,400],[210,400],[4300,700]]]},
    {id:72,type:2,tags:{name:'Track',gauge:1435},geometry:[[[220,510],[3900,700]]]},
    {id:73,type:2,tags:{name:mongolian},geometry:[[[-500,600],[-10,600]]]},
    {id:74,type:1,tags:{name:mongolian},geometry:[[900,600]]},
  ];
  const sample=encode.fromGeojsonVt({railway_line_high:{features:rows}},{version:2,extent:4096});
  const data=sample.buffer.slice(sample.byteOffset,sample.byteOffset+sample.byteLength);
  for(const decorated of [markStoredMongolianLines(data),localizeTile(data,'local',{z:10,x:815,y:355},new Set())]){
    const tile=readTile(decorated),row=tile.layers.railway_line_high,anchors=tile.layers.railway_line_high__atlas_mongolian_anchors;
    assert.equal(row.length,4);
    assert.equal(row.feature(0).id,71);
    assert.deepEqual(row.feature(0).loadGeometry()[0].map(p=>[p.x,p.y]),rows[0].geometry[0]);
    assert.equal(row.feature(0).properties.gauge,1520);
    assert.equal(row.feature(1).properties.atlas_mongolian_label_fields,undefined);
    assert.equal(row.feature(2).properties.atlas_mongolian_label_fields,undefined,'off-screen line keeps normal fallback');
    assert.equal(row.feature(3).type,1);
    assert.equal(anchors.length,1);
    assert.equal(anchors.feature(0).id,71);
    const expected=mongolianRouteAnchor(row.feature(0).loadGeometry(),4096);
    const [anchor]=anchors.feature(0).loadGeometry().flat();
    assert.deepEqual({x:anchor.x,y:anchor.y},expected);
  }
  const ordinary=encode.fromGeojsonVt({railway_line_high:{features:[rows[1]]}},{version:2,extent:4096});
  assert.equal(markStoredMongolianLines(ordinary),ordinary,'ordinary tiles pass through without encoding');
});

test('TileJSON advertises companion layers without mutating the provider schema',async()=>{
  const source={tiles:['https://fixture.invalid/rail/{z}/{x}/{y}'],vector_layers:[{id:'x',minzoom:4,fields:{name:'String'}}]};
  const out=withMongolianVectorLayers(source);
  assert.deepEqual(out.vector_layers,[source.vector_layers[0],{id:'x__atlas_mongolian_anchors',minzoom:4,
    fields:{name:'String',atlas_mongolian_label_fields:'String'}}]);
  assert.equal(source.vector_layers.length,1);
  assert.equal(withMongolianVectorLayers(out),out);
  const withoutSchema={tiles:source.tiles};assert.equal(withMongolianVectorLayers(withoutSchema),withoutSchema);
  const protocols={};
  const registry={addProtocol:(scheme,handler)=>{protocols[scheme]=handler;}};
  const installed=installLabelProtocols(registry,{},async()=>new Response(JSON.stringify(source)));
  try{
    for(const scheme of ['atlasrail','atlastext']){
      const res=await protocols[scheme]({url:scheme+'://https://fixture.invalid/rail.json',type:'json'},new AbortController());
      assert.deepEqual(res.data.vector_layers,out.vector_layers);
      assert.equal(res.data.tiles[0],scheme+'://'+source.tiles[0]);
    }
  }finally{installed.dispose();}
});
