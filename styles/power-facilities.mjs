// Railway energy supplies. Tag-based selection keeps roadside fuel stations,
// municipal water tanks and ordinary utility substations out of the Power view.
// The maintenance builder uses these same rules for the worldwide snapshot.
const SERVICING_LABELS = Object.freeze({fuel:'Train refuelling point', coal:'Steam engine coaling', water:'Steam engine water'});
export const POWER_FACILITY_KINDS = Object.freeze({
  substation: {label:'Traction substation', group:'electricity', color:'#b77d00', mark:'E', minzoom:11},
  plant: {label:'Railway power station', group:'electricity', color:'#b77d00', mark:'E', minzoom:10},
  generator: {label:'Railway generator', group:'electricity', color:'#b77d00', mark:'E', minzoom:12},
  converter: {label:'Traction power converter', group:'electricity', color:'#b77d00', mark:'E', minzoom:12},
  transformer: {label:'Traction transformer', group:'electricity', color:'#b77d00', mark:'E', minzoom:13},
  feeder: {label:'Traction feeding point', group:'electricity', color:'#b77d00', mark:'E', minzoom:14},
  power_supply: {label:'Railway power supply', group:'electricity', color:'#b77d00', mark:'E', minzoom:13},
  preheating: {label:'Train preheating supply', group:'electricity', color:'#b77d00', mark:'E', minzoom:13},
  charging_station: {label:'Battery train charging facility', group:'charging', color:'#008a83', mark:'B', minzoom:12},
  fuel: {label:SERVICING_LABELS.fuel, group:'fuel', color:'#906532', mark:'F', minzoom:13},
  fuel_tank: {label:'Railway fuel tank', group:'fuel', color:'#906532', mark:'F', minzoom:13},
  coaling_facility: {label:SERVICING_LABELS.coal, group:'coal', color:'#4b4c50', mark:'C', minzoom:13},
  water_tower: {label:'Steam locomotive water tower', group:'water', color:'#287bad', mark:'W', minzoom:13},
  water_tank: {label:'Steam locomotive water tank', group:'water', color:'#287bad', mark:'W', minzoom:13},
  water_crane: {label:'Steam locomotive water crane', group:'water', color:'#287bad', mark:'W', minzoom:13},
});
// Railway traction power lines share the electricity supply colour. Cables
// are dashed; former lines are dashed and faded with the inactive setting.
export const TRACTION_LINE_STYLE = Object.freeze({color:'#b77d00', width:Object.freeze({line:Object.freeze([1.4,2.6]), other:Object.freeze([0.9,1.6])})});
// Rail-served fuel and coal sites share their group's marker colour.
export const ENERGY_SITE_STYLE = Object.freeze({fuel:'#906532', coal:'#4b4c50'});
// Shared by the map's point layers and legend; the legend samples the detailed
// marker size. Lifecycle changes only the fill, stroke and letter colour.
export const POWER_FACILITY_SYMBOL = Object.freeze({paper:'#fffef8', radius:6.5, textSize:9, stroke:1.5, formerStroke:2});
export const POWER_FACILITY_LEGEND = Object.freeze([
  ['substation','Electricity supply'],
  ['charging_station','Battery train charging'],
  ['fuel',`${SERVICING_LABELS.fuel} (fuel type where mapped)`],
  ['coaling_facility',SERVICING_LABELS.coal],
  ['water_tank',SERVICING_LABELS.water],
].map(([kind,label]) => {
  const {color,mark} = POWER_FACILITY_KINDS[kind];
  return Object.freeze({symbol:'point',color,mark,label});
}));
// Both the help page and legend explanation use the actual marker categories.
// Storage and generation are evidence about a supply, not proof of servicing.
export const POWER_FACILITY_LIMITS = `F and W also include mapped railway fuel and water storage; storage alone does not establish a train refuelling or steam servicing point. Hollow markers identify planned or former facilities when those are enabled. The whole electricity grid and wider fuel supply chain are not yet covered. Missing markers do not establish an absence of supplies; mapped facilities do not establish current availability.`;
export const ENERGY_SITE_NOTE = `Shaded areas are rail-served fuel (brown) and coal (grey) sites: a railway siding is mapped as entering the site, and the site's tags or the storage inside it record the fuel. A site beside a track is not included, and a served site is not a train refuelling point.`;
export const TRACTION_LINE_NOTE = `Amber lines are railway supply power lines, with cables dashed: lines mapped as reaching a railway electricity facility, and the lines in the same circuit. A line merely passing near one is not included.`;
export const POWER_FACILITY_EXPLANATION = `Point markers: ${POWER_FACILITY_LEGEND.map(({mark,label})=>`${mark}: ${label}`).join('; ')}. ${TRACTION_LINE_NOTE} ${ENERGY_SITE_NOTE} ${POWER_FACILITY_LIMITS}`;
const SUPPLIES = new Set(['fuel','coaling_facility','water_tower','water_tank','water_crane','power_supply','preheating','charging_station']);
const POWER_TYPES = new Set(['substation','plant','generator','converter','frequency_converter','transformer']);
const STATES = ['construction','proposed','disused','abandoned','razed','demolished','removed'];
const values = value => String(value ?? '').split(';').map(v=>v.trim().toLowerCase()).filter(Boolean);
const has = (value, candidates) => values(value).some(v=>candidates.includes(v));
export const tractionFrequency = value => values(value).some(v=>/^(16\.7|16\.67|16\.66[67]?)$/.test(v));

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
  const charger = lifecycleValue(tags,'amenity'), chargePoint = lifecycleValue(tags,'man_made');
  if ((has(charger.value,['charging_station']) || has(chargePoint.value,['charge_point'])) &&
      (has(railway.value,['yes','rail','narrow_gauge','light_rail','subway','tram','monorail','miniature','power_supply']) || ['train','tram','light_rail','subway'].some(key=>has(tags[key],['yes','designated','only'])))) {
    const state=has(charger.value,['charging_station'])?charger.state:chargePoint.state;
    return {...POWER_FACILITY_KINDS.charging_station,kind:'charging_station',state:state!=='present'?state:STATES.find(s=>has(railway.value,[s]))||railway.state};
  }
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
  // Direct provider supply points encode the category in feature, not type:
  // type is merely "facility" or "equipment".
  const kind = properties.power_kind || String(properties.feature || '').replace(/^general\//,'');
  const storage=has(lifecycleValue(properties,'man_made').value,['storage_tank','water_tower']);
  const steam=['',...STATES.map(state=>`${state}:`)].some(prefix=>has(properties[`${prefix}railway`],['water_tower','water_tank','water_crane']));
  if (['water_tower','water_tank'].includes(kind) && storage && !steam) return kind==='water_tower'?'Railway water tower':'Railway water tank';
  return POWER_FACILITY_KINDS[kind]?.label || (!properties.power_kind && properties.power === 'substation' ? 'Traction substation' : 'Railway energy supply');
}

// Railway supply line details. The basis states the evidence that selected
// the line: reaching a facility (a shared node or geometry entering or ending on
// its mapped area, not proximity), or being in the same circuit as such a line.
const TRACTION_LINE_LABELS = Object.freeze({line:'Railway traction power line', minor_line:'Railway traction power line (minor)', cable:'Railway traction power cable'});
export function tractionLineName(properties = {}) {
  return TRACTION_LINE_LABELS[properties.power_line_kind] || 'Railway traction power line';
}
export function tractionLineRows(properties = {}) {
  const p=properties,basis=String(p.traction_basis??'').split(';').filter(Boolean);
  const reasons={facility:'Reaches a mapped railway electricity facility',circuit:'Same circuit as a line reaching a railway electricity facility'};
  return [
    ['Type',tractionLineName(p)],['Status',p.power_state],
    ['Railway supply basis',basis.map(value=>reasons[value]).filter(Boolean).join('; ')],
    ['Operator',p.operator],['Owner',p.owner],['Voltage',p.voltage],
    ['Frequency',p.frequency!=null&&String(p.frequency).trim()!==''?`${p.frequency} Hz`:undefined],
    ['Circuits',p.circuits],['Cables',p.cables],['Reference',p.ref],['Line location',p.location],
  ].filter(([,value])=>value!=null&&String(value).trim()!=='');
}

// Rail-served site details. The site's energy role and its rail link are
// stated as the evidence that selected it: a siding entering the mapped area,
// not proximity, and not a claim that trains are refuelled there.
const ENERGY_SITE_LABELS = Object.freeze({fuel_site:'Rail-served fuel site', coal_site:'Rail-served coal site'});
export function energySiteName(properties = {}) {
  return ENERGY_SITE_LABELS[properties.energy_kind] || 'Rail-served energy site';
}
export function energySiteRows(properties = {}) {
  const p=properties,list=value=>String(value??'').split(';').filter(Boolean);
  const evidence=list(p.energy_evidence).map(value=>value==='storage contents'?'Storage inside the site records energy contents':`Tagged ${value}`);
  const sidings=list(p.rail_sidings);
  return [
    ['Type',energySiteName(p)],['Status',p.power_state==='present'?'present':`${p.power_state} rail connection`],
    ['Energy evidence',evidence.join('; ')],['Stored contents',list(p.stored_contents).join(', ')],
    ['Rail connection',sidings.length?`${sidings.length===1?'A siding enters':`${sidings.length} sidings enter`} the mapped site`:undefined],
    ['Operator',p.operator],['Owner',p.owner],
  ].filter(([,value])=>value!=null&&String(value).trim()!=='');
}

// Keep independent source attributes independent. A generating source (solar,
// hydro, wind or a combustible input) is not fuel offered to trains, and stored
// contents do not prove a refuelling point. Preserve raw fuel:* declarations,
// including negative/unknown values, so a positive tag never conceals a conflict.
// fuel:* also records non-fuel supplies such as AdBlue; never promote every
// positive key into a fuel claim or require a fixed vocabulary of supply types.
export function powerFacilityEnergyRows(properties = {}) {
  const p=properties;
  const fuelTags=Object.entries(p).filter(([key,value])=>key.startsWith('fuel:')&&key.length>5&&value!=null&&String(value).trim()).sort(([a],[b])=>a.localeCompare(b));
  const direct=String(p.fuel??'').split(';').map(value=>value.trim()).filter(Boolean);
  const types=[...new Set([...direct.filter(value=>!/^(yes|no|unknown)$/i.test(value)),...fuelTags.filter(([key,value])=>/^fuel:[^:]+$/.test(key)&&String(value).trim().toLowerCase()==='yes').map(([key])=>key.slice(5))])];
  const refuelling=p.power_kind==='fuel'||String(p.feature||'').replace(/^general\//,'')==='fuel'||has(lifecycleValue(p,'railway').value,['fuel']);
  return [
    ['Recorded supplies',types.join(', ')||(refuelling?'Not recorded':undefined)],
    ['Fuel tag',p.fuel],
    ['Fuel tags',fuelTags.map(([key,value])=>`${key}=${value}`).join('; ')],
    ['Plant energy source',p['plant:source']],
    ['Generator energy source',p['generator:source']],
    ['Stored contents',p.content],
  ].filter(([,value])=>value!=null&&String(value).trim()!=='');
}

// The dataset is downloaded only once the Power view needs it. Visitors read
// the prepared snapshot; there are no live Overpass requests in the browser.
// glyphs(data) may delay showing localized names, for fonts they need.
export function createPowerFacilityLoader(map, {url, active = ()=>true, fetcher = fetch, onError = ()=>{}, language = ()=>'', localize = data=>data, glyphs = async()=>{}, sourceId = 'electricFacilities'} = {}) {
  let pending, raw, shownLanguage, shownSource, retryAfter = 0, showing;
  const show = async () => {
    const nextLanguage=language();
    const source=map.getSource(sourceId);
    if (!raw || !source || nextLanguage===shownLanguage && source===shownSource || showing===nextLanguage) return;
    showing=nextLanguage;
    const data=localize(structuredClone(raw),nextLanguage);
    try { await glyphs(data); } catch {}
    if (showing!==nextLanguage) return;
    showing=undefined;
    if (language()!==nextLanguage) return show();
    // A style being replaced can lack the source for a moment; the language
    // counts as shown only once a source has the data, so the next refresh
    // fills the new one.
    const latestSource=map.getSource(sourceId);
    if (!latestSource) return;
    latestSource.setData(data);
    shownLanguage=nextLanguage;shownSource=latestSource;
  };
  return async function refresh() {
    if (!active() || !map.getSource(sourceId)) return;
    if (raw) return show();
    if (Date.now()<retryAfter) return;
    if (pending) return pending;
    pending = (async()=>{
      const response = await fetcher(url,{cache:'no-cache',signal:AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error(`Railway energy supplies returned ${response.status}`);
      const data = await response.json();
      if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Invalid railway energy supply snapshot');
      raw = data;
      await show();
    })().catch(error=>{retryAfter=Date.now()+60000;onError(error);}).finally(()=>{pending=undefined;});
    return pending;
  };
}
