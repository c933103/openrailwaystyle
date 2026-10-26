// Maintenance-only selection of rail-served railway energy supply sites: fuel
// and coal sites whose mapped area a railway siding actually enters. The
// site's energy role comes from its own tags or from the recorded contents of
// storage inside it; the rail link comes from track geometry entering its
// area. A site next to a track, a site name, or an operator never establishes
// either. Point-mapped sites have no area to test and are not selected.
import {hanRegion,chineseArea} from '../styles/han-region.mjs';
import {areaPolygons,insidePolygon,lineMeetsPolygon,validPoint} from './osm-geometry.mjs';

const STATES=['construction','proposed','disused','abandoned','razed','demolished','removed'];
const PREFIXES=['',...STATES.map(state=>`${state}:`)];
const TRACKS='rail|narrow_gauge|light_rail';
const SIDINGS='siding|spur|yard';
// Recorded contents that are fuel for trains or the fuel chain behind them.
export const FUEL_CONTENTS=Object.freeze(['oil','fuel','diesel','gas_oil','fuel_oil','heating_oil','kerosene','jet_fuel','petrol','gasoline','petroleum','crude_oil','gas','natural_gas','lng','cng','lpg','propane','butane','hydrogen','biodiesel','hvo','biofuel','bioethanol']);
export const COAL_CONTENTS=Object.freeze(['coal','coke','lignite','anthracite']);
const FUEL_INDUSTRY=['fuel_depot','oil_depot','refinery','oil','gas','natural_gas','lng','hydrogen'];
const COAL_RESOURCE=['coal','lignite','anthracite'];
const ENERGY=[...FUEL_CONTENTS,...COAL_CONTENTS].join('|');
const tokens=value=>String(value??'').split(';').map(s=>s.trim().toLowerCase()).filter(Boolean);
const match=(key,options)=>`[${JSON.stringify(key)}~${JSON.stringify(`(^|;)[[:space:]]*(${options})[[:space:]]*(;|$)`)},i]`;

export function energySiteQuery(box) {
  if(!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||box[0]<-90||box[2]>90||box[1]<-180||box[3]>180||box[0]>=box[2]||box[1]>=box[3])throw new Error('Invalid energy-site bbox');
  const bbox=`(${box.join(',')})`,sidings=[];
  for(const prefix of PREFIXES)sidings.push(`way${bbox}${match(prefix+'railway',TRACKS)}${match('service',SIDINGS)};`,`way${bbox}${match(prefix+'railway',TRACKS)}${match('usage','industrial')};`);
  // Lifecycle values on the railway key itself (railway=disused) also count.
  sidings.push(`way${bbox}${match('railway',STATES.join('|'))}${match('service',SIDINGS)};`,`way${bbox}${match('railway',STATES.join('|'))}${match('usage','industrial')};`);
  return `[out:json][timeout:240][maxsize:134217728];(${sidings.join('')})->.sidings;`+
    // Storage recording an energy content, and the industrial areas holding it.
    `nwr${bbox}${match('man_made','storage_tank|silo|bunker_silo')}${match('content',ENERGY)}->.stores;`+
    `node(w.stores)->.storeNodes;(.storeNodes;node.stores;)->.storePoints;.storePoints is_in->.storeAreas;`+
    `area.storeAreas["landuse"="industrial"]->.holding;(way(pivot.holding);rel(pivot.holding);)->.containing;`+
    `(nwr${bbox}${match('industrial',FUEL_INDUSTRY.join('|')+'|coal')};nwr${bbox}${match('resource',COAL_RESOURCE.join('|'))};.containing;)->.candidates;`+
    // Only candidates whose outline a siding meets, and those sidings.
    `nwr.candidates(around.sidings:0)->.sites;way.sidings(around.sites:0)->.entering;`+
    `(.sites;.entering;);out body geom qt;.stores out tags center qt;`;
}

function trackState(tags) {
  for(const prefix of PREFIXES)if(tokens(tags[prefix+'railway']).some(v=>TRACKS.split('|').includes(v)))return prefix?prefix.slice(0,-1):'present';
  return STATES.find(state=>tokens(tags.railway).includes(state))||null;
}
const isSiding=tags=>trackState(tags)!==null&&(tokens(tags.service).some(v=>SIDINGS.split('|').includes(v))||tokens(tags.usage).includes('industrial'));
const pointOf=element=>element.type==='node'?[element.lon,element.lat]:element.center?[element.center.lon,element.center.lat]:null;

export function energySitesGeoJSON(json) {
  if(json?.remark||!Array.isArray(json?.elements))throw new Error(json?.remark||'Incomplete energy-site response');
  const sidings=[],stores=[],areas=[];
  for(const element of json.elements) {
    if(!['node','way','relation'].includes(element?.type)||!Number.isSafeInteger(element.id))continue;
    const tags=element.tags||{};
    if(element.type==='way'&&isSiding(tags)&&element.geometry) {
      if(element.geometry.length<2||!element.geometry.every(validPoint))throw new Error(`Incomplete geometry for siding way-${element.id}`);
      const line=element.geometry.map(p=>[p.lon,p.lat]);
      sidings.push({id:`way-${element.id}`,state:trackState(tags),line});
      continue;
    }
    const contents=tokens(tags.content).filter(v=>FUEL_CONTENTS.includes(v)||COAL_CONTENTS.includes(v));
    if(/^(storage_tank|silo|bunker_silo)$/.test(tags.man_made||'')&&contents.length&&!element.geometry&&!element.members) {
      const point=pointOf(element);
      if(point&&validPoint({lon:point[0],lat:point[1]}))stores.push({point,contents});
      continue;
    }
    if(element.type!=='node'&&(element.geometry||element.members))areas.push(element);
  }
  const features=new Map();
  for(const element of areas) {
    const tags=element.tags||{},polygons=areaPolygons(element);
    if(!polygons.length)continue;
    const within=p=>polygons.some(polygon=>p[0]>=polygon.box[0]&&p[0]<=polygon.box[2]&&p[1]>=polygon.box[1]&&p[1]<=polygon.box[3]&&insidePolygon(p,polygon));
    const stored=[...new Set(stores.filter(s=>within(s.point)).flatMap(s=>s.contents))].sort();
    const industry=tokens(tags.industrial),resource=tokens(tags.resource);
    const evidence=[...industry.filter(v=>FUEL_INDUSTRY.includes(v)||v==='coal').map(v=>`industrial=${v}`),...resource.filter(v=>COAL_RESOURCE.includes(v)).map(v=>`resource=${v}`),...(stored.length?['storage contents']:[])];
    const fuel=industry.some(v=>FUEL_INDUSTRY.includes(v))||stored.some(v=>FUEL_CONTENTS.includes(v));
    const coal=industry.includes('coal')||resource.some(v=>COAL_RESOURCE.includes(v))||stored.some(v=>COAL_CONTENTS.includes(v));
    if(!fuel&&!coal)continue;
    const entering=sidings.filter(s=>polygons.some(polygon=>lineMeetsPolygon(s.line,polygon)));
    if(!entering.length)continue;
    const state=entering.some(s=>s.state==='present')?'present':entering[0].state;
    const centre=polygons[0].outer[0],atlas_han=hanRegion(...centre),id=`${element.type}-${element.id}`;
    const kind=fuel?'fuel_site':'coal_site';
    features.set(id,{type:'Feature',id,geometry:polygons.length===1?{type:'Polygon',coordinates:[polygons[0].outer,...polygons[0].inners]}:{type:'MultiPolygon',coordinates:polygons.map(p=>[p.outer,...p.inners])},properties:{...tags,
      atlas_han,atlas_zh:atlas_han==='cjkv'?chineseArea(...centre):'',osm_type:element.type,osm_id:String(element.id),
      energy_kind:kind,energy_group:fuel?'fuel':'coal',energy_evidence:evidence.join(';'),
      ...(stored.length?{stored_contents:stored.join(';')}:{}),
      rail_sidings:entering.map(s=>s.id).sort().join(';'),power_state:state}});
  }
  return {type:'FeatureCollection',features:[...features.values()].sort((a,b)=>a.id.localeCompare(b.id))};
}

// A site crossing a region boundary sees only that region's sidings and
// storage. Combine both regions' evidence so region order does not matter.
export function mergeEnergySite(previous,next) {
  const union=key=>[...new Set([previous,next].flatMap(f=>String(f.properties[key]??'').split(';').filter(Boolean)))].sort();
  const stored=union('stored_contents'),evidence=union('energy_evidence'),fuel=previous.properties.energy_group==='fuel'||next.properties.energy_group==='fuel';
  const state=[previous,next].some(f=>f.properties.power_state==='present')?'present':next.properties.power_state;
  const properties={...next.properties};delete properties.stored_contents;
  return {...next,properties:{...properties,energy_kind:fuel?'fuel_site':'coal_site',energy_group:fuel?'fuel':'coal',
    energy_evidence:evidence.join(';'),...(stored.length?{stored_contents:stored.join(';')}:{}),rail_sidings:union('rail_sidings').join(';'),power_state:state}};
}
