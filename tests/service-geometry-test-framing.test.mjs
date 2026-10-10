import test from 'node:test';
import assert from 'node:assert/strict';
import {PARIS_PROBES} from '../scripts/paris-service-geometry-fixture.mjs';
import {geometryTestCenter, geometryTestPixel, validateGeometryTestFrames} from '../scripts/service-geometry-test-framing.mjs';

test('Paris browser framing keeps every positive and active negative probe visible at z9, z12 and z16', () => {
  validateGeometryTestFrames(PARIS_PROBES);
  for (const probe of PARIS_PROBES) {
    assert.deepEqual(geometryTestCenter(probe, 9), probe.center);
    assert.deepEqual(geometryTestCenter(probe, 12), probe.center);
    const negative = probe.negativeProbes.find(point => point.zooms.includes(16));
    const [x, y] = geometryTestPixel(negative.point, probe.center, 16);
    assert.ok(x < 0 || x > 676 || y < 0 || y > 470, 'original fixed terminal center reproduced an off-screen negative');
  }
});

test('browser framing refuses missing negatives and frames too wide to fit, rather than skipping assertions', () => {
  assert.throws(() => validateGeometryTestFrames([{...PARIS_PROBES[0], negativeProbes: []}]), /negative control must be active/);
  assert.throws(() => validateGeometryTestFrames([{...PARIS_PROBES[0], negativeProbes: [{id: 'too-far', point: [0, 45]}]}]), /outside acceptance pane/);
});
