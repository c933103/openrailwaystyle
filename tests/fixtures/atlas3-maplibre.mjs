// The exact atlas.3 distribution bytes, synthesized from the upstream
// distribution: upstream + the attribution and GeoJSON worker repairs +
// the atlas.3 Mongolian span and hooks (the verticalize below is the
// atlas.3 source verbatim — one unbounded column, and the shaping hook
// called without the line height). The backport test pins the result to
// MAPLIBRE_BACKPORT.previousSha256, so any drift here fails loudly.
import {MAPLIBRE_MONGOLIAN_EDITS, MAPLIBRE_MONGOLIAN_SOURCE, atlasMongolianShapeText} from '../../styles/map-controls.mjs';

const ATLAS3_VERTICALIZE = `function atlasMongolianVerticalize(shaping, writingMode, maxWidth) {
  if (writingMode === 2 || !isFinite(maxWidth)) return;
  const isForm = code => (code >= 0xF0000 && code < 0xF02AC) || (code >= 0xF0300 && code < 0xF0DB0);
  const isGlue = code => code === 0x20 || code === 0x180E || code === 0x202F || code === 0x200D || code === 0x180A;
  for (const line of shaping.positionedLines) {
    const glyphs = line.positionedGlyphs;
    let i = 0;
    while (i < glyphs.length) {
      if (!isForm(glyphs[i].glyph) && !isGlue(glyphs[i].glyph)) { i++; continue; }
      let end = i, first = -1, last = -1;
      while (end < glyphs.length && (isForm(glyphs[end].glyph) || isGlue(glyphs[end].glyph))) {
        if (isForm(glyphs[end].glyph)) { if (first < 0) first = end; last = end; }
        end++;
      }
      if (first >= 0) {
        const x = glyphs[first].x;
        let y = glyphs[first].y;
        for (let k = first; k <= last; k++) {
          const glyph = glyphs[k];
          glyph.x = x;
          const step = glyph.metrics.advance * glyph.scale;
          glyph.y = y;
          y += step;
        }
        if (y > shaping.bottom) shaping.bottom = y;
      }
      i = end;
    }
  }
}`;

export const atlas3MongolianSource = `/*atlas-mongolian-start*/${atlasMongolianShapeText.toString()}\n${ATLAS3_VERTICALIZE}/*atlas-mongolian-end*/`;

export function buildAtlas3Text(originalText, patchedText) {
  const workerMethod = text => {
    const matches = [...text.matchAll(/_parseWorkerTile\(t,i,s\)\{return e\._\(this,void 0,void 0,\(function\*\(\)\{[\s\S]*?return r\}\)\)\}/g)].filter(match => match[0].includes('encoding:"mvt"'));
    if (matches.length !== 1) throw new Error('worker method not unique');
    return matches[0][0];
  };
  let text = originalText.replace('of e.attributes)d.isPossiblyDangerous',
    'of Array.from(e.attributes))d.isPossiblyDangerous');
  text = text.replace(workerMethod(text), workerMethod(patchedText));
  for (const [editOriginal, editReplacement] of MAPLIBRE_MONGOLIAN_EDITS)
    text = text.replace(editOriginal, editReplacement
      .replace(MAPLIBRE_MONGOLIAN_SOURCE, atlas3MongolianSource)
      .replace('atlasMongolianVerticalize(_,p,o,a)', 'atlasMongolianVerticalize(_,p,o)'));
  return text.replace('//# sourceMappingURL=maplibre-gl.js.map\n', '');
}
