import assert from 'node:assert/strict';
import test from 'node:test';
import {compileFlatTextLabel,drawFlatTextLabels} from '../styles/flat-labels.mjs';
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
  return {draws,globalAlpha:1,save(){},restore(){},clearRect(){},translate(x,y){draws.push(['translate',x,y]);},rotate(a){draws.push(['rotate',a]);},
    drawImage(...p){draws.push(['image',...p]);},fillText(...p){draws.push(['fill',...p]);},strokeText(...p){draws.push(['halo',...p]);},
    measureText:text=>({width:text.length*5})};
};

test('evaluates recorded language, style filter and size, without reinterpreting literal braces in expression output',()=>{
  const spec=layer('station-demo',{
    'text-field':['coalesce',['get','preferred'],['get','name']],
    'text-size':['interpolate',['linear'],['zoom'],0,8,8,24],
  });
  spec.filter=['==',['get','name'],'Local'];
  const label=compileFlatTextLabel(spec);
  assert.equal(label.resolve({zoom:4},features[0],{x:0,y:0,z:0}).label,'Preferred {East}');
  assert.equal(label.resolve({zoom:4},features[0],{x:0,y:0,z:0}).size,16);
  assert.equal(label.resolve({zoom:4},features[1],{x:0,y:0,z:0}),null);
  spec.paint={'text-opacity':0};
  assert.equal(compileFlatTextLabel(spec).resolve({zoom:4},features[0],{x:0,y:0,z:0}),null);
  const legacy=compileFlatTextLabel(layer('names',{'text-field':'{name} ({preferred})'}));
  assert.equal(legacy.resolve({zoom:0},features[0],{x:0,y:0,z:0}).label,'Local (Preferred {East})');
});

test('draws point text with deterministic priority and keeps unsupported symbols explicit',()=>{
  const ctx=context(), station=layer('station-demo',{'symbol-sort-key':['match',['get','name'],'Local',0,10]});
  station.paint={'text-halo-width':2,'text-color':'#630083'};
  const draw=compileFlatFrame([layer('basemap'),station,{...layer('nonvector-symbol'),'source-layer':undefined},
    layer('icon',{'icon-image':'marker'})]);
  const out=draw(ctx,camera,new Map([['demo',[{vector:{layer:()=>features},tile:{x:0,y:0,z:0}}]]]));
  assert.deepEqual(ctx.draws.map(([action,text])=>[action,text]),[['halo','Local'],['fill','Local']]);
  assert.equal(out.layerDraws.get('station-demo'),1);
  assert.equal(out.layerDraws.get('basemap'),0);
  assert.deepEqual(out.unsupported,['nonvector-symbol','icon']);
});

test('tries alternate anchor when the natural position is blocked',()=>{
  const ctx=context(), base={color:'black',halo:'white',haloWidth:0,font:['Test Bold'],size:10,anchor:'center',
    opacity:1, padding:1, px:100,py:100};
  const counts=drawFlatTextLabels(ctx,camera,[{id:'first',candidates:[{...base,label:'Primary'}]},
    {id:'second',candidates:[{...base,label:'Routed',variable:['top','bottom'],radial:2}]}]);
  assert.deepEqual([...counts],[['first',1],['second',1]]);
  assert.ok(ctx.draws.find(x=>x[1]==='Routed')[3]>ctx.draws.find(x=>x[1]==='Primary')[3]);
});

test('puts a line label on a visible segment, keeps reverse track text upright, and skips short sections',()=>{
  const ctx=context(), name=layer('railway-names',{'symbol-placement':'line'}), draw=compileFlatFrame([name]);
  const lines=[
    {type:2,id:11,extent:256,paths:[[{x:310,y:10},{x:-20,y:110}]],properties:{name:'Main route'}},
    {type:2,id:12,extent:256,paths:[[{x:200,y:202},{x:206,y:201}]],properties:{name:'Too short'}},
  ];
  const result=draw(ctx,camera,new Map([['demo',[{vector:{layer:()=>lines},tile:{x:0,y:0,z:0}}]]]));
  assert.equal(result.layerDraws.get('railway-names'),1);
  const [x,y]=ctx.draws.find(l=>l[0]==='translate').slice(1);
  assert.ok(Math.abs(x-128)<1e-8&&y>60&&y<75);
  const angle=ctx.draws.find(l=>l[0]==='rotate')[1];
  assert.ok(angle<0&&angle> -Math.PI/2);
  assert.deepEqual(ctx.draws.filter(l=>l[0]==='fill').map(l=>l[1]),['Main route']);
});


test('draws only accepted context markers, including unnamed facilities, and exposes just their painted hits',()=>{
  const ctx=context(), sprite={width:48,height:48};
  const transport=layer('context-transport-bus-label',{'icon-image':'context-bus','icon-size':0.75,
    'text-variable-anchor':['left','right'],'text-radial-offset':1.1,'text-optional':true});
  transport.filter=['==',['get','class'],'bus_station'];
  const point=(id,x,y,properties)=>({type:1,id,extent:256,paths:[[{x,y}]],properties});
  const bus={class:'bus_station'};
  const data=[point(1,45,55,{...bus,name:'Transit'}),point(2,45,55,{...bus,name:'Hidden'}),
    point(3,180,200,bus),point(4,200,80,{class:'taxi',name:'Wrong category'}),
    point(5,256,80,{...bus,name:'Buffered'})];
  const hits=[];
  const out=compileFlatFrame([transport])(ctx,camera,new Map([['demo',[{
    vector:{layer:()=>data},tile:{x:0,y:0,z:0}}]]]),{
    getIcon:id=>id==='context-bus'?sprite:null,
    onSymbol:(group,el,rects)=>hits.push([group.id,el.feature.id,rects]),
  });
  assert.deepEqual(out.unsupported,[]);
  assert.equal(out.layerDraws.get(transport.id),2);
  assert.deepEqual(ctx.draws.filter(r=>r[0]==='image'),[['image',sprite,171,191,18,18],['image',sprite,36,46,18,18]]);
  assert.deepEqual(ctx.draws.filter(r=>r[0]==='fill').map(r=>r[1]),['Transit']);
  assert.deepEqual(hits.map(([id,feature,bounds])=>[id,feature,bounds.length]),[
    [transport.id,1,2],[transport.id,3,1],
  ]);
});

test('vertical Mongolian point layout keeps words joined, wraps right, and reserves only painted spans',()=>{
  const ctx=context(), won='ᠮᠣᠩᠭᠣᠯ', to='ᠪᠢᠴᠢᠭ',
    base={color:'black',halo:'white',haloWidth:0,size:10,anchor:'top-left',opacity:1,padding:0};
  const primary={...base,label:'Монгол '+won+' '+to,px:60,py:40,maxWidth:4,feature:{id:1,properties:{}}};
  const labels=[{id:'station-mixed',candidates:[primary]}, {id:'others',candidates:[
    {...base,label:'overlap',px:100,py:60}, {...base,label:'clear',px:60,py:83},
  ]}];
  const hits=[];
  const out=drawFlatTextLabels(ctx,camera,labels,{getMongolianFont:()=> '10px "Atlas Mongolian"',
    onSymbol:(layer,feature,rects)=>hits.push({layer,rects})});
  assert.equal(out.get('station-mixed'),1);
  assert.equal(out.get('others'),1);
  assert.equal(hits[0].rects.length,3);
  assert.ok(hits[0].rects[1].left < hits[0].rects[2].left);
  assert.ok(hits[0].rects[1].bottom > hits[0].rects[0].bottom);
  assert.equal(ctx.draws.filter(a=>a[0]==='rotate'&&a[1]===Math.PI/2).length,2);
  assert.deepEqual(ctx.draws.filter(a=>a[0]==='fill').map(a=>a[1]),['clear','Монгол ',won,to]);
  const pending=context();
  assert.equal(drawFlatTextLabels(pending,camera,[labels[0]]).get('station-mixed'),0);
  assert.equal(pending.draws.length,0,'No misleading horizontal fallback while the packaged font is pending');
});

test('labels a densely sampled straight line, not bends, reversals or disjoint runs',()=>{
  const ctx=context(), draw=compileFlatFrame([layer('relief-labels',{'symbol-placement':'line'})]);
  const line=(id,name,points)=>({type:2,id,extent:256,properties:{name},
    paths:points.map(path=>path.map(([x,y])=>({x,y})))});
  const geometry=[
    line(1,'500 m',[Array.from({length:61},(_,i)=>[10+i,65])]),
    line(2,'corner',[[[10,100],[30,100],[30,120],[50,120]]]),
    line(3,'reversal',[[[10,150],[30,150],[10,150],[30,150]]]),
    line(4,'seam',[[[10,200],[25,200]],[[25,200],[40,200]]]),
  ];
  const frames=new Map([['demo',[{vector:{layer:()=>geometry},tile:{x:0,y:0,z:0}}]]]);
  assert.equal(draw(ctx,camera,frames).layerDraws.get('relief-labels'),1);
  assert.deepEqual(ctx.draws.filter(l=>l[0]==='fill').map(l=>l[1]),['500 m']);
});

test('mixed-script line captions stay upright, wait for their font, and respect visible span length',()=>{
  const word='ᠮᠣᠩᠭᠣᠯ', base={color:'black',halo:'white',haloWidth:0,size:10,opacity:1,padding:0,
    angle:-Math.PI/4,maxWidth:8,length:120};
  const labels=[{id:'routes',candidates:[
    {...base,label:'Монгол '+word,px:60,py:60},
    {...base,label:'Overlong '+word,px:170,py:140,length:20},
    {...base,label:'Ordinary',px:150,py:220},
  ]}];
  const waiting=context();
  const baseResult=drawFlatTextLabels(waiting,camera,labels);
  assert.equal(baseResult.get('routes'),1);
  assert.deepEqual(waiting.draws.filter(a=>a[0]==='fill').map(a=>a[1]),['Ordinary']);
  const loaded=context();
  const out=drawFlatTextLabels(loaded,camera,labels,{getMongolianFont:()=> '10px "Atlas Mongolian"'});
  assert.equal(out.get('routes'),2);
  assert.deepEqual(loaded.draws.filter(a=>a[0]==='rotate').map(a=>a[1]),[-Math.PI/4,Math.PI/2]);
  assert.deepEqual(loaded.draws.filter(a=>a[0]==='fill').map(a=>a[1]),['Ordinary','Монгол ',word]);
});

test('level-crossing marks use the generated road and foot colours only in the configured zoom band',async()=>{
  const {readFile}=await import('node:fs/promises');
  const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url),'utf8'));
  const marks=style.layers.find(l=>l.id==='infrastructure-crossing-marks');
  const point=(id,x,kind)=>({type:1,id,extent:256,paths:[[{x,y:55}]],properties:{kind}});
  const data=[point(11,45,'road'),point(12,90,'foot'),point(13,256,'road')];
  const tiles=new Map([[marks.source,[{tile:{x:0,y:0,z:0},vector:{layer:()=>data}}]]]);
  const ctx=context(), hits=[], paints=[];
  Object.assign(ctx,{beginPath(){},moveTo(){},lineTo(){},
    stroke(){paints.push([this.strokeStyle,this.lineWidth]);}});
  const draw=compileFlatFrame([marks]), options={onSymbol:(_,label)=>hits.push(label.feature.id)};
  for(const zoom of [10.99,15])assert.equal(draw(ctx,{...camera,zoom},tiles,options).layerDraws.has(marks.id),false);
  const result=draw(ctx,{...camera,zoom:13},tiles,options);
  assert.deepEqual(result.unsupported,[]);
  assert.deepEqual(hits,[11,12]);
  assert.equal(result.layerDraws.get(marks.id),2);
  assert.deepEqual(paints.map(p=>p[0]),['rgba(255,254,248,1)','rgba(160,112,74,1)',
    'rgba(255,254,248,1)','rgba(99,51,44,1)']);
  assert.ok(paints[0][1]>paints[1][1],'Distance mark keeps its visible contrasting halo');
});

test('track-count badges preserve placement and leave another label visible at stations',async()=>{
  const {readFile}=await import('node:fs/promises');
  const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url),'utf8'));
  const specs=style.layers.filter(l=>['infrastructure-track-count','infrastructure-station-tracks'].includes(l.id));
  const badge=(id,position,tracks,extra={})=>({id,type:1,extent:256,paths:[[{x:position,y:55}]],
    properties:{tracks,...extra}});
  const same=[badge(11,45,22,{tunnel:true}),badge(12,45,2),badge(13,45,12),badge(14,150,8,{station:true})];
  const draw=compileFlatFrame([...specs,layer('an-independent-station-name')]);
  const tiles=new Map([['trackCounts',[{tile:{x:0,y:0,z:0},vector:{layer:()=>same}}]],
    ['demo',[{tile:{x:0,y:0,z:0},vector:{layer:()=>[{...badge(21,150,1),properties:{name:'Station'}}]}}]]]);
  const ctx=context();
  Object.assign(ctx,{beginPath(){},roundRect(){},stroke(){},fill(){}});
  const prior=draw(ctx,{...camera,zoom:13.999},tiles);
  assert.ok(specs.every(l=>!prior.layerDraws.has(l.id)));
  ctx.draws.length=0;
  const result=draw(ctx,{...camera,zoom:14},tiles);
  assert.deepEqual(result.unsupported,[]);
  assert.equal(result.layerDraws.get('infrastructure-track-count'),1);
  assert.equal(result.layerDraws.get('infrastructure-station-tracks'),1);
  assert.deepEqual(ctx.draws.filter(d=>d[0]==='fill').map(d=>d[1]).sort(),['12','8','Station']);
});

test('CJK label measurement and painting use the supplied font fallback without switching Latin',()=>{
  const ctx=context(), measurements=[], paint=[];
  const measure=ctx.measureText;
  ctx.measureText=function(text){measurements.push([text,this.font]);return measure(text);};
  ctx.fillText=function(text){paint.push([text,this.font]);};
  const candidates=[{type:1,id:12,extent:256,paths:[[{x:40,y:50}]],properties:{name:'𨋢駅'}},
    {type:1,id:13,extent:256,paths:[[{x:190,y:120}]],properties:{name:'Latin'}}];
  const family='"Atlas CJK TC","Atlas Rare Han",sans-serif';
  const draw=compileFlatFrame([layer('station-font')]);
  draw(ctx,camera,new Map([['demo',[{vector:{layer:()=>candidates},tile:{x:0,y:0,z:0}}]]]),
    {getCjkFont:text=>/\p{Script=Han}/u.test(text)?family:null});
  assert.ok(measurements.some(([text,font])=>text==='𨋢駅'&&font===`10px ${family}`));
  assert.deepEqual(paint,[['Latin','10px sans-serif'],['𨋢駅',`10px ${family}`]]);
});

test('Canvas point labels wrap using the generated hospital style width and preserve the icon hit', async()=>{
  const {readFile}=await import('node:fs/promises');
  const world=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url),'utf8'));
  const hospital=world.layers.find(l=>l.id==='context-destinations-hospital-label');
  const compiled=compileFlatTextLabel(hospital);
  const feature={id:51,type:1,properties:{class:'hospital',name:'General Infirmary East Campus'}};
  const p=compiled.resolve({zoom:16},feature,{x:0,y:0,z:0});
  assert.equal(p.label,feature.properties.name);
  assert.equal(p.maxWidth,9);
  const ctx=context(), points=[];
  const result=drawFlatTextLabels(ctx,camera,[{id:hospital.id,candidates:[{...p,anchor:'left',variable:[],
    px:85,py:120,feature}]}],{getIcon:()=>({width:48,height:48}),onSymbol:(id,el,rects)=>points.push(rects)});
  const painted=ctx.draws.filter(l=>l[0]==='fill');
  assert.equal(result.get(hospital.id),1);
  assert.equal(painted.length,2);
  assert.equal(painted.map(l=>l[1]).join(' '),feature.properties.name);
  assert.ok(painted.every(l=>l[1].length*5<=p.maxWidth*p.size));
  assert.equal(points[0].length,2,'the icon remains selectable beside the wrapped text');
});

test('horizontal auto-wrap preserves hard names, nonbreaking spaces and single-line rail placement',()=>{
  const base={color:'black',halo:'white',haloWidth:0,font:['Test Bold'],size:10,anchor:'center',maxWidth:8,
    opacity:1,padding:0,px:128};
  const names=[
    {...base,label:'Main Street Station\n東口',py:65},
    {...base,label:'Centre\u00a0City',py:135,maxWidth:3},
    {...base,label:'A long railway name',py:210,angle:0,length:256,maxWidth:6},
  ];
  const ctx=context();
  const counts=drawFlatTextLabels(ctx,camera,[{id:'labels',candidates:names}]);
  assert.equal(counts.get('labels'),3);
  assert.deepEqual(ctx.draws.filter(a=>a[0]==='fill').map(a=>a[1]),[
    'A long railway name','Centre\u00a0City','Main Street','Station','東口',
  ]);
});


test('width-limited all-Han point labels wrap without breaking variation sequences or changing rail-line text',()=>{
  const ctx=context(), selector='\u{E0100}', rare='𨋢'+selector;
  ctx.measureText=text=>({width:[...text].filter(c=>c!==selector).length*10});
  const label='香港'+rare+'醫院國際醫療中心';
  const point={color:'black',halo:'white',haloWidth:0,size:10,anchor:'center',
    maxWidth:6,opacity:1,padding:0,px:128};
  const points=[
    {...point,label,py:40},
    {...point,label:'香港（港島）站',maxWidth:3,py:95},
    {...point,label:'甲乙\u00a0丙丁',maxWidth:3,py:145},
    {...point,label,py:195,angle:0,length:256},
  ];
  const counts=drawFlatTextLabels(ctx,camera,[{id:'labels',candidates:points}]);
  assert.equal(counts.get('labels'),4);
  assert.deepEqual(ctx.draws.filter(a=>a[0]==='fill').map(a=>a[1]),
    [label,'甲乙\u00a0丙丁','香港（港島）站','香港'+rare+'醫院國','際醫療中心']);
});
