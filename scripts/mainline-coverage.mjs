import {createHash} from 'node:crypto';
export const MAINLINE_REGIONS=Object.freeze(['africa','antarctica','asia','australia-oceania',
 'central-america','europe','north-america','south-america']);
// Acceptance controls are viewports, never guessed track geometry or OSM IDs.
export const MAINLINE_CONTROLS=Object.freeze([
 ['China–Beijing',116.4,39.9],['China–Wuhan',114.3,30.6],['Japan–Tokyo',139.75,35.68],
 ['South Korea–Seoul',126.97,37.56],['Taiwan–Taipei',121.52,25.05],['India–Mumbai',72.88,19.07],
 ['Russia–Moscow',37.6,55.75],['United States–Chicago',-87.63,41.88],['Canada–Toronto',-79.38,43.65],
 ['United Kingdom–London',-.12,51.51],['France–Paris',2.35,48.86],['Spain–Madrid',-3.7,40.42],
 ['Germany–Berlin',13.4,52.52],['Italy–Milan',9.19,45.46],['Poland–Warsaw',21.01,52.23],
 ['Alpine crossing',8.97,46.55],['Africa–Cape Town',18.42,-33.92],
 ['Oceania–Sydney',151.2,-33.87],['South America–São Paulo',-46.63,-23.55],
 ['Sparse Australia–Kalgoorlie',121.47,-30.75],
].map(([name,lon,lat])=>({name,box:[lon-.4,lat-.3,lon+.4,lat+.3],center:[lon,lat]})));
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateMainlineSources(sources){
 if(!Array.isArray(sources)||sources.length!==MAINLINE_REGIONS.length)throw Error('Missing worldwide reference sources');
 const found=new Set(),dates=new Set(),timestamps=[];
 for(const s of sources){
  if(!s||s.schema!==1||s.complete!==true||!MAINLINE_REGIONS.includes(s.region)||found.has(s.region)||
    !/^\d{4}-\d{2}-\d{2}$/.test(s.date)||s.license!=='ODbL-1.0'||
    !/^[a-f0-9]{64}$/.test(s.pbfSha256)||!/^[a-f0-9]{64}$/.test(s.exportSha256)||
    !Number.isSafeInteger(s.pbfBytes)||s.pbfBytes<1||s.pbfBytes>48*1024**3||
    !Number.isSafeInteger(s.exportBytes)||s.exportBytes<1||s.exportBytes>1024**3)
    throw Error('Invalid, duplicate or oversized continent source');
  const url=new URL(s.url);
  if(url.href!==`https://download.geofabrik.de/${s.region}-${s.date.slice(2).replaceAll('-','')}.osm.pbf`)
    throw Error('Unpermitted reference acquisition origin');
  const timestamp=Date.parse(s.sourceTimestamp);
  if(!Number.isFinite(timestamp)||Math.abs(timestamp-Date.parse(s.date+'T00:00:00Z'))>2*86400000)
    throw Error('Invalid source timestamp');
  found.add(s.region);dates.add(s.date);timestamps.push(timestamp);
 }
 if(dates.size!==1||Math.max(...timestamps)-Math.min(...timestamps)>3600000)
   throw Error('Reference sources do not describe the same dated OSM generation');
 if(sources.reduce((n,s)=>n+s.pbfBytes,0)>144*1024**3)throw Error('Worldwide download budget exceeded');
 return true;
}
// Segment/rectangle intersection; a whole-way bounding box is insufficient.
export function segmentInBox(a,b,[w,s,e,n]){
 let lo=0,hi=1;const dx=b[0]-a[0],dy=b[1]-a[1];
 for(const [p,q] of [[-dx,a[0]-w],[dx,e-a[0]],[-dy,a[1]-s],[dy,n-a[1]]]){
  if(p===0){if(q<0)return false;continue}
  const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
  if(lo>hi)return false;
 }
 return true;
}
export function featureInBox(f,box){
 if(f.bbox&&(f.bbox[2]<box[0]||f.bbox[0]>box[2]||f.bbox[3]<box[1]||f.bbox[1]>box[3]))return false;
 const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;
 for(const points of lines)for(let i=1;i<points.length;i++)if(segmentInBox(points[i-1],points[i],box))return true;
 return false;
}
export function auditMainlineCoverage(features){
 return MAINLINE_CONTROLS.map(c=>{
  const candidates=features.filter(f=>f.properties.classification!=='branch'&&featureInBox(f,c.box));
  if(!candidates.length)throw Error(`Missing actual OSM mainline geometry: ${c.name}`);
  // Choose actual mapped geometry inside each viewport. Source ID/version
  // and full coordinates remain inspectable in the published audit.
  candidates.sort((a,b)=>a.properties.rank-b.properties.rank||
    (b.geometry.coordinates.length-a.geometry.coordinates.length)||a.id-b.id);
  return {...c,wayCount:candidates.length,feature:candidates[0]};
 });
}
