import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import { SPEED_BANDS, UNKNOWN_COLOR, numericSpeed, speedColor, formatSpeed, readSettings } from '../styles/map-model.mjs';
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
test('source mph and directional speed labels are preserved', () => {
  assert.deepEqual(formatSpeed({ maxspeed: 160.9344, speed_label: '100 mph' }), { mapped: '160.9 km/h (100 mph)', tagged: '100 mph' });
  assert.equal(formatSpeed({ maxspeed: 160, speed_label: '160 / 120' }).tagged, '160 / 120 (km/h)');
  assert.equal(formatSpeed({ maxspeed: 80.4672, speed_label: '50 mph (30 mph)' }).tagged, '50 mph (30 mph)');
  assert.equal(formatSpeed({ speed_label: '- / 80' }).tagged, '- / 80 (km/h)');
});
test('shared URLs keep display settings and reject invalid map modes', () => {
  assert.deepEqual(readSettings('?mode=electrification&stations=0&inactive=0'), { mode:'electrification',stations:false,labels:true,inactive:false,relief:true,names:true,autoGlobe:true,units:'metric',detail:false,language:'local' });
  assert.equal(readSettings('?mode=invalid').mode, 'speed');
  // A remembered language applies unless the URL names one.
  assert.equal(readSettings('', {language:'ja'}).language, 'ja');
  assert.equal(readSettings('?language=ko', {language:'ja'}).language, 'ko');
  assert.equal(readSettings('', {language:'xx'}).language, 'local');
  assert.deepEqual(readSettings('?relief=1', {relief:false, stations:false, mode:'bogus', units:'imperial'}), {mode:'speed',stations:false,labels:true,inactive:true,relief:true,names:true,autoGlobe:true,units:'imperial',detail:false,language:'local'});
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
  assert.equal(shown(10, {station_size:'large',station:'subway'}),false);
  assert.equal(shown(11, {station_size:'large',station:'subway'}),true);
  assert.equal(shown(12.9, {feature:'tram_stop'}),false);
  assert.equal(shown(13, {feature:'tram_stop'}),true);
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
  const layers=style.layers.filter(l=>/^inactive-regional-(construction|proposed|former)$/.test(l.id));
  assert.equal(layers.length,3);
  assert.equal(style.sources.inactiveRegional.type,'vector');
  assert.deepEqual(style.sources.inactiveRegional.tiles,['railtiles://{z}/{x}/{y}']);
  for(const layer of layers) {assert.equal(layer.minzoom,0);assert.equal(layer.maxzoom,12);}
  // Exactly one state layer draws each feature.
  const filter={filter:(zoom,feature)=>{const hits=layers.filter(l=>featureFilter(l.filter).filter(zoom,feature)).length;assert.ok(hits<=1);return hits===1;}};
  // Construction at every zoom, proposals from z5, former lines from z7.
  const lowest={construction:0,proposed:5,disused:7,abandoned:7,razed:7};
  for(const zoom of [0,2,4.99,5,6.99]) for(const [state,min] of Object.entries(lowest)) {
    assert.equal(filter.filter({zoom},{type:2,properties:{state,feature:'tram',usage:'',service:''}}),zoom>=min,`${state} at z${zoom}`);
  }
  for(const zoom of [7,7.83,8,9,10,11.99]) for(const state of ['proposed','construction','disused','abandoned','razed']) {
    assert.equal(filter.filter({zoom},{type:2,properties:{state,feature:'rail',usage:'main',service:''}}),true);
  }
  for(const state of ['construction','proposed','former']) assert.equal(style.layers.find(l=>l.id===`inactive-railways-${state}`).minzoom,12);
});
test('only present lines receive operating speed colours', () => {
  const layer = style.layers.find(l => l.id === 'speed-tracks');
  assert.ok(JSON.stringify(layer.filter).includes('present'));
  assert.ok(JSON.stringify(layer.paint['line-color']).includes('coalesce'));
  assert.ok(JSON.stringify(layer.paint['line-color']).includes(UNKNOWN_COLOR));
  const dashes = ['construction','proposed','former'].map(state => JSON.stringify(style.layers.find(l => l.id === `inactive-railways-${state}`).paint['line-dasharray']));
  assert.equal(new Set(dashes).size, 3, 'each lifecycle state has its own dash pattern');
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
  const line = (y, extra = {}) => ({group:'rail', main:true, parts:[[[0, y], [1000, y + 20]]], ...extra});
  const lines = [line(0), line(4.5), line(9), line(15, {main:false}), line(115), line(119.5),
    {group:'rail', main:true, parts:[[[500, -300], [500, 300]]]}, line(6, {group:'rail-tunnel'})];
  const result = countTracks(lines, 1);
  assert.deepEqual(result.map(r => r.tracks), [4, 4, 4, 4, 2, 2, 1, 1]);
  // One running line labelled per bundle; never the siding.
  assert.equal(result.slice(0, 4).filter(r => r.label).length, 1);
  assert.equal(result[3].label, false);
  assert.equal(result.slice(4, 6).filter(r => r.label).length, 1);
  // Only present, non-ferry lines are counted; tunnels and trams separately.
  const feature = (properties, type = 2) => ({type, properties, loadGeometry: () => [[{x:0, y:0}, {x:1, y:1}]]});
  const input = trackLines([feature({state:'construction'}), feature({feature:'ferry'}), feature({}, 1), feature({tunnel:true}), feature({feature:'tram', service:'siding'})]);
  assert.deepEqual(input.map(l => l && [l.group, l.main]), [null, null, null, ['rail-tunnel', true], ['tram', false]]);
});
test('track counts label the Infrastructure view from zoom 12', () => {
  const layer = style.layers.find(l => l.id === 'infrastructure-track-count');
  assert.equal(layer.minzoom, 12);
  assert.equal(featureFilter(layer.filter).filter({zoom:13}, {type:2, properties:{atlas_tracks:4, atlas_tracks_label:true}}), true);
  assert.equal(featureFilter(layer.filter).filter({zoom:13}, {type:2, properties:{atlas_tracks:1, atlas_tracks_label:true}}), true);
  assert.equal(featureFilter(layer.filter).filter({zoom:13}, {type:2, properties:{atlas_tracks_label:true}}), false);
  assert.equal(featureFilter(layer.filter).filter({zoom:13}, {type:2, properties:{atlas_tracks:4, atlas_tracks_label:false}}), false);
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

test('legend groups values drawn in the same colour and summarises the rest', async () => {
  const {legendRows} = await import('../styles/map-model.mjs');
  const rows = legendRows([
    {row: ['#a', 'GB1', 4.32, '4.32 m high'], n: 50}, {row: ['#a', 'GA', 4.32, '4.32 m high'], n: 20},
    {row: ['#b', 'GC', 4.65, '4.65 m high'], n: 30}, {row: ['#c', 'PPI', 4.28, '4.28 m high'], n: 1},
  ], 2);
  assert.deepEqual(rows, [['#a', 'GB1, GA · 4.32 m high'], ['#b', 'GC · 4.65 m high'], ['transparent', '1 less common value in view; zoom in for them', 'empty']]);
});

test('globe below zoom 4; flat map from zoom 4 unless the view is mostly polar', async () => {
  const {autoProjection} = await import('../styles/map-model.mjs');
  assert.equal(autoProjection(1.8, 0), 'globe');
  assert.equal(autoProjection(3.99, 0.9), 'globe');
  assert.equal(autoProjection(4, 0.2), 'mercator');
  assert.equal(autoProjection(6, 0.7), null); // leave as is near the poles
});
