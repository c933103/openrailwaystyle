// Maintenance-only selection of railway supply lines by topology alone. A
// power line reaches a railway electricity facility when it shares a node with
// it or enters or ends on its mapped area (holes excluded). Every line in the
// same circuit as such a line is part of that supply: ways are in one circuit
// when one ends on the other (a split or a tee), so circuits stop where lines
// terminate separately in substations. Parallel lines that only share towers
// are not connected. No frequency, voltage, operator or name is used, so a
// dedicated railway network and a grid feeder are found the same way anywhere.
import {powerFacility} from '../styles/power-facilities.mjs';
import {powerFacilityQuery} from './power-facility-data.mjs';
import {hanRegion,chineseArea} from '../styles/han-region.mjs';
import {validPoint,areaPolygons,lineMeetsPolygon} from './osm-geometry.mjs';

const STATES=['construction','proposed','disused','abandoned','razed','demolished','removed'];
const PREFIXES=['',...STATES.map(state=>`${state}:`)];
export const TRACTION_LINE_KINDS=Object.freeze(['line','minor_line','cable']);
// Conductors inside a substation are equipment, not supply lines.
const INTERNAL=new Set(['bay','busbar']);
// Electricity facilities a supply line can feed. Auxiliary sockets and train
// preheating points are not part of the traction supply network.
const SUPPLY_KINDS=new Set(['substation','plant','generator','converter','transformer','feeder']);
const CANDIDATE_RADIUS=30;
// Rounds of neighbouring lines fetched around lines near railway facilities.
// The classifier decides which of them are electrically connected.
export const CIRCUIT_ROUNDS=6;
const tokens=value=>String(value??'').split(';').map(s=>s.trim().toLowerCase()).filter(Boolean);
const match=(key,options)=>`[${JSON.stringify(key)}~${JSON.stringify(`(^|;)[[:space:]]*(${options})[[:space:]]*(;|$)`)},i]`;

export function tractionLineQuery(box) {
  if(!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||box[0]<-90||box[2]>90||box[1]<-180||box[3]>180||box[0]>=box[2]||box[1]>=box[3])throw new Error('Invalid traction-line bbox');
  // The reviewed facility selection supplies every railway energy facility in
  // the region. Only its output statement is replaced by a named set.
  const facilities=powerFacilityQuery(box);
  if(!facilities.endsWith(');out body center qt;'))throw new Error('Unexpected railway energy facility query');
  const kinds=TRACTION_LINE_KINDS.join('|'),powerLines=set=>`(${PREFIXES.map(prefix=>`way.${set}${match(prefix+'power',kinds)};`).join('')})`;
  let rounds='';
  for(let round=0;round<CIRCUIT_ROUNDS;round++)rounds+=`node(w.lines)->.lineNodes;way(bn.lineNodes)->.adjacent;(.lines;${powerLines('adjacent')};)->.lines;`;
  // Each proximity search runs once; tag filters then inspect only its result.
  return `${facilities.slice(0,-';out body center qt;'.length)}->.facilities;way(around.facilities:${CANDIDATE_RADIUS})->.nearFacilities;`+
    `${powerLines('nearFacilities')}->.lines;${rounds}(.lines;.facilities;);out body geom qt;`;
}

// A line crossing a region boundary can reach facilities in each region it
// is returned from. Combine that evidence so the result does not depend on
// region order.
export function mergeTractionLine(previous,next) {
  const union=key=>[...new Set([previous,next].flatMap(f=>String(f.properties[key]??'').split(';').filter(Boolean)))].sort();
  const properties={...next.properties};
  return {...next,properties:{...properties,traction_basis:union('traction_basis').includes('facility')?'facility':'circuit',traction_facilities:union('traction_facilities').join(';')}};
}

function lifecycle(tags,key) {
  for(const prefix of PREFIXES) {
    const value=tokens(tags[prefix+key]);
    if(value.length)return {value,state:prefix?prefix.slice(0,-1):STATES.find(state=>tags[state]==='yes')||'present'};
  }
  return {value:[],state:'present'};
}
function supplyFacility(element) {
  const kind=powerFacility(element.tags||{})?.kind;
  if(!SUPPLY_KINDS.has(kind))return null;
  const id=`${element.type}-${element.id}`;
  if(element.type==='node')return {id,nodes:new Set([element.id]),polygons:[]};
  if(element.type==='way'||element.type==='relation')return {id,nodes:new Set(element.nodes||[]),polygons:areaPolygons(element)};
  return null;
}

export function tractionLinesGeoJSON(json) {
  if(json?.remark||!Array.isArray(json?.elements))throw new Error(json?.remark||'Incomplete traction-line response');
  const facilities=[],lines=[];
  for(const element of json.elements) {
    if(!['node','way','relation'].includes(element?.type)||!Number.isSafeInteger(element.id))continue;
    const facility=supplyFacility(element);
    if(facility)facilities.push(facility);
    if(element.type==='way'&&lifecycle(element.tags||{},'power').value.some(v=>TRACTION_LINE_KINDS.includes(v)))lines.push(element);
  }
  const ways=[];
  for(const element of lines) {
    const tags=element.tags||{};
    if(tokens(tags.line).some(v=>INTERNAL.has(v)))continue;
    const coordinates=element.geometry?.map(p=>[p.lon,p.lat]);
    if(!coordinates||coordinates.length<2||!element.geometry.every(validPoint))throw new Error(`Incomplete geometry for traction line way-${element.id}`);
    const nodes=element.nodes||[],set=new Set(nodes);
    // A shared node, or geometry entering the area: a vertex inside it (not in
    // a hole) or a segment meeting its outline, including ending on it.
    const reached=facilities.filter(f=>[...f.nodes].some(n=>set.has(n))||f.polygons.some(polygon=>lineMeetsPolygon(coordinates,polygon))).map(f=>f.id);
    ways.push({element,tags,coordinates,nodes,ends:new Set([nodes[0],nodes.at(-1)]),reached});
  }
  // Circuits: union ways that meet at a node which ends at least one of them.
  const parent=ways.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
  const atNode=new Map();
  ways.forEach((way,i)=>{for(const node of new Set(way.nodes)){if(!atNode.has(node))atNode.set(node,[]);atNode.get(node).push(i);}});
  for(const [node,list] of atNode)for(let a=0;a<list.length;a++)for(let b=a+1;b<list.length;b++)
    if(ways[list[a]].ends.has(node)||ways[list[b]].ends.has(node))parent[find(list[a])]=find(list[b]);
  const reachedBy=new Map();
  ways.forEach((way,i)=>{if(way.reached.length){const root=find(i);reachedBy.set(root,[...(reachedBy.get(root)||[]),...way.reached]);}});
  const features=new Map();
  ways.forEach((way,i)=>{
    const circuit=reachedBy.get(find(i));
    if(!circuit)return;
    const {element,tags,coordinates}=way,power=lifecycle(tags,'power');
    const kind=power.value.find(v=>TRACTION_LINE_KINDS.includes(v)),centre=coordinates[Math.floor(coordinates.length/2)],atlas_han=hanRegion(...centre);
    const id=`way-${element.id}`;
    features.set(id,{type:'Feature',id,geometry:{type:'LineString',coordinates},properties:{...tags,
      atlas_han,atlas_zh:atlas_han==='cjkv'?chineseArea(...centre):'',osm_type:'way',osm_id:String(element.id),
      power_line_kind:kind,power_state:power.state,traction_basis:way.reached.length?'facility':'circuit',
      traction_facilities:[...new Set(circuit)].sort().join(';')}});
  });
  return {type:'FeatureCollection',features:[...features.values()].sort((a,b)=>a.id.localeCompare(b.id))};
}
