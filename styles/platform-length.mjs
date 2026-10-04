// Length of the complete mapped boarding edge, from the provider's feature
// API. Tile geometry is clipped and cannot supply that length reliably.
export const PLATFORM_SOURCE='standard_railway_platform_edges';
export const PLATFORM_API='https://openrailwaymap.app/api/feature/openrailwaymap_standard/'+PLATFORM_SOURCE+'/';
const OBSOLETE_REQUEST=Symbol('obsolete platform request');
export function formatPlatformLength(metres,units='metric') {if(!(metres>0&&Number.isFinite(metres)))return '';return `${Math.round(units==='imperial'?metres/0.3048:metres)} ${units==='imperial'?'ft':'m'}`;}
export function platformLengthLabel(units='metric') {
 const length=['concat',['case',['==',['get','length_estimated'],true],'≈',''],['to-string',['round',['*',['get','platform_length'],units==='imperial'?1/0.3048:1]]],units==='imperial'?' ft':' m'];
 const hasLength=['>',['to-number',['get','platform_length'],0],0],ref=['coalesce',['get','ref'],''];
 return ['concat',ref,['case',['all',['!=',ref,''],hasLength],' · ',''],['case',hasLength,length,'']];
}
export function platformReference(value) {return (Array.isArray(value)?value:[value]).filter(v=>typeof v==='string'||typeof v==='number'&&Number.isFinite(v)).flatMap(v=>String(v).split(';')).map(v=>v.trim()).filter(Boolean).join(' / ');}
export function platformObjectIdentity(feature) {const match=/^(node|way|relation)-([1-9]\d*)$/.exec(String(feature.properties?.id??feature.id??''));return match?{key:match[0],type:match[1],id:match[2]}:null;}
export function platformIdentity(feature){const p=feature.properties||{},value=p.id??feature.id;const m=/^(?:way-)?(\d+)$/.exec(String(value??''));return m&&Number(m[1])>0?m[1]:null;}
// OSM length values default to metres; explicit unit tags take precedence
// over geometric estimates, including mixed-case customary units.
export function parsePlatformLength(value){
 const match=/^\s*(\d+(?:\.\d+)?)\s*(m|km|ft|mi)?\s*$/i.exec(String(value??''));
 const length=match?Number(match[1])*({m:1,km:1000,ft:.3048,mi:1609.344}[match[2]?.toLowerCase()||'m']):0;
 return Number.isFinite(length)&&length>0?length:null;
}
// Anchor at the midpoint of the longest loaded piece; the API supplies the
// full length independently of that visible/clipped piece.
function longestPlatformLine(feature){
 const g=feature.geometry;if(!g)return null;const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];let best;
 const rad=Math.PI/180;for(const line of lines){if(line.length<2)continue;const lens=line.slice(1).map((p,i)=>{const a=line[i],h=Math.sin((p[1]-a[1])*rad/2)**2+Math.cos(a[1]*rad)*Math.cos(p[1]*rad)*Math.sin((p[0]-a[0])*rad/2)**2;return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));}),total=lens.reduce((a,b)=>a+b,0);if(!best||total>best.total)best={line,lens,total};}return best;
}
export function platformSpan(feature){return longestPlatformLine(feature)?.total||0;}
export function platformAnchor(feature){
 const best=longestPlatformLine(feature);if(!best)return null;const {line,lens,total}=best;let half=total/2;
 for(let i=0;i<lens.length;i++){if(half<=lens[i]){const t=lens[i]?half/lens[i]:0;return line[i].map((v,j)=>v+(line[i+1][j]-v)*t);}half-=lens[i];}return null;
}
// References and geometry must describe the complete OSM object, not a clipped
// tile. The provider's platform feature API supplies references but no geometry.
export function platformOSMURL(object){return `https://api.openstreetmap.org/api/0.6/${object.type}/${object.id}${object.type==='node'?'':'/full'}.json`;}
export function platformOSMDetails(data,object){
 const elements=new Map((data.elements||[]).map(e=>[`${e.type}/${e.id}`,e])),entry=elements.get(`${object.type}/${object.id}`);
 if(!entry)throw new Error('Platform object missing from OSM response');
 const tags=entry.tags||{},properties={name:tags.name||'',ref:tags.ref||'',complete:true};
 const points=way=>way?.nodes?.map(id=>{const n=elements.get(`node/${id}`);return n&&Number.isFinite(n.lon)&&Number.isFinite(n.lat)?[n.lon,n.lat]:null;});
 let geometry;
 if(object.type==='way'){
  const line=points(entry);
  if(line?.length>=2&&line.every(Boolean))geometry={type:entry.nodes[0]===entry.nodes.at(-1)?'Polygon':'LineString',coordinates:entry.nodes[0]===entry.nodes.at(-1)?[line]:line};
 }else if(object.type==='relation'){
  const members=(entry.members||[]).filter(m=>m.type==='way'&&m.role!=='inner'),parts=members.map(m=>points(elements.get(`way/${m.ref}`)));
  if(parts.length&&parts.every(p=>p?.length>=2&&p.every(Boolean))){
   const rings=[],remaining=parts.map(p=>p.slice()),same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
   while(remaining.length){let ring=remaining.shift();
    while(!same(ring[0],ring.at(-1))){const i=remaining.findIndex(p=>same(ring.at(-1),p[0])||same(ring.at(-1),p.at(-1)));if(i<0)break;const p=remaining.splice(i,1)[0];if(!same(ring.at(-1),p[0]))p.reverse();ring.push(...p.slice(1));}
    if(!same(ring[0],ring.at(-1)))return properties;rings.push([ring]);
   }
   geometry={type:'MultiPolygon',coordinates:rings};
  }
 }
 // An explicitly mapped length takes precedence; a point still cannot give
 // a geometric measurement. A missing coordinate never becomes a short span.
 const tagged=parsePlatformLength(tags.length);
 if(tagged)return {...properties,length:tagged,length_basis:'mapped_tag'};
 if(!geometry)return properties;
 if(geometry.type==='LineString')return {...properties,length:platformSpan({geometry}),length_basis:'mapped_line'};
 const length=platformExtent(geometry);
 return length>0?{...properties,length,length_estimated:true,length_basis:'mapped_extent'}:properties;
}
// Long side of the minimum-area oriented bounding rectangle of the full area.
// This is an estimate of mapped longitudinal extent, never the polygon perimeter
// or a claim about usable boarding length. Separate multipolygon parts stay separate.
export function platformExtent(geometry){
 const rings=geometry.type==='Polygon'?[geometry.coordinates[0]]:geometry.type==='MultiPolygon'?geometry.coordinates.map(p=>p[0]):[];
 return Math.max(0,...rings.map(ring=>{
  if(ring.length<4)return 0;const origin=ring[0],rad=Math.PI/180,scale=6371000*rad,cos=Math.cos(origin[1]*rad);
  const points=ring.slice(0,-1).map(p=>[(((p[0]-origin[0]+540)%360)-180)*scale*cos,(p[1]-origin[1])*scale]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),half=list=>{const out=[];for(const p of list){while(out.length>1&&cross(out.at(-2),out.at(-1),p)<=0)out.pop();out.push(p);}return out.slice(0,-1);};
  const hull=[...half(points),...half(points.slice().reverse())];let bestArea=Infinity,bestLength=0;
  for(let i=0;i<hull.length;i++){const a=hull[i],b=hull[(i+1)%hull.length],theta=Math.atan2(b[1]-a[1],b[0]-a[0]),c=Math.cos(theta),s=Math.sin(theta);let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
   for(const [x,y] of hull){const u=x*c+y*s,v=-x*s+y*c;xmin=Math.min(xmin,u);xmax=Math.max(xmax,u);ymin=Math.min(ymin,v);ymax=Math.max(ymax,v);}
   const width=xmax-xmin,height=ymax-ymin,area=width*height;if(area<bestArea){bestArea=area;bestLength=Math.max(width,height);}
  }return bestLength;
 }));
}
// A point label on the visible platform fragment avoids tiled polygon/line
// anchors that lie offscreen at close zoom. Clip only for placement, never length.
export function platformLabelAnchor(feature,bounds){
 const g=feature.geometry;if(!g)return null;if(g.type==='Point')return g.coordinates;
 const limits=bounds?[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()]:null;
 const inside=p=>!limits||p[0]>=limits[0]&&p[0]<=limits[2]&&p[1]>=limits[1]&&p[1]<=limits[3];
 const clipSegment=(a,b)=>{let lo=0,hi=1;if(limits)for(let j=0;j<2;j++){const delta=b[j]-a[j];if(!delta){if(a[j]<limits[j]||a[j]>limits[j+2])return null;}else{const t1=(limits[j]-a[j])/delta,t2=(limits[j+2]-a[j])/delta;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>hi)return null;}}return [a.map((v,j)=>v+(b[j]-v)*lo),a.map((v,j)=>v+(b[j]-v)*hi)];};
 if(['LineString','MultiLineString'].includes(g.type)){
  const lines=g.type==='LineString'?[g.coordinates]:g.coordinates,parts=[];
  for(const line of lines){let current=[];for(let i=1;i<line.length;i++){const piece=clipSegment(line[i-1],line[i]);if(!piece){current=[];continue;}if(current.length&&current.at(-1).every((v,j)=>Math.abs(v-piece[0][j])<1e-10))current.push(piece[1]);else{current=piece;parts.push(current);}}}
  return platformAnchor({geometry:{type:'MultiLineString',coordinates:parts}});
 }
 const polygons=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
 let best=null,score=0;
 // Between consecutive vertex heights, a horizontal scan has constant edge
 // topology. Pair crossings with even-odd fill so concavities and holes are
 // excluded; intersect the resulting interior intervals with the viewport.
 for(const polygon of polygons){
  const ys=[...new Set(polygon.flat().map(p=>p[1]).filter(y=>!limits||y>limits[1]&&y<limits[3]))];
  if(limits)ys.push(limits[1],limits[3]);
  ys.sort((a,b)=>a-b);
  for(let band=1;band<ys.length;band++){
   const y=(ys[band-1]+ys[band])/2,crossings=[];
   for(const ring of polygon)for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length];
    if((a[1]>y)!==(b[1]>y))crossings.push(a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]));
   }
   crossings.sort((a,b)=>a-b);
   for(let i=1;i<crossings.length;i+=2){
    const left=Math.max(crossings[i-1],limits?.[0]??-Infinity),right=Math.min(crossings[i],limits?.[2]??Infinity);
    const area=(right-left)*(ys[band]-ys[band-1]);
    if(right>left&&area>score){score=area;best=[(left+right)/2,y];}
   }
  }
 }return best&&inside(best)?best:null;
}
function platformTextAnchor(map,coordinates,ref,length){
 const point=map.project?.(coordinates),container=map.getContainer?.();if(!point||!container?.clientWidth)return 'center';
 const margin=Math.min(container.clientWidth/2,Math.max(60,(ref.length+(length?15:0))*3.5+10)),x=point.x<margin?'left':point.x>container.clientWidth-margin?'right':'',y=point.y<20?'top':point.y>container.clientHeight-20?'bottom':'';
 return [y,x].filter(Boolean).join('-')||'center';
}
// Both platform references and complete boarding-edge lengths use one bounded
// request queue. Platform tiles contain name/id but deliberately omit ref;
// edge tiles contain ref and can therefore label it before any API response.
export function createPlatformLengths(map,{active=()=>true,fetcher=fetch,delay=1100,maxEntries=512,cooldown=600000,retryDelay=30000,onLength=()=>{},onPlatform=()=>{}}={}){
 const cache=new Map(),pending=new Map(),drawn=new Map();let desired=new Map(),timer,wakeTimer,busy=false,disposed=false,controller,inflight;let pausedUntil=0;
 const remember=(key,properties)=>{cache.delete(key);cache.set(key,properties);while(cache.size>maxEntries)cache.delete(cache.keys().next().value);};
 const pause=duration=>{pausedUntil=Date.now()+duration;clearTimeout(wakeTimer);wakeTimer=setTimeout(()=>{wakeTimer=undefined;pausedUntil=0;update();},duration);};
 const draw=()=>{
  if(disposed)return;
  const edges=[],platforms=[];
  for(const [key,entry] of desired){
   const {kind,id,feature:f}=entry,p={...f.properties,...cache.get(key)},ref=platformReference(p.ref);
   if(kind==='edge'){
    const length=Number(p.length),coordinates=platformLabelAnchor(f,map.getBounds?.());
    if(coordinates&&(ref||length>0&&map.getZoom()>=19))edges.push({type:'Feature',id,geometry:{type:'Point',coordinates},properties:{id:`way-${id}`,osm_type:'way',osm_id:id,feature:'platform_edge',ref,label_anchor:platformTextAnchor(map,coordinates,ref,length),...(length>0&&Number.isFinite(length)&&map.getZoom()>=19?{platform_length:length}:{})}});
   }else if(ref||Number(p.length)>0&&map.getZoom()>=19){
    const object=platformObjectIdentity(f);
    const coordinates=platformLabelAnchor(f,map.getBounds?.());if(!coordinates)continue;
    platforms.push({type:'Feature',id,geometry:{type:'Point',coordinates},properties:{id,osm_type:object.type,osm_id:object.id,feature:'platform',name:p.name||'',ref,label_anchor:platformTextAnchor(map,coordinates,ref,Number(p.length)),...(Number(p.length)>0&&map.getZoom()>=19?{platform_length:p.length,length_estimated:!!p.length_estimated,length_basis:p.length_basis}:{})}});
   }
  }
  for(const [id,features] of [['platformLengths',edges],['platformNumbers',platforms]]){
   if(id==='platformNumbers'&&!features.length&&!drawn.has(id))continue;
   const source=map.getSource(id);if(!source)continue;
   const data={type:'FeatureCollection',features},signature=JSON.stringify(data),last=drawn.get(id);
   if(source!==last?.source||signature!==last.signature){source.setData(data);drawn.set(id,{source,signature});}
  }
 };
 async function next(){
  if(busy||disposed||Date.now()<pausedUntil)return;const entry=pending.entries().next().value;if(!entry)return;
  const [key,url]=entry,requested=desired.get(key);pending.delete(key);if(!requested){schedule();return;}busy=true;inflight=key;const requestController=new AbortController();controller=requestController;
  const timeout=setTimeout(()=>requestController.abort(),5000);
  try {
   const r=await fetcher(url,{signal:requestController.signal});if(r.status===429){pause(cooldown);pending.clear();return;}
   if(r.status===404||r.status===410){remember(key,{...cache.get(key),complete:!!requested.full});draw();return;}
   if(!r.ok)throw new Error(`HTTP ${r.status}`);
   const data=await r.json(),entry=requested;if(disposed)return;
   const raw=entry.full?platformOSMDetails(data,platformObjectIdentity(entry.feature)):data.properties||{},length=Number(raw.length),properties={...(entry.full?raw:{}),name:raw.name||entry.feature.properties?.name||'',ref:raw.ref??entry.feature.properties?.ref??''};
   if(entry.kind==='edge')properties.length=Number.isFinite(length)&&length>0?length:null;
   remember(key,properties);draw();
   if(entry.kind==='edge')onLength(entry.id,properties.length);else onPlatform(entry.id,properties);
  }
  // A pan, view change or temporary zoom reduction can hide and then reveal
  // this same key before its abort rejection settles. That cancellation is
  // not a provider failure; genuine failures and request timeouts still pause.
  catch(error){if(requestController.signal.reason!==OBSOLETE_REQUEST&&desired.get(key)?.url&&!disposed)pause(retryDelay);}
  // A reappearing key was skipped while it was inflight. Refresh desired and
  // pending entries after releasing it so it can be requested without a move.
  finally{clearTimeout(timeout);busy=false;inflight=undefined;controller=undefined;update();}
 }
 function schedule(){if(timer||busy||disposed||!pending.size||Date.now()<pausedUntil)return;timer=setTimeout(()=>{timer=undefined;next();},delay);}
 function update(){
  if(disposed)return;desired=new Map();
  if(active()&&map.getZoom()>=17){
   for(const f of map.queryRenderedFeatures({layers:['platform-edges']})){
    const id=platformIdentity(f);if(!id)continue;const key='edge/'+id,previous=desired.get(key);
    if(!previous||platformSpan(f)>platformSpan(previous.feature))desired.set(key,{kind:'edge',id,feature:f,url:map.getZoom()>=19?PLATFORM_API+id:null});
   }
   const layers=['platform-areas','platform-outlines','platform-points'].filter(id=>!map.getLayer||map.getLayer(id));
   for(const f of layers.length?map.queryRenderedFeatures({layers}):[]){
    const object=platformObjectIdentity(f);if(!object)continue;const key='platform/'+object.key,previous=desired.get(key);
    const full=map.getZoom()>=19;
    if(!previous||geometrySpan(f)>geometrySpan(previous.feature))desired.set(key,{kind:'platform',id:object.key,feature:f,full,url:full?platformOSMURL(object):'https://openrailwaymap.app/api/feature/openrailwaymap_standard/standard_railway_platforms/'+object.key});
   }
  }
  for(const key of pending.keys())if(!desired.get(key)?.url)pending.delete(key);
  for(const [key,entry] of desired){const wanted=entry.url&&(!cache.has(key)||entry.full&&!cache.get(key).complete);if(!wanted)pending.delete(key);else if(key!==inflight&&Date.now()>=pausedUntil)pending.set(key,entry.url);}
  if(inflight&&!desired.get(inflight)?.url)controller?.abort(OBSOLETE_REQUEST);
  draw();schedule();
 }
 function destroy(){disposed=true;clearTimeout(timer);clearTimeout(wakeTimer);controller?.abort(OBSOLETE_REQUEST);pending.clear();}
 function enrich(feature){
  const p=feature.properties||{},object=['platforms','platformNumbers'].includes(feature.source)?platformObjectIdentity(feature):null,id=object?.key||platformIdentity(feature);if(!id)return feature;
  const values=cache.get((object?'platform/':'edge/')+id)||{},length=Number(values.length);
  return {...feature,properties:{...p,...values,ref:platformReference(values.ref??p.ref),osm_type:object?.type||'way',osm_id:object?.id||id,feature:object?'platform':'platform_edge',...(length>0?{platform_length:length}:{})}};
 }
 return {update,destroy,enrich};
}
// Prefer the largest visible fragment of a tiled platform, rather than whichever
// fragment happens to be returned first. It is used for label placement only.
function geometrySpan(feature){let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;const visit=value=>{if(typeof value?.[0]==='number'){west=Math.min(west,value[0]);east=Math.max(east,value[0]);south=Math.min(south,value[1]);north=Math.max(north,value[1]);}else for(const v of value||[])visit(v);};visit(feature.geometry?.coordinates);return west===Infinity?0:Math.hypot(east-west,north-south);}
