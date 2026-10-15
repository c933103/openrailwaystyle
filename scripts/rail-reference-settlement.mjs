// Serialize this function into the page. MapLibre's loaded() can be true
// while symbol placement still prevents idle; the app updates its ordinary
// reference-coverage status at idle. A fresh repaint also covers a map that
// already went idle before the checker attached. waitUntil bounds this wait.
export async function railReferenceSettled(map = window.referenceMap) {
  // A terminal tile error marks it settled without firing the success-path
  // data event/repaint. Poll source completion first, then request the idle
  // frame; an earlier repaint could finish while that failed tile is pending.
  if (!map.loaded() || !map.areTilesLoaded() || map.isMoving()) return false;
  await new Promise(resolve => {
    map.once('idle', resolve);
    map.triggerRepaint();
  });
  return map.loaded() && map.areTilesLoaded() && !map.isMoving();
}
