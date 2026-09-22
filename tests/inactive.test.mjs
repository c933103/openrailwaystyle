import test from 'node:test';
import assert from 'node:assert/strict';
import {toGeoJSON} from '../scripts/lifecycle.mjs';
const geo = [{lon:1,lat:50},{lon:2,lat:50},null,{lon:3,lat:50},{lon:4,lat:50}];
test('lifecycle tags survive conversion without imaginary bridges or active tracks', () => {
  const json = {elements:[
    {type:'way',id:1,tags:{railway:'abandoned',name:'Old line'},geometry:geo},
    {type:'way',id:2,tags:{'razed:railway':'rail',highway:'cycleway'},geometry:geo.slice(0,2)},
    {type:'way',id:3,tags:{railway:'rail','disused:railway':'rail'},geometry:geo},
    {type:'way',id:4,tags:{railway:'construction',construction:'station'},geometry:geo},
  ]};
  const result = toGeoJSON(json);
  assert.deepEqual(result.features.map(f=>f.properties.state),['abandoned','razed']);
  assert.equal(result.features[0].geometry.type,'MultiLineString');
  assert.equal(result.features[0].geometry.coordinates.length,2);
  assert.equal(result.features[1].geometry.type,'LineString');
  assert.equal(result.features[0].properties.maxspeed,undefined);
  assert.throws(()=>toGeoJSON({remark:'runtime error: timeout',elements:[]}),/Incomplete/);
});