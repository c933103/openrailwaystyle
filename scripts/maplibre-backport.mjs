import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// The npm archive contains the original TypeScript and its distribution map.
// Verify that the tiny distribution edit corresponds to the reviewed source,
// rather than accepting a same-looking minified loop from an unknown release.
export async function verifyMapLibreBackportSource(root = 'node_modules/maplibre-gl') {
  await verifyMapLibreGeoJSONSource(root);
  const source = await readFile(`${root}/src/util/dom.ts`);
  assert.equal(createHash('sha256').update(source).digest('hex'),
    '185a0ae3e1f09e40d3cfa2b40fa863be7b814526cea45479e89e38545c932364');
  const mapBytes = await readFile(`${root}/dist/maplibre-gl.js.map`);
  assert.equal(createHash('sha256').update(mapBytes).digest('hex'),
    'a09ebdfe7d8a259b7c67a470caa2d4e57d31262bc99020ec41983d3325fa9901');
  const map = JSON.parse(mapBytes), index = map.sources.indexOf('../src/util/dom.ts');
  assert.ok(index >= 0);
  assert.equal(map.sourcesContent[index], source.toString('utf8'));
  const original = 'for (const {name, value} of elem.attributes) {';
  assert.equal(source.toString('utf8').split(original).length, 2);
  // Exact source change from upstream's public fix commit 1da69f3cd913a39fa948708e01478663bf48bc27.
  return source.toString('utf8').replace(original,
    'for (const {name, value} of Array.from(elem.attributes)) {');
}

// Atlas-local repair, not an upstream release: a second interrupted reload
// consumes no ParsingState, so preserve each worker tile's raw bytes until a
// parse actually returns. Weak keys cannot retain removed worker tiles.
export async function verifyMapLibreGeoJSONSource(root = 'node_modules/maplibre-gl') {
  const source = await readFile(`${root}/src/source/geojson_worker_source.ts`, 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'),
    'ede54a37fe4e9a5ba5a80941127ed5942d0d9d77ad921af3138c46d488b3cb14');
  const mapBytes = await readFile(`${root}/dist/maplibre-gl.js.map`);
  assert.equal(createHash('sha256').update(mapBytes).digest('hex'),
    'a09ebdfe7d8a259b7c67a470caa2d4e57d31262bc99020ec41983d3325fa9901');
  const map = JSON.parse(mapBytes), index = map.sources.indexOf('../src/source/geojson_worker_source.ts');
  assert.ok(index >= 0);
  assert.equal(map.sourcesContent[index], source);
  const edits = [
    ['    tileState: WorkerTileState;', '    tileState: WorkerTileState;\n    _atlasPendingRaw?: WeakMap<WorkerTile, ParsingState>;'],
    ['    async _parseWorkerTile(workerTile: WorkerTile, params: WorkerTileParameters, parseState?: ParsingState): Promise<WorkerTileResult> {',
      '    async _parseWorkerTile(workerTile: WorkerTile, params: WorkerTileParameters, parseState?: ParsingState): Promise<WorkerTileResult> {\n        this._atlasPendingRaw ||= new WeakMap();\n        if (parseState) this._atlasPendingRaw.set(workerTile, parseState);\n        const pendingRaw = this._atlasPendingRaw.get(workerTile);'],
    ['        if (parseState) {\n            const {rawData} = parseState;', '        if (pendingRaw) {\n            const {rawData} = pendingRaw;'],
    ["            result = extend({rawTileData: rawData.slice(0), encoding: 'mvt'}, result);", "            result = extend({rawTileData: rawData.slice(0), encoding: 'mvt'}, result);\n            this._atlasPendingRaw.delete(workerTile);"],
  ];
  let patched = source;
  for (const [before, after] of edits) {
    assert.equal(patched.split(before).length, 2);
    patched = patched.replace(before, after);
  }
  return patched;
}
