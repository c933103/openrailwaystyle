import assert from 'node:assert/strict';
import {test} from 'node:test';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {decompressReference} from '../styles/mainline-reference.mjs';

function sample(size){
 const bytes=Buffer.alloc(size);
 for(let offset=0;offset<size;offset+=32)
  createHash('sha256').update(String(offset)).digest().copy(bytes,offset);
 return bytes;
}

test('reference gzip decoding preserves bytes over multiple input chunks and honors view bounds',async()=>{
 for(const size of [1,65535,65536,65537,851000]){
  const original=sample(size),compressed=gzipSync(original);
  const combined=Buffer.concat([Buffer.alloc(19),compressed,Buffer.alloc(11)]);
  const window=new DataView(combined.buffer,combined.byteOffset+19,compressed.byteLength);
  assert.deepEqual(Buffer.from(await decompressReference(window,size)),original);
 }
});

test('reference gzip decoding rejects oversize output and invalid or truncated members',async()=>{
 const original=sample(200123),gz=gzipSync(original);
 await assert.rejects(decompressReference(gz,original.length-1),/Oversized decoded OSM reference tile/);
 await assert.rejects(decompressReference(gz.subarray(0,-3),original.length));
 const badCRC=Buffer.from(gz);
 badCRC[badCRC.length-8]^=0xff;
 await assert.rejects(decompressReference(badCRC,original.length));
});
