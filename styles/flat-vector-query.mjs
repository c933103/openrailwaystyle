import {compileFlatGeometryStyle} from './flat-style.mjs';
import {offsetFlatPath,flatPolygonGeometry,flatRingsContain} from './flat-vector.mjs';

const distance = ([x,y],[ax,ay],[bx,by]) => {
  const dx=bx-ax,dy=by-ay,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/length)):0;
  return Math.hypot(x-ax-t*dx,y-ay-t*dy);
};

function hitDistance(type, point, paths, paint, closed=false) {
  if (type===1) {
    const limit=paint.radius+(paint.strokeOpacity>0?Math.max(0,paint.strokeWidth):0)+7;
    if (paint.radius<=0 || (paint.opacity<=0 && !(paint.strokeOpacity>0&&paint.strokeWidth>0))) return Infinity;
    let best=Infinity;
    for(const path of paths) for(const [x,y] of path) best=Math.min(best,Math.hypot(x-point[0],y-point[1]));
    return best<=limit?best:Infinity;
  }
  if(type===3){
    if(paint.opacity<=0)return Infinity;
    return flatRingsContain(paths,point)?0:Infinity;
  }
  if (paint.width<=0 || paint.opacity<=0) return Infinity;
  const side=(paint.gapWidth+paint.width)/2;
  const offsets=paint.gapWidth>0?[paint.offset-side,paint.offset+side]:[paint.offset];
  let best=Infinity;
  for(const raw of paths) for(const offset of offsets) {
    const shifted=offsetFlatPath(raw,offset,closed);
    const path=closed&&shifted.length?[...shifted,shifted[0]]:shifted;
    for (let i=1;i<path.length;i++) best=Math.min(best,distance(point,path[i-1],path[i]));
  }
  return best<=paint.width/2+7?best:Infinity;
}

// Query the same clipped frame and paint/filter rules used for display.
// Areas are opt-in for prepared feature snapshots with actual detail panels.
export function compileFlatVectorQuery(layers, {include = () => true, includeFill = () => false} = {}) {
  const order = layers.filter(layer => (['line','circle'].includes(layer.type)||layer.type==='fill'&&includeFill(layer)) &&
    layer['source-layer'] != null && layer.paint?.['line-pattern'] == null &&
    include(layer.id)).map(layer=>({type:layer.type,...compileFlatGeometryStyle(layer)})).reverse();
  return (camera, point, frame, allowFeature) => {
    if (!point.every(Number.isFinite) || point[0]<0 || point[0]>camera.width ||
        point[1]<0 || point[1]>camera.height) return [];
    const hits=[],seen=new Map(),cache=new Map(),global={zoom:camera.zoom};
    const clampLongitude = lng => ((lng+180)%360+360)%360-180;
    for (const layer of order) {
      if (!layer.visibleAt(camera.zoom)) continue;
      for (const {tile,vector} of frame.get(layer.source)??[]) {
        if (!vector) continue;
        const [a,b,c,d,tx,ty]=camera.tileTransform(tile);
        const det=a*d-b*c,px=point[0]-tx,py=point[1]-ty;
        const u=(d*px-c*py)/det,v=(a*py-b*px)/det;
        const pad=7/Math.sqrt(a*a+b*b);
        // Render clips MVT geometry at tile edges. Tolerance may graze an
        // adjacent tile, but must not select a buffered feature beyond it.
        if(u < -pad || u > 1+pad || v < -pad || v > 1+pad) continue;
        if(layer.type==='fill'&&(u<0||u>1||v<0||v>1))continue;
        const query=[a*Math.max(0,Math.min(1,u))+c*Math.max(0,Math.min(1,v))+tx,
          b*Math.max(0,Math.min(1,u))+d*Math.max(0,Math.min(1,v))+ty];
        if(!cache.has(vector)) cache.set(vector,new Map());
        const decoded=cache.get(vector);
        if(!decoded.has(layer.sourceLayer)) decoded.set(layer.sourceLayer,vector.layer(layer.sourceLayer));
        for (const feature of decoded.get(layer.sourceLayer)) {
          const polygonOutline=layer.type==='line'&&layer.id==='platform-outlines'&&feature.type===3;
          if (!polygonOutline&&({circle:1,line:2,fill:3}[layer.type])!==feature.type||allowFeature&&!allowFeature(layer.id,feature,tile)) continue;
          const paint=layer.resolve(global,feature,{}, {z:tile.z,x:tile.x,y:tile.y});
          if (!paint) continue;
          const paths=feature.paths.filter(path=>path.length>0).map(path=>path.map(({x,y})=>{
            const nx=x/feature.extent,ny=y/feature.extent;
            return [a*nx+c*ny+tx,b*nx+d*ny+ty];
          }));
          const proximity=hitDistance(polygonOutline?2:feature.type,query,paths,paint,polygonOutline);
          if(!Number.isFinite(proximity)) continue;
          const identity=feature.properties.id ?? feature.id;
          const key=identity==null?null:JSON.stringify([layer.source,layer.sourceLayer,feature.type,identity]);
          if(key!=null && seen.has(key)) continue;
          if(key!=null) seen.set(key,true);
          const geo=paths.map(path=>path.map(p=>{
            const [lng,lat]=camera.unproject(p);
            return [feature.type===3?lng:clampLongitude(lng),lat];
          }));
          const points=feature.type===1?geo.flat():null;
          hits.push({type:'Feature',id:feature.id,properties:feature.properties,
            source:layer.source,sourceLayer:layer.sourceLayer,layer:{id:layer.id,type:layer.type,source:layer.source},
            geometry:points ? (points.length===1?{type:'Point',coordinates:points[0]}:{type:'MultiPoint',coordinates:points})
              : feature.type===3?flatPolygonGeometry(geo)
              : (geo.length===1?{type:'LineString',coordinates:geo[0]}:{type:'MultiLineString',coordinates:geo}),
            distance:proximity});
        }
      }
    }
    return hits;
  };
}
