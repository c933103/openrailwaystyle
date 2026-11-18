// Capture the predicate and evidence in one browser turn. A separate read after
// waitForFunction can observe tiles being replaced instead of the frame that
// satisfied the assertion. Hidden layers may still have queryable buckets.
export function mainlineAtlasSample({ids,shown,hidden,zoom,settleMs=0,token}) {
 const map=globalThis.atlasMap;
 const cameraZoom=map.getZoom();
 const visibility=shown.map(id=>map.getLayoutProperty(id,'visibility'));
 const ready=Math.abs(cameraZoom-zoom)<=.001&&visibility.every(value=>value!=='none')&&map.isSourceLoaded('railReference');
 const renderedIds=[...new Set(map.queryRenderedFeatures({layers:shown})
  .filter(feature=>ids.includes(feature.properties.id)).map(feature=>feature.properties.id))];
 const sample={cameraZoom,ids:renderedIds,hidden:hidden.map(id=>map.getLayoutProperty(id,'visibility'))};
 if(!settleMs)return ready&&renderedIds.length?sample:false;
 const states=globalThis.mainlineAcceptanceFrames ||= new Map();
 const state=states.get(token)||{since:null,frames:0,drops:[]};states.set(token,state);
 const now=performance.now();
 if(!ready||!renderedIds.length){
  // Allow the initial camera/source handoff to settle. Once evidence has
  // survived250ms, any later disappearance is a failure, not sampled around.
  if(state.since!==null&&now-state.since>=250)state.drops.push({at:now,visible:visibility,referenceLoaded:map.isSourceLoaded('railReference'),ids:renderedIds});
  state.since=null;state.frames=0;return false;
 }
 state.since ??= now;state.frames++;
 if(now-state.since<settleMs||state.frames<3)return false;
 return {...sample,stableMs:now-state.since,stableFrames:state.frames,unstableDrops:state.drops};
}
