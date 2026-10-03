import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const current=JSON.parse(await readFile('styles/world.style.json','utf8'));
const expected=JSON.parse(execFileSync('git',['show','origin/main:styles/world.style.json'],{encoding:'utf8',maxBuffer:16*1024*1024}));
// These are the only generated rendering-contract changes authorized by PR 73.
// Build the expectation from current main, never from the new generated output.
for(const feature of expected.sources.stationMajor.data.features){
  for(const key of Object.keys(feature.properties))if(key==='name'||key.startsWith('name:'))delete feature.properties[key];
}
const changedLayers=[];
for(const layer of expected.layers){
  if(!['stationLow','stationMed'].includes(layer.source))continue;
  assert.equal(layer.filter.length,4,layer.id);
  layer.filter[2]=layer.source==='stationMed'?['any',['>=',['zoom'],7],['literal',true]]:['literal',true];
  changedLayers.push(layer.id);
}
assert.equal(changedLayers.length,14);
assert.deepEqual(current,expected,'No unrelated source, geometry, styling, order or metadata changes');
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(!value||typeof value!=='object')return value;
  const result={};
  for(const key of Object.keys(value).sort()){
    if(key==='metadata'){
      const metadata=Object.fromEntries(Object.entries(value.metadata).filter(([name])=>!name.startsWith('atlas:')));
      if(Object.keys(metadata).length)result.metadata=canonical(metadata);
    }else result[key]=canonical(value[key]);
  }
  return result;
}
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const path='tests/fixtures/style-composition-baseline.json';
const baseline=JSON.parse(await readFile(path,'utf8'));
const source=baseline.sources.find(source=>source.id==='stationMajor');
assert.ok(source);
source.sha256=digest(expected.sources.stationMajor);
for(const id of changedLayers){
  const record=baseline.layers.find(layer=>layer.id===id);
  assert.ok(record,id);
  record.sha256=digest(expected.layers.find(layer=>layer.id===id));
}
baseline.reviewedUpdates=[...(baseline.reviewedUpdates||[]).filter(update=>update.pr!==73),{
  pr:73,
  reason:'Curated names are maintenance notes only; provider fallback remains eligible until OSM names are available.',
  source:'stationMajor',
  layers:changedLayers,
}];
await writeFile(path,JSON.stringify(baseline,null,2)+'\n');
console.log('Verified PR 73 contract delta: one nameless source and fourteen provider filters; all other rendering unchanged.');
