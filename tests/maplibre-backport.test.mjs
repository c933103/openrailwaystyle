import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {MAPLIBRE_BACKPORT,backportMapLibre524} from '../styles/map-controls.mjs';
import {verifyMapLibreBackportSource} from '../scripts/maplibre-backport.mjs';

const root = new URL('../node_modules/maplibre-gl/', import.meta.url);
const original = await readFile(new URL('dist/maplibre-gl.js', root));
const patched = await backportMapLibre524(original, webcrypto.subtle);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fixtures = [
  ['<span onclick="void 0" onfocus="void 0" onblur="void 0" title="Safe">Credit</span>', '<span title="Safe">Credit</span>'],
  ['<a href="javascript:void 0" onclick="void 0">Credit</a>', '<a>Credit</a>'],
  ['<span><a onclick="void 0" onfocus="void 0" href="https://example.org/">© Data</a></span>', '<span><a href="https://example.org/">© Data</a></span>'],
  ['<a href="https://example.org/" target="_blank" rel="noopener">© Data</a>', '<a href="https://example.org/" target="_blank" rel="noopener">© Data</a>'],
];

// No WebGL, provider or active payload. Event-handler bodies are inert and
// JSDOM never executes markup scripts (outside-only). Inspect DOM attributes.
function distributionSanitizer(bytes) {
  const dom = new JSDOM('', {runScripts:'outside-only'});
  dom.window.URL.createObjectURL=()=>'blob:unused-worker';
  dom.window.TextDecoder=TextDecoder; dom.window.TextEncoder=TextEncoder;
  dom.window.eval(Buffer.from(bytes).toString('utf8'));
  const sanitize = input => {
    const control = new dom.window.maplibregl.AttributionControl({customAttribution:input});
    control._map={style:{tileManagers:{}}};
    control._container=dom.window.document.createElement('div');
    control._innerContainer=dom.window.document.createElement('div');
    control._updateCompact=()=>{};
    control._updateAttributions();
    return control._innerContainer.innerHTML;
  };
  return {sanitize,close:()=>dom.window.close()};
}

test('MapLibre backport changes only the attribution loop and GeoJSON parse method, with no stale source map',async()=>{
  assert.equal(digest(original), MAPLIBRE_BACKPORT.upstreamSha256);
  assert.equal(digest(patched), MAPLIBRE_BACKPORT.sha256);
  let expected=original.toString('utf8').replace(
    'of e.attributes)d.isPossiblyDangerous', 'of Array.from(e.attributes))d.isPossiblyDangerous'
  ).replace('//# sourceMappingURL=maplibre-gl.js.map\n','');
  const workerMethod=text=>{
    const matches=[...text.matchAll(/_parseWorkerTile\(t,i,s\)\{return e\._\(this,void 0,void 0,\(function\*\(\)\{[\s\S]*?return r\}\)\)\}/g)].filter(match=>match[0].includes('encoding:"mvt"'));
    assert.equal(matches.length,1);return matches[0][0];
  };
  const fixedMethod=workerMethod(Buffer.from(patched).toString('utf8'));
  assert.notEqual(workerMethod(expected),fixedMethod);
  expected=expected.replace(workerMethod(expected),fixedMethod);
  assert.equal(Buffer.from(patched).toString('utf8'),expected);
  assert.match(expected,/MapLibre/);
  assert.ok(!expected.includes('sourceMappingURL='));
  const source=await verifyMapLibreBackportSource(new URL(root).pathname);
  const compiled=await build({stdin:{contents:source,loader:'ts',resolveDir:new URL('src/util/',root).pathname},
    bundle:true,write:false,format:'iife',globalName:'sourceDOM',platform:'browser'});
  const dom=new JSDOM('',{runScripts:'outside-only'});
  try {
    dom.window.eval(compiled.outputFiles[0].text);
    for(const [input,expected] of fixtures)assert.equal(dom.window.sourceDOM.DOM.sanitize(input),expected);
  } finally {dom.window.close();}
});

test('the exact prior atlas.1 cache is upgraded to the same current distribution',async()=>{
  const previous=Buffer.from(original.toString('utf8').replace('of e.attributes)d.isPossiblyDangerous',
    'of Array.from(e.attributes))d.isPossiblyDangerous').replace('//# sourceMappingURL=maplibre-gl.js.map\n',''));
  assert.equal(digest(previous),MAPLIBRE_BACKPORT.previousSha256);
  assert.deepEqual(Buffer.from(await backportMapLibre524(previous,webcrypto.subtle)),Buffer.from(patched));
  await assert.rejects(backportMapLibre524(Buffer.concat([previous,Buffer.from(' ')]),webcrypto.subtle),/Unexpected MapLibre input/);
});

test('the actual patched distribution removes every unsafe attribute and preserves credits',()=>{
  const fixed=distributionSanitizer(patched),baseline=distributionSanitizer(original);
  try {
    assert.match(baseline.sanitize(fixtures[0][0]),/onfocus=/,'sensitivity control detects the unfixed removal skip');
    for(const [input,expected] of fixtures)assert.equal(fixed.sanitize(input),expected);
  } finally {fixed.close();baseline.close();}
});

test('backport refuses altered, repeated, truncated, already patched or unverifiable input',async()=>{
  for(const bytes of [Buffer.concat([original,Buffer.from(' ')]),original.subarray(0,100),
    Buffer.concat([original,original]),patched])await assert.rejects(backportMapLibre524(bytes,webcrypto.subtle),/Unexpected MapLibre input/);
  await assert.rejects(backportMapLibre524(original,undefined),/integrity verification/);
  // Simulate a broken/changed transformation while preserving the input pin.
  let count=0;
  const badDigest={digest:async(...args)=>++count===1?webcrypto.subtle.digest(...args):new Uint8Array(32).buffer};
  await assert.rejects(backportMapLibre524(original,badDigest),/Unexpected MapLibre output/);
});
