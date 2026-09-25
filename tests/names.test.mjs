import test from 'node:test';
import assert from 'node:assert/strict';
import encode from 'vt-pbf';
import {readTile,localizeTile,installLabelProtocols} from '../styles/tile-labels.mjs';
import {chooseName,readSettings,inCJKV,stationLanguages} from '../styles/map-model.mjs';

test('language fallbacks prefer English, Cyrillic, Hanja, Nôm and ordinary Japanese as requested',()=>{
  const korea={name:'진주','name:en':'Jinju','name:ko-Hani':'晉州'};
  for(const lang of ['en','fr','de','es','ru']) assert.equal(chooseName(korea,lang),'Jinju');
  for(const lang of ['zh-Hans','zh-Hant','ja']) assert.equal(chooseName(korea,lang),'晉州');
  assert.equal(chooseName({...korea,'name:ru':'Чинджу'},'ru'),'Чинджу');
  assert.equal(chooseName({name:'Київ','name:en':'Kyiv'},'ru'),'Київ');
  assert.equal(chooseName({name:'Москва','name:en':'Moscow'},'fr'),'Moscow');
  assert.equal(chooseName({name:'東海道新幹線','name:en':'Tokaido Shinkansen'},'zh-Hant'),'東海道新幹線');
  assert.equal(chooseName({name:'とうきょう','name:ja':'とうきょう','name:zh':'東京','name:en':'Tokyo'},'ja'),'東京');
  assert.equal(chooseName({name:'Hà Nội','name:vi-Hani':'河內','name:en':'Hanoi'},'zh-Hans'),'河內');
  assert.equal(chooseName({name:'test','name:vi-Hani':'𡗶','name:en':'English'},'zh-Hant'),'𡗶');
  assert.equal(chooseName({...korea,'name:fr':'','name:en':''},'fr'),'진주');
  assert.equal(chooseName(korea,'local'),'진주');
  assert.equal(chooseName(korea,'ko'),'진주','English fetched for another station must not replace available native Korean');
  assert.equal(chooseName({name:'つくば','name:en':'Tsukuba'},'ja'),'つくば');
  assert.equal(readSettings('?stationLanguage=ko').language,'ko');
  assert.equal(readSettings('?language=ru&stationLanguage=ko').language,'ru');
});
const tile=properties=>encode.fromGeojsonVt({stations:{features:[{id:42,type:1,geometry:[[2048,1024]],tags:{id:42,...properties}}]}},{version:2});
test('localization preserves geometry, identifiers, layers and unrelated properties',()=>{
  const bytes=tile({name:'진주','name:en':'Jinju',maxspeed:160});
  const before=readTile(bytes).layers.stations.feature(0);
  const after=readTile(localizeTile(bytes,'fr')).layers.stations.feature(0);
  assert.equal(after.properties.atlas_name,'Jinju');
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
test('Han fallbacks apply only in China, Taiwan, Hong Kong, Macau, Japan, the Koreas and Vietnam',()=>{
  for(const [lon,lat] of [[139.77,35.68],[126.97,37.55],[125.75,39.03],[105.84,21.02],[114.17,22.30],[113.54,22.19],[121.52,25.05],[87.6,43.8],[135.24,34.43]]) assert.equal(inCJKV(lon,lat),true,`${lon},${lat}`);
  for(const [lon,lat] of [[131.88,43.11],[106.9,47.9],[102.6,17.97],[103.85,1.29],[76.9,43.2],[127.51,50.28],[117.33,49.64],[13.4,52.5],[-74,40.7]]) assert.equal(inCJKV(lon,lat),false,`${lon},${lat}`);
  const vladivostok={name:'Владивосток','name:en':'Vladivostok','name:ja':'浦塩','name:ko-Hani':'海蔘威'};
  for(const lang of ['zh-Hant','zh-Hans']) assert.equal(chooseName({...vladivostok,atlas_cjkv:false},lang),'Vladivostok');
  assert.equal(chooseName({...vladivostok,'name:ja':'','name:zh':'海参崴',atlas_cjkv:false},'ja'),'Vladivostok');
  assert.equal(chooseName({...vladivostok,'name:ja':''},'ja'),'海蔘威','unknown locations keep the Han fallbacks');
  assert.equal(chooseName({...vladivostok,atlas_cjkv:false,'name:zh':'符拉迪沃斯托克'},'zh-Hans'),'符拉迪沃斯托克','recorded Chinese names remain available');
  assert.equal(chooseName({...vladivostok,atlas_cjkv:false,'name:ja':'ウラジオストク'},'ja'),'ウラジオストク');
  assert.equal(chooseName({name:'진주','name:en':'Jinju','name:ko-Hani':'晉州',atlas_cjkv:true},'zh-Hant'),'晉州');
  assert.deepEqual(stationLanguages('zh-Hant',false),['zh-Hant','zh','zh-Hans','en']);
  assert.deepEqual(stationLanguages('ja',false),['ja','en']);
});
test('Chinese labels drop the kana of Japanese "kana (kanji)" names',()=>{
  assert.equal(chooseName({name:'つくば (筑波)','name:en':'Tsukuba'},'zh-Hant'),'筑波');
  assert.equal(chooseName({name:'Tsukuba','name:ja':'さいたま（埼玉）'},'zh-Hans'),'埼玉');
  assert.equal(chooseName({name:'ケーブルやせ (ケーブル八瀬)'},'zh-Hant'),'ケーブル八瀬');
  assert.equal(chooseName({name:'つくば (筑波)'},'ja'),'つくば (筑波)','Japanese labels keep the kana');
  assert.equal(chooseName({name:'東京 (Tokyo)'},'zh-Hant'),'東京 (Tokyo)');
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
