import test from 'node:test';
import assert from 'node:assert/strict';
import {PROBE_SETS, PROBE_FONT, familyNames, coveredSets, chooseCjkFont} from '../styles/cjk-font.mjs';

const fonts = {
  // Big5 without Simplified forms or Extension B, as Microsoft JhengHei.
  partial: '頓嘢冧俆㜏駅峠畑豈﨑㐀㙟',
  complete: Object.values(PROBE_SETS).join(''),
};
const measure = (family, character) => fonts[family]?.includes(character) ? 1 : 0;

test('Han font choice: the first complete candidate, else the best partial one, else the system fallback', () => {
  assert.deepEqual(familyNames('"Noto Sans TC","Microsoft JhengHei",sans-serif'), ['Noto Sans TC', 'Microsoft JhengHei']);
  assert.deepEqual(coveredSets('partial', measure), ['traditional', 'macao', 'japanese', 'compatibility', 'extensionA']);
  assert.deepEqual(chooseCjkFont(['missing', 'partial', 'complete'], measure), {family: 'complete', complete: true, covered: Object.keys(PROBE_SETS)});
  assert.equal(chooseCjkFont(['missing', 'partial'], measure).family, 'partial');
  assert.equal(chooseCjkFont(['missing', 'partial'], measure).complete, false);
  assert.deepEqual(chooseCjkFont(['missing'], measure), {family: null, complete: false, covered: []}, 'no installed candidate: the system resolves it');
});

test('probe sets cover Simplified, Traditional, Hong Kong, Macao, Japanese, compatibility and both extensions', () => {
  assert.deepEqual(Object.keys(PROBE_SETS), ['simplified', 'traditional', 'hongkong', 'macao', 'japanese', 'compatibility', 'extensionA', 'extensionB']);
  const blocks = Object.values(PROBE_SETS).join('');
  assert.ok([...blocks].some(c => c.codePointAt(0) >= 0x20000 && c.codePointAt(0) <= 0x2A6DF), 'Extension B');
  assert.ok([...blocks].some(c => c.codePointAt(0) >= 0x3400 && c.codePointAt(0) <= 0x4DBF), 'Extension A');
  assert.ok([...blocks].some(c => c.codePointAt(0) >= 0xF900 && c.codePointAt(0) <= 0xFAFF), 'compatibility ideographs');
  const bytes = Buffer.from(PROBE_FONT.split(',')[1], 'base64');
  assert.ok(bytes.length < 1024, 'the probe font stays tiny');
  assert.equal(bytes.readUInt32BE(0), 0x00010000, 'a TrueType font, which browsers accept with a many-to-one cmap');
});
