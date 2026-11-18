// Traditional Mongolian script in DOM text. The script is written
// vertically — top to bottom, columns progressing left to right — so a
// Mongolian name printed inline in a horizontal panel comes out wrong:
// engines either rotate the glyphs (Firefox) or draw them horizontally
// in unjoined isolated forms (Blink). A run wrapped in a span with
// `writing-mode: vertical-lr` (app.css, .atlas-mongolian) renders
// properly joined and vertical in both. `text-orientation: upright`
// must NOT be added: it collapses the glyphs into one blob in Blink.
//
// A Mongolian character here is Unicode Script=Mongolian — the
// U+1800–U+18AF block (letters, digits, punctuation) and the Mongolian
// Supplement (U+11660–U+1167F) — unioned explicitly with the free
// variation selectors U+180B–U+180D and U+180F and the vowel separator
// U+180E, whose Script value has differed between Unicode data
// versions; a variation selector separated from its base letter would
// break the run (and the letter's chosen form) at exactly that point.
// U+202F (narrow no-break space) is Script=Common but is Mongolian's
// suffix separator, so it counts as part of a run when Mongolian
// characters stand on both sides of it.
const MONGOLIAN_CHARACTER = /[\p{Script=Mongolian}\u180B-\u180F]/u;
const NNBSP = '\u202F';
export const isMongolianCharacter = character => MONGOLIAN_CHARACTER.test(character);
export const hasMongolian = text => typeof text === 'string' && [...text].some(isMongolianCharacter);

// The text as alternating segments, in order: {text, mongolian}.
// Adjacent characters of the same kind merge, so a string without
// Mongolian is one segment with mongolian:false.
export function mongolianSegments(text) {
  const segments = [];
  let current;
  const characters = [...String(text)];
  for (let i = 0; i < characters.length; i++) {
    const character = characters[i];
    let mongolian = isMongolianCharacter(character);
    if (!mongolian && character === NNBSP)
      mongolian = Boolean(current?.mongolian && characters[i + 1] && isMongolianCharacter(characters[i + 1]));
    if (current && current.mongolian === mongolian) current.text += character;
    else segments.push(current = {text: character, mongolian});
  }
  return segments;
}

// The 256-code-point blocks (code point >> 8) the text's Mongolian
// characters live in — 0x18 for the main block, 0x116 for the
// supplement — for requesting packaged font slices (world-font.mjs).
export function mongolianBlocks(text) {
  const blocks = new Set();
  for (const character of String(text)) if (isMongolianCharacter(character)) blocks.add(character.codePointAt(0) >> 8);
  return blocks;
}

// World-font slice requests (family/weight/block, as createWorldFonts
// takes) for the packaged Atlas Mongolian design in both weights the
// labels use; a weight the published index does not list is skipped
// by the loader, so requesting 700 is safe where only 400 is cut.
export function mongolianFontRequests(text) {
  const requests = new Set();
  for (const block of mongolianBlocks(text)) for (const weight of [400, 700]) requests.add({family: 'mongolian', weight, block});
  return requests;
}

// DOM content for a display name: Mongolian runs become
// <span class="atlas-mongolian" lang="mn-Mong">, everything else stays
// a text node. Built only from createTextNode/textContent, so a name
// containing markup metacharacters stays inert text.
export function nameFragment(document, text) {
  const fragment = document.createDocumentFragment();
  for (const segment of mongolianSegments(text)) {
    if (!segment.mongolian) { fragment.append(document.createTextNode(segment.text)); continue; }
    const span = document.createElement('span');
    span.className = 'atlas-mongolian';
    span.lang = 'mn-Mong';
    span.textContent = segment.text;
    fragment.append(span);
  }
  return fragment;
}
