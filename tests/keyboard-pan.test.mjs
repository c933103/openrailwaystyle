import test from 'node:test';
import assert from 'node:assert/strict';
import {panSpeed, panDirection, installKeyboardPan, RAMP_MS} from '../styles/keyboard-pan.mjs';

test('keyboard panning: a steady speed after a short ramp, never jumps', () => {
  assert.equal(panSpeed(0, 800), 0);
  const top = panSpeed(RAMP_MS, 800);
  assert.ok(Math.abs(top - 800 / 1.4) < 1e-9, 'about a screen in 1.4 s');
  assert.equal(panSpeed(5000, 800), top, 'held keys keep the same speed');
  let previous = 0;
  for (let t = 0; t <= RAMP_MS; t += 10) { const v = panSpeed(t, 800); assert.ok(v >= previous); previous = v; }
  assert.equal(panSpeed(RAMP_MS, 200), 400, 'a small map still pans briskly');
});

test('keyboard panning: held arrows combine into one unit direction', () => {
  assert.deepEqual(panDirection(['ArrowRight']), [1, 0]);
  const [x, y] = panDirection(['ArrowRight', 'ArrowDown']);
  assert.ok(Math.abs(x - Math.SQRT1_2) < 1e-12 && Math.abs(y - Math.SQRT1_2) < 1e-12);
  assert.deepEqual(panDirection(['ArrowLeft', 'ArrowRight']), [0, 0]);
  assert.deepEqual(panDirection(['a']), [0, 0]);
});

test('keyboard panning: a held key is one movement, ended on release', () => {
  const frames = [];
  globalThis.requestAnimationFrame = callback => frames.push(callback);
  globalThis.cancelAnimationFrame = () => { frames.length = 0; };
  const listeners = {}, fired = [];
  const container = {clientWidth: 800, clientHeight: 600, addEventListener: (type, f) => { listeners[type] = f; }};
  class Camera {
    fire(event) { fired.push(typeof event === 'string' ? event : event.type); return this; }
    panBy(offset, options) { this.fire('movestart'); this.fire('move'); if (options.animate !== false) this.fire('move'); this.fire('moveend'); }
    stop() {}
    getContainer() { return container; }
    getCanvasContainer() { return container; }
  }
  const map = new Camera(), key = name => ({key: name, preventDefault() {}, stopImmediatePropagation() {}});
  globalThis.window = {addEventListener() {}};
  installKeyboardPan(map, {reducedMotion: () => true});
  listeners.keydown(key('ArrowRight'));
  let now = performance.now();
  for (let i = 0; i < 30; i++) frames.shift()(now += 16);
  assert.equal(fired.filter(t => t === 'movestart').length, 1);
  assert.equal(fired.filter(t => t === 'moveend').length, 0, 'nothing settles while the key is held');
  assert.ok(fired.filter(t => t === 'move').length >= 29);
  listeners.keyup(key('ArrowRight'));
  assert.equal(fired.filter(t => t === 'moveend').length, 1, 'one end on release');
  assert.ok(!Object.hasOwn(map, 'fire'), 'events flow as usual afterwards');
  map.panBy([1, 0], {});
  assert.equal(fired.filter(t => t === 'moveend').length, 2);
  delete globalThis.window; delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame;
});
