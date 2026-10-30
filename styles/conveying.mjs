// Escalators, moving walkways and elevators mapped as OSM ways: every one,
// with no length threshold, as part of the transport network.
// conveying=* on a way (not "no") is an escalator on highway=steps and a
// moving walkway elsewhere; highway=elevator on a way is a lift shaft or car.
const tokens = value => String(value ?? '').split(';').map(s => s.trim().toLowerCase()).filter(Boolean);
export const CONVEYING_DIRECTIONS = Object.freeze(['forward', 'backward', 'reversible']);
export const CONVEYING_KINDS = Object.freeze({escalator: 'Escalator', travelator: 'Moving walkway', elevator: 'Elevator'});
export function conveying(tags = {}) {
  if (tokens(tags.highway).includes('elevator')) return {kind: 'elevator', direction: ''};
  const values = tokens(tags.conveying);
  if (!values.length || values.every(v => v === 'no')) return null;
  // Only a single plain direction draws an arrow; yes or any mixed list
  // (forward;yes, no;backward) draws none.
  const direction = values.length === 1 && CONVEYING_DIRECTIONS.includes(values[0]) ? values[0] : '';
  return {kind: tokens(tags.highway).includes('steps') ? 'escalator' : 'travelator', direction};
}
