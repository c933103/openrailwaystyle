// Detect a complete, selected extract whose OSM watermark actually advanced.
// A new branch commit alone is not enough: assembly can republish the same input.
import {appendFile, readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {checkMarker, extractBranch, parseConfig, parseFile, settings, SOURCES_FILE} from './data-source.mjs';

export async function selectedWatermarks(chosen, readMarker) {
  const selected = Object.entries(chosen).filter(([, value]) => value.source === 'extract');
  return Object.fromEntries(await Promise.all(selected.map(async ([id]) => {
    const marker = await readMarker(extractBranch(id));
    return [id, marker !== null && !checkMarker(marker, id) ? JSON.parse(marker).osmTimestamp : null];
  })));
}

export function advancedWatermarks(previous, current) {
  // An absent/incomplete previous snapshot can first become selected. A
  // shrinking or unchanged timestamp must not trigger a new deployment.
  return Object.entries(current).flatMap(([id, after]) => {
    if (typeof after !== 'string' || !Number.isFinite(Date.parse(after))) return [];
    const before = previous[id] ?? null;
    return before === null || Date.parse(after) > Date.parse(before) ? [{id, before, after}] : [];
  });
}

async function readRemoteMarker(branch) {
  const api = process.env.GITHUB_API_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!api || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || !token) throw new Error('Missing trusted GitHub runner inputs');
  const uri = new URL(api + '/repos/' + repo + '/contents/source.json');
  uri.searchParams.set('ref', branch);
  const response = await fetch(uri, {redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: {Accept: 'application/vnd.github.raw+json', Authorization: 'Bearer ' + token}});
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Cannot read extract marker for ' + branch + ': HTTP ' + response.status);
  return response.text();
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [phase] = process.argv.slice(2);
  // A diagnostic/off-main assembly can build and report but may not hand off.
  if (process.env.GITHUB_REF !== 'refs/heads/main' || !process.env.GITHUB_OUTPUT)
    throw new Error('The extract Pages handoff runs only on main in GitHub Actions');
  if (phase !== 'before' && phase !== 'after') throw new Error('Expected before or after');
  const chosen = settings(parseFile(await readFile(SOURCES_FILE, 'utf8')), parseConfig(process.env.DATA_SOURCES));
  const current = await selectedWatermarks(chosen, readRemoteMarker);
  if (phase === 'before') {
    await appendFile(process.env.GITHUB_OUTPUT, 'watermarks=' + JSON.stringify(current) + '\n');
  } else {
    // Require a valid saved baseline: a missing step output is not fresh data.
    const prior = JSON.parse(process.env.PREVIOUS_WATERMARKS ?? '');
    if (!prior || typeof prior !== 'object' || Array.isArray(prior)) throw new Error('Invalid saved extract watermarks');
    const advanced = advancedWatermarks(prior, current);
    await appendFile(process.env.GITHUB_OUTPUT, 'deploy=' + (advanced.length > 0) + '\n');
    const summary = advanced.length ? 'Advanced selected extracts: ' +
      advanced.map(({id, before, after}) => id + ' ' + (before ?? '(not complete)') + ' → ' + after).join(', ') :
      'No complete selected extract advanced; no Pages rebuild requested.';
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
    console.log(summary);
  }
}
