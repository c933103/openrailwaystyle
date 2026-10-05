// Railway energy supplies. Tag-based selection keeps roadside fuel stations,
// municipal water tanks and ordinary utility substations out of the Power view.
// The maintenance builder uses these same rules for the worldwide snapshot.
export const POWER_FACILITY_KINDS = Object.freeze({
  substation: {label:'Traction substation', group:'electricity', color:'#b77d00', mark:'E', minzoom:11},
  plant: {label:'Railway power station', group:'electricity', color:'#b77d00', mark:'E', minzoom:10},
  generator: {label:'Railway generator', group:'electricity', color:'#b77d00', mark:'E', minzoom:12},
  converter: {label:'Traction power converter', group:'electricity', color:'#b77d00', mark:'E', minzoom:12},
  transformer: {label:'Traction transformer', group:'electricity', color:'#b77d00', mark:'E', minzoom:13},
  feeder: {label:'Traction feeding point', group:'electricity', color:'#b77d00', mark:'E', minzoom:14},
  power_supply: {label:'Railway power supply', group:'electricity', color:'#b77d00', mark:'E', minzoom:13},
  preheating: {label:'Train preheating supply', group:'electricity', color:'#b77d00', mark:'E', minzoom:13},
  fuel: {label:'Locomotive fuel supply', group:'fuel', color:'#906532', mark:'F', minzoom:13},
  fuel_tank: {label:'Railway fuel tank', group:'fuel', color:'#906532', mark:'F', minzoom:13},
  coaling_facility: {label:'Locomotive coaling facility', group:'coal', color:'#4b4c50', mark:'C', minzoom:13},
  water_tower: {label:'Steam locomotive water tower', group:'water', color:'#287bad', mark:'W', minzoom:13},
  water_tank: {label:'Steam locomotive water tank', group:'water', color:'#287bad', mark:'W', minzoom:13},
  water_crane: {label:'Steam locomotive water crane', group:'water', color:'#287bad', mark:'W', minzoom:13},
});
const SUPPLIES = new Set(['fuel','coaling_facility','water_tower','water_tank','water_crane','power_supply','preheating']);
const POWER_TYPES = new Set(['substation','plant','generator','converter','frequency_converter','transformer']);
const STATES = ['construction','proposed','disused','abandoned','razed','demolished','removed'];
const values = value => String(value ?? '').split(';').map(v=>v.trim().toLowerCase()).filter(Boolean);
const has = (value, candidates) => values(value).some(v=>candidates.includes(v));
const tractionFrequency = value => values(value).some(v=>/^(16\.7|16\.67|16\.66[67]?)$/.test(v));

function lifecycleValue(tags, key) {
  if (tags[key] != null) return {value:tags[key], state:STATES.find(s=>tags[s]==='yes') || 'present'};
  for (const state of STATES) if (tags[`${state}:${key}`] != null) return {value:tags[`${state}:${key}`], state};
  return {value:null, state:'present'};
}
function railwayUse(tags, railway) {
  return has(railway,['yes','rail','narrow_gauge','light_rail','subway','tram','monorail','power_station','substation']) ||
    has(tags.usage,['railway','traction']) || has(tags.landuse,['railway']);
}

export function powerFacility(tags = {}) {
  const railway = lifecycleValue(tags,'railway'), power = lifecycleValue(tags,'power');
  const railwayKind = values(railway.value).find(v=>SUPPLIES.has(v));
  if (railwayKind) return {...POWER_FACILITY_KINDS[railwayKind], kind:railwayKind, state:railway.state};
  const feeding = lifecycleValue(tags,'railway:electricity');
  if (has(feeding.value,['power_supply'])) return {...POWER_FACILITY_KINDS.feeder, kind:'feeder', state:feeding.state};
  const independentUse = has(tags.usage,['railway','traction']) || has(tags.landuse,['railway']);
  const evidenceState = physical => physical !== 'present' ? physical : !independentUse && railwayUse(tags,railway.value) ? railway.state : 'present';
  const kind = values(power.value).find(v=>POWER_TYPES.has(v));
  if (kind && (has(tags.substation,['traction']) || (kind === 'transformer' && has(tags.transformer,['traction'])) || railwayUse(tags,railway.value) || tractionFrequency(tags.frequency))) {
    const normalized = kind === 'frequency_converter' ? 'converter' : kind;
    return {...POWER_FACILITY_KINDS[normalized], kind:normalized, state:has(tags.substation,['traction']) || kind === 'transformer' && has(tags.transformer,['traction']) || tractionFrequency(tags.frequency) ? power.state : evidenceState(power.state)};
  }
  if (has(railway.value,['power_station','substation'])) {
    const normalized = has(railway.value,['power_station']) ? 'plant' : 'substation';
    return {...POWER_FACILITY_KINDS[normalized], kind:normalized, state:railway.state};
  }
  // Storage tanks need an explicit railway use and recorded contents. Being
  // close to a track does not establish that the tank supplies locomotives.
  const tank = lifecycleValue(tags,'man_made');
  if (railwayUse(tags,railway.value) && has(tank.value,['storage_tank','water_tower'])) {
    const normalized = has(tank.value,['water_tower']) ? 'water_tower' : has(tags.content,['water']) ? 'water_tank' :
      has(tags.content,['diesel','gas_oil','fuel','fuel_oil']) ? 'fuel_tank' : null;
    if (normalized) return {...POWER_FACILITY_KINDS[normalized], kind:normalized, state:evidenceState(tank.state)};
  }
  return null;
}

export function powerFacilityName(properties = {}) {
  if (properties.power_kind) return POWER_FACILITY_KINDS[properties.power_kind]?.label || 'Railway energy supply';
  // Direct provider supply points encode the category in feature, not type:
  // type is merely "facility" or "equipment".
  const kind = String(properties.feature || '').replace(/^general\//,'');
  return POWER_FACILITY_KINDS[kind]?.label || (properties.power === 'substation' ? 'Traction substation' : 'Railway energy supply');
}

// The dataset is downloaded only once the Power view needs it. Visitors read
// the prepared snapshot; there are no live Overpass requests in the browser.
// glyphs(data) may delay showing localized names, for fonts they need.
export function createPowerFacilityLoader(map, {url, active = ()=>true, fetcher = fetch, onError = ()=>{}, language = ()=>'', localize = data=>data, glyphs = async()=>{}} = {}) {
  let pending, raw, shownLanguage, retryAfter = 0, showing;
  const show = async () => {
    const nextLanguage=language();
    if (!raw || nextLanguage===shownLanguage || showing===nextLanguage) return;
    showing=nextLanguage;
    const data=localize(structuredClone(raw),nextLanguage);
    try { await glyphs(data); } catch {}
    if (showing!==nextLanguage) return;
    showing=undefined;
    if (language()!==nextLanguage) return show();
    map.getSource('electricFacilities')?.setData(data);
    shownLanguage=nextLanguage;
  };
  return async function refresh() {
    if (!active() || !map.getSource('electricFacilities')) return;
    if (raw) return show();
    if (Date.now()<retryAfter) return;
    if (pending) return pending;
    pending = (async()=>{
      const response = await fetcher(url,{signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error(`Railway energy supplies returned ${response.status}`);
      const data = await response.json();
      if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid railway energy supply snapshot');
      raw = data;
      await show();
    })().catch(error=>{retryAfter=Date.now()+60000;onError(error);}).finally(()=>{pending=undefined;});
    return pending;
  };
}
