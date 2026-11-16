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


// Failure-only snapshot. Serialized in the page, with no imports or closures.
// This observes state; it must never request fonts, redraw, or release a gate.
export function platformFontState() {
  const map = window.reviewMap;
  const family = map?.style?.glyphManager?.localIdeographFontFamily;
  const layer = map?.getStyle()?.layers?.find(layer => layer.id.startsWith('station-') && layer.type === 'symbol');
  return {
    styleLoaded: map?.isStyleLoaded() ?? null,
    stationFonts: layer?.layout?.['text-font'] ?? null,
    glyphFamily: family ?? null,
    tcFontCheck: document.fonts.check('24px "Atlas CJK TC"'),
    tcGlyphFamily: typeof family === 'string' && family.includes('Atlas CJK TC'),
    fonts: [...document.fonts].filter(font => /^(Atlas CJK|Noto Sans|Noto Sans CJK|Source Han Sans|PingFang|Microsoft|Hiragino Sans)/.test(font.family))
      .map(({family, status, unicodeRange}) => ({family, status, unicodeRange})),
  };
}

// Keep the original assertion/error. A dead page or logger must not hide it.
// Diagnostic collection gets its own finite ceiling only AFTER gate failure.
export async function withFontFailureDiagnostics(page, kind, run, log = console.error) {
  try { return await run(); }
  catch (error) {
    let timer;
    try {
      const state = await Promise.race([
        Promise.resolve().then(() => page.evaluate(platformFontState)),
        new Promise(resolve => { timer = setTimeout(() => resolve({unavailable: 'diagnostic deadline'}), 2000); }),
      ]);
      log('PLATFORM_FONT_DIAGNOSTIC', kind, JSON.stringify(state));
    } catch {
      try { log('PLATFORM_FONT_DIAGNOSTIC', kind, 'unavailable'); } catch { /* preserve the original failure */ }
    } finally { clearTimeout(timer); }
    throw error;
  }
}
