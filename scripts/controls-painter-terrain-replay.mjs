// Offline CPU decision replay. Actual pinned MapLibre classes, synthetic GPU boundary.
// This is not a browser or pixel rendering test and makes no network request.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {fileURLToPath} from 'node:url';
import {installControlsPainterProbe,sampleControlsTerrainFrame} from './controls-painter-probe.mjs';
import {installHiddenTileMaskGuard} from '../styles/map-controls.mjs';
import {nonemptyPainterStyle} from './controls-painter-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const mapBytes=await readFile(root+'node_modules/maplibre-gl/dist/maplibre-gl.js.map');
assert.equal(createHash('sha256').update(mapBytes).digest('hex'),'a09ebdfe7d8a259b7c67a470caa2d4e57d31262bc99020ec41983d3325fa9901');
const sourceMap=JSON.parse(mapBytes);
export const sourceHashes={};
for(const path of ['render/painter.ts','webgl/render_to_texture.ts','webgl/render_pool.ts','webgl/draw/draw_terrain.ts','style/style_layer.ts','ui/map.ts']){
 const source=await readFile(root+'node_modules/maplibre-gl/src/'+path,'utf8');
 assert.equal(sourceMap.sourcesContent[sourceMap.sources.indexOf('../src/'+path)],source,path+' belongs to pinned bundle');
 sourceHashes[path]=createHash('sha256').update(source).digest('hex');
}
const compiled=await build({stdin:{contents:"export {Map as MapLibreMap} from './node_modules/maplibre-gl/src/ui/map.ts'; export {Painter} from './node_modules/maplibre-gl/src/render/painter.ts'; export {RenderToTexture} from './node_modules/maplibre-gl/src/webgl/render_to_texture.ts'; export {createStyleLayer} from './node_modules/maplibre-gl/src/style/create_style_layer.ts'; export {EvaluationParameters} from './node_modules/maplibre-gl/src/style/evaluation_parameters.ts';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'replay',platform:'browser',tsconfigRaw:{compilerOptions:{useDefineForClassFields:false}},loader:{'.glsl':'text'}});
const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.eval(compiled.outputFiles[0].text);
const {Painter,RenderToTexture,createStyleLayer,EvaluationParameters,MapLibreMap}=dom.window.replay;
const noop=()=>{};
const normal=value=>JSON.parse(JSON.stringify(value));
export function terrainDecisionFixture({guard=false,warm=0,dropLayer=false,reverseLayers=false,dropTile=false,skipVisibleMasks=false}={}){
 const raw=nonemptyPainterStyle('http://127.0.0.1:4173/');
 if(dropLayer)raw.layers=raw.layers.filter(x=>x.id!=='fill-7');
 if(reverseLayers){const a=raw.layers.findIndex(x=>x.id==='fill-6'),b=raw.layers.findIndex(x=>x.id==='fill-7');[raw.layers[a],raw.layers[b]]=[raw.layers[b],raw.layers[a]];}
 const layers=raw.layers.map(spec=>{const l=createStyleLayer(spec,{});l.recalculate(new EvaluationParameters(3),[]);return l;});
 const tileID=i=>({key:`3/${i}/0`,canonical:{z:3,x:i,y:0},toUnwrapped(){return this;}});
 const tiles=Array.from({length:20},(_,i)=>({tileID:tileID(i),rtt:[],rttFingerprint:{}}));
 let renderable=tiles,fb=null,boundTexture=null,composite=[],coverageErrors=[],time=0;
 const scopes={performance:{now:()=>++time,timeOrigin:0},setTimeout:()=>1,clearTimeout:noop};
 const sourceCoords=tiles.map(t=>t.tileID);
 const tileManagers=Object.fromEntries(Object.keys(raw.sources).map(id=>[id,{used:true,prepare:noop,getVisibleCoordinates:()=>id==='hidden'?[]:sourceCoords.map(c=>({...c,key:id+':'+c.key,terrainKey:c.key})),getSource:()=>({}),getState:()=>({revision:1})}]));
 const context={gl:{TRIANGLES:4,ALWAYS:519,EQUAL:514,KEEP:7680,REPLACE:7681,LEQUAL:515,bindTexture:(_target,texture)=>{boundTexture=texture;}},setColorMode:noop,setDepthMode:noop,
  viewport:{set:noop},activeTexture:{set:noop},bindFramebuffer:{set:f=>{fb=f;}},clear:()=>{if(fb){fb.layers=[];fb.stencil.clear();}},setDefault:noop};
 const painter=Object.create(Painter.prototype);
 Object.assign(painter,{context,transform:{zoom:3,pitch:45,getProjectionData:({overscaledTileID})=>({tile:overscaledTileID}),calculateFogMatrix:()=>new Float32Array(16)},numSublayers:1,depthEpsilon:1/65536,
  width:512,height:512,currentStencilSource:undefined,nextStencilID:1,
  clearStencil(){this.nextStencilID=1;this.currentStencilSource=undefined;if(fb)fb.stencil.clear();},
  useProgram:name=>({draw:(_context,_mode,_depth,mode,_color,_cull,_uniforms,_terrain,projection)=>{
   if(name==='terrain')composite.push({tile:projection.tile.key,layers:[...boundTexture.layers]});
   else if(fb)fb.stencil.set(projection.tile.key,mode.ref);
  }}),
  drawFunctions:Object.fromEntries(['symbol','circle','heatmap','line','fill','fillExtrusion','background','raster','hillshade','colorRelief','custom','sky','atmosphere'].map(type=>[type,(_p,_m,layer,coords)=>{
   if(type==='background'){layer=_m;coords=[...fb.stencil.keys()];}
   if(layer?.isTileClipped())for(const c of coords){const mode=painter.stencilModeForClipping(c);if(mode.ref===undefined||fb.stencil.get(c.key)!==mode.ref)coverageErrors.push({layer:layer.id,tile:c.key});}
   if(fb)fb.layers.push(layer?.id||type);
  }]))});
 const style={_order:layers.map(l=>l.id),_layers:Object.fromEntries(layers.map(l=>[l.id,l])),tileManagers,
  imageManager:{beginFrame:noop},placement:{symbolFadeChange:()=>0,variableOffsets:{}},map:{},
  projection:{transitionState:0,updateGPUdependent:noop,getMeshFromTileID:()=>({vertexBuffer:{},indexBuffer:{},segments:{}})}};
 const terrain={qualityFactor:1,tileManager:{tileSize:256,getRenderableTiles:()=>renderable,getTerrainCoords:id=>({[id.terrainKey]:id})},getTerrainMesh:()=>({vertexBuffer:{},indexBuffer:{},segments:{}}),getTerrainData:()=>({}),getMeshFrameDelta:()=>0};
 painter.renderToTexture=new RenderToTexture(painter,terrain);
 // Only allocate synthetic GPU resources; retain the actual pool/caching algorithm.
 painter.renderToTexture.pool._createObject=id=>{const framebuffer={layers:[],stencil:new Map()};return {id,fbo:{framebuffer,width:256,height:256},texture:{texture:framebuffer},stamp:-1,inUse:false};};
 const map={painter,style,_render:()=>painter.render(style,{}),redraw:MapLibreMap.prototype.redraw,
  loaded:()=>true,areTilesLoaded:()=>true,isMoving:()=>false,getPixelRatio:()=>1,
  getCanvas:()=>({width:512,height:512}),getContainer:()=>({clientWidth:512,clientHeight:512})};
 if(guard)installHiddenTileMaskGuard(map);
 if(skipVisibleMasks){const orig=painter._renderTileClippingMasks;painter._renderTileClippingMasks=function(layer,...args){if(layer.id==='fill-7')return;return orig.call(this,layer,...args);};}
 if(warm){renderable=tiles.slice(0,warm);map._render();}
 renderable=dropTile?tiles.slice(0,-1):tiles;
 const probe=installControlsPainterProbe(map,{scope:scopes});
 function capture({invalidate=false}={}){
  if(invalidate)for(const tile of renderable)tile.rtt=[];
  composite=[];coverageErrors=[];probe.arm();map._render();probe.stop();
  const snapshot=probe.snapshot();return {dispatch:snapshot.lastVisibleDispatch,composite:normal(composite),coverageErrors:normal(coverageErrors),maskDraws:snapshot.maskDraws,frameCount:snapshot.frameCount};
 }
 function sample(cache){composite=[];coverageErrors=[];const sampled=sampleControlsTerrainFrame(map,probe,{cache});return {sample:sampled,composite:normal(composite),coverageErrors:normal(coverageErrors)};}
 return {capture,sample,tiles,probe,map};
}

export function closeTerrainReplay(){dom.window.close();}
