// Traditional Mongolian in map labels: per-run shaping inside the map's
// own shaping layer, the way the RTL plugin's Arabic shaping is hooked
// into transformText there (see docs/maplibre-backport.md). A Mongolian
// letter inside a mixed label is replaced, before glyph collection and
// shaping, by a private-use code point that names its contextual form —
// isolate, initial, medial or final, plus its free-variation-selector
// variant — so the glyph ranges the worker requests carry exactly the
// forms the word needs. glyph-fallback.mjs decodes those code points and
// generates each form's glyph from the packaged Atlas Mongolian font by
// drawing the letter in joining context (a zero-width joiner on the
// joined sides), then rotates the bitmap 90 degrees clockwise: vertical
// Mongolian is the horizontal script rotated 90 degrees clockwise, which
// the atlasMongolianVerticalize pass below completes by stacking each
// run's glyphs downward from the run's place in the line.
//
// atlasMongolianShapeText and atlasMongolianVerticalize are deliberately
// self-contained (no imports, no module-scope references): the MapLibre
// backport embeds their source verbatim into the patched distribution,
// so the code the worker runs is the code the tests exercise here. They
// are defined in map-controls.mjs — the module that owns the backport,
// whose cached bytes must stay executable standalone, with no imports of
// its own — and re-exported here, next to the allocation they share with
// the glyph supply.
import {atlasMongolianShapeText, atlasMongolianVerticalize} from './map-controls.mjs';
export {atlasMongolianShapeText, atlasMongolianVerticalize};

// The private-use allocation the two passes above share with the glyph
// supply (glyph-fallback.mjs). Plane 15 (U+F0000…) because the BMP
// private-use area belongs to the shaping layer's image sections.
// Letters without a selector: 0xF0000 + index*4 + form. Letters with a
// selector variant: 0xF0300 + (index*4 + form)*4 + (fvs − 1).
export const MONGOLIAN_FORM_FIRST = 0xF0000, MONGOLIAN_FORM_LAST = 0xF0DB0;
export const MONGOLIAN_FVS_CODEPOINTS = [0, 0x180B, 0x180C, 0x180D, 0x180F];
export function mongolianLetterIndex(code) {
  if (code >= 0x1820 && code <= 0x18AA) return code - 0x1820;
  if (code >= 0x11660 && code <= 0x1167F) return 139 + (code - 0x11660);
  return -1;
}
export function encodeMongolianForm(code, form, fvs = 0) {
  const index = mongolianLetterIndex(code);
  if (index < 0 || !(form >= 0 && form <= 3) || !(fvs >= 0 && fvs <= 4)) return null;
  return fvs === 0 ? 0xF0000 + index * 4 + form : 0xF0300 + (index * 4 + form) * 4 + (fvs - 1);
}
export function isMongolianFormCode(code) {
  return (code >= 0xF0000 && code < 0xF02AC) || (code >= 0xF0300 && code < 0xF0DB0);
}
export function decodeMongolianForm(code) {
  if (!isMongolianFormCode(code)) return null;
  let index, form, fvs;
  if (code < 0xF0300) {
    const rel = code - 0xF0000;
    index = rel >> 2; form = rel & 3; fvs = 0;
  } else {
    const rel = code - 0xF0300;
    index = rel >> 4; form = (rel >> 2) & 3; fvs = (rel & 3) + 1;
  }
  return {base: index <= 138 ? 0x1820 + index : 0x11660 + (index - 139), form, fvs};
}
