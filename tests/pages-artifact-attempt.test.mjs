import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

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

// Synthetic version of deploy-pages' exact-name/count requirement. Old
// artifacts are deliberately retained: absence and ambiguity must still fail.
const select = (artifacts, name) => {
  const matches = artifacts.filter(artifact => artifact.name === name);
  assert.equal(matches.length, 1, 'exactly one Pages artifact must match');
  return matches[0];
};

test('Pages upload and deployment use the same run-and-attempt identity', () => {
  assert.equal(upload, 'github-pages-${{ github.run_id }}-${{ github.run_attempt }}');
  assert.equal(deploy, upload);
});

test('a first attempt selects its own uploaded package', () => {
  const artifact = {id: 1, name: render(upload, 41845397720, 1)};
  assert.equal(select([artifact], render(deploy, 41845397720, 1)), artifact);
});

test('deploy-only retries select the new package without removing old evidence', () => {
  const artifacts = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const artifact = {id: 20 + attempt, name: render(upload, 41845397720, attempt)};
    artifacts.push(artifact);
    assert.equal(select(artifacts, render(deploy, 41845397720, attempt)), artifact);
  }
  // Historical packages from the legacy default name cannot cause ambiguity.
  artifacts.push({id: 10, name: 'github-pages'}, {id: 11, name: 'github-pages'});
  assert.equal(select(artifacts, render(deploy, 41845397720, 3)).id, 23);
  assert.equal(artifacts.length, 5, 'all earlier packages remain available');
});

test('a missing current-attempt package cannot fall back to an older one', () => {
  const previous = {id: 1, name: render(upload, 41845397720, 1)};
  assert.throws(() => select([previous], render(deploy, 41845397720, 2)), /exactly one Pages artifact/);
});

test('duplicate current-attempt packages still fail instead of choosing one', () => {
  const name = render(upload, 41845397720, 2);
  assert.throws(() => select([{id: 1, name}, {id: 2, name}], render(deploy, 41845397720, 2)), /exactly one Pages artifact/);
});

test('the deploy job keeps consuming the existing tested site artifact', () => {
  const deployJob = workflow.slice(workflow.indexOf('\n  deploy:\n'));
  const download = deployJob.split(/(?=^      - )/m).find(source => source.includes('uses: actions/download-artifact@v4\n'));
  assert.ok(download, 'deploy downloads the previously validated site');
  assert.equal(input(download, 'name'), 'railway-world-site');
  assert.equal(input(download, 'path'), 'styles');
});
