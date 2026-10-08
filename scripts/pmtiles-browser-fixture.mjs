import {gzipSync} from 'node:zlib';

// Deterministic PMTiles v3: one empty MVT at 0/0/0, no tiles elsewhere.
// The root directory uses five one-byte varints: count, tile-id delta,
// run length, compressed tile length, and offset + 1.
const tile = gzipSync(Buffer.alloc(0));
const directory = Buffer.from([1, 0, 1, tile.length, 1]);
const metadata = Buffer.from(JSON.stringify({vector_layers:[]}));
const header = Buffer.alloc(127);
header.write('PMTiles');header[7] = 3;
const metadataOffset = header.length + directory.length, tileOffset = metadataOffset + metadata.length;
for (const [offset, value] of [[8,127],[16,directory.length],[24,metadataOffset],[32,metadata.length],
  [40,tileOffset],[48,0],[56,tileOffset],[64,tile.length],[72,1],[80,1],[88,1]]) header.writeBigUInt64LE(BigInt(value),offset);
header[96]=1;header[97]=1;header[98]=2;header[99]=1; // clustered, uncompressed index, gzip MVT
header[100]=0;header[101]=16;
for(const [offset,value] of [[102,-180],[106,-85],[110,180],[114,85]])header.writeInt32LE(value*1e7,offset);
export const emptyPmtiles = Buffer.concat([header,directory,metadata,tile]);

export function pmtilesFixtureResponse(range) {
  const headers={'accept-ranges':'bytes',etag:'"atlas-empty-pmtiles-v1"','content-type':'application/vnd.pmtiles'};
  if (!range) return {status:200,headers:{...headers,'content-length':String(emptyPmtiles.length)},body:emptyPmtiles};
  const match=/^bytes=(\d+)-(\d*)$/.exec(range);
  const start=Number(match?.[1]),end=Math.min(match?.[2]?Number(match[2]):emptyPmtiles.length-1,emptyPmtiles.length-1);
  if (!match || !Number.isSafeInteger(start) || start>end) return {status:416,headers:{...headers,'content-range':`bytes */${emptyPmtiles.length}`},body:''};
  const body=emptyPmtiles.subarray(start,end+1);
  return {status:206,headers:{...headers,'content-range':`bytes ${start}-${end}/${emptyPmtiles.length}`,'content-length':String(body.length)},body};
}
