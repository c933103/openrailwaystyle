import {displayName, aerialwayKind, formatSpeed} from './map-model.mjs?v=20261116-energy-stack-1';
import {powerFacilityName, powerFacilityEnergyRows} from './power-facilities.mjs?v=20261116-energy-stack-1';
import {contextDescription} from './context.mjs?v=20261116-energy-stack-1';
import {CROSSING_TAGS} from './crossing-tags.mjs?v=20261116-energy-stack-1';
import {trainProtection, trainProtectionShort, CONTROL_FAMILIES, CONTROL_LEVELS} from './map-model.mjs?v=20261116-energy-stack-1';

// DOM helpers shared by the feature inspector and train-protection legend.
export function createInspectorRows(textNode) {
function row(dl, label, value) {
  if (value === undefined || value === null || value === '') return;
  dl.append(textNode('dt', label), textNode('dd', String(value)));
}
function controlSystemLabel(code) {
  const system = trainProtection(code), family = system && CONTROL_FAMILIES[system[2]];
  const description = system
    ? [system[1], CONTROL_LEVELS[system[3]], code !== 'none' && family?.note].filter(Boolean).join(' · ')
    : `${code} · Recorded system; classification is not available`;
  const details = textNode('details', '', 'system-label');
  const summary = textNode('summary', trainProtectionShort(code)); summary.title = description;
  details.append(summary, textNode('p', description, 'system-description'));
  return details;
}
function controlSystemRow(dl, label, codes) {
  if (!codes.length) return;
  const values = textNode('dd', '', 'system-list');
  for (const code of codes) values.append(controlSystemLabel(code));
  dl.append(textNode('dt', label), values);
}
  return {row, controlSystemLabel, controlSystemRow};
}

export function createFeatureInspector({document, $, textNode, row, settings, osmLink,
  signalSources, getCurrentFeature, nearestCrossing, crossingDataHasTags}) {
function showAerialwayDetails(feature) {
  const p = feature.properties, panel = $('detail-content'), dl = document.createElement('dl');
  panel.replaceChildren(textNode('div', 'AERIALWAY', 'eyebrow'), textNode('h2', displayName(p, settings.language) || 'Unnamed aerialway'));
  row(dl, 'Kind', aerialwayKind(p.aerialway)?.label);
  row(dl, 'Type', p.aerialway?.replaceAll('_', ' '));
  row(dl, 'Owner', p.owner);
  row(dl, 'Maximum speed', typeof p.maxspeed === 'number' ? formatSpeed({maxspeed: p.maxspeed}, settings.units).mapped : undefined);
  panel.append(dl);
  osmLink(panel, feature);
  $('details').hidden = false;
}

function showRailwayPointDetails(feature) {
  const p=feature.properties,signal=signalSources().includes(feature.source),panel=$('detail-content');
  panel.replaceChildren(textNode('div',signal?'RAILWAY SIGNAL':'STATION ENTRANCE','eyebrow'));
  panel.append(textNode('h2',signal?(p.ref?`Signal ${p.ref}`:'Railway signal'):(p.label||'Station entrance')));
  const dl=document.createElement('dl');
  row(dl,signal?'Reference':'Entrance label',signal?p.ref:p.label);
  if(signal){
    row(dl,'Caption',p.caption);
    const categories=[...new Set(Array.from({length:12},(_,i)=>p[`category${i}`]).filter(Boolean))];
    row(dl,'Mapped functions',categories.map(v=>String(v).replaceAll('_',' ')).join(', '));
    const inactive=[...new Set(Array.from({length:12},(_,i)=>p[`deactivated${i}`]===true?p[`category${i}`]:null).filter(Boolean))];
    row(dl,'Inactive components',inactive.map(v=>String(v).replaceAll('_',' ')).join(', '));
    row(dl,'Facing',p.direction_both===true?'Both directions':typeof p.azimuth==='number'&&Number.isFinite(p.azimuth)?`${Math.round(((p.azimuth%360)+360)%360)}° clockwise from north`:undefined);
  }
  panel.append(dl,textNode('p',signal?'A mapped signal location and its recorded functions. The marker does not show a live signal aspect.':'A station entrance recorded in OpenStreetMap.','small'));
  osmLink(panel,feature);$('details').hidden=false;
}
function showPowerFacilityDetails(feature) {
  const p=feature.properties, panel=$('detail-content'), label=feature.source?.startsWith('energyNetwork')?String(p.energy_kind||'Energy supply').replaceAll('_',' '):feature.source==='electricSubstations'?'Traction substation':feature.source==='electricCatenary'?(p.feature==='portal'?'Catenary portal':'Catenary mast'):powerFacilityName(p);
  panel.replaceChildren(textNode('div','RAILWAY ENERGY SUPPLY','eyebrow'),textNode('h2',displayName(p,settings.language)||p.ref||label));
  const dl=document.createElement('dl');
  row(dl,'Type',label); row(dl,'Status',p.power_state||(feature.source==='electricSubstations'?'Not recorded':'present')); row(dl,'Reference',p.ref);
  row(dl,'Operator',p.operator); row(dl,'Owner',p.owner); row(dl,'Voltage',p.voltage); row(dl,'Frequency',p.frequency!==undefined&&p.frequency!==null&&p.frequency!=='' ? `${p.frequency} Hz` : undefined);
  for(const [label,value] of powerFacilityEnergyRows(p))row(dl,label,value);
  row(dl,'Output',p['plant:output:electricity'] || p['generator:output:electricity']); row(dl,'Capacity',p.capacity);
  row(dl,'Charging output',p['charging_station:output']);row(dl,'Rail vehicle charging',p.train || p.tram || p.light_rail || p.subway);
  for(const [key,value] of Object.entries(p))if(/^socket:/.test(key))row(dl,key,value);
  row(dl,'Mapped as',p.railway || p.power || p.man_made || p.amenity); panel.append(dl); osmLink(panel,feature);
  $('details').hidden=false;
}
function showInfrastructureContext(feature) {
  const p=feature.properties,crossing=feature.sourceLayer==='points_of_interest';
  const panel=$('detail-content');panel.replaceChildren(textNode('div','RAILWAY INFRASTRUCTURE','eyebrow'));
  // An overview dot (crossings merged per tile, without ids): the nearest
  // crossing in the detailed crossing tiles.
  if(feature.sourceLayer==='level_crossings' && !Number.isInteger(feature.id) && feature.clickLngLat) {
    const pending=feature;
    nearestCrossing(feature.clickLngLat).then(found=>{ if(getCurrentFeature()===pending) showInfrastructureContext(found ? {...pending, ...found} : {...pending, clickLngLat: null}); });
    return;
  }
  // A dot from the worldwide crossing tiles: its kind and OSM node only.
  if(feature.sourceLayer==='level_crossings') {
    panel.append(textNode('h2',p.kind==='foot'?'Pedestrian level crossing':'Road level crossing'));
    osmLink(panel,feature);
    if(Number.isInteger(feature.id)) {
      // The crossing snapshot's detail tiles carry the tags themselves.
      const dl=document.createElement('dl');
      for(const [key,label] of CROSSING_TAGS) row(dl,label,typeof p[key]==='string'?p[key].replaceAll('_',' ').replaceAll(';',', '):undefined);
      if(p.tags_unreadable) panel.append(textNode('p','This crossing\'s tags could not be read into the map data; the crossing on OpenStreetMap shows them.','small'));
      else if(dl.children.length) panel.append(dl,textNode('p','From the crossing\'s OpenStreetMap tags; absence of a tag does not prove absence of equipment.','small'));
      else {
        const note=textNode('p','','small');panel.append(note);
        crossingDataHasTags().then(tags=>{note.textContent=tags?'No equipment is tagged on this crossing in OpenStreetMap.':'Equipment details come with the next crossing data update; the crossing on OpenStreetMap shows them now.';});
      }
    } else panel.append(textNode('p','Zoom in to pick out a single crossing.','small'));
    $('details').hidden=false;
    return;
  }
  panel.append(textNode('h2',crossing ? (p.feature==='general/crossing'?'Pedestrian level crossing':'Road level crossing') : 'Track in shared roadway'));
  const dl=document.createElement('dl');row(dl,'Name',displayName(p,settings.language));row(dl,'Reference',p.ref);
  if(crossing) {
    row(dl,'Mapped equipment',p.feature?.includes('light-barrier')?'Lights and barriers':p.feature?.includes('barrier')?'Barriers':p.feature?.includes('light')?'Lights':'No equipment specified in the tile');
  } else {row(dl,'Evidence',p.evidence);row(dl,'Access',p.access);row(dl,'Vehicle access',p.motor_vehicle);}
  panel.append(dl,textNode('p',crossing?'Equipment details follow the mapped feature; absence of a tag does not prove absence of equipment.':'Only explicitly mapped shared roadway is highlighted. Untagged street running can be missing.','small'));
  osmLink(panel,feature);
  $('details').hidden=false;
}
function showContextDetails(feature) {
  const p = feature.properties, category = contextDescription(p,feature.sourceLayer);
  const panel = $('detail-content'); panel.replaceChildren();
  panel.append(textNode('div',category?.group === 'transport' ? 'TRANSPORT FACILITY' : category?.group === 'constraints' ? 'PLANNING CONTEXT' : 'PASSENGER DESTINATION','eyebrow'));
  panel.append(textNode('h2',displayName(p,settings.language) || category?.label || 'Mapped area'));
  const dl = document.createElement('dl');
  row(dl,'Type',category?.label || p.subclass || p.class);
  row(dl,'Mapped as',p.subclass || p.class);
  row(dl,'Airport code',p.iata || p.icao);
  row(dl,'Reference',p.ref);
  row(dl,'Access',p.access);
  panel.append(dl);
  panel.append(textNode('p',category?.group==='constraints'?'Mapped boundaries and sites provide planning context. Consult the responsible authority for jurisdiction, access and development requirements.':'Mapped facilities and land use show potential trip destinations, not measured passenger demand.','small'));
  osmLink(panel, feature);
  $('details').hidden = false;
}
  return {showAerialwayDetails, showRailwayPointDetails, showPowerFacilityDetails, showInfrastructureContext, showContextDetails};
}
