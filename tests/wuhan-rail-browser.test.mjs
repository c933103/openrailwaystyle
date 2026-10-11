import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {WUHAN_CENTER,WUHAN_ZOOMS,wuhanRailPlan,assertWuhanRail} from '../scripts/wuhan-rail-browser.mjs';
const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
function report(zoom=7,overrides={}) {
  const {speedLayer,...plan}=wuhanRailPlan(zoom);
  return {...plan,infrastructureVisibility:'visible',speedVisibility:'none',sourceLoaded:true,
    providerSourceFeatures:2,providerPresentRail:2,rendered:1,...overrides};
}
test('Wuhan plans follow the active Infrastructure overview/detail source contract',()=>{
  assert.deepEqual(WUHAN_CENTER,[114.305,30.593]);
  assert.deepEqual(WUHAN_ZOOMS,[6,7,8]);
  for(const zoom of WUHAN_ZOOMS) {
    const plan=wuhanRailPlan(zoom),layer=style.layers.find(layer=>layer.id===plan.layer);
    assert.equal(layer.source,plan.source);
    assert.equal(layer['source-layer'],plan.sourceLayer);
    assert.ok(zoom>=(layer.minzoom??0) && zoom<(layer.maxzoom??Infinity));
    assert.equal(assertWuhanRail(report(zoom),zoom).rendered,1);
  }
  assert.throws(()=>wuhanRailPlan(5),/supports zooms/);
});
test('loaded source or station presence cannot establish present rail rendering',()=>{
  assert.throws(()=>assertWuhanRail(report(7,{rendered:0,providerSourceFeatures:0,providerPresentRail:0}),7),/WUHAN_PROVIDER_DATA_ABSENT/);
  assert.throws(()=>assertWuhanRail(report(7,{rendered:0,providerSourceFeatures:10,providerPresentRail:0}),7),/WUHAN_PROVIDER_DATA_ABSENT/);
  assert.throws(()=>assertWuhanRail(report(7,{rendered:0}),7),/WUHAN_TRACKS_NOT_RENDERED/);
  assert.throws(()=>assertWuhanRail(report(7,{sourceLoaded:false}),7),/WUHAN_PROVIDER_NOT_READY/);
});
test('hidden, wrong thematic, wrong source and off-centre checks are rejected',()=>{
  for(const changes of [{infrastructureVisibility:'none'},{speedVisibility:'visible'},
    {layer:'speed-tracks'},{source:'speed'},{sourceLayer:'speed_railway_line_low'},
    {center:[116.4,30.5]},{zoom:8}]) {
    assert.throws(()=>assertWuhanRail(report(7,changes),7),/city-centred visible Infrastructure/);
  }
});

test('actual browser sampler uses one city-centred source and rendered-line observation',async()=>{
  const {readWuhanRail,checkWuhanRailZoom}=await import('../scripts/wuhan-rail-browser.mjs');
  let zoom=6,center=WUHAN_CENTER,renderedOverride,sourceOverride,sourceReady=true,frameReady=false,sampledBeforeTargetFrame=false,renderListener;
  // Synthetic screen coordinates are converted through the same projection
  // used for the city centre; rounded fixture output keeps boundary cases exact.
  const at=(x,y)=>[WUHAN_CENTER[0]+(x-500)/1024,WUHAN_CENTER[1]-(y-400)/1024];
  const geometry=(type,coordinates)=>({type,coordinates:type==='MultiLineString'?coordinates.map(part=>part.map(([x,y])=>at(x,y))):coordinates.map(([x,y])=>at(x,y))});
  const queries=[],line={source:'railway',geometry:geometry('LineString',[[490,390],[510,410]]),properties:{feature:'rail',state:'present'}};
  const features=()=>[
    {...line,source:wuhanRailPlan(zoom).source},
    {...line,geometry:{type:'Point'}},
    {...line,properties:{feature:'tram',state:'present'}},
    {...line,properties:{feature:'rail',state:'abandoned'}},
  ];
  const map={
    getZoom:()=>zoom,getCenter:()=>({lng:center[0],lat:center[1]}),
    project:([lng,lat])=>({x:Number((500+(lng-WUHAN_CENTER[0])*1024).toFixed(8)),y:Number((400-(lat-WUHAN_CENTER[1])*1024).toFixed(8))}),
    getSource:()=>({}),isSourceLoaded:()=>sourceReady,isMoving:()=>false,
    loaded:()=>{throw new Error('Unrelated sources must not gate this diagnostic');},
    // MapLibre runtime layers use camel-case sourceLayer; getStyle() returns
    // the public serialized style specification with the source-layer key.
    getLayer:id=>{const plan=wuhanRailPlan(zoom);return {id,source:plan.source,sourceLayer:plan.sourceLayer};},
    getStyle:()=>({layers:style.layers}),
    getLayoutProperty:id=>id.startsWith('speed-')?'none':'visible',
    querySourceFeatures:(source,options)=>{queries.push({source,...options});return sourceOverride??features();},
    queryRenderedFeatures:(box,options)=>{if(!frameReady)sampledBeforeTargetFrame=true;assert.deepEqual(box,[[405,305],[595,495]]);assert.deepEqual(options.layers,[wuhanRailPlan(zoom).layer]);return renderedOverride??[...features(),{...line,source:'unrelated'}];},
    jumpTo:next=>{zoom=next.zoom;center=next.center;sourceReady=true;frameReady=false;},
    once:(_event,callback)=>{renderListener=callback;},off:()=>{renderListener=undefined;},
    triggerRepaint:()=>queueMicrotask(()=>{frameReady=true;renderListener?.();renderListener=undefined;}),
  };
  const previousDocument=globalThis.document;
  globalThis.__wuhanSamplerTestMap=map;
  globalThis.document={querySelector:()=>({src:'data:text/javascript,export const map=globalThis.__wuhanSamplerTestMap;'})};
  const page={evaluate:async(callback,args)=>{
    const result=await callback(args);
    // Another tile starts loading immediately after the successful observation.
    // Re-reading later must not invalidate the already observed rendered frame.
    if(args?.waitForReady && result)sourceReady=false;
    return result;
  }};
  try {
    for(const value of WUHAN_ZOOMS) {
      const observed=await checkWuhanRailZoom(page,value);
      assert.equal(sampledBeforeTargetFrame,false,'stale pre-first-frame lines must not satisfy the target-camera check');
      assert.equal(frameReady,true,'target-camera frame was rendered before sampling');
      assert.equal(observed.sourceLoaded,true);
      assert.equal(sourceReady,false,'readiness changed after the successful sample');
      assert.equal(observed.rendered,1);
      assert.equal(observed.providerSourceFeatures,4);
      assert.equal(observed.providerPresentRail,1);
      assert.deepEqual(queries.at(-1),{source:wuhanRailPlan(value).source,sourceLayer:wuhanRailPlan(value).sourceLayer});
    }
    sourceReady=true;
    renderedOverride=[];
    const filtered=await readWuhanRail(page,8);
    assert.throws(()=>assertWuhanRail(filtered,8),/WUHAN_TRACKS_NOT_RENDERED/);
    // Source queries cover all loaded tiles; classification must use exactly
    // the rendered query's closed [405,305]–[595,495] screen-space box.
    for(const [name,type,coordinates,expected] of [
      ['outside right','LineString',[[610,400],[700,400]],0],
      ['overlapping bounds but segment misses corner','LineString',[[590,250],[700,320]],0],
      ['horizontal crossing with both endpoints outside','LineString',[[300,400],[700,400]],1],
      ['vertical crossing with both endpoints outside','LineString',[[500,200],[500,600]],1],
      ['diagonal crossing with both endpoints outside','LineString',[[300,200],[700,600]],1],
      ['later polyline segment intersects','LineString',[[300,250],[350,250],[500,400]],1],
      ['left boundary overlap','LineString',[[405,250],[405,550]],1],
      ['top boundary overlap','LineString',[[300,305],[700,305]],1],
      ['corner touch','LineString',[[300,200],[405,305]],1],
      ['just outside boundary','LineString',[[300,304.99],[700,304.99]],0],
      ['multi-line later part crosses','MultiLineString',[[[300,200],[350,250]],[[300,400],[700,400]]],1],
      ['multi-line parts must not be connected','MultiLineString',[[[300,400],[350,400]],[[650,400],[700,400]]],0],
      ['degenerate segment inside','LineString',[[500,400],[500,400]],1],
      ['degenerate segment outside','LineString',[[700,400],[700,400]],0],
    ]) {
      sourceOverride=[{...line,geometry:geometry(type,coordinates)}];
      const scoped=await readWuhanRail(page,8);
      assert.equal(scoped.providerSourceFeatures,1,name+' retains loaded-tile context');
      assert.equal(scoped.providerPresentRail,expected,name+' must use actual segment intersection');
      assert.equal(scoped.rendered,0);
      assert.throws(()=>assertWuhanRail(scoped,8),expected?/WUHAN_TRACKS_NOT_RENDERED/:/WUHAN_PROVIDER_DATA_ABSENT/,name);
    }
    sourceOverride=[];
    const empty=await readWuhanRail(page,8);
    assert.throws(()=>assertWuhanRail(empty,8),/WUHAN_PROVIDER_DATA_ABSENT/);
  } finally {
    globalThis.document=previousDocument;
    delete globalThis.__wuhanSamplerTestMap;
  }
});
