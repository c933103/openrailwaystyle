import {ENERGY_DOMAINS,ENERGY_NETWORK_LINES} from './energy-network.mjs?v=20261125-departures-globe-1';
import {speedBands, INFRASTRUCTURE, currentKey, NOT_ELECTRIFIED, NO_PROTECTION, UNKNOWN_COLOR, AERIALWAY_KINDS, AERIALWAY_CABLE, AERIALWAY_TICK, CONVEYING_COLOUR, INACTIVE_STATES, LIFECYCLE_PATTERNS} from './map-model.mjs?v=20261125-departures-globe-1';
import {POWER_FACILITY_SYMBOL, POWER_METHOD_STROKES, POWER_FACILITY_LEGEND, ELECTRICITY_SIGNAL_STYLE, ELECTRICITY_SIGNAL_NOTE, POWER_FACILITY_LIMITS} from './power-facilities.mjs?v=20261125-departures-globe-1';
import {FREQUENCY_LABELS, selectedFrequencyProfile, frequencyWidth} from './service-frequency.mjs?v=20261125-departures-globe-1';
import {serviceCoverageMessages} from './service-status.mjs?v=20261125-departures-globe-1';

// State is retained by the application; each render reads current settings and coverage.
export function renderLegendUI({document, $, textNode, settings, inView, legendState,
  serviceDataStatus, periodCovered, controlSystemLabel}) {
function powerFacilitySwatch({geometry}, includeFormer) {
  const {paper,ink,fill} = POWER_FACILITY_SYMBOL, ns='http://www.w3.org/2000/svg';
  const sample = textNode('span', '', `point-swatch${includeFormer ? ' paired' : ''}`);
  sample.setAttribute('aria-hidden','true');
  for (const former of includeFormer ? [false,true] : [false]) {
    const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 16 16');
    const shape=geometry==='area'?document.createElementNS(ns,'rect'):document.createElementNS(ns,'circle');
    const attrs=geometry==='area'
      ?{x:2,y:3,width:12,height:10,fill,'fill-opacity':former?0.1:0.3,stroke:ink,'stroke-width':1,'stroke-opacity':former?0.6:1,...(former?{'stroke-dasharray':'2 2'}:{})}
      :{cx:8,cy:8,r:2.6,fill:former?paper:ink,stroke:former?ink:paper,'stroke-width':former?1:0.8};
    for (const [key,value] of Object.entries(attrs)) shape.setAttribute(key,value);
    svg.append(shape);sample.append(svg);
  }
  return sample;
}
// A track sample drawn from the same stroke definition as the map layer: the
// track in a sample system colour and the method stroke beside or along it.
// MapLibre dashes are in line widths; positive offsets lie right of the line.
// Draw every stroke the map draws for a track with only this means: a
// fourth-rail track shows the conductor-rail stroke as well as its own.
function powerMethodSwatch(stroke) {
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),system='#3f6fa8';
  svg.setAttribute('viewBox','0 -3 25 20');svg.setAttribute('width','25');svg.setAttribute('height','20');svg.setAttribute('aria-hidden','true');svg.classList.add('method-swatch');
  const line=(attrs)=>{const el=document.createElementNS(ns,'line');for(const [k,v] of Object.entries({x1:0,x2:25,...attrs}))el.setAttribute(k,v);svg.append(el);};
  line({y1:7,y2:7,stroke:system,'stroke-width':2.5});
  const strokes=stroke?POWER_METHOD_STROKES.filter(s=>s.when.includes(stroke.when[0])):[];
  for(const s of strokes)for(const side of s.gap?[-1,1]:[0]){const y=7+s.offset+side*((s.gap||0)+s.width)/2;line({y1:y,y2:y,stroke:s.color||system,'stroke-width':s.width,'stroke-linecap':s.cap||'butt',...(s.dash?{'stroke-dasharray':s.dash.map(v=>Math.max(v,0.1)*s.width).join(' ')}:{})});}
  return svg;
}
// Cable line with ticks, matching the aerialway layers' dash lengths.
function aerialwaySwatch(kind) {
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 25 14');svg.setAttribute('width','25');svg.setAttribute('height','14');svg.setAttribute('aria-hidden','true');svg.classList.add('aerialway-swatch');
  for(const attrs of [{stroke:AERIALWAY_CABLE,'stroke-width':1},{stroke:AERIALWAY_TICK,'stroke-width':kind.tickWidth,'stroke-dasharray':kind.dash.map(v=>v*kind.tickWidth).join(' '),'stroke-dashoffset':-2}]){
    const el=document.createElementNS(ns,'line');
    for(const [k,v] of Object.entries({x1:0,x2:25,y1:7,y2:7,...attrs}))el.setAttribute(k,v);
    svg.append(el);
  }
  return svg;
}
// Thin line with the direction chevron, as the conveying layers draw it.
function conveyingSwatch() {
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 25 14');svg.setAttribute('width','25');svg.setAttribute('height','14');svg.setAttribute('aria-hidden','true');svg.classList.add('conveying-swatch');
  const line=document.createElementNS(ns,'line'),arrow=document.createElementNS(ns,'path');
  for(const [k,v] of Object.entries({x1:1,x2:24,y1:7,y2:7,stroke:CONVEYING_COLOUR,'stroke-width':1.5,'stroke-linecap':'round'}))line.setAttribute(k,v);
  for(const [k,v] of Object.entries({d:'M10 3 L15 7 L10 11',fill:'none',stroke:CONVEYING_COLOUR,'stroke-width':1.6,'stroke-linejoin':'round','stroke-linecap':'round'}))arrow.setAttribute(k,v);
  svg.append(line,arrow);return svg;
}
function networkLineSwatch(stroke) {
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),line=document.createElementNS(ns,'line');
  for(const [key,value] of Object.entries({viewBox:'0 0 25 14',width:25,height:14,'aria-hidden':'true'}))svg.setAttribute(key,value);
  for(const [key,value] of Object.entries({x1:0,x2:25,y1:7,y2:7,stroke:stroke.color,'stroke-width':2,...(stroke.dash?{'stroke-dasharray':stroke.dash.map(x=>x*2).join(' ')}:{})}))line.setAttribute(key,value);
  svg.append(line);return svg;
}
function render() {
  const box = $('legend');
  // Native details toggle events are queued. A settings/metadata redraw can
  // happen first, so preserve the displayed state before replacing its nodes.
  const previousHelp = box.querySelector(':scope > details.legend-help:not(#service-data-status)');
  const previousStatus = box.querySelector('#service-data-status');
  if (previousHelp) legendState.help = previousHelp.open;
  if (previousStatus) legendState.service = previousStatus.open;
  box.replaceChildren();
  const nothing = [['transparent', 'Nothing recorded in view', 'empty']];
  const listed = rows => rows.length ? rows : nothing;
  const legends = {
    speed: { title: `Mapped maximum speed · ${settings.units === 'imperial' ? 'mph' : 'km/h'}`, rows: speedBands(settings.units).map(b => [b.color, b.label]) },
    infrastructure: { title: 'Railway infrastructure', rows: INFRASTRUCTURE },
    // A fixed key of exact values (one row per voltage and current), not an in-view list.
    electrification: { title: 'Railway power', rows: [...currentKey(), [NOT_ELECTRIFIED, 'Not electrified']] },
    control: { title: 'Train protection · in view', rows: [...listed(inView), [NO_PROTECTION, 'No train protection']] },
    gauge: { title: 'Track gauge · in view', rows: listed(inView) },
    axle: {title:'Axle load · in view',rows:listed(inView)},
    loading: { title: 'Loading gauge · in view', rows: listed(inView) },
    owner: { title: 'Infrastructure owner · in view', rows: listed(inView) },
    service: { title: 'Urban rail services · in view', rows: listed(inView) },
  };
  const legend = legends[settings.mode];
  box.append(textNode('h2', legend.title));
  const grid = textNode('div', '', 'legend-grid');
  const rows = [...legend.rows];
  if (settings.mode === 'gauge') rows.push(['#1f5fbf', 'Dual gauge (one half per gauge)', 'dual']);
  if (settings.mode === 'service') rows.push(['#b8c0c5', 'Other track']);
  else if (settings.mode !== 'infrastructure') rows.push([UNKNOWN_COLOR, 'Unknown']);
  rows.push(['#2356b6','Bridge','bridge'], ['#2356b6','Tunnel','tunnel']);
  if (settings.mode === 'control') rows.push(['#765484','Signal']);
  if (settings.mode === 'electrification') rows.push(...POWER_FACILITY_LEGEND,...ENERGY_NETWORK_LINES.map(stroke=>({symbol:'network-line',stroke,label:stroke.label})),...Object.values(ENERGY_DOMAINS).map(({color,label})=>({symbol:'dot',color,stroke:'#fffef8',label})),{symbol:'dot',color:ELECTRICITY_SIGNAL_STYLE.color,label:'Electrification signal'},{symbol:'method',label:'Overhead contact line (track colour alone)'},...POWER_METHOD_STROKES.map(stroke=>({symbol:'method',stroke,label:stroke.label})));
  if (settings.mode === 'infrastructure') rows.push({symbol:'method',stroke:POWER_METHOD_STROKES.find(({id})=>id==='rack-traction'),label:'Rack railway (ladder ticks)'});
  if (['infrastructure','electrification'].includes(settings.mode)) rows.push(...AERIALWAY_KINDS.map(kind=>({symbol:'aerialway',kind,label:kind.label})),{symbol:'conveying',label:'Escalator, moving walkway or elevator (arrow: direction)'});
  if (settings.mode === 'infrastructure') rows.push(['#b68f55','Shared roadway','street-running'], ['#63332c','Level crossing','level-crossing'],['#765484','Signal'],['#167a78','Station entrance']);
  if (settings.inactive) rows.push(...INACTIVE_STATES.map(([state, color, label]) => [color, label, `inactive-${state}`]));
  // Existing track tuples become explicit line samples. Point categories keep
  // their geometry metadata instead of losing it in a colour/label tuple.
  for (const {symbol,color,label,extra,geometry,stroke,kind} of rows.map(row => Array.isArray(row) ? {symbol:'line',color:row[0],label:row[1],extra:row[2]} : row)) {
    const row = textNode('div', '', 'legend-item');
    const swatch = symbol==='network-line'?networkLineSwatch(stroke):symbol === 'shape' ? powerFacilitySwatch({geometry},settings.inactive) : symbol === 'method' ? powerMethodSwatch(stroke) : symbol === 'aerialway' ? aerialwaySwatch(kind) : symbol === 'conveying' ? conveyingSwatch() : symbol === 'dot' ? textNode('span','','dot-swatch') : textNode('span', '', `swatch ${extra || ''}`);
    if (symbol === 'dot') {swatch.setAttribute('aria-hidden','true');swatch.style.setProperty('--swatch', color);swatch.style.setProperty('--swatch-stroke', typeof stroke==='string'?stroke:ELECTRICITY_SIGNAL_STYLE.stroke);}
    if (symbol === 'line') swatch.style.setProperty('--swatch', color);
    if (extra?.startsWith('inactive-')) {
      const pattern=LIFECYCLE_PATTERNS[extra.slice(9)];
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),line=document.createElementNS('http://www.w3.org/2000/svg','line');
      svg.setAttribute('viewBox','0 0 62 12');svg.setAttribute('aria-hidden','true');
      for(const [key,value] of Object.entries({x1:2,x2:60,y1:6,y2:6,stroke:color,'stroke-width':2,'stroke-dasharray':pattern.dash.map(n=>n*2).join(' '),'stroke-linecap':pattern.cap})) line.setAttribute(key,value);
      svg.append(line);swatch.append(svg);swatch.classList.add('pattern-swatch');
    }
    row.append(swatch, extra?.startsWith('control-') ? controlSystemLabel(extra.slice(8)) : textNode('span', label)); grid.append(row);
  }
  if (settings.stations) {
    const station = textNode('div', '', 'legend-item'); station.append(textNode('span', '', 'station-swatch'), textNode('span', 'Station')); grid.append(station);
  }
  if (settings.mode === 'infrastructure') {
    for (const [kind, label] of [['', 'Tracks side by side'], ['tunnel', 'All in tunnel'], ['station', 'Tracks at station']]) {
      const tracks = textNode('div', '', 'legend-item'); tracks.append(textNode('span', '2', `track-badge-swatch ${kind}`), textNode('span', label)); grid.append(tracks);
    }
  }
  box.append(grid);
  if(settings.mode==='service'&&settings.serviceWidth==='frequency'){
    const key=textNode('div','','frequency-key');
    key.append(textNode('p',FREQUENCY_LABELS[selectedFrequencyProfile(settings)],'small'));
    for(const rate of [1,6,12,24,30]){const sample=textNode('span','','frequency-sample'),mark=textNode('i');mark.style.height=frequencyWidth(rate)+'px';sample.append(mark,textNode('span',`${rate===30?'30+':rate}/h`));key.append(sample);}
    key.append(textNode('p','Subdued line: frequency is unavailable; open service details for its recorded status. Departure timetables may still be available. Rates are per direction; published headways are estimates.','small'));box.append(key);
  }
  const notes = {
    speed: settings.units === 'imperial' ? 'Labels in mph; limits tagged in mph keep their directional values. Grey means no numeric limit is recorded.' : 'Labels keep tagged units: bare numbers are km/h, mph is written out. Grey means no numeric limit is recorded.',
    electrification: `Track hue is the current type (DC, or AC by frequency); darker is higher voltage. A train needs both to match, unless built for several systems. ${ELECTRICITY_SIGNAL_NOTE} ${POWER_FACILITY_LIMITS} Strokes beside or along the track show how power reaches the train where mapped (third, fourth or ground-level rail, inductive supply; overhead contact line is the track colour alone) and linear motor, rack or cable traction; each has its own legend sample. Catenary masts and portals appear at close zoom. Grey means not recorded.`,
    control: 'Hue groups related systems; darker is more advanced: warning only, spot transmission, continuous, radio. Parallel colour bands show each recorded system on a shared track. Hover a system name for its description, or tap/click it to expand. Purple dots mark mapped signals, not live aspects. Grey means nothing is recorded.',
    gauge: 'Gauges a few millimetres apart (e.g. 1432 and 1435, 1520 and 1524) share one colour and are generally compatible. Click a track for all recorded gauges. Grey means not recorded.',
    axle: 'Colour shows the mapped axle load or the load category’s reference axle load. Load per metre and additional operating restrictions also matter. Numeric US/Canadian classes describe speed, and Finnish superstructure classes do not give a single axle-load limit. Grey means not recorded.',
    loading: 'Colour follows the envelope’s height above rail, so equal sizes match across regions; Britain’s W gauges share one height and form their own ladder. Click a track for dimensions. Grey means not recorded.',
    owner: 'Each owner of the infrastructure, as recorded in OpenStreetMap, has its own colour, the same everywhere; the owner is not always the operator. Click a track for its owner and operator. Grey means no owner is recorded.',
    service: 'Urban rail services mapped in OpenStreetMap (metro, light rail, tram, monorail and commuter rail), each in its own colour along the tracks it runs on. Frequency widths use matched timetable counts on covered sections, with published headway estimates for missing periods. Frequency and OpenStreetMap service coverage are partial; grey tracks have no service mapped.',
    infrastructure: 'Numbers in boxes count mapped tracks: running tracks side by side (not sidings, yards or crossovers), on every level; at a station, sidings are included. Ochre marks shared roadway; crossings are brown. Zoom in for platform references and complete boarding-edge lengths, purple signal locations and teal station entrances. Signal markers do not show a live aspect.',
  };
  let note = notes[settings.mode];
  note+=settings.mode==='infrastructure'
    ?' At world scales, OSM reference lines preserve corridor geometry when thematic data is unavailable, coloured from their own mapped high-speed and main/branch tags; a line without a main/branch tag shows as Railway. From zoom 8, solid basemap references use recorded rail kind and service tags; detailed tracks add the provider attributes.'
    :' At world scales, grey OSM reference lines appear only after the selected track source fails in the current viewport. Darker grey is mapped mainline; lighter grey is branch; dashed grey has no mapped main/branch classification. From zoom 8, dashed grey basemap railways provide the same outage reference; they do not establish operating status or any missing railway attributes.';
  if(settings.mode==='service'&&settings.serviceWidth==='frequency')note+=' Width uses the same capped scale across periods, using the lower directional rate or the lower bound of a published range. Morning and evening peaks are separate.'+(periodCovered('overnight')||periodCovered('hour')?' Overnight and individual hours use each agency’s local time on the reference date; temporary operating changes may be absent.':'')+' Missing, expired or unmatched profiles remain unavailable.';
  if (settings.inactive && settings.mode === 'speed') note += ' Planned and former lines take the colour of their recorded limit, if any.';
  // Collapsed by default, so the legend stays short; stays open once opened.
  const help = Object.assign(textNode('details', '', 'legend-help'), {open: legendState.help});
  help.append(textNode('summary', 'How to read this view'), textNode('p', note, 'legend-note'));
  help.addEventListener('toggle', () => { if (help.isConnected) legendState.help = help.open; });
  box.append(help);
  if(settings.mode==='service'){
    const dataStatus=Object.assign(textNode('details','','legend-help'),{open:legendState.service});dataStatus.id='service-data-status';
    dataStatus.addEventListener('toggle',()=>{if(dataStatus.isConnected)legendState.service=dataStatus.open;});
    dataStatus.append(textNode('summary','Service data status'));
    for(const message of serviceCoverageMessages(serviceDataStatus))dataStatus.append(textNode('p',message,'legend-note'));
    const link=textNode('a','Published snapshot status');link.href=new URL('./data/service-routes/frequency-manifest.json',import.meta.url).href;
    link.target='_blank';link.rel='noopener';dataStatus.append(link);box.append(dataStatus);
  }
}
  render();
}
