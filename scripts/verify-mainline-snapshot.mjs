import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {validateReferenceManifest,validateReferenceIndex} from '../styles/mainline-reference.mjs';
import {validateMainlineSources,sha256,MAINLINE_CONTROLS} from './mainline-coverage.mjs';
import {MAINLINE_LAYER} from './mainline-overview.mjs';
const root=process.argv[2];if(!root)throw Error('Expected reference snapshot directory');
const manifest=validateReferenceManifest(JSON.parse(await readFile(join(root,'manifest.json'))));
validateMainlineSources(manifest.sources);
const dir=join(root,'generations',manifest.generation),indexBytes=await readFile(join(dir,'index.json'));
if(sha256(indexBytes)!==manifest.indexSha256)throw Error('Reference index does not match generation');
const entries=validateReferenceIndex(JSON.parse(indexBytes),manifest),retained=new Map();let total=0;
for(const [key,record] of entries){
 const path=join(dir,key+'.pbf.gz');if((await stat(path)).size!==record.bytes)throw Error('Reference tile byte count mismatch');
 const zipped=await readFile(path);if(sha256(zipped)!==record.sha256)throw Error('Reference tile digest mismatch');
 const bytes=gunzipSync(zipped,{maxOutputLength:8*1024**2}),layer=new VectorTile(new Pbf(bytes)).layers[MAINLINE_LAYER];
 if(!layer?.length)throw Error(`Missing actual reference geometry in indexed tile ${key}`);
 const z=key.split('/')[0];if(!retained.has(z))retained.set(z,new Set());
 for(let i=0;i<layer.length;i++)retained.get(z).add(layer.feature(i).properties.id);
 total+=zipped.length;
}
if(total!==manifest.tileBytes||total>256*1024**2)throw Error('Reference tile-set byte budget mismatch');
const controls=JSON.parse(await readFile(join(dir,'coverage-audit.json')));
if(controls.length!==MAINLINE_CONTROLS.length)throw Error('Missing worldwide acceptance controls');
for(const required of MAINLINE_CONTROLS){
 const c=controls.find(c=>c.name===required.name);
 if(!c||c.feature.properties.osm_version<1||!/^way-[1-9]\d*$/.test(c.feature.properties.id))throw Error('Missing real OSM control identity');
 for(let z=0;z<=6;z++)if(!c.chainIdsByZoom?.[z]?.some(id=>retained.get(String(z))?.has(id)))
  throw Error(`Source/rendering omission: ${required.name} z${z}`);
}
if(process.argv.includes('--require-browser-acceptance')&&!manifest.rendererAcceptance?.complete)
 throw Error('Actual OSM renderer acceptance is required for publication');
if(manifest.rendererAcceptance){
 const a=manifest.rendererAcceptance;
 if(a.complete!==true||!/^[a-f0-9]{64}$/.test(a.sha256)||a.path!==`generations/${manifest.generation}/renderer-acceptance-${a.sha256}.json`||a.samples!==840||a.appSamples!==18||
  sha256(await readFile(join(root,a.path)))!==a.sha256)throw Error('Changed or incomplete retained renderer acceptance');
}
console.log('PASS: complete versioned world reference',JSON.stringify({generation:manifest.generation,ways:manifest.wayCount,
 tiles:entries.size,tileBytes:total,downloadedBytes:manifest.downloadedBytes,buildSeconds:manifest.buildSeconds,peakRssBytes:manifest.peakRssBytes}));
