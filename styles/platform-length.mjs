// Length of the complete mapped boarding edge, from the provider's feature
// API. Tile geometry is clipped and cannot supply that length reliably.
export const PLATFORM_SOURCE='standard_railway_platform_edges';
export const PLATFORM_API='https://openrailwaymap.app/api/feature/openrailwaymap_standard/'+PLATFORM_SOURCE+'/';
const OBSOLETE_REQUEST=Symbol('obsolete platform request');
export const PLATFORM_GEOMETRY_LIMITS={elements:4096,members:64,vertices:1024,responseBytes:2*1024*1024};
export const PLATFORM_UPDATE_LIMITS={candidates:2048,features:512,vertices:16384,work:4*1024*1024};
function boundedGeometry(geometry){let count=0;const visit=p=>Array.isArray(p)&&(!Array.isArray(p[0])?++count<=PLATFORM_GEOMETRY_LIMITS.vertices:p.every(visit));return !!geometry&&visit(geometry.coordinates);}
export async function readPlatformResponse(response){
 if(!response.body?.getReader)return response.json();
 const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text='';
 try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>PLATFORM_GEOMETRY_LIMITS.responseBytes){const error=new Error('Platform response budget exceeded');error.platformBudget=true;throw error;}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function formatPlatformLength(metres,units='metric') {if(!(metres>0&&Number.isFinite(metres)))return '';return `${Math.round(units==='imperial'?metres/0.3048:metres)} ${units==='imperial'?'ft':'m'}`;}
export function platformLengthLabel(units='metric') {
 const length=['concat',['case',['==',['get','length_estimated'],true],'≈',''],['to-string',['round',['*',['get','platform_length'],units==='imperial'?1/0.3048:1]]],units==='imperial'?' ft':' m'];
 const hasLength=['>',['to-number',['get','platform_length'],0],0],ref=['coalesce',['get','ref'],''];
 return ['concat',ref,['case',['all',['!=',ref,''],hasLength],' · ',''],['case',hasLength,length,'']];
}
export function platformReference(value) {return (Array.isArray(value)?value:[value]).filter(v=>typeof v==='string'||typeof v==='number'&&Number.isFinite(v)).flatMap(v=>String(v).split(';')).map(v=>v.trim()).filter(Boolean).join(' / ');}
export function platformObjectIdentity(feature) {const match=/^(node|way|relation)-([1-9]\d*)$/.exec(String(feature.properties?.id??feature.id??''));return match?{key:match[0],type:match[1],id:match[2]}:null;}
export function platformIdentity(feature){const p=feature.properties||{},value=p.id??feature.id;const m=/^(?:way-)?(\d+)$/.exec(String(value??''));return m&&Number(m[1])>0?m[1]:null;}
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
// Complete platform geometry comes from the provider's own platform tiles at
// zoom 15 (about 1.2 km a tile at the equator), read the way the map reads its
// tiles, as upstream OpenRailwayMap does: no request per platform goes to OSM.
// A piece that leaves its tile continues in the neighbouring tile, which is
// then read too; a platform that needs more than PLATFORM_TILE_LIMIT tiles
// gets no length rather than a short one.
export const PLATFORM_TILE_ZOOM=15,PLATFORM_TILE_LIMIT=9;
const RAD=Math.PI/180;
const metres=(a,b)=>{const h=Math.sin((b[1]-a[1])*RAD/2)**2+Math.cos(a[1]*RAD)*Math.cos(b[1]*RAD)*Math.sin((b[0]-a[0])*RAD/2)**2;return 12742000*Math.asin(Math.min(1,Math.sqrt(h)));};
export function tileToLngLat(z,x,y,extent,[px,py]){const n=2**z,t=Math.PI*(1-2*(y+py/extent)/n);return [(x+px/extent)/n*360-180,Math.atan(Math.sinh(t))/RAD];}
export function platformTilesFor(coordinates,z=PLATFORM_TILE_ZOOM){
 const n=2**z,points=[];const visit=v=>{if(typeof v?.[0]==='number')points.push(v);else for(const c of v||[])visit(c);};visit(coordinates);
 const tiles=new Set();for(const [lng,lat] of points){const s=Math.sin(Math.max(-85.05,Math.min(85.05,lat))*RAD);
  tiles.add(`${((Math.floor((lng+180)/360*n))%n+n)%n}/${Math.max(0,Math.min(n-1,Math.floor((.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n)))}`);}
 return [...tiles].map(k=>k.split('/').map(Number));
}
// Length of a tile piece inside its own tile only, so the buffer that tiles
// share is never counted twice.
function insideLength(z,x,y,extent,line){
 let total=0;
 for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i];let lo=0,hi=1;
  for(let j=0;j<2;j++){const d=b[j]-a[j];if(!d){if(a[j]<0||a[j]>extent){lo=1;hi=0;}}else{const t1=(0-a[j])/d,t2=(extent-a[j])/d;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));}}
  if(hi>lo)total+=metres(tileToLngLat(z,x,y,extent,a.map((v,j)=>v+(b[j]-v)*lo)),tileToLngLat(z,x,y,extent,a.map((v,j)=>v+(b[j]-v)*hi)));
 }
 return total;
}
function insideRing([x,y],ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;}return inside;}
function segmentDistance(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=dx||dy?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy))):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
const deepInside=(p,ring,eps)=>{if(!insideRing(p,ring))return false;for(let i=1;i<ring.length;i++)if(segmentDistance(p,ring[i-1],ring[i])<=eps)return false;return true;};
// Two edges cross through each other away from their ends.
function edgesCross(a,b,c,d,eps){
 const cross=(o,p,q)=>(p[0]-o[0])*(q[1]-o[1])-(p[1]-o[1])*(q[0]-o[0]);
 const d1=cross(a,b,c),d2=cross(a,b,d),d3=cross(c,d,a),d4=cross(c,d,b);
 if(!(d1*d2<0&&d3*d4<0))return false;
 const t=d1/(d1-d2),at=[c[0]+(d[0]-c[0])*t,c[1]+(d[1]-c[1])*t];
 return [a,b,c,d].every(e=>Math.hypot(e[0]-at[0],e[1]-at[1])>eps);
}
// Two rings belong to one part when they share area: the pieces of one part
// overlap in the buffer neighbouring tiles share, and a hole lies inside its
// outer ring. Parts that only touch, at a vertex or along an edge, stay
// separate. eps (about a tile unit) absorbs where each tile rounded a shared
// boundary.
export function ringsOverlap(a,b,eps=0){
 const probes=ring=>ring.flatMap((p,i)=>i?[p,[(p[0]+ring[i-1][0])/2,(p[1]+ring[i-1][1])/2]]:[p]);
 if(probes(a).some(p=>deepInside(p,b,eps))||probes(b).some(p=>deepInside(p,a,eps)))return true;
 for(let i=1;i<a.length;i++)for(let j=1;j<b.length;j++)if(edgesCross(a[i-1],a[i],b[j-1],b[j],eps))return true;
 return false;
}
export function createPlatformTileGeometry({tileURL,decode,fetcher=fetch,zoom=PLATFORM_TILE_ZOOM,maxTiles=48,timeout=8000}={}){
 const tiles=new Map();
 const read=(x,y)=>{
  const key=`${x}/${y}`;if(tiles.has(key)){const v=tiles.get(key);tiles.delete(key);tiles.set(key,v);return v;}
  const template=tileURL();if(!template)return Promise.reject(new Error('Platform tiles not ready'));
  const url=template.replace('{z}',zoom).replace('{x}',x).replace('{y}',y);
  const promise=fetcher(url,{signal:AbortSignal.timeout(timeout)}).then(async r=>{
   if(r.status===204||r.status===404)return [];
   if(!r.ok)throw new Error(`Platform tile HTTP ${r.status}`);
   return decode(await r.arrayBuffer());
  });
  promise.catch(()=>tiles.delete(key));
  tiles.set(key,promise);while(tiles.size>maxTiles)tiles.delete(tiles.keys().next().value);
  return promise;
 };
 // seeds: [[x,y]] tiles holding the visible piece. Resolves to
 // {length, length_estimated, length_basis, tiles} or null when it cannot be
 // complete; tiles lists the "x/y" keys read, so a caller can tell when a
 // multipolygon part lies beyond them.
 async function measure(id,seeds){
  const n=2**zoom,queue=seeds.map(([x,y])=>[x,y]),seen=new Set(),found=[];let vertices=0;
  while(queue.length){
   const [x,y]=queue.shift(),key=`${x}/${y}`;if(seen.has(key))continue;
   if(seen.size>=PLATFORM_TILE_LIMIT)return null;seen.add(key);
   for(const piece of await read(x,y)){
    if(String(piece.id)!==String(id))continue;found.push({x,y,piece});
    for(const ring of piece.geometry){vertices+=ring.length;if(vertices>PLATFORM_GEOMETRY_LIMITS.vertices*8)return null;
     for(const [px,py] of ring){
      for(const [dx,dy] of [[px<0?-1:px>piece.extent?1:0,0],[0,py<0?-1:py>piece.extent?1:0]])
       if((dx||dy)&&y+dy>=0&&y+dy<n)queue.push([((x+dx)%n+n)%n,y+dy]);
     }}
   }
  }
  if(!found.length)return null;
  if(found.every(f=>f.piece.type===2)){
   const length=found.reduce((sum,{x,y,piece})=>sum+piece.geometry.reduce((s,line)=>s+insideLength(zoom,x,y,piece.extent,line),0),0);
   return length>0?{length,length_basis:'mapped_line',tiles:[...seen]}:null;
  }
  if(!found.every(f=>f.piece.type===3))return null;
  // Separate parts of a multipolygon are measured separately (ringsOverlap);
  // overlapping bounds alone do not join interlocking parts.
  const rings=found.flatMap(({x,y,piece})=>piece.geometry.map(ring=>ring.map(p=>tileToLngLat(zoom,x,y,piece.extent,p)))).filter(r=>r.length);
  const bounds=rings.map(r=>r.reduce((b,[lng,lat])=>[Math.min(b[0],lng),Math.min(b[1],lat),Math.max(b[2],lng),Math.max(b[3],lat)],[Infinity,Infinity,-Infinity,-Infinity]));
  const parent=rings.map((_,i)=>i),root=i=>parent[i]===i?i:parent[i]=root(parent[i]),eps=360/2**zoom/(found[0].piece.extent||4096);
  for(let i=0;i<rings.length;i++)for(let j=i+1;j<rings.length;j++){const a=bounds[i],b=bounds[j];if(a[0]<=b[2]+eps&&b[0]<=a[2]+eps&&a[1]<=b[3]+eps&&b[1]<=a[3]+eps&&ringsOverlap(rings[i],rings[j],eps))parent[root(i)]=root(j);}
  const parts=new Map();rings.forEach((r,i)=>{const k=root(i);parts.set(k,[...(parts.get(k)||[]),...r]);});
  const length=Math.max(0,...[...parts.values()].map(extentOfPoints));
  return length>0?{length,length_estimated:true,length_basis:'mapped_extent',tiles:[...seen]}:null;
 }
 return {measure};
}
// Long side of the minimum-area oriented bounding rectangle of the full area.
// This is an estimate of mapped longitudinal extent, never the polygon perimeter
// or a claim about usable boarding length. Separate multipolygon parts stay separate.
export function platformExtent(geometry){
 if(!boundedGeometry(geometry))return 0;
 const rings=geometry.type==='Polygon'?[geometry.coordinates[0]]:geometry.type==='MultiPolygon'?geometry.coordinates.map(p=>p[0]):[];
 return Math.max(0,...rings.map(ring=>ring.length<4?0:extentOfPoints(ring.slice(0,-1))));
}
export function extentOfPoints(list){
  if(list.length<3)return 0;const origin=list[0],scale=6371000*RAD,cos=Math.cos(origin[1]*RAD);
  const points=list.map(p=>[(((p[0]-origin[0]+540)%360)-180)*scale*cos,(p[1]-origin[1])*scale]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),half=list=>{const out=[];for(const p of list){while(out.length>1&&cross(out.at(-2),out.at(-1),p)<=0)out.pop();out.push(p);}return out.slice(0,-1);};
  const hull=[...half(points),...half(points.slice().reverse())],n=hull.length;let bestArea=Infinity,bestLength=0;
  if(n<3){for(const p of hull)for(const q of hull)bestLength=Math.max(bestLength,Math.hypot(p[0]-q[0],p[1]-q[1]));return bestLength;}
  // Rotating calipers: the smallest enclosing rectangle has a side on a hull
  // edge, and the farthest points along, across and behind each edge only
  // move forward around the counter-clockwise hull, so the work is linear.
  const at=i=>hull[i%n];let far=1,top=1,back=1;
  for(let i=0;i<n;i++){
   const a=hull[i],b=at(i+1),len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!len)continue;
   const ux=(b[0]-a[0])/len,uy=(b[1]-a[1])/len,along=p=>(p[0]-a[0])*ux+(p[1]-a[1])*uy,across=p=>(p[1]-a[1])*ux-(p[0]-a[0])*uy;
   // Each caliper starts no earlier than the one before it.
   far=Math.max(far,i+1);
   for(let step=0;step<n&&along(at(far+1))>=along(at(far));step++)far++;
   top=Math.max(top,far);
   for(let step=0;step<n&&across(at(top+1))>=across(at(top));step++)top++;
   back=Math.max(back,top);
   for(let step=0;step<n&&along(at(back+1))<=along(at(back));step++)back++;
   const width=along(at(far))-along(at(back)),height=across(at(top)),area=width*height;
   // Equal areas (common for gridded outlines) keep the first edge's rectangle.
   if(area<bestArea*(1-1e-9)){bestArea=area;bestLength=Math.max(width,height);}
  }return bestLength;
}
// A point label on the visible platform fragment avoids tiled polygon/line
// anchors that lie offscreen at close zoom. Clip only for placement, never length.
export function platformLabelAnchor(feature,bounds,screen=false){
 const g=feature.geometry;if(!boundedGeometry(g))return null;
 const limits=bounds?[bounds.getWest(),bounds.getSouth(),bounds.getEast(),bounds.getNorth()]:null;
 const inside=p=>!limits||p[0]>=limits[0]&&p[0]<=limits[2]&&p[1]>=limits[1]&&p[1]<=limits[3];
 if(g.type==='Point')return inside(g.coordinates)?g.coordinates:null;
 const clipSegment=(a,b)=>{let lo=0,hi=1;if(limits)for(let j=0;j<2;j++){const delta=b[j]-a[j];if(!delta){if(a[j]<limits[j]||a[j]>limits[j+2])return null;}else{const t1=(limits[j]-a[j])/delta,t2=(limits[j+2]-a[j])/delta;lo=Math.max(lo,Math.min(t1,t2));hi=Math.min(hi,Math.max(t1,t2));if(lo>hi)return null;}}return [a.map((v,j)=>v+(b[j]-v)*lo),a.map((v,j)=>v+(b[j]-v)*hi)];};
 if(['LineString','MultiLineString'].includes(g.type)){
  const lines=g.type==='LineString'?[g.coordinates]:g.coordinates,parts=[];
  for(const line of lines){let current=[];for(let i=1;i<line.length;i++){const piece=clipSegment(line[i-1],line[i]);if(!piece){current=[];continue;}if(current.length&&current.at(-1).every((v,j)=>Math.abs(v-piece[0][j])<1e-10))current.push(piece[1]);else{current=piece;parts.push(current);}}}
  if(!screen)return platformAnchor({geometry:{type:'MultiLineString',coordinates:parts}});
  const ranked=parts.map(line=>{const lengths=line.slice(1).map((p,i)=>Math.hypot(p[0]-line[i][0],p[1]-line[i][1]));return {line,lengths,total:lengths.reduce((a,b)=>a+b,0)};}).sort((a,b)=>b.total-a.total),best=ranked[0];
  if(!best)return null;let left=best.total/2;
  for(let i=0;i<best.lengths.length;i++){if(left<=best.lengths[i]){const t=best.lengths[i]?left/best.lengths[i]:0;return best.line[i].map((v,j)=>v+(best.line[i+1][j]-v)*t);}left-=best.lengths[i];}
  return null;
 }
 const polygons=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
 let best=null,score=0;
 // Between consecutive vertex heights, a horizontal scan has constant edge
 // topology. Pair crossings with even-odd fill so concavities and holes are
 // excluded; intersect the resulting interior intervals with the viewport.
 for(const polygon of polygons){
  const ys=[...new Set(polygon.flat().map(p=>p[1]).filter(y=>!limits||y>limits[1]&&y<limits[3]))];
  if(limits){
   ys.push(limits[1],limits[3]);
   // A diagonal can enter a viewport corner between vertex heights. Include
   // vertical-border intersections so a narrow visible triangle is sampled.
   for(const ring of polygon)for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length];
    for(const x of [limits[0],limits[2]])if((a[0]-x)*(b[0]-x)<0){const y=a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]);if(y>limits[1]&&y<limits[3])ys.push(y);}
   }
  }
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
// Bearing and pitch make getBounds() a loose geographic rectangle. Place
// labels inside the actual projected viewport, then return ground coordinates.
export function platformScreenAnchor(feature,map){
 if(!boundedGeometry(feature.geometry))return null;
 const container=map.getContainer?.();
 if(!map.project||!map.unproject||!container?.clientWidth||!container?.clientHeight)return platformLabelAnchor(feature,map.getBounds?.());
 const project=coordinates=>Array.isArray(coordinates[0])?coordinates.map(project):(()=>{const p=map.project(coordinates);return [p.x,p.y];})();
 const geometry=feature.geometry;if(!geometry)return null;
 const anchor=platformLabelAnchor({geometry:{...geometry,coordinates:project(geometry.coordinates)}},{getWest:()=>0,getSouth:()=>0,getEast:()=>container.clientWidth,getNorth:()=>container.clientHeight},true);
 if(!anchor)return null;const point=map.unproject(anchor);return [point.lng,point.lat];
}
function platformTextAnchor(map,coordinates,ref,length){
 const point=map.project?.(coordinates),container=map.getContainer?.();if(!point||!container?.clientWidth)return 'center';
 const margin=Math.min(container.clientWidth/2,Math.max(60,(ref.length+(length?15:0))*3.5+10)),x=point.x<margin?'left':point.x>container.clientWidth-margin?'right':'',y=point.y<20?'top':point.y>container.clientHeight-20?'bottom':'';
 return [y,x].filter(Boolean).join('-')||'center';
}
// Platform references and complete boarding-edge lengths use one bounded
// request queue to the provider's feature API, as on its own site. Platform
// tiles contain name/id but omit ref; edge tiles contain ref and can label it
// before any API response. Platform lengths are measured from the provider's
// platform tiles (createPlatformTileGeometry), one platform at a time.
export function createPlatformLengths(map,{active=()=>true,fetcher=fetch,delay=1100,maxEntries=512,cooldown=600000,retryDelay=30000,geometry=null,onLength=()=>{},onPlatform=()=>{}}={}){
 const cache=new Map(),pending=new Map(),drawn=new Map(),readTiles=new Map();let desired=new Map(),timer,wakeTimer,busy=false,disposed=false,controller,inflight,measuring=false,measureRetryAt=0,measureTimer;let pausedUntil=0;
 const remember=(key,properties)=>{cache.delete(key);cache.set(key,properties);while(cache.size>maxEntries){const old=cache.keys().next().value;cache.delete(old);readTiles.delete(old);}};
 const pause=duration=>{pausedUntil=Date.now()+duration;clearTimeout(wakeTimer);wakeTimer=setTimeout(()=>{wakeTimer=undefined;pausedUntil=0;update();},duration);};
 const draw=()=>{
  if(disposed)return;
  const edges=[],platforms=[];
  for(const [key,entry] of desired){
   const {kind,id,feature:f}=entry,p={...f.properties,...cache.get(key)},ref=platformReference(p.ref);
   if(kind==='edge'){
    const length=Number(p.length),coordinates=entry.anchor;
    if(coordinates&&(ref||length>0&&map.getZoom()>=19))edges.push({type:'Feature',id,geometry:{type:'Point',coordinates},properties:{id:`way-${id}`,osm_type:'way',osm_id:id,feature:'platform_edge',ref,label_anchor:platformTextAnchor(map,coordinates,ref,length),...(length>0&&Number.isFinite(length)&&map.getZoom()>=19?{platform_length:length}:{})}});
   }else if(ref||Number(p.length)>0&&map.getZoom()>=19){
    const object=platformObjectIdentity(f);
    const coordinates=entry.anchor;if(!coordinates)continue;
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
   if(r.status===404||r.status===410){remember(key,{...cache.get(key),fetched:true});draw();return;}
   if(!r.ok)throw new Error(`HTTP ${r.status}`);
   const data=await readPlatformResponse(r),entry=requested;if(disposed)return;
   const raw=data.properties||{},length=Number(raw.length),properties={...cache.get(key),fetched:true,name:raw.name||entry.feature.properties?.name||'',ref:raw.ref??entry.feature.properties?.ref??''};
   if(entry.kind==='edge')properties.length=Number.isFinite(length)&&length>0?length:null;
   remember(key,properties);draw();
   if(entry.kind==='edge')onLength(entry.id,properties.length);else onPlatform(entry.id,properties);
  }
  // A pan, view change or temporary zoom reduction can hide and then reveal
  // this same key before its abort rejection settles. That cancellation is
  // not a provider failure; genuine failures and request timeouts still pause.
  catch(error){if(error.platformBudget){remember(key,{...cache.get(key),fetched:true});draw();}else if(requestController.signal.reason!==OBSOLETE_REQUEST&&desired.get(key)?.url&&!disposed)pause(retryDelay);}
  // A reappearing key was skipped while it was inflight. Refresh desired and
  // pending entries after releasing it so it can be requested without a move.
  finally{clearTimeout(timeout);busy=false;inflight=undefined;controller=undefined;update();}
 }
 function schedule(){if(timer||busy||disposed||!pending.size||Date.now()<pausedUntil)return;timer=setTimeout(()=>{timer=undefined;next();},delay);}
 function update(){
  if(disposed)return;desired=new Map();
  if(active()&&map.getZoom()>=17){
   let candidates=0,vertices=0,work=0;const anchors=new WeakMap();
   const prepare=f=>{
    if(++candidates>PLATFORM_UPDATE_LIMITS.candidates)return null;
    if(anchors.has(f))return anchors.get(f);
    let n=0;const visit=p=>Array.isArray(p)&&(!Array.isArray(p[0])?++n<=PLATFORM_GEOMETRY_LIMITS.vertices:p.every(visit));
    if(!f.geometry||!visit(f.geometry.coordinates))return null;
    const cost=['Polygon','MultiPolygon'].includes(f.geometry.type)?3*n*n:n;
    if(vertices+n>PLATFORM_UPDATE_LIMITS.vertices||work+cost>PLATFORM_UPDATE_LIMITS.work)return null;
    vertices+=n;work+=cost;const result={anchor:platformScreenAnchor(f,map)};anchors.set(f,result);return result;
   };
   const better=(f,anchor,previous,span)=>!previous||!!anchor&&!previous.anchor||!!anchor===!!previous.anchor&&span(f)>span(previous.feature);
   for(const f of map.queryRenderedFeatures({layers:['platform-edges']})){
    if(candidates>=PLATFORM_UPDATE_LIMITS.candidates)break;
    const prepared=prepare(f);if(!prepared)continue;
    const id=platformIdentity(f);if(!id)continue;const key='edge/'+id,previous=desired.get(key);
    if(!previous&&desired.size>=PLATFORM_UPDATE_LIMITS.features)continue;
    if(better(f,prepared.anchor,previous,platformSpan))desired.set(key,{kind:'edge',id,feature:f,anchor:prepared.anchor,url:map.getZoom()>=19?PLATFORM_API+id:null});
   }
   const layers=['platform-areas','platform-outlines','platform-points'].filter(id=>!map.getLayer||map.getLayer(id));
   for(const f of layers.length?map.queryRenderedFeatures({layers}):[]){
    if(candidates>=PLATFORM_UPDATE_LIMITS.candidates)break;
    const prepared=prepare(f);if(!prepared)continue;
    const object=platformObjectIdentity(f);if(!object)continue;const key='platform/'+object.key,previous=desired.get(key);
    if(!previous&&desired.size>=PLATFORM_UPDATE_LIMITS.features)continue;
    if(better(f,prepared.anchor,previous,geometrySpan))desired.set(key,{kind:'platform',id:object.key,feature:f,anchor:prepared.anchor,url:'https://openrailwaymap.app/api/feature/openrailwaymap_standard/standard_railway_platforms/'+object.key});
   }
  }
  for(const key of pending.keys())if(!desired.get(key)?.url)pending.delete(key);
  for(const [key,entry] of desired){const wanted=entry.url&&!cache.get(key)?.fetched;if(!wanted)pending.delete(key);else if(key!==inflight&&Date.now()>=pausedUntil)pending.set(key,entry.url);}
  if(inflight&&!desired.get(inflight)?.url)controller?.abort(OBSOLETE_REQUEST);
  draw();schedule();measureNext();
 }
 // Lengths are shown from zoom 19; measure the visible platforms that still
 // lack one, nearest the start of the list first. Measuring follows a part
 // across tile edges but cannot reach a separate part of a multipolygon in
 // tiles it never read, so a relation seen in such a tile is measured again
 // from there and keeps its longest part.
 const unread=(key,entry,values)=>{
  const seeds=platformTilesFor(entry.feature.geometry?.coordinates);
  if(!values?.measured)return seeds;
  if(platformObjectIdentity(entry.feature)?.type!=='relation')return null;
  const read=readTiles.get(key)||new Set(),fresh=seeds.filter(([x,y])=>!read.has(`${x}/${y}`));
  return fresh.length?fresh:null;
 };
 async function measureNext(){
  if(!geometry||measuring||disposed||map.getZoom()<19)return;
  if(Date.now()<measureRetryAt){clearTimeout(measureTimer);measureTimer=setTimeout(measureNext,measureRetryAt-Date.now());return;}
  let next,seeds;
  for(const [key,entry] of desired){if(entry.kind!=='platform'||platformObjectIdentity(entry.feature)?.type==='node')continue;seeds=unread(key,entry,cache.get(key));if(seeds){next=[key,entry];break;}}
  if(!next)return;
  const [key,entry]=next;measuring=true;
  try{
   const result=await geometry.measure(entry.id,seeds);if(disposed)return;
   const previous=cache.get(key)||{},{tiles=seeds.map(([x,y])=>`${x}/${y}`),...measured}=result||{};
   const keep=previous.measured&&previous.length>0&&!(measured.length>previous.length);
   remember(key,{...previous,...(keep?{}:result?measured:{}),measured:true});readTiles.set(key,new Set([...(readTiles.get(key)||[]),...tiles]));draw();onPlatform(entry.id,cache.get(key));
  }catch{measureRetryAt=Date.now()+retryDelay;}
  finally{measuring=false;if(!disposed)measureNext();}
 }
 function destroy(){disposed=true;clearTimeout(timer);clearTimeout(wakeTimer);clearTimeout(measureTimer);controller?.abort(OBSOLETE_REQUEST);pending.clear();}
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
