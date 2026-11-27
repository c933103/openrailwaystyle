import {FLAT_MIN_ZOOM, FLAT_MAX_ZOOM} from './flat-camera.mjs';

// All gesture coordinates are CSS pixels in the map viewport.
const RAD_TO_DEG=180/Math.PI;
const wrapBearing=value=>((value+180)%360+360)%360-180;
const deltaAngle=([a,b],[c,d])=>{
  const x=b[0]-a[0],y=b[1]-a[1],u=d[0]-c[0],v=d[1]-c[1];
  return Math.atan2(x*v-y*u,x*u+y*v);
};
const mid = ([a,b]) => [(a[0]+b[0])/2,(a[1]+b[1])/2];
const distance = ([a,b]) => Math.hypot(a[0]-b[0],a[1]-b[1]);

export function createFlatGesture({preview, commit, inspect}) {
  const points=new Map();
  let start, current, segment, moved=false, multi=false;
  const reset=()=>{points.clear(); start=current=segment=undefined; moved=multi=false;};
  const reanchor=()=>{
    const positions=[...points.values()];
    segment={camera:current,positions:positions.map(({point})=>point),rotating:false};
  };
  return {
    get active(){return points.size>0;},
    start(id,type,point,camera){
      if(points.has(id) || points.size>=2 ||
        (points.size && (type!=='touch' || [...points.values()][0].type!=='touch'))) return false;
      if(!points.size) start=current=camera;
      points.set(id,{point,type});
      if(points.size===2) multi=true;
      reanchor();
      return true;
    },
    move(id,point){
      const entry=points.get(id);
      if(!entry) return;
      entry.point=point;
      const before=segment.positions, next=[...points.values()].map(({point})=>point);
      let nextCamera;
      if(next.length===2){
        const span=distance(before), nextSpan=distance(next);
        // A nearly coincident initial pair must not cause a large zoom jump.
        if(span<3){if(nextSpan>=3)reanchor(); return;}
        const from=mid(before), to=mid(next);
        const zoom=Math.max(FLAT_MIN_ZOOM,Math.min(FLAT_MAX_ZOOM,segment.camera.zoom+Math.log2(Math.max(3,nextSpan)/span)));
        // Ignore small changes in angle during a normal pinch. Once the twist
        // is deliberate, the same geographic point follows the finger midpoint.
        const twist=nextSpan>=3?deltaAngle(before,next):0;
        if(!segment.rotating&&Math.abs(twist)*Math.min(span,nextSpan)/2>=10)segment.rotating=true;
        const bearing=segment.rotating&&nextSpan>=3
          ?wrapBearing(segment.camera.bearing-twist*RAD_TO_DEG):current.bearing;
        nextCamera=segment.camera.zoomAt(zoom,from,bearing).panBy([from[0]-to[0],from[1]-to[1]]);
      }else{
        const dx=before[0][0]-point[0],dy=before[0][1]-point[1];
        if(!moved && Math.hypot(dx,dy)<3) return;
        nextCamera=segment.camera.panBy([dx,dy]);
      }
      moved=true;
      current=nextCamera;
      preview(current);
    },
    end(id,point){
      if(!points.delete(id)) return;
      if(points.size){reanchor();return;}
      const result=current, didMove=moved, wasTap=!moved&&!multi;
      reset();
      if(didMove) commit(result);
      else if(wasTap) inspect(point);
    },
    cancel(id){
      if(!points.size || (id!==undefined&&!points.has(id))) return;
      const original=start, didMove=moved;
      reset();
      if(didMove) preview(original);
    },
  };
}
