import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {BROWSER_LIBRARIES} from './source/scripts/browser-libraries.mjs';
const base='https://c933103.github.io/openrailwaystyle/',sha='4408eaf2402d9c5a6639b97e400c0cabcfacb85e';
const paths=['index.html','app.mjs','world.style.json','major-stations.geojson','vendor/tile-labels.js',...BROWSER_LIBRARIES.map(x=>x.target)];
const results=[];
for(const path of paths){
 const response=await fetch(base+path,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Cache-Control':'no-cache'}});
 assert.equal(response.status,200,path);
 const actual=Buffer.from(await response.arrayBuffer()),expected=await readFile(new URL('./source/styles/'+path,import.meta.url));
 const hash=b=>createHash('sha256').update(b).digest('hex');
 const row={path,status:response.status,bytes:actual.length,sha256:hash(actual),expectedSha256:hash(expected),equal:actual.equals(expected)};results.push(row);
 await writeFile(new URL('./deployed-assets.json',import.meta.url),JSON.stringify({source:sha,base,observedAt:new Date().toISOString(),results},null,2)+'\n');
 assert.ok(row.equal,'Served asset differs from merged source/build: '+path);
 if(path==='vendor/tile-labels.js')assert.ok(actual.includes(Buffer.from(sha)),'Served bundle identifies merged source');
 console.log('PASS',path,actual.length,row.sha256);
}
