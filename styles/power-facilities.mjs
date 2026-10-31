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
// Electrification signals: small amber dots with a dark outline, distinct from
// the neutral facility dots.
export const ELECTRICITY_SIGNAL_STYLE = Object.freeze({color:'#e0a21a', stroke:'#5c3d00', paper:'#fffef8'});
// Means of power delivery and traction drawn beside or along a track. The
// map layers and legend samples share this table. A fourth-rail track has
// conductor rails on both sides. Overhead contact line is the track colour.
export const POWER_METHOD_STROKES = Object.freeze([
  {id:'conductor-rails', when:['method_rail','method_fourth_rail'], offset:3.5, width:2, dash:[2,2], label:'Third rail (dashed, one side)', sample:'third-rail'},
  {id:'fourth-rails', when:['method_fourth_rail'], offset:-3.5, width:2, dash:[2,2], label:'Fourth rail (dashed, both sides)', sample:'fourth-rail'},
  {id:'ground-supply', when:['method_ground'], offset:0, width:3, dash:[0.1,1.8], color:'#fffef8', cap:'round', label:'Ground-level supply (dotted centre)', sample:'ground-supply'},
  {id:'inductive-supply', when:['method_inductive'], offset:3.5, width:2, dash:[4,1.5,1,1.5], label:'Inductive supply (dash-dot, one side)', sample:'inductive-supply'},
  {id:'linear-motors', when:['propulsion_linear_motor'], offset:0, width:1.5, dash:null, color:'#7b3fa0', label:'Linear motor (purple centre line)', sample:'linear-motor'},
  {id:'rack-traction', when:['traction_rack'], offset:0, width:5, dash:[0.4,1.2], color:'#33302c', label:'Rack railway (ladder ticks)', sample:'rack-traction'},
  {id:'cable-traction', when:['traction_cable'], offset:-3.5, width:1.5, dash:[5,2], color:'#33302c', label:'Cable traction (long dashes, one side)', sample:'cable-traction'},
].map(Object.freeze));
// Shared by the map's facility layers and legend: one neutral ink and
// man-made fill for every kind, as topographic maps draw built structures.
export const POWER_FACILITY_SYMBOL = Object.freeze({paper:'#fffef8', ink:'#3d4247', fill:'#8c8f92'});
// The legend keys the drawing, not a list of kinds: what a facility is shows
// on hover and in its details.
export const POWER_FACILITY_LEGEND = Object.freeze([
  {symbol:'shape',geometry:'area',label:'Railway power or servicing facility (mapped outline)'},
  {symbol:'shape',geometry:'point',label:'Railway power or servicing facility (mapped point)'},
].map(Object.freeze));
// Both the help page and legend explanation use the actual marker categories.
// Storage and generation are evidence about a supply, not proof of servicing.
export const POWER_FACILITY_LIMITS = `Railway power and servicing facilities (substations, power stations, converters, refuelling and charging points, coaling stages, water towers, tanks and cranes) are drawn as they are mapped: outlines for areas, small dots for points. Hover or select one for what it is, its name and supplies. Tanks show mapped railway storage; storage alone does not establish a train servicing point. Dashed, faint shapes are planned or former facilities when those are enabled. The whole electricity grid and wider fuel supply chain are not yet covered. Missing facilities do not establish an absence of supplies; mapped facilities do not establish current availability.`;
export const POWER_METHOD_NOTE = `Track strokes: overhead contact line is the track colour alone; ${POWER_METHOD_STROKES.map(({label})=>label).join('; ')}.`;
export const ELECTRICITY_SIGNAL_NOTE = `Small amber dots with a dark outline are electrification signals, such as lower pantograph, main switch off and end of catenary, wherever a signal records railway:signal:electricity; they show mapped locations, not live aspects.`;
export const POWER_FACILITY_EXPLANATION = `${POWER_METHOD_NOTE} ${ELECTRICITY_SIGNAL_NOTE} ${POWER_FACILITY_LIMITS}`;
const SUPPLIES = new Set(['fuel','coaling_facility','water_tower','water_tank','water_crane','power_supply','preheating','charging_station']);
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

// Electrification signal details: the recorded signal value and its
// electricity attributes. A marker is a mapped location, not a live aspect.
export function electricitySignalRows(properties = {}) {
  const p=properties,human=value=>value==null||String(value).trim()===''?undefined:String(value).replaceAll('_',' ');
  return [
    ['Signal',p['railway:signal:electricity']],['Function',human(p['railway:signal:electricity:type'])],
    ['Form',human(p['railway:signal:electricity:form'])],['Applies to',human(p['railway:signal:electricity:for'])],
    ['Turn direction',human(p['railway:signal:electricity:turn_direction'])],
    ['Voltage',p['railway:signal:electricity:voltage']],
    ['Frequency',p['railway:signal:electricity:frequency']?`${p['railway:signal:electricity:frequency']} Hz`:undefined],
    ['Status',p.power_state==='deactivated'?'Deactivated':undefined],['Reference',p.ref],
    ['Facing',human(p['railway:signal:direction'])],
  ].filter(([,value])=>value!=null&&String(value).trim()!=='');
}

// Keep independent source attributes independent. A generating source (solar,
// hydro, wind or a combustible input) is not fuel offered to trains, and stored
// contents do not prove a refuelling point. Preserve raw fuel:* declarations,
// including negative/unknown values, so a positive tag never conceals a conflict.
// fuel:* also records non-fuel supplies such as AdBlue; never promote every
// positive key into a fuel claim or require a fixed vocabulary of supply types.
const fuelTagsOf=p=>Object.entries(p).filter(([key,value])=>key.startsWith('fuel:')&&key.length>5&&value!=null&&String(value).trim()).sort(([a],[b])=>a.localeCompare(b));
// Supplies declared by fuel=* values and positive fuel:<type>=yes keys, in the
// mapper's own words; no fixed vocabulary.
export function powerFacilityFuels(p = {}) {
  const direct=String(p.fuel??'').split(';').map(value=>value.trim()).filter(Boolean);
  return [...new Set([...direct.filter(value=>!/^(yes|no|unknown)$/i.test(value)),...fuelTagsOf(p).filter(([key,value])=>/^fuel:[^:]+$/.test(key)&&String(value).trim().toLowerCase()==='yes').map(([key])=>key.slice(5))])];
}
export function powerFacilityEnergyRows(properties = {}) {
  const p=properties;
  const fuelTags=fuelTagsOf(p),types=powerFacilityFuels(p);
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
