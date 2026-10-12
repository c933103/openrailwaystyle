import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, cp, symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve, join, dirname} from 'node:path';

const root=resolve(process.argv[2]||'.');
const out=resolve(process.argv[3]||'served-search-availability');
const base='https://c933103.github.io/openrailwaystyle/';
const version='20261012-search-availability-1';
const commit='b5a73c3aa03498259c2fd531b9644d52ae94db69';
await mkdir(dirname(out),{recursive:true});
await mkdir(out); // Reject stale/reused output, including pre-existing dependency links.
// Other fixture dependencies retain the accepted source. The files below are
// overwritten with actual first-party HTTP bytes and checked before execution.
for(const folder of ['styles','tests','scripts'])await cp(join(root,folder),join(out,folder),{recursive:true});
await symlink(join(root,'node_modules'),join(out,'node_modules'),'dir');
// Rebuild only the accepted local source with the exact production metadata.
// Never execute downloaded JavaScript to discover its identity.
const build=spawnSync(process.execPath,['scripts/build-browser.mjs'],{cwd:out,encoding:'utf8',maxBuffer:16*1024*1024,
 env:{...process.env,GITHUB_SHA:commit,GITHUB_REPOSITORY:'c933103/openrailwaystyle',GITHUB_SERVER_URL:'https://github.com'}});
await writeFile(join(out,'accepted-browser-build.log'),build.stdout+build.stderr);
assert.equal(build.status,0,build.stderr||build.stdout);
const expectedBundle=await readFile(join(out,'styles/vendor/tile-labels.js'));
const files=['index.html','app.mjs','map-model.mjs','platform-length.mjs','axle-load.mjs',
  'cjk-font.mjs','departures-ui.mjs','elevation.mjs','layer-semantics.mjs','app.css','sw.js'];
const assets=[];
for(const name of files){
 const path=name==='index.html'?'':name+(name==='sw.js'?'':`?v=${version}`);
 const response=await fetch(base+path,{redirect:'error',signal:AbortSignal.timeout(30_000)});
 assert.equal(response.status,200,name);
 const bytes=Buffer.from(await response.arrayBuffer());
 assert.ok(bytes.equals(await readFile(join(root,'styles',name))),`${name} must match accepted merge bytes`);
 await writeFile(join(out,'styles',name),bytes);
 assets.push({path,status:response.status,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),matchesMergedSource:true});
}
const bundlePath=`vendor/tile-labels.js?v=${version}`;
const response=await fetch(base+bundlePath,{redirect:'error',signal:AbortSignal.timeout(30_000)});
assert.equal(response.status,200,'versioned build information bundle');
const bundleBytes=Buffer.from(await response.arrayBuffer());
assert.ok(bundleBytes.equals(expectedBundle),'versioned bundle must match exact accepted build and production metadata');
await writeFile(join(out,'styles/vendor/tile-labels.js'),bundleBytes);
const run=async(name,args)=>{
 const result=spawnSync(process.execPath,args,{cwd:out,encoding:'utf8',maxBuffer:16*1024*1024});
 await writeFile(join(out,name+'.log'),result.stdout+result.stderr);
 assert.equal(result.status,0,result.stderr||result.stdout);
 assert.match(result.stdout,/# fail 0|ℹ fail 0/);
 return {tests:Number(result.stdout.match(/(?:#|ℹ) tests (\d+)/)?.[1]),failed:0};
};
const search=await run('served-search',['--experimental-vm-modules','--test',
 'tests/search-availability.test.mjs','tests/search-api.test.mjs','tests/search-numeric-names.test.mjs','tests/sw-install.test.mjs']);
assert.equal(search.tests,57);
const fullApp=await run('served-full-app',['--experimental-vm-modules','--test',
 '--test-name-pattern=full app search|Causeway Bay search|every versioned file','tests/startup.test.mjs']);
assert.equal(fullApp.tests,3);
const report={observedAt:new Date().toISOString(),base,commit,version,assets,
 bundle:{path:bundlePath,bytes:bundleBytes.length,sha256:createHash('sha256').update(bundleBytes).digest('hex'),matchesAcceptedBuild:true,expectedBuildInfo:{version,commit,sourceUrl:`https://github.com/c933103/openrailwaystyle/commit/${commit}`}},
 servedSearch:search,servedFullApp:fullApp,
 scope:'First-party GET reads only, redirects rejected. Actual fetched app/map-model and version-coupled module bytes executed with synthetic search responses in DOM/VM/cache fixtures and accepted local dependencies. No live search-provider traffic, native browser launch, screenshot or real-client service-worker interception claim.'};
await writeFile(join(out,'served-verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
