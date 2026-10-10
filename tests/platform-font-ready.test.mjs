import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stationScFontReady} from '../scripts/platform-font-ready.mjs';

// Exercise the same serialized callback Playwright runs, without Node globals
// or closure values accidentally making an invalid browser callback pass.
const evaluate = window => vm.runInNewContext(`(${stationScFontReady})()`, {window});
const station = fonts => ({id: 'station-major-label', type: 'symbol', layout: {'text-font': fonts}});
const state = (fonts, {loaded = true, layers = [station(fonts)]} = {}) => ({reviewMap: {
  isStyleLoaded: () => loaded,
  getStyle: () => ({layers}),
  style: {glyphManager: {localIdeographFontFamily: '"Noto Sans SC","Microsoft YaHei",sans-serif'}},
}});

test('SC readiness rejects the initial fallback until the chosen family reaches the layer', () => {
  const window = state(['Noto Sans Bold', 'Atlas Rare Han']);
  assert.ok(window.reviewMap.style.glyphManager.localIdeographFontFamily.includes('Noto Sans SC'), 'the former precondition releases before selection');
  assert.equal(evaluate(window), false);
  window.reviewMap.getStyle = () => ({layers: [station(['Noto Sans Bold', 'Noto Sans SC', 'Atlas Rare Han'])]});
  assert.equal(evaluate(window), true, 'selection applied to the actual layer releases the draw');
});

test('SC readiness accepts already-selected and already-packaged fast paths', () => {
  for (const family of ['Noto Sans SC', 'Atlas CJK SC']) {
    assert.equal(evaluate(state(['Noto Sans Bold', family, 'Atlas Rare Han'])), true, family);
  }
});

test('SC readiness waits for the current style to load even with an SC stack', () => {
  for (const family of ['Noto Sans SC', 'Atlas CJK SC']) {
    assert.equal(evaluate(state([family], {loaded: false})), false, family);
  }
});

test('packaged SC readiness can change while the explicit font stack stays unchanged', () => {
  const fonts = ['Noto Sans Bold', 'Atlas CJK SC', 'Atlas Rare Han'];
  const window = state(fonts);
  let loaded = true;
  window.reviewMap.isStyleLoaded = () => loaded;
  assert.equal(evaluate(window), true);
  loaded = false;
  assert.equal(evaluate(window), false, 'pending source work also makes the current style unready');
  loaded = true;
  assert.equal(evaluate(window), true, 'the complete predicate recovers without changing fonts');
  assert.equal(window.reviewMap.getStyle().layers[0].layout['text-font'], fonts);
});

test('SC readiness requires an exact family element in the station symbol layer', () => {
  for (const fonts of [undefined, null, 'Noto Sans SC', ['Noto Sans TC'], ['Atlas CJK TC'], ['Noto Sans SC Extra'], ['Atlas CJK SC Extra'], ['Noto Sans SC,Atlas Rare Han']]) {
    assert.equal(evaluate(state(fonts)), false, JSON.stringify(fonts));
  }
  assert.equal(evaluate(state(['match', ['get', 'kind'], 'Noto Sans SC', ['literal', ['Other']], ['literal', ['Other']]])), false, 'an expression mentioning SC is not an explicit selected stack');
  for (const layers of [undefined, [], [station(['Atlas CJK TC']), {id: 'other-label', type: 'symbol', layout: {'text-font': ['Noto Sans SC']}}], [{...station(['Noto Sans SC']), type: 'line'}], [{id: 'station-major-label', type: 'symbol'}]]) {
    assert.equal(evaluate(state(undefined, {layers})), false);
  }
  assert.equal(evaluate({}), false);
  assert.equal(evaluate({reviewMap: {isStyleLoaded: () => true, getStyle: () => undefined}}), false);
});
