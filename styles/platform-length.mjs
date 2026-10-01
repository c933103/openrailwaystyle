// Length of the complete mapped boarding edge, from the provider's feature
// API. Tile geometry is clipped and cannot supply that length reliably.
export const PLATFORM_SOURCE='standard_railway_platform_edges';
export const PLATFORM_API='https://openrailwaymap.app/api/feature/openrailwaymap_standard/'+PLATFORM_SOURCE+'/';
export function formatPlatformLength(metres,units='metric') {if(!(metres>0&&Number.isFinite(metres)))return '';return `${Math.round(units==='imperial'?metres/0.3048:metres)} ${units==='imperial'?'ft':'m'}`;}
export function platformLengthLabel(units='metric') {
 const length=['concat',['to-string',['round',['*',['get','platform_length'],units==='imperial'?1/0.3048:1]]],units==='imperial'?' ft':' m'];
 return ['concat',['case',['!=',['coalesce',['get','ref'],''],''],['concat',['to-string',['get','ref']],' · '],''],length];
}
export function platformIdentity(feature){const p=feature.properties||{},value=p.id??feature.id;const m=/^(?:way-)?(\d+)$/.exec(String(value??''));return m&&Number(m[1])>0?m[1]:null;}
// Anchor at the midpoint of the longest loaded piece; the API supplies the
// full length independently of that visible/clipped piece.
export function platformAnchor(feature){
 const g=feature.geometry;if(!g)return null;
 const lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
 let best,length=-1;
 for(const line of lines){if(line.length<2)continue;const lens=line.slice(1).map((p,i)=>Math.hypot((p[0]-line[i][0])*Math.cos(p[1]*Math.PI/180),p[1]-line[i][1])),total=lens.reduce((a,b)=>a+b,0);if(total<=length)continue;
  let half=total/2;for(let i=0;i<lens.length;i++){if(half<=lens[i]){const t=lens[i]?half/lens[i]:0;best=line[i].map((v,j)=>v+(line[i+1][j]-v)*t);break;}half-=lens[i];}length=total;
 }
 return best||null;
}
export function createPlatformLengths(map,{active=()=>true,fetcher=fetch,delay=1100,maxEntries=256,cooldown=600000,retryDelay=30000}={}){
 const cache=new Map(),pending=new Map();let desired=new Map(),timer,wakeTimer,busy=false,disposed=false,controller,inflight;let pausedUntil=0,lastDraw,lastSource;
 const remember=(id,length)=>{cache.delete(id);cache.set(id,length);while(cache.size>maxEntries)cache.delete(cache.keys().next().value);};
 const pause=duration=>{pausedUntil=Date.now()+duration;clearTimeout(wakeTimer);wakeTimer=setTimeout(()=>{wakeTimer=undefined;pausedUntil=0;update();},duration);};
 const draw=()=>{if(disposed)return;const features=[];for(const [id,f] of desired){const length=cache.get(id);if(!(length>0))continue;const coordinates=platformAnchor(f);if(coordinates)features.push({type:'Feature',id,geometry:{type:'Point',coordinates},properties:{id:`way-${id}`,osm_type:'way',osm_id:id,feature:'platform_edge',ref:f.properties?.ref||'',platform_length:length}});}const data={type:'FeatureCollection',features},signature=JSON.stringify(data),source=map.getSource('platformLengths');if(source&&(source!==lastSource||signature!==lastDraw)){source.setData(data);lastDraw=signature;lastSource=source;}};
 async function next(){
  if(busy||disposed||Date.now()<pausedUntil)return;const entry=pending.entries().next().value;if(!entry)return;
  const [id,url]=entry;pending.delete(id);if(!desired.has(id)){schedule();return;}busy=true;inflight=id;controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),5000);
  try {const r=await fetcher(url,{signal:controller.signal});if(r.status===429){pause(cooldown);pending.clear();return;}if(r.status===404||r.status===410){remember(id,null);return;}if(!r.ok)throw new Error(`HTTP ${r.status}`);const data=await r.json(),length=Number(data.properties?.length);remember(id,Number.isFinite(length)&&length>0?length:null);draw();}
  catch(error){if(desired.has(id)&&!disposed)pause(retryDelay);}
  finally{clearTimeout(timeout);busy=false;inflight=undefined;schedule();}
 }
 function schedule(){if(timer||busy||disposed||!pending.size||Date.now()<pausedUntil)return;timer=setTimeout(()=>{timer=undefined;next();},delay);}
 function update(){
  if(disposed)return;desired=new Map();
  if(active()&&map.getZoom()>=19){for(const f of map.queryRenderedFeatures({layers:['platform-edges']})){const id=platformIdentity(f);if(!id)continue;const previous=desired.get(id);if(!previous||JSON.stringify(f.geometry).length>JSON.stringify(previous.geometry).length)desired.set(id,f);}}
  for(const id of pending.keys())if(!desired.has(id))pending.delete(id);
  for(const id of desired.keys())if(!cache.has(id)&&!pending.has(id)&&id!==inflight&&Date.now()>=pausedUntil)pending.set(id,PLATFORM_API+id);
  if(inflight&&!desired.has(inflight))controller?.abort();
  draw();schedule();
 }
 function destroy(){disposed=true;clearTimeout(timer);clearTimeout(wakeTimer);controller?.abort();pending.clear();}
 function enrich(feature){const id=platformIdentity(feature);if(!id)return feature;const p=feature.properties||{},length=cache.get(id);return {...feature,properties:{...p,osm_type:'way',osm_id:id,...(length>0?{platform_length:length}:{})}};}
 return {update,destroy,enrich};
}
