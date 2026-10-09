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
  for(const trigger of [push,pr]){
    for(const source of ['scripts/frequency_catalogue.py','scripts/frequency_retry.py'])assert.ok(trigger.includes(source));
  }
  assert.ok(pr.includes("'tests/*frequency*'"));
  assert.ok(pr.includes('docs/service-frequency.md'));
  assert.doesNotMatch(push,/tests\//,'fixture-only changes do not start production acquisition');
});

test('production consumes the same normalized catalogue and publishes no per-feed copies',()=>{
  assert.match(job('catalogue'),/--output catalogue\/catalogue\.json/);
  for(const name of ['catalogue','compile']){
    assert.match(job(name),/--catalogue catalogue\/catalogue\.json/);
    assert.match(job(name),/--catalogue-report catalogue\/catalogue-report\.json/);
  }
  assert.match(globalFixtures,/frequency_provenance_test\.py/);
  assert.match(job('publish'),/tar -czf frequency-snapshot\.tar\.gz -C frequency-output manifest\.json inventory\.json tiles/);
  assert.doesNotMatch(job('publish'),/tar .*\bfeeds\b/);
});

test('catalogue acquisition has explicit time ceilings and fails closed before publication',()=>{
  const catalogue=job('catalogue');
  assert.match(catalogue,/timeout-minutes: 30/);
  assert.match(catalogue,/timeout --signal=TERM --kill-after=30s 600 git clone/);
  assert.match(catalogue,/timeout --signal=TERM --kill-after=30s 600 git -C catalogue\/transitous sparse-checkout/);
  assert.match(catalogue,/curl --fail --retry 3 --retry-all-errors --retry-max-time 900 --location --max-time 300/);
  assert.doesNotMatch(catalogue,/continue-on-error|\|\| true/);
  for(const name of ['compile','assemble','publish'])assert.doesNotMatch(job(name).split('    steps:')[0],/always\(/);
  assert.match(job('compile'),/needs: catalogue/);
  assert.match(job('assemble'),/needs: \[catalogue, compile\]/);
  assert.match(job('publish'),/needs: assemble/);
});

test('PR and push frequency validation execute immutable code without retained credentials',()=>{
  const validate=job('validate-pr');
  assert.match(validate,/if: github\.event_name == 'pull_request' \|\| github\.event_name == 'push'/);
  const expression=validate.match(/ref: \$\{\{ (.+) \}\}/)?.[1];
  assert.ok(expression);
  const checkout=(event)=>vm.runInNewContext(expression,{github:{event_name:event,
    sha:'immutable-push-sha',event:{pull_request:{head:{sha:'immutable-pr-head-sha'}}}}});
  assert.equal(checkout('pull_request'),'immutable-pr-head-sha');
  assert.equal(checkout('push'),'immutable-push-sha');
  assert.match(validate,/persist-credentials: false/);
  assert.match(validate,/npm ci --ignore-scripts --no-audit --no-fund/);
  assert.doesNotMatch(workflow,/pull_request_target:|secrets\./);
  assert.doesNotMatch(validate,/permissions:|(?:GITHUB|GH)_TOKEN|github\.token|continue-on-error/);
  assert.match(workflow,/^permissions:\n  contents: read\n/m);
});

test('only scheduled or explicitly dispatched refreshes can enter acquisition and publication',()=>{
  for(const name of ['catalogue','compile','assemble']){
    assert.match(job(name),/^    if: github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'\n/);
  }
  assert.match(job('compile'),/needs: catalogue/);
  assert.match(job('assemble'),/needs: \[catalogue, compile\]/);
  assert.match(job('publish'),/needs: assemble/);
  assert.match(job('publish'),/if: github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'\)/);
  assert.match(workflow,/schedule:\n    - cron: '41 2 \* \* 1'/);
  assert.match(workflow,/workflow_dispatch:\n    inputs:\n      service_date:/);
});

test('event and dependency contracts preserve required offline checks and complete production DAG',()=>{
  const names=['validate-pr','catalogue','compile','assemble','publish'];
  const simulate=(event,{ref='refs/heads/main',failed}={})=>{
    const status={};
    for(const name of names){
      const body=job(name),condition=body.match(/^    if: (.+)$/m)?.[1];
      assert.ok(condition,`${name} requires an explicit event gate`);
      const needs=body.match(/^    needs: (.+)$/m)?.[1]?.replace(/[\[\]]/g,'').split(',').map(s=>s.trim())||[];
      const eligible=vm.runInNewContext(condition,{github:{event_name:event,ref}});
      status[name]=!eligible||needs.some(n=>status[n]!=='success')?'skipped':name===failed?'failure':'success';
    }
    return status;
  };
  for(const event of ['pull_request','push'])assert.deepEqual(simulate(event),{
    'validate-pr':'success',catalogue:'skipped',compile:'skipped',assemble:'skipped',publish:'skipped',
  });
  for(const event of ['schedule','workflow_dispatch']){
    assert.deepEqual(simulate(event),{
      'validate-pr':'skipped',catalogue:'success',compile:'success',assemble:'success',publish:'success',
    });
    for(const failed of ['catalogue','compile','assemble']){
      const result=simulate(event,{failed});
      assert.equal(result[failed],'failure');
      assert.equal(result.publish,'skipped',`failed ${failed} must preserve the previous release`);
    }
  }
  assert.equal(simulate('workflow_dispatch',{ref:'refs/heads/feature'}).publish,'skipped');
  assert.ok(Object.values(simulate('release')).every(value=>value==='skipped'));
  assert.equal(simulate('push',{failed:'validate-pr'})['validate-pr'],'failure');
  assert.doesNotMatch(job('validate-pr'),/continue-on-error|\|\| true/);
});

test('relevant source pushes stay covered while docs and test-only pushes avoid acquisition',()=>{
  const push=workflow.split('  push:\n')[1].split('  workflow_dispatch:')[0];
  const pr=workflow.split('  pull_request:\n')[1].split('permissions:')[0];
  assert.match(push,/branches: \[main\]/);
  for(const file of ['scripts/gtfs-frequency.py','scripts/frequency_catalogue.py','scripts/frequency_retry.py',
    '.github/workflows/service-frequency.yml'])assert.ok(push.includes(file));
  assert.doesNotMatch(push,/docs\/|tests\//);
  assert.ok(pr.includes('docs/service-frequency.md'));
  assert.ok(pr.includes("'tests/*frequency*'"));
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
  assert.match(job('compile'),/path: \|\n            frequency-cache\n            frequency-output\/feeds/,'Retry-After receipts share the existing retained shard cache');
  assert.match(job('assemble'),/timeout-minutes: 90/);
  assert.match(job('assemble'),/node --max-old-space-size=5500 scripts\/assemble-global-frequency\.mjs frequency-output/);
  assert.match(workflow,/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \|\| github\.event_name == 'push' \}\}/);
});

test('PR and push concurrency cannot replace or cancel a production refresh',()=>{
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
  assert.notEqual(group('pull_request',12,'refs/heads/main'),group('schedule'),
    'a PR branch name must not collide with the production refresh');
  assert.equal(group('push'),'worldwide-frequency-push-refs/heads/main');
  assert.notEqual(group('push'),group('schedule'),
    'an offline push must not replace queued production work');
  assert.notEqual(group('push'),group('pull_request',12));
  for(const event of ['schedule','workflow_dispatch']){
    assert.equal(group(event),'worldwide-frequency-refs/heads/main',
      `${event} retains the existing production queue`);
  }
  const cancel=workflow.match(/^  cancel-in-progress: \$\{\{ (.+) \}\}$/m)?.[1];
  for(const event of ['pull_request','push','schedule','workflow_dispatch']){
    assert.equal(vm.runInNewContext(cancel,{github:{event_name:event}}),
      ['pull_request','push'].includes(event));
  }
});

test('reference metadata is fetched at the immutable gitlink without upstream executables',()=>{
  assert.match(workflow,/scripts\/frequency_references\.py/);
  assert.match(workflow,/ls-tree "\$transitous_ref" transitland-atlas/);
  assert.match(workflow,/fetch --quiet --depth=1 --filter=blob:none origin "\$transitland_ref"/);
  assert.match(workflow,/test "\$\(git -C catalogue\/transitland rev-parse HEAD\)" = "\$transitland_ref"/);
  assert.match(workflow,/--transitland-feeds-directory "\$transitland_feeds" --transitland-ref "\$transitland_ref"/);
  assert.doesNotMatch(workflow,/git submodule update|src\/fetch\.py/);
  assert.match(workflow,/unavailable-transitland-feeds/);
});
