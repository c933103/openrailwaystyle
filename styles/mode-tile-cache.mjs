// MapLibre 5.24 calls decoded source caches tileManagers. Clear only a source
// whose EVERY layer belongs to another theme and is already layout-hidden.
// Shared/raw protocol caches and sources without an explicit theme stay warm.
export function pruneModeTiles(map, previous, next) {
  if (!previous || previous === next) return [];
  const groups = new Map();
  for (const layer of map.getStyle()?.layers || []) {
    if (typeof layer.source !== 'string') continue;
    const layers = groups.get(layer.source) || [];
    layers.push(layer); groups.set(layer.source, layers);
  }
  const cleared = [];
  for (const [id, layers] of groups) {
    if (!layers.some(layer => layer.metadata?.['atlas:views']?.includes(previous))) continue;
    if (!layers.every(layer => {
      const views = layer.metadata?.['atlas:views'];
      return Array.isArray(views) && views.length > 0 && !views.includes(next)
        && layer.layout?.visibility === 'none';
    })) continue;
    const manager = map.style?.tileManagers?.[id];
    if (typeof manager?.clearTiles !== 'function' || typeof manager.getSource !== 'function'
      || manager.getSource() !== map.getSource(id)) continue;
    manager.clearTiles();
    cleared.push(id);
  }
  return cleared;
}
