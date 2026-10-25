import test from 'node:test';
import assert from 'node:assert/strict';
import Pbf from 'pbf';
import {createRequestPool} from '../styles/request-pool.mjs';
import {RAIL_COMPOSITE_PATHS} from '../styles/rail-source-catalog.mjs';
import {validProviderVectorTile} from '../styles/vector-tile-validation.mjs';

// Tile field 3 holds layers; layer fields: 1 name, 5 extent, 15 version.
function emptyLayers(names, version = 2) {
  const pbf = new Pbf();
  for (const name of names) pbf.writeMessage(3, (layer, out) => {
    out.writeVarintField(15, version);
    out.writeStringField(1, layer);
    out.writeVarintField(5, 4096);
  }, name);
  return pbf.finish();
}

test('the 26-byte named empty railway_line_high tile from #254 is a valid empty tile', () => {
  const body = Buffer.from('1a1878020a117261696c7761795f6c696e655f68696768288020', 'hex');
  assert.equal(body.length, 26);
  assert.equal(validProviderVectorTile('https://openrailwaymap.app/railway_line_high/7/1/1', 200, body), true);
});

test('named empty layers are valid in MVT versions 1 and 2 and inside composite endpoints', () => {
  for (const version of [1, 2]) {
    assert.equal(validProviderVectorTile('https://openrailwaymap.app/railway_signals/19/1/2', 200,
      emptyLayers(['railway_signals'], version)), true);
  }
  const group = RAIL_COMPOSITE_PATHS.standard_railway_platforms;
  assert.equal(validProviderVectorTile(`https://openrailwaymap.app/${group}/17/1/2`, 200,
    emptyLayers(['standard_railway_platform_edges'])), true);
});

test('empty layers with unrelated names and malformed bodies are still rejected', () => {
  const url = 'https://openrailwaymap.app/railway_line_high/7/1/1';
  assert.equal(validProviderVectorTile(url, 200, emptyLayers(['unrelated_source'])), false);
  assert.equal(validProviderVectorTile(url, 200, new TextEncoder().encode('<html>error</html>')), false);
  assert.equal(validProviderVectorTile(url, 200, emptyLayers(['railway_line_high']).slice(0, 10)), false);
});

test('a named empty tile is fetched once and cached instead of retried as a provider error', async () => {
  const url = 'https://openrailwaymap.app/railway_line_high/7/1/1';
  const body = emptyLayers(['railway_line_high']);
  let calls = 0;
  const pool = createRequestPool({retries: [1, 1], fetcher: async () => {
    calls++;
    return {ok: true, status: 200, arrayBuffer: async () => body.slice().buffer};
  }});
  try {
    const validate = data => validProviderVectorTile(url, 200, data);
    assert.equal((await pool.get(url, undefined, {validate})).byteLength, body.length);
    assert.equal((await pool.get(url, undefined, {validate})).byteLength, body.length);
    assert.equal(calls, 1);
  } finally { pool.dispose(); }
});
