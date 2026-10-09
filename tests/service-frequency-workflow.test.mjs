import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const workflow=await readFile(new URL('../.github/workflows/service-frequency.yml',import.meta.url),'utf8');
const jobs=workflow.split('\njobs:\n')[1];
const job=name=>{
  const match=jobs.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|(?![\\s\\S]))`,'m'));
  assert.ok(match,`Missing ${name} job`);
  return match[1];
};
const globalFixtures=await readFile(new URL('./global-frequency.test.mjs',import.meta.url),'utf8');

test('reconciled catalogue fixtures run inside the isolated PR test process',()=>{
  assert.match(job('validate-pr'),/tests\/global-frequency\.test\.mjs/);
  assert.match(globalFixtures,/'python3',\['-m','unittest','discover','-s','tests','-p','frequency_catalogue_test\.py'\]/);
  const push=workflow.split('  push:\n')[1].split('  workflow_dispatch:')[0];
  const pr=workflow.split('  pull_request:\n')[1].split('permissions:')[0];
  for(const trigger of [push,pr])assert.ok(trigger.includes('scripts/frequency_catalogue.py'));
  assert.ok(pr.includes("'tests/*frequency*'"));
  assert.ok(pr.includes('docs/service-frequency.md'));
  assert.doesNotMatch(push,/tests\//,'fixture-only changes do not start production acquisition');
});

test('production consumes the same normalized catalogue and publishes no per-feed copies',()=>{
  assert.match(job('catalogue'),/--output catalogue\/catalogue\.json/);
  for(const name of ['catalogue','compile'])assert.match(job(name),/--catalogue catalogue\/catalogue\.json/);
  assert.match(job('publish'),/tar -czf frequency-snapshot\.tar\.gz -C frequency-output manifest\.json inventory\.json tiles/);
  assert.doesNotMatch(job('publish'),/tar .*\bfeeds\b/);
});

test('PR frequency validation executes immutable PR head without retained credentials',()=>{
  const validate=job('validate-pr');
  assert.match(validate,/if: github\.event_name == 'pull_request'/);
  assert.match(validate,/ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(validate,/persist-credentials: false/);
  assert.match(validate,/npm ci --ignore-scripts --no-audit --no-fund/);
  assert.doesNotMatch(workflow,/pull_request_target:|secrets\./);
  assert.doesNotMatch(validate,/permissions:|(?:GITHUB|GH)_TOKEN|github\.token|continue-on-error/);
  assert.match(workflow,/^permissions:\n  contents: read\n/m);
});

test('only production events can enter worldwide acquisition, assembly and publication',()=>{
  for(const name of ['catalogue','compile','assemble']){
    assert.match(job(name),/^    if: github\.event_name != 'pull_request'\n/);
  }
  assert.match(job('compile'),/needs: catalogue/);
  assert.match(job('assemble'),/needs: \[catalogue, compile\]/);
  assert.match(job('publish'),/needs: assemble/);
  assert.match(job('publish'),/if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request'/);
  assert.match(workflow,/schedule:\n    - cron: '41 2 \* \* 1'/);
  assert.match(workflow,/workflow_dispatch:\n    inputs:\n      service_date:/);
});

test('PR fixture command exercises compiler, assembly, streaming and service semantics without egress',()=>{
  const validate=job('validate-pr');
  assert.match(validate,/sudo unshare --net -- bash -euc/);
  assert.match(validate,/ip link set lo up/);
  assert.match(validate,/exec setpriv --reuid="\$1" --regid="\$2" --init-groups --no-new-privs/);
  assert.match(validate,/"\$3" --test/);
  for(const file of ['global-frequency','gtfs-frequency','gtfs-service','read-frequency-feed','pbf-utf8','service-frequency','service-routes','frequency-credits','service-frequency-workflow']){
    assert.ok(validate.includes(`tests/${file}.test.mjs`),`${file} must run`);
  }
  assert.doesNotMatch(validate,/curl |git (?:fetch|clone)|actions\/(?:cache|download-artifact)|\|\| true/);
});

test('production keeps complete inventory gates, eight shards, caches and bounded assembly',()=>{
  assert.match(job('catalogue'),/--inventory-only/);
  assert.match(job('compile'),/shard: \[0, 1, 2, 3, 4, 5, 6, 7\]/);
  assert.match(job('compile'),/fail-fast: false/);
  assert.match(job('compile'),/timeout-minutes: 180/);
  assert.match(job('compile'),/restore-keys: worldwide-gtfs-\$\{\{ matrix\.shard \}\}-/);
  assert.match(job('assemble'),/timeout-minutes: 90/);
  assert.match(job('assemble'),/node --max-old-space-size=5500 scripts\/assemble-global-frequency\.mjs frequency-output/);
  assert.match(workflow,/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
});

test('PR concurrency is isolated by number and cannot cancel a production refresh',()=>{
  const expression=workflow.match(/^  group: worldwide-frequency-\$\{\{ (.+) \}\}$/m)?.[1];
  assert.ok(expression,'the production group prefix must remain unchanged');
  const group=(event,number,head='feature',ref='refs/heads/main')=>
    'worldwide-frequency-'+vm.runInNewContext(expression,{
      github:{event_name:event,head_ref:head,ref,event:{pull_request:{number}}},
      format:(pattern,value)=>pattern.replace('{0}',value),
    });
  assert.equal(group('pull_request',12),'worldwide-frequency-pr-12');
  assert.notEqual(group('pull_request',12,'same-name'),group('pull_request',13,'same-name'),
    'different forks with the same branch name must not cancel each other');
  assert.notEqual(group('pull_request',12,'refs/heads/main'),group('push'),
    'a PR branch name must not collide with the production refresh');
  for(const event of ['push','schedule','workflow_dispatch']){
    assert.equal(group(event),'worldwide-frequency-refs/heads/main',
      `${event} retains the existing production queue`);
  }
});
