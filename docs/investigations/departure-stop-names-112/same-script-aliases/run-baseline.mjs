// Run the current regression suite against the pinned predecessor without
// changing the checked-out production module. No external provider requests.
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const root = new URL('../../../../', import.meta.url);
const ref = 'd252a702de3cdd322e2f5c0a9bb4e5db3a37d079';
const source = execFileSync('git', ['show', `${ref}:styles/departures.mjs`], {cwd:root});
const suite = readFileSync(new URL('tests/departure-stop-names.test.mjs', root), 'utf8')
  .replace("'../styles/departures.mjs'", JSON.stringify(`data:text/javascript;base64,${source.toString('base64')}`));
const directory = mkdtempSync(join(tmpdir(), 'atlas-stop-name-baseline-'));
try {
  const file = join(directory, 'stop-names.test.mjs');
  writeFileSync(file, suite);
  const result = spawnSync(process.execPath, ['--test', file], {stdio:'inherit'});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {rmSync(directory, {recursive:true});}
