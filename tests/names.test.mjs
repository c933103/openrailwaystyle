import test from 'node:test';
import assert from 'node:assert/strict';
import encode from 'vt-pbf';
import {readTile,localizeTile,installLabelProtocols,hanRegion} from '../styles/tile-labels.mjs';
import {chooseName,readSettings,stationLanguages} from '../styles/map-model.mjs';

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
  assert.deepEqual(stationLanguages('zh-Hant',false),['zh-Hant','zh','zh-Hans','en']);
  assert.deepEqual(stationLanguages('ja',false),['ja','en']);
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
  assert.deepEqual(requests,['zh-Hant','zh','zh-Hans','en']);
});
test('PMTiles wrapper localizes bytes and carries language through TileJSON templates',async()=>{
  const protocols={};
  installLabelProtocols({addProtocol:(id,fn)=>{protocols[id]=fn;}},{tile:async p=>({data:p.type==='json'?{tiles:['pmtiles://https://example.org/world.pmtiles/{z}/{x}/{y}']}:tile({name:'서울','name:en':'Seoul'})})});
  const json=await protocols.atlasbase({url:'atlasbase://fr/https://example.org/world.pmtiles',type:'json'},new AbortController());
  assert.equal(json.data.tiles[0],'atlasbase://fr/https://example.org/world.pmtiles/{z}/{x}/{y}');
  const result=await protocols.atlasbase({url:'atlasbase://fr/https://example.org/world.pmtiles/7/1/1'},new AbortController());
  assert.equal(readTile(result.data).layers.stations.feature(0).properties.atlas_name,'Seoul');
});
