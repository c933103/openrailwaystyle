import test from 'node:test';
import assert from 'node:assert/strict';
import {axleLoad,axlePaint,axleLabel,explicitAxleLoad,formatAxleLoad,SHORT_TON} from '../styles/axle-load.mjs';
import {readFile} from 'node:fs/promises';
import {installLabelProtocols,readTile} from '../styles/tile-labels.mjs';
import encode from 'vt-pbf';
import {encodeLoadingGauges} from '../styles/loading-gauge-list.mjs';
const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
test('axle loads distinguish reference categories, restricted variants and non-load classes',()=>{
 for(const [track_class,t,m] of [['A',16,5],['B2',18,6.4],['C3',20,7.2],['D4',22.5,8],['D4L',22.5,8],['E6',25,10],['CM2',21,6.4],['CE',20,8]]) {
  const a=axleLoad({track_class});assert.equal(a.tonnes,t);assert.equal(a.perMetre,m);
 }
 assert.equal(axleLoad({track_class:'D4L'}).restricted,true);
 for(const track_class of ['1','4','9','excepted','D','C1','D99','D4unknown'])assert.equal(axleLoad({track_class}),null,track_class);
 assert.equal(axleLoad({track_class:'C2',axle_system:'fi'}),null);
 assert.equal(axleLoad({track_class:'A',country:'FI'}),null);
 assert.equal(axleLoad({track_class:'C2',axle_system:'unknown'}),null);
});
test('explicit limits take precedence, units convert and malformed values stay unknown',()=>{
 assert.equal(explicitAxleLoad('22.5'),22.5);assert.equal(explicitAxleLoad('22.5 t'),22.5);
 assert.equal(explicitAxleLoad('25 st'),25*SHORT_TON);assert.equal(explicitAxleLoad('50000 lbs'),22.6796185);
 assert.equal(explicitAxleLoad('20000 kg'),20);
 for(const value of ['','none','0','-1','20;22','22 tons','22.5 t garbage','1e2'])assert.equal(explicitAxleLoad(value),null);
 assert.equal(axleLoad({axle_load:'25',track_class:'D4'}).tonnes,25);
 assert.equal(axleLoad({axle_load:'25',maxaxleload:'20',track_class:'D4'}).tonnes,20);
 assert.equal(axleLoad({axle_load:'18',maxaxleload:'20'}).tonnes,18);
 assert.equal(axleLoad({axle_load:'invalid',maxaxleload:'20'}).source,'maxaxleload');
 assert.equal(axleLoad({axle_load:'25',maxaxleload:'20'}).physical,25);
 assert.equal(axleLoad({maxaxleload:'20',track_class:'D4'}).tonnes,20);
 assert.equal(axleLoad({maxaxleload:'25',track_class:'D',axle_system:'fi'}).tonnes,25);
 assert.match(formatAxleLoad(axleLoad({maxaxleload:'25 st'}),'imperial'),/^25 short tons/);
 assert.equal(axlePaint()[0],'case');assert.equal(axleLabel('imperial').at(-1),'');
});
test('axle lookup is lazy, annotates detailed and overview tiles and is shared with branch tiles',async()=>{
 const protocols={},requests=[],signal=new AbortController().signal;
 const bytes=encode.fromGeojsonVt({railway_line_high:{features:[{type:2,geometry:[[[0,0],[50,50]]],tags:{id:'123-0',track_class:'C2'}}]}},{version:2,extent:4096});
 const list=encodeLoadingGauges([[123,JSON.stringify({track_class:'C2',axle_system:'fi',maxaxleload:'20'})]]);
 const {axleTile}=installLabelProtocols({addProtocol:(k,v)=>protocols[k]=v},{},async url=>{
  requests.push(String(url));return String(url).endsWith('axle-load.json')?{ok:true,json:async()=>list}:{ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
 },{dataRoot:new URL('https://example.org/data/')});
 assert.equal(requests.length,0);
 const r=await protocols.atlasaxle({type:'arrayBuffer',url:'atlasaxle://https://example.org/tile'}, {signal});
 const p=readTile(r.data).layers.railway_line_high.feature(0).properties;
 assert.equal(p.axle_tonnes,20);assert.equal(p.axle_system,'fi');
 await axleTile(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 assert.equal(requests.filter(x=>x.endsWith('axle-load.json')).length,1);
 assert.equal(style.layers.find(l=>l.id==='axle-tracks').source,'axleRail');
 assert.equal(style.layers.find(l=>l.id==='axle-branch-overview').source,'axleBranch');
 assert.equal(style.layers.find(l=>l.id==='axle-labels').source,'axleRail');
});


test('axle extraction rejects partial, duplicate and malformed CSV while accepting empty regions',async()=>{
 const {axleRows}=await import('../scripts/axle-load-csv.mjs');
 assert.deepEqual(axleRows('way\t123\t\t22.5\t\tD4\ncount\t0\t1\t\t\t\n',3),[[123,'22.5','','D4']]);
 assert.deepEqual(axleRows('count\t0\t0\n',0),[]);
 for(const body of ['way\t123\t\t22.5\t\tD4','way\t123\t\t22.5\t\tD4\ncount\t0\t2','<html>error</html>','way\t1\t\nway\t1\t\ncount\t0\t2']) assert.throws(()=>axleRows(body,3));
});


test('kg and lb railway capacities affect colours and both legend unit presentations',()=>{
 const metric=axleLoad({axle_load:'22500 kg'}),imperial=axleLoad({axle_load:'50000 lb'});
 assert.equal(metric.tonnes,22.5);assert.equal(imperial.tonnes,22.6796185);
 assert.equal(metric.colour,axleLoad({axle_load:'22.5 t'}).colour);
 assert.match(formatAxleLoad(metric,'metric'),/22.5 t \(22,500 kg\)/);
 assert.match(formatAxleLoad(imperial,'imperial'),/25 short tons \(50,000 lb\)/);
 assert.match(formatAxleLoad(imperial,'metric'),/22.68 t \(22,680 kg\)/);
});
