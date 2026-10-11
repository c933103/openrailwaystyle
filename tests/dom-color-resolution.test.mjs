// Exercise the installed DOM/color dependency, not a reimplementation.
// Synthetic bounded inputs only; no resource loading or script execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';

const require = createRequire(import.meta.url);
const colorEntry = require.resolve('@asamuzakjp/css-color', {paths: [dirname(require.resolve('jsdom'))]});
const {resolve} = await import(pathToFileURL(colorEntry));
const nest = depth => {
  let color = 'red';
  for (let i = 0; i < depth; i++) color = `color-mix(in srgb, ${color}, blue)`;
  return color;
};
function assertSrgb(actual, red, blue) {
  const channels = /^color\(srgb ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)\)$/.exec(actual);
  assert.ok(channels, `expected an opaque resolved sRGB color, got ${actual}`);
  for (const [index, expected] of [[1, red], [2, 0], [3, blue]])
    assert.ok(Math.abs(Number(channels[index]) - expected) < 0.00001,
      `channel ${index}: ${channels[index]} differs from ${expected}`);
}

for (const depth of [1, 2, 3, 6, 12]) {
  test(`installed color resolver and DOM paths handle nesting depth ${depth}`, () => {
    const value = nest(depth), red = 2 ** -depth, blue = 1 - red;
    const dom = new JSDOM(`<style>.sheet { color: ${value} }</style><div id="inline"></div><div class="sheet"></div>`);
    try {
      const inline = dom.window.document.getElementById('inline');
      const sheet = dom.window.document.querySelector('.sheet');
      let previous;
      for (let repetition = 0; repetition < 4; repetition++) {
        const result = resolve(value);
        assertSrgb(result, red, blue);
        if (repetition) assert.equal(result, previous, 'cached resolution remains stable');
        previous = result;
        inline.style.color = value;
        assert.equal(inline.style.color, value, 'valid inline declaration is retained');
        assertSrgb(dom.window.getComputedStyle(inline).color, red, blue);
        assertSrgb(dom.window.getComputedStyle(sheet).color, red, blue);
      }
    } finally { dom.window.close(); }
  });
}

for (const [value, red, blue] of [
  ['color-mix(in srgb, red 25%, blue 75%)', 0.25, 0.75],
  ['color-mix(in srgb, red 25%, color-mix(in srgb, red 20%, blue 80%) 75%)', 0.4, 0.6],
]) test(`installed color resolver preserves percentages: ${value}`, () => {
  const dom = new JSDOM('<div></div>');
  try {
    const element = dom.window.document.querySelector('div');
    for (let repetition = 0; repetition < 4; repetition++) {
      assertSrgb(resolve(value), red, blue);
      element.style.color = value;
      assert.equal(element.style.color, value);
      assertSrgb(dom.window.getComputedStyle(element).color, red, blue);
    }
  } finally { dom.window.close(); }
});

for (const value of [
  'color-mix(in srgb, red, blue',
  'color-mix(in srgb, red, bogus)',
  'color-mix(in srgb, red -10%, blue)',
  'color-mix(in srgb, red 0%, blue 0%)',
]) test(`installed color resolver rejects invalid components without losing existing style: ${value}`, () => {
  const dom = new JSDOM('<div style="color: red"></div>');
  try {
    const element = dom.window.document.querySelector('div');
    for (let repetition = 0; repetition < 4; repetition++) {
      assert.equal(resolve(value), 'rgba(0, 0, 0, 0)', 'the resolver returns its invalid-color fallback');
      element.style.color = value;
      assert.equal(element.style.color, 'red', 'an invalid declaration cannot replace the valid inline value');
      assert.equal(dom.window.getComputedStyle(element).color, 'rgb(255, 0, 0)');
    }
  } finally { dom.window.close(); }
});
