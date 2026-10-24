import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';

const workflows=new URL('../.github/workflows/',import.meta.url);
const patched='22.23.4';

test('each Atlas setup-node step pins and verifies the October 2026 security release',async()=>{
  let installations=0;
  for(const file of (await readdir(workflows)).filter(name=>name.endsWith('.yml'))){
    const source=await readFile(new URL(file,workflows),'utf8');
    const lines=source.split('\n');
    for(let i=0;i<lines.length;i++){
      const setup=/^(\s*)- uses: actions\/setup-node@v4$/.exec(lines[i]);
      if(!setup)continue;
      const indent=setup[1];let j=i+1;
      while(j<lines.length && !lines[j].startsWith(indent+'- '))j++;
      const options=lines.slice(i+1,j).join('\n');
      assert.match(options,/node-version:\s*'22\.23\.4'/,file+' has a floating or unpatched runtime');
      assert.equal(lines[j],indent+'- name: Verify patched Node.js runtime',file+' must check after setup');
      assert.equal(lines[j+1],indent+'  run: test "$(node --version)" = "v'+patched+'"',file+' must reject other versions');
      installations++;
    }
  }
  assert.equal(installations,24,'all 24 installed runtime steps must be protected');
});

test('all CI Node commands run after a pinned setup step',async()=>{
  for(const file of (await readdir(workflows)).filter(name=>name.endsWith('.yml'))){
    const source=await readFile(new URL(file,workflows),'utf8');
    const section=source.split(/^jobs:\s*$/m)[1]||'';
    const jobs=section.split(/^  ([A-Za-z][\w-]*):\s*$/m);
    for(let i=1;i<jobs.length;i+=2){
      const job=jobs[i],body=jobs[i+1]||'';
      // Match a shell's first direct Node/npm/npx invocation, not YAML metadata.
      const command=/^[ \t]*(?:-\s+run:\s*)?(?:node|npm|npx)(?=\s|$)/gm.exec(body);
      if(!command)continue;
      const setup=body.indexOf('uses: actions/setup-node@v4');
      const guard=body.indexOf('run: test "$(node --version)" = "v'+patched+'"');
      assert.ok(setup>=0 && setup<command.index,file+' '+job+' invokes Node before setup');
      assert.ok(guard>=0 && guard<command.index,file+' '+job+' invokes Node before its version check');
    }
  }
});

test('deployed tile integrity check cannot fetch Brotli before patched Node setup',async()=>{
  const site=await readFile(new URL('site.yml',workflows),'utf8');
  const deploy=site.split(/^  deploy:\s*$/m)[1];
  assert.ok(deploy,'site deployment job exists');
  const setup=deploy.indexOf('- uses: actions/setup-node@v4');
  const guard=deploy.indexOf('run: test "$(node --version)" = "v'+patched+'"');
  const fetch=deploy.indexOf('- name: Verify deployed vector tile bytes');
  assert.ok(setup>=0 && setup<guard && guard<fetch,'patch and guard before external HTTPS/decoding');
  assert.equal((deploy.match(/uses: actions\/setup-node@/g)||[]).length,1);
});

test('package engine floors match security releases without drifting the lockfile',async()=>{
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
  const expected='^22.23.4 || ^24.22.1 || >=26.12.1';
  assert.equal(pkg.engines.node,expected);
  assert.equal(lock.packages[''].engines.node,expected);
});
