import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {needsServiceAcquisition} from '../scripts/service-acquisition-trigger.mjs';
test('maintenance-only pushes never select service acquisition; source changes and existing cadence do',()=>{
  for (const paths of [['.github/workflows/service-frequency.yml'],['scripts/maintain-data-workflows.mjs'],['scripts/timetable-frequency.mjs'],['scripts/timetable-frequency-version.mjs'],['docs/service-frequency.md']])
    assert.equal(needsServiceAcquisition('push',paths),false);
  for (const event of ['schedule','workflow_dispatch']) assert.equal(needsServiceAcquisition(event),true);
  assert.equal(needsServiceAcquisition('pull_request',['scripts/service-routes.mjs']),false);
  assert.equal(needsServiceAcquisition('push',['scripts/service-routes.mjs','.github/workflows/service-frequency.yml']),true);
});
test('push gating reads the whole event boundary, including an earlier source change',async()=>{
  const root=await mkdtemp(join(tmpdir(),'atlas-service-trigger-')),script=resolve('scripts/service-acquisition-trigger.mjs');
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try {
    git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
    await mkdir(join(root,'scripts'));await writeFile(join(root,'scripts/service-routes.mjs'),'initial');git('add','.');git('commit','-m','Initial');const before=git('rev-parse','HEAD');
    await writeFile(join(root,'scripts/service-routes.mjs'),'changed');git('add','.');git('commit','-m','Source change');
    await writeFile(join(root,'README.md'),'later docs');git('add','.');git('commit','-m','Later docs');
    const run=async(boundary)=>{
      const output=join(root,'output');await writeFile(output,'');
      execFileSync(process.execPath,[script],{cwd:root,env:{...process.env,EVENT:'push',BEFORE:boundary,GITHUB_SHA:git('rev-parse','HEAD'),GITHUB_OUTPUT:output}});
      return readFile(output,'utf8');
    };
    assert.equal(await run(before),'enabled=true\n');
    assert.equal(await run(git('rev-parse','HEAD^')),'enabled=false\n');
  } finally {await rm(root,{recursive:true,force:true});}
});
