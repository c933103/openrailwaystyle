import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {stationScFontReady,stationTcFontReady,platformFontState,withFontFailureDiagnostics} from '../scripts/platform-font-ready.mjs';

// Exercise the same serialized callback Playwright runs, without Node globals
// or closure values accidentally making an invalid browser callback pass.
const evaluate = (window, options) => vm.runInNewContext(`(${stationScFontReady})(options)`, {window, options});
const station = fonts => ({id: 'station-major-label', type: 'symbol', layout: {'text-font': fonts}});
const state = (fonts, {loaded = true, layers = [station(fonts)]} = {}) => ({reviewMap: {
  isStyleLoaded: () => loaded,
  loaded: () => loaded,
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

test('final SC readiness waits for renderer work without delaying the pre-draw font check', () => {
  for (const family of ['Noto Sans SC', 'Atlas CJK SC']) {
    const window = state(['Noto Sans Bold', family, 'Atlas Rare Han']);
    let mapLoaded = false;
    window.reviewMap.loaded = () => mapLoaded;
    assert.equal(evaluate(window), true, 'the original pre-draw predicate stays unchanged');
    assert.equal(evaluate(window, {requireMapLoaded: true}), false, 'loaded fonts alone do not complete queued renderer work');
    mapLoaded = true;
    assert.equal(evaluate(window, {requireMapLoaded: true}), true, 'drained renderer work releases the final check');
    mapLoaded = false;
    assert.equal(evaluate(window, {requireMapLoaded: true}), false, 'new pending work closes the final gate again');
  }
  assert.equal(evaluate(state(['Atlas CJK TC']), {requireMapLoaded: true}), false, 'renderer completion does not replace the SC font requirement');
  assert.equal(evaluate(state(['Atlas CJK SC'], {loaded: false}), {requireMapLoaded: true}), false, 'renderer completion does not replace current-style readiness');
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


test('failure snapshot distinguishes both TC conjuncts without triggering font loads', () => {
  for (const fontReady of [false, true]) for (const familyReady of [false, true]) {
    const window = state(['Noto Sans TC']);
    window.reviewMap.style.glyphManager.localIdeographFontFamily = familyReady ? 'Atlas CJK TC' : 'Noto Sans TC';
    const fonts = [{family: 'Atlas CJK TC', status: fontReady ? 'loaded' : 'unloaded', unicodeRange: 'U+0-10FFFF'}];
    fonts.check = value => { assert.equal(value, '24px "Atlas CJK TC"'); return fontReady; };
    const snapshot = vm.runInNewContext(`(${platformFontState})()`, {window, document: {fonts}});
    assert.equal(snapshot.tcFontCheck, fontReady);
    assert.equal(snapshot.tcGlyphFamily, familyReady);
    assert.equal(snapshot.fonts[0].status, fonts[0].status);
    assert.equal(snapshot.stationFonts[0], 'Noto Sans TC');
  }
});

test('success does not collect or log diagnostics', async () => {
  assert.equal(await withFontFailureDiagnostics({evaluate: () => assert.fail('no evaluation')}, 'mobile',
    async () => 42, () => assert.fail('no logging')), 42);
});

test('failed gate logs once and rethrows the exact original error', async () => {
  const failure = new Error('original gate'), calls = [];
  await assert.rejects(withFontFailureDiagnostics({evaluate: async callback => {
    assert.equal(callback, platformFontState); return {tcFontCheck: false, tcGlyphFamily: true};
  }}, 'mobile', async () => { throw failure; }, (...args) => calls.push(args)), error => error === failure);
  assert.deepEqual(calls, [['PLATFORM_FONT_DIAGNOSTIC', 'mobile', '{"tcFontCheck":false,"tcGlyphFamily":true}']]);
});

test('diagnostic evaluation and logging failures cannot replace the original gate error', async () => {
  for (const evaluate of [() => { throw Error('closed'); }, async () => { throw Error('closed'); }]) {
    const failure = new Error('gate');
    await assert.rejects(withFontFailureDiagnostics({evaluate}, 'mobile', async () => { throw failure; },
      () => { throw Error('logger'); }), error => error === failure);
  }
});

test('unresponsive diagnostic evaluation is bounded and retains the original failure', async () => {
  const failure = new Error('gate'), logs = [];
  await assert.rejects(withFontFailureDiagnostics({evaluate: () => new Promise(() => {})}, 'mobile',
    async () => { throw failure; }, (...args) => logs.push(args)), error => error === failure);
  assert.equal(JSON.parse(logs[0][2]).unavailable, 'diagnostic deadline');
});


test('TC draw waits for selected station stack and ready style, independently of global family', () => {
  for (const [fonts, expected] of [
    [['Noto Sans Bold', 'Atlas Rare Han'], false], [['Noto Sans TC'], true],
    [['Atlas CJK TC'], true], [['Noto Sans SC'], false], [['Noto Sans TC Extra'], false],
    [['match', ['get', 'kind'], 'Noto Sans TC'], false], [null, false],
  ]) {
    const window = state(fonts);
    window.reviewMap.style.glyphManager.localIdeographFontFamily = 'Noto Sans TC';
    assert.equal(vm.runInNewContext(`(${stationTcFontReady})()`, {window}), expected);
    window.reviewMap.isStyleLoaded = () => false;
    assert.equal(vm.runInNewContext(`(${stationTcFontReady})()`, {window}), false);
  }
  assert.equal(vm.runInNewContext(`(${stationTcFontReady})()`, {window: {}}), false);
});

test('failure snapshot includes quoted FontFace family names as returned by browsers', () => {
  const fonts = [{family: '"Noto Sans TC"', status: 'loaded'}, {family: "'Atlas CJK TC'", status: 'unloaded'}];
  fonts.check = () => true;
  const snapshot = vm.runInNewContext(`(${platformFontState})()`, {window: state(['Noto Sans TC']), document: {fonts}});
  assert.equal(snapshot.fonts.length, 2);
  assert.equal(snapshot.fonts[1].status, 'unloaded');
});
