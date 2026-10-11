import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
test('in-app Sources and Licences disclose the backbone provider, automatic requests and data terms',async()=>{
 const dom=new JSDOM(await readFile(new URL('../styles/index.html',import.meta.url),'utf8'));
 try{
  const document=dom.window.document,sources=[];
  for(let node=document.getElementById('help-sources').nextElementSibling;node&&node.id!=='help-licences';node=node.nextElementSibling)sources.push(node);
  const text=sources.map(n=>n.textContent).join(' ');
  for(const pattern of [/Re:Earth Papers/,/Natural Earth/,/papers\.reearth\.land/,/TileJSON metadata/,/automatically requests/,/tile coordinates/,/IP address/,/zoom[s]? 4–6/])assert.match(text,pattern);
  const licences=document.getElementById('help-licences').nextElementSibling;
  assert.ok(licences.querySelector('a[href="https://www.naturalearthdata.com/about/terms-of-use/"]'));
  assert.ok(licences.querySelector('a[href="https://papers.reearth.land/attribution"]'));
  assert.match(licences.textContent,/public-domain/);
 }finally{dom.window.close();}
});
