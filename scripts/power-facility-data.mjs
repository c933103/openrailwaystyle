// Pure maintenance transforms. out center retains the point of a mapped node
// and a stable display centre for way/relation facilities, with the original
// OSM object identity and supply tags available in the infobox.
import {powerFacility} from '../styles/power-facilities.mjs';
import {hanRegion,chineseArea} from '../styles/han-region.mjs';
import {areaPolygons,bounds,validPoint} from './osm-geometry.mjs';

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
  // geom keeps each facility's mapped shape (way outline, relation member
  // rings); body keeps node coordinates and all tags.
  return `[out:json][timeout:240][maxsize:134217728];(${hints.join('')})->.hints;(${selectors.join('')});out body geom qt;`;
}

export function powerFacilityQuery(box) {
  // Load tags for the bounded hints once, then inspect power/tank values only
  // on objects having a relevant exact key. Every downstream value match
  // necessarily has that key, so this gate preserves the entire result set.
  return withPotentialFilter(powerFacilityQueryBase(box));
}

const MAX_CACHE_AGE=28*86400_000;

// A cached response is reused only for the exact current query. Earlier
// centre-point responses (out center) cannot supply mapped shapes.
export function powerFacilityCacheRecordAccepted(box,query,saved,{mtimeMs,refresh=false,now=Date.now()}={}) {
  if(refresh || !Number.isFinite(mtimeMs) || now-mtimeMs>=MAX_CACHE_AGE || typeof saved?.query!=='string')return false;
  return saved.query===query;
}

export function powerFacilityCachedResponse(box,query,saved,options) {
  if(!powerFacilityCacheRecordAccepted(box,query,saved,options))return undefined;
  powerFacilitiesGeoJSON(saved.response); // Reject cached partial/error responses too.
  return saved.response;
}

const point=p=>[p.lon,p.lat];
const inRange=([lon,lat])=>Number.isFinite(lon)&&Number.isFinite(lat)&&Math.abs(lon)<=180&&Math.abs(lat)<=90;
// The mapped shape: a node is a point, a closed way or multipolygon an area,
// an open way a line. A centre point remains only where no shape was returned.
function facilityGeometry(element) {
  if (element.type==='node') { const c=[element.lon,element.lat]; return inRange(c)?{type:'Point',coordinates:c}:null; }
  const polygons=areaPolygons(element);
  if (polygons.length===1) return {type:'Polygon',coordinates:[polygons[0].outer,...polygons[0].inners]};
  if (polygons.length>1) return {type:'MultiPolygon',coordinates:polygons.map(p=>[p.outer,...p.inners])};
  if (element.type==='way' && element.geometry?.length>=2 && element.geometry.every(validPoint)) return {type:'LineString',coordinates:element.geometry.map(point)};
  const box=element.bounds,center=element.center?point(element.center):box?[(box.minlon+box.maxlon)/2,(box.minlat+box.maxlat)/2]:null;
  return center&&inRange(center)?{type:'Point',coordinates:center}:null;
}
// A position inside the facility's extent, for region-dependent naming.
function representativePoint(element,geometry) {
  if (geometry.type==='Point') return geometry.coordinates;
  const ring=geometry.type==='Polygon'?geometry.coordinates[0]:geometry.type==='MultiPolygon'?geometry.coordinates[0][0]:geometry.coordinates;
  const [minx,miny,maxx,maxy]=bounds(ring);
  return [(minx+maxx)/2,(miny+maxy)/2];
}

export function powerFacilitiesGeoJSON(json) {
  if (json?.remark || !Array.isArray(json?.elements)) throw new Error(json?.remark || 'Incomplete Overpass facility response');
  const features = new Map();
  for (const element of json.elements) {
    if (!['node','way','relation'].includes(element.type) || !Number.isSafeInteger(element.id)) continue;
    const supply=powerFacility(element.tags);
    if (!supply) continue;
    const id=`${element.type}-${element.id}`;
    const geometry=facilityGeometry(element);
    if (!geometry) throw new Error(`Incomplete coordinates for railway energy supply ${id}`);
    const coordinates=representativePoint(element,geometry);
    const atlas_han=hanRegion(...coordinates);
    features.set(id,{type:'Feature',id,geometry,properties:{...element.tags,
      atlas_han,atlas_zh:atlas_han==='cjkv'?chineseArea(...coordinates):'',
      osm_type:element.type,osm_id:String(element.id),power_kind:supply.kind,power_group:supply.group,
      power_state:supply.state,power_minzoom:supply.minzoom,power_mark:supply.mark,power_color:supply.color}});
  }
  return {type:'FeatureCollection',features:[...features.values()].sort((a,b)=>a.id.localeCompare(b.id))};
}
