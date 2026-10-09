import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

if(!process.env.ATLAS_CONTROL||!process.env.ATLAS_CANDIDATE)throw new Error('Set local source directories');
const control=(await import(pathToFileURL(resolve(process.env.ATLAS_CONTROL,'scripts/gtfs-service.mjs')))).timetableFeatures;
const candidate=(await import(pathToFileURL(resolve(process.env.ATLAS_CANDIDATE,'scripts/gtfs-service.mjs')))).timetableFeatures;
const now=Date.parse('2026-10-03T00:00:00Z');
const base={source:{id:'fixture',name:'Fixture Rail',url:'https://example.org/feed.zip',terms_url:'https://example.org/terms',retrieved:'2026-10-03',service_date:'2026-10-05',review_after_days:30,valid_until:1791504000,attribution:'Fixture provider',license:'CC-BY-4.0',feed_info:{}},agencies:[{agency_id:'a',agency_name:'Operator',agency_timezone:'Europe/Helsinki'}],routes:[{route_id:'r',route_short_name:'R',route_long_name:'Rail route',route_type:'1',route_color:'ff0000'}],profiles:{am:{start:'07:00:00',end:'09:00:00'},pm:{start:'16:00:00',end:'18:00:00'}},segments:[{route_id:'r',agency_id:'a',geometry:[[24,60],[24.01,60.01]],profiles:{am:{display_tph:4,forward_tph:6,backward_tph:4,quality:'scheduled'},pm:{display_tph:0,forward_tph:0,backward_tph:0,quality:'scheduled'}}}]};

function compare(feed,time=now){
  const original=structuredClone(feed);
  for(const summaryOnly of [false,true]){
    const a=structuredClone(feed),b=structuredClone(feed);
    assert.deepEqual(candidate([b],time,{summaryOnly}),control([a],time,{summaryOnly}));
    assert.deepEqual(a,original);assert.deepEqual(b,original);
  }
  assert.deepEqual(candidate([feed],time,{summaryOnly:true}),{summary:control([feed],time).summary});
}
const variants={
  ordinary:()=>{},
  zero_rate:f=>{for(const p of Object.values(f.segments[0].profiles))p.display_tph=0;},
  null_rates:f=>{for(const p of Object.values(f.segments[0].profiles))p.display_tph=null;},
  missing_rate:f=>{delete f.segments[0].profiles.am.display_tph;},
  empty_profiles:f=>{f.segments[0].profiles={};},
  absent_geometry:f=>{delete f.segments[0].geometry;},
  short_geometry:f=>{f.segments[0].geometry=[[24,60]];},
  empty_segments:f=>{f.segments=[];},
  route_expired:f=>{f.routes[0].valid_until=now/1000-1;},
  segment_expired:f=>{f.segments[0].valid_until=now/1000-1;},
  feed_expired:f=>{f.source.valid_until=now/1000-1;},
  boundary_equal:f=>{f.segments[0].valid_until=now/1000;},
  review_expired:f=>{f.source.retrieved='2026-01-01';},
  checked_refresh:f=>{f.source.retrieved='2026-01-01';f.source.checked='2026-10-03';},
  repeated_route:f=>{f.segments.push(structuredClone(f.segments[0]));},
  invalid_colour:f=>{f.routes[0].route_color='not-a-colour';},
  fallback_name:f=>{delete f.routes[0].route_long_name;delete f.routes[0].route_short_name;},
};
for(const [name,change] of Object.entries(variants))test('unchanged full/summary JSON semantics: '+name,()=>{const f=structuredClone(base);change(f);compare(f);});
for(const type of [0,2,5,7,12,405,1400])test('full rendering and summary type '+type,()=>{const f=structuredClone(base);f.routes[0].route_type=String(type);compare(f);});
const broken={missing_route:f=>{f.routes=[];},missing_agency:f=>{f.agencies=[];},null_segment_profiles:f=>{f.segments[0].profiles=null;},late_null_profile:f=>{f.segments[0].profiles.late=null;},null_feed_profiles:f=>{f.profiles=null;},missing_window_start:f=>{delete f.profiles.am.start;},missing_window_end:f=>{delete f.profiles.am.end;}};
for(const [name,change] of Object.entries(broken))test('same validation error: '+name,()=>{const f=structuredClone(base);change(f);for(const summaryOnly of [false,true]){let a,b;try{control([structuredClone(f)],now,{summaryOnly});}catch(e){a=e;}try{candidate([structuredClone(f)],now,{summaryOnly});}catch(e){b=e;}assert.ok(a);assert.ok(b);assert.equal(b.constructor,a.constructor);assert.equal(b.message,a.message);}});
test('empty feed collection unchanged',()=>{for(const summaryOnly of [false,true])assert.deepEqual(candidate([],now,{summaryOnly}),control([],now,{summaryOnly}));});

test('invalid feed windows remain unevaluated for empty or entirely unmapped feeds',()=>{
  for(const segments of [[],[{...base.segments[0],geometry:null}],[{...base.segments[0],geometry:[[24,60]]}]]){
    const f=structuredClone(base);f.profiles=null;f.segments=structuredClone(segments);compare(f);
  }
});
test('valid empty window string remains valid across repeated segments',()=>{
  const f=structuredClone(base);f.profiles={};f.segments.push(structuredClone(f.segments[0]));compare(f);
});
test('first mapped segment still evaluates malformed windows after skipped geometry',()=>{
  const f=structuredClone(base);f.profiles.am.start=null;f.segments.unshift({...structuredClone(f.segments[0]),geometry:null});
  for(const summaryOnly of [false,true]){
    let a,b;try{control([structuredClone(f)],now,{summaryOnly});}catch(e){a=e;}
    try{candidate([structuredClone(f)],now,{summaryOnly});}catch(e){b=e;}
    assert.ok(a);assert.equal(b?.constructor,a.constructor);assert.equal(b?.message,a.message);
  }
});
test('route and segment-profile errors still precede malformed feed windows',()=>{
  for(const mode of ['route','agency','segment-profile']){
    const f=structuredClone(base);f.profiles.am.start=null;
    if(mode==='route')f.routes=[];if(mode==='agency')f.agencies=[];if(mode==='segment-profile')f.segments[0].profiles=null;
    for(const summaryOnly of [false,true]){
      let a,b;try{control([structuredClone(f)],now,{summaryOnly});}catch(e){a=e;}
      try{candidate([structuredClone(f)],now,{summaryOnly});}catch(e){b=e;}
      assert.ok(a);assert.equal(b?.constructor,a.constructor);assert.equal(b?.message,a.message);
    }
  }
});
test('later segment validation is not bypassed by an initialized window cache',()=>{
  const f=structuredClone(base);f.segments.push({...structuredClone(f.segments[0]),profiles:null});
  for(const summaryOnly of [false,true]){
    let a,b;try{control([structuredClone(f)],now,{summaryOnly});}catch(e){a=e;}
    try{candidate([structuredClone(f)],now,{summaryOnly});}catch(e){b=e;}
    assert.ok(a);assert.equal(b?.constructor,a.constructor);assert.equal(b?.message,a.message);
  }
});
test('multiple feeds reset window cache and retain agency timezone text',()=>{
  const a=structuredClone(base),b=structuredClone(base);b.source.id='second';b.profiles.am={start:'10:15:00',end:'11:45:00'};b.agencies[0].agency_timezone='America/New_York';
  for(const summaryOnly of [false,true])assert.deepEqual(candidate([structuredClone(a),structuredClone(b)],now,{summaryOnly}),control([structuredClone(a),structuredClone(b)],now,{summaryOnly}));
});
