import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createExpression,validateStyleMin} from '@maplibre/maplibre-gl-style-spec';
import {frequencyWidth,matchHeadway,frequencyBundle,serviceFrequencyPaint,frequencyOffset,frequencyDetails,nearestServiceFeature} from '../styles/service-frequency.mjs';
import {readSettings,settingsQuery} from '../styles/map-model.mjs';
const catalog=JSON.parse(await readFile(new URL('../styles/service-headways.json',import.meta.url)));
const now=Date.parse('2026-10-05T12:00:00Z'),line=[[[114.12,22.28],[114.13,22.29]]];
const route=ref=>({ref,network:'港鐵 MTR',kind:'subway'});
const evaluate=(expression,properties,zoom=12)=>{
  const result=createExpression(expression);assert.equal(result.result,'success',JSON.stringify(result.value));
  return result.value.evaluate({zoom},{type:2,properties});
};

test('published data keeps all rows, ranges and unmapped branches',()=>{
  assert.equal(catalog.routes.length,28);assert.equal(catalog.routes.filter(r=>r.match).length,17);
  const isl=matchHeadway(route('ISL'),line,catalog);
  assert.deepEqual(isl.profiles.am.minutes,[1.9,1.9]);assert.deepEqual(isl.profiles.offpeak.minutes,[3.6,5]);
  assert.equal(matchHeadway(route('KTL'),line,catalog),null,'section rates cannot cover all of KTL');
  assert.equal(matchHeadway({...route('ISL'),network:'Other Metro'},line,catalog),null);
  assert.equal(matchHeadway(route('ISL'),[[[0,51],[.1,51.1]]],catalog),null,'network/ref collision outside source geography');
});

test('shared scale keeps equal rates equal across profiles and separates unknown',()=>{
  assert.equal(frequencyWidth(12),4);assert.equal(frequencyWidth(24),5);assert.equal(frequencyWidth(100),5.5);
  assert.equal(frequencyWidth(null),3.5);assert.equal(frequencyWidth(0),1.5);
  const copy=structuredClone(catalog);copy.routes.find(r=>r.match?.ref==='ISL').profiles.am.minutes=[5,5];
  const p=frequencyBundle([route('ISL')],line,copy)[0];
  assert.equal(p.frequency_width_am,p.frequency_width_offpeak);
  copy.routes.find(r=>r.match?.ref==='ISL').profiles.am.minutes=null;
  const missing=frequencyBundle([route('ISL')],line,copy)[0];
  assert.equal(missing.frequency_am,undefined);assert.equal(missing.frequency_offpeak,12);
  assert.equal(frequencyDetails(missing,'am',now),null);
});

test('paint, label placement and hit selection share the changed bundle geometry',()=>{
  const bundle=frequencyBundle([route('ISL'),route('TWL'),route('KTL')],line,catalog).map((p,i)=>({...p,i,n:3,slot:2*i-2}));
  for(const profile of ['am','pm','offpeak']){
    const settings={serviceWidth:'frequency',frequencyPeriod:profile==='offpeak'?'offpeak':'peak',peakPhase:profile};
    const paint=serviceFrequencyPaint(settings,now);
    bundle.forEach(p=>{
      assert.equal(evaluate(paint.width,p),p[`frequency_width_${profile}`]);
      assert.equal(evaluate(paint.offset,p),frequencyOffset(p,12,settings,now));
      assert.deepEqual(evaluate(paint.labelOffset,p),[0,p[`frequency_label_${profile}`]*.25*1.3/3.5]);
    });
    for(let i=1;i<bundle.length;i++)assert.ok(bundle[i][`frequency_offset_${profile}`]-bundle[i-1][`frequency_offset_${profile}`]>=(bundle[i][`frequency_width_${profile}`]+bundle[i-1][`frequency_width_${profile}`])/2+.49999);
  }
  assert.notEqual(bundle[0].frequency_offset_am,bundle[0].frequency_offset_offpeak);
});

test('old tiles and stale sources keep unknown distinct from zero and preserve equal mode',()=>{
  const old={i:0,n:2,slot:-1},settings={serviceWidth:'frequency',frequencyPeriod:'peak',peakPhase:'am'};
  const unknown=serviceFrequencyPaint(settings,now);
  assert.equal(evaluate(unknown.width,old),3.5);assert.equal(evaluate(unknown.opacity,old),.45);
  const p={...frequencyBundle([route('ISL')],line,catalog)[0],...old};
  const later=Date.parse('2026-11-04T00:00:00Z'),stale=serviceFrequencyPaint(settings,later);
  assert.equal(evaluate(stale.width,p),3.5);assert.equal(evaluate(stale.opacity,p),.45);assert.equal(frequencyDetails(p,'am',later),null);
  const equal=serviceFrequencyPaint({serviceWidth:'equal'},now);
  assert.equal(evaluate(equal.opacity,p),1);assert.equal(evaluate(equal.width,p),3.5);assert.equal(evaluate(equal.offset,p),-1.75);
});

test('all profile styles validate against the pinned MapLibre specification',async()=>{
  const style=JSON.parse(await readFile(new URL('../styles/world.style.json',import.meta.url)));
  for(const profile of ['am','pm','offpeak']){
    const p=serviceFrequencyPaint({serviceWidth:'frequency',frequencyPeriod:profile==='offpeak'?'offpeak':'peak',peakPhase:profile},now);
    Object.assign(style.layers.find(l=>l.id==='service-routes').paint,{'line-width':p.width,'line-offset':p.offset,'line-opacity':p.opacity});
    style.layers.find(l=>l.id==='service-names').layout['text-offset']=p.labelOffset;
    assert.deepEqual(validateStyleMin(style).map(e=>e.message),[]);
  }
});

test('profile selection round trips through settings and shared links',()=>{
  const settings=readSettings('?mode=service&serviceWidth=frequency&frequencyPeriod=peak&peakPhase=pm');
  assert.equal(settings.serviceWidth,'frequency');assert.equal(settings.frequencyPeriod,'peak');assert.equal(settings.peakPhase,'pm');
  assert.deepEqual(readSettings('?'+settingsQuery(settings)),settings);
  assert.equal(readSettings('').serviceWidth,'equal');
  assert.equal(readSettings('?peakPhase=invalid').peakPhase,'am');
});

test('route clicks select the visible line after a profile changes its bundle position',()=>{
  const props=frequencyBundle([route('ISL'),route('TWL'),route('KTL')],line,catalog);
  const features=props.map((p,i)=>({properties:{...p,i,n:3},geometry:{type:'LineString',coordinates:[[0,0],[100,0]]}}));
  for(const profile of ['am','pm','offpeak']){
    const settings={serviceWidth:'frequency',frequencyPeriod:profile==='offpeak'?'offpeak':'peak',peakPhase:profile};
    for(const f of features){
      const point={x:50,y:frequencyOffset(f.properties,12,settings,now)};
      assert.equal(nearestServiceFeature([...features].reverse(),point,p=>({x:p[0],y:p[1]}),12,settings,now),f);
    }
  }
});
