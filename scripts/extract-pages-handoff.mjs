import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {appendFile, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkMarker, extractBranch, parseConfig, parseFile, settings, SOURCES_FILE} from './data-source.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha256 = /^[a-f0-9]{64}$/;
const gitOid = /^[a-f0-9]{40}$/;
const ordered = entries => entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
const label = 'Retain verified extract generation ';
const repo = process.env.GITHUB_REPOSITORY;

export function inputIdentity(index, builder, polar) {
  if (!gitOid.test(builder) || !(polar === null || gitOid.test(polar))) throw Error('Invalid builder or polar tree');
  const regions = ordered(Object.entries(index.regions ?? {}));
  if (!regions.length || regions.some(([, value]) => !sha256.test(value.sha256) || !value.sourceTimestamp))
    throw Error('Extract inputs need a digest and source time for each region');
  return hash({regions: regions.map(([id, value]) => [id, value.sha256, value.sourceTimestamp,
    index.polygons?.[id] ?? null]), builder, polar});
}

export async function selectedGeneration(chosen, read) {
  const entries = ordered(Object.entries(chosen));
  const pinned = Object.fromEntries(await Promise.all(entries.map(async ([id, value]) => {
    if (value.source !== 'extract') return [id, null];
    const branch = extractBranch(id);
    const item = await read(branch);
    if (!item || checkMarker(item.marker, id)) return [id, null];
    const content = JSON.parse(item.marker);
    if (!gitOid.test(item.ref)) throw Error('Missing branch commit for ' + id);
    if (content.inputSha256 !== undefined && !sha256.test(content.inputSha256))
      throw Error('Invalid extracted input identity for ' + id);
    // Older markers have no stable input identity. Use their exact branch
    // commit until the first assembly writes the identity.
    return [id, {ref: item.ref, identity: content.inputSha256 ?? item.ref}];
  })));
  const selected = Object.entries(pinned).filter(([, value]) => value !== null);
  return {generation: selected.length ? hash(selected.map(([id, value]) => [id, value.identity])) : null,
    commits: Object.fromEntries(selected.map(([id, value]) => [id, value.ref]))};
}

export async function lastVerifiedGeneration(runs, readJobs) {
  for (const run of [...runs].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))) {
    if (run.head_branch !== 'main' || run.event === 'pull_request' || run.conclusion !== 'success') continue;
    const deploy = (await readJobs(run.id, run.run_attempt)).find(job => job.name === 'deploy' && job.conclusion === 'success');
    if (!deploy) continue;
    const step = deploy.steps.find(s => s.conclusion === 'success' && s.name.startsWith(label));
    const generation = step?.name.slice(label.length);
    // A newer ordinary deployment has no verified identity for this handoff.
    // Do not let a historic receipt override it.
    return sha256.test(generation ?? '') ? generation : null;
  }
  return null;
}

function github(path, notFoundOk = false, raw = false) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !process.env.GITHUB_API_URL || !process.env.GH_TOKEN)
    throw Error('Missing trusted GitHub runner inputs');
  return fetch(process.env.GITHUB_API_URL + '/repos/' + repo + '/' + path, {
    redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: {Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      Authorization: 'Bearer ' + process.env.GH_TOKEN},
  }).then(response => {
    if (notFoundOk && response.status === 404) return null;
    if (!response.ok) throw Error('GitHub could not read ' + path + ': HTTP ' + response.status);
    return raw ? response.text() : response.json();
  });
}
async function remote(branch) {
  const reference = await github('git/ref/heads/' + encodeURIComponent(branch), true);
  if (!reference) return null;
  const ref = reference.object?.sha;
  if (!gitOid.test(ref)) throw Error('Invalid published commit for ' + branch);
  return {ref, marker: await github('contents/source.json?ref=' + ref, true, true)};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [phase, indexPath] = process.argv.slice(2);
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw Error('The Pages handoff runs only on main');
  if (phase === 'stamp') {
    const index = JSON.parse(await readFile(indexPath, 'utf8'));
    const marker = JSON.parse(await readFile('source.json', 'utf8'));
    // The published polar directory is already staged and copied byte for
    // byte from the known source, independent of the regional inputs.
    const tree = git => execFileSync('git', git, {encoding:'utf8'}).trim();
    const builder = tree(['-C', process.env.GITHUB_WORKSPACE, 'rev-parse', 'HEAD:scripts']);
    const root = tree(['write-tree']);
    const polar = tree(['ls-tree', root, 'polar']).split(/\s+/)[2] ?? null;
    marker.inputSha256 = inputIdentity(index, builder, polar);
    await writeFile('source.json', JSON.stringify(marker, null, 2) + '\n');
  } else {
    const chosen = settings(parseFile(await readFile(SOURCES_FILE, 'utf8')), parseConfig(process.env.DATA_SOURCES));
    const current = await selectedGeneration(chosen, remote);
    if (phase === 'request') {
      const previous = current.generation ? await lastVerifiedGeneration(
        (await github('actions/workflows/site.yml/runs?branch=main&status=success&per_page=12')).workflow_runs,
        async (id, attempt) => (await github('actions/runs/' + id + '/attempts/' + attempt + '/jobs?per_page=100')).jobs) : null;
      const pending = current.generation && current.generation !== previous ? current.generation : '';
      await appendFile(process.env.GITHUB_OUTPUT, 'generation=' + pending + '\n');
      console.log(pending ? 'A complete held extract generation is not the last verified Pages generation.' :
        'No selected complete extract generation needs a Pages request.');
    } else if (phase === 'pin' || phase === 'check') {
      const expected = process.env.EXPECTED_EXTRACT_GENERATION;
      if (!sha256.test(expected ?? '') || current.generation !== expected)
        throw Error('Selected complete extract generation differs from requested generation');
      const path = join(process.env.RUNNER_TEMP, 'pages-extract-pins.json');
      if (phase === 'pin') await writeFile(path, JSON.stringify(current.commits));
      else {
        if (await readFile(path, 'utf8') !== JSON.stringify(current.commits))
          throw Error('Selected extract refs changed while building the site');
        const used = JSON.parse(await readFile(join(process.env.RUNNER_TEMP, 'data-sources.json'), 'utf8'));
        const extracts = used.filter(row => row.source === 'extract').map(row => row.id).sort();
        if (JSON.stringify(extracts) !== JSON.stringify(Object.keys(current.commits)))
          throw Error('A pinned extract was not actually selected during staging');
      }
    } else throw Error('Expected stamp, request, pin or check');
  }
}
