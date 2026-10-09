import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {PMTiles} from 'pmtiles';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {readFile} from 'node:fs/promises';
import {oceanFixtureArchive,oceanFixtureTile,depthFixturePng} from '../scripts/bathymetry-browser-fixture.mjs';
import {oceanPolygons,colourPixels,depthTile} from '../styles/bathymetry.mjs';

test('synthetic PMTiles archive exercises the real client across the reviewed coasts and zooms',async()=>{
  const archive=new PMTiles({getKey:()=> 'offline-ocean',getBytes:async(offset,length)=>({data:Uint8Array.from(oceanFixtureArchive.subarray(offset,offset+length)).buffer})});
  assert.equal((await archive.getHeader()).maxZoom,14);
  assert.equal((await archive.getMetadata()).vector_layers[0].id,'water');
  for(const [z,x,y] of [[0,0,0],[9,491,239],[10,982,478],[10,837,479],[14,16383,16383]]){
    const tile=await archive.getZxy(z,x,y);assert.ok(tile,`${z}/${x}/${y}`);
    assert.deepEqual(Buffer.from(tile.data),oceanFixtureTile);
  }
  const polygons=oceanPolygons(new VectorTile(new Pbf(oceanFixtureTile)));
  assert.equal(polygons.length,1);assert.equal(polygons[0].rings.length,2,'ocean and island hole are encoded separately');
});
test('Terrarium fixture PNG supplies distinct shallow shelf and deep-basin colours',()=>{
  const png=depthFixturePng();assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const pieces=[];let at=8;
  while(at<png.length){const size=png.readUInt32BE(at);if(png.subarray(at+4,at+8).toString()==='IDAT')pieces.push(png.subarray(at+8,at+8+size));at+=12+size;}
  const raw=inflateSync(Buffer.concat(pieces)),heights=[];
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){
    const i=y*1025+1+x*4;heights.push(raw[i]*256+raw[i+1]+raw[i+2]/256-32768);
  }
  assert.equal(heights[0],-20);assert.equal(heights[255],-4000);
  const pixels=colourPixels({width:256,height:256,data:heights},depthTile(10,982,478));
  let shallow=0,deep=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i]>150)shallow++;if(pixels[i]<120)deep++;}
  assert.ok(shallow>1000);assert.ok(deep>1000);
});
test('local glyph fixture has actual distinct platform numbers and consistent bitmap metrics',async()=>{
  const pbf=new Pbf(await readFile(new URL('./fixtures/browser-glyphs/0-255.pbf',import.meta.url)));
  const glyphs=[];
  const readGlyph=(tag,g,p)=>{
    if(tag===1)g.id=p.readVarint();if(tag===2)g.bitmap=p.readBytes();if(tag===3)g.width=p.readVarint();if(tag===4)g.height=p.readVarint();
    if(tag===5)g.left=p.readSVarint();if(tag===6)g.top=p.readSVarint();if(tag===7)g.advance=p.readVarint();
  };
  pbf.readFields((tag,_,p)=>{if(tag===1)p.readMessage((tag,_,p)=>{if(tag===3)glyphs.push(p.readMessage(readGlyph,{}));},{});},{});
  assert.equal(glyphs.length,224);
  for(const glyph of glyphs)assert.equal(glyph.bitmap.length,(glyph.width+6)*(glyph.height+6));
  const digits=glyphs.filter(g=>g.id>=48&&g.id<=57);assert.equal(digits.length,10);
  assert.equal(new Set(digits.map(g=>Buffer.from(g.bitmap).toString('base64'))).size,10);
});
