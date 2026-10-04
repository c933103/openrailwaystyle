// Pure maintenance transforms. out center retains the point of a mapped node
// and a stable display centre for way/relation facilities, with the original
// OSM object identity and supply tags available in the infobox.
import {powerFacility} from '../styles/power-facilities.mjs';
import {hanRegion,chineseArea} from '../styles/han-region.mjs';

const SUPPLIES = 'fuel|coaling_facility|water_tower|water_tank|water_crane|power_supply|preheating|power_station|substation';
const POWER = 'substation|plant|generator|converter|frequency_converter|transformer';
const RAIL = 'yes|rail|narrow_gauge|light_rail|subway|tram|monorail|power_station|substation';
const PREFIXES = ['', 'construction:', 'proposed:', 'disused:', 'abandoned:', 'razed:', 'demolished:', 'removed:'];
const tokenPattern = options => `(^|;)[[:space:]]*(${options})[[:space:]]*(;|$)`;
// JSON quoting is also QL string quoting, including doubled backslashes in
// regexes. Match complete semicolon-delimited values with the same case and
// whitespace rules as the classifier, then let that classifier decide use.
const tagFilter = (key, options) => `[${JSON.stringify(key)}~${JSON.stringify(tokenPattern(options))},i]`;
const railwayHint = `[~${JSON.stringify('^((construction|proposed|disused|abandoned|razed|demolished|removed):)?railway$')}~${JSON.stringify(tokenPattern(RAIL))},i]`;

export function powerFacilityQuery(box) {
  const bbox = box ? `(${box.join(',')})` : '';
  const selectors=[];
  for (const prefix of PREFIXES) {
    const power = tagFilter(`${prefix}power`, POWER), tank = tagFilter(`${prefix}man_made`, 'water_tower|storage_tank');
    selectors.push(`nwr${tagFilter(`${prefix}railway`, SUPPLIES)}${bbox};`,
      `nwr${tagFilter(`${prefix}railway:electricity`, 'power_supply')}${bbox};`,
      `nwr${power}${tagFilter('substation', 'traction')}${bbox};`,
      `nwr${tagFilter(`${prefix}power`, 'transformer')}${tagFilter('transformer', 'traction')}${bbox};`,
      `nwr${power}${railwayHint}${bbox};`,
      `nwr${power}${tagFilter('usage', 'railway|traction')}${bbox};`,
      `nwr${power}${tagFilter('landuse', 'railway')}${bbox};`,
      `nwr${power}${tagFilter('frequency', '16\\.(7|67|66[67]?)')}${bbox};`,
      `nwr${tank}${railwayHint}${bbox};`,
      `nwr${tank}${tagFilter('landuse', 'railway')}${bbox};`,
      `nwr${tank}${tagFilter('usage', 'railway|traction')}${bbox};`);
  }
  // tags-only output removes coordinates from nodes. center supplies only
  // way/relation centres, so body is necessary for mapped supply nodes.
  return `[out:json][timeout:240][maxsize:134217728];(${selectors.join('')});out body center qt;`;
}

export function powerFacilitiesGeoJSON(json) {
  if (json?.remark || !Array.isArray(json?.elements)) throw new Error(json?.remark || 'Incomplete Overpass facility response');
  const features = new Map();
  for (const element of json.elements) {
    if (!['node','way','relation'].includes(element.type) || !Number.isSafeInteger(element.id)) continue;
    const supply=powerFacility(element.tags);
    if (!supply) continue;
    const coordinates = element.type==='node' ? [element.lon,element.lat] : [element.center?.lon,element.center?.lat];
    if (!coordinates.every(Number.isFinite) || Math.abs(coordinates[0])>180 || Math.abs(coordinates[1])>90) {
      throw new Error(`Incomplete coordinates for railway energy supply ${element.type}-${element.id}`);
    }
    const id=`${element.type}-${element.id}`;
    const atlas_han=hanRegion(...coordinates);
    features.set(id,{type:'Feature',id,geometry:{type:'Point',coordinates},properties:{...element.tags,
      atlas_han,atlas_zh:atlas_han==='cjkv'?chineseArea(...coordinates):'',
      osm_type:element.type,osm_id:String(element.id),power_kind:supply.kind,power_group:supply.group,
      power_state:supply.state,power_minzoom:supply.minzoom,power_mark:supply.mark,power_color:supply.color}});
  }
  return {type:'FeatureCollection',features:[...features.values()].sort((a,b)=>a.id.localeCompare(b.id))};
}
