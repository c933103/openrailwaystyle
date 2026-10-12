import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
const base=process.argv[2];
const path=`${base}/scripts/check-departures-browser.mjs`;
const source=await readFile(path,'utf8');
const {departureRows}=await import(pathToFileURL(`${base}/styles/departures.mjs`).href);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const predecessorHash='67f51839ec4e9c14d0f7a63e6cbe76970a6933d0514c85c0e86a5af71ca69bd8';
const old="place:stop('Central','a')";
const updated="place:stop('Central','a',{arrival:'2099-01-01T12:00:00Z',departure:'2099-01-01T12:00:00Z'})";
assert.equal(source.split(updated).length,2,'exactly one reused cache row changes');
const predecessor=source.replace(updated,old);
assert.equal(sha256(predecessor),predecessorHash,'all other fixture bytes and assertions are unchanged');
const start=Date.parse('2026-10-12T00:00:00Z');
function extractRow(text){
 const stopLine=text.split('\n').find(line=>line.trimStart().startsWith('const stop=(name,stopId,extra='));
 assert.ok(stopLine);
 const begin=text.indexOf("      const row = {mode:'SUBWAY'");assert.ok(begin>=0);
 const end=text.indexOf('\n      for (const order',begin);assert.ok(end>begin);
 return vm.runInNewContext(`${stopLine}\n${text.slice(begin,end)}\nrow`,{at:new Date(start+600_000).toISOString()});
}
const oldRow=extractRow(predecessor),newRow=extractRow(source);
assert.equal(Date.parse(oldRow.place.departure),start+600_000);
assert.equal(newRow.place.arrival,newRow.place.departure);
assert.equal(newRow.place.departure,'2099-01-01T12:00:00Z');
assert.equal(departureRows([[oldRow]],{now:start+660_000}).length,1,'exact one-minute age boundary is retained');
assert.equal(departureRows([[oldRow]],{now:start+660_001}).length,0,'one millisecond past the one-minute boundary is filtered');
const changes=Object.keys(newRow.place).filter(k=>newRow.place[k]!==oldRow.place[k]);
assert.deepEqual(changes,['arrival','departure']);
assert.equal(source.split('window.__departureFixtureNow += 60_001;').length-1,3,'all original cache-expiry increments remain');
const bodyBegin=source.indexOf('      const malformedBodies = [');
const bodyEnd=source.indexOf('\n      lookupResponse = undefined;',bodyBegin);
const malformedBodies=vm.runInNewContext(`${source.slice(bodyBegin,bodyEnd)}\nmalformedBodies`);
assert.equal(malformedBodies.length,7);
const step=60_001,prefixAdvances=6;
let stepIndex=prefixAdvances;
const scenarios=[];
for(const [label]of malformedBodies)for(const order of [['a','b'],['b','a']])for(const withRows of [false,true]){
 const before=stepIndex++,after=stepIndex;
 const counts=row=>[before,after].map(n=>departureRows(withRows?[[row]]:[[]],{now:start+n*step}).length);
 const oldCounts=counts(oldRow),newCounts=counts(newRow);
 assert.deepEqual(newCounts,[Number(withRows),Number(withRows)]);
 scenarios.push({label,order,withRows,beforeMs:before*step,afterMs:after*step,oldCounts,newCounts});
}
assert.equal(scenarios.length,28);assert.equal(stepIndex,34);
const horizon=Array.from({length:stepIndex+1},(_,n)=>({expirySteps:n,nowOffsetMs:n*step,
 oldRows:departureRows([[oldRow]],{now:start+n*step}).length,newRows:departureRows([[newRow]],{now:start+n*step}).length}));
assert.ok(horizon.every(x=>x.newRows===1));
assert.equal(horizon.find(x=>x.oldRows===0).expirySteps,11);
assert.equal(departureRows([[newRow]],{now:start+34*step}).length,1,'all-malformed recovery and close/reopen still retain the row at final clock');
console.log(JSON.stringify({sourceSha256:sha256(source),predecessorSha256:predecessorHash,parserSha256:sha256(await readFile(`${base}/styles/departures.mjs`)),
 exactOneRowTimestampChange:true,ageCutoffChecks:2,expiryStepMs:step,prefixAdvances,malformedScenarios:scenarios.length,totalAdvances:stepIndex,
 firstOldRowLoss:horizon.find(x=>x.oldRows===0),firstOldScenarioFailure:scenarios.find(x=>x.withRows&&x.oldCounts.some(n=>n!==1)),
 successorHorizonChecks:horizon.length,successorScenarioCheckpoints:scenarios.length*2,allPass:true,scenarios,horizon},null,2));
