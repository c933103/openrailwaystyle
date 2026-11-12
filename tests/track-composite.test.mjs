import test from 'node:test';
import assert from 'node:assert/strict';
import encode from 'vt-pbf';
import {countTile} from '../styles/track-tiles.mjs';

const rail='railway_line_high', area='standard_railway_grouped_station_areas', station='standard_railway_text_stations';
const bytes=layers=>{const b=encode.fromGeojsonVt(Object.fromEntries(Object.entries(layers).map(([name,features])=>[name,{features}])),{version:2,extent:4096});return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const way=(id,y)=>({type:2,tags:{id,feature:'rail'},geometry:[[[-64,y],[2048,y],[4160,y]]]});
const point=(id,x,y)=>({type:1,tags:{id,feature:'station',station:'train',name:'Alpha'},geometry:[[x,y]]});
const polygon=(id)=>({type:3,tags:{id},geometry:[[[0,1900],[4096,1900],[4096,2100],[0,2100],[0,1900]]]});
const tracks=[way('a',2000),way('b',2008)], y=8192;
const tile=data=>({dx:0,dy:0,data});

test('track counts consume only logical rail, station-area and station-point layers of composite bytes',()=>{
 const plainRail=bytes({[rail]:tracks}),plainArea=bytes({[area]:[polygon('area')]}),plainStation=bytes({[station]:[point('station',2048,2000)]});
 const expected=countTile({tiles:[tile(plainRail)],areas:plainArea,stations:plainStation},y);
 assert.deepEqual(expected.points.map(p=>[p.tracks,p.station]),[[2,true]],'positive station count is exercised');
 // Put unrelated layers first, with colliding IDs and plausible geometry.
 const combinedRail=bytes({railway_text_km:[way('extra',2040)],[rail]:tracks});
 const combinedStation=bytes({
  standard_station_entrances:[point('station',1000,1000)],
  standard_railway_grouped_stations:[point('group',3000,1000)],
  standard_interlocking:[polygon('unrelated-area')],
  [area]:[polygon('area')],[station]:[point('station',2048,2000)],
 });
 assert.deepEqual(countTile({tiles:[tile(combinedRail)],areas:combinedStation,stations:combinedStation},y),expected);
 const running=countTile({tiles:[tile(plainRail)]},y);
 assert.ok(running.points.length>0,'positive running-track counts are exercised');
 const unrelated=bytes({standard_station_entrances:[point('entrance',2048,2000)],standard_interlocking:[polygon('box')]});
 assert.deepEqual(countTile({tiles:[tile(combinedRail)],areas:unrelated,stations:unrelated},y),running,
  'missing logical station layers must not fall back to other composite geometry');
 const supplementaryOnly=bytes({railway_text_km:tracks});
 assert.deepEqual(countTile({tiles:[tile(supplementaryOnly)]},y).points,[],
  'a transport-valid supplementary-only MVT is not railway geometry');
});
