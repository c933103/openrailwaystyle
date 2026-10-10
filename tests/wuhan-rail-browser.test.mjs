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

test('actual browser sampler queries city-centred present lines from only the active source',async()=>{
  const {readWuhanRail,checkWuhanRailZoom}=await import('../scripts/wuhan-rail-browser.mjs');
  let zoom=6,center=WUHAN_CENTER,renderedOverride,sourceOverride;
  const queries=[],line={source:'railway',geometry:{type:'LineString'},properties:{feature:'rail',state:'present'}};
  const features=()=>[
    {...line,source:wuhanRailPlan(zoom).source},
    {...line,geometry:{type:'Point'}},
    {...line,properties:{feature:'tram',state:'present'}},
    {...line,properties:{feature:'rail',state:'abandoned'}},
  ];
  const map={
    getZoom:()=>zoom,getCenter:()=>({lng:center[0],lat:center[1]}),project:point=>{assert.deepEqual(point,WUHAN_CENTER);return {x:500,y:400};},
    getSource:()=>({}),isSourceLoaded:()=>true,isMoving:()=>false,
    loaded:()=>{throw new Error('Unrelated sources must not gate this diagnostic');},
    getLayer:id=>{const plan=wuhanRailPlan(zoom);return {id,source:plan.source,'source-layer':plan.sourceLayer};},
    getLayoutProperty:id=>id.startsWith('speed-')?'none':'visible',
    querySourceFeatures:(source,options)=>{queries.push({source,...options});return sourceOverride??features();},
    queryRenderedFeatures:(box,options)=>{assert.deepEqual(box,[[405,305],[595,495]]);assert.deepEqual(options.layers,[wuhanRailPlan(zoom).layer]);return renderedOverride??[...features(),{...line,source:'unrelated'}];},
    jumpTo:next=>{zoom=next.zoom;center=next.center;},once:(_event,callback)=>queueMicrotask(callback),triggerRepaint:()=>{},
  };
  const previousDocument=globalThis.document;
  globalThis.__wuhanSamplerTestMap=map;
  globalThis.document={querySelector:()=>({src:'data:text/javascript,export const map=globalThis.__wuhanSamplerTestMap;'})};
  const page={evaluate:async(callback,args)=>callback(args)};
  try {
    for(const value of WUHAN_ZOOMS) {
      const observed=await checkWuhanRailZoom(page,value);
      assert.equal(observed.rendered,1);
      assert.equal(observed.providerSourceFeatures,4);
      assert.equal(observed.providerPresentRail,1);
      assert.deepEqual(queries.at(-1),{source:wuhanRailPlan(value).source,sourceLayer:wuhanRailPlan(value).sourceLayer});
    }
    renderedOverride=[];
    const filtered=await readWuhanRail(page,8);
    assert.throws(()=>assertWuhanRail(filtered,8),/WUHAN_TRACKS_NOT_RENDERED/);
    sourceOverride=[];
    const empty=await readWuhanRail(page,8);
    assert.throws(()=>assertWuhanRail(empty,8),/WUHAN_PROVIDER_DATA_ABSENT/);
  } finally {
    globalThis.document=previousDocument;
    delete globalThis.__wuhanSamplerTestMap;
  }
});
