// Maintenance-only selection of railway traction power lines. A line belongs
// to the railway supply when its recorded frequency is a traction frequency,
// or when its mapped geometry actually reaches a railway electricity facility:
// it shares a node with the facility, or a vertex lies inside the facility's
// area. Passing nearby is not a connection, and an operator name, voltage or
// a track running alongside never establishes railway use.
import {powerFacility,tractionFrequency} from '../styles/power-facilities.mjs';
import {powerFacilityQuery} from './power-facility-data.mjs';
import {hanRegion,chineseArea} from '../styles/han-region.mjs';

const STATES=['construction','proposed','disused','abandoned','razed','demolished','removed'];
const PREFIXES=['',...STATES.map(state=>`${state}:`)];
export const TRACTION_LINE_KINDS=Object.freeze(['line','minor_line','cable']);
// Conductors inside a substation are equipment, not supply lines.
const INTERNAL=new Set(['bay','busbar']);
// Electricity facilities a supply line can feed. Auxiliary sockets and train
// preheating points are not part of the traction supply network.
const SUPPLY_KINDS=new Set(['substation','plant','generator','converter','transformer','feeder']);
const CANDIDATE_RADIUS=30;
const FREQUENCY='16\\.(7|67|66[67]?)';
const tokens=value=>String(value??'').split(';').map(s=>s.trim().toLowerCase()).filter(Boolean);
const match=(key,options)=>`[${JSON.stringify(key)}~${JSON.stringify(`(^|;)[[:space:]]*(${options})[[:space:]]*(;|$)`)},i]`;

export function tractionLineQuery(box) {
  if(!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||box[0]<-90||box[2]>90||box[1]<-180||box[3]>180||box[0]>=box[2]||box[1]>=box[3])throw new Error('Invalid traction-line bbox');
  // The reviewed facility selection supplies every railway energy facility in
  // the region. Only its output statement is replaced by a named set.
  const facilities=powerFacilityQuery(box);
  if(!facilities.endsWith(');out body center qt;'))throw new Error('Unexpected railway energy facility query');
  const lines=TRACTION_LINE_KINDS.join('|'),selected=[];
  // The proximity search runs once; tag filters then inspect only its result.
  for(const prefix of PREFIXES)selected.push(`way.frequencyHints${match(prefix+'power',lines)};`,`way.nearFacilities${match(prefix+'power',lines)};`);
  return `${facilities.slice(0,-';out body center qt;'.length)}->.facilities;way(around.facilities:${CANDIDATE_RADIUS})->.nearFacilities;`+
    `way(${box.join(',')})${match('frequency',FREQUENCY)}->.frequencyHints;(${selected.join('')})->.lines;(.lines;.facilities;);out body geom qt;`;
}

// A line crossing a region boundary can reach facilities in each region it
// is returned from. Combine that evidence so the result does not depend on
// region order.
export function mergeTractionLine(previous,next) {
  const union=key=>[...new Set([previous,next].flatMap(f=>String(f.properties[key]??'').split(';').filter(Boolean)))];
  const basis=union('traction_basis'),reached=union('traction_facilities').sort();
  const properties={...next.properties};delete properties.traction_facilities;
  return {...next,properties:{...properties,traction_basis:['frequency','facility'].filter(value=>basis.includes(value)).join(';'),...(reached.length?{traction_facilities:reached.join(';')}:{})}};
}

function lifecycle(tags,key) {
  for(const prefix of PREFIXES) {
    const value=tokens(tags[prefix+key]);
    if(value.length)return {value,state:prefix?prefix.slice(0,-1):STATES.find(state=>tags[state]==='yes')||'present'};
  }
  return {value:[],state:'present'};
}
const validPoint=p=>Number.isFinite(p?.lon)&&Number.isFinite(p?.lat)&&Math.abs(p.lon)<=180&&Math.abs(p.lat)<=90;

// Join relation member ways into closed rings by shared end coordinates.
function rings(members) {
  const open=members.filter(m=>m.type==='way'&&m.role!=='inner'&&m.geometry?.length>=2&&m.geometry.every(validPoint)).map(m=>m.geometry.map(p=>[p.lon,p.lat]));
  const closed=[],same=(a,b)=>a[0]===b[0]&&a[1]===b[1];
  while(open.length) {
    let ring=open.shift();
    for(let joined=true;joined&&!same(ring[0],ring.at(-1));) {
      joined=false;
      for(let i=0;i<open.length;i++) {
        const part=open[i],end=ring.at(-1);
        const next=same(part[0],end)?part:same(part.at(-1),end)?[...part].reverse():null;
        if(next){ring=[...ring,...next.slice(1)];open.splice(i,1);joined=true;break;}
      }
    }
    if(ring.length>=4&&same(ring[0],ring.at(-1)))closed.push(ring);
  }
  return closed;
}
function inside([x,y],ring) {
  let result=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i],[xj,yj]=ring[j];
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)result=!result;
  }
  return result;
}
const bounds=points=>points.reduce((b,[x,y])=>[Math.min(b[0],x),Math.min(b[1],y),Math.max(b[2],x),Math.max(b[3],y)],[Infinity,Infinity,-Infinity,-Infinity]);

function supplyFacility(element) {
  const kind=powerFacility(element.tags||{})?.kind;
  if(!SUPPLY_KINDS.has(kind))return null;
  const id=`${element.type}-${element.id}`;
  if(element.type==='node')return {id,nodes:new Set([element.id]),rings:[]};
  if(element.type==='way') {
    const points=(element.geometry||[]).filter(validPoint).map(p=>[p.lon,p.lat]);
    const closed=points.length>=4&&points[0][0]===points.at(-1)[0]&&points[0][1]===points.at(-1)[1];
    return {id,nodes:new Set(element.nodes||[]),rings:closed?[points]:[]};
  }
  if(element.type==='relation')return {id,nodes:new Set(),rings:rings(element.members||[])};
  return null;
}

export function tractionLinesGeoJSON(json) {
  if(json?.remark||!Array.isArray(json?.elements))throw new Error(json?.remark||'Incomplete traction-line response');
  const facilities=[],lines=[];
  for(const element of json.elements) {
    if(!['node','way','relation'].includes(element?.type)||!Number.isSafeInteger(element.id))continue;
    const facility=supplyFacility(element);
    if(facility){facility.boxes=facility.rings.map(bounds);facilities.push(facility);}
    if(element.type==='way'&&lifecycle(element.tags||{},'power').value.some(v=>TRACTION_LINE_KINDS.includes(v)))lines.push(element);
  }
  const features=new Map();
  for(const element of lines) {
    const tags=element.tags||{};
    if(tokens(tags.line).some(v=>INTERNAL.has(v)))continue;
    const power=lifecycle(tags,'power');
    const coordinates=element.geometry?.map(p=>[p.lon,p.lat]);
    if(!coordinates||coordinates.length<2||!element.geometry.every(validPoint))throw new Error(`Incomplete geometry for traction line way-${element.id}`);
    const nodes=new Set(element.nodes||[]),[minX,minY,maxX,maxY]=bounds(coordinates);
    const reached=facilities.filter(f=>[...f.nodes].some(n=>nodes.has(n))||f.rings.some((ring,i)=>{
      const b=f.boxes[i];
      return b[0]<=maxX&&b[2]>=minX&&b[1]<=maxY&&b[3]>=minY&&coordinates.some(p=>inside(p,ring));
    })).map(f=>f.id).sort();
    const frequency=tractionFrequency(tags.frequency);
    if(!frequency&&!reached.length)continue;
    const kind=power.value.find(v=>TRACTION_LINE_KINDS.includes(v)),centre=coordinates[Math.floor(coordinates.length/2)],atlas_han=hanRegion(...centre);
    const id=`way-${element.id}`;
    features.set(id,{type:'Feature',id,geometry:{type:'LineString',coordinates},properties:{...tags,
      atlas_han,atlas_zh:atlas_han==='cjkv'?chineseArea(...centre):'',osm_type:'way',osm_id:String(element.id),
      power_line_kind:kind,power_state:power.state,
      traction_basis:[frequency&&'frequency',reached.length&&'facility'].filter(Boolean).join(';'),
      ...(reached.length?{traction_facilities:reached.join(';')}:{})}});
  }
  return {type:'FeatureCollection',features:[...features.values()].sort((a,b)=>a.id.localeCompare(b.id))};
}
