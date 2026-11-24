import assert from 'node:assert/strict';
import test from 'node:test';
import {compileFlatFrame} from '../styles/flat-frame.mjs';

test('frame respects style order, camera zoom and explicitly reports unsupported layers', () => {
  const calls = [];
  const camera = {width:256,height:128,zoom:4.25,tileTransform:()=>[1,0,0,1,0,0]};
  const ctx = {globalAlpha:1,save(){calls.push(['save']);},restore(){calls.push(['restore']);},
    clearRect(...rect){calls.push(['clear',...rect]);},fillRect(...rect){calls.push(['fill',this.fillStyle,...rect]);},
    transform(){},drawImage(image){calls.push(['raster',image]);}};
  const draw = compileFlatFrame([
    {id:'background',type:'background',paint:{'background-color':'#557799'}},
    {id:'base',type:'raster',source:'base',paint:{'raster-opacity':1}},
    {id:'invisible',type:'symbol',minzoom:5},
    {id:'hidden',type:'symbol',layout:{visibility:'none'}},
    {id:'labels',type:'symbol'},
    {id:'pattern',type:'fill','source-layer':'area',paint:{'fill-pattern':'pattern'}},
  ]);
  const report = draw(ctx,camera,new Map([['base',[{tile:{},image:'decoded'}]]]));
  assert.deepEqual(calls.filter(c=>['clear','fill','raster'].includes(c[0])),
    [['clear',0,0,256,128],['fill','rgba(85,119,153,1)',0,0,256,128],['raster','decoded']]);
  assert.deepEqual([...report.layerDraws],[['background',1],['base',1]]);
  assert.deepEqual(report.unsupported,['labels','pattern']);
  assert.equal(calls.filter(c=>c[0]==='save').length,calls.filter(c=>c[0]==='restore').length);
});
