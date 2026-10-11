import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import {decodeBundle} from '../styles/tile-bundles.mjs';
import {stationPoint,parseStationRegion,mercatorLocation,stationOverviewData,
 STATION_ZOOM_MIN,STATION_ZOOM_MAX,STATION_TILE_LAYER} from '../scripts/station-overview.mjs';

const node=(id,lon,lat,tags={railway:'station',name:'Station'})=>({type:'node',id,lon,lat,tags});
const features=(bundle,zoom)=>[...decodeBundle(gunzipSync(bundle)).entries()].filter(([key])=>key.startsWith(zoom+'/'))
  .flatMap(([key,bytes])=>{
    const layer=new VectorTile(new Pbf(new Uint8Array(bytes))).layers[STATION_TILE_LAYER];
    return [...Array(layer?.length||0)].map((_,i)=>({key,feature:layer.feature(i)}));
  });

test('actual OSM point and way identities are kept without fusing same-name stations',()=>{
 const response={elements:[
  node(31,139.767,35.681,{railway:'station',station:'train',name:'東京'}),
  {type:'way',id:31,center:{lon:139.77,lat:35.685},tags:{railway:'station',station:'subway',name:'東京'}},
  node(32,139.767,35.681,{railway:'halt',name:'Halt'}),
  node(33,139.767,35.681,{railway:'tram_stop',name:'Tram'}),
  node(34,139.767,35.681,{public_transport:'station',subway:'yes',name:'Subway'}),
  node(35,139.767,35.681,{public_transport:'station',bus:'yes',name:'Bus'}),
  node(36,139.767,35.681,{railway:'station',disused:'yes'}),
  node(37,139.767,35.681,{railway:'station',construction:'yes'}),
  node(38,139.767,35.681,{railway:'station','proposed:railway':'station'}),
 ]};
 const rows=parseStationRegion(response);
 assert.deepEqual(rows.map(p=>p.id),['node-31','node-32','node-33','node-34','node-38','way-31']);
 assert.ok(rows.find(p=>p.id==='node-38'),'an active station may also have proposed:railway tags');
 assert.equal(rows.find(p=>p.id==='way-31').station,'subway');
 assert.equal(rows.find(p=>p.id==='node-31').name,'東京');
 assert.equal(rows.find(p=>p.id==='node-33').feature,'tram_stop');
 assert.deepEqual(parseStationRegion({elements:[response.elements[0],response.elements[0]]}),[rows[0]]);
 assert.throws(()=>parseStationRegion({elements:[node(1,139,35),node(1,139.01,35)]}),/Conflicting/);
});

test('invalid or incomplete source input never produces an allegedly complete station dataset',()=>{
 assert.throws(()=>parseStationRegion({elements:[],remark:'timed out'}),/Incomplete/);
 assert.throws(()=>parseStationRegion({elements:[node(1,0,0),node(2,0,0)]},{maxElements:1}),/oversized/);
 assert.throws(()=>parseStationRegion({elements:[{type:'way',id:42,tags:{railway:'station'}}]}),/valid coordinate/);
 assert.throws(()=>stationOverviewData([null]),/Invalid station record/);
 assert.throws(()=>stationOverviewData([stationPoint(node(1,1,1)),stationPoint(node(1,1,1))]),/Duplicate/);
 assert.throws(()=>stationOverviewData([stationPoint(node(5,10,86))]),/polar station/);
 assert.throws(()=>stationOverviewData([stationPoint(node(5,10,1))],{maxTileBytes:10}),/bounded/);
 assert.equal(stationPoint(node(9,0,0,{railway:'station',name:'A'.repeat(400)})).name.length,256);
});

test('all known station points exist in every supported zoom; names are not a placement gate',()=>{
 const rows=parseStationRegion({elements:[
  node(10,9.5457,47.1486,{railway:'station',name:'Liechtenstein A'}),
  node(11,9.546,47.1486,{railway:'station',name:'Liechtenstein B'}),
  node(12,139.767,35.681,{railway:'station',name:''}),
  node(13,-73.994,40.75,{railway:'halt',name:'Penn'}),
  node(14,179.999,0,{railway:'station',name:'Dateline east'}),
  node(15,-179.999,0,{railway:'station',name:'Dateline west'}),
 ]});
 const output=stationOverviewData(rows);
 assert.equal(output.manifest.complete,true);
 assert.equal(output.manifest.stations,rows.length);
 assert.equal(output.manifest.maxzoom,7);
 assert.ok(output.archives.size>=2);
 const decode=(z)=>[...output.archives.values()].flatMap(buffer=>features(buffer,z));
 for(let z=STATION_ZOOM_MIN;z<=STATION_ZOOM_MAX;z++){
   const visible=new Set(decode(z).map(row=>row.feature.properties.id));
   assert.deepEqual([...visible].sort(),rows.map(r=>r.id).sort(),`z${z} retains all station identities, independent of label presence`);
 }
 assert.ok(decode(3).some(p=>p.feature.properties.name===''));
 const acrossDateline=decode(7).filter(p=>['node-14','node-15'].includes(p.feature.properties.id));
 assert.ok(acrossDateline.some(p=>p.key.includes('/0/')),'dateline is wrapped to the first x column');
 assert.ok(acrossDateline.some(p=>p.key.includes('/127/')),'dateline retains the final x column');
 const header=output.index;
 assert.equal(header.zoom,3);
 assert.equal(header.bundles.length,output.archives.size);
 const counts=[...output.tiles.values()].map(v=>v.count);
 assert.ok(counts.every(v=>v>0));
});

test('valid projection limits never silently clamp a polar station to a false position',()=>{
 assert.deepEqual(mercatorLocation(0,0,3),[4,4]);
 assert.ok(mercatorLocation(180,0,7)[0] < .0000001);
 assert.throws(()=>mercatorLocation(0,89,3),/Invalid/);
 assert.throws(()=>mercatorLocation(NaN,0,3),/Invalid/);
});
