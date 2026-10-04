// Merge small encoded tiles, rather than retaining the world in a GeoJSON
// object. Bundle geometry that is genuinely identical in this tile. Approximate
// spatial proximity alone is never enough to identify two services.
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import vtpbf from 'vt-pbf';
import '../styles/pbf-utf8.mjs'; // names beyond U+1FFFF intact
import {profileBundle,FREQUENCY_PROFILES} from '../styles/service-frequency.mjs';
const identity=p=>[p.operator,p.ref,p.kind].map(s=>String(s||'').trim().toLowerCase()).join('|');
export function mergeServiceTiles(buffers){
  const groups=new Map();
  for(const buffer of buffers){
    if(!buffer)continue;
    const layer=new VectorTile(new Pbf(buffer)).layers.service_routes;
    if(!layer)continue;
    for(let i=0;i<layer.length;i++){
      const f=layer.feature(i),geometry=f.loadGeometry().map(line=>line.map(p=>[p.x,p.y]));
      const key=JSON.stringify(geometry),group=groups.get(key)||[];
      group.push({geometry,type:f.type,tags:{...f.properties}});groups.set(key,group);
    }
  }
  const features=[];
  for(const group of groups.values()){
    const unique=new Map();
    for(const f of group){
      const p=f.tags,key=p.operator&&p.ref?identity(p):p.id;
      const held=unique.get(key);
      if(!held){unique.set(key,f);continue;}
      // Prefer timetable detail to an unprofiled duplicate OSM feature only
      // when operator, reference, mode AND encoded path match exactly.
      if(!held.tags.frequency_id&&p.frequency_id){unique.set(key,f);continue;}
      if(held.tags.frequency_id&&p.frequency_id&&held.tags.frequency_id!==p.frequency_id){
        for(const profile of FREQUENCY_PROFILES){
          if(held.tags[`frequency_${profile}`]!==p[`frequency_${profile}`]){
            for(const field of ['', 'high_', 'forward_', 'backward_', 'quality_'])delete held.tags[`frequency_${field}${profile}`];
            held.tags.frequency_note='Overlapping sources disagree; frequency withheld.';
          }
        }
      }
    }
    const records=[...unique.values()].sort((a,b)=>String(a.tags.id).localeCompare(String(b.tags.id)));
    if(records.length===1&&group.length===1){features.push(records[0]);continue;}
    const until=Math.min(...records.map(f=>f.tags.frequency_until).filter(v=>v>0));
    const bundle=profileBundle(records.map(f=>({properties:{...f.tags,frequency_until:Number.isFinite(until)?until:0},profiles:Object.fromEntries(FREQUENCY_PROFILES.map(profile=>[profile,{rate:f.tags[`frequency_${profile}`]??null,high:f.tags[`frequency_high_${profile}`],quality:f.tags[`frequency_quality_${profile}`],forward:f.tags[`frequency_forward_${profile}`],backward:f.tags[`frequency_backward_${profile}`],headway:f.tags[`headway_${profile}`]}]))})));
    records.forEach((f,i)=>features.push({...f,tags:{...bundle[i],i,n:records.length,slot:Math.max(-63,Math.min(63,2*i-records.length+1))}}));
  }
  return vtpbf.fromGeojsonVt({service_routes:{features}},{version:2});
}
