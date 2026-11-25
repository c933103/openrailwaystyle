import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {awaitPagesArtifact} from '../scripts/await-pages-artifact.mjs';

const workflow = readFileSync(new URL('../.github/workflows/site.yml', import.meta.url), 'utf8');
const steps = workflow.split(/(?=^      - )/m);
const step = action => {
  const matches = steps.filter(source => source.includes(`uses: ${action}\n`));
  assert.equal(matches.length, 1, `one ${action} step`);
  return matches[0];
};
const input = (source, key, fallback) => source.match(new RegExp(`^          ${key}: (.+)$`, 'm'))?.[1] ?? fallback;
const upload = input(step('actions/upload-pages-artifact@v3'), 'name', 'github-pages');
const deploy = input(step('actions/deploy-pages@v4'), 'artifact_name', 'github-pages');
const render = (name, run, attempt) => name
  .replaceAll('${{ github.run_id }}', String(run))
  .replaceAll('${{ github.run_attempt }}', String(attempt));

const name = render(upload, 41845397720, 2);
const pkg = {id: 22, name, size_in_bytes: 100, expired: false};
const previous = {...pkg,id:21,name:render(upload,41845397720,1)};
const valid = {apiURL:'https://api.github.com',repository:'c933103/openrailwaystyle',
  runId:'41845397720',attempt:'2',artifactId:'22',token:'test-only-token',
  delays:[0,2,4],settlingDelay:12,sleep:async()=>{}};
const response = artifacts=>({ok:true,json:async()=>({artifacts})});

test('Pages upload and deployment use the same run-and-attempt identity', () => {
  assert.equal(upload, 'github-pages-${{ github.run_id }}-${{ github.run_attempt }}');
  assert.equal(deploy, upload);
  const uploadStep=step('actions/upload-pages-artifact@v3');
  const deployStep=step('actions/deploy-pages@v4');
  assert.match(uploadStep,/id: pages-upload/);
  const guard=steps.find(source=>source.includes('node scripts/await-pages-artifact.mjs'));
  assert.ok(steps.indexOf(uploadStep)<steps.indexOf(guard) && steps.indexOf(guard)<steps.indexOf(deployStep));
  assert.match(guard,/PAGES_ARTIFACT_ID: \$\{\{ steps.pages-upload.outputs.artifact_id \}\}/);
});

test('visibility lag waits for the exact current package without discarding earlier attempts', async()=>{
  const history=[], old=[previous,{...previous,id:10,name:'github-pages'}];
  const cases = [old,[...old,{...pkg,size_in_bytes:0}],[...old,pkg]];
  const result=await awaitPagesArtifact({...valid,sleep:async ms=>history.push(ms),fetcher:async (url,opts)=>{
    assert.equal(url.href,`https://api.github.com/repos/c933103/openrailwaystyle/actions/runs/41845397720/artifacts?name=${name}`);
    assert.equal(opts.redirect,'error');
    return response(cases.shift());
  }});
  assert.deepEqual(result,{artifactName:name,artifactId:'22'});
  assert.deepEqual(history,[2,4,12],'allow the internal index to settle after REST verification');
  assert.equal(old.length,2);
});

test('transient artifact lookup errors retry, but missing packages fail closed', async()=>{
  let calls=0;
  await assert.rejects(awaitPagesArtifact({...valid,fetcher:async()=>{
    if(++calls===1)throw new Error('timeout');
    if(calls===2)return {ok:false,status:503};
    return response([previous]);
  }}),/never became visible: not listed/);
  assert.equal(calls,3);
});

test('permanent permissions errors and wrong, expired or ambiguous ids stop immediately', async()=>{
  for (const [bad,expected] of [
    [{ok:false,status:403},/HTTP 403/],
    [response([{...pkg,id:99}]),/not the artifact just uploaded/],
    [response([{...pkg,expired:true}]),/has expired/],
    [response([pkg,{...pkg,id:88}]),/Multiple artifacts/],
  ]) {
    let calls=0;
    await assert.rejects(awaitPagesArtifact({...valid,fetcher:async()=>{calls++;return bad;}}),expected);
    assert.equal(calls,1);
  }
});

test('the deploy job keeps consuming the existing tested site artifact', () => {
  const deployJob = workflow.slice(workflow.indexOf('\n  deploy:\n'));
  const download = deployJob.split(/(?=^      - )/m).find(source => source.includes('uses: actions/download-artifact@v4\n'));
  assert.ok(download, 'deploy downloads the previously validated site');
  assert.equal(input(download, 'name'), 'railway-world-site');
  assert.equal(input(download, 'path'), 'styles');
});
