import test from 'node:test';
import assert from 'node:assert/strict';
import {cssRgba, samplePaint, polarStylePaint} from '../styles/polar-paint.mjs';
import {PolarLayer} from '../styles/polar-layer.mjs';

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
  near(first.iceShelfOpacity,0.6);near(first.landContour.opacity,0.8);
  near(first.landContour.majorWidth,1.25);near(first.landContour.minorWidth,0.5);
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
  assert.ok(Number.isFinite(fallbacks.landContour.opacity));
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
    imagery:()=>background==='satellite'});
  layer.onAdd(map,gl);layer.visible=()=>({south:[-20,-20,20,20]});layer.loadCap=()=>{};
  const indexed={units:{metric:[]},carto:{from:10,n:4,tiles:['1-1']}};
  layer.caps.south={index:indexed,disc:{key:'disc'},water:{key:'water'},iceShelves:{key:'iceShelves'},runways:{key:'runways'}};
  layer.loadDetailTile=()=>Object.fromEntries(['buildings','buildingOutlines','aprons','roads','paths','waterways','taxiways']
    .map(key=>[key,{key}]).concat([['loading',false]]));
  layer.fill=(mesh,_,__,color)=>calls.push(['fill',mesh?.key,color]);
  layer.line=(mesh,_,__,color,width)=>calls.push(['line',mesh?.key,color,width]);
  const draw=()=>{calls.length=0;layer.renderCaps(gl,{defaultProjectionData:{projectionTransition:1},shaderData:{}});return calls.slice();};
  return {paint,draw,background:value=>background=value,airports:value=>airports=value};
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
