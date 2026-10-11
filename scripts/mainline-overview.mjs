// Maintenance-only worldwide OSM mainline overview tiles. Neither the browser
// nor these pure helpers download third-party map tiles. A complete OSM source
// generation is required before publishing a map layer.
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {gzipSync} from 'node:zlib';
import '../styles/pbf-utf8.mjs';

export const MAINLINE_MIN_ZOOM=0,MAINLINE_MAX_ZOOM=6;
export const MAINLINE_LAYER='atlas_mainline_overview';
const TRACKS=new Set(['rail','narrow_gauge']);
const INACTIVE=['disused','abandoned','removed','razed','demolished','proposed','construction'];
const LINE_MAX_NODES=100_000,MAX_TILE_BYTES=8*1024*1024;

const text=(value,max=256)=>typeof value==='string'?Array.from(value).slice(0,max).join(''):'';
const num=value=>Number.isFinite(value)&&Math.abs(value)<=180;
const same=(a,b)=>a[0]===b[0]&&a[1]===b[1];

function splitDateline(points){
 const lines=[];let current=[points[0]];
 for(let i=1;i<points.length;i++){
   const a=points[i-1],b=points[i],jump=b[0]-a[0];
   if(Math.abs(jump)>180){
     // A shortest-arc OSM railway crossing ±180° must not be rendered as a
     // 358° route across the map. Split with identical latitude at the seam.
     const east=jump<0,edge=east?180:-180,unwrapped=b[0]+(east?360:-360);
     const f=(edge-a[0])/(unwrapped-a[0]);
     if(!(f>=0&&f<=1))throw new Error('Invalid railway anti-meridian intersection');
     const lat=a[1]+(b[1]-a[1])*f;
     current.push([edge,lat]);
     if(current.length>=2)lines.push(current);
     current=[[east?-180:180,lat],b];
   }else current.push(b);
 }
 if(current.length>=2)lines.push(current);
 return lines;
}

export function normalizeMainlineWay(element){
 if(!element||element.type!=='way'||!Number.isSafeInteger(element.id)||element.id<1)return null;
 const tags=element.tags;
 if(!tags||typeof tags!=='object'||Array.isArray(tags))return null;
 if(!TRACKS.has(tags.railway)||tags.service ||
    (tags.usage && !['main','branch',''].includes(tags.usage)) ||
    INACTIVE.some(kind=>tags[kind]==='yes'||tags.railway===kind))return null;
 if(!Array.isArray(element.geometry)||element.geometry.length<2||element.geometry.length>LINE_MAX_NODES)
   throw new Error(`Active mainline way ${element.id} missing complete bounded geometry`);
 const coordinates=element.geometry.map(p=>{
   if(!p||!num(p.lon)||!Number.isFinite(p.lat)||Math.abs(p.lat)>90)
     throw new Error(`Invalid mainline way ${element.id} coordinate`);
   return [p.lon,p.lat];
 });
 const distinct=coordinates.filter((p,i)=>i===0||!same(p,coordinates[i-1]));
 if(distinct.length<2)throw new Error(`Degenerate mainline way ${element.id}`);
 const lines=splitDateline(distinct);
 const version=element.version;
 if(!Number.isSafeInteger(version)||version<1)throw new Error(`OSM mainline ${element.id} missing version`);
 const rank=tags.highspeed==='yes'?0:tags.usage==='main'?1:tags.usage==='branch'?3:2;
 const bbox=distinct.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],
   [180,90,-180,-90]);
 return {type:'Feature',id:element.id,
   bbox,
   properties:{id:`way-${element.id}`,osm_id:String(element.id),osm_version:version,
     feature:tags.railway,usage:tags.usage||'',classification:tags.usage||'unknown',
     highspeed_tag:text(tags.highspeed),osm_timestamp:text(element.timestamp),
     start_node:Array.isArray(element.nodes)?String(element.nodes[0]):'',
     end_node:Array.isArray(element.nodes)?String(element.nodes.at(-1)):'',
     state:'present',rank,name:text(tags.name),ref:text(tags.ref)},
   geometry:lines.length===1?{type:'LineString',coordinates:lines[0]}:
     {type:'MultiLineString',coordinates:lines},
 };
}

export function mainlineRegion(json,{maxElements=200000}={}){
 if(!json||typeof json!=='object'||json.remark||!Array.isArray(json.elements)||
    !Number.isSafeInteger(maxElements)||maxElements<1||json.elements.length>maxElements)
   throw new Error('Incomplete or oversized railway region');
 const mapped=new Map();
 for(const raw of json.elements){
   const feature=normalizeMainlineWay(raw);
   if(!feature)continue;
   const key=feature.properties.id,previous=mapped.get(key);
   if(previous&&JSON.stringify(previous)!==JSON.stringify(feature))
     throw new Error(`Conflicting source mainline way ${key}`);
   mapped.set(key,feature);
 }
 return [...mapped.values()].sort((a,b)=>Number(a.id)-Number(b.id));
}

export function mainlineTiles(features,{maxWays=3000000,maxTileBytes=MAX_TILE_BYTES,allowChains=false}={}){
 if(!Array.isArray(features)||features.length>maxWays||!Number.isInteger(maxWays)||maxWays<1||
    !Number.isSafeInteger(maxTileBytes)||maxTileBytes<1024)throw new Error('Mainline build exceeds size limit');
 const seen=new Set();
 for(const f of features){
   if(!f||f.type!=='Feature'||!Number.isSafeInteger(f.id)||
      f.geometry?.type!=='LineString'&&f.geometry?.type!=='MultiLineString'||
      seen.has(f.id)||!f.properties||!(f.properties.id===`way-${f.id}`||
        allowChains&&/^chain-[a-f0-9]{13}$/.test(f.properties.id)))
     throw new Error('Invalid or duplicate mainline source way');
   seen.add(f.id);
 }
 const geo={type:'FeatureCollection',features};
 // Preserve topology/identity between z0 and z6, tolerating only geometric
 // simplification appropriate for the selected viewport. No thematic data
 // is derived from this neutral geometry.
 const tree=geojsonvt(geo,{maxZoom:MAINLINE_MAX_ZOOM,indexMaxZoom:0,
   indexMaxPoints:0,tolerance:2,extent:4096,buffer:64});
 const output=new Map(),counter={};
 for(let z=MAINLINE_MIN_ZOOM;z<=MAINLINE_MAX_ZOOM;z++){
   const n=2**z;let included=0;
   for(let x=0;x<n;x++)for(let y=0;y<n;y++){
     const tile=tree.getTile(z,x,y);
     if(!tile?.features?.length)continue;
     const encoded=vtpbf.fromGeojsonVt({[MAINLINE_LAYER]:tile},{version:2,extent:4096});
     if(encoded.byteLength>maxTileBytes)throw new Error(`Mainline tile z${z}/${x}/${y} exceeded limit`);
     const zipped=gzipSync(encoded,{level:6});
     if(zipped.length>2*1024**2)throw Error(`Compressed mainline tile z${z}/${x}/${y} exceeded limit`);
     output.set(`${z}/${x}/${y}`,zipped);
     included+=tile.features.length;
   }
   counter[z]=included;
 }
 return {tiles:output,index:{tiles:[...output.keys()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))},
   manifest:{schema:1,complete:false,minzoom:MAINLINE_MIN_ZOOM,maxzoom:MAINLINE_MAX_ZOOM,
     wayCount:features.length,tileCount:output.size,drawnFeaturesByZoom:counter,
     source:'OpenStreetMap',license:'ODbL-1.0'}};
}
