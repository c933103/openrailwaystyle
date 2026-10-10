// Apply compiled, calendar-aware timetable counts to existing OSM sections.
// No acquisition and no GTFS geometry is ever added to the map.
import {createHash} from 'node:crypto';
import {geometryLines} from './service-geometry.mjs';
import {drawnGeometry, serviceRoutes, wayRoutes} from './service-routes.mjs';
import {FREQUENCY_PROFILES} from '../styles/service-frequency.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('und').replace(/[\s\p{P}]/gu,'');
const reference=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('und').replace(/\s/gu,'');
const osmKind=value=>value==='light_rail'?'tram':value;
const agencyNames=agency=>{
  const name=String(agency.agency_name||''),words=name.match(/[\p{L}\p{N}]+/gu)||[];
  const initials=words.map(w=>Array.from(w)[0]).join('');
  // An ID is not an operator name. Accept a spelled-out agency's acronym
  // only when the feed itself uses exactly that acronym as its agency ID.
  return [name,...(initials.length>=3&&text(initials)===text(agency.agency_id)?[agency.agency_id]:[])].map(text).filter(Boolean);
};
const kind=type=>{const n=Number(type);return n===0||n===5||n>=900&&n<1000?'tram':n===12||n===405?'monorail':n===7||n===1400?'funicular':n===1||n>=400&&n<500?'subway':'commuter';};
const coord=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85;
const metres=(a,b)=>Math.hypot((b[0]-a[0])*111320*Math.cos((a[1]+b[1])*Math.PI/360),(b[1]-a[1])*110574);
const interpolate=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
function distance(p,a,b,span=false){
  const sx=111320*Math.cos(p[1]*Math.PI/180),dx=(b[0]-a[0])*sx,dy=(b[1]-a[1])*110574;
  const length=dx*dx+dy*dy,projection=length?((p[0]-a[0])*sx*dx+(p[1]-a[1])*110574*dy)/length:0;
  if(span&&(projection<-.000001||projection>1.000001))return Infinity;
  const t=Math.max(0,Math.min(1,projection));
  return Math.hypot((p[0]-a[0])*sx-t*dx,(p[1]-a[1])*110574-t*dy);
}
// 50 m sampling, 120 m tolerance, spatially indexed. Very long edges, polar
// paths and antimeridian jumps stay unmatched; work per edge is bounded.
const CELL=.002, cell=p=>[Math.floor(p[0]/CELL),Math.floor(p[1]/CELL)];
function spatial(edges){
  const cells=new Map();
  for(const edge of edges){
    const [a,b]=edge.geometry,n=Math.ceil(metres(a,b)/50);
    if(n>2000||!n)continue;
    const seen=new Set();
    for(let i=0;i<=n;i++)seen.add(cell(interpolate(a,b,i/n)).join(','));
    for(const key of seen){if(!cells.has(key))cells.set(key,[]);cells.get(key).push(edge);}
  }
  return (p)=>{
    const [x,y]=cell(p),rx=Math.ceil(120/(CELL*111320*Math.cos(p[1]*Math.PI/180)))+1,out=new Set();
    if(rx>8)return [];
    for(let dx=-rx;dx<=rx;dx++)for(let dy=-2;dy<=2;dy++)for(const e of cells.get(`${x+dx},${y+dy}`)||[])out.add(e);
    return [...out];
  };
}
const edges=lines=>lines.flatMap(line=>line.slice(1).map((b,i)=>({geometry:[line[i],b]}))).filter(e=>e.geometry.every(coord));
function covered(edge,lookup){
  const [a,b]=edge.geometry,n=Math.ceil(metres(a,b)/50);
  if(!n||n>2000)return false;
  for(let i=0;i<=n;i++){const p=interpolate(a,b,i/n);if(!lookup(p).some(e=>distance(p,...e.geometry)<=120))return false;}
  return true;
}
const identity=r=>({relation:r.relation,kind:r.kind,ref:r.ref,label:r.label,names:r.names,operator:r.operator,network:r.network,timetable:r.timetable});
export function sectionBinding(way,route,service,routes){
  return hash({way:way.id,lines:geometryLines(drawnGeometry(way)),route:identity(route),relations:wayRoutes(way,routes).filter(k=>service.get(k)===route).sort()});
}
function metadataMatch(osm,route,agency,source){
  if(osmKind(osm.kind)!==kind(route.route_type))return false;
  const ids=new Set([route.route_id,...(route.source_route_ids||[])]);
  // OSM GTFS IDs are meaningful only with an explicit feed namespace.
  if(osm.timetable?.feed&&osm.timetable.feed===source.id&&osm.timetable.routeIds?.some(id=>ids.has(id)))return true;
  const operators=new Set([osm.operator,osm.network,...(osm.timetable?.operators||[])].map(text).filter(Boolean));
  if(!agencyNames(agency).some(n=>operators.has(n)))return false;
  const refs=String(osm.ref||'').split(';').map(reference).filter(Boolean);
  if(reference(route.route_short_name)&&refs.length)return refs.includes(reference(route.route_short_name));
  const names=new Set([osm.label,...Object.values(osm.names||{})].map(text).filter(Boolean));
  return !!text(route.route_long_name)&&names.has(text(route.route_long_name));
}
function record(feed,route,agency,segment){
  const s=feed.source,checked=s.checked||s.retrieved;
  const until=Math.min(Date.parse(checked+'T00:00:00Z')/1000+(s.review_after_days??30)*86400,s.valid_until??Infinity,route.valid_until??Infinity,segment.valid_until??Infinity);
  const profiles={};
  for(const p of FREQUENCY_PROFILES){
    const v=segment.profiles?.[p];if(!v)continue;
    const required=segment.expected_directions;
    if(!Array.isArray(required)||!required.length||required.some(d=>d!==0&&d!==1))continue;
    const rates=[v.forward_tph,v.backward_tph];
    if(required.some(d=>typeof rates[d]!=='number'||!Number.isFinite(rates[d])||rates[d]<0))continue;
    const rate=Math.min(...required.map(d=>rates[d]));
    if(v.display_tph!==rate||!['scheduled','headway_estimate'].includes(v.quality))continue;
    profiles[p]={rate,high:rate,quality:v.quality,...(rates[0]!=null?{forward:rates[0]}:{}),...(rates[1]!=null?{backward:rates[1]}:{})};
  }
  const windows=Object.entries(feed.profiles).map(([p,w])=>`${p}: ${w.start.slice(0,5)}–${w.end.slice(0,5)}`).join('; ');
  return {properties:{frequency_id:`${s.id}:${route.route_id}`,frequency_source:s.name,frequency_url:s.terms_url,
    frequency_checked:checked,frequency_credit:s.attribution,frequency_license:s.license,frequency_date:s.service_date,
    frequency_timezone:agency.agency_timezone,frequency_until:Number.isFinite(until)?until:0,
    frequency_definition:`Agency-local reference windows (${agency.agency_timezone}): ${windows}. ${s.count_anchor||'Departure at the preceding served stop; no inferred pass times'}.`,frequency_note:s.note||''},profiles};
}
// Compare counts and their entire time context, not a route name or just AM.
const measurements=new WeakMap();
const measurement=r=>{if(!measurements.has(r))measurements.set(r,hash([r.profiles,r.properties.frequency_date,r.properties.frequency_timezone,r.properties.frequency_definition]));return measurements.get(r);};
function aligned(a,b,c,d){
  const sx=Math.cos((a[1]+b[1])*Math.PI/360),x=(b[0]-a[0])*sx,y=b[1]-a[1],u=(d[0]-c[0])*sx,v=d[1]-c[1];
  return Math.abs(x*u+y*v)>=.5*Math.hypot(x,y)*Math.hypot(u,v);
}
function select(edge,lookup){
  const [a,b]=edge.geometry,n=Math.ceil(metres(a,b)/50);if(!n||n>2000)return null;
  let selected;
  // Interior samples avoid attributing a neighbouring section solely because
  // two shape intervals share an endpoint. Endpoints still require coverage.
  if(![a,b].every(p=>lookup(p).some(e=>aligned(a,b,...e.geometry)&&distance(p,...e.geometry,true)<=120)))return null;
  for(let i=0;i<n;i++){
    const p=interpolate(a,b,(i+.5)/n),near=lookup(p).filter(e=>aligned(a,b,...e.geometry)).map(e=>({e,d:distance(p,...e.geometry,true)})).filter(v=>v.d<=120).sort((a,b)=>a.d-b.d);
    if(!near.length)return null;
    const records=near.filter(v=>v.d<=near[0].d+.5).map(v=>v.e.record);
    if(new Set(records.map(measurement)).size!==1)return null;
    const chosen=records.reduce((a,b)=>a.properties.frequency_until<=b.properties.frequency_until?a:b);
    if(selected&&measurement(selected)!==measurement(chosen))return null;
    selected=chosen;
  }
  return selected;
}

export function createTimetableMatcher(table,{now=Date.now()}={}){
  const service=serviceRoutes(table),groups=new Map(),metadata=new Map(),observations=new Map(),summaries=[];
  for(const route of new Set(service.values()))groups.set(route,{route,ways:[],lines:[]});
  for(const way of table.ways.values())for(const r of new Set(wayRoutes(way,table.routes).map(k=>service.get(k)).filter(Boolean))){const g=groups.get(r);g.ways.push(way);g.lines.push(...geometryLines(drawnGeometry(way)));}
  const file=(key,g)=>{if(!metadata.has(key))metadata.set(key,new Set());metadata.get(key).add(g);};
  for(const g of groups.values()){
    const r=g.route;
    for(const operator of new Set([r.operator,r.network,...(r.timetable?.operators||[])].map(text).filter(Boolean))){
      for(const ref of String(r.ref||'').split(';').map(reference).filter(Boolean))file(`${osmKind(r.kind)}|${operator}|ref:${ref}`,g);
      for(const name of new Set([r.label,...Object.values(r.names||{})].map(text).filter(Boolean)))file(`${osmKind(r.kind)}|${operator}|name:${name}`,g);
    }
    if(r.timetable?.feed)for(const id of r.timetable.routeIds||[])file(`gtfs|${r.timetable.feed}|${id}`,g);
  }
  function addFeed(feed){
    if(feed.schema!==1||!Array.isArray(feed.routes)||!Array.isArray(feed.agencies)||!Array.isArray(feed.segments))throw new Error('Invalid compiled timetable');
    const agencies=new Map(feed.agencies.map(a=>[a.agency_id||'single-agency',a]));
    const segments=Map.groupBy(feed.segments,s=>s.route_id),matched=new Set(),applied=new Set();
    const summary={id:feed.source.id,name:feed.source.name,source:feed.source,feedRoutes:feed.routes.length,mappedRoutes:0,routesWithProfiles:0,pathSegments:feed.segments.length,availableSegments:0,unmatchedRoutes:0,ambiguousRoutes:0};
    for(const route of feed.routes){
      const agency=agencies.get(route.agency_id||(agencies.size===1?agencies.keys().next().value:'single-agency'));if(!agency)throw new Error('Broken timetable agency');
      const sourceSegments=(segments.get(route.route_id)||[]).filter(s=>s.geometry?.length>=2&&s.geometry.every(coord));
      const keys=[...agencyNames(agency).flatMap(n=>{const prefix=`${kind(route.route_type)}|${n}|`;return [prefix+'ref:'+reference(route.route_short_name),prefix+'name:'+text(route.route_long_name)];}),...[route.route_id,...(route.source_route_ids||[])].map(id=>`gtfs|${feed.source.id}|${id}`)];
      const candidates=[...new Set(keys.flatMap(key=>[...(metadata.get(key)||[])]))].filter(g=>metadataMatch(g.route,route,agency,feed.source));
      for(const g of candidates)g.lookup ||= spatial(edges(g.lines));
      // Full supplied path coverage prevents a short common corridor from
      // certifying an unrelated service or a same-ref branch in another place.
      const pathEdges=sourceSegments.flatMap(s=>edges([s.geometry]));
      const candidatesCovered=candidates.filter(g=>pathEdges.length&&pathEdges.reduce((n,e)=>n+metres(...e.geometry),0)>=500&&pathEdges.every(e=>covered(e,g.lookup)));
      if(candidatesCovered.length!==1){summary[candidatesCovered.length?'ambiguousRoutes':'unmatchedRoutes']++;continue;}
      const group=candidatesCovered[0];matched.add(route.route_id);
      const intern=new Map();
      const indexed=sourceSegments.flatMap(s=>{
        const value=record(feed,route,agency,s),key=hash(value);if(!intern.has(key))intern.set(key,value);
        return edges([s.geometry]).map(e=>({...e,record:intern.get(key)}));
      }),lookup=spatial(indexed);
      for(const way of group.ways){
        const lines=geometryLines(drawnGeometry(way)),binding=sectionBinding(way,group.route,service,table.routes);
        for(let line=0;line<lines.length;line++)for(let edge=0;edge<lines[line].length-1;edge++){
          const result=select({geometry:lines[line].slice(edge,edge+2)},lookup);if(!result)continue;
          const key=`${way.id}:${group.route.relation}:${line}:${edge}`;
          if(!observations.has(key))observations.set(key,{way:way.id,relation:group.route.relation,line,edge,binding,values:[]});
          observations.get(key).values.push({result,source:feed.source.id,route:route.route_id,archive:feed.source.sha256,signature:feed.source.input_signature,scope:hash([agency.agency_id,[...new Set([route.route_id,...(route.source_route_ids||[])])].sort()])});
          if(result.properties.frequency_until*1000>=now&&Object.keys(result.profiles).length){applied.add(route.route_id);summary.availableSegments++;}
        }
      }
    }
    summary.mappedRoutes=matched.size;summary.routesWithProfiles=applied.size;summaries.push(summary);
  }
  function finish(){
    const rows=[],records=[],byRecord=new Map(),usedSources=new Set(),appliedBySource=new Map();let conflicts=0;
    for(const item of observations.values()){
      // Different route records in one feed may be separate services. Never
      // sum or collapse them merely because their rates happen to agree.
      const values=item.values.filter(v=>v.result.properties.frequency_until*1000>=now);
      if(!values.length)continue;
      const perSource=Map.groupBy(values,v=>v.source);
      const duplicateEvidence=values.every(v=>/^[a-f0-9]{64}$/.test(v.archive||'')&&/^[a-f0-9]{64}$/.test(v.signature||''))&&new Set(values.map(v=>hash([v.archive,v.signature,v.scope]))).size===1;
      const conflict=[...perSource.values()].some(v=>new Set(v.map(x=>x.route)).size>1)||perSource.size>1&&!duplicateEvidence||new Set(values.map(v=>measurement(v.result))).size>1;
      if(conflict){conflicts++;continue;}
      const result=structuredClone(values.reduce((a,b)=>a.result.properties.frequency_until<=b.result.properties.frequency_until?a:b).result);
      const sources=[...new Set(values.map(v=>v.source))].sort();
      result.properties.frequency_sources=sources.join(';');
      const key=hash(result);if(!byRecord.has(key)){byRecord.set(key,records.length);records.push(result);}
      rows.push({way:item.way,relation:item.relation,line:item.line,edge:item.edge,binding:item.binding,record:byRecord.get(key)});
      if(Object.keys(result.profiles).length)for(const source of sources){
        usedSources.add(source);if(!appliedBySource.has(source))appliedBySource.set(source,{routes:new Set(),sections:0});
        const stats=appliedBySource.get(source);stats.sections++;
        for(const value of values.filter(v=>v.source===source))stats.routes.add(value.route);
      }
    }
    rows.sort((a,b)=>a.way-b.way||a.relation-b.relation||a.line-b.line||a.edge-b.edge);
    return {schema:1,osm_sha256:hash([...table.routes.values()].concat([...table.ways.values()])),records,sections:rows,
      feeds:summaries.filter(s=>usedSources.has(s.id)).map(s=>({...s,routesWithProfiles:appliedBySource.get(s.id).routes.size,availableSegments:appliedBySource.get(s.id).sections})),matching:{feeds:summaries.map(({source,...s})=>({...s,routesWithProfiles:appliedBySource.get(s.id)?.routes.size||0,availableSegments:appliedBySource.get(s.id)?.sections||0})),sections:rows.length,conflictingSections:conflicts}};
  }
  return {addFeed,finish};
}
export function indexTimetableSections(artifact){
  if(artifact?.schema!==1||!Array.isArray(artifact.records)||!Array.isArray(artifact.sections))throw new Error('Invalid applied timetable artifact');
  const byWay=new Map(),seen=new Set();
  for(const record of artifact.records){
    if(!record||!record.properties||!record.profiles||!Number.isFinite(record.properties.frequency_until)||typeof record.properties.frequency_sources!=='string')throw new Error('Invalid timetable record');
    for(const [key,p] of Object.entries(record.profiles)){
      if(!FREQUENCY_PROFILES.includes(key)||!p||![p.rate,p.high].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0)||!['scheduled','headway_estimate'].includes(p.quality)||['forward','backward'].some(k=>p[k]!==undefined&&(typeof p[k]!=='number'||!Number.isFinite(p[k])||p[k]<0)))throw new Error('Invalid timetable rate');
    }
  }
  for(const row of artifact.sections){
    if(!Number.isSafeInteger(row.way)||!Number.isSafeInteger(row.relation)||!Number.isInteger(row.line)||row.line<0||!Number.isInteger(row.edge)||row.edge<0||!Number.isInteger(row.record)||!artifact.records[row.record]||! /^[a-f0-9]{64}$/.test(row.binding))throw new Error('Invalid timetable section');
    const key=`${row.way}:${row.relation}:${row.line}:${row.edge}`;if(seen.has(key))throw new Error('Duplicate timetable section');seen.add(key);
    if(!byWay.has(row.way))byWay.set(row.way,[]);byWay.get(row.way).push({...row,record:artifact.records[row.record]});
  }
  return byWay;
}

export function bindTimetableSections(table,artifact){
  const index=indexTimetableSections(artifact),service=serviceRoutes(table),bound=new Map();let staleSections=0;
  for(const [id,sections] of index){
    const way=table.ways.get(id);if(!way){staleSections+=sections.length;continue;}
    const routes=new Map(wayRoutes(way,table.routes).map(k=>service.get(k)).filter(Boolean).map(r=>[r.relation,r]));
    const pins=new Map([...routes].map(([id,r])=>[id,sectionBinding(way,r,service,table.routes)]));
    const lines=geometryLines(drawnGeometry(way)),valid=[];
    for(const row of sections){
      if(row.binding!==pins.get(row.relation)||!lines[row.line]?.[row.edge+1]){staleSections++;continue;}
      valid.push(row);
    }
    if(valid.length)bound.set(id,valid);
  }
  return {sections:bound,staleSections};
}
