import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Pbf from 'pbf';
import {createHash} from 'node:crypto';

function glyphField(tag,glyph,pbf){
 if(tag===1)glyph.id=pbf.readVarint();
 else if(tag===2)glyph.bitmap=pbf.readBytes();
 else if(tag===3)glyph.width=pbf.readVarint();
 else if(tag===4)glyph.height=pbf.readVarint();
 else if(tag===5)glyph.left=pbf.readSVarint();
 else if(tag===6)glyph.top=pbf.readSVarint();
 else if(tag===7)glyph.advance=pbf.readVarint();
}
function stackField(tag,stack,pbf){
 if(tag===1)stack.name=pbf.readString();
 else if(tag===2)stack.range=pbf.readString();
 else if(tag===3)stack.glyphs.push(pbf.readMessage(glyphField,{}));
}
function rootField(tag,stacks,pbf){
 if(tag===1)stacks.push(pbf.readMessage(stackField,{glyphs:[]}));
}

test('offline Latin glyph bearings use the FreeType ascent origin',async()=>{
 const bytes=await readFile(new URL('./fixtures/browser-glyphs/0-255.pbf',import.meta.url));
 const [stack,...others]=new Pbf(bytes).readFields(rootField,[]);
 assert.deepEqual(others,[]);
 assert.equal(stack.name,'DejaVu Sans fixture');
 assert.equal(stack.range,'0-255');
 assert.deepEqual(stack.glyphs.map(g=>g.id),Array.from({length:224},(_,i)=>i+32));
 for(const glyph of stack.glyphs)
  assert.equal(glyph.bitmap.length,(glyph.width+6)*(glyph.height+6),'three-pixel SDF border is retained');

 // Origin-only migration: every bitmap and all unrelated metrics retain
 // their pre-correction digest (glyph order is asserted above).
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 assert.equal(hash(Buffer.concat(stack.glyphs.map(g=>Buffer.from(g.bitmap)))),'d70c1f029c7e372177cf854e38f60eeee640b87a96f4d1f955bc6ab0a4f5cf7c');
 const metrics=stack.glyphs.map(g=>({'1':g.id,'3':g.width,'4':g.height,'5':g.left>=0?g.left*2:-g.left*2-1,'7':g.advance}));
 assert.equal(hash(JSON.stringify(metrics)),'8e45a2173039c6207606fd5b32f5e6406512591ddae82e22aa1a27a912fbdddc');

 // DejaVu Sans at 24 px: FreeType ascent is 23. Fontnik serializes
 // bitmap_top - ascender, whereas Pillow anchor='ls' is baseline-relative.
 // A raw +14 for × puts its ink far above the MapLibre symbol anchor.
 for(const [id,width,height,top,advance] of [[65,17,18,-5,16],[72,18,18,-5,18],[103,15,18,-10,15],[215,20,14,-9,20]]){
  const glyph=stack.glyphs.find(g=>g.id===id);
  assert.deepEqual({width:glyph.width,height:glyph.height,left:glyph.left,top:glyph.top,advance:glyph.advance},
   {width,height,left:0,top,advance});
  assert.ok(glyph.bitmap.some(value=>value>191),'real glyph ink survives the metric correction');
  assert.ok(glyph.bitmap.some(value=>value<64),'outside SDF remains present');
 }
 const generator=await readFile(new URL('../scripts/build-browser-glyph-fixture.py',import.meta.url),'utf8');
 assert.match(generator,/ascent, _ = font\.getmetrics\(\)/);
 assert.match(generator,/integer\(6, signed\(-top - ascent\)\)/);
});
