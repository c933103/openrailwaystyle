import test from 'node:test';
import assert from 'node:assert/strict';
import {panSpeed, panDirection, RAMP_MS} from '../styles/keyboard-pan.mjs';

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
