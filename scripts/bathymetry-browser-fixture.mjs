// Synthetic ocean with an island, a shallow shelf and a deep basin. These
// provider-shaped bytes exercise the real PMTiles, DEM and depth-worker paths.
import {deflateSync} from 'node:zlib';
import vtpbf from 'vt-pbf';
import {pmtilesBytesResponse} from './pmtiles-browser-fixture.mjs';

const varint = value => {
  const bytes=[];
  do {const low=value%128;value=Math.floor(value/128);bytes.push(low+(value?128:0));} while(value);
  return bytes;
};
export const oceanFixtureTile=Buffer.from(vtpbf.fromGeojsonVt({water:{features:[{
  type:3,tags:{class:'ocean'},geometry:[
    [[0,0],[4096,0],[4096,4096],[0,4096],[0,0]],
    [[1500,1500],[1500,2500],[2500,2500],[2500,1500],[1500,1500]],
  ],
}]}}));
const count=(4**15-1)/3;
const directory=Buffer.from([1,0,...varint(count),...varint(oceanFixtureTile.length),1]);
const metadata=Buffer.from(JSON.stringify({vector_layers:[{id:'water',fields:{class:'String'}}]}));
const header=Buffer.alloc(127);header.write('PMTiles');header[7]=3;
const tileOffset=127+directory.length+metadata.length;
for(const [offset,value] of [[8,127],[16,directory.length],[24,127+directory.length],[32,metadata.length],
  [40,tileOffset],[48,0],[56,tileOffset],[64,oceanFixtureTile.length],[72,count],[80,1],[88,1]])header.writeBigUInt64LE(BigInt(value),offset);
header[96]=1;header[97]=header[98]=header[99]=1;header[100]=0;header[101]=14;
for(const [offset,value] of [[102,-180],[106,-85],[110,180],[114,85]])header.writeInt32LE(value*1e7,offset);
export const oceanFixtureArchive=Buffer.concat([header,directory,metadata,oceanFixtureTile]);

const crc32 = bytes => {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
};
const chunk = (name,body) => {
  const type=Buffer.from(name),length=Buffer.alloc(4),crc=Buffer.alloc(4);
  length.writeUInt32BE(body.length);crc.writeUInt32BE(crc32(Buffer.concat([type,body])));
  return Buffer.concat([length,type,body,crc]);
};
export function depthFixturePng() {
  const size=256,raw=Buffer.alloc(size*(1+size*4));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const elevation=x<size/2?-20:-4000,encoded=elevation+32768,i=y*(1+size*4)+1+x*4;
    raw[i]=Math.floor(encoded/256);raw[i+1]=encoded%256;raw[i+2]=0;raw[i+3]=255;
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export async function installBathymetryFixtures(context, style) {
  const archive=style.sources.openmaptiles.url.replace(/^pmtiles:\/\//,''),dem=style.sources.relief.tiles[0];
  const demOrigin=new URL(dem).origin,png=depthFixturePng();
  await context.route(archive,route=>route.fulfill(pmtilesBytesResponse(oceanFixtureArchive,route.request().headers().range,'atlas-ocean-fixture-v1')));
  await context.route(url=>url.origin===demOrigin,route=>route.fulfill({contentType:'image/png',body:png}));
}
