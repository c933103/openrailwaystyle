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

// The same query and row code before the row code moved: its table and its
// staged rebuild rows stay usable (no extra worldwide download), while any
// other version or parser fingerprint still does not.
test('a table and a rebuild checkpoint of the code before the move stay current', async t => {
  const {currentCrossingExtraction, EARLIER_CROSSING_EXTRACTIONS} = await import('../scripts/crossing-data.mjs');
  assert.equal(currentCrossingExtraction(crossingExtraction()), true);
  assert.equal(currentCrossingExtraction(EARLIER_CROSSING_EXTRACTIONS[0]), true);
  assert.equal(currentCrossingExtraction('a'.repeat(64)), false);
  assert.equal(currentCrossingExtraction(undefined), false);
  const {mkdtemp, readFile, writeFile, rm} = await import('node:fs/promises');
  const {tmpdir} = await import('node:os'), {join} = await import('node:path');
  const checkpoints = await import('../scripts/crossing-checkpoint.mjs'), crossings = await import('../scripts/crossing-data.mjs');
  const dir = await mkdtemp(join(tmpdir(), 'crossing-version-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const options = {directory: dir, source: 'https://overpass.fixture.invalid/api/interpreter', parentSnapshot: 'a'.repeat(40), tableVersion: 3};
  const box = crossings.startRegions()[0].box, seen = () => { const at = new Date().toISOString(); return {requestStartedAt: at, observedAt: at}; };
  const first = await checkpoints.openCrossingCheckpoint(options);
  // Saved as the code before the move saved it: its parser fingerprint,
  // with a leaf staged under it.
  const restamp = async parser => {
    const envelope = JSON.parse(await readFile(join(dir, 'state.json')));
    envelope.state.identity.parser = parser;
    envelope.sha256 = checkpoints.sha256(JSON.stringify(envelope.state));
    await writeFile(join(dir, 'state.json'), JSON.stringify(envelope));
  };
  await restamp('701ba0e031de9088a5987caa3da824b9ce0d2a1c2c4bbd6e99f92ed93d4982d7');
  await (await checkpoints.openCrossingCheckpoint({...options, warn: message => assert.fail(message)})).leaf(box, [], seen());
  const resumed = await checkpoints.openCrossingCheckpoint({...options, warn: message => assert.fail(message)});
  assert.equal(resumed.epoch, first.epoch, 'the epoch goes on');
  // A leaf staged now is read back under the epoch's own identity.
  const second = crossings.startRegions()[1].box;
  await resumed.leaf(second, [], seen());
  const again = await checkpoints.openCrossingCheckpoint({...options, warn: message => assert.fail(message)});
  assert.deepEqual(await again.get(second), {kind: 'leaf', rows: []});
  assert.deepEqual(await again.get(box), {kind: 'leaf', rows: []});
  // Any other parser fingerprint is still another parser.
  await restamp('b'.repeat(64));
  const warnings = [];
  const other = await checkpoints.openCrossingCheckpoint({...options, warn: message => warnings.push(message)});
  assert.notEqual(other.epoch, first.epoch);
  assert.match(warnings[0], /Discarding unusable full-rebuild checkpoint/);
});
