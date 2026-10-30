import test from 'node:test';
import assert from 'node:assert/strict';
import {PolarLayer} from '../styles/polar-layer.mjs';

// Compile-path contract; real GLSL and framebuffer acceptance lives in
// check-polar-depth-browser.mjs, including both caps at 60/82/85 degrees.
test('every polar vertex path restores unit radius before globe projection', () => {
  const shaders=[];
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,
    createShader:type=>({type}),shaderSource:(shader,source)=>{shader.source=source;shaders.push(shader);},
    compileShader(){},getShaderParameter:()=>true,createProgram:()=>({}),attachShader(){},linkProgram(){},
    getProgramParameter:()=>true,deleteShader(){},getUniformLocation:()=>null,getAttribLocation:()=>0};
  const layer=new PolarLayer({data:'https://example.invalid/',units:()=> 'metric'});layer.gl=gl;
  for(const variantName of ['globe','mercator'])for(const kind of ['fill','line','relief','depth']){
    layer.program(kind,{variantName,vertexShaderPrelude:'// fixture prelude',define:variantName==='globe'?'#define GLOBE':''});
    const vertex=shaders.filter(s=>s.type===gl.VERTEX_SHADER).at(-1).source;
    assert.match(vertex,/#ifdef GLOBE\s+return interpolateProjection\(position, normalize\(projectToSphere\(position\)\), 0\.0\);\s+#else\s+return projectTile\(position\);/);
    assert.match(vertex,/polarProjectTile\(a_pos\)/);
    if(kind==='line')assert.match(vertex,/polarProjectTile\(a_other\)/);
    assert.equal((vertex.match(/\bprojectTile\(/g)||[]).length,1,'only the flat fallback may bypass normalization');
  }
});

// Compact real-GPU regression fixture from run 40797254730, head
// 3e991781dacc5975c0241cf63d9559ad2bc894a1, south 85.1 / pitch 82.
// Vertex 3349 is the longitude-zero rim. A 975 m radial error, not
// missing depth data, moved the edge below the camera centre at y=350.
test('captured GPU rim regression is radial and unit restoration recovers coverage', () => {
  const m={yy:-976044.375,yz:223543.75,yt:-991571.5625,
    wy:74514.5859375,wz:325348.125,wt:47502.09765625};
  const clip={y:-32.875,w:1339.62109375};
  const y=clip.y-m.yt,w=clip.w-m.wt,det=m.yy*m.wz-m.yz*m.wy;
  const sphereY=(y*m.wz-w*m.yz)/det,sphereZ=(w*m.yy-y*m.wy)/det;
  const radius=Math.hypot(sphereY,sphereZ);
  assert.ok(radius<0.99985&&radius>0.99984,'preserve the actual non-unit GPU failure');
  const screenY=(cy,cw)=>(1-cy/cw)*350;
  assert.ok(screenY(clip.y,clip.w)>350,'unnormalized rim excludes the camera centre');
  const fixedY=m.yy*sphereY/radius+m.yz*sphereZ/radius+m.yt;
  const fixedW=m.wy*sphereY/radius+m.wz*sphereZ/radius+m.wt;
  assert.ok(screenY(fixedY,fixedW)<350,'unit-radius rim covers the centre without moving the camera');
});
