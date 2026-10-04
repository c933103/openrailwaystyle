// Pure maintenance transforms. out center retains the point of a mapped node
// and a stable display centre for way/relation facilities, with the original
// OSM object identity and supply tags available in the infobox.
import {powerFacility} from '../styles/power-facilities.mjs';
import {hanRegion,chineseArea} from '../styles/han-region.mjs';
import {createHash} from 'node:crypto';

const SUPPLIES = 'fuel|coaling_facility|water_tower|water_tank|water_crane|power_supply|preheating|power_station|substation';
const POWER = 'substation|plant|generator|converter|frequency_converter|transformer';
const RAIL = 'yes|rail|narrow_gauge|light_rail|subway|tram|monorail|power_station|substation';
const PREFIXES = ['', 'construction:', 'proposed:', 'disused:', 'abandoned:', 'razed:', 'demolished:', 'removed:'];
const tokenPattern = options => `(^|;)[[:space:]]*(${options})[[:space:]]*(;|$)`;
// JSON quoting is also QL string quoting, including doubled backslashes in
// regexes. Select complete semicolon-delimited values with native case-folding
// and POSIX whitespace, then let the classifier decide railway supply use.
const tagFilter = (key, options) => `[${JSON.stringify(key)}~${JSON.stringify(tokenPattern(options))},i]`;
const potentialFilter = `nwr.hints(if:${PREFIXES.flatMap(prefix=>['power','man_made'].map(key=>`is_tag(${JSON.stringify(prefix+key)})`)).join('||')})->.potential;`;
const withPotentialFilter = query => query.replace(')->.hints;',`)->.hints;${potentialFilter}`).replaceAll('nwr.hints[','nwr.potential[');

// Keep the prefilter-free v6 form available for completed response caches.
// The compatibility digests below freeze both reviewed query forms; changing
// a selector or the prefilter disables legacy reuse unless reviewed again.
function powerFacilityQueryBase(box) {
  const bbox = box ? `(${box.join(',')})` : '';
  const hints=PREFIXES.map(prefix=>`nwr${tagFilter(`${prefix}railway`,RAIL)}${bbox};`);
  hints.push(`nwr${tagFilter('substation','traction')}${bbox};`,
    `nwr${tagFilter('transformer','traction')}${bbox};`,
    `nwr${tagFilter('usage','railway|traction')}${bbox};`,
    `nwr${tagFilter('landuse','railway')}${bbox};`,
    `nwr${tagFilter('frequency','16\\.(7|67|66[67]?)')}${bbox};`);
  const selectors=[];
  for (const prefix of PREFIXES) {
    // Overpass Item_Constraint prefers the input set, so regex-value filters
    // inspect local tags on these bounded objects instead of global power tags.
    // The classifier discards tanks/power types lacking the relevant hint.
    selectors.push(`nwr.hints${tagFilter(`${prefix}power`,POWER)};`,
      `nwr.hints${tagFilter(`${prefix}man_made`,'water_tower|storage_tank')};`,
      `nwr${tagFilter(`${prefix}railway`,SUPPLIES)}${bbox};`,
      `nwr${tagFilter(`${prefix}railway:electricity`,'power_supply')}${bbox};`);
  }
  // tags-only output removes coordinates from nodes. center supplies only
  // way/relation centres, so body is necessary for mapped supply nodes.
  return `[out:json][timeout:240][maxsize:134217728];(${hints.join('')})->.hints;(${selectors.join('')});out body center qt;`;
}

export function powerFacilityQuery(box) {
  // Load tags for the bounded hints once, then inspect power/tank values only
  // on objects having a relevant exact key. Every downstream value match
  // necessarily has that key, so this gate preserves the entire result set.
  return withPotentialFilter(powerFacilityQueryBase(box));
}

const LEGACY_V6_DIGEST='cbb72dda62d31d579edf1cfb86bb4ff51aba969aa851baf9350dfa25ddba5695';
const PREFILTER_V6_DIGEST='bd1af2628e20bf8003281ba36e28425cf03d165f76f83cc5b3782eb45a2dc920';
const queryDigest = (query,box) => createHash('sha256').update(query.replaceAll(`(${box.join(',')})`,'(__POWER_FACILITY_BBOX__)')).digest('hex');
const MAX_CACHE_AGE=28*86400_000;

export function powerFacilityCacheRecordAccepted(box,query,saved,{mtimeMs,refresh=false,now=Date.now()}={}) {
  if(refresh || !Number.isFinite(mtimeMs) || now-mtimeMs>=MAX_CACHE_AGE || typeof saved?.query!=='string')return false;
  if(saved.query===query)return true;
  const legacy=powerFacilityQueryBase(box);
  return saved.query===legacy && query===withPotentialFilter(legacy) &&
    queryDigest(legacy,box)===LEGACY_V6_DIGEST && queryDigest(query,box)===PREFILTER_V6_DIGEST;
}

export function powerFacilityCachedResponse(box,query,saved,options) {
  if(!powerFacilityCacheRecordAccepted(box,query,saved,options))return undefined;
  powerFacilitiesGeoJSON(saved.response); // Reject cached partial/error responses too.
  return saved.response;
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
