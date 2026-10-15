// Serialize this function into the page. MapLibre's loaded() can be true
// while symbol placement still prevents idle; the app updates its ordinary
// reference-coverage status at idle. A fresh repaint also covers a map that
// already went idle before the checker attached. waitUntil bounds this wait.
export async function railReferenceSettled(map = window.referenceMap) {
  await new Promise(resolve => {
    map.once('idle', resolve);
    map.triggerRepaint();
  });
  return map.loaded() && map.areTilesLoaded() && !map.isMoving();
}
