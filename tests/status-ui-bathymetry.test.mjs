import assert from 'node:assert/strict';
import test from 'node:test';
import {mapErrorMessage, updateMapStatus} from '../styles/status-ui.mjs';

const bathymetryWarning = 'Bathymetry tiles could not load. Seabed shading may be incomplete.';
const genericWarning = 'Some map data could not load. Check your connection or reload to retry.';
const inputs = (ids = []) => ({
  errors: new Map(ids.map(id => [id, {}])),
  settings: {relief: true},
  terrain3DSelected: true,
});

test('bathymetry-only failure names the affected layer without implying basemap failure', () => {
  assert.equal(mapErrorMessage(inputs(['bathymetry'])), bathymetryWarning);
  assert.equal(mapErrorMessage(inputs(['bathymetry', 'openmaptiles'])), genericWarning);
});

test('bathymetry leaves railway and active 3D elevation failures visible', () => {
  assert.match(mapErrorMessage(inputs(['bathymetry', 'railway'])), /^OpenRailwayMap railway data unavailable/);
  assert.match(mapErrorMessage(inputs(['bathymetry', 'terrain3d'])), /^3D elevation tiles could not load/);
});

test('the bathymetry warning clears when the tracked source recovers', () => {
  const context = inputs(['bathymetry']);
  const classes = new Set();
  let failed = true;
  context.sourceFailureStates = new Map([['bathymetry', {
    current: () => true, hasFailures: () => failed,
  }]]);
  context.errors.get('bathymetry').failures = context.sourceFailureStates.get('bathymetry');
  context.applyRailReferenceState = () => {};
  context.applyStationFallbackState = () => {};
  context.status = {classList: {add: x => classes.add(x), remove: x => classes.delete(x)}};
  context.map = {getZoom: () => 2};
  context.ready = false;
  updateMapStatus(context);
  assert.equal(context.status.textContent, bathymetryWarning);
  assert.ok(classes.has('error'));
  failed = false;
  updateMapStatus(context);
  assert.equal(context.status.textContent, 'Worldwide coverage · click a line');
  assert.equal(classes.has('error'), false);
  assert.equal(context.errors.size, 0);
});
