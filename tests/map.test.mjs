import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import * as styleSpec from '@maplibre/maplibre-gl-style-spec';
import { SPEED_BANDS, UNKNOWN_COLOR, numericSpeed, speedColor, formatSpeed, stationRank, readSettings, osmObject } from '../styles/map-model.mjs';
const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));

test('unknown speed is never turned into zero, low speed, or high-speed-class inference', () => {
  for (const value of [undefined, null, '', 'none', 'signals', '160', NaN, Infinity, -1]) {
    assert.equal(numericSpeed(value), null);
    assert.equal(speedColor(value), UNKNOWN_COLOR);
  }
  assert.equal(speedColor(0), SPEED_BANDS[0].color);
  assert.equal(formatSpeed({ highspeed: true }).mapped, 'Not recorded / not numeric');
});
test('all speed bands have correct inclusive boundaries', () => {
  for (const [i, band] of SPEED_BANDS.entries()) {
    assert.equal(speedColor(band.min), band.color);
    if (i) assert.equal(speedColor(band.min - 0.01), SPEED_BANDS[i - 1].color);
  }
  assert.equal(speedColor(500), SPEED_BANDS.at(-1).color);
});
test('source mph and directional speed labels are preserved', async () => {
  // Brackets only for a converted value.
  assert.deepEqual(formatSpeed({ maxspeed: 160.9344, speed_label: '100 mph' }), { mapped: '160.9 km/h (100 mph)', tagged: '100 mph' });
  assert.equal(formatSpeed({ maxspeed: 160.9344, speed_label: '100 mph' }, 'imperial').mapped, '100 mph');
  assert.equal(formatSpeed({ maxspeed: 160, speed_label: '160' }).mapped, '160 km/h');
  assert.equal(formatSpeed({ maxspeed: 160, speed_label: '160' }, 'imperial').mapped, '99.4 mph (160 km/h)');
  assert.equal(formatSpeed({ maxspeed: 160, speed_label: '160 / 120' }).tagged, '160 / 120 km/h');
  assert.equal(formatSpeed({ maxspeed: 56, speed_label: '30 knots' }).tagged, '30 knots');
  assert.deepEqual([{station: 'subway', station_size: 'small'}, {station: 'tram', station_size: 'large'}, {feature: 'tram_stop'}, {station: 'light_rail', station_size: 'large'}, {station: 'train', station_size: 'large'}]
    .map(stationRank), [2, 4, 4, 3, 0], 'a clicked metro station is chosen over a large tram stop, as drawn');
  assert.ok(stationRank({station: 'train', station_size: 'large', state: 'abandoned'}) > stationRank({feature: 'tram_stop'}), 'former stations after every operating one');
  const layerIds = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url))).layers.map(l => l.id);
  assert.ok(layerIds.indexOf('station-former-dots') < layerIds.indexOf('station-stations-dots'), 'former station dots drawn under operating ones, as clicks pick them');
  assert.equal(formatSpeed({ maxspeed: 80.4672, speed_label: '50 mph (30 mph)' }).tagged, '50 mph (30 mph)');
  assert.equal(formatSpeed({ speed_label: '- / 80' }).tagged, '- / 80 km/h');
});
test('shared URLs keep display settings and reject invalid map modes', () => {
  assert.deepEqual(readSettings('?mode=electrification&stations=0&inactive=0'), { mode:'electrification',background:'map',stations:false,trackCounts:true,labels:true,inactive:false,relief:true,names:true,autoGlobe:true,readout:true,transport:true,destinations:true,constraints:true,units:'metric',detail:0,language:'local' });
  assert.equal(readSettings('?mode=invalid').mode, 'infrastructure', 'the Infrastructure view on a first visit');
  assert.equal(readSettings('?background=hybrid&trackCounts=0').background, 'hybrid');
  assert.equal(readSettings('?background=hybrid&trackCounts=0').trackCounts, false);
  assert.equal(readSettings('?background=photo').background, 'map');
  // A remembered language applies unless the URL names one.
  assert.equal(readSettings('', {language:'ja'}).language, 'ja');
  assert.equal(readSettings('?language=ko', {language:'ja'}).language, 'ko');
  assert.equal(readSettings('', {language:'xx'}).language, 'local');
  assert.deepEqual(readSettings('?relief=1', {relief:false, stations:false, mode:'bogus', units:'imperial'}), {mode:'infrastructure',background:'map',stations:false,trackCounts:true,labels:true,inactive:true,relief:true,names:true,autoGlobe:true,readout:true,transport:true,destinations:true,constraints:true,units:'imperial',detail:0,language:'local'});
});
test('cursor readout: hemispheres, longitude wrapped, zoom and the More detail scale', async () => {
  const {formatReadout} = await import('../styles/map-model.mjs');
  assert.equal(formatReadout({lng: 139.7742639, lat: 35.7045903}, 19.11), '35.70459° N, 139.77426° E · zoom 19.1');
  assert.equal(formatReadout({lng: -43.2, lat: -22.9}, 12), '22.90000° S, 43.20000° W · zoom 12.0');
  assert.equal(formatReadout({lng: 190, lat: 0}, 3, 2), '0.00000° N, 170.00000° W · zoom 3.0 (drawn at 25%)');
  assert.equal(formatReadout({lng: -540, lat: 10}, 3), '10.00000° N, 180.00000° W · zoom 3.0');
});
test('more detail has three levels; older links and cookies hold true or 1 for the first', () => {
  assert.equal(readSettings('?detail=2').detail, 2);
  assert.equal(readSettings('?detail=1').detail, 1);
  assert.equal(readSettings('?detail=0', {detail:2}).detail, 0);
  assert.equal(readSettings('', {detail:true}).detail, 1);
  assert.equal(readSettings('', {detail:2}).detail, 2);
  assert.equal(readSettings('?detail=yes').detail, 0);
  assert.equal(readSettings('?detail=9').detail, 2);
});
test('world map has no European rail source or geographic bounds', () => {
  assert.ok(!JSON.stringify(style).includes('europe-railway'));
  for (const source of Object.values(style.sources)) assert.equal(source.bounds, undefined);
  const ids = style.layers.map(l => l.id);
  assert.equal(ids.length, new Set(ids).size);
  for (const layer of style.layers) if (layer.source) assert.ok(style.sources[layer.source], layer.id);
});
test('regional stations have collision-aware markers and progressive size thresholds', () => {
  const visible = (layer, zoom, properties) => zoom >= layer.minzoom && (layer.maxzoom === undefined || zoom < layer.maxzoom) && featureFilter(layer.filter).filter({zoom}, {type:1,properties});
  const layers = style.layers.filter(l => l.id.startsWith('station-'));
  const shown = (zoom, properties) => layers.some(layer => visible(layer, zoom, {state:'present',feature:'station', ...properties}));
  assert.equal(shown(3.9, {station_size:'large'}),false);
  assert.equal(shown(4, {station_size:'large'}),true);
  assert.equal(shown(5.9, {station_size:'normal'}),false);
  assert.equal(shown(6, {station_size:'normal'}),true);
  assert.equal(shown(6, {station_size:'small'}),true,'zoom-7 tiles supply small stations from zoom 6');
  // MapLibre 5 rejects vector sources whose tileSize is not 512.
  for (const [id, source] of Object.entries(style.sources)) if (source.type === 'vector') assert.equal(source.tileSize ?? 512, 512, id);
  assert.match(style.sources.stationMed.url, /#minzoom=6&maxzoom=7&underzoom=7$/);
  assert.equal(shown(7, {station_size:'normal'}),true);
  assert.equal(shown(7, {station_size:'small'}),true);
  assert.equal(shown(9.9, {station_size:'small'}),true);
  assert.equal(shown(10, {station_size:'small'}),true);
  assert.equal(shown(10, {station_size:'small',feature:'halt'}),false);
  assert.equal(shown(11, {station_size:'small',feature:'halt'}),true);
  // Metro (from the first station tiles that carry it, zoom 8) before light
  // rail, monorail, people movers and trams (10): never the reverse.
  // (Below zoom 8 the provider's overview station tiles carry no metro at all.)
  assert.equal(shown(8, {station_size:'small',station:'subway'}),true);
  assert.equal(shown(9.9, {station_size:'large',station:'light_rail'}),false);
  assert.equal(shown(10, {station_size:'large',station:'light_rail'}),true);
  assert.equal(shown(9.9, {station_size:'small',station:'monorail'}),false);
  assert.equal(shown(10, {station_size:'small',station:'monorail'}),true);
  assert.equal(shown(9.9, {station_size:'normal',station:'tram'}),false);
  assert.equal(shown(10, {station_size:'normal',station:'tram'}),true);
  // Sized by mode: the smallest metro station outranks a "large" people mover
  // or tram station, in name size, label priority and marker size.
  const names = style.layers.find(l => l.id === 'station-detail-metro-names');
  const sizeAt = (layerId, key, zoom, properties) => {
    const layer = style.layers.find(l => l.id === layerId), value = (layer.layout[key] ?? layer.paint[key]);
    return styleSpec.expression.createPropertyExpression(value, styleSpec.latest[layer.type === 'circle' ? (key === 'circle-radius' ? 'paint_circle' : 'layout_circle') : 'layout_symbol'][key]).value.evaluate({zoom}, {type:1, properties});
  };
  const metroSmall = {state:'present', feature:'station', station:'subway', station_size:'small'};
  const moverLarge = {state:'present', feature:'station', station:'light_rail', station_size:'large'};
  const tramLarge = {state:'present', feature:'station', station:'tram', station_size:'large'};
  for (const [id, key, better] of [['station-detail-metro-names','text-size',(a,b)=>a>b], ['station-detail-metro-names','symbol-sort-key',(a,b)=>a<b], ['station-stations-dots','circle-radius',(a,b)=>a>b], ['station-stations-dots','circle-sort-key',(a,b)=>a>b]])
    for (const other of [moverLarge, tramLarge]) assert.ok(better(sizeAt(id, key, 14, metroSmall), sizeAt(id, key, 14, other)), `${key}: metro over ${other.station}`);
  assert.ok(names);
  assert.equal(shown(9.9, {feature:'tram_stop'}),false);
  assert.equal(shown(10, {feature:'tram_stop'}),true);
  for (const layer of layers) {
    if (layer.type === 'circle') assert.ok(layer.minzoom >= 12, 'unconditional dots only at local scale');
    else {
      assert.equal(layer.layout['text-allow-overlap'],false);
      assert.ok(style.layers.indexOf(layer) > style.layers.findIndex(l => l.id === 'place_label_city'));
      if (layer.minzoom < 12) {
        assert.equal(layer.layout['icon-image'],'station-dot');
        assert.equal(layer.layout['icon-allow-overlap'],false);
        assert.equal(layer.layout['icon-optional'],false);
        assert.equal(layer.layout['text-optional'],false);
        assert.equal(layer.maxzoom <= 12,true);
      }
    }
  }
});
test('every lifecycle is shown at zoom 7 without a live query or a zoom-8 handoff', () => {
  const layers=style.layers.filter(l=>/^inactive-regional-(construction|proposed|disused|former)$/.test(l.id));
  assert.equal(layers.length,4);
  assert.equal(style.sources.inactiveRegional.type,'vector');
  assert.deepEqual(style.sources.inactiveRegional.tiles,['railtiles://{z}/{x}/{y}']);
  for(const layer of layers) {assert.equal(layer.minzoom,0);assert.equal(layer.maxzoom,12);}
  // Exactly one state layer draws each feature.
  const filter={filter:(zoom,feature)=>{const hits=layers.filter(l=>featureFilter(l.filter).filter(zoom,feature)).length;assert.ok(hits<=1);return hits===1;}};
  // Construction at every zoom, proposals from z5, former lines from z7.
  const lowest={construction:0,proposed:5,disused:7,abandoned:7,razed:7};
  for(const zoom of [0,2,4.99,5,6.99]) for(const [state,min] of Object.entries(lowest)) {
    assert.equal(filter.filter({zoom},{type:2,properties:{state,feature:'rail',usage:'',service:''}}),zoom>=min,`${state} at z${zoom}`);
  }
  // Service tracks are not held back (only tram and urban kinds are).
  // Metro under construction from zoom 7 (never held back to 10).
  assert.equal(filter.filter({zoom:6.9},{type:2,properties:{state:'construction',feature:'subway'}}),false);
  assert.equal(filter.filter({zoom:7},{type:2,properties:{state:'construction',feature:'subway'}}),true);
  assert.equal(filter.filter({zoom:7},{type:2,properties:{state:'construction',feature:'rail',service:'siding'}}),true);
  // Planned and former trams wait for zoom 10, like operating ones.
  assert.equal(filter.filter({zoom:9.9},{type:2,properties:{state:'construction',feature:'tram'}}),false);
  assert.equal(filter.filter({zoom:10},{type:2,properties:{state:'construction',feature:'tram'}}),true);
  for(const zoom of [7,7.83,8,9,10,11.99]) for(const state of ['proposed','construction','disused','abandoned','razed']) {
    assert.equal(filter.filter({zoom},{type:2,properties:{state,feature:'rail',usage:'main',service:''}}),true);
  }
  for(const state of ['construction','proposed','disused','former']) assert.equal(style.layers.find(l=>l.id===`inactive-railways-${state}`).minzoom,12);
});
test('only present lines receive operating speed colours', () => {
  const layer = style.layers.find(l => l.id === 'speed-tracks');
  assert.ok(JSON.stringify(layer.filter).includes('present'));
  assert.ok(JSON.stringify(layer.paint['line-color']).includes('coalesce'));
  assert.ok(JSON.stringify(layer.paint['line-color']).includes(UNKNOWN_COLOR));
  const dashes = ['construction','proposed','disused','former'].map(state => JSON.stringify(style.layers.find(l => l.id === `inactive-railways-${state}`).paint['line-dasharray']));
  assert.equal(new Set(dashes).size, 4, 'each lifecycle state has its own dash pattern');
});
test('station labels rank heavy rail over metro, light rail, people movers and former stations', () => {
  const order = id => style.layers.findIndex(l => l.id === id);
  const detail = ['station-former-names','station-detail-mover-names','station-detail-light-rail-names','station-detail-metro-names','station-detail-halt-names','station-detail-small-names','station-detail-normal-names','station-detail-large-names'];
  // MapLibre places the topmost layer first.
  assert.deepEqual([...detail].sort((a,b)=>order(a)-order(b)), detail);
  const tier = properties => style.layers.filter(l => l.id.startsWith('station-detail-') && featureFilter(l.filter).filter({zoom:14}, {type:1,properties:{state:'present',feature:'station',...properties}})).map(l => l.id);
  assert.deepEqual(tier({station:'train',station_size:'large'}), ['station-detail-large-names']);
  assert.deepEqual(tier({station:'subway',station_size:'large'}), ['station-detail-metro-names']);
  assert.deepEqual(tier({station:'light_rail'}), ['station-detail-light-rail-names']);
  assert.deepEqual(tier({station:'monorail'}), ['station-detail-mover-names']);
  assert.deepEqual(tier({feature:'halt'}), ['station-detail-halt-names']);
  assert.deepEqual(tier({state:'abandoned'}), []);
  const former = style.layers.find(l => l.id === 'station-former-names');
  assert.equal(featureFilter(former.filter).filter({zoom:14}, {type:1,properties:{state:'abandoned',feature:'station'}}), true);
});
test('seabed contours come from finer sources from zoom 5, without duplicates', async () => {
  const {contourOptions} = await import('../styles/map-model.mjs');
  const shows = (id, zoom, ele) => { const l = style.layers.find(x => x.id === id); return zoom >= l.minzoom && zoom < (l.maxzoom ?? 24) && featureFilter(l.filter).filter({zoom}, {type:2, properties:{ele, level:1}}); };
  assert.equal(shows('terrain-contours', 8, -100), true);
  assert.equal(shows('terrain-contours', 9, -100), false);
  assert.equal(shows('terrain-contours', 9, 100), true);
  assert.equal(shows('terrain-seabed-contours', 9, -100), true);
  assert.equal(shows('terrain-seabed-contours', 9, 100), false);
  // Below zoom 9, seabed detail covers the shelf; the coarse source covers deeper water.
  assert.equal(shows('terrain-seabed-contours', 6, -100), true);
  assert.equal(shows('terrain-seabed-contours', 6, -400), false);
  assert.equal(shows('terrain-seabed-contours', 4, -100), false);
  // 50 m at zooms 5-8, 20 m at 9-10; 10 m from zoom-10 data at zoom 11, enlarged beyond.
  // Seabed tiles use elevation one zoom coarser; land contours keep full detail.
  assert.deepEqual(contourOptions('metric', 'shelf').thresholds, {5:[50,250],9:[20,100]});
  assert.equal(contourOptions('metric', 'shelf').overzoom, 1);
  assert.equal(contourOptions('metric').overzoom, undefined);
  assert.deepEqual(contourOptions('metric', 'close'), {...contourOptions('metric'), thresholds:{11:[10,50]}, overzoom:1});
  assert.equal(contourOptions('imperial', 'close').multiplier, 3.28084);
  assert.equal(contourOptions('metric').multiplier, undefined);
  assert.equal(style.sources.seabedContours.maxzoom, 10);
  assert.deepEqual([style.sources.seabedContoursClose.minzoom, style.sources.seabedContoursClose.maxzoom], [11, 11]);
  assert.equal(shows('terrain-seabed-contours', 11, -100), false);
  assert.equal(shows('terrain-seabed-contours-close', 11, -100), true);
  assert.equal(shows('terrain-seabed-contours-close', 11, 100), false);
  assert.equal(style.layers.find(l => l.id === 'terrain-seabed-contours').maxzoom, 11);
});

test('planned and former lines take speed colours only in the speed view', async () => {
  const {inactivePaint, speedPaint} = await import('../styles/map-model.mjs');
  const {expression} = await import('@maplibre/maplibre-gl-style-spec');
  const colour = (mode, properties) => expression.createExpression(inactivePaint(mode)).value.evaluate({zoom:12}, {properties});
  const planned = colour('speed', {state:'construction', maxspeed:320});
  assert.equal(String(planned), String(expression.createExpression(speedPaint('metric')).value.evaluate({zoom:12}, {properties:{maxspeed:320}})));
  assert.notEqual(String(planned), String(colour('speed', {state:'construction'})));
  assert.equal(String(colour('infrastructure', {state:'construction', maxspeed:320})), String(colour('speed', {state:'construction'})));
});
test('power view: hue by current type and frequency, shade by voltage', async () => {
  const {electrificationPaint, CURRENT_SYSTEMS, currentStops, NOT_ELECTRIFIED, describeCurrent} = await import('../styles/map-model.mjs');
  const {expression} = await import('@maplibre/maplibre-gl-style-spec');
  const e = expression.createExpression(electrificationPaint(), {type:'color'}).value;
  const rgb = properties => { const c = e.evaluate({zoom:8}, {properties}); return typeof c === 'string' ? c : [c.r, c.g, c.b].map(v => Math.round(v*255)); };
  const hex = c => '#' + c.map(v => v.toString(16).padStart(2,'0')).join('');
  const stops = id => currentStops(CURRENT_SYSTEMS.find(s => s.id === id));
  const ac = (v, hz) => hex(rgb({electrification_state:'present', voltage:v, frequency:hz}));
  const dist = (a, b) => Math.hypot(...[1,3,5].map(i => parseInt(a.slice(i,i+2),16) - parseInt(b.slice(i,i+2),16)));
  // Anchors: exact shades at the recorded voltages.
  assert.equal(ac(25000, 50), stops('ac50').find(([v]) => v === 25000)[1]);
  assert.equal(ac(15000, 16.7), stops('ac16').at(-1)[1]);
  assert.equal(ac(1500, 0), stops('dc').find(([v]) => v === 1500)[1]);
  // Same frequency, nearby voltage: close shades; different frequency: far apart.
  assert.ok(dist(ac(20000, 50), ac(25000, 50)) < dist(ac(25000, 50), ac(25000, 60)));
  assert.ok(dist(ac(25000, 50), ac(6250, 50)) > 40, 'voltage changes the shade');
  assert.notEqual(ac(20000, 50), ac(25000, 50));
  assert.equal(hex(rgb({electrification_state:'no'})), NOT_ELECTRIFIED);
  assert.equal(describeCurrent(25000, 50), '25 kV AC 50 Hz');
  assert.equal(describeCurrent(1500, 0), '1.5 kV DC');
  assert.equal(describeCurrent(750, 0), '750 V DC');
});
test('train control: hue by lineage, shade by level of advancement', async () => {
  const {controlPaint, controlColor, TRAIN_PROTECTION, CONTROL_FAMILIES, trainProtection, MODES} = await import('../styles/map-model.mjs');
  const {expression} = await import('@maplibre/maplibre-gl-style-spec');
  assert.ok(MODES.includes('control'));
  for (const id of ['control-overview','control-tracks']) assert.ok(style.layers.find(l => l.id === id), id);
  assert.equal(style.sources.control.url, 'https://openrailwaymap.app/signals_railway_line_low');
  for (const [code, , family, level] of TRAIN_PROTECTION) {
    assert.ok(CONTROL_FAMILIES[family], `${code} has a family`);
    assert.ok(level >= 0 && level <= 4, `${code} has a level`);
  }
  const hue = hex => { const [r,g,b] = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255), max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
    const h = max === r ? ((g-b)/d) % 6 : max === g ? (b-r)/d + 2 : (r-g)/d + 4; return (h*60 + 360) % 360; };
  const lightness = hex => { const [r,g,b] = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)); return (Math.max(r,g,b) + Math.min(r,g,b)) / 2; };
  const color = code => { const [, , family, level] = trainProtection(code); return controlColor(family, level); };
  // One lineage, one hue: ETCS level 1 and 2; China's CTCS close to ETCS.
  assert.ok(Math.abs(hue(color('etcs_1')) - hue(color('etcs_2'))) < 3);
  assert.ok(Math.abs(hue(color('ctcs_3')) - hue(color('etcs_2'))) < 35);
  assert.ok(Math.abs(hue(color('pzb')) - hue(color('etcs_2'))) > 90);
  // More advanced is darker, within and across lineages.
  assert.ok(lightness(color('etcs_2')) < lightness(color('etcs_1')));
  assert.ok(lightness(color('ctcs_3')) < lightness(color('ctcs_2')));
  assert.ok(lightness(color('lzb')) < lightness(color('pzb')));
  assert.ok(lightness(color('pzb')) < lightness(color('aws')));
  assert.ok(lightness(color('cbtc')) < lightness(color('kvb')));
  const paint = expression.createExpression(controlPaint(), {type:'color'}).value;
  const hex = c => typeof c === 'string' ? c : '#' + [c.r, c.g, c.b].map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
  assert.equal(hex(paint.evaluate({zoom:8}, {properties:{train_protection0:'etcs_2'}})), color('etcs_2'));
  assert.equal(hex(paint.evaluate({zoom:8}, {properties:{}})), UNKNOWN_COLOR);
});
test('gauge view: continuous scale, near-identical gauges share a colour', async () => {
  const {gaugePaint, GAUGE_ANCHORS, MODES} = await import('../styles/map-model.mjs');
  const {expression} = await import('@maplibre/maplibre-gl-style-spec');
  assert.ok(MODES.includes('gauge'));
  for (const id of ['gauge-overview','gauge-tracks','gauge-dual']) assert.ok(style.layers.find(l => l.id === id), id);
  // Dual gauge is split lengthwise, not dashed: dashes would clash with the
  // dashed tunnel core.
  const dual = style.layers.find(l => l.id === 'gauge-dual'), tracks = style.layers.find(l => l.id === 'gauge-tracks');
  assert.equal(dual.paint['line-dasharray'], undefined);
  assert.ok(dual.paint['line-offset'] && tracks.paint['line-offset']);
  assert.deepEqual(dual.paint['line-opacity'], tracks.paint['line-opacity']);
  assert.equal(style.sources.gaugeLow.url, 'https://openrailwaymap.app/track_railway_line_low');
  const e = expression.createExpression(gaugePaint(), {type:'color'}).value;
  const rgb = mm => { const c = e.evaluate({zoom:8}, {properties:{gaugeint0:mm}}); return typeof c === 'string' ? c : [c.r, c.g, c.b].map(v => v*255); };
  const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  assert.ok(dist(rgb(1432), rgb(1435)) < 8, '1432 and 1435 look alike');
  assert.ok(dist(rgb(1520), rgb(1524)) < 8, '1520 and 1524 look alike');
  assert.ok(dist(rgb(1435), rgb(1520)) > 100, 'standard and Russian gauge differ');
  assert.ok(dist(rgb(1000), rgb(1067)) > 60, 'metre and Cape gauge differ');
  const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2,'0')).join('');
  assert.equal(hex(rgb(1435)), GAUGE_ANCHORS.find(([mm]) => mm === 1435)[1]);
  assert.equal(hex(rgb(1432)), hex(rgb(1435)));
  assert.equal(hex(rgb(-1)), UNKNOWN_COLOR, 'no gauge recorded');
});
test('bridges and tunnels show in every view, including planned and former lines', () => {
  for (const id of ['structure-bridge-edge','structure-bridge-deck','structure-tunnel','inactive-bridge-edge','inactive-regional-bridge-edge']) {
    const layer = style.layers.find(l => l.id === id);
    assert.ok(layer, id);
    assert.equal(layer.layout.visibility, undefined, `${id} is not tied to one view`);
  }
  const order = id => style.layers.findIndex(l => l.id === id);
  assert.ok(order('structure-bridge-edge') < order('speed-tracks') && order('structure-bridge-edge') < order('gauge-tracks'));
  assert.ok(order('inactive-bridge-deck') < order('inactive-railways-construction'));
  // A planned or former tram's bridge casing and name wait for its track (zoom 10).
  for (const id of ['inactive-regional-bridge-edge','inactive-regional-bridge-deck','inactive-names']) {
    const filter = styleSpec.featureFilter(style.layers.find(l => l.id === id).filter);
    const at = (zoom, feature) => filter.filter({zoom}, {type:2, properties:{feature, bridge:true, state:'disused', name:'x'}});
    assert.equal(at(9.9, 'tram'), false, id);
    assert.equal(at(10, 'tram'), true, id);
    assert.equal(at(9, 'rail'), true, id);
  }
});
test('lifecycle snapshot keeps planned speed, bridges and tunnels', async () => {
  const {parseMaxspeed, toGeoJSON} = await import('../scripts/lifecycle.mjs');
  assert.equal(parseMaxspeed({'construction:maxspeed':'320', maxspeed:'100'}, 'construction'), 320);
  assert.equal(parseMaxspeed({maxspeed:'100 mph'}, 'proposed'), 161);
  assert.equal(parseMaxspeed({maxspeed:'none'}, 'proposed'), undefined);
  assert.equal(parseMaxspeed({'maxspeed:forward':'80', 'maxspeed:backward':'120'}, 'abandoned'), 120);
  const [f] = toGeoJSON({elements:[{type:'way', id:1, tags:{railway:'construction', construction:'rail', maxspeed:'350', bridge:'viaduct', tunnel:'no'}, geometry:[{lon:0,lat:0},{lon:1,lat:1}]}]}).features;
  assert.deepEqual([f.properties.maxspeed, f.properties.bridge, f.properties.tunnel], [350, true, undefined]);
});
test('tracks side by side are counted from mapped geometry', async () => {
  const {countTracks, trackLines} = await import('../styles/track-count.mjs');
  // 1 tile unit = 1 m. Four tracks 4.5 m apart, a double track 100 m away,
  // a crossing road-like line at right angles and a subway beneath.
  // Three running tracks 4.5 m apart and a yard of sidings beside them, a
  // double track 100 m away (its two ways drawn in opposite directions), a
  // line at right angles, a subway beneath, and a crossover between the
  // double track's two tracks.
  const line = (y, extra = {}) => ({group:'rail', main:true, parts:[[[0, y], [1000, y + 20]]], ...extra});
  const reversed = y => ({group:'rail', main:true, parts:[[[1000, y + 20], [0, y]]]});
  const lines = [line(0), line(4.5), line(9), line(14, {main:false}), line(19, {main:false}), line(24, {main:false}),
    line(115), reversed(119.5), {group:'rail', main:true, parts:[[[500, -300], [500, 300]]]}, line(6, {tunnel:true}),
    {group:'rail', main:true, parts:[[[400, 123], [480, 128.5]]]}];
  const {lines: result, points} = countTracks(lines, 1);
  // Sidings are neither counted nor labelled; the crossover adds no track;
  // the subway beneath counts with the tracks above it.
  assert.deepEqual(result.map(r => r.tracks), [4, 4, 4, 0, 0, 0, 2, 2, 1, 4, 0]);
  const on = (y0, within = 0.5) => points.filter(p => p.x < 900 && Math.abs(p.y - (y0 + p.x * 0.02)) < within);
  // Labels sit on the middle track only.
  assert.ok(on(4.5).length >= 1 && on(4.5).every(p => p.tracks === 4 && !p.tunnel));
  assert.equal(on(0).length + on(9).length + on(6).length, 0);
  // A line quadrupled with one pair underground 10 m beside the surface
  // pair: one group of four, not in tunnel; a pair wholly underground is.
  const quad = countTracks([line(0), line(4.5), line(14.5, {tunnel:true}), line(19, {tunnel:true})], 1);
  assert.deepEqual(quad.lines.map(l => l.tracks), [4, 4, 4, 4]);
  assert.ok(quad.points.length && quad.points.every(p => p.tracks === 4 && !p.tunnel));
  const underground = countTracks([line(0, {tunnel:true}), line(4.5, {tunnel:true})], 1);
  assert.ok(underground.points.length && underground.points.every(p => p.tracks === 2 && p.tunnel));
  // A double track: one of its two tracks is labelled, whichever way each
  // was drawn, about once per 800 m.
  const pair = [...on(115), ...on(119.5)];
  assert.ok(pair.length >= 1 && pair.length <= 2 && pair.every(p => p.tracks === 2));
  assert.ok(on(115).length === 0 || on(119.5).length === 0);
  // A way that runs beside a double track only for its first half.
  const partial = countTracks([
    {group:'rail', main:true, parts:[[[0, 0], [2000, 0]]]},
    {group:'rail', main:true, parts:[[[0, 4.5], [1000, 4.5]]]},
  ], 1);
  const along = partial.points.filter(p => Math.abs(p.y) < 5).map(p => [Math.round(p.x / 100), p.tracks]);
  assert.ok(along.some(([x, n]) => x < 10 && n === 2), JSON.stringify(along));
  assert.ok(along.some(([x, n]) => x > 10 && n === 1), JSON.stringify(along));
  // A double track whose second track is split into 100 m ways (between
  // switches): the short ways count, and the stretch is labelled.
  const split = countTracks([
    {group:'rail', main:true, parts:[[[0, 4.5], [1000, 4.5]]]},
    ...Array.from({length: 10}, (_, i) => ({group:'rail', main:true, length:100, parts:[[[i * 100, 0], [i * 100 + 100, 0]]]})),
  ], 1);
  assert.deepEqual(split.lines.map(l => l.tracks), Array(11).fill(2));
  assert.ok(split.points.length >= 1 && split.points.every(p => p.tracks === 2), JSON.stringify(split.points));
  // Only present, non-ferry lines are counted; trams separately.
  const feature = (properties, type = 2) => ({type, properties, loadGeometry: () => [[{x:0, y:0}, {x:1, y:1}]]});
  const input = trackLines([feature({state:'construction'}), feature({feature:'ferry'}), feature({}, 1), feature({tunnel:true}), feature({feature:'tram', service:'siding'})]);
  assert.deepEqual(input.map(l => l && [l.group, l.main, l.tunnel]), [null, null, null, ['rail', true, true], ['tram', false, false]]);
});
test('track counts are badges on label points in the Infrastructure view from zoom 14', async () => {
  const layer = style.layers.find(l => l.id === 'infrastructure-track-count');
  assert.equal(layer.minzoom, 14);
  assert.equal(layer.source, 'trackCounts');
  assert.deepEqual([style.sources.trackCounts.minzoom, style.sources.trackCounts.maxzoom], [14, 14]);
  assert.equal(layer['source-layer'], 'atlas_track_counts');
  // Each kind has its own badge; stations a layer of their own, always drawn.
  const {expression} = await import('@maplibre/maplibre-gl-style-spec');
  const image = expression.createExpression(layer.layout['icon-image']).value;
  assert.deepEqual([{}, {tunnel: true}].map(properties => image.evaluate({zoom: 14}, {properties})), ['track-badge', 'track-badge-tunnel']);
  const stations = style.layers.find(l => l.id === 'infrastructure-station-tracks');
  assert.equal(stations.layout['icon-image'], 'track-badge-station');
  assert.equal(stations.layout['icon-allow-overlap'], true);
  assert.equal(featureFilter(layer.filter).filter({zoom:14}, {type:1, properties:{tracks:8, station:true}}), false);
  assert.equal(featureFilter(stations.filter).filter({zoom:14}, {type:1, properties:{tracks:8, station:true}}), true);
  assert.equal(featureFilter(layer.filter).filter({zoom:13}, {type:1, properties:{tracks:4}}), true);
  assert.equal(featureFilter(layer.filter).filter({zoom:13}, {type:1, properties:{tracks:1}}), true);
  assert.equal(featureFilter(layer.filter).filter({zoom:13}, {type:1, properties:{}}), false);
});
test('track-count tiles: neighbours joined by way, points inside, none in station areas or at bare stations', async () => {
  const {countTile} = await import('../styles/track-tiles.mjs');
  const {fromGeojsonVt} = await import('vt-pbf');
  const tile = (layer, features) => { const out = fromGeojsonVt({[layer]: {features}}, {version: 2, extent: 4096}); return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength); };
  // Zoom 14 at the equator: 1 unit ≈ 0.6 m. A double track (7.5 units ≈
  // 4.5 m apart) runs east across the tile into its eastern neighbour, where
  // the same two ways continue; in the centre tile the second track only
  // begins near the eastern edge, so its count there comes from the
  // neighbour.
  const way = (id, y, x0, x1) => ({type: 2, tags: {id, feature: 'rail'}, geometry: [[[x0, y], [x1, y]]]});
  const tiles = [
    {dx: 0, dy: 0, data: tile('railway_line_high', [way('a', 2000, -64, 4160), way('b', 2007.5, 3900, 4160)])},
    {dx: 1, dy: 0, data: tile('railway_line_high', [way('a', 2000, -64, 4160), way('b', 2007.5, -64, 4160)])},
  ];
  const y = 2 ** 13;
  const {extent, points} = countTile({tiles}, y);
  assert.equal(extent, 4096);
  assert.ok(points.length >= 1 && points.every(p => p.x >= 0 && p.x < 4096 && p.y >= 1995 && p.y <= 2010));
  // West, one track; near the east edge, where both tracks run, two.
  assert.ok(points.some(p => p.x < 3000 && p.tracks === 1), JSON.stringify(points));
  // Station areas take away the labels in them, unless the area holds only
  // subway stations (surface tracks above one stay labelled); stations
  // without an area take away those within 100 m.
  const square = [[[0, 1900], [4096, 1900], [4096, 2100], [0, 2100], [0, 1900]]];
  const areas = tile('standard_railway_grouped_station_areas', [{type: 3, tags: {id: 1}, geometry: square}]);
  const stationAt = (station, x = 2000, y0 = 2000) => tile('standard_railway_text_stations', [{type: 1, tags: {feature: 'station', station}, geometry: [[x, y0]]}]);
  const running = result => result.points.filter(p => !p.station), atStations = result => result.points.filter(p => p.station);
  assert.equal(running(countTile({tiles, areas, stations: stationAt('train')}, y)).length, 0);
  assert.equal(countTile({tiles, areas}, y).points.length, 0);
  assert.equal(running(countTile({tiles, areas, stations: stationAt('subway')}, y)).length, points.length);
  const station = tile('standard_railway_text_stations', points.map(p => ({type: 1, tags: {feature: 'station', station: 'train'}, geometry: [[Math.round(p.x), Math.round(p.y)]]})));
  assert.equal(running(countTile({tiles, stations: station}, y)).length, 0);
  const tram = tile('standard_railway_text_stations', points.map(p => ({type: 1, tags: {feature: 'station', station: 'tram'}, geometry: [[Math.round(p.x), Math.round(p.y)]]})));
  assert.deepEqual(countTile({tiles, stations: tram}, y).points, points);
  // A station has its own count instead: every track across its area at the
  // widest point (here both, near the east edge), once, from the tile
  // holding its point; without the point (it lies in another tile), none.
  assert.deepEqual(atStations(countTile({tiles, areas, stations: stationAt('train')}, y)).map(p => [p.tracks, p.station]), [[2, true]]);
  assert.equal(atStations(countTile({tiles, areas}, y)).length, 0);
});
test('stations of different names sharing one area (a stop area group) each count their own lines', async () => {
  const {countTile} = await import('../styles/track-tiles.mjs');
  const {fromGeojsonVt} = await import('vt-pbf');
  const tile = (layer, features) => { const out = fromGeojsonVt({[layer]: {features}}, {version: 2, extent: 4096}); return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength); };
  const way = (id, y, x0, x1, tags = {}) => ({type: 2, tags: {id, feature: 'rail', ...tags}, geometry: [[[x0, y], [x1, y]]]});
  // Two tiles side by side, one area across both (in two pieces). Alpha's
  // operator runs two tracks through both tiles; Beta, in the east tile,
  // has three tracks of its own beside them (about 25 m off) and a siding
  // with neither operator nor name leaving one of them.
  const alpha = {operator_color: '#111111'}, beta = {operator_color: '#222222'};
  const west = tile('railway_line_high', [way(1, 2000, -64, 4160, alpha), way(2, 2007.5, -64, 4160, alpha)]);
  const east = tile('railway_line_high', [way(1, 2000, -64, 4160, alpha), way(2, 2007.5, -64, 4160, alpha),
    way(3, 2040, 500, 4160, beta), way(4, 2047.5, 500, 4160, beta), way(5, 2055, 500, 4160, beta),
    {type: 2, tags: {id: 6, feature: 'rail', service: 'siding'}, geometry: [[[1000, 2055], [1100, 2062.5], [3000, 2062.5]]]}]);
  const piece = (x0, x1) => tile('standard_railway_grouped_station_areas', [{type: 3, tags: {id: 7}, geometry: [[[x0, 1900], [x1, 1900], [x1, 2200], [x0, 2200], [x0, 1900]]]}]);
  const station = (id, name, colour, x) => ({type: 1, tags: {id, name, operator_color: colour, feature: 'station', station: 'train'}, geometry: [[x, 2000]]});
  const westStations = tile('standard_railway_text_stations', [station(11, 'Alpha', '#111111', 1000)]);
  const eastStations = tile('standard_railway_text_stations', [station(12, 'Beta', '#222222', 2000)]);
  const y = 2 ** 13, badges = result => result.points.filter(p => p.station).map(p => p.tracks);
  // From the west tile (Alpha's point): Alpha's two tracks, not Beta's.
  assert.deepEqual(badges(countTile({tiles: [{dx: 0, dy: 0, data: west}, {dx: 1, dy: 0, data: east}],
    areas: [{dx: 0, dy: 0, data: piece(-64, 4160)}, {dx: 1, dy: 0, data: piece(-64, 4160)}],
    stations: [{dx: 0, dy: 0, data: westStations}, {dx: 1, dy: 0, data: eastStations}]}, y)), [2]);
  // From the east tile (Beta's point): Beta's three tracks and the siding.
  assert.deepEqual(badges(countTile({tiles: [{dx: -1, dy: 0, data: west}, {dx: 0, dy: 0, data: east}],
    areas: [{dx: -1, dy: 0, data: piece(-64, 4160)}, {dx: 0, dy: 0, data: piece(-64, 4160)}],
    stations: [{dx: -1, dy: 0, data: westStations}, {dx: 0, dy: 0, data: eastStations}]}, y)), [4]);
  // One name in the area: one count of everything, as before.
  const both = tile('standard_railway_text_stations', [station(12, 'Alpha', '#222222', 2000)]);
  assert.deepEqual(badges(countTile({tiles: [{dx: -1, dy: 0, data: west}, {dx: 0, dy: 0, data: east}],
    areas: [{dx: -1, dy: 0, data: piece(-64, 4160)}, {dx: 0, dy: 0, data: piece(-64, 4160)}],
    stations: [{dx: -1, dy: 0, data: westStations}, {dx: 0, dy: 0, data: both}]}, y)), []);
});
test('station track counts include sidings, not yards; a station with no area counts within 100 m of its point', async () => {
  const {stationTracks} = await import('../styles/track-count.mjs');
  // 1 unit = 1 m. Two running tracks, a siding (platform loop) and a yard
  // track, 5 m apart, along x.
  const track = (y, service) => ({group: 'rail', main: !service, service, parts: [[[0, y], [400, y]]]});
  const lines = [track(0), track(5), track(10, 'siding'), track(15, 'yard')];
  const zone = {inside: (x, y) => x >= 100 && x <= 300 && y >= -20 && y <= 40, surface: true};
  assert.deepEqual(stationTracks(lines, [zone], 1).map(p => p.tracks), [3]);
  // Every level counts: platforms under a building or underground too.
  const covered = lines.map((l, i) => ({...l, tunnel: i % 2 === 0}));
  assert.deepEqual(stationTracks(covered, [zone], 1).map(p => p.tracks), [3]);
  assert.deepEqual(stationTracks(lines, [{inside: () => false, surface: true}], 1), [null]);
  // A station whose tracks are all tagged as sidings (a terminal's bay platforms) still has a count.
  const bays = [track(0, 'siding'), track(5, 'siding'), track(10, 'siding'), track(15, 'yard')];
  assert.deepEqual(stationTracks(bays, [zone], 1).map(p => p.tracks), [3]);
});
test('track counts: stacked tunnels are two tracks; light rail and main lines are counted apart', async () => {
  const {countTracks, stationTracks, trackLines} = await import('../styles/track-count.mjs');
  // 1 unit = 1 m. Two tunnels of one line, one above the other, drawn on the
  // same plan line for 600 m (as south of Austin, Hong Kong): two tracks.
  const tml = {group: 'rail', main: true, tunnel: true, line: 'Tuen Ma Line'};
  const stacked = countTracks([{...tml, parts: [[[0, 0], [1000, 0]]]}, {...tml, parts: [[[200, 0], [800, 0]]]}], 1);
  assert.ok(stacked.points.some(p => p.tracks === 2 && p.x > 250 && p.x < 750), JSON.stringify(stacked.points));
  // A stacked pair beside a third track: probes from the third keep the
  // pair apart too (offsets −5, −5, 0, 5 are four tracks).
  const four = countTracks([{...tml, parts: [[[0, -5], [1000, -5]]]}, {...tml, parts: [[[0, -5], [1000, -5]]]}, {...tml, parts: [[[0, 0], [1000, 0]]]}, {...tml, parts: [[[0, 5], [1000, 5]]]}], 1);
  assert.ok(four.points.length && four.points.every(p => p.tracks === 4), JSON.stringify(four.points));
  // A way meeting another end to end stays one track.
  const joined = countTracks([{...tml, parts: [[[0, 0], [500, 0]]]}, {...tml, parts: [[[500, 0], [1000, 0]]]}], 1);
  assert.ok(joined.points.every(p => p.tracks === 1), JSON.stringify(joined.points));
  // A light rail pair 10 m from a main-line pair on a viaduct (north of
  // Choy Yee Bridge): two and two, not four.
  const feature = (properties, y) => ({type: 2, properties: {state: 'present', ...properties}, loadGeometry: () => [[{x: 0, y}, {x: 1000, y}]]});
  const lines = trackLines([feature({feature: 'light_rail', name: 'Light Rail'}, 0), feature({feature: 'light_rail', name: 'Light Rail'}, 4),
    feature({feature: 'rail', name: 'Tuen Ma Line', bridge: true}, 14), feature({feature: 'rail', name: 'Tuen Ma Line', bridge: true}, 20)]);
  assert.deepEqual(lines.map(l => l.group), ['light_rail', 'light_rail', 'rail', 'rail']);
  assert.deepEqual(countTracks(lines, 1).lines.map(l => l.tracks), [2, 2, 2, 2]);
  // A station area holding a light rail stop and a main-line station counts
  // each kind's tracks on its own (Ho Tin and Tuen Mun).
  const zone = {inside: (x, y) => x >= 300 && x <= 700 && y >= -10 && y <= 30, groups: ['light_rail', 'rail']};
  assert.deepEqual(stationTracks(lines, [zone], 1).map(p => [p.group, p.tracks]), [['light_rail', 2], ['rail', 2]]);
  // Among equally wide places, one where the badge can be drawn.
  const [inside] = stationTracks(lines, [{inside: zone.inside, groups: ['rail']}], 1, {prefer: x => x > 600});
  assert.ok(inside.x > 600, JSON.stringify(inside));
});
test('legend colours equal the drawn colours for power, gauge and loading gauge', async () => {
  const m = await import('../styles/map-model.mjs');
  const {expression} = await import('@maplibre/maplibre-gl-style-spec');
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
  const drawn = (expr, properties) => hex(expression.createExpression(expr, {type:'color'}).value.evaluate({zoom:10}, {properties}));
  const close = (a, b) => Math.max(...[1,3,5].map(i => Math.abs(parseInt(a.slice(i,i+2),16) - parseInt(b.slice(i,i+2),16)))) <= 1;
  for (const p of [{voltage:25000, frequency:50}, {voltage:20000, frequency:50}, {voltage:15000, frequency:16.7}, {voltage:1500, frequency:0}, {voltage:750, frequency:0}, {voltage:12500, frequency:60}, {electrification_state:'no'}])
    assert.ok(close(drawn(m.electrificationPaint(), p), m.electrificationColor(p)), JSON.stringify(p));
  for (const mm of [600, 762, 1000, 1067, 1372, 1432, 1435, 1520, 1524, 1668, 1676])
    assert.ok(close(drawn(m.gaugePaint(), {gaugeint0:mm}), m.gaugeColor(mm)), String(mm));
  for (const v of ['TSI_GC', 'TSI_GB', 'TSI_GA', 'PPI', 'GOST_T', 'AAR_C', 'CPb+', 'PT c', 'W6A', 'W6A, W7', 'W6A, W7, W8, W9, W10', 'W6A, W7, W8, W9, W9Plus, W10, W10A, W12', 'W6, W6A', 'W6A, W7*', 'deep-tube', '3200', 'EBV 4', 'FS'])
    assert.equal(drawn(m.loadingPaint(), {loading_gauge:v}), m.loadingGauge(v).color, v);
});
test('loading gauge: colour by envelope height, largest of a list, British ladder', async () => {
  const {loadingGauge} = await import('../styles/map-model.mjs');
  assert.equal(loadingGauge('TSI_GC').height, 4.65);
  assert.equal(loadingGauge('TSI_GC').color, loadingGauge('UIC_C').color, 'same height, same colour across naming systems');
  assert.equal(loadingGauge('TSI_GA').color, loadingGauge('TSI_GB1').color);
  assert.notEqual(loadingGauge('TSI_GB').color, loadingGauge('TSI_GC').color);
  assert.equal(loadingGauge('W6A, W7, W8, W9, W10').code, 'W10');
  assert.equal(loadingGauge('W6, W6A').code, 'W6A');
  assert.equal(loadingGauge('W6A, W7*').code, 'W7');
  assert.equal(loadingGauge('3200').family, 'other');
  assert.equal(loadingGauge(undefined), null);
});
test('each view writes its values along the tracks from zoom 10', async () => {
  const {expression} = await import('@maplibre/maplibre-gl-style-spec');
  const text = (id, properties) => { const l = style.layers.find(x => x.id === id); return String(expression.createExpression(l.layout['text-field']).value.evaluate({zoom:12}, {properties})); };
  for (const id of ['speed-labels','electrification-labels','control-labels','gauge-labels','loading-labels']) assert.equal(style.layers.find(l => l.id === id).minzoom, 10, id);
  assert.equal(text('electrification-labels', {voltage:25000, frequency:50}), '25 kV 50 Hz');
  assert.equal(text('electrification-labels', {voltage:15000, frequency:16.700000762939453}), '15 kV 16.7 Hz');
  assert.equal(text('electrification-labels', {voltage:1500, frequency:0}), '1.5 kV DC');
  assert.equal(text('electrification-labels', {voltage:750, frequency:0}), '750 V DC');
  assert.equal(text('control-labels', {train_protection0:'lzb', train_protection1:'pzb'}), 'LZB + PZB');
  assert.equal(text('control-labels', {train_protection0:'etcs_2'}), 'ETCS L2');
  assert.equal(text('gauge-labels', {gauge0:'1435', gauge1:'1668'}), '1435 / 1668 mm');
  assert.equal(text('loading-labels', {loading_gauge:'W6A, W7, W8, W9, W10'}), 'W10');
  assert.equal(text('loading-labels', {loading_gauge:'TSI_GC'}), 'TSI_GC');
});
test('weekly changes add, update and remove snapshot ways, newest data winning', async () => {
  const {mergeDelta, applyDelta, deltaQueries} = await import('../scripts/snapshot-delta.mjs');
  const way = (id, tags) => ({type:'way', id, tags, geometry:[{lon:0,lat:0},{lon:1,lat:1}]});
  const lifecycle = {osm3s:{timestamp_osm_base:'2026-10-05T03:00:00Z'}, elements:[way(1, {railway:'construction', construction:'rail', name:'New line'}), way(3, {railway:'proposed', proposed:'rail'})]};
  const opened = {osm3s:{timestamp_osm_base:'2026-10-05T03:01:00Z'}, elements:[{type:'way', id:2}, {type:'way', id:9}]};
  const delta = mergeDelta(null, lifecycle, opened);
  assert.equal(delta.since, '2026-10-05T03:00:00Z');
  const features = new Map([[1, {id:1, properties:{state:'proposed'}}], [2, {id:2, properties:{state:'construction'}}], [4, {id:4, properties:{state:'abandoned'}}]]);
  const base = new Map([[1, '2026-09-22T12:00:00Z'], [2, '2026-09-22T12:00:00Z'], [4, '2026-10-10T00:00:00Z']]);
  const result = applyDelta(features, base, delta);
  assert.deepEqual([result.added, result.updated, result.removed], [1, 1, 1]);
  assert.equal(features.get(1).properties.state, 'construction', 'proposal now under construction');
  assert.ok(!features.has(2), 'line opened: no longer shown as construction');
  assert.ok(features.has(3), 'new proposal added');
  // Way 9 was never in the snapshot: its removal entry is pruned.
  assert.deepEqual(Object.keys(result.delta.changes).sort(), ['1', '2', '3']);
  // Region data newer than the change wins.
  const newer = new Map([[1, {id:1, properties:{state:'disused'}}]]);
  applyDelta(newer, new Map([[1, '2026-11-01T00:00:00Z']]), delta);
  assert.equal(newer.get(1).properties.state, 'disused');
  const q = deltaQueries('2026-10-01T00:00:00Z', '50,0,51,1');
  assert.match(q.lifecycle, /changed:"2026-10-01T00:00:00Z"/);
  assert.match(q.opened, /out ids/);
});

test('loading gauge dimensions: British W gauges (GE/RT8073), AAR plates, tag variants, imperial units', async () => {
  const {loadingGauge, loadingDimensions, loadingPaint} = await import('../styles/map-model.mjs');
  const {expression} = await import('@maplibre/maplibre-gl-style-spec');
  assert.equal(loadingDimensions(loadingGauge('W6A')), '3.965 m high × 2.82 m wide');
  assert.equal(loadingDimensions(loadingGauge('W6A, W7, W8, W9, W10')), '3.891 m high × 2.525 m wide');
  assert.equal(loadingDimensions(loadingGauge('W6A, W7, W8, W9, W10, W12')), '3.965 m high × 2.6 m wide');
  assert.match(loadingGauge('W10').note, /load gauges/);
  // W6 shares W6A's height and width (W6A changed only the lower body).
  assert.equal(loadingDimensions(loadingGauge('W6')), '3.965 m high × 2.82 m wide');
  assert.match(loadingGauge('W6').note, /lower body/);
  // Withdrawn outlines retain their dimensions, with their status explicit.
  assert.equal(loadingDimensions(loadingGauge('W11')), 'Withdrawn profile: 3.896 m high × 2.625 m wide');
  assert.equal(loadingGauge('W6a').code, 'W6A');
  assert.equal(loadingGauge('W8A').name, 'W8a');
  assert.equal(loadingGauge('AAR F').code, 'AAR_F');
  assert.equal(loadingDimensions(loadingGauge('AAR_E'), 'imperial'), '15 ft 9 in high × 10 ft 8 in wide');
  assert.equal(loadingDimensions(loadingGauge('AAR_H'), 'imperial'), '20 ft 2 in high × 10 ft 8 in wide');
  assert.equal(loadingDimensions(loadingGauge('AAR_K'), 'imperial'), '20 ft 3 in high × 10 ft 0 in wide');
  assert.equal(loadingDimensions(loadingGauge('AAR_J')), '5.791 m high × 3.251 m wide');
  // Drawn in the same colours whatever the tag's case or separator.
  const paint = expression.createExpression(loadingPaint(), {type: 'color'}).value;
  const drawn = value => JSON.stringify(paint.evaluate({zoom: 10}, {properties: {loading_gauge: value}}));
  assert.equal(drawn('W6a'), drawn('W6A'));
  assert.equal(drawn('AAR F'), drawn('AAR_F'));
  assert.notEqual(drawn('W8A'), drawn('W8'));
  for (const variant of ['AAR-F', 'aar f', 'AARF', 'aar_f']) {
    assert.equal(loadingGauge(variant).code, 'AAR_F');
    assert.equal(drawn(variant), drawn('AAR_F'), variant);
  }
  // Mixed-case ladder codes: W9Plus is drawn and labelled as itself.
  const {loadingLabel} = await import('../styles/map-model.mjs');
  assert.equal(drawn('W9Plus'), JSON.stringify(expression.createExpression(['to-color', loadingGauge('W9Plus').color], {type: 'color'}).value.evaluate({zoom: 10}, {properties: {}})));
  const label = expression.createExpression(loadingLabel(), {type: 'string'}).value;
  assert.equal(label.evaluate({zoom: 10}, {properties: {loading_gauge: 'W6A, W7, W8, W9, W9Plus'}}), 'W9Plus');
});
test('loading gauge list round-trips and matches overview feature IDs', async () => {
  const {encodeLoadingGauges, decodeLoadingGauges, wayId, parseCsv} = await import('../styles/loading-gauge-list.mjs');
  const rows = parseCsv('273450997\tTSI_GC\n5\t"W6A, W7, W8"\n4000000000\tTSI_GC\n7\t\n');
  assert.deepEqual(rows[1], [5, 'W6A, W7, W8']);
  const lookup = decodeLoadingGauges(JSON.parse(JSON.stringify(encodeLoadingGauges(rows))));
  assert.equal(lookup.get(273450997), 'TSI_GC');
  assert.equal(lookup.get(4000000000), 'TSI_GC');
  assert.equal(lookup.get(5), 'W6A, W7, W8');
  assert.equal(lookup.has(7), false); // no value recorded
  assert.equal(wayId('273450997-0'), 273450997);
});

test('loading gauge reference fills historical and regional profiles with the measurement basis intact', async () => {
  const {LOADING_GAUGES, loadingGauge, loadingDimensions, loadingPaint, loadingLabel} = await import('../styles/map-model.mjs');
  const {expression} = await import('@maplibre/maplibre-gl-style-spec');
  const sizes = [
    ['W5', 3.965, 2.74], ['W9Plus', 3.965, 2.796], ['W11', 3.896, 2.625],
    ['W7a', 3.635, 2.525], ['W9a', 3.866, 2.625],
    ['EBV 1', 4.53, 3.29], ['EBV 2', 4.63, 3.29], ['EBV 3', 4.63, 3.29], ['EBV 4', 4.7, 3.29], ['FS', 4.3, 3.2],
  ];
  for (const [code, height, width] of sizes) {
    const g = loadingGauge(code);
    assert.deepEqual([g.height, g.width], [height, width], code);
    assert.match(loadingDimensions(g, 'imperial'), /ft .* in high × .* ft .* in wide/, code);
  }
  assert.match(loadingDimensions(loadingGauge('W5')), /^Approx\. historic outline:/);
  assert.match(loadingDimensions(loadingGauge('EBV 1')), /^Reference profile:/);
  assert.notEqual(loadingGauge('EBV 1').name, loadingGauge('EBV 4').name);
  assert.match(loadingGauge('FS').note, /RFI/);
  assert.doesNotMatch(loadingGauge('FS').note, /Gotthard|EBV/);
  for (const [code, height, width] of [['deep-tube', 2.869, 2.62], ['subsurface', 3.682, 2.92], ['Kleinprofil', 3.16, 2.4], ['Großprofil', 3.425, 2.65]]) {
    const g = loadingGauge(code);
    assert.equal(g.height, null, 'vehicle examples must not become gauge envelope heights');
    assert.deepEqual(g.dimensions.example, {height, width});
    assert.match(loadingDimensions(g), /^Vehicle example \(.+\):/);
    assert.match(loadingDimensions(g, 'imperial'), /^Vehicle example \(.+\): .* ft/);
  }
  // Every recognised entry now has either profile dimensions or a labelled example.
  for (const [codes] of LOADING_GAUGES) for (const code of codes) assert.ok(loadingDimensions(loadingGauge(code)), code);
  assert.equal(loadingDimensions(loadingGauge('unrecognised')), '');
  assert.equal(loadingDimensions(null), '');
  const paint = expression.createExpression(loadingPaint(), {type: 'color'}).value;
  const label = expression.createExpression(loadingLabel(), {type: 'string'}).value;
  const drawn = value => JSON.stringify(paint.evaluate({zoom: 10}, {properties: {loading_gauge: value}}));
  for (const [alias, canonical] of [['ebv1', 'EBV 1'], ['EBV O4', 'EBV 4'], ['Grossprofil', 'Großprofil'], ['w7a', 'W7A'], ['w9a', 'W9A']]) {
    assert.equal(loadingDimensions(loadingGauge(alias)), loadingDimensions(loadingGauge(canonical)));
    assert.equal(drawn(alias), drawn(canonical));
  }
  assert.equal(label.evaluate({zoom: 10}, {properties: {loading_gauge: 'W7, W7a'}}), 'W7a');
  assert.equal(label.evaluate({zoom: 10}, {properties: {loading_gauge: 'W9, W9a'}}), 'W9a');
});

test('legend groups values drawn in the same colour and summarises the rest', async () => {
  const {legendRows} = await import('../styles/map-model.mjs');
  const rows = legendRows([
    {row: ['#a', 'GB1', 4.32, '4.32 m high'], n: 50}, {row: ['#a', 'GA', 4.32, '4.32 m high'], n: 20},
    {row: ['#b', 'GC', 4.65, '4.65 m high'], n: 30}, {row: ['#c', 'PPI', 4.28, '4.28 m high'], n: 1},
  ], 2);
  assert.deepEqual(rows, [['#a', 'GB1, GA · 4.32 m high'], ['#b', 'GC · 4.65 m high'], ['transparent', '1 less common value in view; zoom in for them', 'empty']]);
});

test('loading legend keeps different dimensions visible when profiles share a colour', async () => {
  const {loadingGauge, loadingDimensions, legendRows} = await import('../styles/map-model.mjs');
  const entries = ['FS', 'EBV 1', 'EBV 2', 'EBV 3', 'EBV 4', 'deep-tube', 'subsurface', 'Kleinprofil', 'Großprofil'].map(code => {
    const g = loadingGauge(code);
    return {row: [g.color, g.name, g.rank, loadingDimensions(g)], n: 1};
  });
  const rows = legendRows(entries);
  assert.equal(rows.length, 8, 'only EBV 2 and EBV 3 have identical colour and dimensions');
  for (const {row: [, name, , dimensions]} of entries) assert.ok(rows.some(([, text]) => text.includes(name) && text.includes(dimensions)), name);
});

test('globe below zoom 4; flat map from zoom 4 unless the view is mostly polar', async () => {
  const {autoProjection} = await import('../styles/map-model.mjs');
  assert.equal(autoProjection(1.8, 0), 'globe');
  assert.equal(autoProjection(3.99, 0.9), 'globe');
  assert.equal(autoProjection(4, 0.2), 'mercator');
  assert.equal(autoProjection(6, 0.7), null); // leave as is near the poles
});

test('dragging the globe keeps the direction and the heading; over a pole it carries on', async () => {
  const {stepView, zoomForLatitude} = await import('../styles/globe-drag.mjs');
  const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) < tolerance;
  const perDegree = Math.PI / 180; // 1 px = 1° for the test
  // No movement: no change.
  let view = stepView({center: [10, 50], bearing: 30}, 0, 0, perDegree);
  assert.ok(near(view.center[0], 10) && near(view.center[1], 50) && near(view.bearing, 30), JSON.stringify(view));
  // Dragging down moves the view north; dragging left moves it east.
  view = stepView({center: [10, 0], bearing: 0}, 0, 5, perDegree);
  assert.ok(near(view.center[0], 10) && near(view.center[1], 5), JSON.stringify(view));
  view = stepView({center: [10, 0], bearing: 0}, 5, 0, perDegree);
  assert.ok(near(view.center[0], 5) && near(view.center[1], 0), JSON.stringify(view));
  // From Japan, a long sideways drag stays on the parallel (to California,
  // not down a great circle to South America), heading unchanged.
  view = {center: [139.7, 35.7], bearing: 0};
  for (let i = 0; i < 325; i++) view = stepView(view, -0.25, 0, perDegree);
  assert.ok(near(view.center[1], 35.7) && near(view.bearing, 0), JSON.stringify(view));
  assert.ok(view.center[0] < -115 && view.center[0] > -125, 'about California: ' + view.center[0]);
  // A turned map: dragging along the screen keeps the screen direction.
  view = stepView({center: [0, 0], bearing: 90}, 0, 5, perDegree);
  assert.ok(near(view.center[0], 5) && near(view.center[1], 0) && near(view.bearing, 90), JSON.stringify(view));
  // From 80° N heading north, 20° of dragging passes over the pole and ends
  // at 80° N on the far meridian, the map the other way up; and back.
  view = {center: [20, 80], bearing: 0};
  for (let i = 0; i < 20; i++) view = stepView(view, 0, 1, perDegree);
  assert.ok(near(view.center[0], -160) && near(view.center[1], 80, 1e-9), JSON.stringify(view));
  assert.ok(near(Math.abs(view.bearing), 180), JSON.stringify(view));
  for (let i = 0; i < 20; i++) view = stepView(view, 0, -1, perDegree);
  assert.ok(near(view.center[0], 20) && near(view.center[1], 80, 1e-9) && near(view.bearing, 0), JSON.stringify(view));
  // One long step over both poles: still a valid place, as many small steps.
  const long = stepView({center: [0, 80], bearing: 0}, 0, 200, perDegree);
  let small = {center: [0, 80], bearing: 0};
  for (let i = 0; i < 200; i++) small = stepView(small, 0, 1, perDegree);
  assert.ok(near(long.center[1], small.center[1], 1e-6) && near(long.center[0], small.center[0], 1e-6) && near(long.bearing, small.bearing), JSON.stringify({long, small}));
  assert.ok(Math.abs(long.center[1]) <= 90);
  // A diagonal step over a pole: as the same movement in small events.
  const diagonal = stepView({center: [0, 80], bearing: 0}, 10, 20, perDegree);
  let pieces = {center: [0, 80], bearing: 0};
  for (let i = 0; i < 100; i++) pieces = stepView(pieces, 0.1, 0.2, perDegree);
  const lngGap = Math.abs(((diagonal.center[0] - pieces.center[0]) + 540) % 360 - 180);
  assert.ok(lngGap < 1 && Math.abs(diagonal.center[1] - pieces.center[1]) < 0.1 && Math.abs(diagonal.bearing - pieces.bearing) < 1, JSON.stringify({diagonal, pieces}));
  // Entering a polar cap obliquely: the same however the events are grouped
  // (within 0.1° on the ground).
  const apart = (a, b) => { const r = Math.PI / 180, [l1, p1] = a.center.map(v => v * r), [l2, p2] = b.center.map(v => v * r);
    return Math.acos(Math.min(1, Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(l1 - l2))) / r; };
  const quarter = 0.25 * perDegree, oblique = stepView({center: [0, 84.9], bearing: 135}, 100, 90, quarter);
  let events = {center: [0, 84.9], bearing: 135};
  for (let i = 0; i < 100; i++) events = stepView(events, 1, 0.9, quarter);
  assert.ok(apart(oblique, events) < 0.1, JSON.stringify({oblique, events}));
  // A long movement (an edge-to-edge drag on a large screen) is followed to
  // its end, as in pieces.
  const across = stepView({center: [0, 0], bearing: 0}, 0, 4000, 0.35 * perDegree);
  let hundreds = {center: [0, 0], bearing: 0};
  for (let i = 0; i < 40; i++) hundreds = stepView(hundreds, 0, 100, 0.35 * perDegree);
  assert.ok(apart(across, hundreds) < 0.1, JSON.stringify({across, hundreds}));
  // Work per pointer event is a few segments, whatever the distance or
  // latitude: a huge drag round the polar caps returns at once.
  const started = performance.now();
  let far;
  for (let i = 0; i < 1000; i++) far = stepView({center: [30, 84.99], bearing: 80}, 5000, 3000, perDegree);
  assert.ok(performance.now() - started < 500, 'took ' + (performance.now() - started) + ' ms');
  assert.ok(Math.abs(far.center[1]) <= 90 && Number.isFinite(far.center[0]) && Number.isFinite(far.bearing), JSON.stringify(far));
  // Leaving a cap and running along a parallel just outside it: as in pieces.
  const graze = stepView({center: [0, 86], bearing: 0}, 30, -4, perDegree);
  let grazes = {center: [0, 86], bearing: 0};
  for (let i = 0; i < 300; i++) grazes = stepView(grazes, 0.1, -4 / 300, perDegree);
  assert.ok(apart(graze, grazes) < 1e-6, JSON.stringify({graze, grazes}));
  // The planet keeps its size: zoom falls as the centre nears a pole.
  assert.ok(near(zoomForLatitude(3, 0, 60), 2));
  assert.ok(near(zoomForLatitude(2, 60, 0), 3));
});

test('zooming around a point near a pole moves along the great circle towards it', async () => {
  const {startFrame, frameView, zoomTowards} = await import('../styles/globe-drag.mjs');
  // One level in towards a point 4° away across the pole: the centre covers
  // half the way, over the pole, and the heading follows.
  const view = frameView(zoomTowards(startFrame([20, 89], 0), [-160, 89], 1));
  assert.ok(Math.abs(view.center[1] - 90) < 1e-6 || Math.abs(view.center[1] - 89.99999) < 1e-3, JSON.stringify(view));
  const out = frameView(zoomTowards(startFrame([20, 89], 0), [-160, 89], -1));
  assert.ok(Math.abs(out.center[0] - 20) < 1e-6 && Math.abs(out.center[1] - 87) < 1e-6, JSON.stringify(out));
});



test('OpenStreetMap object behind a feature', () => {
  assert.deepEqual(osmObject({source:'railway', properties:{id:'660796156-0'}}), {type:'way', id:'660796156'});
  assert.deepEqual(osmObject({source:'stations', properties:{id:'node-11329319854-train-train-station'}}), {type:'node', id:'11329319854'});
  assert.deepEqual(osmObject({source:'crossings', properties:{id:'node-384040710'}}), {type:'node', id:'384040710'});
  assert.deepEqual(osmObject({source:'inactiveRegional', id:365118548, properties:{id:365118548, osm_id:365118548}}), {type:'way', id:'365118548'});
  assert.deepEqual(osmObject({source:'crossingsDetail', sourceLayer:'level_crossings', id:101, properties:{kind:'road'}}), {type:'node', id:'101'});
  assert.deepEqual(osmObject({source:'openmaptiles', id:1234563, properties:{}}), {type:'relation', id:'123456'});
  assert.equal(osmObject({source:'openmaptiles', id:1234560, properties:{}}), null);
  assert.equal(osmObject({kind:'station', properties:{osm_id:2149761647}}), null, 'a search result does not say node or way');
});

test('search: geocoded stations join the railway results unless already found; other places follow', async () => {
  const {searchResults, osmObject} = await import('../styles/map-model.mjs');
  const facilities = [{osm_id: 4338478841, name: '大埔墟 Tai Po Market', railway: 'station', latitude: 22.4447, longitude: 114.1704}];
  const places = [
    {osm_type: 'way', osm_id: 223848687, category: 'railway', type: 'station', lat: '22.3826', lon: '114.1869', display_name: '沙田 Sha Tin, 沙田區 Sha Tin District, 香港 Hong Kong', namedetails: {name: '沙田 Sha Tin', 'name:en': 'Sha Tin'}},
    {osm_type: 'node', osm_id: 4338478841, category: 'railway', type: 'station', lat: '22.4447', lon: '114.1704', display_name: '大埔墟 Tai Po Market'},
    {osm_type: 'way', osm_id: 99, category: 'railway', type: 'station', lat: '22.4449', lon: '114.1706', display_name: 'x', namedetails: {name: 'Other', 'name:en': 'Tai Po Market'}},
    {osm_type: 'node', osm_id: 316731268, category: 'place', type: 'town', addresstype: 'town', lat: '22.3836', lon: '114.1878', display_name: '沙田 Sha Tin, 香港 Hong Kong', boundingbox: ['22.2', '22.5', '114.0', '114.3'], namedetails: {name: '沙田 Sha Tin'}},
    {osm_type: 'node', osm_id: 1, category: 'place', type: 'town', lat: 'x', lon: '1', display_name: 'bad'},
    {osm_type: 'way', osm_id: 2, category: 'public_transport', type: 'station', lat: '22.30', lon: '114.17', display_name: 'Bus Terminus', extratags: {bus: 'yes'}},
    {osm_type: 'way', osm_id: 3, category: 'public_transport', type: 'station', lat: '22.50', lon: '114.10', display_name: 'Rail Station', extratags: {train: 'yes'}},
    {osm_type: 'way', osm_id: 4, category: 'building', type: 'train_station', lat: '22.3049', lon: '114.1615', display_name: '九龍站 Kowloon Station, 西九', extratags: {subway: 'yes'}},
  ];
  const {rail, places: other} = searchResults(facilities, places);
  assert.deepEqual(rail.map(r => r.osm_id), [4338478841, 223848687, 3, 4], 'a station mapped as an area is added; the same node or name nearby is not repeated; a public-transport station only with rail evidence; a station building (Kowloon)');
  assert.equal(rail[3].railway, 'station');
  assert.deepEqual([rail[1].railway, rail[1]['name:en'], rail[1].osm_type], ['station', 'Sha Tin', 'way']);
  assert.deepEqual(other.map(p => [p.osm_id, p.place, p.area, p.boundingbox]), [[316731268, 'town', '香港 Hong Kong', [22.2, 22.5, 114, 114.3]], [2, 'station', '', undefined]], 'a bus station stays a place');
  assert.deepEqual(osmObject({properties: rail[1]}), {type: 'way', id: '223848687'}, 'geocoded results link to their OSM object');
  // A nearby station whose name merely contains another's is a different station.
  const {samePlaceName} = await import('../styles/map-model.mjs');
  assert.equal(samePlaceName('Central Park', 'Central'), false);
  assert.equal(samePlaceName('Central Station', 'Central Park Station'), false);
  for (const [a, b] of [['大埔墟 Tai Po Market', 'Tai Po Market'], ['九龍塘站', '九龍塘'], ['紅磡 Hung Hom Station', 'Hung Hom'], ['東京駅', '東京']]) assert.ok(samePlaceName(a, b), `${a} = ${b}`);
  const parkNearby = searchResults([{osm_id: 1, name: 'Central', railway: 'station', latitude: 22.28, longitude: 114.158}],
    [{osm_type: 'way', osm_id: 5, category: 'railway', type: 'station', lat: '22.2805', lon: '114.1585', display_name: 'Central Park', namedetails: {name: 'Central Park'}}]);
  assert.deepEqual(parkNearby.rail.map(r => r.osm_id), [1, 5]);
});

test('country names to zoom 7 above station names; states and provinces from zoom 4', async () => {
  const style = JSON.parse(await readFile(new URL('../styles/world.style.json', import.meta.url)));
  const ids = style.layers.map(l => l.id), last = ids.lastIndexOf.bind(ids);
  for (const id of ['country_label', 'country_label-other']) {
    const layer = style.layers.find(l => l.id === id);
    assert.ok(last(id) > last('station-detail-large-names'), `${id} placed before station names`);
    const opacity = z => styleSpec.expression.createPropertyExpression(layer.paint['text-opacity'], styleSpec.latest.paint_symbol['text-opacity']).value.evaluate({zoom: z});
    assert.equal(opacity(6), 1, `${id} still shown at zoom 6`);
    assert.equal(opacity(8), 0);
  }
  const state = style.layers.find(l => l.id === 'state_label');
  assert.deepEqual([state.source, state['source-layer'], state.minzoom, state.maxzoom], ['openmaptiles', 'place', 4, 10]);
  const filter = featureFilter(state.filter);
  assert.equal(filter.filter({zoom: 6}, {type: 1, properties: {class: 'province', name: '岩手県'}}), true, 'Japanese prefectures are provinces');
  assert.equal(filter.filter({zoom: 6}, {type: 1, properties: {class: 'state'}}), true);
  assert.equal(filter.filter({zoom: 6}, {type: 1, properties: {class: 'town'}}), false);
  assert.equal(featureFilter(style.layers.find(l => l.id === 'place_label_other').filter).filter({zoom: 9}, {type: 1, properties: {class: 'province'}}), false, 'not drawn twice');
});

test('owner view: a colour per owner name, the same everywhere; its own tile sources', async () => {
  const {ownerColor, ownerPaint, MODES, readSettings, UNKNOWN_COLOR} = await import('../styles/map-model.mjs');
  assert.ok(MODES.includes('owner'));
  assert.equal(ownerColor('Network Rail'), ownerColor(' network rail '), 'case and spacing do not change it');
  assert.notEqual(ownerColor('DB Netz AG'), ownerColor('DB InfraGO AG'));
  assert.equal(ownerColor(''), null); assert.equal(ownerColor(undefined), null);
  for (const name of ['CSX Transportation', 'Adif', '九廣鐵路公司 Kowloon-Canton Railway Corporation']) {
    const [, h, s, l] = /^hsl\((\d+), (\d+)%, (\d+)%\)$/.exec(ownerColor(name)).map(Number);
    assert.ok(h < 360 && s >= 62 && l >= 34 && l <= 50, 'saturated, mid lightness: never the grey of not recorded');
  }
  assert.deepEqual(ownerPaint(), ['coalesce', ['get', 'owner_color'], UNKNOWN_COLOR]);
  assert.equal(readSettings('?mode=owner').mode, 'owner');
  const tracks = style.layers.find(l => l.id === 'owner-tracks'), overview = style.layers.find(l => l.id === 'owner-overview');
  assert.deepEqual([tracks.source, overview.source], ['ownerRail', 'ownerLow']);
  assert.equal(tracks.layout.visibility, 'none');
  assert.deepEqual([style.sources.ownerRail.url, style.sources.ownerLow.url].map(u => u.split('/').pop()), ['railway_line_high', 'operator_railway_line_low']);
  // Owner names written along the tracks; clicked lines link to their way.
  assert.deepEqual(style.layers.find(l => l.id === 'owner-labels').layout['text-field'], ['get', 'owner']);
  const {osmObject} = await import('../styles/map-model.mjs');
  for (const source of ['ownerRail', 'ownerLow']) assert.deepEqual(osmObject({source, properties: {id: '660796156-0'}}), {type: 'way', id: '660796156'});
});
