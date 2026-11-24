import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {compileFlatGeometryStyle} from '../styles/flat-style.mjs';

test('flat style reuses MapLibre filtering, paint defaults, and feature and camera expressions', () => {
  const style=compileFlatGeometryStyle({
    id:'speed', source:'rails', 'source-layer':'speed', type:'line', minzoom:4, maxzoom:10,
    filter:['==',['get','railway'],'rail'],
    paint:{'line-color':['match',['get','maxspeed'],160,'#c80000','#000000'],
      'line-width':['interpolate',['linear'],['zoom'],4,2,10,8],
      'line-opacity':0.5,'line-dasharray':[2,1]},
    layout:{'line-cap':'round'},
  });
  const feature={id:4,type:2,properties:{railway:'rail',maxspeed:160}};
  assert.deepEqual([style.source,style.sourceLayer],['rails','speed']);
  assert.equal(style.visibleAt(3.99),false);
  assert.equal(style.visibleAt(4),true);
  assert.equal(style.visibleAt(10),false);
  assert.equal(style.resolve({zoom:6},{...feature,properties:{railway:'tram'}}),null);
  const p=style.resolve({zoom:6},feature);
  assert.equal(p.width,4);
  assert.equal(p.color.replaceAll(' ',''),'rgba(200,0,0,1)');
  assert.equal(p.opacity,0.5);
  assert.deepEqual(p.dashPixels,[8,4]);
  assert.equal(p.lineCap,'round');
  assert.equal(p.lineJoin,'miter');
});

test('every current Atlas line, fill and circle layer compiles its filter and paint', () => {
  const style=JSON.parse(readFileSync(new URL('../styles/world.style.json',import.meta.url)));
  const lines=style.layers.filter(layer=>['line','fill','circle'].includes(layer.type));
  assert.ok(lines.length>200);
  for(const layer of lines) assert.doesNotThrow(()=>compileFlatGeometryStyle(layer),layer.id);
});
