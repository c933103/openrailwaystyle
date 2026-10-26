// Maintenance-only selection of railway supply lines by topology alone. A
// power line reaches a railway electricity facility when it shares a node with
// it or enters or ends on its mapped area (holes excluded). Every line in the
// same circuit as such a line is part of that supply: ways are in one circuit
// when one ends on the other (a split or a tee) and their recorded frequency
// and voltage agree, so circuits stop where lines terminate separately in
// substations or change to another system. Parallel lines that only share
// towers are not connected. No frequency, voltage, operator or name is looked
// up, so a dedicated railway network and a grid feeder are found the same way.
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
// Rounds of matching neighbouring lines fetched from lines reaching railway
// facilities. The classifier decides which of them are electrically connected.
export const CIRCUIT_ROUNDS=8;
const tokens=value=>String(value??'').split(';').map(s=>s.trim().toLowerCase()).filter(Boolean);
const match=(key,options)=>`[${JSON.stringify(key)}~${JSON.stringify(`(^|;)[[:space:]]*(${options})[[:space:]]*(;|$)`)},i]`;

export function tractionLineQuery(box) {
  if(!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||box[0]<-90||box[2]>90||box[1]<-180||box[3]>180||box[0]>=box[2]||box[1]>=box[3])throw new Error('Invalid traction-line bbox');
  // The reviewed facility selection supplies every railway energy facility in
  // the region. Only its output statement is replaced by a named set.
  const facilities=powerFacilityQuery(box);
  if(!facilities.endsWith(');out body center qt;'))throw new Error('Unexpected railway energy facility query');
  const kinds=TRACTION_LINE_KINDS.join('|'),powerLines=set=>`(${PREFIXES.map(prefix=>`way.${set}${match(prefix+'power',kinds)};`).join('')})`;
  // The proximity search runs once; tag filters then inspect only its result.
  return `${facilities.slice(0,-';out body center qt;'.length)}->.facilities;way(around.facilities:${CANDIDATE_RADIUS})->.nearFacilities;`+
    `${powerLines('nearFacilities')}->.lines;(.lines;.facilities;);out body geom qt;`;
}

const regexValue=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// Second query for a region: follow circuits from the lines that actually
// reach a facility, through neighbouring lines whose recorded frequency and
// voltage match that circuit's or are unrecorded. The values come from the
// response itself; the classifier still decides which ways are connected.
export function tractionLineFollowUp(json) {
  const {seeds}=classifyLines(json);
  const groups=new Map();
  for(const {way,circuit} of seeds){const key=JSON.stringify(circuit);if(!groups.has(key))groups.set(key,{circuit,ids:new Set()});groups.get(key).ids.add(way.element.id);}
  if(!groups.size)return null;
  const power=`[~${JSON.stringify(`^(${PREFIXES.map(regexValue).join('|')})power$`)}~${JSON.stringify(`^(${TRACTION_LINE_KINDS.join('|')})$`)}]`;
  const filters=circuit=>['frequency','voltage'].reduce((sets,key)=>circuit[key]?sets.flatMap(f=>[`${f}[!${JSON.stringify(key)}]`,`${f}${match(key,circuit[key].map(regexValue).join('|'))}`]):sets,['']);
  let body='',sets=[];
  [...groups.values()].sort((a,b)=>Math.min(...a.ids)-Math.min(...b.ids)).forEach(({circuit,ids},g)=>{
    const set=`circuit${g}`;sets.push(`.${set};`);
    body+=`way(id:${[...ids].sort((a,b)=>a-b).join(',')})->.${set};`;
    for(let round=0;round<CIRCUIT_ROUNDS;round++)body+=`node(w.${set})->.circuitNodes;way(bn.circuitNodes)->.adjacent;(.${set};${filters(circuit).map(f=>`way.adjacent${power}${f};`).join('')})->.${set};`;
  });
  return `[out:json][timeout:240][maxsize:134217728];${body}(${sets.join('')});out body geom qt;`;
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

function classifyLines(json) {
  if(json?.remark||!Array.isArray(json?.elements))throw new Error(json?.remark||'Incomplete traction-line response');
  const facilities=[],lines=[],unique=new Map();
  // A region's two responses can repeat elements; keep one of each.
  for(const element of json.elements)if(element&&Number.isSafeInteger(element.id))unique.set(`${element.type}-${element.id}`,element);
  for(const element of unique.values()) {
    if(!['node','way','relation'].includes(element?.type)||!Number.isSafeInteger(element.id))continue;
    const facility=supplyFacility(element);
    if(facility)facilities.push({...facility,tags:element.tags||{}});
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
    const reached=facilities.filter(f=>[...f.nodes].some(n=>set.has(n))||f.polygons.some(polygon=>lineMeetsPolygon(coordinates,polygon)));
    ways.push({element,tags,coordinates,nodes,ends:new Set([nodes[0],nodes.at(-1)]),reached});
  }
  // Circuits: ways meet when a shared node ends at least one of them. From each
  // line reaching a facility, follow only ways whose recorded frequency and
  // voltage agree with the circuit followed so far, starting from the values
  // the line shares with the facility. A way carrying several circuits (for
  // example frequency 50;16.7) thus passes on only the one that reached the
  // facility. Values are compared, never looked up: an unrecorded value
  // neither blocks nor narrows the circuit.
  const atNode=new Map();
  ways.forEach((way,i)=>{for(const node of new Set(way.nodes)){if(!atNode.has(node))atNode.set(node,[]);atNode.get(node).push(i);}});
  const neighbours=i=>{const out=new Set();for(const node of new Set(ways[i].nodes))for(const j of atNode.get(node))if(j!==i&&(ways[i].ends.has(node)||ways[j].ends.has(node)))out.add(j);return out;};
  const agree=(circuit,tags)=>{
    const next={};
    for(const key of ['frequency','voltage']) {
      const own=tokens(tags[key]);
      if(!circuit[key]||!own.length){next[key]=circuit[key]||(own.length?own:null);continue;}
      const shared=circuit[key].filter(v=>own.includes(v));
      if(!shared.length)return null;
      next[key]=shared;
    }
    return next;
  };
  const supplied=new Map(),seeds=[];
  for(const [start,way] of ways.entries())for(const facility of way.reached) {
    const seed=agree(agree({},facility.tags)||{},way.tags)||agree({},way.tags);
    seeds.push({way,circuit:seed});
    const queue=[[start,seed]],seen=new Set();
    while(queue.length) {
      const [i,circuit]=queue.shift(),key=`${i}|${circuit.frequency}|${circuit.voltage}`;
      if(seen.has(key))continue;
      seen.add(key);
      if(!supplied.has(i))supplied.set(i,new Set());
      supplied.get(i).add(facility.id);
      for(const j of neighbours(i)){const next=agree(circuit,ways[j].tags);if(next)queue.push([j,next]);}
    }
  }
  return {ways,supplied,seeds};
}

export function tractionLinesGeoJSON(json) {
  const {ways,supplied}=classifyLines(json);
  const features=new Map();
  ways.forEach((way,i)=>{
    const circuit=supplied.get(i);
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
