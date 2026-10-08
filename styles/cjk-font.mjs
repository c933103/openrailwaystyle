import {RARE_HAN_FAMILY} from './rare-han.mjs?v=20261008-world-copy-recovery';
// Which local font draws Han labels. Names mix scripts (a Simplified name in
// the Traditional view, Hong Kong or Macao characters, Japanese kanji, rare
// extension characters), and a font missing some of them makes the browser
// draw those in another font: one name in mixed styles. Each character set
// is probed with a few of its characters; fonts follow these standards, so a
// font that has the probes has the set.
export const PROBE_SETS = {
  simplified: '顿',            // GB 2312 only
  traditional: '頓',           // Big5
  hongkong: '嘢冧𨋢',          // HKSCS, including Extension B
  macao: '俆㜏',               // Macao Supplementary Character Set
  japanese: '駅峠畑',          // JIS
  compatibility: '豈﨑',
  extensionA: '㐀㙟',
  extensionB: '𠮷𨋢',
};
// A 676-byte font mapping every Han code point to one empty glyph. Placed
// after a candidate, a character the candidate lacks measures zero wide.
export const PROBE_FAMILY = 'Atlas Probe';
export const PROBE_FONT = 'data:font/ttf;base64,AAEAAAAKAIAAAwAgT1MvMkEYP0MAAAEoAAAAYGNtYXAAJMOBAAABkAAAAHBnbHlmAAAAAAAAAggAAAABaGVhZF8WQOAAAACsAAAANmhoZWEDIf86AAAA5AAAACRobXR4AAAAAAAAAYgAAAAGbG9jYQAAAAAAAAIAAAAABm1heHAAAwACAAABCAAAACBuYW1lm5T2gwAAAgwAAABscG9zdG1nc80AAAJ4AAAALAABAAAAAQAATK9BeF8PPPUAAwPoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwACAAAAAAAAAAEAAAMg/zgAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAEAAAACAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAAAAAAwAAAZAABQAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAPz8/PwAAACD//wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAAAAAAAAAAAAMAAAADAAAAHAADAAEAAAAcAAMACgAAADwABAAgAAAABAAEAAEAAAAg//8AAAAg////4QABAAAAAAANAAAAAAA0AAAAAAAAAAMAAC6AAACf/wAAAAEAAPkAAAD6/wAAAAEAAgAAAAP//wAAAAEAAAAAAAAAAAAAAAAAAAAEADYAAQAAAAAAAQALAAAAAQAAAAAAAgAHAAsAAwABBAkAAQAWABIAAwABBAkAAgAOAChBdGxhcyBQcm9iZVJlZ3VsYXIAQQB0AGwAYQBzACAAUAByAG8AYgBlAFIAZQBnAHUAbABhAHIAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAABAgVibGFuaw==';
export const CJK_FONTS = {
  'zh-Hans': '"Noto Sans SC","Noto Sans CJK SC","Source Han Sans SC","PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif',
  'zh-Hant': '"Noto Sans TC","Noto Sans CJK TC","Source Han Sans TC","PingFang TC","Microsoft JhengHei",sans-serif',
  ja: '"Noto Sans JP","Noto Sans CJK JP","Source Han Sans JP","Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","Meiryo",sans-serif',
  ko: '"Noto Sans KR","Noto Sans CJK KR","Source Han Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif',
};
export const familyNames = stack => stack.split(',').map(f => f.trim().replace(/^"|"$/g, '')).filter(f => f && !/^(sans-serif|serif|monospace)$/.test(f));
// The sets a family covers; measure(family, character) returns a width.
export function coveredSets(family, measure) {
  return Object.keys(PROBE_SETS).filter(set => [...PROBE_SETS[set]].every(character => measure(family, character) > 0));
}
// The font to draw with: the first installed candidate covering every set;
// else the best partial one, flagged so the caller may fetch a complete font;
// with no candidate installed at all (e.g. Android, which exposes no font
// names), the system's own fallback.
export function chooseCjkFont(candidates, measure) {
  const all = Object.keys(PROBE_SETS);
  let best = null;
  for (const family of candidates) {
    const covered = coveredSets(family, measure);
    if (covered.length === all.length) return {family, complete: true, covered};
    if (covered.length && (!best || covered.length > best.covered.length)) best = {family, complete: false, covered};
  }
  return best || {family: null, complete: false, covered: []};
}
// Local families added to MapLibre font stacks: the packaged ones, the rare
// Han slices (rare-han.mjs) and every installed candidate. Remote glyph requests leave them out.
const LOCAL_FAMILIES = new Set(['Atlas CJK TC', 'Atlas CJK SC', RARE_HAN_FAMILY, ...Object.values(CJK_FONTS).flatMap(familyNames)]);
export const isLocalFamily = family => LOCAL_FAMILIES.has(String(family).trim());
