import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {DEPTH_COLOURS, depthColour} from '../styles/bathymetry.mjs';
import {POLAR_DEPTH_FORMAT, POLAR_DEPTH_MAX_SIDE} from '../styles/polar.mjs';
import {encodePolarDepth, decodePolarDepth, png, POLAR_DEPTH_MAX} from '../scripts/polar-depth.mjs';
import {PolarLayer} from '../styles/polar-layer.mjs';
import {polarStylePaint} from '../styles/polar-paint.mjs';

const near = (a,b,tol=1e-7) => assert.ok(Math.abs(a-b)<tol, `${a} != ${b}`);
const meta = (size=3) => ({x0:-1,step:1,size,format:POLAR_DEPTH_FORMAT,maxDepth:POLAR_DEPTH_MAX});

test('ETOPO values encode unsigned metre depths with explicit water validity', () => {
  const elevations = new Float32Array([0, -20, -100, -200, -1000, -3000, -6000, -11500, 1,
    NaN, -11501, Infinity, -12.6, -0.4, 999, -32768]);
  const pixels = encodePolarDepth({cols:4,rows:4,values:elevations});
  assert.equal(pixels.length, elevations.length * 3);
  for(const [i,depth] of [[0,0],[1,20],[2,100],[3,200],[4,1000],[5,3000],[6,6000],[7,11500],[12,13],[13,0]]) {
    assert.equal(decodePolarDepth(pixels,i*3),depth);
    assert.deepEqual(depthColour(-depth).slice(3),[255]);
  }
  for(const i of [8,9,10,11,14,15])assert.equal(decodePolarDepth(pixels,i*3),null);
  assert.equal(POLAR_DEPTH_MAX,DEPTH_COLOURS.at(-1)[0]);
  assert.equal(POLAR_DEPTH_FORMAT,'rg8-metres-water-mask-v1');
});

test('malformed or unbounded elevation grids are rejected before allocating pixel buffers', () => {
  for(const grid of [
    {cols:4,rows:4,values:new Float32Array(15)},
    {cols:0,rows:1,values:[]},
    {cols:3.5,rows:4,values:new Float32Array(16)},
    {cols:POLAR_DEPTH_MAX_SIDE+1,rows:2,values:[]},
  ])assert.throws(()=>encodePolarDepth(grid),/Invalid bounded/);
});

test('generated PNG retains exact RGB depth bytes and valid image dimensions', () => {
  const heights=new Float32Array([-6000,-200,0,-4000,500,NaN]);
  const pixels=encodePolarDepth({cols:3,rows:2,values:heights});
  const encoded=png(3,2,pixels);
  assert.deepEqual([...encoded.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(encoded.readUInt32BE(16),3);assert.equal(encoded.readUInt32BE(20),2);
  assert.equal(encoded[24],8);assert.equal(encoded[25],2); // lossless RGB, no gamma
  const idat=encoded.indexOf('IDAT')+4;
  const inflated=inflateSync(encoded.subarray(idat,idat+encoded.readUInt32BE(idat-8)));
  assert.equal(inflated.length,2*(1+3*3));
  assert.equal(inflated[0],0);assert.equal(inflated[10],0);
  assert.deepEqual([...inflated.subarray(1,10)],[...pixels.subarray(0,9)]);
  assert.deepEqual([...inflated.subarray(11,20)],[...pixels.subarray(9,18)]);
  assert.throws(()=>png(3,2,pixels.subarray(0,3)),/Invalid polar PNG/);
});

function fakeLayer() {
  let depthVisible=true, imageCalls=0;
  const layer=new PolarLayer({data:'https://example.org/',units:()=> 'metric'});
  const deleted=[];
  const gl={deleteTexture:t=>deleted.push(t),deleteBuffer(){},deleteProgram(){},disable(){},enable(){},blendFunc(){}};
  const map={triggerRepaint(){},getCenter:()=>({lat:89}),getZoom:()=>5,
    getProjection:()=>({type:'globe'}),getContainer:()=>({clientWidth:400,clientHeight:300}),
    getLayersOrder:()=>['background','water','terrain-bathymetry','landcover-ice-shelf'],
    getLayer:id=>({id,type:'raster',minzoom:0,maxzoom:20}),
    getLayoutProperty:id=>id==='terrain-bathymetry'&&!depthVisible?'none':'visible',
    getPaintProperty:(id,key)=>id==='terrain-bathymetry'&&key==='raster-opacity'?0.75:undefined,
    project:()=>({x:200,y:150})};
  layer.onAdd(map,gl);
  layer.image=async(name, options)=>{imageCalls++;return {name,options};};
  return {layer,map,gl,deleted,setVisible:v=>depthVisible=v,imageCalls:()=>imageCalls};
}

test('polar bathymetry follows the ordinary raster layer visibility and opacity', () => {
  const f=fakeLayer();
  near(polarStylePaint(f.map,6).depthOpacity,0.75);
  assert.equal(polarStylePaint(f.map,6).depthVisible,true);
  f.setVisible(false);
  assert.equal(polarStylePaint(f.map,6).depthVisible,false);
  assert.equal(polarStylePaint({getLayer:()=>undefined,getPaintProperty:()=>undefined},6).depthVisible,false);
  f.layer.onRemove();
});

test('optional depth image is loaded once and old snapshots never make a missing request', async () => {
  const f=fakeLayer(),state={index:{relief:{x0:-1,step:1,size:3}}};
  f.layer.caps.north=state;
  f.layer.ensureDepth('north',state);
  assert.equal(f.imageCalls(),0,'old snapshots keep flat water without requesting absent PNG');
  state.index.depth=meta();
  f.layer.ensureDepth('north',state);f.layer.ensureDepth('north',state);
  assert.equal(f.imageCalls(),1,'only one fetch');
  await Promise.resolve();await Promise.resolve();
  assert.equal(state.depth.name,'north-depth.png');
  assert.deepEqual(state.depth.options,{nearest:true,expectedSize:3});
  f.layer.ensureDepth('north',state);
  assert.equal(f.imageCalls(),1);
  f.layer.onRemove();
  assert.equal(f.deleted.length,1,'GPU depth texture released on teardown');
});

test('invalid schema and failed image preserve the old fill rather than disabling all caps', async () => {
  const f=fakeLayer(),state={index:{relief:{x0:-1,step:1,size:3},depth:{...meta(),size:POLAR_DEPTH_MAX_SIDE+1}}};
  f.layer.caps.north=state;
  const originalWarn=console.warn;console.warn=()=>{};
  try {
    f.layer.ensureDepth('north',state);
    assert.equal(state.depthFailed,true);
    assert.equal(f.imageCalls(),0,'reject unbounded index before network/GPU allocation');
    state.depthFailed=false;state.index.depth=meta();
    f.layer.image=async()=>{throw new Error('404');};
    f.layer.ensureDepth('north',state);
    await Promise.resolve();await Promise.resolve();
    assert.equal(state.depthFailed,true);
    assert.equal(state.depth,undefined);
    assert.equal(f.layer.broken,undefined,'loss of optional depth does not break polar renderer');
  } finally {console.warn=originalWarn;f.layer.onRemove();}
});

test('depth draw sends shared seven palette stops and metres to the shader', () => {
  const f=fakeLayer(),captured={};
  const uniforms={u_image:'sampler',u_grid:'grid',u_opacity:'opacity','u_depth_stops[0]':'levels','u_depth_colours[0]':'rgb'};
  const gl={TEXTURE0:3,TEXTURE_2D:4,activeTexture:()=>{},bindTexture:()=>{},
    uniform1i:(key,v)=>{captured[key]=v;},uniform3f:(key,...v)=>{captured[key]=v;},
    uniform1fv:(key,v)=>{captured[key]=Array.from(v);},uniform3fv:(key,v)=>{captured[key]=Array.from(v);},
    uniform1f:(key,v)=>{captured[key]=v;}};
  f.layer.draw=(mesh,_shader,_projection,set)=>{assert.equal(mesh.kind,'depth');set(gl,uniforms);};
  f.layer.drawDepth({depth:{},reliefMesh:{kind:'relief'},index:{depth:meta()}},{},{},0.7);
  assert.deepEqual(captured.levels,DEPTH_COLOURS.map(x=>x[0]));
  near(captured.opacity,0.7);assert.deepEqual(captured.grid,[-1,1,3]);
  for(let i=0;i<DEPTH_COLOURS.length;i++){
    const rgb=depthColour(-DEPTH_COLOURS[i][0]);
    for(let c=0;c<3;c++)near(captured.rgb[i*3+c],rgb[c]/255,3e-7);
  }
  f.layer.onRemove();
});
