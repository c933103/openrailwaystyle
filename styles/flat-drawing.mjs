// Canvas projections for the shared Drawing controller's three GeoJSON sources.
// The controller owns editing, history, storage and controls in both renderers.
const PAPER = '#fffef8', INK = '#c2185b';
const finished = 'atlas-drawing', draft = 'atlas-drawing-draft', handles = 'atlas-drawing-handles';
const target = 'drawing-handle-targets';
export const drawingLines = ['drawing-line','drawing-line-dashed','drawing-line-dotted'];
const lineLayer = dash => dash === 'dashed' ? drawingLines[1] : dash === 'dotted' ? drawingLines[2] : drawingLines[0];
const dashPattern = (dash, width) => (dash === 'dashed' ? [2.5,1.8] : dash === 'dotted' ? [0.1,2] : []).map(x=>x*width);
const color = f => f.properties.color ?? INK;
const width = f => f.properties.width ?? 3;

// Unwrap each leg relative to the previous leg, then project its world copy
// together. Independently wrapping vertices draws false lines across the map.
export function projectDrawingPath(camera, coordinates, reference) {
  if(!coordinates.length)return [];
  const start = coordinates[0][0];
  let previous = start;
  const shift=360*Math.round(((reference??camera.center[0])-start)/360);
  return coordinates.map(([lng,lat])=>{
    previous=lng+360*Math.round((previous-lng)/360);
    return camera.project([previous+shift,lat],{nearestWorld:false});
  });
}
const distance = (p,a) => Math.hypot(p[0]-a[0],p[1]-a[1]);
function segmentDistance(p,a,b) {
  const dx=b[0]-a[0],dy=b[1]-a[1],n=dx*dx+dy*dy;
  const t=n?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/n)):0;
  return distance(p,[a[0]+t*dx,a[1]+t*dy]);
}
const lineDistance=(p,path)=>path.reduce((d,a,i)=>i?Math.min(d,segmentDistance(p,path[i-1],a)):d,Infinity);
function inside(p,rings) {
  let yes=false;
  for(const ring of rings) for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;
  }
  return yes;
}
function polygonAnchor(rings) {
  let top=Infinity,bottom=-Infinity;
  for(const p of rings[0]){top=Math.min(top,p[1]);bottom=Math.max(bottom,p[1]);}
  let best=null,space=0;
  for(const fraction of [0.5,0.25,0.75]){
    const y=top+(bottom-top)*fraction;
    if(!Number.isFinite(y))continue;
    const xs=[];
    for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[i],b=ring[j];
      if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]));
    }
    xs.sort((a,b)=>a-b);
    for(let i=1;i<xs.length;i+=2)if(xs[i]-xs[i-1]>space){
      space=xs[i]-xs[i-1];best=[(xs[i]+xs[i-1])/2,y];
    }
  }
  return best;
}
function pathMidpoint(path) {
  let remaining = path.reduce((sum,p,i)=>sum+(i?distance(p,path[i-1]):0),0)/2;
  for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],len=distance(a,b);
    if(len&&remaining<=len)return [a[0]+(b[0]-a[0])*remaining/len,a[1]+(b[1]-a[1])*remaining/len];
    remaining-=len;
  }
  return path[0];
}
function pathsFor(camera, f) {
  const {type,coordinates}=f.geometry;
  if(type==='Point')return [[camera.project(coordinates)]];
  if(type==='LineString')return [projectDrawingPath(camera,coordinates)];
  const outer=coordinates[0]?.[0]?.[0];
  const world=outer==null?camera.center[0]:outer+360*Math.round((camera.center[0]-outer)/360);
  return coordinates.map(ring=>projectDrawingPath(camera,ring,world));
}

export function flatDrawingAdapter(canvas,invalidate) {
  const sources=new Map(),layers=new Set(),listeners=new Map();
  let camera, cached=null, hover=false;
  const refresh=()=>{cached=null;invalidate();};
  const info=()=>{
    if(!cached&&camera)cached=new Map([...sources].map(([id,source])=>
      [id,source.data.features.map(f=>({f,paths:pathsFor(camera,f)}))]));
    return cached;
  };
  const features=id=>info()?.get(id)??[];
  function query(point,{layers:ids=[]}={}) {
    if(!camera || !point)return [];
    if(ids.includes(target)){
      if(Array.isArray(point))return [];
      const p=[point.x,point.y];
      return features(handles).map(({f,paths},i)=>({f,i,d:distance(p,paths[0][0])}))
        .filter(hit=>hit.d<=18).sort((a,b)=>a.d-b.d||Number(Boolean(a.f.properties.mid))-Number(Boolean(b.f.properties.mid))||b.i-a.i)
        // The shared drag code updates its private handle after inserting a midpoint.
        .map(({f})=>({...f,properties:{...f.properties}}));
    }
    const box=Array.isArray(point);
    const p=box?[(point[0][0]+point[1][0])/2,(point[0][1]+point[1][1])/2]:[point.x,point.y];
    const pad=box?Math.max(Math.abs(point[1][0]-p[0]),Math.abs(point[1][1]-p[1])):0;
    const hits=[];
    features(finished).forEach(({f,paths},i)=>{
      const type=f.geometry.type;
      const line=lineLayer(f.properties.dash);
      if(type==='Point'){
        if(ids.includes('drawing-points')&&distance(p,paths[0][0])<=4+width(f)+pad)hits.push({f,i,z:4});
      }else{
        if(ids.includes(line)&&paths.some(path=>lineDistance(p,path)<=width(f)/2+pad))
          hits.push({f,i,z:1+drawingLines.indexOf(line)});
        if(type==='Polygon'&&ids.includes('drawing-fill')&&inside(p,paths))hits.push({f,i,z:0});
      }
    });
    return hits.sort((a,b)=>b.z-a.z||b.i-a.i).map(({f})=>f);
  }
  const map={
    on(type,layer,fn){
      const items=listeners.get(type)??[];
      items.push(typeof layer==='string'?{layer,fn}:{fn:layer});listeners.set(type,items);
    },
    getCanvas:()=>canvas,
    getSource:id=>sources.get(id),
    addSource(id,{data}){sources.set(id,{data,setData(next){this.data=next;refresh();}});refresh();},
    getLayer:id=>layers.has(id),
    addLayer({id}){layers.add(id);},
    doubleClickZoom:{enable(){},disable(){}},
    project(coords){const [x,y]=camera.project(coords);return {x,y};},
    queryRenderedFeatures:query,
  };
  function emit(type,point,raw) {
    if(!camera)return false;
    const [rawLng,lat]=camera.unproject(point);
    const lng=((rawLng+180)%360+360)%360-180;
    let handled=false;
    const event={point:{x:point[0],y:point[1]},lngLat:{lng,lat},originalEvent:raw,
      preventDefault(){handled=true;}};
    const hit=ids=>query(event.point,{layers:ids});
    if(type==='mousemove'&&!raw.buttons){
      const present=hit([target]).length>0;
      if(present!==hover){hover=present;for(const {fn} of listeners.get(present?'mouseenter':'mouseleave')??[])fn(event);}
    }
    for(const {layer,fn} of listeners.get(type)??[]){
      if(layer){event.features=hit([layer]);if(!event.features.length)continue;}
      fn(event);
    }
    return handled;
  }
  function draw(ctx) {
    const drawn=features(finished);
    function path(rings) {
      ctx.beginPath();
      for(const points of rings){
        if(!points.length)continue;
        ctx.moveTo(...points[0]);for(let i=1;i<points.length;i++)ctx.lineTo(...points[i]);
      }
    }
    function dot(xy,r,fill,stroke,outline=2,alpha=1){
      ctx.beginPath();ctx.arc(...xy,r,0,2*Math.PI);
      ctx.globalAlpha=alpha;
      ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=outline;ctx.stroke();
      ctx.globalAlpha=1;
    }
    ctx.save();ctx.lineCap='round';ctx.lineJoin='round';
    for(const {f,paths} of drawn){
      if(f.geometry.type!=='Polygon')continue;
      path(paths);ctx.globalAlpha=0.14;ctx.fillStyle=color(f);ctx.fill('evenodd');ctx.globalAlpha=1;
    }
    for(const layer of drawingLines)for(const {f,paths} of drawn){
      if(f.geometry.type==='Point'||lineLayer(f.properties.dash)!==layer)continue;
      path(paths);ctx.strokeStyle=color(f);ctx.lineWidth=width(f);ctx.setLineDash(dashPattern(f.properties.dash,width(f)));ctx.stroke();
    }
    ctx.setLineDash([]);
    for(const {f,paths} of drawn)if(f.geometry.type==='Point')dot(paths[0][0],3+width(f),color(f),PAPER);
    ctx.font='bold 12px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';
    for(const {f,paths} of drawn){
      if(!f.properties.measure||f.geometry.type==='Point')continue;
      const xy=f.geometry.type==='LineString'?pathMidpoint(paths[0]):polygonAnchor(paths);
      if(!xy)continue;
      ctx.lineWidth=4;ctx.strokeStyle=PAPER;ctx.fillStyle=color(f);
      ctx.strokeText(f.properties.measure,xy[0],xy[1]-4);ctx.fillText(f.properties.measure,xy[0],xy[1]-4);
    }
    for(const {f,paths} of features(draft)){
      path(paths);ctx.strokeStyle=color(f);ctx.lineWidth=2;ctx.setLineDash([4,3]);ctx.stroke();
    }
    ctx.setLineDash([]);
    for(const {f,paths} of features(handles)){
      const p=f.properties;
      dot(paths[0][0],p.mid?3.5:p.selected?7:5,p.selected?color(f):PAPER,p.selected?PAPER:color(f),p.mid?1.2:p.curved?1.5:2.5,p.mid?0.75:1);
    }
    ctx.restore();
  }
  return {map,emit,draw,setCamera(next){if(next!==camera)cached=null;camera=next;}};
}
