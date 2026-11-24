import assert from 'node:assert/strict';
import test from 'node:test';
import {compileFlatPointLabel,drawFlatPointLabels} from '../styles/flat-labels.mjs';
import {compileFlatFrame} from '../styles/flat-frame.mjs';

const layer=(id,options={})=>({id,type:'symbol',source:'demo','source-layer':'stations',
  layout:{'text-field':['get','name'],'text-size':10,...options}});
const features=[{type:1,id:1,extent:256,paths:[[{x:100,y:100}]],properties:{name:'Local',preferred:'Preferred {East}'}},
  {type:1,id:2,extent:256,paths:[[{x:100,y:100}]],properties:{name:'Other'}},
  {type:1,id:3,extent:256,paths:[[{x:256,y:100}]],properties:{name:'Off-tile buffer'}},
  {type:2,id:4,extent:256,paths:[[{x:25,y:25},{x:50,y:50}]],properties:{name:'Not a point'}}];
const camera={width:256,height:256,zoom:4,tileTransform:()=>[256,0,0,256,0,0]};
const context=()=>{
  const draws=[];
  return {draws,globalAlpha:1,save(){},restore(){},clearRect(){},
    fillText(...p){draws.push(['fill',...p]);},strokeText(...p){draws.push(['halo',...p]);},
    measureText:text=>({width:text.length*5})};
};

test('evaluates recorded language, style filter and size, without reinterpreting literal braces in expression output',()=>{
  const spec=layer('station-demo',{
    'text-field':['coalesce',['get','preferred'],['get','name']],
    'text-size':['interpolate',['linear'],['zoom'],0,8,8,24],
  });
  spec.filter=['==',['get','name'],'Local'];
  const label=compileFlatPointLabel(spec);
  assert.equal(label.resolve({zoom:4},features[0],{x:0,y:0,z:0}).label,'Preferred {East}');
  assert.equal(label.resolve({zoom:4},features[0],{x:0,y:0,z:0}).size,16);
  assert.equal(label.resolve({zoom:4},features[1],{x:0,y:0,z:0}),null);
  spec.paint={'text-opacity':0};
  assert.equal(compileFlatPointLabel(spec).resolve({zoom:4},features[0],{x:0,y:0,z:0}),null);
  const legacy=compileFlatPointLabel(layer('names',{'text-field':'{name} ({preferred})'}));
  assert.equal(legacy.resolve({zoom:0},features[0],{x:0,y:0,z:0}).label,'Local (Preferred {East})');
});

test('draws point text with deterministic priority and keeps unsupported symbols explicit',()=>{
  const ctx=context(), station=layer('station-demo',{'symbol-sort-key':['match',['get','name'],'Local',0,10]});
  station.paint={'text-halo-width':2,'text-color':'#630083'};
  const draw=compileFlatFrame([layer('basemap'),station,layer('lines',{'symbol-placement':'line'}),
    layer('icon',{'icon-image':'marker'})]);
  const out=draw(ctx,camera,new Map([['demo',[{vector:{layer:()=>features},tile:{x:0,y:0,z:0}}]]]));
  assert.deepEqual(ctx.draws.map(([action,text])=>[action,text]),[['halo','Local'],['fill','Local']]);
  assert.equal(out.layerDraws.get('station-demo'),1);
  assert.equal(out.layerDraws.get('basemap'),0);
  assert.deepEqual(out.unsupported,['lines','icon']);
});

test('tries alternate anchor when the natural position is blocked',()=>{
  const ctx=context(), base={color:'black',halo:'white',haloWidth:0,font:['Test Bold'],size:10,anchor:'center',
    opacity:1, padding:1, px:100,py:100};
  const counts=drawFlatPointLabels(ctx,camera,[{id:'first',candidates:[{...base,label:'Primary'}]},
    {id:'second',candidates:[{...base,label:'Routed',variable:['top','bottom'],radial:2}]}]);
  assert.deepEqual([...counts],[['first',1],['second',1]]);
  assert.ok(ctx.draws.find(x=>x[1]==='Routed')[3]>ctx.draws.find(x=>x[1]==='Primary')[3]);
});
