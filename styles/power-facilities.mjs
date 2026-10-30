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
// One pictogram per kind of object, so the map shows what each point is (a
// water crane, a water tower, a tank…), not only which supply it serves.
// Paths are on a 24-unit grid, stroked; colour still shows the supply group.
export const POWER_FACILITY_ICONS = Object.freeze({
  substation:'M4 5 H20 V19 H4 Z M13 7 L9 12.5 H13 L11 17',
  plant:'M3 21 V12 L8 9 V12 L13 9 V12 L18 9 V21 Z M15.5 9 V3 H18 V9',
  generator:'M20 12 A8 8 0 1 1 4 12 A8 8 0 1 1 20 12 Z M7.5 12 Q9.75 8.5 12 12 Q14.25 15.5 16.5 12',
  converter:'M4 4 H20 V20 H4 Z M4 20 L20 4 M6.5 9 Q7.75 7 9 9 Q10.25 11 11.5 9 M13 15.5 H18 M13 17.5 H18',
  transformer:'M14 12 A5 5 0 1 1 4 12 A5 5 0 1 1 14 12 Z M20 12 A5 5 0 1 1 10 12 A5 5 0 1 1 20 12 Z',
  feeder:'M3 5 H21 M12 21 V8 M8 12 L12 8 L16 12',
  power_supply:'M8 3 V7 M16 3 V7 M5 7 H19 V11 Q19 17 12 17 Q5 17 5 11 Z M12 17 V21',
  preheating:'M4 21 V9 H12 V21 Z M8 9 V5 M6 13 H10 M15 8 Q17 10 15 12 Q13 14 15 16 M18.5 8 Q20.5 10 18.5 12 Q16.5 14 18.5 16',
  charging_station:'M3 7 H18 V17 H3 Z M18 10 H20.5 V14 H18 M11.5 8.5 L8 12.5 H11.5 L9.5 15.5',
  fuel:'M5 21 V4 H13 V21 Z M3.5 21 H14.5 M7 7 H11 V10.5 H7 Z M13 9 H16 L18 11 V17 Q18 18.5 16.75 18.5 Q15.5 18.5 15.5 17 V13 H13',
  fuel_tank:'M7 7 H17 Q20 7 20 12 Q20 17 17 17 H7 Q4 17 4 12 Q4 7 7 7 Z M7 7 Q10 7 10 12 Q10 17 7 17 M7 17 V21 M17 17 V21',
  coaling_facility:'M4 4 H20 L15.5 11 H8.5 Z M8.5 11 L7 21 M15.5 11 L17 21 M12 11 V14 L16 16',
  water_tower:'M6 4 H18 V11 H6 Z M8 11 L6.5 21 M16 11 L17.5 21 M7.3 16 H16.7',
  water_tank:'M5 8 Q12 5 19 8 V18 Q12 21 5 18 Z M5 8 Q12 11 19 8 M9 14.5 Q10.5 13 12 14.5 Q13.5 16 15 14.5',
  water_crane:'M7 21 H13 M10 21 V5 H18 V9 M16.5 9 H19.5 M18 12 V13.5 M18 16 V17.5',
});
export const powerIconId = (kind, former=false) => `power-${kind}${former?'-former':''}`;
// Operating: a filled tile in the supply colour with a light pictogram.
// Planned or former: a light tile with a dashed edge and a coloured pictogram.
export function powerIcon(id, document) {
  const match=/^power-([a-z_]+?)(-former)?$/.exec(id),kind=match?.[1],definition=POWER_FACILITY_KINDS[kind];
  if (!definition || !POWER_FACILITY_ICONS[kind]) return null;
  const former=Boolean(match[2]),{paper}=POWER_FACILITY_SYMBOL,canvas=document.createElement('canvas');canvas.width=48;canvas.height=48;
  const ctx=canvas.getContext('2d');ctx.scale(2,2);
  ctx.fillStyle=former?paper:definition.color;ctx.strokeStyle=former?definition.color:paper;ctx.lineWidth=former?1.5:1;
  if(former)ctx.setLineDash([3,2]);
  ctx.beginPath();ctx.roundRect(0.75,0.75,22.5,22.5,5);ctx.fill();ctx.stroke();ctx.setLineDash([]);
  ctx.save();ctx.translate(2,2);ctx.scale(20/24,20/24);
  ctx.strokeStyle=former?definition.color:paper;ctx.lineWidth=1.9;ctx.lineJoin='round';ctx.lineCap='round';
  ctx.stroke(new Path2D(POWER_FACILITY_ICONS[kind]));ctx.restore();
  return ctx.getImageData(0,0,48,48);
}
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
// Shared by the map's point layers and legend; the legend samples the detailed
// marker size. Lifecycle changes only the fill, stroke and letter colour.
export const POWER_FACILITY_SYMBOL = Object.freeze({paper:'#fffef8', radius:6.5, textSize:9, stroke:1.5, formerStroke:2});
// Every kind of point has its own legend row and pictogram; the legend is a
// fixed key, not a list of what happens to be in view.
export const POWER_FACILITY_LEGEND = Object.freeze(Object.entries(POWER_FACILITY_KINDS).map(([kind,{label,color}])=>
  Object.freeze({symbol:'point',kind,color,label:kind==='fuel'?`${label} (supplies written beside it)`:label})));
// Both the help page and legend explanation use the actual marker categories.
// Storage and generation are evidence about a supply, not proof of servicing.
export const POWER_FACILITY_LIMITS = `Fuel and water tanks show mapped railway storage; storage alone does not establish a train refuelling or steam servicing point. Light, dashed-edged pictograms identify planned or former facilities when those are enabled. The whole electricity grid and wider fuel supply chain are not yet covered. Missing markers do not establish an absence of supplies; mapped facilities do not establish current availability.`;
export const POWER_METHOD_NOTE = `Track strokes: overhead contact line is the track colour alone; ${POWER_METHOD_STROKES.map(({label})=>label).join('; ')}.`;
export const POWER_FACILITY_EXPLANATION = `Each point has a pictogram for what it is, coloured by the supply it serves: ${POWER_FACILITY_LEGEND.map(({label})=>label).join('; ')}. ${POWER_METHOD_NOTE} ${POWER_FACILITY_LIMITS}`;
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
// What the map writes beside a point: its kind, and for fuel the supplies.
export function powerFacilityDisplay(p = {}) {
  if (!p.power_kind) return {};
  const fuels=powerFacilityFuels(p).map(value=>value.replaceAll('_',' '));
  return {power_label:powerFacilityName(p)+(['fuel','fuel_tank'].includes(p.power_kind)&&fuels.length?` · ${fuels.join(', ')}`:'')+(p.power_state&&p.power_state!=='present'?` (${p.power_state})`:'')};
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
