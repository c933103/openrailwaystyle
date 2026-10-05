import test from 'node:test';
import assert from 'node:assert/strict';
import encode from 'vt-pbf';
import {readTile,localizeTile,installLabelProtocols, timedSource,hanRegion,chineseArea,glyphRequestURL} from '../styles/tile-labels.mjs';
import {chooseName,readSettings,stationLanguages,stationPending,labelExpression} from '../styles/map-model.mjs';

// Tiles give every feature its Han-name region; tests state it explicitly.
const at=(p,zone='cjkv')=>({...p,atlas_han:zone});
test('explicit CJK font stacks preserve and share the original Latin glyph download',async()=>{
 const url=stack=>`atlasglyph://https://example.org/fonts/${encodeURIComponent(stack)}/0-255.pbf`,protocols={},requests=[];
 assert.equal(glyphRequestURL(url('Noto Sans Bold,Atlas CJK TC')),'https://example.org/fonts/Noto%20Sans%20Bold/0-255.pbf');
 assert.equal(glyphRequestURL(url('Noto Sans Regular,Atlas CJK SC')),'https://example.org/fonts/Noto%20Sans%20Regular/0-255.pbf');
 installLabelProtocols({addProtocol:(id,fn)=>protocols[id]=fn},{},async address=>{requests.push(address);return {ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};});
 const a=await protocols.atlasglyph({url:url('Noto Sans Bold,Atlas CJK TC')},new AbortController()),b=await protocols.atlasglyph({url:url('Noto Sans Bold,Atlas CJK SC')},new AbortController());
 assert.deepEqual([...new Uint8Array(a.data)],[1,2,3]);assert.deepEqual([...new Uint8Array(b.data)],[1,2,3]);assert.equal(requests.length,1,'script changes reuse the provider glyph cache');
});
test('language fallbacks prefer English, Cyrillic, Hanja, Nôm and ordinary Japanese as requested',()=>{
  const korea=at({name:'진주','name:en':'Jinju','name:ko-Hani':'晉州'});
  for(const lang of ['en','fr','de','es','ru']) assert.equal(chooseName(korea,lang),'Jinju');
  for(const lang of ['zh-Hans','zh-Hant','ja']) assert.equal(chooseName(korea,lang),'晉州');
  assert.equal(chooseName({...korea,'name:ru':'Чинджу'},'ru'),'Чинджу');
  assert.equal(chooseName(at({name:'Київ','name:en':'Kyiv'},'none'),'ru'),'Київ');
  assert.equal(chooseName(at({name:'Москва','name:en':'Moscow'},'none'),'fr'),'Moscow');
  assert.equal(chooseName(at({name:'東海道新幹線','name:en':'Tokaido Shinkansen'}),'zh-Hant'),'東海道新幹線');
  assert.equal(chooseName(at({name:'とうきょう','name:ja':'とうきょう','name:zh':'東京','name:en':'Tokyo'}),'ja'),'東京');
  assert.equal(chooseName(at({name:'Hà Nội','name:vi-Hani':'河內','name:en':'Hanoi'}),'zh-Hans'),'河內');
  assert.equal(chooseName(at({name:'test','name:vi-Hani':'𡗶','name:en':'English'}),'zh-Hant'),'𡗶');
  assert.equal(chooseName({...korea,'name:fr':'','name:en':''},'fr'),'진주');
  assert.equal(chooseName(korea,'local'),'진주');
  assert.equal(chooseName(korea,'ko'),'진주','English fetched for another station must not replace available native Korean');
  assert.equal(chooseName(at({name:'つくば','name:en':'Tsukuba'}),'ja'),'つくば');
  assert.equal(readSettings('?stationLanguage=ko').language,'ko');
  assert.equal(readSettings('?language=ru&stationLanguage=ko').language,'ru');
});
const tile=properties=>encode.fromGeojsonVt({stations:{features:[{id:42,type:1,geometry:[[2048,1024]],tags:{id:42,...properties}}]}},{version:2});
test('localization preserves geometry, identifiers, layers and unrelated properties',()=>{
  const bytes=tile({name:'진주','name:en':'Jinju',maxspeed:160});
  const before=readTile(bytes).layers.stations.feature(0);
  const after=readTile(localizeTile(bytes,'fr',{z:7,x:109,y:50})).layers.stations.feature(0);
  assert.equal(after.properties.atlas_name,'Jinju');
  assert.equal(after.properties.atlas_han,'cjkv','z7 tile 109/50 covers southern Korea');
  const logged=[],error=console.error;console.error=(...args)=>logged.push(args.join(' '));
  try { assert.equal(localizeTile(bytes,'fr'),bytes,'a tile without a location keeps its source names'); }
  finally { console.error=error; }
  assert.match(logged.join('\n'),/Map labels unavailable: Label tile has no z\/x\/y coordinates/);
  assert.equal(after.properties.maxspeed,160);
  assert.equal(after.id,before.id);assert.equal(after.type,before.type);
  assert.deepEqual(after.loadGeometry(),before.loadGeometry());
});
test('station protocol fetches English fallback and Hanja from actual translation responses',async()=>{
  const protocols={},requests=[];
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},{},async url=>{
    const lang=new URL(url).searchParams.get('lang');requests.push(lang);
    return {ok:true,arrayBuffer:async()=>tile({name:'진주',localized_name:({'ko-Hani':'晉州',en:'Jinju'})[lang]||'진주'})};
  });
  for(const [lang,expected] of [['fr','Jinju'],['ru','Jinju'],['zh-Hant','晉州']]) {
    const result=await protocols.atlasstation({url:`atlasstation://${lang}/https://example.org/stations/7/109/50`},new AbortController());
    assert.equal(readTile(result.data).layers.stations.feature(0).properties.atlas_name,expected);
  }
  assert.ok(requests.includes('en'));assert.ok(requests.includes('ko-Hani'));
  assert.equal(requests.filter(x=>x==='en').length,1,'Successful fallback tiles should be reused across language changes');
});
test('Han regions: Chinese and Japanese in CJKV; Chinese only in Singapore, Malaysia and the Russian Far East',()=>{
  const places={
    cjkv:[[139.77,35.68],[135.24,34.43],[126.97,37.55],[125.75,39.03],[105.84,21.02],[114.17,22.30],[113.54,22.19],[121.52,25.05],[87.6,43.8],[127.47,50.22]],
    zh:[[103.85,1.29],[103.76,1.46],[101.69,3.14],[116.07,5.98],[131.88,43.11],[130.69,42.43],[127.51,50.28],[117.33,49.64],[113.5,52.03],[129.73,62.03],[142.74,46.96],[177.5,64.73],[-172,66]],
    none:[[104.28,52.29],[106.9,47.9],[111.9,43.72],[102.6,17.97],[100.5,13.75],[104.03,1.13],[114.94,4.89],[76.9,43.2],[13.4,52.5],[-74,40.7],[-165.4,64.5]],
  };
  for(const [zone,points] of Object.entries(places)) for(const [lon,lat] of points) assert.equal(hanRegion(lon,lat),zone,`${lon},${lat}`);
  // Sea within 12 nautical miles goes to the nearest land: the Seikan Tunnel
  // under the Tsugaru Strait, but never Batam, 20 km from Singapore, or Kep,
  // 20 km from Phu Quoc.
  for(const [lon,lat] of [[140.34,41.30],[140.30,41.38],[130.93,33.96]]) assert.equal(hanRegion(lon,lat),'cjkv',`${lon},${lat}`);
  for(const [lon,lat] of [[104.03,1.13],[104.32,10.48],[101.4,20.95]]) assert.equal(hanRegion(lon,lat),'none',`${lon},${lat}`);
  // Chinese-speaking Kokang, Wa State (north: Pangkham, beside the Chinese
  // border; south: Wan Hong), Mong La and Mae Fa Luang (Santikhiri, Thoet Thai).
  // Centres of Pangkham, Wan Hong and Mong La are their OSM admin-centre nodes.
  for(const [lon,lat] of [[98.76,23.70],[99.1668,22.1788],[99.2962,20.4387],[100.0223,21.6762],[99.62,20.16],[99.72,20.26]]) assert.equal(hanRegion(lon,lat),'zh',`${lon},${lat}`);
  for(const [lon,lat] of [[97.75,22.94],[99.6,21.29],[99.83,19.91],[98.98,18.79]]) assert.equal(hanRegion(lon,lat),'none',`${lon},${lat}`);
  const vladivostok={name:'Владивосток','name:en':'Vladivostok','name:ja':'浦塩','name:ko-Hani':'海蔘威'};
  for(const lang of ['zh-Hant','zh-Hans']) {
    assert.equal(chooseName(at(vladivostok,'zh'),lang),'浦塩','Chinese labels borrow Han names in the Russian Far East');
    assert.equal(chooseName(at({...vladivostok,name:'Berlin'},'none'),lang),'Vladivostok');
  }
  assert.equal(chooseName(at({...vladivostok,'name:ja':'','name:zh':'海参崴'},'zh'),'ja'),'Vladivostok','Japanese labels do not borrow outside CJKV');
  assert.equal(chooseName(at({name:'Kuala Lumpur','name:ko-Hani':'吉隆坡'},'zh'),'zh-Hant'),'吉隆坡');
  assert.equal(chooseName(at({name:'Kuala Lumpur','name:zh':'吉隆坡'},'zh'),'ja'),'Kuala Lumpur');
  assert.equal(chooseName({...vladivostok,'name:ja':''},'ja'),'Vladivostok','a feature without a region borrows nothing');
  assert.equal(chooseName(at({...vladivostok,'name:zh':'符拉迪沃斯托克'},'none'),'zh-Hans'),'符拉迪沃斯托克','recorded Chinese names remain available');
  assert.equal(chooseName(at({...vladivostok,'name:ja':'ウラジオストク'},'zh'),'ja'),'ウラジオストク');
  assert.deepEqual(stationLanguages('zh-Hant',false),['zh-Hant','zh','zh-Hans','zh-TW','zh-HK','zh-CN','en']);
  assert.deepEqual(stationLanguages('zh-Hans',false),['zh-Hans','zh','zh-Hant','zh-CN','zh-TW','zh-HK','en']);
  assert.deepEqual(stationLanguages('ja',false),['ja','en']);
});
test('Chinese labels always fall back to the other script before English, in every region',()=>{
  for(const zone of ['cjkv','zh','none',undefined]) {
    assert.equal(chooseName(at({name:'Berlin Hbf','name:en':'Berlin Central','name:zh':'柏林中央车站'},zone),'zh-Hant'),'柏林中央车站',`zh-Hant uses name:zh in ${zone}`);
    assert.equal(chooseName(at({name:'Wien','name:en':'Vienna','name:zh-Hant':'維也納'},zone),'zh-Hans'),'維也納',`zh-Hans uses zh-Hant in ${zone}`);
    assert.equal(chooseName(at({name:'Wien','name:en':'Vienna','name:zh-Hans':'维也纳'},zone),'zh-Hant'),'维也纳',`zh-Hant uses zh-Hans in ${zone}`);
    assert.equal(chooseName(at({name:'Wien','name:en':'Vienna','name:zh-Hans':'维也纳','name:zh-Hant':'維也納'},zone),'zh-Hant'),'維也納','the requested script wins when recorded');
  }
  for(const lang of ['zh-Hant','zh-Hans']) {
    const keys=labelExpression(lang).filter(x=>Array.isArray(x)&&x[0]==='to-string').map(x=>x[1][1]);
    assert.ok(keys.indexOf('name:zh-Hant')>0 && keys.indexOf('name:zh-Hans')>0 && keys.indexOf('name:zh')>0,'style fallback includes every Chinese key');
    assert.ok(Math.max(keys.indexOf('name:zh-Hant'),keys.indexOf('name:zh-Hans'),keys.indexOf('name:zh'))<keys.indexOf('name:en'),'Chinese keys come before English');
    assert.equal(keys[1],`name:${lang}`,'the requested script comes first');
  }
});
test('Chinese areas: mainland China, Taiwan, Hong Kong and Macau',()=>{
  const places={
    CN:[[116.4,39.9],[121.47,31.23],[87.6,43.8],[127.47,50.22],[91.1,29.65],[109.5,18.25],[114.12,22.545],[114.055,22.536],[113.549,22.217],[124.39,40.13],[118.315,24.556],[118.1,24.48],[119.88,26.33],[119.13,25.06],[110.2,20.1],[106.75,22.1],[117.43,49.6],[112.33,16.83]],
    TW:[[121.52,25.05],[120.3,22.62],[118.32,24.44],[119.57,23.57],[119.94,26.155],[119.99,26.22],[120.49,26.37],[119.98,25.955],[119.94,25.973],[118.24,24.43],[119.467,24.986],[116.72,20.7],[114.366,10.377],[118.2,24.44]],
    HK:[[114.18,22.30],[114.113,22.528],[114.066,22.514],[113.92,22.31]],
    MO:[[113.54,22.19],[113.56,22.14],[113.545,22.125]],
    '':[[126.97,37.55],[139.77,35.68],[105.84,21.02],[106.9,47.9],[127.53,50.27],[124.40,40.10],[103.85,1.29],[13.4,52.5]],
  };
  for(const [area,points] of Object.entries(places)) for(const [lon,lat] of points) assert.equal(chineseArea(lon,lat),area,`${lon},${lat}`);
  const pratas=readTile(localizeTile(tile({name:'東沙'}),'zh-Hant',{z:10,x:844,y:451})).layers.stations.feature(0).properties;
  assert.deepEqual([pratas.atlas_han,pratas.atlas_zh],['cjkv','TW'],'Pratas is in the Han region although Natural Earth omits it');
  const after=readTile(localizeTile(tile({name:'臺北'}),'zh-Hans',{z:12,x:3430,y:1753})).layers.stations.feature(0);
  assert.equal(after.properties.atlas_zh,'TW','z12 tile 3430/1753 covers Taipei');
});
const zh=(p,area)=>({...p,atlas_han:area?'cjkv':'none',atlas_zh:area||''});
test('Chinese keys are read by region; the other script and regional names stay fallbacks',()=>{
  assert.equal(chooseName(zh({name:'Paris','name:zh-HK':'巴黎（港）','name:zh-TW':'巴黎（臺）','name:zh-Hans':'巴黎（简）'}),'zh-Hant'),'巴黎（臺）','Taiwan wording before Hong Kong wording, both before the other script');
  assert.equal(chooseName(zh({name:'Paris','name:zh-CN':'巴黎（中）','name:zh-Hant':'巴黎（繁）'}),'zh-Hans'),'巴黎（中）','Simplified regional wording before Traditional');
  assert.equal(chooseName(zh({name:'Paris','name:zh-TW':'巴黎（臺）'}),'zh-Hans'),'巴黎（臺）','Simplified falls back to Traditional before English');
  // Taiwan: the local name is Traditional.
  const taipei={name:'臺北','name:zh':'台北','name:zh-Hans':'台北（简）','name:zh-Hant':'臺北（繁）'};
  assert.equal(chooseName(zh(taipei,'TW'),'zh-Hant'),'臺北');
  assert.equal(chooseName(zh(taipei,'TW'),'zh-Hans'),'台北（简）');
  assert.equal(chooseName(zh({name:'臺北','name:zh-TW':'臺北（臺）'},'TW'),'zh-Hans'),'臺北','Taiwan: the local name before Traditional tags for Simplified');
  // Hong Kong and Macau: name is multilingual; name:zh holds the local Chinese name.
  const hunghom={name:'紅磡 Hung Hom','name:en':'Hung Hom','name:zh':'紅磡','name:zh-TW':'紅磡（臺）','name:zh-Hans':'红磡'};
  assert.equal(chooseName(zh(hunghom,'HK'),'zh-Hant'),'紅磡');
  assert.equal(chooseName(zh(hunghom,'MO'),'zh-Hant'),'紅磡');
  assert.equal(chooseName(zh(hunghom,'HK'),'zh-Hans'),'红磡');
  assert.equal(chooseName(zh({...hunghom,'name:zh':'','name:zh-HK':'紅磡（港）'},'HK'),'zh-Hant'),'紅磡（港）','Hong Kong wording before Taiwan wording in Hong Kong');
  assert.equal(chooseName(zh({...hunghom,'name:zh':'','name:zh-TW':'','name:zh-Hans':''},'HK'),'zh-Hans'),'紅磡 Hung Hom','Hong Kong: the multilingual local name comes last, before English');
  assert.equal(chooseName(zh({name:'KFC','name:en':'KFC','name:ja':'ケンタッキー・フライド・チキン','name:ko-Hani':'肯德基'},'HK'),'zh-Hant'),'KFC','Hong Kong: a local name need not be Chinese');
  assert.equal(chooseName(zh({name:'Sukiya','name:ja':'すき家','name:zh-Hans':'食其家'},'MO'),'zh-Hant'),'Sukiya','the local name ends the list; the other script is not reached');
  assert.equal(chooseName(zh({name:'7-Eleven','name:zh':'統一超商'},'TW'),'zh-Hant'),'7-Eleven');
  assert.equal(chooseName(zh({name:'紅磡','name:zh-TW':'紅磡（臺）'},'HK'),'zh-Hant'),'紅磡（臺）','Taiwan wording before the local name in Hong Kong');
  // Mainland China: the local name is Simplified.
  const beijing={name:'北京','name:zh':'北京（中）','name:zh-Hant':'北京（繁）','name:zh-TW':'北京（臺）','name:zh-HK':'北京（港）'};
  assert.equal(chooseName(zh(beijing,'CN'),'zh-Hans'),'北京');
  assert.equal(chooseName(zh(beijing,'CN'),'zh-Hant'),'北京（繁）');
  assert.equal(chooseName(zh({...beijing,'name:zh-Hant':''},'CN'),'zh-Hant'),'北京（臺）','mainland: Traditional regional wording before name:zh');
  assert.equal(chooseName(zh({...beijing,'name:zh-Hant':'','name:zh-TW':'','name:zh-HK':''},'CN'),'zh-Hant'),'北京（中）');
  assert.equal(chooseName(zh({name:'北京'},'CN'),'zh-Hant'),'北京');
});
test('station names fetch only language tags that could still outrank the best known name',()=>{
  const fetched=codes=>new Set(codes);
  assert.deepEqual(stationPending(zh({name:'臺北'},'TW'),'zh-Hant',fetched(['zh-Hant'])),[],'Taiwan: the local name settles Traditional');
  assert.deepEqual(stationPending(zh({name:'北京'},'CN'),'zh-Hant',fetched(['zh-Hant'])),['zh-TW','zh-HK','zh']);
  assert.deepEqual(stationPending(zh({name:'北京','name:zh-TW':'北京（臺）'},'CN'),'zh-Hant',fetched(['zh-Hant','zh-TW'])),[]);
  assert.deepEqual(stationPending(zh({name:'紅磡 Hung Hom'},'HK'),'zh-Hant',fetched(['zh-Hant'])),['zh','zh-HK','zh-TW'],'nothing after the local name is fetched');
  assert.deepEqual(stationPending(zh({name:'Berlin Hbf','name:zh':'柏林'}),'zh-Hant',fetched(['zh-Hant','zh'])),[]);
  assert.deepEqual(stationPending(zh({name:'Berlin Hbf'}),'zh-Hant',fetched(['zh-Hant','zh','zh-Hans','zh-TW','zh-HK','zh-CN','en'])),[]);
});
test('Chinese labels show only the kanji of Japanese "kana (kanji)" and "kanji (kana)" names',()=>{
  assert.equal(chooseName(at({name:'つくば (筑波)','name:en':'Tsukuba'}),'zh-Hant'),'筑波');
  assert.equal(chooseName(at({name:'Tsukuba','name:ja':'さいたま（埼玉）'}),'zh-Hans'),'埼玉');
  assert.equal(chooseName(at({name:'ケーブルやせ (ケーブル八瀬)'}),'zh-Hant'),'ケーブル八瀬');
  assert.equal(chooseName(at({name:'筑波 (つくば)','name:en':'Tsukuba'}),'zh-Hant'),'筑波');
  assert.equal(chooseName(at({name:'霞ケ関（かすみがせき）'}),'zh-Hans'),'霞ケ関');
  assert.equal(chooseName(at({name:'つくば (筑波)'}),'ja'),'つくば (筑波)','Japanese labels keep the kana');
  assert.equal(chooseName(at({name:'筑波 (つくば)'}),'ja'),'筑波 (つくば)');
  assert.equal(chooseName(at({name:'東京 (Tokyo)'}),'zh-Hant'),'東京 (Tokyo)');
});
test('station protocol skips other CJKV languages outside the Han region',async()=>{
  const protocols={},requests=[];
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},{},async url=>{
    const lang=new URL(url).searchParams.get('lang');requests.push(lang);
    return {ok:true,arrayBuffer:async()=>tile({name:'Berlin Hbf',localized_name:({en:'Berlin Central',ja:'ベルリン中央駅','ko-Hani':'伯林'})[lang]||'Berlin Hbf'})};
  });
  // z7 tile 70/41 covers Berlin.
  const result=await protocols.atlasstation({url:'atlasstation://zh-Hant/https://example.org/stations/7/70/41'},new AbortController());
  assert.equal(readTile(result.data).layers.stations.feature(0).properties.atlas_name,'Berlin Central');
  assert.deepEqual(requests,['zh-Hant','zh','zh-Hans','zh-TW','zh-HK','zh-CN','en']);
});
test('PMTiles wrapper localizes bytes and carries language through TileJSON templates',async()=>{
  const protocols={};
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},{tile:async p=>({data:p.type==='json'?{tiles:['pmtiles://https://example.org/world.pmtiles/{z}/{x}/{y}']}:tile({name:'서울','name:en':'Seoul'})})});
  const json=await protocols.atlasbase({url:'atlasbase://fr/https://example.org/world.pmtiles',type:'json'},new AbortController());
  assert.equal(json.data.tiles[0],'atlasbase://fr/https://example.org/world.pmtiles/{z}/{x}/{y}');
  const result=await protocols.atlasbase({url:'atlasbase://fr/https://example.org/world.pmtiles/7/1/1'},new AbortController());
  assert.equal(readTile(result.data).layers.stations.feature(0).properties.atlas_name,'Seoul');
});
test('a failed basemap request starts the archive afresh and is tried again',async()=>{
  const protocols={},calls=[];
  const pmtiles={tiles:new Map([['https://example.org/world.pmtiles',{}]]),tile:async p=>{
    calls.push(p.url);
    if(calls.length===1)throw new TypeError('Failed to fetch');
    return {data:tile({name:'Seoul'})};
  }};
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},pmtiles,fetch,{basemapRetries:[0,0]});
  const result=await protocols.atlasbase({url:'atlasbase://en/https://example.org/world.pmtiles/7/1/1'},new AbortController());
  assert.equal(readTile(result.data).layers.stations.feature(0).properties.atlas_name,'Seoul');
  assert.equal(calls.length,2);
  assert.equal(pmtiles.tiles.has('https://example.org/world.pmtiles'),false,'the cached failure is dropped');
  // Three failures in a row reach the map; a cancelled request is not retried.
  const failing={tiles:new Map(),tile:async()=>{calls.push('x');throw new TypeError('Failed to fetch');}};
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},failing,fetch,{basemapRetries:[0,0]});
  calls.length=0;
  await assert.rejects(protocols.atlasbase({url:'atlasbase://en/https://example.org/world.pmtiles/7/1/1'},new AbortController()),/Failed to fetch/);
  assert.equal(calls.length,3);
  const cancelled=new AbortController();cancelled.abort();calls.length=0;
  await assert.rejects(protocols.atlasbase({url:'atlasbase://en/https://example.org/world.pmtiles/7/1/1'},cancelled));
  assert.equal(calls.length,1);
});
test('basemap requests give up after a while, so a stalled one can be tried again',async()=>{
  // An inner source that answers only when told, or fails when its signal aborts.
  const stalled={getKey:()=>'k',getBytes:(o,l,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))};
  const started=Date.now();
  await assert.rejects(timedSource(stalled,50).getBytes(0,10),/aborted/);
  assert.ok(Date.now()-started>=45,'waited for the timeout');
  const outer=new AbortController();setTimeout(()=>outer.abort(),10);
  await assert.rejects(timedSource(stalled,5000).getBytes(0,10,outer.signal),/aborted/,'a cancelled tile cancels its request');
  const quick={getKey:()=>'k',getBytes:async(o,l,signal)=>({data:new ArrayBuffer(l),aborted:signal.aborted})};
  assert.deepEqual((await timedSource(quick,50).getBytes(0,4)).aborted,false);
  assert.equal(timedSource(quick,50).getKey(),'k');
  // The protocol makes the timed archive, and a fresh one after a failure.
  const protocols={},made=[],pmtiles={tiles:new Map(),tile:async p=>{
    if(made.length===1)throw new DOMException('aborted','AbortError');
    return {data:tile({name:'Seoul'})};
  }};
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},pmtiles,fetch,{basemapRetries:[0,0],basemapArchive:url=>{made.push(url);return {url};}});
  const result=await protocols.atlasbase({url:'atlasbase://en/https://example.org/world.pmtiles/7/1/1'},new AbortController());
  assert.equal(readTile(result.data).layers.stations.feature(0).properties.atlas_name,'Seoul');
  assert.deepEqual(made,['https://example.org/world.pmtiles','https://example.org/world.pmtiles']);
});
test('station TileJSON can be capped by a URL fragment that is never requested',async()=>{
  const protocols={},requests=[];
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},{},async url=>{requests.push(url);return {ok:true,json:async()=>({maxzoom:8,tiles:['https://example.org/med/{z}/{x}/{y}']})};});
  const result=await protocols.atlasstation({url:'atlasstation://en/https://example.org/med#maxzoom=7',type:'json'},new AbortController());
  assert.equal(result.data.maxzoom,7);
  assert.deepEqual(requests,['https://example.org/med']);
  assert.equal(result.data.tiles[0],'atlasstation://en/https://example.org/med/{z}/{x}/{y}');
});
test('tiles below the first zoom of the provider are made from their children',async()=>{
  const protocols={},requests=[];
  // Each zoom-7 child holds one station; the one at 7/2/2 also repeats a
  // neighbour's station in its buffer.
  const child=(id,x,y,extra=[])=>encode.fromGeojsonVt({stations:{features:[{id,type:1,geometry:[[x,y]],tags:{id,name:`S${id}`}},...extra]}},{version:2});
  const tiles={'7/2/2':child(1,1000,1000,[{id:2,type:1,geometry:[[4100,1000]],tags:{id:2,name:'S2'}}]),'7/3/2':child(2,4,1000),'7/2/3':child(3,1000,3000),'7/3/3':child(4,3000,3000),'7/9/9':child(9,10,10)};
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},{},async url=>{
    requests.push(url);
    if(!/\/\d+\/\d+\/\d+/.test(new URL(url).pathname)) return {ok:true,json:async()=>({minzoom:7,maxzoom:8,tiles:['https://example.org/med/{z}/{x}/{y}']})};
    const key=new URL(url).pathname.split('/').slice(-3).join('/');
    return {ok:true,arrayBuffer:async()=>tiles[key]};
  });
  const json=await protocols.atlasstation({url:'atlasstation://local/https://example.org/med#minzoom=6&maxzoom=7&underzoom=7',type:'json'},new AbortController());
  assert.deepEqual([json.data.minzoom,json.data.maxzoom],[6,7]);
  const template=json.data.tiles[0];
  assert.equal(template,'atlasstation://local/https://example.org/med/{z}/{x}/{y}#underzoom=7');
  const result=await protocols.atlasstation({url:template.replace('{z}/{x}/{y}','6/1/1')},new AbortController());
  const layer=readTile(result.data).layers.stations;
  const stations=Array.from({length:layer.length},(_,i)=>layer.feature(i)).map(f=>[f.properties.name,f.loadGeometry()[0][0].x,f.loadGeometry()[0][0].y]).sort();
  assert.deepEqual(stations,[['S1',500,500],['S2',2050,500],['S3',500,3548],['S4',3548,3548]]);
  assert.equal(requests.filter(u=>/\/7\//.test(u)).length,4,'four children, no repeat');
  // At the provider's own zoom the tile is fetched directly.
  requests.length=0;
  await protocols.atlasstation({url:template.replace('{z}/{x}/{y}','7/9/9')},new AbortController());
  assert.deepEqual(requests,['https://example.org/med/7/9/9']);
});



test('a transferred railway tile cannot detach the reusable cache entry',async()=>{
  const protocols={},bytes=Uint8Array.from(tile({name:'Track',tracks:2})).buffer;
  let requests=0;
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},{},async()=>{
    requests++;return {ok:true,arrayBuffer:async()=>bytes.slice(0)};
  });
  const request={url:'atlasrail://https://example.org/railway/14/10/10'};
  const first=await protocols.atlasrail(request,new AbortController());
  const received=structuredClone(first.data,{transfer:[first.data]});
  assert.equal(first.data.byteLength,0,'simulate MapLibre transferring to its worker');
  assert.equal(readTile(received).layers.stations.feature(0).properties.name,'Track');
  const [second,third]=await Promise.all([protocols.atlasrail(request,new AbortController()),protocols.atlasrail(request,new AbortController())]);
  structuredClone(second.data,{transfer:[second.data]});
  assert.equal(readTile(third.data).layers.stations.feature(0).properties.tracks,2);
  assert.equal(requests,1,'language changes and return visits reuse intact cached bytes');
});
test('simultaneous requests for one tile share a single download; it stops only when all are cancelled',async()=>{
  const protocols={},bytes=Uint8Array.from(tile({name:'Track',tracks:2})).buffer,fetches=[];
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},{},(url,{signal})=>new Promise((resolve,reject)=>{
    const fetch={url,signal,finish:()=>resolve({ok:true,arrayBuffer:async()=>bytes.slice(0)})};fetches.push(fetch);
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  }));
  const request={url:'atlasrail://https://example.org/railway/14/10/10'};
  const cancelled=new AbortController(),kept=new AbortController();
  const first=protocols.atlasrail(request,cancelled),second=protocols.atlasrail(request,kept);
  await new Promise(resolve=>setTimeout(resolve));
  assert.equal(fetches.length,1,'the second request waits on the first download');
  cancelled.abort();
  await assert.rejects(first,{name:'AbortError'});
  assert.equal(fetches[0].signal.aborted,false,'another request still wants the tile');
  fetches[0].finish();
  assert.equal(readTile((await second).data).layers.stations.feature(0).properties.tracks,2);
  const other={url:'atlasrail://https://example.org/railway/14/11/10'},gone=new AbortController();
  const lost=protocols.atlasrail(other,gone);
  await new Promise(resolve=>setTimeout(resolve));
  gone.abort();
  await assert.rejects(lost,{name:'AbortError'});
  assert.equal(fetches[1].signal.aborted,true,'nobody wants it any more');
  protocols.atlasrail(other,new AbortController());
  await new Promise(resolve=>setTimeout(resolve));
  assert.equal(fetches.length,3,'a cancelled download is started afresh');
  fetches[2].finish();
});
test('each request waiting on a shared download has its own time limit; a stuck download is not joined',async()=>{
  const protocols={},fetches=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},{},(url,{signal})=>new Promise((resolve,reject)=>{
    fetches.push({signal,finish:()=>resolve({ok:true,arrayBuffer:async()=>Uint8Array.from(tile({name:'Track',tracks:2})).buffer})});
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  }),{timeout:300,tileRetries:[]});
  const request={url:'atlasrail://https://example.org/railway/14/10/10'};
  const first=assert.rejects(protocols.atlasrail(request,new AbortController()),{name:'TimeoutError'});
  await wait(100);
  const second=protocols.atlasrail(request,new AbortController());
  await wait(250);
  await first;
  assert.equal(fetches.length,1,'the second request joined the first download');
  assert.equal(fetches[0].signal.aborted,false,'the second request still has time left');
  const third=protocols.atlasrail(request,new AbortController());
  await wait(0);
  assert.equal(fetches.length,2,'a download older than the limit is treated as stuck');
  fetches[0].finish();fetches[1].finish();
  for(const result of [await second,await third]) assert.equal(readTile(result.data).layers.stations.feature(0).properties.tracks,2);
});
test('a station tile that times out or fails is tried once more; a 4xx answer or a cancelled tile is not',async t=>{
  const protocols={},fetches=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const bytes=()=>Uint8Array.from(tile({name:'Track',tracks:2})).buffer;
  let answers=[];
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},{},(url,{signal})=>new Promise((resolve,reject)=>{
    fetches.push(url);const answer=answers.shift();
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    if(answer==='stuck') return;
    if(answer==='down') reject(new TypeError('Failed to fetch'));
    else if(typeof answer==='number') resolve({ok:false,status:answer});
    else resolve({ok:true,arrayBuffer:async()=>bytes()});
  }),{timeout:200,tileRetries:[50]});
  const at=n=>({url:`atlasrail://https://example.org/railway/14/${n}/10`});
  // AbortSignal.timeout does not keep Node's event loop alive.
  const alive=setInterval(()=>{},20);t.after(()=>clearInterval(alive));
  answers=['stuck','ok'];
  assert.equal(readTile((await protocols.atlasrail(at(1),new AbortController())).data).layers.stations.feature(0).properties.tracks,2);
  assert.equal(fetches.length,2,'a timed-out download is started afresh');
  answers=[503,'ok'];
  await protocols.atlasrail(at(2),new AbortController());
  assert.equal(fetches.length,4,'a server error is tried again');
  answers=['down','down'];
  await assert.rejects(protocols.atlasrail(at(3),new AbortController()),TypeError);
  assert.equal(fetches.length,6,'only once more');
  answers=[404];
  await assert.rejects(protocols.atlasrail(at(4),new AbortController()),/returned 404/);
  assert.equal(fetches.length,7,'a 4xx answer stays as it is');
  answers=['down','ok'];
  const gone=new AbortController(),lost=protocols.atlasrail(at(5),gone);
  await wait(10);gone.abort();
  await assert.rejects(lost,{name:'AbortError'},'cancelled during the wait: not shown as a failure');
  await wait(100);
  assert.equal(fetches.length,8,'a tile no longer wanted is not fetched again');
});
test('generated Latin transliteration cannot replace a local name as English fallback',()=>{
  const japanese=at({name:'腰越三丁目','name:latin':'yao yue3ding mu'});
  for(const lang of ['en','fr','de','ru']) {
    assert.equal(chooseName(japanese,lang),japanese.name);
    assert.equal(chooseName({...japanese,'name:en':'Koshigoe 3-chome'},lang),'Koshigoe 3-chome');
  }
  assert.equal(chooseName(at({'name:latin':'Only available name'}),'en'),'Only available name');
  const keys=labelExpression('en').filter(x=>Array.isArray(x)&&x[0]==='to-string').map(x=>x[1][1]);
  assert.ok(keys.indexOf('name:en')<keys.indexOf('name'));
  assert.ok(keys.indexOf('name')<keys.indexOf('name:latin'));
});

test('label protocols hand a tile to the map only after the glyph slices its rare Han names need',async()=>{
  const protocols={},asked=[];let release;
  const rareGlyphs=blocks=>{asked.push([...blocks]);return new Promise(resolve=>{release=resolve;});};
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},{tile:async()=>({data:tile({name:'\u{2A700}村','name:en':'Plain'})})},async()=>({ok:true,arrayBuffer:async()=>tile({name:'\u{30000}線'}).buffer}),{rareGlyphs});
  let done=false;
  const local=protocols.atlasbase({url:'atlasbase://local/https://example.org/world.pmtiles/7/1/1'},new AbortController()).then(r=>{done=true;return r;});
  await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(asked,[[0x2a7]]);assert.equal(done,false,'the tile waits for its slice');
  release();assert.equal(readTile((await local).data).layers.stations.feature(0).properties.atlas_name,'\u{2A700}村');
  asked.length=0;
  await protocols.atlasbase({url:'atlasbase://en/https://example.org/world.pmtiles/7/1/1'},new AbortController());
  assert.deepEqual(asked,[],'an English label needs no rare slice');
  const rail=protocols.atlasrail({url:'atlasrail://https://example.org/rail/7/1/1'},new AbortController());
  await new Promise(r=>setTimeout(r,0));release();await rail;
  assert.deepEqual(asked,[[0x300]],'railway names, drawn as stored, are read from the tile bytes');
});
test('railway tiles drawn as stored or re-encoded load the rare Han of their text',async()=>{
  const protocols={},requested=[];
  const bytes=name=>Uint8Array.from(tile({name,owner:name,maxspeed:268439664})).buffer;
  const tiles={'/rare/':bytes('\u{2A700}線'),'/plain/':bytes('Plain')};
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},{},async url=>({ok:true,status:200,arrayBuffer:async()=>tiles[Object.keys(tiles).find(k=>String(url).includes(k))].slice(0),json:async()=>({})}),{rareGlyphs:async found=>{requested.push([...found]);}});
  for(const scheme of ['atlasrail','atlasowner','atlasaxle']){
    requested.length=0;
    await protocols[scheme]({url:`${scheme}://https://example.org/plain/14/1/1`},new AbortController());
    assert.deepEqual(requested,[],`${scheme}: a number whose bytes look like UTF-8 requests nothing`);
    await protocols[scheme]({url:`${scheme}://https://example.org/rare/14/1/1`},new AbortController());
    assert.deepEqual(requested,[[0x2a7]],scheme);
  }
});
