import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {hasMongolian, isMongolianCharacter, mongolianBlocks, mongolianFontRequests, mongolianSegments, nameFragment} from '../styles/mongolian-text.mjs';
import {worldFontKey} from '../styles/world-font.mjs';

const MONGOLIAN_NAME = 'ᠤᠯᠠᠭᠠᠨᠪᠠᠭᠠᠲᠤᠷ';
const MIXED_NAME = `Улаанбаатар ${MONGOLIAN_NAME}`;

test('a mixed Cyrillic and Mongolian name splits at the script boundary', () => {
  assert.deepEqual(mongolianSegments(MIXED_NAME), [
    {text: 'Улаанбаатар ', mongolian: false},
    {text: MONGOLIAN_NAME, mongolian: true},
  ]);
  assert.equal(hasMongolian(MIXED_NAME), true);
});

test('a pure Mongolian name is a single Mongolian segment', () => {
  assert.deepEqual(mongolianSegments(MONGOLIAN_NAME), [{text: MONGOLIAN_NAME, mongolian: true}]);
});

test('a name without Mongolian stays one unchanged segment', () => {
  assert.deepEqual(mongolianSegments('Taipei Main Station'), [{text: 'Taipei Main Station', mongolian: false}]);
  assert.deepEqual(mongolianSegments(''), []);
  assert.equal(hasMongolian('Улаанбаатар'), false);
  assert.equal(hasMongolian(''), false);
  assert.equal(hasMongolian(undefined), false);
});

test('free variation selectors and the vowel separator stay inside the run', () => {
  // U+180B FVS1 after a letter, U+180E between letters, U+180F FVS4.
  const text = 'ᠠ\u180Bᠠ\u180Eᠠ\u180F';
  assert.deepEqual(mongolianSegments(text), [{text, mongolian: true}]);
  for (const mark of ['\u180B', '\u180C', '\u180D', '\u180E', '\u180F']) assert.equal(isMongolianCharacter(mark), true, `U+${mark.codePointAt(0).toString(16)}`);
});

test('a narrow no-break space joins a run only between Mongolian characters', () => {
  const joined = 'ᠠ\u202Fᠨ';
  assert.deepEqual(mongolianSegments(joined), [{text: joined, mongolian: true}]);
  assert.deepEqual(mongolianSegments('a\u202Fᠠ'), [
    {text: 'a\u202F', mongolian: false},
    {text: 'ᠠ', mongolian: true},
  ]);
  assert.deepEqual(mongolianSegments('ᠠ\u202F '), [
    {text: 'ᠠ', mongolian: true},
    {text: '\u202F ', mongolian: false},
  ]);
});

test('Mongolian supplement characters are Mongolian too', () => {
  assert.equal(isMongolianCharacter('\u{11660}'), true);
  assert.deepEqual(mongolianBlocks('\u{11660}'), new Set([0x116]));
});

test('blocks and font requests name the packaged Mongolian slices', () => {
  assert.deepEqual(mongolianBlocks(MIXED_NAME), new Set([0x18]));
  assert.deepEqual(mongolianBlocks('Taipei'), new Set());
  const keys = new Set([...mongolianFontRequests(MIXED_NAME)].map(worldFontKey));
  assert.deepEqual(keys, new Set(['mongolian:400:24', 'mongolian:700:24']));
  assert.equal(mongolianFontRequests('Taipei').size, 0);
});

test('name fragments wrap Mongolian runs and keep other text as text nodes', () => {
  const dom = new JSDOM('');
  try {
    const fragment = nameFragment(dom.window.document, MIXED_NAME);
    assert.equal(fragment.childNodes.length, 2);
    assert.equal(fragment.childNodes[0].nodeType, 3);
    assert.equal(fragment.childNodes[0].data, 'Улаанбаатар ');
    const span = fragment.childNodes[1];
    assert.equal(span.tagName, 'SPAN');
    assert.equal(span.className, 'atlas-mongolian');
    assert.equal(span.lang, 'mn-Mong');
    assert.equal(span.textContent, MONGOLIAN_NAME);
  } finally { dom.window.close(); }
});

test('name fragments keep markup metacharacters inert', () => {
  const dom = new JSDOM('');
  try {
    const fragment = nameFragment(dom.window.document, `<img src=x onerror=alert(1)> ${MONGOLIAN_NAME}`);
    assert.equal(fragment.querySelector('img'), null);
    assert.equal(fragment.childNodes[0].nodeType, 3);
    assert.match(fragment.childNodes[0].data, /^<img src=x onerror=alert\(1\)> $/);
    assert.equal(fragment.querySelector('.atlas-mongolian').textContent, MONGOLIAN_NAME);
    const plain = nameFragment(dom.window.document, 'A <b>bold</b> name');
    assert.equal(plain.childNodes.length, 1);
    assert.equal(plain.childNodes[0].nodeType, 3);
  } finally { dom.window.close(); }
});

test('the stylesheet stands Mongolian runs vertically without text-orientation', () => {
  const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
  const rule = /\.atlas-mongolian\{([^}]*)\}/.exec(css)?.[1] || '';
  assert.match(rule, /writing-mode:\s*vertical-lr/);
  assert.match(rule, /font-family:\s*"Atlas Mongolian"/);
  assert.doesNotMatch(rule, /text-orientation/);
});
