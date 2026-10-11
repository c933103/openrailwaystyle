// Pure Web Mercator camera geometry for the two-panel browser acceptance harness.
// These helpers make off-screen negative probes a local unit-test failure.
import assert from 'node:assert/strict';
export const GEOMETRY_TEST_ZOOMS = [9, 12, 16];
export const GEOMETRY_TEST_PANE = {width: 676, height: 470};
const mercator = ([lon, lat]) => [lon / 360 + 0.5, (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2];
const coordinate = ([x, y]) => [(x - 0.5) * 360, Math.atan(Math.sinh((1 - 2 * y) * Math.PI)) * 180 / Math.PI];
export const activeNegativeProbes = (probe, zoom) => probe.negativeProbes.filter(point => !point.zooms || point.zooms.includes(zoom));
export function geometryTestCenter(probe, zoom) {
  if (zoom < 16) return probe.center;
  const points = [probe.positive.point, ...activeNegativeProbes(probe, zoom).map(point => point.point)].map(mercator);
  return coordinate([0, 1].map(axis => (Math.min(...points.map(p => p[axis])) + Math.max(...points.map(p => p[axis]))) / 2));
}
export function geometryTestPixel(point, center, zoom, {width, height} = GEOMETRY_TEST_PANE) {
  const [x, y] = mercator(point), [cx, cy] = mercator(center), size = 512 * 2 ** zoom;
  return [(x - cx) * size + width / 2, (y - cy) * size + height / 2];
}
export function validateGeometryTestFrames(probes) {
  for (const probe of probes) for (const zoom of GEOMETRY_TEST_ZOOMS) {
    const negatives = activeNegativeProbes(probe, zoom);
    assert.ok(negatives.length, `${probe.id} z${zoom}: a negative control must be active`);
    const center = geometryTestCenter(probe, zoom);
    for (const {id, point} of [{id: 'positive', point: probe.positive.point}, ...negatives]) {
      const [x, y] = geometryTestPixel(point, center, zoom);
      assert.ok(x >= 16 && x <= GEOMETRY_TEST_PANE.width - 16 && y >= 16 && y <= GEOMETRY_TEST_PANE.height - 16,
        `${probe.id} z${zoom} ${id}: probe outside acceptance pane (${x.toFixed(1)}, ${y.toFixed(1)})`);
    }
  }
}
