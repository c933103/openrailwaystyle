// Which browser checks a site workflow run needs, and in which parallel jobs.
//
// - A change to anything the site is built from (styles/, the packages, the
//   site workflow and the scripts it or `npm run build` runs) can change
//   every view, since all modules load into one app: every check runs.
// - Otherwise a check runs only when its own files change: the check, the
//   helpers and fixtures it imports or reads. Tests, docs and the other data
//   pipelines run no browser checks; the unit tests always run.
// - A manual run, or a push with nothing to compare against, runs all.
// - A push to main whose code tree and assembled data are exactly those that
//   already passed in its pull request runs no browser checks again (see
//   resultKey; the validate job decides, once the data is assembled). The
//   deployed site is still checked live.
//
//   node scripts/ci-plan.mjs           matrix and browser to $GITHUB_OUTPUT
//   node scripts/ci-plan.mjs key       KEY of this tree and styles/data
//   node scripts/ci-plan.mjs reuse     reused=true when KEY passed in the PR
import {execFileSync} from 'node:child_process';
import {appendFileSync, readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import {dirname, join, normalize} from 'node:path';

// Longest first within a group, no job much longer than the station and map
// checks, which take the longest (about 13 minutes each) and get jobs of
// their own. The world-frequency check replaces the service
// data with fixtures, so it runs alone after `prepare`.
export const GROUPS = [
  {group: 'stations', checks: ['check-major-stations-browser.mjs']},
  {group: 'map', checks: ['check-map-browser.mjs']},
  {group: 'context', checks: ['check-context-browser.mjs', 'check-planning-browser.mjs', 'check-bathymetry-browser.mjs', 'check-globe-browser.mjs', 'check-polar-browser.mjs']},
  {group: 'controls', checks: ['check-map-controls-browser.mjs', 'check-build-browser.mjs', 'check-watch-browser.mjs', 'check-service-frequency-browser.mjs']},
  {group: 'infrastructure', checks: ['check-signal-power-browser.mjs', 'check-platform-browser.mjs', 'check-infrastructure-browser.mjs']},
  {group: 'platforms', checks: ['check-platform-stations-browser.mjs']},
  {group: 'frequency', checks: ['check-world-frequency-browser.mjs', 'check-service-geometry-browser.mjs'], prepare: 'node scripts/rebuild-service-frequency.mjs styles/data/service-routes /tmp/frequency-fixture-credits.html --fixtures'},
];
export const VALIDATED_CONTEXT = 'site/browser-checks';

// Relative files a script imports or reads (import, import(), new URL(..)).
export function localReferences(source, file) {
  const found = new Set();
  for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*|new URL\(\s*)['"`](\.{1,2}\/[^'"`$]+)['"`]/g))
    found.add(normalize(join(dirname(file), match[1].replace(/[?#].*$/, ''))));
  return [...found];
}
// The file and everything it reaches through local references.
export function closure(file, read) {
  const seen = new Set(), queue = [file];
  while (queue.length) {
    const next = queue.pop();
    if (seen.has(next)) continue;
    seen.add(next);
    if (!/\.(mjs|js)$/.test(next)) continue;
    const source = read(next);
    if (source !== null) queue.push(...localReferences(source, next));
  }
  return seen;
}

// The style build writes only committed files under styles/, which the
// validate job requires to be reproducible: its inputs reach the site only
// through those files, so they are not site inputs themselves.
export const COMMITTED_BUILDS = ['scripts/build-style.mjs'];
// Files the site is built from, beyond styles/: the packages, the site
// workflow, this plan, and every script the workflow or package.json runs
// (browser checks and committed builds aside) with what those reach.
export function siteInputs(read) {
  const workflow = read('.github/workflows/site.yml') || '', pkg = read('package.json') || '';
  const scripts = new Set([...`${workflow}\n${pkg}`.matchAll(/scripts\/[\w./-]+\.(?:mjs|js|py)/g)].map(m => m[0]).filter(f => !/^scripts\/check-.*-browser\.mjs$/.test(f) && !COMMITTED_BUILDS.includes(f)));
  const inputs = new Set(['package.json', 'package-lock.json', '.github/workflows/site.yml', 'scripts/ci-plan.mjs']);
  for (const script of scripts) for (const file of closure(script, read)) inputs.add(file);
  return inputs;
}
const isSite = (file, inputs) => (file.startsWith('styles/') && !file.endsWith('.md')) || inputs.has(file);

// changed: changed paths, or null when there is nothing to compare against.
export function plan(changed, read) {
  const all = {groups: GROUPS, reason: ''};
  if (changed === null) return {...all, reason: 'no base to compare against: every check runs'};
  const inputs = siteInputs(read), site = changed.filter(file => isSite(file, inputs));
  if (site.length) return {...all, reason: `the site changes (${site.slice(0, 5).join(', ')}${site.length > 5 ? ', …' : ''}): every check runs`};
  const groups = [];
  for (const {group, checks, prepare} of GROUPS) {
    const affected = checks.filter(check => { const own = closure(`scripts/${check}`, read); return changed.some(file => own.has(file)); });
    if (affected.length) groups.push({group, checks: affected, ...(prepare && {prepare})});
  }
  return {groups, reason: groups.length ? `only these checks' own files change` : 'nothing the browser checks use changes'};
}

export const matrix = groups => ({include: groups.map(({group, checks, prepare = ''}) => ({group, checks: checks.join(' '), prepare}))});

// What a passed result covers: the code tree and every file of the assembled
// data (snapshot branches and releases move on their own, so the same code
// can deploy different data). The rest of styles/ is built from the tree;
// its code bundle embeds the commit, so it is not hashed.
export async function dataDigest(directory) {
  const files = [];
  const walk = async dir => { for (const entry of await readdir(dir, {withFileTypes: true})) { const path = join(dir, entry.name); if (entry.isDirectory()) await walk(path); else if (entry.isFile()) files.push(path); } };
  await walk(directory);
  const digest = createHash('sha256');
  for (const file of files.sort()) digest.update(`${file.slice(directory.length)}\0${createHash('sha256').update(await readFile(file)).digest('hex')}\n`);
  return digest.digest('hex');
}
export const resultKey = (tree, data) => `tree ${tree} data ${data.slice(0, 32)}`;

// The pull request merged by this push whose head passed with the same key.
export async function validatedPull({repo, sha, key, token, fetcher = fetch}) {
  const get = async path => {
    const response = await fetcher(`https://api.github.com/repos/${repo}/${path}`, {headers: {authorization: `Bearer ${token}`, accept: 'application/vnd.github+json'}});
    if (!response.ok) throw new Error(`GitHub API ${path} returned ${response.status}`);
    return response.json();
  };
  for (const pull of await get(`commits/${sha}/pulls`)) {
    if (!pull.merged_at) continue;
    const statuses = await get(`commits/${pull.head.sha}/statuses?per_page=100`);
    // The newest status for the context decides.
    const latest = statuses.find(status => status.context === VALIDATED_CONTEXT);
    if (latest?.state === 'success' && latest.description === key) return pull.number;
  }
  return null;
}

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
function changedFiles(event, before) {
  try {
    let base;
    if (event === 'pull_request') base = 'HEAD^1'; // the test merge's base side
    else if (event === 'push' && before && !/^0+$/.test(before)) {
      git('fetch', '--no-tags', '--depth=1', 'origin', before);
      base = before;
    } else return null;
    return git('diff', '--name-only', base, 'HEAD').split('\n').filter(Boolean);
  } catch (error) {
    console.log(`Could not compare with the base: ${error.message.split('\n')[0]}`);
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const {EVENT, BEFORE, REF, REPO, SHA, KEY, GITHUB_TOKEN, GITHUB_OUTPUT} = process.env;
  const output = text => { if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, text); };
  const command = process.argv[2];
  if (command === 'key') {
    const key = resultKey(git('rev-parse', 'HEAD^{tree}'), await dataDigest('styles/data'));
    console.log(`Result key: ${key}`);output(`key=${key}\n`);
  } else if (command === 'reuse') {
    let pull = null;
    if (EVENT === 'push' && REF === 'refs/heads/main') {
      try { pull = await validatedPull({repo: REPO, sha: SHA, key: KEY, token: GITHUB_TOKEN}); }
      catch (error) { console.log(`Could not look up an earlier result: ${error.message}`); }
    }
    console.log(pull ? `This code and data passed every needed browser check in pull request #${pull}` : 'No earlier result for this code and data');
    output(`reused=${pull !== null}\n`);
  } else {
    const read = file => existsSync(file) ? readFileSync(file, 'utf8') : null;
    const result = plan(changedFiles(EVENT, BEFORE), read);
    console.log(`Browser checks: ${result.reason}`);
    for (const {group, checks} of result.groups) console.log(`  ${group}: ${checks.join(', ')}`);
    output(`matrix=${JSON.stringify(matrix(result.groups))}\nbrowser=${result.groups.length > 0}\n`);
  }
}
