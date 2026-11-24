import test from 'node:test';
import assert from 'node:assert/strict';
import {flatDrawingAdapter, drawingLines, projectDrawingPath} from '../styles/flat-drawing.mjs';
import {flatCamera} from '../styles/flat-camera.mjs';
import {Drawing} from '../styles/draw.mjs';

const mapAt=(center,zoom=7)=>flatCamera({center,zoom,width:600,height:400});
const shape=(type,coordinates,properties={})=>({type:'Feature',geometry:{type,coordinates},properties});
const context=out=>new Proxy({}, {get(_,name){return (...args)=>out.push([name,...args]);}});
const pt=([x,y])=>({x,y});
function setup(camera=mapAt([0,0])) {
  const canvas={style:{}};
  const adapter=flatDrawingAdapter(canvas,()=>{});
  adapter.setCamera(camera);
  const tool=new Drawing(adapter.map);
  tool.install();
  return {adapter,tool,map:adapter.map,camera};
}

test('paint and hit testing agree for dash styles, fill holes and drawing order',()=>{
  const {adapter,tool,map,camera}=setup();
  tool.add([
    shape('Polygon',[[[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]],[[-.2,-.2],[.2,-.2],[.2,.2],[-.2,.2],[-.2,-.2]]]),
    shape('LineString',[[-.8,.6],[.8,.6]],{dash:'dashed',width:4}),
    shape('Point',[0,.6]),
  ]);
  const query=(coords,layers)=>map.queryRenderedFeatures(pt(camera.project(coords)),{layers});
  assert.equal(query([0,0],['drawing-fill']).length,0);
  assert.equal(query([0,.4],['drawing-fill'])[0].geometry.type,'Polygon');
  assert.deepEqual(query([0,.6],['drawing-points',...drawingLines]).map(f=>f.geometry.type),['Point','LineString']);
  assert.ok(query([.7,.6],['drawing-line-dashed'])[0].properties.drawing);
  assert.equal(query([.7,.6],['drawing-line']).length,0);
  const out=[];adapter.draw(context(out));
  assert.ok(out.some(([n,p])=>n==='fill'&&p==='evenodd'));
  assert.ok(out.some(([n,p])=>n==='setLineDash'&&p[0]===10&&p[1]===7.2));
});

test('cross-dateline line paints and hits only its nearby world copy',()=>{
  const nodes=[[179.7,0],[-179.9,0]], camera=mapAt([179.8,0]);
  const [a,b]=projectDrawingPath(camera,nodes);
  assert.ok(b[0]>a[0]&&b[0]-a[0]<80);
  const {tool,adapter,map}=setup(camera);
  tool.add([shape('LineString',nodes)]);
  tool.setMode('line');
  assert.equal(map.queryRenderedFeatures(pt(camera.project([179.9,0])),{layers:['drawing-handle-targets']})[0].properties.mid,1);
  const point=camera.project([179.9,0]);
  assert.equal(map.queryRenderedFeatures(pt(point),{layers:drawingLines}).length,1);
  const other=mapAt([0,0]);
  adapter.setCamera(other);
  assert.equal(map.queryRenderedFeatures(pt(other.project([0,0])),{layers:drawingLines}).length,0);
});

test('a drawing drag inserts one vertex, then edits the same vertex on subsequent movement',()=>{
  const {tool,adapter,map,camera}=setup();
  tool.add([shape('LineString',[[-.5,0],[.5,0]])]);
  tool.setMode('line');
  const [x,y]=camera.project([0,0]), mouse={button:0,buttons:1};
  assert.equal(map.queryRenderedFeatures({x,y},{layers:['drawing-handle-targets']})[0].properties.mid,1);
  assert.equal(adapter.emit('mousedown',[x,y],mouse),true);
  adapter.emit('mousemove',[x+8,y+12],mouse);
  adapter.emit('mousemove',[x+16,y+17],mouse);
  adapter.emit('mouseup',[x+16,y+17],mouse);
  const line=tool.features[0].geometry.coordinates;
  assert.equal(line.length,3);
  assert.deepEqual(line[1],camera.unproject([x+16,y+17]).map(v=>+v.toFixed(6)));
  tool.setPaused(true);
  assert.equal(tool.dragging(),false,'pause retires the previous handle click suppression');
  assert.equal(adapter.emit('mousedown',[x+16,y+17],mouse),false);
});
