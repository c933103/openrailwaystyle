import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {validateAerialwaySnapshot} from '../scripts/validate-aerialway-snapshot.mjs';
import {conveyingTiles} from '../scripts/conveying-data.mjs';

const features = [{type:'Feature',properties:{kind:'cableway'},geometry:{type:'LineString',coordinates:[[0,0],[0.001,0.001]]}}];
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(),'aerialway-snapshot-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const tiles = conveyingTiles(features,{z:12,layer:'aerialways'});
  for (const [key, bytes] of tiles) {
    await mkdir(join(root,key.split('/').slice(0,-1).join('/')),{recursive:true});
    await writeFile(join(root,`${key}.pbf.gz`),gzipSync(bytes));
  }
  const manifest = {features:5000,zoom:12,tiles:tiles.size};
  const index = {tiles:[...tiles.keys()]};
  const json = (name,value)=>writeFile(join(root,name),JSON.stringify(value));
  await json('manifest.json',manifest); await json('index.json',index);
  return {root,manifest,index,json};
}

test('valid snapshot passes without changing published input bytes',async t=>{
  const f = await fixture(t), before = await readFile(join(f.root,'index.json'));
  assert.deepEqual(await validateAerialwaySnapshot(f.root),{features:5000,tiles:f.index.tiles.length});
  assert.deepEqual(await readFile(join(f.root,'index.json')),before);
});
for (const [name,mutate] of Object.entries({
  'missing manifest':f=>rm(join(f.root,'manifest.json')),
  'missing index':f=>rm(join(f.root,'index.json')),
  'empty placeholder index':f=>f.json('index.json',{tiles:[]}),
  'malformed JSON':f=>writeFile(join(f.root,'index.json'),'{'),
  'small extract':f=>f.json('manifest.json',{...f.manifest,features:4999}),
  'wrong zoom':f=>f.json('manifest.json',{...f.manifest,zoom:14}),
  'mismatched count':f=>f.json('manifest.json',{...f.manifest,tiles:999}),
  'duplicate index':async f=>{await f.json('index.json',{tiles:[f.index.tiles[0],f.index.tiles[0]]});await f.json('manifest.json',{...f.manifest,tiles:2});},
  'unsafe coordinate':async f=>{await f.json('index.json',{tiles:['../../escape']});await f.json('manifest.json',{...f.manifest,tiles:1});},
  'missing tile':f=>rm(join(f.root,`${f.index.tiles[0]}.pbf.gz`)),
  'corrupt gzip':f=>writeFile(join(f.root,`${f.index.tiles[0]}.pbf.gz`),'broken'),
  'empty vector tile':f=>writeFile(join(f.root,`${f.index.tiles[0]}.pbf.gz`),gzipSync(Buffer.alloc(0))),
})) test(`rejects ${name}`,async t=>{const f=await fixture(t);await mutate(f);await assert.rejects(validateAerialwaySnapshot(f.root));});

test('actual deployment step stops before archive/validation on missing branch or fetch error',async t=>{
  const source=await readFile(new URL('../.github/workflows/site.yml',import.meta.url),'utf8');
  const step=source.split('      - name: Load aerial cableways and lifts\n        run: |\n')[1].split('      # Historic areas')[0].split('\n').map(line=>line.replace(/^          /,'')).join('\n');
  for (const code of [2,128]) {
    const f=await fixture(t),bin=join(f.root,'bin');await mkdir(bin);
    await writeFile(join(bin,'git'),`#!/bin/sh\n[ "$1" = fetch ] && exit ${code}\necho unexpected-archive >&2\nexit 90\n`,{mode:0o755});
    await writeFile(join(bin,'node'),'#!/bin/sh\necho unexpected-validation >&2\nexit 91\n',{mode:0o755});
    const run=spawnSync('bash',['-c',step],{cwd:f.root,env:{...process.env,PATH:`${bin}:${process.env.PATH}`},encoding:'utf8'});
    assert.equal(run.status,code);assert.doesNotMatch(run.stderr,/unexpected/);
    await assert.rejects(readFile(join(f.root,'styles/data/aerialways/index.json')));
  }
});
