// Build-time OSM station-point records and complete multizoom vector tiles.
// This module does not contact public providers or run in the browser.
// Each recognized mapped station has an independent point regardless of labels.
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import {gzipSync} from 'node:zlib';
import {bundleKey,encodeBundle} from '../styles/tile-bundles.mjs';
import '../styles/pbf-utf8.mjs';

export const STATION_ZOOM_MIN=3, STATION_ZOOM_MAX=7, STATION_BUNDLE_ZOOM=3;
export const STATION_TILE_LAYER='atlas_station_points';
export const MERCATOR_LIMIT=85.0511287798066;
const STATION_KINDS=new Set(['station','halt','tram_stop']);
const MODES=new Set(['subway','light_rail','monorail','tram','funicular','miniature','train']);
const RETIRED=new Set(['yes','true','1']);
const INVALID_LIFECYCLE=['disused','abandoned','demolished','razed','removed','construction','proposed'];
const MAX_RECORDS=750_000,MAX_TILE_BYTES=8*1024*1024;
const ZOOM_LEVELS=Array.from({length:STATION_ZOOM_MAX-STATION_ZOOM_MIN+1},(_,i)=>STATION_ZOOM_MIN+i);

export function stationPoint(element){
 if(!element||!['node','way','relation'].includes(element.type)||!Number.isSafeInteger(element.id)||element.id<1)return null;
 const tags=element.tags;
 if(!tags||typeof tags!=='object'||Array.isArray(tags))return null;
 const rail=tags.railway;
 const isRail=STATION_KINDS.has(rail);
 const hasRailMode=['train','subway','light_rail','tram','monorail','funicular'].some(k=>tags[k]==='yes');
 if(!isRail && !(tags.public_transport==='station'&&hasRailMode))return null;
 // A historical or future mapped station is not an operating-station dot.
 if(INVALID_LIFECYCLE.some(k=>RETIRED.has(tags[k])||tags.railway===k||
   typeof tags[k+':railway']==='string'))return null;
 const point=element.type==='node'?element:element.center;
 const lat=point?.lat,lon=point?.lon;
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat>90||lon < -180||lon>180)
   throw new Error(`Station has no valid coordinate: ${element.type}/${element.id}`);
 const kind=isRail?rail:'station';
 const mode=['subway','light_rail','monorail','tram','funicular','miniature','train']
   .find(k=>tags.station===k||tags[k]==='yes')|| (kind==='tram_stop'?'tram':'train');
 const text=v=>typeof v==='string'?Array.from(v).slice(0,256).join(''):'';
 return {id:`${element.type}-${element.id}`,osm_type:element.type,osm_id:element.id,
   lon,lat,feature:kind,station:MODES.has(mode)?mode:'train',name:text(tags.name||tags['name:en']),
   state:'present'};
}

export function parseStationRegion(json,{maxElements=250_000}={}){
 if(!json||typeof json!=='object'||json.remark||!Array.isArray(json.elements)||
    json.elements.length>maxElements||!Number.isSafeInteger(maxElements)||maxElements<1)
   throw new Error('Incomplete or oversized station source response');
 const stations=new Map();
 for(const source of json.elements){
   const item=stationPoint(source);
   if(!item)continue;
   const old=stations.get(item.id);
   if(old&&JSON.stringify(old)!==JSON.stringify(item))throw new Error(`Conflicting OSM station ${item.id}`);
   stations.set(item.id,item);
 }
 return [...stations.values()].sort((a,b)=>a.id.localeCompare(b.id));
}

export const mercatorLocation=(lon,lat,z)=>{
 if(!Number.isInteger(z)||z<0||z>20||!Number.isFinite(lon)||!Number.isFinite(lat)||
   Math.abs(lon)>180||Math.abs(lat)>MERCATOR_LIMIT)throw new Error('Invalid Mercator coordinate');
 const n=2**z,x=((lon+180)/360*n)%n;
 const y=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n;
 return [((x+n)%n),Math.max(0,Math.min(n-Number.EPSILON,y))];
};

export function stationOverviewData(rows,{maxRecords=MAX_RECORDS,maxTileBytes=MAX_TILE_BYTES}={}){
 if(!Array.isArray(rows)||rows.length>maxRecords||!Number.isSafeInteger(maxRecords)||maxRecords<1||
   !Number.isSafeInteger(maxTileBytes)||maxTileBytes<4096)
   throw new Error('Station source exceeds a bounded tile build');
 const seen=new Set(),features=[],polar=[];
 for(const s of rows){
   if(!s||typeof s.id!=='string'||! /^(node|way|relation)-[1-9]\d*$/.test(s.id)||
      !Number.isSafeInteger(s.osm_id)||!Number.isFinite(s.lat)||!Number.isFinite(s.lon)||
      s.lat<-90||s.lat>90||s.lon<-180||s.lon>180)
      throw new Error('Invalid station record');
   if(seen.has(s.id))throw new Error(`Duplicate station ID: ${s.id}`);
   seen.add(s.id);
   const feature={type:'Feature',id:s.osm_id,properties:{
     id:s.id,osm_type:s.osm_type,osm_id:String(s.osm_id),feature:s.feature,
     station:s.station,name:s.name,state:'present',
   },geometry:{type:'Point',coordinates:[s.lon,s.lat]}};
   (Math.abs(s.lat)>MERCATOR_LIMIT?polar:features).push(feature);
 }
 if(polar.length)throw new Error(`Cannot publish a complete station snapshot: ${polar.length} polar station(s) need native polar rendering`);
 const index=geojsonvt({type:'FeatureCollection',features},
   {maxZoom:STATION_ZOOM_MAX,indexMaxZoom:STATION_ZOOM_MIN,indexMaxPoints:0,
    tolerance:0,extent:4096,buffer:64});
 const occupied=new Set();
 // Each station appears in its own tile and, when within 64/4096 of an edge,
 // the adjacent tile. Never scan every world tile or fetch any live provider.
 for(const s of rows)for(const z of ZOOM_LEVELS){
   const [fx,fy]=mercatorLocation(s.lon,s.lat,z),x=Math.floor(fx),y=Math.floor(fy),n=2**z;
   for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
     if(Math.abs(fx-(x+dx+.5))>.5+64/4096 ||
        Math.abs(fy-(y+dy+.5))>.5+64/4096)continue;
     const ty=y+dy;
     if(ty<0||ty>=n)continue;
     occupied.add(`${z}/${(x+dx+n)%n}/${ty}`);
   }
 }
 const bundles=new Map(),bundleKeys=new Set(),tiles=new Map();
 for(const key of [...occupied].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))){
   const [z,x,y]=key.split('/').map(Number);
   const tile=index.getTile(z,x,y);
   if(!tile?.features?.length)continue;
   const encoded=vtpbf.fromGeojsonVt({[STATION_TILE_LAYER]:tile},{version:2,extent:4096});
   if(encoded.byteLength>maxTileBytes)throw new Error(`Station tile ${key} exceeds maximum bytes`);
   const parent=bundleKey(z,x,y,STATION_BUNDLE_ZOOM);
   if(!parent)throw new Error('Invalid station bundle key');
   if(!bundles.has(parent))bundles.set(parent,new Map());
   bundles.get(parent).set(key,encoded);
   bundleKeys.add(parent);
   tiles.set(key,{count:tile.features.length,bytes:encoded.length});
 }
 const archives=new Map();
 for(const [key,items] of [...bundles.entries()].sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})))
   archives.set(`${STATION_BUNDLE_ZOOM}/${key}.bundle.gz`,gzipSync(encodeBundle(items),{level:6}));
 return {archives,index:{zoom:STATION_BUNDLE_ZOOM,bundles:[...bundleKeys].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))},
   manifest:{schema:1,complete:true,minzoom:STATION_ZOOM_MIN,maxzoom:STATION_ZOOM_MAX,
     stations:rows.length,tiles:tiles.size,bundles:archives.size,polar:0,source:'OpenStreetMap',license:'ODbL-1.0'},
   tiles};
}
