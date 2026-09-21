import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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
  assert.deepEqual(readSettings('?mode=electrification&stations=0&inactive=0'), { mode:'electrification',stations:false,labels:true,inactive:false });
  assert.equal(readSettings('?mode=invalid').mode, 'speed');
});
test('world map has no European rail source or geographic bounds', () => {
  assert.ok(!JSON.stringify(style).includes('europe-railway'));
  for (const source of Object.values(style.sources)) assert.equal(source.bounds, undefined);
  const ids = style.layers.map(l => l.id);
  assert.equal(ids.length, new Set(ids).size);
  for (const layer of style.layers) if (layer.source) assert.ok(style.sources[layer.source], layer.id);
});
test('stations retain independent markers and priority labels across zoom transitions', () => {
  for (const [key, min, max] of [['stationLow',4,7],['stationMed',7,8],['stations',8,undefined]]) {
    const circle = style.layers.find(l => l.id === `station-${key}-dots`);
    const text = style.layers.find(l => l.id === `station-${key}-names`);
    assert.equal(circle.minzoom,min); assert.equal(circle.maxzoom,max);
    assert.equal(text.minzoom,min); assert.equal(text.maxzoom,max);
    assert.ok(text.layout['symbol-sort-key']);
    assert.equal(text.layout['text-allow-overlap'],false);
    assert.ok(style.layers.indexOf(text) > style.layers.findIndex(l => l.id === 'place_label_city'));
  }
});
test('only present lines receive operating speed colours', () => {
  const layer = style.layers.find(l => l.id === 'speed-tracks');
  assert.ok(JSON.stringify(layer.filter).includes('present'));
  assert.ok(JSON.stringify(layer.paint['line-color']).includes('coalesce'));
  assert.ok(JSON.stringify(layer.paint['line-color']).includes(UNKNOWN_COLOR));
  assert.ok(style.layers.find(l => l.id === 'inactive-railways').paint['line-dasharray']);
});
