import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// The rare Han slices are cut from a pinned Jigmo archive. The site build
// takes this repository's own copy (release font-sources) first, so it does
// not depend on the upstream site; font-sources.yml keeps that copy. These
// run the workflows' real shell with stand-ins for gh, curl and python: no
// network request is made.
const root = new URL('../', import.meta.url);
const script = new URL('scripts/build-rare-han.py', root);
const workflow = name => readFile(new URL(`.github/workflows/${name}`, root), 'utf8');
const step = (source, name) => {
  const block = source.split(`      - name: ${name}\n`)[1];
  assert.ok(block, `step ${name}`);
  return block.split('        run: |\n')[1].split(/\n(?=      - |\n|\S)/)[0]
    .split('\n').map(line => line.replace(/^          /, '')).join('\n');
};

test('--source prints the pinned archive without needing fontTools', async () => {
  const result = spawnSync('python3', ['-I', script.pathname, '--source'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  const [name, url, sha] = result.stdout.trim().split(' ');
  const source = await readFile(script, 'utf8');
  const release = /^RELEASE = "(\d+)"$/m.exec(source)[1];
  assert.equal(name, `Jigmo-${release}.zip`);
  assert.equal(url, `https://kamichikoichi.github.io/jigmo/${name}`);
  assert.equal(sha, /^SHA256 = "([0-9a-f]{64})"$/m.exec(source)[1]);
  assert.match(source, /^def slices\(font_bytes\):\n(?:.*\n){1}    from fontTools import subset\n/m, 'fontTools is imported only to cut slices');
});

async function fixture(t, {kept = false, release = true} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-font-sources-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await mkdir(join(dir, 'bin'));
  await mkdir(join(dir, 'scripts'));
  const archive = Buffer.from('synthetic archive bytes');
  const sha = createHash('sha256').update(archive).digest('hex');
  await writeFile(join(dir, 'archive'), archive);
  const log = join(dir, 'calls');
  // python/python3: --source answers for the fixture; a build call is logged.
  const python = `#!/bin/bash\nif [ "$2" = --source ]; then echo "Jigmo-1.zip https://upstream.invalid/Jigmo-1.zip ${sha}"; exit; fi\necho "python $*" >> ${log}\n`;
  for (const name of ['python', 'python3']) await writeFile(join(dir, 'bin', name), python, {mode: 0o755});
  await writeFile(join(dir, 'bin/pip'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
  await writeFile(join(dir, 'bin/curl'), `#!/bin/bash\necho "curl $*" >> ${log}\nwhile [ $# -gt 0 ]; do if [ "$1" = -o ]; then cp ${dir}/archive "$2"; shift; fi; shift; done\n`, {mode: 0o755});
  await writeFile(join(dir, 'bin/gh'), `#!/bin/bash\necho "gh $*" >> ${log}\ncase "$1 $2" in
  'release view') ${release ? (kept ? 'echo Jigmo-1.zip' : 'echo other.zip') : 'exit 1'} ;;
  'release download') ${kept ? 'while [ $# -gt 0 ]; do if [ "$1" = --dir ]; then mkdir -p "$2"; cp ' + dir + '/archive "$2/Jigmo-1.zip"; fi; shift; done' : 'exit 1'} ;;
  'release create'|'release upload') ;;
  *) exit 91 ;;
esac\n`, {mode: 0o755});
  const run = command => spawnSync('bash', ['-e', '-c', command.replaceAll('/tmp/', `${dir}/tmp/`)], {
    cwd: dir, encoding: 'utf8',
    env: {...process.env, PATH: `${dir}/bin:${process.env.PATH}`, GITHUB_REPOSITORY: 'owner/repo', GITHUB_SHA: 'fixture', GH_TOKEN: 'x'},
  });
  await mkdir(join(dir, 'tmp'));
  const calls = async () => { try { return (await readFile(log, 'utf8')).trim().split('\n'); } catch { return []; } };
  return {dir, run, calls};
}

test('the site build cuts the slices from the repository\'s own copy when it is kept', async t => {
  const {dir, run, calls} = await fixture(t, {kept: true});
  const result = run(step(await workflow('site.yml'), 'Build rare Han glyph slices'));
  assert.equal(result.status, 0, result.stderr);
  const log = await calls();
  assert.ok(log.includes('gh release download font-sources --repo owner/repo --pattern Jigmo-1.zip --dir /tmp/font-sources'.replace('/tmp/', `${dir}/tmp/`)));
  assert.deepEqual(log.filter(line => line.startsWith('python')), [`python scripts/build-rare-han.py ${dir}/tmp/font-sources/Jigmo-1.zip`]);
  assert.ok(!log.some(line => line.startsWith('curl')));
  assert.doesNotMatch(result.stdout, /::warning::/);
});

test('without a kept copy the site build downloads upstream, with a warning', async t => {
  const {run, calls} = await fixture(t, {kept: false});
  const result = run(step(await workflow('site.yml'), 'Build rare Han glyph slices'));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await calls()).filter(line => line.startsWith('python')), ['python scripts/build-rare-han.py']);
  assert.match(result.stdout, /::warning::No copy of Jigmo-1\.zip in release font-sources; downloading https:\/\/upstream\.invalid\/Jigmo-1\.zip/);
});

test('font-sources.yml keeps the archive once, checked against the pinned SHA-256', async t => {
  const keep = step(await workflow('font-sources.yml'), 'Keep the pinned Jigmo archive');
  const first = await fixture(t, {release: false});
  const made = first.run(keep);
  assert.equal(made.status, 0, made.stderr);
  const log = await first.calls();
  assert.ok(log.some(line => line.startsWith('curl -fsSL --proto =https ') && line.endsWith(' https://upstream.invalid/Jigmo-1.zip')));
  assert.ok(log.some(line => line.startsWith('gh release create font-sources --target fixture --prerelease')));
  assert.ok(log.includes(`gh release upload font-sources ${first.dir}/tmp/Jigmo-1.zip`));
  const kept = await fixture(t, {kept: true});
  const again = kept.run(keep);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /already kept/);
  assert.ok(!(await kept.calls()).some(line => line.startsWith('curl') || line.includes('upload')), 'nothing downloaded or uploaded again');
});

test('font-sources.yml refuses an archive whose SHA-256 differs', async t => {
  const keep = step(await workflow('font-sources.yml'), 'Keep the pinned Jigmo archive');
  const {dir, run, calls} = await fixture(t, {release: true});
  await writeFile(join(dir, 'archive'), 'changed upstream bytes');
  const result = run(keep);
  assert.notEqual(result.status, 0);
  assert.ok(!(await calls()).some(line => line.includes('release upload')), 'a changed archive is never kept');
});

test('only the manual font-sources job may write, and the site build stays read-only', async () => {
  const keep = await workflow('font-sources.yml');
  assert.match(keep, /^on:\n  workflow_dispatch:\npermissions:\n  contents: read\n/m);
  assert.match(keep, /^  keep:\n(?:.*\n)*?    permissions:\n      contents: write\n/m);
  const site = await workflow('site.yml');
  const validate = site.split(/^  validate:\s*$/m)[1].split(/^  [a-z-]+:\s*$/m)[0];
  assert.match(validate, /    permissions:\n      contents: read\n/);
  assert.doesNotMatch(validate, /contents: write/);
});
