import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const source = process.argv[2];
const {samePlaceName, searchResults, tileStations} = await import(pathToFileURL(`${source}/styles/map-model.mjs`));
const distinct = [
 ['Terminal 1','Terminal 10'], ['Terminal 1','Terminal 11'],
 ['Terminal1','Terminal10'], ['Terminal1','Terminal11'],
 ['Terminal 1','Terminal 101'], ['Terminal 1','1 Terminal 1'],
 ['Central','Central 2'], ['Central','2 Central'], ['Central','Central-2'],
 ['Central','Central.2'], ['Central','Central / 2'], ['Central','Central (2)'],
 ['中央','中央2'], ['中央','2中央'], ['中央','中央-2'],
 ['Central','Central２'], ['Central','Central٢'], ['Central','Central²'], ['Central','CentralⅡ'],
 ['中央','中央２'], ['中央','中央٢'], ['中央','中央²'], ['中央','中央Ⅱ'],
 ['Terminal １','Terminal １０'], ['Terminal ١','Terminal ١٠'],
 ['Terminal 1','Terminal 1-1'], ['Terminal 1','Terminal 1.1'], ['Terminal 1','Terminal 1 / 1'],
 ['Terminal 1','第1航廈 Terminal 10'], ['Terminal 1','第1航廈 Terminal 11'],
 ['Terminal 1','第2航廈 Terminal 1'], ['Central','中央2 Central'],
 ['中央1','中央11 Central 1'], ['中央1','中央1 Central 2'],
 ['中央','中央 Central 2'], ['Central','中央2 Central 2'],
 ['1 Terminal','11 Terminal 第1航廈'],
 ['Terminal 𝟙','第𝟙航廈 Terminal 𝟙𝟙'],
 ['Terminal 1','Terminal 1-1航廈'], ['Terminal 1','Terminal 1.1航廈'],
 ['Terminal 1','Terminal 1/1航廈'], ['1 Terminal','第1-1 Terminal'],
 ['Terminal 1','Terminal 1–1航廈'], ['Terminal 1','Terminal 1−1航廈'],
 ['Terminal 1','第２航廈 Terminal 1'], ['Terminal １','第2航廈 Terminal １'],
 ['Terminal 1','第²航廈 Terminal 1'], ['Terminal 2','第①航廈 Terminal 2'],
 ['Central Park','Central'], ['Terminal 1A','Terminal 1'],
];
const aliases = [
 ['Central','CENTRAL'], ['Central','Central Station'], ['中央駅','中央'],
 ['大埔墟 Tai Po Market','Tai Po Market'], ['紅磡 Hung Hom Station','Hung Hom'],
 ['第1航廈 Terminal 1','Terminal 1'], ['第1航廈 Terminal 1','第1航廈'],
 ['Terminal 1 第1航廈','Terminal 1'], ['Terminal 1 第1航廈','第1航廈'],
 ['中央2 Central 2','中央2'], ['中央2 Central 2','Central 2'],
 ['第１航廈 Terminal １','Terminal １'], ['第١航廈 Terminal ١','Terminal ١'],
 ['第Ⅰ航廈 Terminal Ⅰ','Terminal Ⅰ'],
 ['第1航廈 / Terminal 1','Terminal 1'], ['Terminal 1 (第1航廈)','Terminal 1'],
 ['Terminal 1','Terminal 1 (1號航廈)'], ['Terminal 1','Terminal 1(1號航廈)'],
 ['Terminal 1','Terminal 1 / 1號航廈'], ['Terminal 1','Terminal 1 - 1號航廈'],
 ['第𝟙航廈 Terminal 𝟙','Terminal 𝟙'], ['第𝟙航廈 Terminal 𝟙','第𝟙航廈'],
 ['第１航廈 Terminal 1','Terminal 1'], ['第1航廈 Terminal １','Terminal １'],
 ['第１航廈 Terminal 1','第１航廈'], ['第1航廈 Terminal １','第1航廈'],
 ['第¹航廈 Terminal 1','Terminal 1'], ['第①航廈 Terminal 1','Terminal 1'],
 ['Terminal 1','Terminal 1'], ['Terminal1','Terminal1'], ['中央2','中央2'],
];
const failures=[]; let assertions=0;
const check=(label,actual,expected)=>{assertions++;try{assert.deepEqual(actual,expected);}catch{failures.push({label,actual,expected});}};
const facility=(name, extra={})=>({osm_id:100,name,railway:'station',latitude:0,longitude:0,...extra});
const geocoder=(name, extra={})=>({osm_type:'way',osm_id:200,category:'railway',type:'station',lat:'0.0005',lon:'0.0005',namedetails:{name},...extra});
const tile=(name, extra={})=>({geometry:{type:'Point',coordinates:[0.0005,0.0005]},properties:{id:'way-200-train-station',name,feature:'station',...extra}});
for(const [kind,pairs,expected] of [['distinct',distinct,false],['alias',aliases,true]]){
 for(const [left,right] of pairs) for(const [a,b] of [[left,right],[right,left]]){
   const label=`${kind}: ${JSON.stringify(a)} / ${JSON.stringify(b)}`;
   check(`name ${label}`,samePlaceName(a,b),expected);
   check(`geocoder ${label}`,searchResults([facility(a)],[geocoder(b)]).rail.map(r=>r.osm_id),expected?[100]:[100,200]);
   check(`tile ${label}`,tileStations([tile(b)],b,[0,0],[facility(a)]).map(r=>r.osm_id),expected?[]:[200]);
 }
}
for(const [a,b] of [['Terminal 1','Terminal 10'],['中央','中央2']]){
 check(`same object geocoder ${a}`,searchResults([facility(a)],[geocoder(b,{osm_type:'node',osm_id:100,lat:'10',lon:'10'})]).rail.map(r=>r.osm_id),[100]);
 const t=tile(b,{id:'node-100-train-station'});t.geometry.coordinates=[10,10];
 check(`same object tile ${a}`,tileStations([t],b,[0,0],[facility(a)]).map(r=>r.osm_id),[]);
 check(`different object type geocoder ${a}`,searchResults([facility(a)],[geocoder(b,{osm_id:100})]).rail.map(r=>[r.osm_type??'node',r.osm_id]),[['node',100],['way',100]]);
 check(`different object type tile ${a}`,tileStations([tile(b,{id:'way-100-train-station'})],b,[0,0],[facility(a)]).map(r=>[r.osm_type,r.osm_id]),[['way',100]]);
}
for(const delta of [0.003999,0.004,0.004001]){
 const shouldMerge=delta<0.004;
 check(`latitude boundary geocoder ${delta}`,searchResults([facility('Terminal 1')],[geocoder('Terminal 1',{lat:String(delta),lon:'0'})]).rail.length,shouldMerge?1:2);
 const t=tile('Terminal 1');t.geometry.coordinates=[0,delta];
 check(`latitude boundary tile ${delta}`,tileStations([t],'Terminal 1',[0,0],[facility('Terminal 1')]).length,shouldMerge?0:1);
 check(`longitude boundary geocoder ${delta}`,searchResults([facility('Terminal 1')],[geocoder('Terminal 1',{lat:'0',lon:String(delta)})]).rail.length,shouldMerge?1:2);
 const u=tile('Terminal 1');u.geometry.coordinates=[delta,0];
 check(`longitude boundary tile ${delta}`,tileStations([u],'Terminal 1',[0,0],[facility('Terminal 1')]).length,shouldMerge?0:1);
}
const repeated=[tile('Terminal 1'),tile('Terminal 1')];
check('same tile identity dedup',tileStations(repeated,'Terminal',[0,0]).map(r=>r.osm_id),[200]);
const order=[tile('Terminal 10',{id:'way-200-station'}),tile('Terminal 1',{id:'way-201-station'})];
order[0].geometry.coordinates=[0,0];order[1].geometry.coordinates=[1,1];
check('numbered exact name ranks before numeric prefix',tileStations(order,'Terminal 1',[0,0]).map(r=>r.name),['Terminal 1','Terminal 10']);
console.log(JSON.stringify({source,assertions,passed:assertions-failures.length,failed:failures.length,failures},null,2));
process.exitCode=failures.length?1:0;
