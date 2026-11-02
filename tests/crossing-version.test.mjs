import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {crossingExtraction, regionQuery, parseCsv, TAG_KEYS} from '../scripts/crossing-data.mjs';
import {parseRows} from '../scripts/crossing-rows.mjs';
import {extractionVersion} from '../scripts/overpass-adiff.mjs';

// The stored table is downloaded again only when what makes it changes: the
// query (selection, columns, minor logic) or the parsing into the table.
// Tile code, tag labels and regions rebuild the tiles from the stored table.
const rows = new URL('../scripts/crossing-rows.mjs', import.meta.url);
test('the crossing table version is the query and crossing-rows.mjs alone', () => {
  assert.equal(crossingExtraction(), extractionVersion(regionQuery([-90, -180, 90, 180]), rows));
  assert.doesNotMatch(readFileSync(rows, 'utf8'), /^\s*import\b|\bfrom\s+'/m, 'no import pulls other code into the version');
  // Another tag column is another query, so another version.
  assert.ok(regionQuery([-90, -180, 90, 180]).includes(`"${TAG_KEYS[0]}"`));
  assert.notEqual(crossingExtraction(), extractionVersion(regionQuery([-90, -180, 90, 180]).replace(`"${TAG_KEYS[0]}"`, '"other"'), rows));
});

test('parseCsv reads the query columns with crossing-rows.mjs', () => {
  const SEP = '\u001f', text = [`1${SEP}1${SEP}2${SEP}level_crossing${SEP}${'x'}`, `${SEP}${SEP}${SEP}minor`, `${SEP}${SEP}${SEP}end`].join('\n');
  assert.deepEqual(parseCsv(text), parseRows(text, TAG_KEYS));
  assert.deepEqual(parseCsv(text)[0].tags, {[TAG_KEYS[0]]: 'x'});
});
