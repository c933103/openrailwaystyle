import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {powerMethodQuery,powerMethodsGeoJSON} from '../scripts/power-method-data.mjs';
const prefixes=['','construction:','proposed:','disused:','abandoned:','razed:','demolished:','removed:'];
const box=[-90,-180,0,-90];
const old=readFileSync(new URL('./fixtures/power-methods-v1-query.ql',import.meta.url),'utf8');
// Interpret the emitted literal QL filters independently of the generators and
// JS classifier, including object-type constraints and named-set membership.
function decode(query) {
  const selectors=text=>[...text.matchAll(/(nwr|way)(\.[a-z]+)?((?:\["(?:[^"\\]|\\.)*"~"(?:[^"\\]|\\.)*",i\])+)(\(-90,-180,0,-90\))?;/g)].map(([,type,set,filters,bbox])=>({type,set,bbox,filters:[...filters.matchAll(/\[("(?:[^"\\]|\\.)*")~("(?:[^"\\]|\\.)*"),i\]/g)].map(([,key,value])=>({key:JSON.parse(key),value:new RegExp(JSON.parse(value).replaceAll('[[:space:]]','\\s'),'i')}))}));
  const parts=query.split(')->.charging;'),primary=parts.length===2?selectors(parts[0]):[],output=selectors(parts.at(-1));
  const presence=[...query.matchAll(/is_tag\(("(?:[^"\\]|\\.)*")\)/g)].map(([,key])=>JSON.parse(key));
  const matches=(s,e)=>['node','way','relation'].includes(e.type)&&(s.type==='nwr'||e.type==='way')&&s.filters.every(f=>e.tags[f.key]!=null&&f.value.test(e.tags[f.key]));
  return {primary,output,presence,selected:e=>{
    const potential=primary.some(s=>matches(s,e))&&presence.some(key=>Object.hasOwn(e.tags,key));
    return output.some(s=>(!s.set||s.set==='.potential'&&potential)&&matches(s,e));
  }};
}
const prior=decode(old),current=decode(powerMethodQuery(box));

test('common charging-use filters run only on a bounded primary candidate set',()=>{
  assert.equal(prior.output.length,240);
  assert.equal(current.primary.length,16);assert.ok(current.primary.every(s=>s.bbox&&!s.set&&s.type==='nwr'&&s.filters.length===1));
  const direct=current.output.filter(s=>!s.set),local=current.output.filter(s=>s.set);
  // Electrified methods, propulsion, traction and railway chargers: one bounded selector each per lifecycle prefix.
  assert.equal(direct.length,32);assert.ok(direct.every(s=>s.bbox&&s.filters.length===1));
  for(const key of ['electrified','propulsion','traction','railway'])assert.equal(direct.filter(s=>s.filters[0].key.replace(/^[a-z]+:/,'')===key).length,8,key);
  assert.equal(local.length,14);assert.ok(local.every(s=>s.set==='.potential'&&!s.bbox&&s.filters.length===1));
  assert.deepEqual(current.presence,['train','tram','light_rail','subway',...prefixes.map(p=>p+'railway'),'usage','landuse']);
  assert.ok(current.primary.every(s=>/^(?:(?:construction|proposed|disused|abandoned|razed|demolished|removed):)?(?:amenity|man_made)$/.test(s.filters[0].key)));
  assert.match(powerMethodQuery(box),/\[timeout:240\]\[maxsize:134217728\]/);
  assert.ok(powerMethodQuery(box).endsWith('out body geom qt;'));
});

test('factoring preserves raw selections across lifecycle, whitespace, case, mixed primary keys and negatives',()=>{
  let checked=0;
  const compare=tags=>{
    for(const type of ['node','way','relation']) {
      const e={type,tags};assert.equal(current.selected(e),prior.selected(e),`${type} ${JSON.stringify(tags)}`);checked++;
    }
  };
  const hints=[{},...['train','tram','light_rail','subway'].flatMap(key=>['yes',' designated ; no ','only','YES','no','not_yes',''].map(v=>({[key]:v}))),
    ...prefixes.flatMap(p=>['yes','rail','subway','power_supply',' rail ; TRAM ','charging_station','not_rail','disused',''].map(v=>({[p+'railway']:v}))),
    {usage:'traction'},{usage:' industrial ; RAILWAY '},{usage:'not_railway'},{landuse:'railway'},{landuse:' railway ; depot '},{landuse:'residential'}];
  for(const p of prefixes)for(const [key,value] of [['amenity','charging_station'],['man_made','charge_point']])for(const v of [value,value.toUpperCase(),` ${value} ; other `,`not_${value}`,''])for(const hint of hints)compare({[p+key]:v,...hint});
  for(const p of prefixes)for(const v of ['charging_station',' CHARGING_STATION ; rail ','not_charging_station','rail'])compare({[p+'railway']:v});
  for(const p of prefixes)for(const v of ['rail','4th_rail','ground-level_power_supply',' contact_line ; RAIL ','yes','not_rail'])compare({[p+'electrified']:v});
  for(const p of prefixes)for(const q of prefixes)for(const hint of hints)compare({[p+'amenity']:'charging_station',[q+'man_made']:'charge_point',...hint});
  for(const tags of [{AMENITY:'charging_station',train:'yes'},{amenity:'charging_station','xdisused:railway':'yes'}, {'future:amenity':'charging_station',train:'yes'}, {amenity:'charging_station','railway:extra':'rail'}, {amenity:'charging_station',train:'no',operator:'Railway company'}])compare(tags);
  assert.ok(checked>45000);
});

test('deterministic mixed-tag cases preserve raw candidate and transformed geometry equality',()=>{
  let seed=204;
  const next=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;};
  const keys=prefixes.flatMap(p=>['amenity','man_made','railway','electrified'].map(k=>p+k)).concat(['train','tram','light_rail','subway','usage','landuse','AMENITY']);
  const values=['yes','no','only',' designated ; other ','rail','subway','charging_station','charge_point','4th_rail','ground-level_power_supply',' RAIL ; contact_line ',' railway ; depot ','traction','not_railway','',null];
  const elements=[];
  for(let i=0;i<6000;i++) {
    const tags={};for(let j=0;j<1+next(7);j++)tags[keys[next(keys.length)]]=values[next(values.length)];
    const type=['node','way','relation'][next(3)],e={type,id:i+1,tags,lon:135,lat:34,center:{lon:135,lat:34},geometry:[{lon:135,lat:34},{lon:135.001,lat:34.001}]};
    assert.equal(current.selected(e),prior.selected(e),JSON.stringify(e));elements.push(e);
  }
  const positives=prefixes.flatMap((p,i)=>[
    {type:'node',id:10000+i,tags:{[p+'amenity']:'charging_station',train:'yes'},lon:135,lat:34},
    {type:'way',id:11000+i,tags:{[p+'railway']:'subway',electrified:'rail'},geometry:[{lon:135,lat:34},{lon:135.001,lat:34.001}]}
  ]);elements.push(...positives);
  const a=powerMethodsGeoJSON({elements:elements.filter(e=>prior.selected(e))}),b=powerMethodsGeoJSON({elements:elements.filter(e=>current.selected(e))});
  assert.deepEqual(b,a);assert.ok(a.features.length>=16);
});
