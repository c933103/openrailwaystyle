// Canvas adapter for the shared Measure controller. Geometry, units, undo,
// selected-point rules, elevation requests and staleness still belong to Measure.
const INK='#16414d', PAPER='#fffef8';
export function flatMeasureAdapter(canvas, invalidate) {
  let data={features:[]}, camera, marker=null;
  const listeners=new Map();
  const project=coords=>camera.project(coords);
  const handle=id=>'measure-point-targets'===id;
  function hits(point) {
    if(!camera || !point) return [];
    return data.features.filter(f=>Number.isInteger(f.properties.index)).map(f=>{
      const [x,y]=project(f.geometry.coordinates);
      return {f,d:Math.hypot(x-point.x,y-point.y)};
    }).filter(({d})=>d<=10).sort((a,b)=>a.d-b.d).map(({f})=>f);
  }
  const source={setData(next){data=next;invalidate();}};
  const map={
    on(type,layer,fn){
      const list=listeners.get(type)??[];
      list.push(typeof layer==='string'?{layer,fn}:{fn:layer});
      listeners.set(type,list);
    },
    getCanvas:()=>canvas,
    doubleClickZoom:{enable(){},disable(){}},
    getLayer:handle,
    getSource:id=>id==='atlas-measure'?source:undefined,
    queryRenderedFeatures:(point,{layers}={})=>layers?.some(handle)?hits(point):[],
  };
  function emit(type,point,raw) {
    if(!camera) return false;
    let handled=false;
    const [lng,lat]=camera.unproject(point);
    const event={point:{x:point[0],y:point[1]},lngLat:{lng,lat},originalEvent:raw,
      preventDefault(){handled=true;}};
    for(const {layer,fn} of listeners.get(type)??[]){
      if(layer){event.features=hits(event.point);if(!event.features.length)continue;}
      fn(event);
    }
    return handled;
  }
  function draw(ctx,nextCamera) {
    camera=nextCamera;
    const labels=[];
    ctx.save();
    ctx.lineCap='round';ctx.lineJoin='round';
    function point(position,r,fill,border=INK) {
      ctx.beginPath();ctx.arc(...position,r,0,Math.PI*2);
      ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=border;ctx.lineWidth=2;ctx.stroke();
    }
    for(const {geometry:{type,coordinates},properties:p} of data.features){
      if(type!=='LineString')continue;
      // Unwrap each segment relative to the previous point to avoid joining
      // the two ends across the whole screen at the antimeridian.
      const continuous=[];
      for(const [lng,lat] of coordinates){
        const previous=continuous.at(-1)?.[0]??lng;
        continuous.push([lng+360*Math.round((previous-lng)/360),lat]);
      }
      const origin=continuous[0];
      const offset=Math.round((nextCamera.center[0]-origin[0])/360)*360;
      const path=continuous.map(([lng,lat])=>nextCamera.project([lng+offset,lat],{nearestWorld:false}));
      ctx.beginPath();ctx.moveTo(...path[0]);for(const xy of path.slice(1))ctx.lineTo(...xy);
      ctx.lineWidth=p.kind==='arc'?3:2.5;ctx.strokeStyle=p.kind==='arc'?'#e0701b':INK;
      ctx.setLineDash(p.kind==='arc'?[]:[7.5,3.75]);ctx.stroke();
      if(p.label) labels.push([p.label,[(path[0][0]+path.at(-1)[0])/2,(path[0][1]+path.at(-1)[1])/2-8]]);
    }
    ctx.setLineDash([]);
    for(const {geometry:{type,coordinates},properties:p} of data.features){
      if(type!=='Point')continue;
      const xy=project(coordinates);
      if(Number.isInteger(p.index)||p.kind==='spot')point(xy,p.selected?6.5:p.kind==='spot'?5:4.5,p.selected?INK:PAPER,p.selected?PAPER:INK);
      if(p.label)labels.push([p.label,[xy[0],xy[1]-14]]);
    }
    if(marker)point(project(marker),6,'#e0701b',PAPER);
    ctx.font='bold 12px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';
    ctx.strokeStyle=PAPER;ctx.lineWidth=4;ctx.fillStyle=INK;
    for(const [text,[x,y]] of labels){
      const rows=text.split('\n');
      rows.forEach((line,i)=>{
        const top=y-14*(rows.length-1-i);
        ctx.strokeText(line,x,top);ctx.fillText(line,x,top);
      });
    }
    ctx.restore();
  }
  return {map,emit,draw,setCamera(next){camera=next;},marker(next){marker=next;invalidate();}};
}
