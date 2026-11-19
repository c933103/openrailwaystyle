// Verify the exact browser bundle against bounded Node gzip on every staged tile.
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {validateReferenceManifest,validateReferenceIndex} from '../styles/mainline-reference.mjs';
const root=resolve(process.argv[2]);
const {decodeReferenceForDiagnostic}=await import(pathToFileURL(resolve(process.argv[3])));
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=validateReferenceManifest(JSON.parse(await readFile(join(root,'manifest.json'))));
const dir=join(root,'generations',manifest.generation),index=await readFile(join(dir,'index.json'));
assert.equal(hash(index),manifest.indexSha256);
const entries=validateReferenceIndex(JSON.parse(index),manifest);
const maxOutputLength=8*1024**2;
for(const [key,{bytes,sha256}] of entries){
 const path=join(dir,key+'.pbf.gz');
 assert.equal((await stat(path)).size,bytes,key);
 const gzip=await readFile(path);
 assert.equal(hash(gzip),sha256,key);
 const native=gunzipSync(gzip,{maxOutputLength});
 const alternative=decodeReferenceForDiagnostic(new Uint8Array(gzip).buffer,maxOutputLength);
 assert.ok(native.equals(alternative),'Decoded payload differs for '+key);
}
console.log('REFERENCE_DECODER_PARITY',JSON.stringify({generation:manifest.generation,tiles:entries.size}));
