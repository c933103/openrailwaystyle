// Supplied timetable paths become Service features. No OSM relation IDs are
// fabricated, and no line is drawn merely between station coordinates.
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {profileBundle} from '../styles/service-frequency.mjs';
import {joinLines} from './service-routes.mjs';
const round=n=>Math.round(n*1e6)/1e6;
const kind=type=>[12,405].includes(Number(type))?'monorail':[7,1400].includes(Number(type))?'funicular':[0,5].includes(Number(type))||(Number(type)>=900&&Number(type)<1000)?'tram':Number(type)===1||(Number(type)>=400&&Number(type)<500)?'subway':'rail';
export async function loadTimetableServices(registryPath=new URL('../styles/data-src/service-frequency-sources.json',import.meta.url)) {
  const registry=JSON.parse(await readFile(registryPath,'utf8'));
  const base=typeof registryPath==='string'?new URL(`file://${registryPath.startsWith('/')?registryPath:process.cwd()+'/'+registryPath}`):registryPath;
  const feeds=[];
  for(const entry of registry.feeds)feeds.push(JSON.parse(gunzipSync(await readFile(new URL(entry.output,base))).toString()));
  return {registry,feeds};
}
export function timetableFeatures(feeds,now=Date.now()) {
  const edges=new Map(),summary=[];
  for(const feed of feeds){
    const source=feed.source,agencies=new Map(feed.agencies.map(a=>[a.agency_id||'single-agency',a])),routes=new Map(feed.routes.map(r=>[r.route_id,r]));
    const checked=source.checked||source.retrieved, review=Date.parse(`${checked}T00:00:00Z`)+(source.review_after_days||30)*86400000;
    const end=source.feed_info.feed_end_date;
    // A reference day represents this feed version only through its validity
    // and review interval. Local expiry is compiled by the importer.
    const feedUntil=Math.min(review/1000,source.valid_until||Infinity);
    let available=0;const mapped=new Set(),known=new Set();
    for(const segment of feed.segments){
      if(!segment.geometry||segment.geometry.length<2)continue;
      const route=routes.get(segment.route_id),agency=agencies.get(segment.agency_id);
      if(!route||!agency)throw new Error(`Broken route/agency in ${source.id}`);
      const until=Math.min(feedUntil,route.valid_until??Infinity);
      const coordinates=segment.geometry.map(p=>p.map(round)),key=JSON.stringify(coordinates);
      if(!edges.has(key))edges.set(key,{coordinates,records:[]});
      const profiles=Object.fromEntries(Object.entries(segment.profiles).map(([p,v])=>[p,{rate:v.display_tph,high:v.display_tph,quality:v.quality,forward:v.forward_tph,backward:v.backward_tph}]));
      const windows=Object.entries(feed.profiles).map(([p,v])=>`${p}: ${v.start.slice(0,5)}–${v.end.slice(0,5)}`).join('; ');
      const record={properties:{id:`gtfs:${source.id}:${route.route_id}`,gtfs_route_id:route.route_id,geometry_source:source.geometry||'GTFS supplied shape',name:route.route_long_name||route.route_short_name||route.route_id,
        ref:route.route_short_name||route.route_long_name||route.route_id,colour:/^[0-9a-f]{6}$/i.test(route.route_color||'')?`#${route.route_color}`:'',kind:kind(route.route_type),network:source.name,operator:agency.agency_name,
        frequency_id:`${source.id}:${route.route_id}`,frequency_source:source.name,frequency_url:source.terms_url,frequency_checked:checked,frequency_credit:source.attribution,frequency_license:source.license,
        frequency_date:source.service_date,frequency_timezone:agency.agency_timezone,frequency_definition:`Configured weekday reference windows (${agency.agency_timezone}): ${windows}. Counts anchored at the preceding served stop.`,frequency_note:source.note||'',frequency_until:until},profiles};
      edges.get(key).records.push(record);mapped.add(route.route_id);
      if(until*1000>=now&&Object.values(profiles).some(p=>p.rate!==null)){available++;known.add(route.route_id);}
    }
    summary.push({id:source.id,name:source.name,region:source.region,source,feedRoutes:feed.routes.length,mappedRoutes:mapped.size,routesWithProfiles:known.size,pathSegments:feed.segments.length,availableSegments:available,geometryAudit:source.geometry_audit,feedEnd:end});
  }
  // Rejoin adjacent equal-property edges in service-routes after offsets have
  // been assigned. Zoom-level filtering must rebundle, just as OSM routes do.
  const make=includeLocal=>{
    const groups=new Map();
    for(const {coordinates,records} of edges.values()){
      const shown=records.filter(r=>includeLocal||!['tram','light_rail','monorail','funicular'].includes(r.properties.kind)).sort((a,b)=>a.properties.id.localeCompare(b.properties.id));
      const bundled=profileBundle(shown);
      shown.forEach((r,i)=>{
        const properties={...r.properties,...bundled[i],i,n:shown.length,slot:Math.max(-63,Math.min(63,2*i-(shown.length-1)))},key=JSON.stringify(properties);
        if(!groups.has(key))groups.set(key,{properties,lines:[]});
        groups.get(key).lines.push(coordinates);
      });
    }
    return [...groups.values()].map(({properties,lines})=>{
      const joined=joinLines(lines);
      return {type:'Feature',properties,geometry:joined.length===1?{type:'LineString',coordinates:joined[0]}:{type:'MultiLineString',coordinates:joined}};
    });
  };
  return {overview:make(false),local:make(true),summary};
}
