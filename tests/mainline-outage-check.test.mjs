import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {readFile} from 'node:fs/promises';
import {mainlineOutageVisible} from '../scripts/mainline-outage-check.mjs';
const evaluate=(text,error=true,present=true)=>runInNewContext(`(${mainlineOutageVisible.toString()})()`,{document:{getElementById:id=>id==='map-status'&&present?{textContent:text,classList:{contains:name=>name==='error'&&error}}:null}});
const message=kind=>`OpenRailwayMap ${kind} data unavailable. Retrying failed tiles. Independent map references remain where available; detail may be missing.`;
test('serialized browser predicate requires each precise retryable ORM outage kind',()=>{
 for(const kind of ['station','railway','station and track'])assert.equal(evaluate(message(kind)),true);
});
test('healthy generic missing retry and stale legacy messages cannot satisfy outage gate',()=>{
 for(const text of ['Explore the rail network · click a line or station','Some map data could not load. Check your connection or reload to retry.','OpenRailwayMap railway tiles are unavailable',message('station').replace('Retrying failed tiles. ',''),message('invented'),'prefix '+message('station'),message('station')+' suffix'])assert.equal(evaluate(text),false,text);
 assert.equal(evaluate(message('station'),false),false);assert.equal(evaluate(message('station'),true,false),false);
});
test('real browser fixture uses the tested predicate and retains the 30-second status gate',async()=>{
 const source=await readFile(new URL('../scripts/check-mainline-reference-browser.mjs',import.meta.url),'utf8');
 assert.match(source,/import \{mainlineOutageVisible\} from '\.\/mainline-outage-check\.mjs'/);
 assert.match(source,/page\.waitForFunction\(mainlineOutageVisible,null,\{timeout:30000\}\)/);
 assert.match(source,/status:503,body:'explicit thematic-provider outage'/);
});
