// Synthetic old-shell contract, not historical application source. Only the
// observable cache-upgrade boundary is modeled: a known failure is forgotten
// when its tile leaves the active inventory, so a cached return cannot restore
// fallback or retry demand. Real current-source behavior is tested separately.
export const version = '20261016-hidden-tile-masks-1';
export const files = {
  'app.mjs': 'export const fixture = "previous cached station shell";',
  'station-fallback.mjs': `
export function createStationFallbackState(map) {
  let failed = false;
  return {
    noteError() { failed = true; },
    area() {
      if (!map.style.tileManagers.stations.getIds().length) failed = false;
      return failed ? {} : null;
    },
  };
}`,
  'rail-provider-recovery.mjs': `
export function createRailProviderRecovery(map, {setTimer, clearTimer}) {
  let failed = false, timer = null;
  function wake() {
    if (!map.style.tileManagers.stations.getIds().length) failed = false;
    if (!failed && timer !== null) { clearTimer(timer); timer = null; }
    if (failed && timer === null) timer = setTimer(() => {}, 5000);
  }
  return {
    noteError() { failed = true; wake(); },
    hasFailures() { return failed; }, wake,
    dispose() { if (timer !== null) clearTimer(timer); },
  };
}`,
};
