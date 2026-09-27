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
  assert.deepEqual(readSettings('?mode=electrification&stations=0&inactive=0'), { mode:'electrification',stations:false,labels:true,inactive:false,relief:true,names:true,units:'metric',detail:false,language:'local' });
  assert.equal(readSettings('?mode=invalid').mode, 'speed');
  // A remembered language applies unless the URL names one.
  assert.equal(readSettings('', {language:'ja'}).language, 'ja');
  assert.equal(readSettings('?language=ko', {language:'ja'}).language, 'ko');
  assert.equal(readSettings('', {language:'xx'}).language, 'local');
  assert.deepEqual(readSettings('?relief=1', {relief:false, stations:false, mode:'bogus', units:'imperial'}), {mode:'speed',stations:false,labels:true,inactive:true,relief:true,names:true,units:'imperial',detail:false,language:'local'});
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
test('power view separates AC by frequency and DC by voltage', async () => {
  const {electrificationPaint, ELECTRIFICATION, describeCurrent} = await import('../styles/map-model.mjs');
  const {expression} = await import('@maplibre/maplibre-gl-style-spec');
  const e = expression.createExpression(electrificationPaint()).value;
  const hex = c => typeof c === 'string' ? c : '#' + [c.r, c.g, c.b].map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
  const colour = properties => hex(e.evaluate({zoom:8}, {properties}));
  const row = label => ELECTRIFICATION.find(([, l]) => l === label)[0];
  assert.equal(colour({electrification_state:'present', voltage:25000, frequency:50}), row('AC 50 Hz'));
  assert.equal(colour({electrification_state:'present', voltage:25000, frequency:60}), row('AC 60 Hz'));
  assert.equal(colour({electrification_state:'present', voltage:15000, frequency:16.7}), row('AC 16.7 Hz'));
  assert.equal(colour({electrification_state:'present', voltage:1500, frequency:0}), row('DC 1–< 2 kV'));
  assert.equal(colour({electrification_state:'present', voltage:750, frequency:0}), row('DC < 1 kV'));
  assert.equal(colour({electrification_state:'present', voltage:3000, frequency:0}), row('DC ≥ 2 kV'));
  assert.equal(colour({electrification_state:'no'}), row('Not electrified'));
  assert.equal(describeCurrent(25000, 50), '25 kV AC 50 Hz');
  assert.equal(describeCurrent(1500, 0), '1.5 kV DC');
  assert.equal(describeCurrent(750, 0), '750 V DC');
});
test('train control and gauge views have their own layers and colours', async () => {
  const {controlPaint, gaugePaint, GAUGES, MODES} = await import('../styles/map-model.mjs');
  const {expression} = await import('@maplibre/maplibre-gl-style-spec');
  assert.ok(MODES.includes('control') && MODES.includes('gauge'));
  for (const id of ['control-overview','control-tracks','gauge-overview','gauge-tracks','gauge-dual']) assert.ok(style.layers.find(l => l.id === id), id);
  assert.equal(style.sources.control.url, 'https://openrailwaymap.app/signals_railway_line_low');
  assert.equal(style.sources.gaugeLow.url, 'https://openrailwaymap.app/track_railway_line_low');
  const hex = c => typeof c === 'string' ? c : '#' + [c.r, c.g, c.b].map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
  const control = expression.createExpression(controlPaint()).value;
  assert.equal(hex(control.evaluate({zoom:8}, {properties:{train_protection0:'etcs_2'}})), '#173f8a');
  assert.equal(hex(control.evaluate({zoom:8}, {properties:{}})), UNKNOWN_COLOR);
  const gauge = expression.createExpression(gaugePaint()).value;
  const g = mm => hex(gauge.evaluate({zoom:8}, {properties:{gaugeint0:mm}}));
  assert.equal(g(1435), GAUGES.find(r => r[3].startsWith('1435'))[2]);
  assert.equal(g(1067), GAUGES.find(r => r[3].startsWith('1067'))[2]);
  assert.equal(g(1520), g(1524));
  assert.equal(g(-1), UNKNOWN_COLOR);
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
