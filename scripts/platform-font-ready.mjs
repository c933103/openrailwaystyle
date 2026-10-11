// Serialized by Playwright and evaluated in the page. The global fallback
// already names SC candidates before probing finishes; the renderer uses the
// station layer's explicit stack instead. These fixture fonts select Noto Sans
// SC, or Atlas CJK SC if its packaged face has already finished loading.
// Only the final check also waits for already-queued renderer work to drain.
export function stationScFontReady({requireMapLoaded = false} = {}) {
  const map = window.reviewMap;
  if (!map?.isStyleLoaded() || (requireMapLoaded && !map.loaded())) return false;
  const fonts = map.getStyle()?.layers?.find(layer => layer.id.startsWith('station-') && layer.type === 'symbol')?.layout?.['text-font'];
  return Array.isArray(fonts) && fonts.every(font => typeof font === 'string') && (fonts.includes('Noto Sans SC') || fonts.includes('Atlas CJK SC'));
}
