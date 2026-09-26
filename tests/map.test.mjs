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
  const layer=style.layers.find(l=>l.id==='inactive-regional');
  assert.equal(style.sources.inactiveRegional.type,'vector');
  assert.deepEqual(style.sources.inactiveRegional.tiles,['railtiles://{z}/{x}/{y}']);
  assert.equal(layer.minzoom,0);assert.equal(layer.maxzoom,12);
  const filter=featureFilter(layer.filter);
  // Construction at every zoom, proposals from z5, former lines from z7.
  const lowest={construction:0,proposed:5,disused:7,abandoned:7,razed:7};
  for(const zoom of [0,2,4.99,5,6.99]) for(const [state,min] of Object.entries(lowest)) {
    assert.equal(filter.filter({zoom},{type:2,properties:{state,feature:'tram',usage:'',service:''}}),zoom>=min,`${state} at z${zoom}`);
  }
  for(const zoom of [7,7.83,8,9,10,11.99]) for(const state of ['proposed','construction','disused','abandoned','razed']) {
    assert.equal(filter.filter({zoom},{type:2,properties:{state,feature:'rail',usage:'main',service:''}}),true);
  }
  assert.equal(style.layers.find(l=>l.id==='inactive-railways').minzoom,12);
});
test('only present lines receive operating speed colours', () => {
  const layer = style.layers.find(l => l.id === 'speed-tracks');
  assert.ok(JSON.stringify(layer.filter).includes('present'));
  assert.ok(JSON.stringify(layer.paint['line-color']).includes('coalesce'));
  assert.ok(JSON.stringify(layer.paint['line-color']).includes(UNKNOWN_COLOR));
  assert.ok(style.layers.find(l => l.id === 'inactive-railways').paint['line-dasharray']);
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
test('seabed contours come from a finer source from zoom 9, without duplicates', async () => {
  const {contourOptions} = await import('../styles/map-model.mjs');
  const shows = (id, zoom, ele) => { const l = style.layers.find(x => x.id === id); return zoom >= l.minzoom && featureFilter(l.filter).filter({zoom}, {type:2, properties:{ele, level:1}}); };
  assert.equal(shows('terrain-contours', 8, -100), true);
  assert.equal(shows('terrain-contours', 9, -100), false);
  assert.equal(shows('terrain-contours', 9, 100), true);
  assert.equal(shows('terrain-seabed-contours', 9, -100), true);
  assert.equal(shows('terrain-seabed-contours', 9, 100), false);
  assert.deepEqual(contourOptions('metric', true).thresholds[11], [10, 50]);
  assert.equal(contourOptions('imperial', true).multiplier, 3.28084);
});
