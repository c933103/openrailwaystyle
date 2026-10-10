// Shared by the self-hosted geographic audit and synthetic renderer check.
// This helper only inspects the page; all traffic stays under browser.mjs guards.
import assert from 'node:assert/strict';
import {waitUntil} from './wait-until.mjs';

export const WUHAN_CENTER = Object.freeze([114.305,30.593]);
export const WUHAN_ZOOMS = Object.freeze([6,7,8]);
export function wuhanRailPlan(zoom) {
  assert.ok(WUHAN_ZOOMS.includes(zoom),'Wuhan diagnostic supports zooms 6, 7 and 8');
  return {zoom,center:WUHAN_CENTER,layer:zoom<7?'infrastructure-overview':'infrastructure-tracks',
    source:zoom<7?'network':'railway',sourceLayer:zoom<7?'standard_railway_line_low':'railway_line_high',
    speedLayer:zoom<7?'speed-overview':'speed-tracks'};
}

// Self-contained callback because Playwright serializes it into the browser.
async function inspectWuhanRail({plan,waitForReady=false}) {
  const {map}=await import(document.querySelector('script[type="module"]').src);
  const {zoom,center,layer,source,sourceLayer,speedLayer}=plan;
  const actualCenter=map.getCenter(),point=map.project(center),radius=95;
  const box=[[point.x-radius,point.y-radius],[point.x+radius,point.y+radius]];
  const target=Math.abs(map.getZoom()-zoom)<0.01 && Math.abs(actualCenter.lng-center[0])<0.01 && Math.abs(actualCenter.lat-center[1])<0.01;
  const sourceLoaded=Boolean(map.getSource(source) && map.isSourceLoaded(source));
  const presentRail=f=>['LineString','MultiLineString'].includes(f.geometry.type) && f.properties.feature==='rail' && (!f.properties.state || f.properties.state==='present');
  // Source queries include every loaded tile. Clip projected segments against
  // the same closed screen box as the rendered query; endpoint-only or feature
  // bounding-box tests misclassify crossing lines and near-corner misses.
  const intersectsSegment=(a,b)=>{
    if(![a.x,a.y,b.x,b.y].every(Number.isFinite))return false;
    let enter=0,leave=1;
    for(const [start,end,min,max] of [[a.x,b.x,box[0][0],box[1][0]],[a.y,b.y,box[0][1],box[1][1]]]) {
      const delta=end-start;
      if(delta===0) {if(start<min || start>max)return false;continue;}
      const first=(min-start)/delta,last=(max-start)/delta;
      enter=Math.max(enter,Math.min(first,last));
      leave=Math.min(leave,Math.max(first,last));
      if(enter>leave)return false;
    }
    return true;
  };
  const intersectsSample=geometry=>{
    const parts=geometry.type==='LineString'?[geometry.coordinates]:geometry.coordinates;
    for(const part of parts) {
      let previous;
      for(const coordinate of part) {
        const current=map.project(coordinate);
        if(previous && intersectsSegment(previous,current))return true;
        previous=current;
      }
    }
    return false;
  };
  // getLayer() exposes MapLibre's runtime object (sourceLayer), whereas the
  // public serialized style retains the specification's source-layer key.
  const active=map.getStyle().layers.find(item=>item.id===layer);
  const sourceFeatures=map.getSource(source)?map.querySourceFeatures(source,{sourceLayer}):[];
  const tracks=active?map.queryRenderedFeatures(box,{layers:[layer]}):[];
  const report={zoom:map.getZoom(),center:[actualCenter.lng,actualCenter.lat],layer:active?.id,source:active?.source,sourceLayer:active?.['source-layer'],
    infrastructureVisibility:active?map.getLayoutProperty(layer,'visibility'):null,
    speedVisibility:map.getLayer(speedLayer)?map.getLayoutProperty(speedLayer,'visibility'):null,
    sourceLoaded,providerSourceFeatures:sourceFeatures.length,providerPresentRail:sourceFeatures.filter(f=>presentRail(f) && intersectsSample(f.geometry)).length,
    rendered:tracks.filter(f=>f.source===source && presentRail(f)).length};
  // Hidden sources may retain cancelled loading tiles. Wait only for this
  // visible railway source and its rendered lines, never unrelated map.loaded().
  return waitForReady && (!target || map.isMoving() || !sourceLoaded || !report.rendered)?false:report;
}

export async function readWuhanRail(page,zoom) {
  return page.evaluate(inspectWuhanRail,{plan:wuhanRailPlan(zoom)});
}

export function assertWuhanRail(report,zoom) {
  const plan=wuhanRailPlan(zoom);
  assert.ok(Math.abs(report.zoom-zoom)<0.01 && report.center?.length===2 && report.center.every((value,index)=>Math.abs(value-plan.center[index])<0.01) &&
    report.layer===plan.layer && report.source===plan.source && report.sourceLayer===plan.sourceLayer &&
    report.infrastructureVisibility!=='none' && report.speedVisibility==='none',
  'Wuhan test must use city-centred visible Infrastructure tracks: '+JSON.stringify(report));
  assert.ok(report.sourceLoaded,'WUHAN_PROVIDER_NOT_READY: railway source did not finish loading; '+JSON.stringify(report));
  assert.ok(report.rendered>0,
    (report.providerPresentRail===0?'WUHAN_PROVIDER_DATA_ABSENT: no present provider railway lines intersect the Wuhan sample':
      'WUHAN_TRACKS_NOT_RENDERED: provider railway lines intersect the Wuhan sample but it has no rendered tracks')+
    ` at zoom ${zoom}; `+JSON.stringify(report));
  return report;
}

export async function checkWuhanRailZoom(page,zoom) {
  const plan=wuhanRailPlan(zoom);
  await page.evaluate(async({zoom,center})=>{
    const {map}=await import(document.querySelector('script[type="module"]').src);
    map.jumpTo({zoom,center});
    // Camera coordinates update before the rendered frame. Wait for a target
    // frame before sampling, with a bound if the renderer stops producing frames.
    await new Promise((resolve,reject)=>{
      const done=()=>{clearTimeout(timer);resolve();};
      const timer=setTimeout(()=>{map.off('render',done);reject(new Error('WUHAN_TARGET_FRAME_TIMEOUT'));},30000);
      map.once('render',done);map.triggerRepaint();
    });
  },plan);
  let report;
  try {
    report=await waitUntil(page,inspectWuhanRail,{plan,waitForReady:true},{timeout:60000});
  } catch(error) {
    // Retain the specific source/visibility/render diagnosis after a timeout.
    assertWuhanRail(await readWuhanRail(page,zoom),zoom);
    throw error;
  }
  // The predicate already observed rendered geometry and source readiness in
  // one browser evaluation. A later frame can start another tile request; do
  // not replace this consistent observation with a second, racing sample.
  return assertWuhanRail(report,zoom);
}
