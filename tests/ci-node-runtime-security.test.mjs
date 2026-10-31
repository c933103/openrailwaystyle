import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import vm from 'node:vm';

const workflows=new URL('../.github/workflows/',import.meta.url);
const minimum='26.12.1';
const guardScript='const [major,minor,patch]=process.versions.node.split(".").map(Number); if (major !== 26 || minor < 12 || (minor === 12 && patch < 1)) throw new Error("CI requires patched Node 26.12.1+"); console.log(process.version)';
const guardRun="run: node -e '"+guardScript+"'";

test('each Atlas Node setup tracks the latest patched Node 26 release',async()=>{
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
      assert.match(options,/node-version:\s*'26'/,file+' must track the Node 26 release line');
      assert.match(options,/check-latest:\s*true/,file+' must bypass older matching runner-cache releases');
      assert.equal(lines[j],indent+'- name: Verify Node 26 security baseline',file+' must verify after setup');
      assert.equal(lines[j+1],indent+'  '+guardRun,file+' must reject releases below '+minimum);
      installations++;
    }
  }
  assert.equal(installations,29,'all 29 runtime setup steps must track current fixes');
});

test('Node 26 security guard accepts future fixes without accepting unpatched or other majors',()=>{
  const cases=[
    ['22.23.4',false],
    ['26.11.9',false],
    ['26.12.0',false],
    ['26.12.1',true],
    ['26.12.2',true],
    ['26.13.0',true],
    ['26.100.0',true],
    ['27.0.0',false]
  ];
  for(const [version,expected] of cases){
    const evaluate=()=>vm.runInNewContext(guardScript,{
      process:{versions:{node:version},version:'v'+version},
      console:{log(){}}
    });
    if(expected)assert.doesNotThrow(evaluate,version+' must be accepted');
    else assert.throws(evaluate,/CI requires patched Node 26\.12\.1\+/,version+' must be rejected');
  }
});

test('all CI Node commands run after setup and security-baseline verification',async()=>{
  for(const file of (await readdir(workflows)).filter(name=>name.endsWith('.yml'))){
    const source=await readFile(new URL(file,workflows),'utf8');
    const section=source.split(/^jobs:\s*$/m)[1]||'';
    const jobs=section.split(/^  ([A-Za-z][\w-]*):\s*$/m);
    for(let i=1;i<jobs.length;i+=2){
      const job=jobs[i],body=jobs[i+1]||'';
      // Ignore the guard's own one-line Node invocation without changing later indices.
      const nonGuard=body.replaceAll(guardRun,'run: true'.padEnd(guardRun.length,' '));
      const command=/^[ \t]*(?:-\s+run:\s*)?(?:node|npm|npx)(?=\s|$)/gm.exec(nonGuard);
      if(!command)continue;
      const setup=body.indexOf('uses: actions/setup-node@v4');
      const guard=body.indexOf(guardRun);
      assert.ok(setup>=0 && setup<command.index,file+' '+job+' invokes Node before setup');
      assert.ok(guard>=0 && guard<command.index,file+' '+job+' invokes Node before baseline validation');
    }
  }
});

test('deployed tile integrity fetch and Brotli decoding use the validated Node runtime',async()=>{
  const site=await readFile(new URL('site.yml',workflows),'utf8');
  const deploy=site.split(/^  deploy:\s*$/m)[1];
  assert.ok(deploy,'site deployment job exists');
  const setup=deploy.indexOf('- uses: actions/setup-node@v4');
  const guard=deploy.indexOf(guardRun);
  const fetch=deploy.indexOf('- name: Verify deployed vector tile bytes');
  assert.ok(setup>=0 && setup<guard && guard<fetch,'setup and guard must precede HTTPS fetch');
  assert.equal((deploy.match(/uses: actions\/setup-node@/g)||[]).length,1);
});

test('package engine floors match supported patched releases without lockfile drift',async()=>{
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
  const expected='^22.23.4 || ^24.22.1 || >=26.12.1';
  assert.equal(pkg.engines.node,expected);
  assert.equal(lock.packages[''].engines.node,expected);
});
