import test from 'node:test';
import assert from 'node:assert/strict';
import encode from 'vt-pbf';
import {readTile,localizeTile,installLabelProtocols,hanRegion,chineseArea} from '../styles/tile-labels.mjs';
import {chooseName,readSettings,stationLanguages,stationPending,labelExpression} from '../styles/map-model.mjs';

// Tiles give every feature its Han-name region; tests state it explicitly.
const at=(p,zone='cjkv')=>({...p,atlas_han:zone});
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
    CN:[[116.4,39.9],[121.47,31.23],[87.6,43.8],[127.47,50.22],[91.1,29.65],[109.5,18.25],[114.118,22.533],[114.055,22.536],[113.549,22.217],[124.39,40.13]],
    TW:[[121.52,25.05],[120.3,22.62],[118.32,24.44],[119.57,23.57]],
    HK:[[114.18,22.30],[114.113,22.528],[114.066,22.514],[113.92,22.31]],
    MO:[[113.54,22.19],[113.56,22.14]],
    '':[[126.97,37.55],[139.77,35.68],[105.84,21.02],[106.9,47.9],[127.53,50.27],[124.40,40.10],[103.85,1.29],[13.4,52.5]],
  };
  for(const [area,points] of Object.entries(places)) for(const [lon,lat] of points) assert.equal(chineseArea(lon,lat),area,`${lon},${lat}`);
  const after=readTile(localizeTile(tile({name:'臺北'}),'zh-Hans',{z:12,x:3430,y:1753})).layers.stations.feature(0);
  assert.equal(after.properties.atlas_zh,'TW','z12 tile 3430/1753 covers Taipei');
});
const zh=(p,area)=>({...p,atlas_han:area?'cjkv':'none',atlas_zh:area||''});
test('Chinese keys are read by region; the other script and regional names stay fallbacks',()=>{
  // name:zh may be Traditional already while name:zh-HK carries Hong Kong wording.
  const singapore={name:'Singapore','name:en':'Singapore','name:zh':'星加坡','name:zh-HK':'新加坡'};
  assert.equal(chooseName(zh(singapore),'zh-Hant'),'星加坡','general name:zh before Hong Kong wording');
  assert.equal(chooseName(zh({...singapore,'name:zh':''}),'zh-Hant'),'新加坡','regional wording in the right script before English');
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
