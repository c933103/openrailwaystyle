import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {flatCamera} from '../styles/flat-camera.mjs';
import {compileFlatFrame} from '../styles/flat-frame.mjs';
import {compileFlatVectorQuery} from '../styles/flat-vector-query.mjs';

const raw=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
const layer=raw.layers.find(l=>l.id==='infrastructure-reference-main');
const colorBlue='rgba(35,86,182,1)',colorRed='rgba(215,25,28,1)';
const mk=(id,rank,fast)=>({id,type:2,extent:4096,properties:{id,classification:'main',rank,highspeed_tag:fast?'yes':'no'},paths:[[{x:800,y:2048},{x:3200,y:2048}]]});
const camera=flatCamera({center:[0,0],zoom:0,width:512,height:512});
const paint=compileFlatFrame([layer]),query=compileFlatVectorQuery([layer]);
const frame=features=>new Map([[layer.source,[{tile:{x:0,y:0,z:0},vector:{layer:()=>features}}]]]);
const context=order=>({globalAlpha:1,save(){},restore(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){},setLineDash(){},stroke(){order.push(this.strokeStyle);}});
test('real Infrastructure style paints the higher reference sort key on top in both tile orders',()=>{
 const high=mk(1,0,true),low=mk(2,3,false);
 for(const features of [[high,low],[low,high]]){
  const order=[];const f=frame(features);
  assert.equal(paint(context(order),camera,f).layerDraws.get(layer.id),2);
  assert.deepEqual(order,[colorBlue,colorRed]);
  assert.deepEqual(query(camera,[256,256],f).map(f=>f.id),[1,2]);
 }
});
test('same sort key keeps original paint order and picks the later, visible line first',()=>{
 const first=mk(1,1,true),last=mk(2,1,false);
 const order=[];const f=frame([first,last]);
 paint(context(order),camera,f);
 assert.deepEqual(order,[colorRed,colorBlue]);
 assert.deepEqual(query(camera,[256,256],f).map(f=>f.id),[2,1]);
});
