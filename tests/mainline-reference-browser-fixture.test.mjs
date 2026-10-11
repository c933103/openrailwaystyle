import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {installEmptyMapProviders,emptyReferenceFixture} from '../scripts/browser-renderer-fixture.mjs';
import {createReferenceReader} from '../styles/mainline-reference.mjs';

const response = fixture => new Response(fixture.body ?? JSON.stringify(fixture.json), {
  status:fixture.status ?? 200, headers:{'content-type':fixture.contentType ?? 'application/json'},
});
for (const prefix of ['/', '/atlas-project/']) {
  test(`synthetic reference validates exact index and gzip bytes at ${prefix}`, async () => {
    const requests=[], root=`http://127.0.0.1:4173${prefix}data/mainline-reference/`;
    const reader=createReferenceReader({root,fetcher:async url=>{
      requests.push(url.pathname);
      return response(emptyReferenceFixture(url.pathname));
    }});
    const tile=await reader.tile('0/0/0');
    assert.deepEqual(new Uint8Array(tile),new Uint8Array([26,0]));
    assert.equal((await reader.tile('6/31/30')).byteLength,0,'only verified index absence counts as empty');
    const manifest=await reader.manifest();
    assert.match(manifest.sources[0].source,/synthetic/);
    assert.deepEqual(requests,[`${prefix}data/mainline-reference/manifest.json`,
      `${prefix}data/mainline-reference/generations/${manifest.generation}/index.json`,
      `${prefix}data/mainline-reference/generations/${manifest.generation}/0/0/0.pbf.gz`]);
  });
}

test('the production reader rejects generic metadata and changed fixture index/tile bytes',async()=>{
  for(const broken of ['manifest.json','index.json','.pbf.gz']) {
    const reader=createReferenceReader({root:'http://127.0.0.1/data/mainline-reference/',fetcher:async url=>{
      const fixture=emptyReferenceFixture(url.pathname);
      if(url.pathname.endsWith(broken)){delete fixture.json;fixture.body=broken==='manifest.json'?JSON.stringify({tiles:[]}):'changed';}
      return response(fixture);
    }});
    await assert.rejects(reader.tile('0/0/0'),/missing or incomplete|Changed/);
  }
});

test('shared UI routing returns verified reference fixtures before its generic data fallback',async()=>{
  let handler;
  await installEmptyMapProviders({addInitScript:async()=>{},route:async(_pattern,fn)=>{handler=fn;}},
    'http://127.0.0.1:4173/atlas-project/',{rendererAssets:new Map()});
  const reader=createReferenceReader({root:'http://127.0.0.1:4173/atlas-project/data/mainline-reference/',fetcher:async url=>{
    let result;
    await handler({request:()=>({url:()=>url.href}),fulfill:async value=>{result=response(value);},
      continue:()=>assert.fail('reference fixture must not need a network read')});
    return result;
  }});
  assert.equal((await reader.tile('0/0/0')).byteLength,2);
});

test('network-mode deployment checks retain real first-party reference reads',async()=>{
  let handler;
  const base='https://deployed.example/atlas-project/';
  await installEmptyMapProviders({route:async(_pattern,fn)=>{handler=fn;}},base,{firstParty:'network'});
  const manifest=emptyReferenceFixture('/data/mainline-reference/manifest.json').json;
  for(const path of ['manifest.json',`generations/${manifest.generation}/index.json`,
    `generations/${manifest.generation}/0/0/0.pbf.gz`]) {
    let continued=0;
    await handler({request:()=>({url:()=>`${base}data/mainline-reference/${path}`}),
      continue:async()=>{continued++;},fulfill:()=>assert.fail('published assets must not be mocked')});
    assert.equal(continued,1);
  }
});

test('bespoke UI fixtures handle the reference contract before catch-all data responses',async()=>{
  for(const [file,fallback] of [
    ['check-map-controls-browser.mjs',"if(path.includes('/data/'))"],
    ['check-signal-power-browser.mjs','if(!match)'],
    ['check-deployed-fixture-browser.mjs',"if(path.includes('/data/'))"],
  ]) {
    const source=await readFile(new URL(`../scripts/${file}`,import.meta.url),'utf8');
    const handler=source.indexOf('const reference=emptyReferenceFixture(');
    assert.ok(handler>0&&handler<source.indexOf(fallback),`${file} must not replace reference metadata with generic empty data`);
  }
  for(const file of ['check-platform-browser.mjs','check-infrastructure-browser.mjs','check-platform-stations-browser.mjs']) {
    const source=await readFile(new URL(`../scripts/${file}`,import.meta.url),'utf8');
    const generic=source.indexOf("page.route('**/data/**/index.json'");
    const specific=source.indexOf("page.route('**/data/mainline-reference/**'");
    assert.ok(generic>0&&specific>generic,`${file}: later Playwright reference route wins over the generic index fixture`);
    assert.match(source,/route\.fulfill\(emptyReferenceFixture\(/);
  }
});
