import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFile} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {RAIL_OUTAGE_STATUS,railOutageReady,stationLanguageStyleReady} from '../scripts/rail-fixture-readiness.mjs';
import {waitUntil} from '../scripts/wait-until.mjs';
import {plan} from '../scripts/ci-plan.mjs';

// Compact replay of the two failed canonical tiles in run 38807776095,
// artifact 12007769581. No provider data or browser output archive is needed.
const failure=(x,changes={})=>({type:'error',sourceId:'railway',tileState:'errored',
  coordinate:{z:7,x,y:52,key:x===104?'57s77':'57t77'},...changes});
const failures=()=>[failure(104),failure(105)];
const outage=({text=RAIL_OUTAGE_STATUS,error=true,present=true,events=failures()}={})=>
  runInNewContext(`(${railOutageReady.toString()})(expectedStatus)`,{expectedStatus:RAIL_OUTAGE_STATUS,
    window:{recoveryEvents:events},document:{getElementById:id=>id==='map-status'&&present?
      {textContent:text,classList:{contains:name=>name==='error'&&error}}:null}});
const language=(map,target='fr')=>runInNewContext(`(${stationLanguageStyleReady.toString()})(target)`,{window:{stationMap:map},target});
const mapFor=(style,loaded=true)=>({getStyle:()=>style,isStyleLoaded:()=>loaded});
const styleFor=code=>({sources:{openmaptiles:{url:`atlasbase://${code}/fixture.pmtiles`}}});

test('current retry warning and two real canonical errors satisfy the serialized outage gate',()=>{
  assert.equal(outage(),true);
  assert.equal(outage({events:[{type:'sourcedata',sourceId:'pendingRecovery',isSourceLoaded:false},...failures()]}),true);
  assert.equal(RAIL_OUTAGE_STATUS,'OpenRailwayMap railway data unavailable. Retrying failed tiles. Independent map references remain where available; detail may be missing.');
});

test('healthy, generic, nonretryable and stale warnings cannot satisfy the outage gate',()=>{
  for(const text of ['Explore the rail network · click a line or station',
    'Some map data could not load. Check your connection or reload to retry.',
    RAIL_OUTAGE_STATUS.replace('Retrying failed tiles. ',''),
    RAIL_OUTAGE_STATUS.replace('Retrying failed tiles','Retrying automatically'),
    RAIL_OUTAGE_STATUS.replace('railway data','station data'),'prefix '+RAIL_OUTAGE_STATUS,RAIL_OUTAGE_STATUS+' suffix'])
    assert.equal(outage({text}),false,text);
  assert.equal(outage({error:false}),false);
  assert.equal(outage({present:false}),false);
});

test('outage gate requires distinct actual railway canonical coordinates',()=>{
  for(const events of [[],[failure(104)],[failure(104),failure(104)],
    [failure(104),failure(104,{coordinate:{z:7,x:104,y:52,key:'different runtime key'}})],
    [failure(104),failure(105,{coordinate:undefined})],
    [failure(104),failure(105,{coordinate:{z:7,x:'105',y:52}})],
    [failure(104),failure(105,{coordinate:{z:7,x:105,y:NaN}})],
    [failure(104),failure(105,{sourceId:'stations'})],
    [failure(104),failure(105,{type:'sourcedata',tileState:'loaded'})]])
    assert.equal(outage({events}),false,JSON.stringify(events));
  assert.equal(outage({events:null}),false);
});

test('language readiness safely waits through absent style and incomplete target sources',()=>{
  assert.equal(language(undefined),false);
  for(const style of [undefined,null,{}, {sources:undefined},{sources:{}},
    {sources:{openmaptiles:{}}},{sources:{openmaptiles:{url:null}}},{sources:{openmaptiles:{url:42}}}])
    assert.equal(language(mapFor(style)),false);
  assert.equal(language(mapFor(styleFor('fr'),false)),false,'target source alone is not style readiness');
});

test('language readiness requires the actual requested localized style',()=>{
  for(const target of ['fr','en']) {
    assert.equal(language(mapFor(styleFor(target)),target),true);
    assert.equal(language(mapFor(styleFor(target==='fr'?'en':'fr')),target),false,'previous language is stale');
    assert.equal(language(mapFor(styleFor(target+'-CA')),target),false,'language prefix is insufficient');
    assert.equal(language(mapFor({sources:{openmaptiles:{url:'https://example.invalid/'+target}}}),target),false);
  }
});

test('language polling survives style replacement and still times out for a stale target',async()=>{
  const sequence=[mapFor(styleFor('en')),mapFor(undefined),mapFor({sources:{}}),
    mapFor(styleFor('fr'),false),mapFor(styleFor('fr'))];
  let calls=0;
  const page={evaluate:async(fn,target)=>{
    calls++;
    return runInNewContext(`(${fn.toString()})(target)`,{window:{stationMap:sequence.shift()},target});
  }};
  assert.equal(await waitUntil(page,stationLanguageStyleReady,'fr',{timeout:1000,polling:1}),true);
  assert.equal(calls,5,'all intermediate states must wait');
  await assert.rejects(waitUntil({evaluate:async()=>language(mapFor(styleFor('en')))},
    stationLanguageStyleReady,'fr',{timeout:20,polling:1}),/Timed out after 20 ms/);
});

test('browser checks bind the tested predicates and preserve recovery, language and no-idle assertions',async()=>{
  const rail=await readFile(new URL('../scripts/rail-recovery-browser-fixture.mjs',import.meta.url),'utf8');
  assert.match(rail,/page\.waitForFunction\(railOutageReady,RAIL_OUTAGE_STATUS,\{timeout:30000\}\)/);
  assert.match(rail,/assert\.equal\(settings\.status,RAIL_OUTAGE_STATUS\)/);
  assert.match(rail,/assert\.equal\(partial\.status,RAIL_OUTAGE_STATUS\)/);
  for(const evidence of ["assert.equal(partial.error,true", "assert.equal(partial.pending,true)",
    "assert.equal(after.pending,true", "assert.equal(after.loaded,false", "assert.ok(after.rails>0",
    "e.type==='sourcedata'&&e.sourceId==='railway'&&e.tileState==='loaded'",
    "e.coordinate?.z===z&&e.coordinate?.x===x&&e.coordinate?.y===y",
    "e.type==='idle'&&e.at>=before.at", "e.type==='moveend'&&e.at>=settings.at"])
    assert.ok(rail.includes(evidence),evidence);
  const station=await readFile(new URL('../scripts/check-station-fallback-browser.mjs',import.meta.url),'utf8');
  assert.match(station,/page\.waitForFunction\(stationLanguageStyleReady,language,\{timeout:30000\}\)/);
  assert.ok(station.includes("for(const language of ['fr','en','fr'])"));
  assert.match(station,/await page\.waitForFunction\(stationLanguageStyleReady[^\n]+\n  await check\(\)/);
  assert.ok(station.includes("f.properties.atlas_name===name"));
  assert.ok(station.includes("assert.ok(report.names.some(f=>f.name===(language==='fr'?'Gare témoin':'Fixture station'))"));
  assert.ok(station.includes('assert.deepEqual(errors,[])'),'page errors remain fatal');
});

test('the shared readiness helper selects all three affected fixture checks in CI',()=>{
  const read=path=>{
    const url=new URL('../'+path,import.meta.url);
    return existsSync(url)?readFileSync(url,'utf8'):null;
  };
  assert.deepEqual(plan(['scripts/rail-fixture-readiness.mjs'],read).groups,[{
    group:'rail-fixture',checks:['check-deployed-fixture-browser.mjs','check-orm-fixture-browser.mjs','check-station-fallback-browser.mjs'],
  }]);
});
