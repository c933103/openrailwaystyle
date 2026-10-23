import test from 'node:test';
import assert from 'node:assert/strict';
import {cssRgba, samplePaint, polarStylePaint} from '../styles/polar-paint.mjs';
import {PolarLayer} from '../styles/polar-layer.mjs';
import {readFileSync} from 'node:fs';
import {expression as styleExpression} from '@maplibre/maplibre-gl-style-spec';
import {seabedContourOpacity} from '../styles/bathymetry.mjs';
import {encodeLine} from '../styles/polar.mjs';

const world = JSON.parse(readFileSync(new URL('../styles/world.style.json', import.meta.url)));

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} differs from ${b}`);

test('polar colours accept the CSS notation used in the live Atlas style', () => {
  assert.deepEqual(cssRgba('#123'), [0x11/255, 0x22/255, 0x33/255, 1]);
  assert.deepEqual(cssRgba('#11223380', 0.5), [0x11/255, 0x22/255, 0x33/255, 0x80/255*0.5]);
  const rgba = cssRgba('rgba(168, 190, 207, 0.54)', 0.5);
  near(rgba[0], 168/255);near(rgba[1], 190/255);near(rgba[2], 207/255);near(rgba[3], 0.27);
  const hsl = cssRgba('hsl(47, 26%, 88%)');
  assert.ok(hsl.every(Number.isFinite));near(hsl[3], 1);
  assert.equal(cssRgba('not-a-colour'), null);
  assert.equal(cssRgba('#zzzzzz'), null);
  assert.equal(cssRgba('rgba(999, 0, 0, 1)'), null);
  assert.equal(cssRgba('rgba(1, 2, 3, 2)'), null);
  assert.equal(cssRgba('hsl(-, 26%, 88%)'), null);
});

test('sampled expressions follow zoom, properties and old style stops without executing input', () => {
  const contour = ['case',['>',['get','level'],0],0.8,0.4];
  near(samplePaint(contour, 12, {level:1}), 0.8);
  near(samplePaint(contour, 12, {level:0}), 0.4);
  near(samplePaint(['interpolate',['linear'],['zoom'],13,0.12,15,0.24,17,0.34],14),0.18);
  near(samplePaint(['interpolate',['exponential',2],['zoom'],10,1,13,2.5,16,18],13),2.5);
  near(samplePaint({base:1,stops:[[8,1],[20,8]]},14),4.5);
  assert.equal(samplePaint(['unknown',['zoom']], 14), undefined);
  assert.equal(samplePaint(['get','not-present'],14),undefined);
});

const initialPaint = () => ({
  background: {'background-color':'#112233'},
  water: {'fill-color':'#224466'},
  'landcover-ice-shelf':{'fill-color':'hsl(47, 26%, 88%)','fill-opacity':0.6},
  'terrain-contours':{'line-color':['case',['<',['get','ele'],0],'#355577','#996633'],'line-opacity':['interpolate',['linear'],['zoom'],7,0.3,12,0.8],
    'line-width':['case',['>',['get','level'],0],1.25,0.5]},
  'terrain-seabed-contours-close':{'line-color':['case',['<',['get','ele'],0],'#123456','#654321'],'line-opacity':0.55,
    'line-width':['case',['>',['get','level'],0],0.9,0.3]},
  'building-footprints':{'fill-color':'#abcdef','fill-opacity':['interpolate',['linear'],['zoom'],13,0.1,15,0.3]},
  'building-outlines':{'line-color':'#435465','line-opacity':0.2,'line-width':0.6},
  waterway:{'line-color':'rgba(168, 190, 207, 0.54)','line-opacity':0.8,'line-width':{base:1,stops:[[8,1],[20,3]]}},
  'context-transport-airport-area':{'fill-color':'#778899','fill-opacity':0.2},
  'context-transport-airport-runways':{'line-color':['case',['==',['get','class'],'runway'],'#334455','#aab1c8'],
    'line-width':['interpolate',['exponential',2],['zoom'],10,['case',['==',['get','class'],'runway'],1,0.5],
      13,['case',['==',['get','class'],'runway'],2.5,1],
      16,['case',['==',['get','class'],'runway'],18,8]],
    'line-opacity':0.85},
  'terrain-relief':{'hillshade-exaggeration':0.5,'hillshade-shadow-color':'#998877','hillshade-highlight-color':'#eeeeee',
    'hillshade-accent-color':'#667755','hillshade-illumination-direction':270},
});

test('Atlas polar painter samples the actual map style on every render', () => {
  const paint = initialPaint();
  const map = {getPaintProperty:(id,prop)=>paint[id]?.[prop],getLayoutProperty:()=> 'visible'};
  const first = polarStylePaint(map,14);
  assert.equal(first.colours.land,'#112233');assert.equal(first.colours.water,'#224466');
  assert.equal(first.colours.contourLand,'#996633');assert.equal(first.colours.contourSeabed,'#123456');
  near(first.iceShelfOpacity,0.6);near(first.landContour({ele:100,level:1}).opacity,0.8);
  near(first.landContour({ele:100,level:1}).width,1.25);near(first.landContour({ele:100,level:0}).width,0.5);
  near(first.buildingOpacity,0.2);near(first.runwayWidth,2.5 + (18 - 2.5) / 7); // exponential-base-2 zoom progression
  near(first.taxiwayWidth,2);
  assert.equal(first.colours.runway,'#334455');assert.equal(first.colours.taxiway,'#aab1c8');
  assert.equal(first.relief.exaggeration,0.5);assert.equal(first.relief.direction,270);
  paint.background['background-color']='#ffeedd';
  paint.water['fill-color']='#102030';
  paint['terrain-relief']['hillshade-shadow-color']='#010203';
  const next=polarStylePaint(map,14);
  assert.equal(next.colours.land,'#ffeedd');assert.equal(next.colours.water,'#102030');
  assert.equal(next.relief.shadow,'#010203');
  map.getLayoutProperty=()=> 'none';
  assert.equal(polarStylePaint(map,14).airportVisible,false);
  const fallbacks=polarStylePaint({getPaintProperty(){throw new Error('no style yet');}},11);
  assert.equal(fallbacks.colours.land,'#f2f1e9');
  assert.ok(Number.isFinite(fallbacks.landContour({ele:100,level:0}).opacity));
});

function polarFixture() {
  let background='map', airports=true;
  const paint=initialPaint(), calls=[];
  const map={
    getCenter:()=>({lat:-89.9}),getZoom:()=>15,getProjection:()=>({type:'globe'}),
    getContainer:()=>({clientWidth:400,clientHeight:300}),
    project:()=>({x:200,y:150}),triggerRepaint(){},
    getPaintProperty:(id,key)=>paint[id]?.[key],
    getLayoutProperty:()=>airports?'visible':'none',
  };
  const gl={disable(){},enable(){},blendFunc(){},deleteBuffer(){},deleteTexture(){},deleteProgram(){}};
  const layer=new PolarLayer({data:'https://example.org/',units:()=> 'metric',palette:()=>background,relief:()=>false,places:()=>{},
    imagery:()=>['satellite','hybrid'].includes(background)});
  layer.onAdd(map,gl);layer.visible=()=>({south:[-20,-20,20,20]});layer.loadCap=()=>{};
  const indexed={units:{metric:[]},carto:{from:10,n:4,tiles:['1-1']}};
  layer.caps.south={index:indexed,disc:{key:'disc'},water:{key:'water'},iceShelves:{key:'iceShelves'},runways:{key:'runways'}};
  layer.loadDetailTile=()=>Object.fromEntries(['buildings','buildingOutlines','aprons','roads','paths','waterways','taxiways']
    .map(key=>[key,{key}]).concat([['loading',false],['places',[]]]));
  layer.fill=(mesh,_,__,color)=>calls.push(['fill',mesh?.key,color]);
  layer.line=(mesh,_,__,color,width)=>calls.push(['line',mesh?.key,color,width]);
  const draw=()=>{calls.length=0;layer.renderCaps(gl,{defaultProjectionData:{projectionTransition:1},shaderData:{}});return calls.slice();};
  return {paint,draw,layer,map,background:value=>background=value,airports:value=>airports=value};
}

test('rendered Atlas cap omits Carto roads and respects style changes and transport visibility', () => {
  const f=polarFixture(),first=f.draw();
  const by=(calls,key)=>calls.find(call=>call[1]===key);
  assert.equal(by(first,'roads'),undefined);assert.equal(by(first,'paths'),undefined);
  assert.ok(by(first,'waterways'));assert.ok(by(first,'buildingOutlines'));
  assert.ok(by(first,'aprons'));assert.ok(by(first,'runways'));
  near(by(first,'disc')[2][0],0x11/255);near(by(first,'disc')[2][1],0x22/255);
  f.paint.background['background-color']='#445566';
  const updated=f.draw();
  near(by(updated,'disc')[2][0],0x44/255);
  f.airports(false);
  const disabled=f.draw();
  for(const key of ['runways','aprons','taxiways'])assert.equal(by(disabled,key),undefined,key);
  f.background('carto');
  const carto=f.draw();
  for(const key of ['roads','paths','taxiways','aprons'])assert.ok(by(carto,key),key);
  f.background('satellite');
  const satellite=f.draw();
  assert.ok(by(satellite,'disc'));assert.equal(by(satellite,'waterways'),undefined);
});

test('actual seabed expressions agree with MapLibre at every depth, class, zoom and unit', () => {
  const paint = Object.fromEntries(world.layers.map(layer => [layer.id, structuredClone(layer.paint)]));
  const map = {getPaintProperty:(id,key)=>paint[id]?.[key]};
  for (const units of ['metric','imperial']) {
    for (const id of ['terrain-seabed-contours','terrain-seabed-contours-close']) {
      if (units === 'imperial') paint[id]['line-opacity'] = seabedContourOpacity(units);
    }
    for (const zoom of [5,7.5,10.99,11,12,15]) for (const ele of [-10,-200,-800,-1000,-3000,-6000]) for (const level of [0,1]) {
      const properties = {ele:ele*(units==='imperial'?3.28084:1),level};
      const id=zoom>=11?'terrain-seabed-contours-close':'terrain-seabed-contours';
      const expression=paint[id]['line-opacity'], compiled=styleExpression.createExpression(expression);
      assert.equal(compiled.result,'success');
      const expected=compiled.value.evaluate({zoom},{type:'LineString',properties});
      near(samplePaint(expression,zoom,properties),expected);
      near(polarStylePaint(map,zoom).seabedContour(properties).opacity,expected);
    }
  }
  paint['terrain-seabed-contours-close']['line-opacity']=['*',0.25,['case',['>', ['get','level'],0],1,0.2],['/', ['abs',['get','ele']],1000]];
  near(polarStylePaint(map,14).seabedContour({ele:-1000,level:0}).opacity,0.05);
  near(polarStylePaint(map,14).seabedContour({ele:-1000,level:1}).opacity,0.25);
});

test('paint arithmetic rejects missing, nonnumeric, nonfinite, excessive and executable input', () => {
  for(const expression of [['*',['get','missing'],2],['*','2',2],['/',1,0],['*',1e308,1e308],['abs',1,2],['-',1,2,3],['interpolate',['linear'],['get','ele'],0,1,0,2],['eval','globalThis.attack=true']])
    assert.equal(samplePaint(expression,12),undefined,JSON.stringify(expression));
  near(samplePaint(['+',2,['-',5,3],['-',1]],12),3);
  const inherited=Object.create({ele:-100});
  assert.equal(samplePaint(['get','ele'],12,inherited),undefined);
  let deep=1;for(let i=0;i<100;i++)deep=['abs',deep];
  assert.equal(samplePaint(deep,12),undefined);
  const cycle=['abs'];cycle.push(cycle);assert.equal(samplePaint(cycle,12),undefined);
  assert.equal(samplePaint(['+',...Array(3000).fill(1)],12),undefined);
});

test('legacy stop functions consume the shared budget before reading entries', () => {
  const stops = Array.from({length:1000},(_,i)=>[i,i]);
  let reads=0;
  Object.defineProperty(stops,0,{get(){reads++;return [0,0];}});
  assert.equal(samplePaint({stops},999),undefined);
  assert.equal(reads,0,'oversized legacy input is rejected before the scan');
  const bounded={stops:Array.from({length:400},(_,i)=>[i,i])};
  near(samplePaint(bounded,200.5),200.5);
  assert.equal(samplePaint(['+',bounded,bounded],200.5),undefined,'sibling legacy functions debit one shared budget');
  for(const legacy of [{stops:[[0,0],[0,1]]},{stops:[[0,0],null]},{stops:[[0,0],[1,Infinity]]},{stops:[[0,0],[1,1]],base:0}])
    assert.equal(samplePaint(legacy,0.5),undefined);
});

test('contour ranges preserve elevation/class and draw offsets with four owned GPU meshes', async () => {
  const f=polarFixture(), uploads=[], deleted=[];
  f.layer.gl.deleteBuffer=buffer=>deleted.push(buffer);
  f.layer.upload=(mesh,kind)=>{const index=uploads.length;const result={kind,count:mesh.indices.length,bytes:(mesh.data.length+mesh.indices.length)*4,buffers:[`v${index}`,`i${index}`]};uploads.push(result);return result;};
  f.layer.json=async()=>({lines:[[-100,0],[-3000,0],[-100,1],[100,0],[100,1],[-100,0]].map(([ele,level])=>[ele,level,...encodeLine([[0,0],[1,1],[2,1]])])});
  const tile=f.layer.loadTile('south-metric-2-1-1');
  await Promise.resolve();await Promise.resolve();
  assert.equal(tile.loading,false);assert.equal(uploads.length,4);
  assert.equal(tile.parts.length,4);assert.equal(tile.bytes,uploads.reduce((sum,mesh)=>sum+mesh.bytes,0));
  assert.deepEqual(tile.seabedMinor.ranges,[{properties:{ele:-100,level:0},count:24,offset:0},{properties:{ele:-3000,level:0},count:12,offset:96}]);
  assert.deepEqual(tile.seabedMajor.ranges[0].properties,{ele:-100,level:1});
  f.layer.relief=()=>true;
  f.layer.caps.south.index.units.metric=[{n:1,tiles:['0-0']}];
  f.layer.loadTile=()=>tile;
  const drawn=[], originalLine=f.layer.line;
  f.layer.line=(mesh,...args)=>{if(mesh?.properties)drawn.push({properties:mesh.properties,colour:args[2]});originalLine(mesh,...args);};
  const actual=world.layers.find(layer=>layer.id==='terrain-seabed-contours-close').paint;
  f.paint['terrain-seabed-contours-close']=structuredClone(actual);
  const first=f.draw().filter(call=>call[0]==='line'&&call[1]===undefined);
  assert.equal(first.length,5,'two seabed depths, major seabed and two land classes');
  const alpha=(ele,level)=>drawn.find(item=>item.properties.ele===ele&&item.properties.level===level).colour[3];
  assert.ok(alpha(-100,0)>alpha(-3000,0),'deep minor contour is fainter');
  assert.ok(alpha(-100,1)>alpha(-100,0),'major contour is stronger at the same depth');
  f.paint['terrain-seabed-contours-close']['line-opacity']=['case',['>', ['get','level'],0],0.7,0.1];
  drawn.length=0;f.draw();
  near(alpha(-100,0),0.1);near(alpha(-3000,0),0.1);near(alpha(-100,1),0.7);
  f.layer.onRemove();assert.equal(deleted.length,8);assert.equal(new Set(deleted).size,8);
});

test('Atlas draws all tiles in ordinary layer order and follows in-session layer moves', () => {
  const f=polarFixture();
  f.map.getLayersOrder=()=>world.layers.map(layer=>layer.id);
  f.layer.caps.south.index.carto={from:10,n:4,tiles:['1-1','2-2']};
  const keys=f.draw().map(call=>call[1]).filter(key=>['aprons','buildings','buildingOutlines','runways','taxiways','waterways'].includes(key));
  assert.deepEqual(keys,['aprons','aprons','buildings','buildings','buildingOutlines','buildingOutlines','runways','taxiways','taxiways','waterways','waterways']);
  f.map.getLayersOrder=()=>['waterway',...world.layers.map(layer=>layer.id).filter(id=>id!=='waterway')];
  const changed=f.draw().map(call=>call[1]).filter(key=>keys.includes(key));
  assert.deepEqual(changed.slice(0,2),['waterways','waterways']);
  f.background('carto');const carto=f.draw().map(call=>call[1]);
  assert.ok(carto.indexOf('runways')<carto.indexOf('aprons'),'Carto keeps its existing sequence');
  for(const mode of ['satellite','hybrid']){f.background(mode);assert.deepEqual(f.draw().map(call=>call[1]),['disc']);}
});

test('contour subranges use byte offsets without owning or deleting shared buffers', () => {
  const layer=new PolarLayer({});const draws=[];
  layer.gl=new Proxy({drawElements:(...args)=>draws.push(args)}, {get:(obj,key)=>obj[key]??(()=>{})});
  layer.program=()=>({program:{},uniforms:{},attributes:{pos:0,other:1,side:2}});
  const mesh={kind:'line',buffers:['v','i'],count:6,offset:48};
  layer.draw(mesh,{}, {tileMercatorCoords:[],clippingPlane:[]},()=>{});
  assert.equal(draws[0][1],6);assert.equal(draws[0][3],48);
});
