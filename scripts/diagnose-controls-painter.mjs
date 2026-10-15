// Local-only analysis. Executes pinned MapLibre painter decisions with stubbed
// GPU submission; it does not render pixels, access a browser, or request data.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {layerVisibility} from '../styles/layer-semantics.mjs';
import {readSettings} from '../styles/map-model.mjs';
import {guardHiddenTileMasks} from './controls-painter-probe.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const mapPath='node_modules/maplibre-gl/dist/maplibre-gl.js.map';
const mapBytes=await readFile(root+mapPath);
if(createHash('sha256').update(mapBytes).digest('hex')!=='a09ebdfe7d8a259b7c67a470caa2d4e57d31262bc99020ec41983d3325fa9901')throw new Error('Unexpected pinned source map');
const sourceMap=JSON.parse(mapBytes);
for(const path of ['render/painter.ts','style/style_layer.ts','tile/tile.ts']) {
 const text=await readFile(root+'node_modules/maplibre-gl/src/'+path,'utf8');
 if(sourceMap.sourcesContent[sourceMap.sources.indexOf('../src/'+path)]!==text)throw new Error('Source differs from pinned distribution: '+path);
}
const compiled=await build({stdin:{contents:"export {Painter} from './node_modules/maplibre-gl/src/render/painter.ts'; export {createStyleLayer} from './node_modules/maplibre-gl/src/style/create_style_layer.ts'; export {EvaluationParameters} from './node_modules/maplibre-gl/src/style/evaluation_parameters.ts'; export {Tile} from './node_modules/maplibre-gl/src/tile/tile.ts';",resolveDir:root,loader:'ts'},bundle:true,write:false,format:'iife',globalName:'fixtureLibrary',platform:'browser',tsconfigRaw:{compilerOptions:{useDefineForClassFields:false}},loader:{'.glsl':'text'}});
const dom=new JSDOM('',{runScripts:'outside-only'});
dom.window.eval(compiled.outputFiles[0].text);
const {Painter,createStyleLayer,EvaluationParameters,Tile}=dom.window.fixtureLibrary;
const rawStyle=JSON.parse(await readFile(root+'styles/world.style.json','utf8'));
const defaultSettings=readSettings('?mode=infrastructure&relief=0&inactive=0');
const noop=()=>{};

export function painterDecisionRun({zoom=9,skipHiddenMasks=false,layerSpecs=rawStyle.layers,sourceCounts={openmaptiles:88,railway:88,stations:88,crossingsDetail:88,branchLines:88},settings=defaultSettings,visibilitySequence=[{}]}={}) {
 const layers=layerSpecs.map(spec=>{
  spec=structuredClone(spec);
  const visible=layerVisibility(spec,settings);
  if(visible!==undefined)(spec.layout??={}).visibility=visible?'visible':'none';
  const layer=createStyleLayer(spec,{});
  layer.recalculate(new EvaluationParameters(zoom),[]);
  return layer;
 });
 const calls=[],paint=[],stencil=new Map(),violations=[],frames=[];
 let clears=0,frame=0;
 const managers=Object.fromEntries(Object.keys({...rawStyle.sources,...sourceCounts}).map(id=>{
  const coords=Array.from({length:sourceCounts[id]||0},(_,i)=>({key:`${zoom}:${i}:0`,canonical:{z:zoom,x:i,y:0}}));
  return [id,{used:true,prepare:noop,getVisibleCoordinates:()=>coords}];
 }));
 const painter=Object.create(Painter.prototype);
 const context={gl:{TRIANGLES:4,ALWAYS:519,EQUAL:514,KEEP:7680,REPLACE:7681},setColorMode:noop,setDepthMode:noop,
  viewport:{set:noop},bindFramebuffer:{set:noop},clear:noop,setDefault:noop};
 Object.assign(painter,{context,transform:{zoom,getProjectionData:({overscaledTileID})=>({tile:overscaledTileID})},numSublayers:1,depthEpsilon:1/65536,
  width:1365,height:900,currentStencilSource:undefined,nextStencilID:1,
  clearStencil(){clears++;stencil.clear();this.nextStencilID=1;this.currentStencilSource=undefined;},
  useProgram:()=>({draw:(_context,_mode,_depth,mode,_color,_cull,_uniforms,_terrain,projection)=>{
   stencil.set(projection.tile.key,mode.ref);
   calls.push({frame,pass:painter.renderPass,layer:painter._observedLayer.id,source:painter._observedLayer.source,hidden:painter._observedLayer.isHidden(zoom)});
  }}),
  drawFunctions:Object.fromEntries(['symbol','circle','heatmap','line','fill','fillExtrusion','background','raster','hillshade','colorRelief','custom','sky','atmosphere'].map(type=>[type,(_p,_m,layer,coords)=>{
   const coverage=[];
   if(layer?.isTileClipped())for(const tile of coords){
    const mode=painter.stencilModeForClipping(tile),accepted=mode.ref!==undefined&&stencil.get(tile.key)===mode.ref;
    if(!accepted)violations.push({frame,layer:layer.id,tile:tile.key});
    coverage.push([tile.key,accepted]);
   }
   paint.push({frame,pass:painter.renderPass,layer:layer?.id||type,coverage});
  }]))});
 const masks=skipHiddenMasks?guardHiddenTileMasks(Painter.prototype._renderTileClippingMasks):Painter.prototype._renderTileClippingMasks;
 painter._renderTileClippingMasks=function(layer,...args){
  this._observedLayer=layer;
  return masks.call(this,layer,...args);
 };
 const style={_order:layers.map(l=>l.id),_layers:Object.fromEntries(layers.map(l=>[l.id,l])),tileManagers:managers,
  imageManager:{beginFrame:noop},placement:{symbolFadeChange:()=>0,variableOffsets:{}},map:{},
  projection:{transitionState:0,updateGPUdependent:noop,getMeshFromTileID:()=>({vertexBuffer:{},indexBuffer:{},segments:{}})}};
 for(const visibility of visibilitySequence){
  const start=calls.length,paintStart=paint.length,clearStart=clears;
  for(const [id,value] of Object.entries(visibility)){
   const layer=style._layers[id];if(!layer)throw new Error('Unknown transition layer '+id);
   layer.setLayoutProperty('visibility',value,{validate:false});
   layer.recalculate(new EvaluationParameters(zoom),[]);
  }
  painter.render(style,{});
  frames.push({frame,draws:calls.length-start,paintDispatches:paint.length-paintStart,clears:clears-clearStart});frame++;
 }
 const countBy=(key)=>Object.fromEntries([...new Set(calls.map(c=>c[key]))].map(k=>[k,calls.filter(c=>c[key]===k).length]));
 return {draws:calls.length,hiddenDraws:calls.filter(c=>c.hidden).length,bySource:countBy('source'),byLayer:countBy('layer'),paint,calls,violations,frames,clears};
}

export function emptyTileIsRenderable(){
 const tile=Object.create(Tile.prototype);
 Object.assign(tile,{state:'loaded',buckets:{},holdingForSymbolFade:()=>false});
 return tile.hasData()&&tile.isRenderable(false);
}
export function close(){dom.window.close();}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const before=painterDecisionRun(),after=painterDecisionRun({skipHiddenMasks:true});
 console.log(JSON.stringify({kind:'CPU decision test with synthetic GPU boundary; not browser timing or pixel proof',emptyLoadedTileRenderable:emptyTileIsRenderable(),before:{draws:before.draws,hiddenDraws:before.hiddenDraws,clears:before.clears,bySource:before.bySource,byLayer:before.byLayer},inMemoryHiddenGuard:{draws:after.draws,hiddenDraws:after.hiddenDraws,clears:after.clears,bySource:after.bySource,byLayer:after.byLayer},paintDispatchAndAbstractStencilCoverageIdentical:JSON.stringify(before.paint)===JSON.stringify(after.paint),violations:{before:before.violations,after:after.violations}},null,2));
 close();
}
