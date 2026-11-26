import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileFlatLocalGeometry} from '../styles/flat-local-geometry.mjs';
import {flatCamera} from '../styles/flat-camera.mjs';
import {compileFlatVectorQuery} from '../styles/flat-vector-query.mjs';

const ring=(x,y,d)=>[[x-d,y-d],[x+d,y-d],[x+d,y+d],[x-d,y+d],[x-d,y-d]];
const layer={id:'test-supply-area',source:'supply','source-layer':'supply',type:'fill',
  paint:{'fill-color':'#293a42','fill-opacity':0.4}};

test('indexed Canvas facility areas retain OSM identity, holes and matching geometry on wrapped-world copies',()=>{
  const prepare=compileFlatLocalGeometry({type:'FeatureCollection',features:[{
    type:'Feature',id:'way-42',properties:{osm_id:'42',power_state:'present'},
    geometry:{type:'Polygon',coordinates:[ring(1,1,.006),ring(1,1,.002).reverse()]},
  }]},'supply');
  for(const offset of [0,360]){
    const camera=flatCamera({center:[1+offset,1],zoom:13,width:320,height:200,bearing:28});
    const frame=new Map([['supply',prepare(camera)]]);
    const area=camera.project([1.004+offset,1]), hole=camera.project([1+offset,1]);
    assert.equal(compileFlatVectorQuery([layer])(camera,area,frame).length,0,'fills remain opt-in');
    const query=compileFlatVectorQuery([layer],{includeFill:()=>true});
    assert.equal(query(camera,hole,frame).length,0);
    const [hit]=query(camera,area,frame);
    assert.equal(hit.id,'way-42');
    assert.equal(hit.properties.osm_id,'42');
    assert.equal(hit.geometry.type,'Polygon');
    assert.equal(query(camera,camera.project([1.009+offset,1]),frame).length,0);
  }
});
