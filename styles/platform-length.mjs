// Length of the complete mapped boarding edge, from the provider's feature
// API. Tile geometry is clipped and cannot supply that length reliably.
export const PLATFORM_SOURCE='standard_railway_platform_edges';
export const PLATFORM_API='https://openrailwaymap.app/api/feature/openrailwaymap_standard/'+PLATFORM_SOURCE+'/';
const OBSOLETE_REQUEST=Symbol('obsolete platform request');
export function formatPlatformLength(metres,units='metric') {if(!(metres>0&&Number.isFinite(metres)))return '';return `${Math.round(units==='imperial'?metres/0.3048:metres)} ${units==='imperial'?'ft':'m'}`;}
export function platformLengthLabel(units='metric') {
 const length=['concat',['to-string',['round',['*',['get','platform_length'],units==='imperial'?1/0.3048:1]]],units==='imperial'?' ft':' m'];
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
    const length=Number(p.length),coordinates=platformAnchor(f);
    if(coordinates&&(ref||length>0&&map.getZoom()>=19))edges.push({type:'Feature',id,geometry:{type:'Point',coordinates},properties:{id:`way-${id}`,osm_type:'way',osm_id:id,feature:'platform_edge',ref,...(length>0&&Number.isFinite(length)&&map.getZoom()>=19?{platform_length:length}:{})}});
   }else if(ref){
    const object=platformObjectIdentity(f);
    platforms.push({type:'Feature',id,geometry:f.geometry,properties:{id,osm_type:object.type,osm_id:object.id,feature:'platform',name:p.name||'',ref}});
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
  const [key,url]=entry;pending.delete(key);if(!desired.has(key)){schedule();return;}busy=true;inflight=key;const requestController=new AbortController();controller=requestController;
  const timeout=setTimeout(()=>requestController.abort(),5000);
  try {
   const r=await fetcher(url,{signal:requestController.signal});if(r.status===429){pause(cooldown);pending.clear();return;}
   if(r.status===404||r.status===410){remember(key,{});draw();return;}
   if(!r.ok)throw new Error(`HTTP ${r.status}`);
   const data=await r.json(),entry=desired.get(key);if(!entry||disposed)return;
   const raw=data.properties||{},length=Number(raw.length),properties={name:raw.name||entry.feature.properties?.name||'',ref:raw.ref??entry.feature.properties?.ref??''};
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
    if(!previous||geometrySpan(f)>geometrySpan(previous.feature))desired.set(key,{kind:'platform',id:object.key,feature:f,url:'https://openrailwaymap.app/api/feature/openrailwaymap_standard/standard_railway_platforms/'+object.key});
   }
  }
  for(const key of pending.keys())if(!desired.get(key)?.url)pending.delete(key);
  for(const [key,entry] of desired)if(entry.url&&!cache.has(key)&&!pending.has(key)&&key!==inflight&&Date.now()>=pausedUntil)pending.set(key,entry.url);
  if(inflight&&!desired.get(inflight)?.url)controller?.abort(OBSOLETE_REQUEST);
  draw();schedule();
 }
 function destroy(){disposed=true;clearTimeout(timer);clearTimeout(wakeTimer);controller?.abort(OBSOLETE_REQUEST);pending.clear();}
 function enrich(feature){
  const p=feature.properties||{},object=feature.source==='platforms'?platformObjectIdentity(feature):null,id=object?.key||platformIdentity(feature);if(!id)return feature;
  const values=cache.get((object?'platform/':'edge/')+id)||{},length=Number(values.length);
  return {...feature,properties:{...p,...values,ref:platformReference(values.ref??p.ref),osm_type:object?.type||'way',osm_id:object?.id||id,feature:object?'platform':'platform_edge',...(length>0?{platform_length:length}:{})}};
 }
 return {update,destroy,enrich};
}
// Prefer the largest visible fragment of a tiled platform, rather than whichever
// fragment happens to be returned first. It is used for label placement only.
function geometrySpan(feature){let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;const visit=value=>{if(typeof value?.[0]==='number'){west=Math.min(west,value[0]);east=Math.max(east,value[0]);south=Math.min(south,value[1]);north=Math.max(north,value[1]);}else for(const v of value||[])visit(v);};visit(feature.geometry?.coordinates);return west===Infinity?0:Math.hypot(east-west,north-south);}
