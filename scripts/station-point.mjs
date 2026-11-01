// One OSM element as a station-point record (station-overview.mjs), or null
// when it is not an operating mapped station. Kept apart from the tile code:
// a complete station generation is brought up to date with changes only
// while this conversion stays the same (stationExtraction).
const STATION_KINDS=new Set(['station','halt','tram_stop']);
const MODES=new Set(['subway','light_rail','monorail','tram','funicular','miniature','train']);
const RETIRED=new Set(['yes','true','1']);
const INVALID_LIFECYCLE=['disused','abandoned','demolished','razed','removed','construction','proposed'];

export function stationPoint(element){
 if(!element||!['node','way','relation'].includes(element.type)||!Number.isSafeInteger(element.id)||element.id<1)return null;
 const tags=element.tags;
 if(!tags||typeof tags!=='object'||Array.isArray(tags))return null;
 const rail=tags.railway;
 const isRail=STATION_KINDS.has(rail);
 const hasRailMode=['train','subway','light_rail','tram','monorail','funicular'].some(k=>tags[k]==='yes');
 if(!isRail && !(tags.public_transport==='station'&&hasRailMode))return null;
 // A historical or future mapped station is not an operating-station dot.
 // An active railway=station may carry a proposed:railway or
 // abandoned:railway tag describing *other* infrastructure. Such lifecycle
 // tags must not override the active station's directly mapped railway tag.
 if(INVALID_LIFECYCLE.some(k=>RETIRED.has(tags[k])||tags.railway===k))return null;
 const point=element.type==='node'?element:element.center;
 const lat=point?.lat,lon=point?.lon;
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat>90||lon < -180||lon>180)
   throw new Error(`Station has no valid coordinate: ${element.type}/${element.id}`);
 const kind=isRail?rail:'station';
 const mode=['subway','light_rail','monorail','tram','funicular','miniature','train']
   .find(k=>tags.station===k||tags[k]==='yes')|| (kind==='tram_stop'?'tram':'train');
 const text=v=>typeof v==='string'?Array.from(v).slice(0,256).join(''):'';
 const version=Number.isSafeInteger(element.version)&&element.version>=1?element.version:null;
 const updated=typeof element.timestamp==='string'&&Number.isFinite(Date.parse(element.timestamp))
   ?element.timestamp:null;
 return {id:`${element.type}-${element.id}`,osm_type:element.type,osm_id:element.id,
   lon,lat,feature:kind,station:MODES.has(mode)?mode:'train',name:text(tags.name||tags['name:en']),
   state:'present',osm_version:version,osm_timestamp:updated};
}
