// Extract-only energy context. Tags establish the supply domain; geometry
// establishes a separate rail relationship, never actual supply availability.
import {tractionCircuitEvidence} from './energy-circuit-evidence.mjs';
import {HYDROGEN_FUEL_KEYS} from './energy-fuel-tags.mjs';
import {areaPolygons, lineMeetsPolygon, inside, validPoint, bounds} from './osm-geometry.mjs';
const states=['construction','proposed','disused','abandoned','razed','demolished','removed'];
const prefixes=['',...states.map(s=>s+':')];
const values=v=>String(v??'').split(';').map(s=>s.trim().toLowerCase()).filter(Boolean);
const first=(tags,key,allowed)=>values(tags[key]).find(v=>allowed.includes(v));
const fuels=['oil','fuel','diesel','gas_oil','fuel_oil','petroleum','crude_oil','gas','natural_gas','lng','cng','lpg','biodiesel','hvo','biofuel'];
const supplies={fuel:['fuel',11],coaling_facility:['coal',11],water_crane:['water',12],water_trough:['water',12],water_tank:['water',11],water_tower:['water',11],insulator:['electricity',14],ash_pit:['coal',13],sand_store:['servicing',13],charging_station:['battery',11],preheating:['electricity',12],feeder:['electricity',14],frequency_converter:['electricity',8],loading_rack:['servicing',11]};
export function energyNetworkKind(tags={}) {
  for(const prefix of prefixes) {
    const t=Object.fromEntries(Object.entries(tags).filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key.slice(prefix.length),value]));
    if(prefix)for(const key of ['voltage','frequency','substation','generator:source','substance','content','usage','resource','fuel',...HYDROGEN_FUEL_KEYS])if(t[key]===undefined&&tags[key]!==undefined)t[key]=tags[key];
    const state=prefix.slice(0,-1)||states.find(s=>tags[s]==='yes')||'present';
    const hasHydrogen=HYDROGEN_FUEL_KEYS.some(key=>values(t[key]).length===1&&values(t[key])[0]==='yes');
    const rail=first(t,'railway',Object.keys(supplies));
    if(rail){const [domain,minzoom]=supplies[rail];const hydrogen=rail==='fuel'&&(first(t,'fuel',['hydrogen'])||hasHydrogen);return {kind:rail,domain:hydrogen?'hydrogen':domain,minzoom,state,trackside:rail!=='loading_rack'};}
    if(t.railway==='signal'&&values(t['railway:signal:electricity']).some(v=>v!=='no'&&v!=='none'))return {kind:'electricity_signal',domain:'electricity',minzoom:14,state,trackside:true};
    const power=first(t,'power',['line','minor_line','cable','plant','generator','substation','converter','frequency_converter','transformer']);
    if(power) {
      const voltage=Math.max(0,...values(t.voltage).filter(v=>/^\d+$/.test(v)).map(Number));
      const railwayFrequency=values(t.frequency).find(v=>['16.6','16.7','25'].includes(v));
      const minzoom=power==='line'?(railwayFrequency||values(t.usage).some(v=>['traction','railway'].includes(v))||voltage>=380000?5:voltage>=220000?6:voltage>=110000?7:9):({minor_line:12,cable:8,plant:9,generator:11,substation:9,converter:8,frequency_converter:8,transformer:13})[power];
      const storage=first(t,'substation',['storage'])||first(t,'generator:source',['battery']);
      return {voltage,usage:t.usage,railwayFrequency,kind:storage?'battery_storage':power,domain:storage?'battery':'electricity',minzoom:storage?10:minzoom,state};
    }
    const coal=first(t,'resource',['coal','coke','lignite','anthracite']);
    if(t.man_made==='goods_conveyor'&&coal)return {kind:'coal_conveyor',domain:'coal',minzoom:12,state};
    if(t.man_made==='petroleum_well')return {kind:'petroleum_well',domain:'fuel',minzoom:12,state};
    const substance=first(t,'substance',['hydrogen','water','steam',...fuels])||first(t,'content',['hydrogen','water','steam','coal','coke',...fuels]);
    if(t.man_made==='pipeline'&&substance)return {kind:'pipeline',domain:substance==='hydrogen'?'hydrogen':['water','steam'].includes(substance)?'water':'fuel',minzoom:substance==='hydrogen'?8:['water','steam'].includes(substance)?10:7,state,substance};
    if(['storage_tank','silo','bunker_silo'].includes(t.man_made)&&substance)return {kind:'storage',domain:substance==='hydrogen'?'hydrogen':['water','steam'].includes(substance)?'water':['coal','coke'].includes(substance)?'coal':'fuel',minzoom:['coal','coke'].includes(substance)?10:11,state,substance};
    if(t.man_made==='gasometer')return {kind:'gasometer',domain:substance==='hydrogen'?'hydrogen':'fuel',minzoom:11,state,substance};
    if(t.man_made==='pumping_station')return {kind:'pumping_station',domain:substance==='hydrogen'?'hydrogen':['water','steam'].includes(substance)?'water':fuels.includes(substance)?'fuel':'unknown',minzoom:11,state,substance};
    if(['water_works','water_tower','water_tank'].includes(t.man_made))return {kind:t.man_made,domain:'water',minzoom:11,state};
    if(first(t,'industrial',['hydrogen','hydrogen_plant','electrolysis']))return {kind:'hydrogen_plant',domain:'hydrogen',minzoom:9,state};
    if(first(t,'industrial',['refinery','oil','fuel_depot','oil_depot','gas','natural_gas','lng','oil_field','gas_field']))return {kind:t.industrial,domain:'fuel',minzoom:['refinery','oil'].includes(t.industrial)?8:9,state};
    if(first(t,'industrial',['coal','coal_yard','coking_plant','coal_washery','coal_processing']))return {kind:t.industrial,domain:'coal',minzoom:10,state};
  }
  // A material descriptor never outranks an explicit lifecycle feature type.
  for(const prefix of prefixes){const resource=values(tags[prefix+'resource']);const state=prefix.slice(0,-1)||states.find(s=>tags[s]==='yes')||'present';
    if(resource.some(v=>['oil','gas','natural_gas','petroleum'].includes(v)))return {kind:'fuel_extraction',domain:'fuel',minzoom:9,state};
    if(resource.some(v=>['coal','lignite','anthracite'].includes(v)))return {kind:'coal_extraction',domain:'coal',minzoom:9,state};
  }
  return null;
}
// Current site evidence excludes planned, removed and inactive track states.
export const isNetworkTrack=({type,tags={}})=>type==='way'&&!states.some(state=>tags[state]==='yes')&&Boolean(first(tags,'railway',['rail','narrow_gauge','light_rail','tram','subway','monorail','funicular']));
export const isEnergyNetworkElement=e=>Boolean(energyNetworkKind(e.tags))||isNetworkTrack(e);
const coords=e=>(e.geometry||[]).map(p=>[p.lon,p.lat]);
const linearNetwork=e=>e.tags?.area==='no'||['line','minor_line','cable','pipeline','coal_conveyor'].includes(energyNetworkKind(e.tags)?.kind);
const networkPolygons=e=>linearNetwork(e)||e.type==='relation'&&e.tags?.type!=='multipolygon'?[]:areaPolygons(e);
function siteMemberGeometry(member) {
  const tags=member.tags||{};
  const explicitArea=tags.area!=='no'&&(tags.area==='yes'||tags.building&&tags.building!=='no'||['plant','substation'].includes(tags.power));
  if(member.type==='way'&&!explicitArea){
    if(!member.geometry||member.geometry.length<2||!member.geometry.every(validPoint))throw new Error(`Incomplete energy site way ${member.ref??member.id}`);
    return {type:'LineString',coordinates:coords(member)};
  }
  return geometry({...member,id:member.ref??member.id});
}
function geometry(e) {
  if(e.type==='relation'&&e.tags?.type==='site'){
    if(!e.members?.length)throw new Error(`Empty energy site ${e.id}`);
    return {type:'GeometryCollection',geometries:e.members.map(siteMemberGeometry)};
  }
  if(e.type==='relation'&&(e.tags?.type!=='multipolygon'||linearNetwork(e))) {
    const lines=(e.members||[]).filter(m=>m.type==='way').map(m=>m.geometry);
    if(!lines.length||lines.some(line=>!line||line.length<2||!line.every(validPoint)))throw new Error(`Incomplete energy relation ${e.id}`);
    return {type:'MultiLineString',coordinates:lines.map(line=>line.map(p=>[p.lon,p.lat]))};
  }
  if(e.type==='node'){if(!validPoint(e))throw new Error(`Invalid energy node ${e.id}`);return {type:'Point',coordinates:[e.lon,e.lat]};}
  if(e.type==='relation'||e.type==='way'&&!linearNetwork(e)&&e.geometry?.length>=4&&e.geometry[0].lon===e.geometry.at(-1).lon&&e.geometry[0].lat===e.geometry.at(-1).lat) {
    const polygons=areaPolygons(e);
    if(e.type==='relation') {
      const members=(e.members||[]).filter(m=>m.type==='way');
      const segments=members.reduce((n,m)=>n+(m.geometry?.length||0)-1,0);
      const joined=polygons.reduce((n,p)=>n+p.outer.length-1+p.inners.reduce((n,r)=>n+r.length-1,0),0);
      if(members.some(m=>!m.geometry?.every(validPoint))||segments!==joined)throw new Error(`Incomplete energy relation ${e.id}`);
    }
    if(polygons.some(p=>p.box[2]-p.box[0]>180))throw new Error(`Energy polygon crosses dateline: ${e.type}-${e.id}`);
    if(!polygons.length)throw new Error(`Incomplete energy polygon ${e.type}-${e.id}`);
    return polygons.length===1?{type:'Polygon',coordinates:[polygons[0].outer,...polygons[0].inners]}:{type:'MultiPolygon',coordinates:polygons.map(p=>[p.outer,...p.inners])};
  }
  if(!e.geometry||e.geometry.length<2||!e.geometry.every(validPoint))throw new Error(`Incomplete energy line ${e.id}`);
  return {type:'LineString',coordinates:coords(e)};
}
// Local metric projection is used only for the explicit 35 m adjacency
// threshold. Longitude wraps at the dateline and scale follows site latitude.
const project=(p,origin)=>{let dx=p[0]-origin[0];dx=((dx+540)%360)-180;return [dx*111195*Math.cos(origin[1]*Math.PI/180),(p[1]-origin[1])*111195];};
const pointSegment=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
export function railRelationship(element,tracks,{adjacencyMetres=35}={}) {
  const polygons=networkPolygons(element);
  if(polygons.some(p=>p.box[2]-p.box[0]>180))return {supply_tier:'civil_network',rail_served:false,siding_evidence:'Dateline relationship unverified'};
  if(!polygons.length)return {supply_tier:'civil_network',rail_served:false,siding_evidence:'Not recorded'};
  // Longitude discontinuities are not planar segments across the whole world.
  // Keep ordinary runs, but record nearby dateline edges as unverified.
  const crossings=[];
  tracks=tracks.flatMap(track=>{
    const runs=[];let run=[];
    for(const point of track.line){
      if(run.length&&Math.abs(point[0]-run.at(-1)[0])>180){crossings.push([run.at(-1),point]);if(run.length>1)runs.push({...track,line:run});run=[];}
      run.push(point);
    }
    if(run.length>1)runs.push({...track,line:run});
    return runs;
  });
  const datelineUnverified=crossings.some(([a,b])=>polygons.some(({box:[w,s,e,n]})=>Math.max(a[1],b[1])>=s&&Math.min(a[1],b[1])<=n&&(e>=Math.max(a[0],b[0])||w<=Math.min(a[0],b[0]))));
  for(const track of tracks)for(const polygon of polygons)if(lineMeetsPolygon(track.line,polygon))return {supply_tier:'rail_served',rail_served:true,siding_evidence:'Track intersects mapped site',rail_sidings:track.id};
  for(const track of tracks)for(const polygon of polygons) {
    // A track wholly within a hole is outside the site's mapped area.
    if(polygon.inners.some(hole=>track.line.every(p=>inside(p,hole))))continue;
    const origin=polygon.outer[0],ring=polygon.outer.map(p=>project(p,origin)),line=track.line.map(p=>project(p,origin));
    for(let i=1;i<line.length;i++)for(let j=1;j<ring.length;j++)if(Math.min(pointSegment(line[i-1],ring[j-1],ring[j]),pointSegment(line[i],ring[j-1],ring[j]),pointSegment(ring[j-1],line[i-1],line[i]),pointSegment(ring[j],line[i-1],line[i]))<=adjacencyMetres)
      return {supply_tier:'rail_served',rail_served:true,siding_evidence:`Track within ${adjacencyMetres} m; connection unverified`,rail_sidings:track.id};
  }
  return {supply_tier:'civil_network',rail_served:false,siding_evidence:datelineUnverified?'Dateline crossing relationship unverified':'Not recorded'};
}
// Small spatial bins avoid comparing every worldwide site with every track.
const longitudeBin=x=>((x+1800)%3600+3600)%3600-1800;
function trackIndex(tracks) {
  const bins=new Map(),wide=[];
  for(const track of tracks){
    const [w,s,e,n]=bounds(track.line),box=[Math.floor(w*10),Math.floor(s*10),Math.floor(e*10),Math.floor(n*10)];
    if((box[2]-box[0]+1)*(box[3]-box[1]+1)>1000){wide.push(track);continue;}
    for(let x=box[0];x<=box[2];x++)for(let y=box[1];y<=box[3];y++){const key=`${longitudeBin(x)}/${y}`;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(track);}
  }
  return element=>{
    const polygons=networkPolygons(element);
  if(polygons.some(p=>p.box[2]-p.box[0]>180))return {supply_tier:'civil_network',rail_served:false,siding_evidence:'Dateline relationship unverified'};
  if(!polygons.length)return [];
    const [w,s,e,n]=bounds(polygons.flatMap(p=>p.outer));
    const dy=35/111195,dx=Math.min(180,dy/Math.max(Number.EPSILON,Math.cos(Math.max(Math.abs(s),Math.abs(n))*Math.PI/180)));
    const box=[Math.floor((w-dx)*10),Math.floor((s-dy)*10),Math.floor((e+dx)*10),Math.floor((n+dy)*10)];
    if((box[2]-box[0]+1)*(box[3]-box[1]+1)>1000)return tracks;
    const found=new Set(wide);
    for(let x=box[0];x<=box[2];x++)for(let y=box[1];y<=box[3];y++)for(const track of bins.get(`${longitudeBin(x)}/${y}`)||[])found.add(track);
    return [...found];
  };
}
export function energyNetworkGeoJSON(elements) {
  const tracks=elements.filter(isNetworkTrack).map(e=>{if(!e.geometry||e.geometry.length<2||!e.geometry.every(validPoint))throw new Error(`Incomplete track ${e.id}`);return {id:`way-${e.id}`,line:coords(e)};});
  const nearbyTracks=trackIndex(tracks);
  const circuits=tractionCircuitEvidence(elements);
  const racks=elements.filter(e=>{const kind=energyNetworkKind(e.tags);return kind?.kind==='loading_rack'&&kind.state==='present';}).flatMap(e=>{const line=e.type==='node'&&validPoint(e)?[[e.lon,e.lat],[e.lon,e.lat]]:coords(e);return line.length>=2?[{id:`${e.type}-${e.id}`,line}]:[];});
  const nearbyRacks=trackIndex(racks);
  const features=[];
  for(const e of elements) {
    const kind=energyNetworkKind(e.tags);if(!kind)continue;
    const traction=values(kind.usage).find(v=>['traction','railway'].includes(v));
    const circuit=circuits.get(`${e.type}-${e.id}`);
    const tractionBasis=traction?`usage=${traction}`:kind.railwayFrequency?`Mapped frequency=${kind.railwayFrequency} Hz`:undefined;
    const lineStyle=['line','minor_line','cable'].includes(kind.kind)?(tractionBasis?'traction':kind.kind==='cable'?'cable':'grid'):kind.kind==='pipeline'?kind.domain:kind.kind==='coal_conveyor'?'coal':'other';
    let relationship=kind.trackside?{supply_tier:'trackside',rail_served:true,siding_evidence:'Explicit railway servicing tag'}:railRelationship(e,nearbyTracks(e));
    if(!relationship.rail_served){const rack=railRelationship(e,nearbyRacks(e),{adjacencyMetres:0});if(rack.rail_served)relationship={...rack,siding_evidence:'Mapped railway loading rack intersects site; supply connection unverified'};}
    const minzoom=kind.kind==='plant'&&relationship.rail_served?6:kind.minzoom;
    features.push({type:'Feature',id:`${e.type}-${e.id}`,geometry:geometry(e),properties:{...e.tags,osm_type:e.type,osm_id:String(e.id),energy_kind:kind.kind,energy_domain:kind.domain,energy_minzoom:minzoom,energy_voltage:kind.voltage||0,energy_line_style:lineStyle,...(tractionBasis?{traction_basis:tractionBasis}:{}),...(circuit||{}),power_state:kind.state,...relationship,
      generation_source:e.tags?.['plant:source']||e.tags?.['generator:source']||'Not recorded',pipeline_substance:kind.substance||'Not recorded'}});
  }
  return {type:'FeatureCollection',features:features.sort((a,b)=>a.id.localeCompare(b.id))};
}
