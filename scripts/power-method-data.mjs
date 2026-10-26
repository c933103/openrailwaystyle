// Maintenance-only supplement: provider railway tiles discard electrified=*.
// Keep actual OSM geometry and charger evidence; never infer from a voltage,
// nearby track, operator name, or the presence of battery trains on a route.
import {powerFacilitiesGeoJSON} from './power-facility-data.mjs';
import {powerFacility} from '../styles/power-facilities.mjs';
import {hanRegion,chineseArea} from '../styles/han-region.mjs';
const states=['construction','proposed','disused','abandoned','razed','demolished','removed'];
const prefixes=['',...states.map(s=>s+':')];
const tokens=value=>String(value??'').split(';').map(s=>s.trim().toLowerCase());
const match=(key,values)=>`[${JSON.stringify(key)}~${JSON.stringify(`(^|;)[[:space:]]*(${values})[[:space:]]*(;|$)`)},i]`;
const tracks=['rail','narrow_gauge','subway','light_rail','tram','monorail','miniature','funicular'];
const methods=['rail','4th_rail','ground-level_power_supply','inductive'];
// How the train is propelled or held, independent of how power reaches it.
const PROPULSION=['linear_motor'],TRACTION=['rack','cable'];
const METHOD_LABELS={rail:'Third rail','4th_rail':'Fourth rail','ground-level_power_supply':'Ground-level power supply',inductive:'Inductive power supply',linear_motor:'Linear motor',rack:'Rack railway',cable:'Cable traction'};
export function powerMethodQuery(box) {
  if(!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||box[0]<-90||box[2]>90||box[1]<-180||box[3]>180||box[0]>=box[2]||box[1]>=box[3])throw new Error('Invalid power-method bbox');
  const bbox=`(${box.join(',')})`,charging=[],selectors=[];
  for(const prefix of prefixes) {
    selectors.push(`way${match(prefix+'electrified',methods.join('|'))}${bbox};`,
      `way${match(prefix+'propulsion',PROPULSION.join('|'))}${bbox};`,`way${match(prefix+'traction',TRACTION.join('|'))}${bbox};`,
      `nwr${match(prefix+'railway','charging_station')}${bbox};`);
    for(const [key,value] of [['amenity','charging_station'],['man_made','charge_point']]) {
      charging.push(`nwr${match(prefix+key,value)}${bbox};`);
    }
  }
  // All 16 primary charging selectors used the same 14 alternative hints.
  // Factor (primary AND hint) into a bounded primary set before inspecting
  // common railway/landuse values. Item_Constraint keeps these regex scans on
  // the candidate IDs instead of repeatedly searching global railway tags.
  const hints=['train','tram','light_rail','subway',...prefixes.map(p=>p+'railway'),'usage','landuse'];
  const potential=`nwr.charging(if:${hints.map(k=>`is_tag(${JSON.stringify(k)})`).join('||')})->.potential;`;
  for(const hint of ['train','tram','light_rail','subway'])selectors.push(`nwr.potential${match(hint,'yes|designated|only')};`);
  for(const prefix of prefixes)selectors.push(`nwr.potential${match(prefix+'railway','yes|power_supply|'+tracks.join('|'))};`);
  selectors.push(`nwr.potential${match('usage','railway|traction')};`,`nwr.potential${match('landuse','railway')};`);
  return `[out:json][timeout:240][maxsize:134217728];(${charging.join('')})->.charging;${potential}(${selectors.join('')});out body geom qt;`;
}
export function powerMethodsGeoJSON(json) {
  if(json?.remark||!Array.isArray(json?.elements))throw new Error(json?.remark||'Incomplete power-method response');
  const byId=new Map();
  for(const element of json.elements) {
    if(!['node','way','relation'].includes(element.type)||!Number.isSafeInteger(element.id))continue;
    const tags=element.tags||{};
    if(powerFacility(tags)?.kind==='charging_station') {
      const points=(element.geometry||element.members?.flatMap(m=>m.geometry||(Number.isFinite(m.lon)?[m]:[]))||[]).map(p=>[p.lon,p.lat]);
      const bounds=element.bounds;
      const center=element.center||(bounds?{lon:(bounds.minlon+bounds.maxlon)/2,lat:(bounds.minlat+bounds.maxlat)/2}:points.length?{lon:(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2,lat:(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2}:undefined);
      for(const feature of powerFacilitiesGeoJSON({elements:[{...element,center}]}).features)byId.set(feature.id,feature);
      continue;
    }
    if(element.type!=='way')continue;
    const railPrefix=prefixes.find(prefix=>tokens(tags[prefix+'railway']).some(v=>tracks.includes(v)));
    const genericState=states.find(s=>tokens(tags.railway).includes(s));
    if(railPrefix===undefined&&!genericState)continue;
    // Each means keeps its own lifecycle: an operating line can carry a
    // proposed:traction=rack or a disused:electrified=rail. A non-operating
    // track makes every means on it non-operating too.
    const trackState=genericState||railPrefix?.slice(0,-1)||undefined;
    const fallback=states.find(s=>tags[s]==='yes')||'present';
    const means=[];
    for(const [key,allowed] of [['electrified',methods],['propulsion',PROPULSION],['traction',TRACTION]])
      for(const prefix of prefixes)for(const value of tokens(tags[prefix+key]).filter(v=>allowed.includes(v)))
        if(!means.some(m=>m.key===key&&m.value===value))means.push({key,value,prefix,state:trackState||prefix.slice(0,-1)||fallback});
    if(!means.length)continue;
    const coordinates=element.geometry?.map(p=>[p.lon,p.lat]);
    if(!coordinates||coordinates.length<2||coordinates.some(p=>!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90))throw new Error(`Incomplete geometry for power method way-${element.id}`);
    const center=coordinates[Math.floor(coordinates.length/2)],atlas_han=hanRegion(...center);
    // One feature per lifecycle, so the planned/former setting hides exactly
    // the means that are not operating. The first keeps the plain OSM id.
    const groups=[...new Set(means.map(m=>m.state))];
    for(const [index,state] of groups.entries()) {
      const group=means.filter(m=>m.state===state),values=key=>group.filter(m=>m.key===key).map(m=>m.value);
      const selected=values('electrified'),propulsion=values('propulsion'),traction=values('traction');
      const prefix=group.find(m=>m.key==='electrified')?.prefix;
      const number=key=>prefix!==undefined&&/^\d+(\.\d+)?$/.test(tags[prefix+key]||'')?Number(tags[prefix+key]):undefined;
      const id=index?`way-${element.id}-${state}`:`way-${element.id}`;
      byId.set(id,{type:'Feature',id,geometry:{type:'LineString',coordinates},properties:{...tags,
        atlas_han,atlas_zh:atlas_han==='cjkv'?chineseArea(...center):'',osm_type:'way',osm_id:String(element.id),
        power_state:state,electrification_state:state,
        power_method:selected.join(';'),power_method_label:group.map(m=>METHOD_LABELS[m.value]).join(' + '),
        // Booleans keep layer filters exact (4th_rail must not match rail).
        method_rail:selected.includes('rail'),method_fourth_rail:selected.includes('4th_rail'),
        method_ground:selected.includes('ground-level_power_supply'),method_inductive:selected.includes('inductive'),
        propulsion_linear_motor:propulsion.includes('linear_motor'),traction_rack:traction.includes('rack'),traction_cable:traction.includes('cable'),
        ...(number('voltage')!==undefined?{voltage:number('voltage')}:{}),...(number('frequency')!==undefined?{frequency:number('frequency')}:{}),
      }});
    }
  }
  return {type:'FeatureCollection',features:[...byId.values()].sort((a,b)=>a.id.localeCompare(b.id))};
}
