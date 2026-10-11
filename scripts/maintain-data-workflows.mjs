// Main-only maintenance in the existing service workflow. Retain historical
// runs, but disable removed diagnostic workflows. Refresh the pre-#171 data
// release once; code deployment cannot create its missing section aggregate.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const execute = promisify(execFile);
const obsolete = /^\.github\/workflows\/(?:pr(?:71|73)-[\w-]+|repair-pr73|audit-country-label)\.ya?ml$/;

export function removedDiagnosticWorkflows(workflows, trackedPaths) {
  const tracked = new Set(trackedPaths);
  return workflows.filter(w => w.state === 'active' && Number.isSafeInteger(w.id) && w.id > 0 &&
    obsolete.test(w.path) && !tracked.has(w.path));
}

export async function maintainDataWorkflows({repo, ref, trackedPaths, api, readManifest}) {
  if (ref !== 'refs/heads/main') throw new Error('Data maintenance requires main');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Invalid repository');
  const pages = await api('GET', `repos/${repo}/actions/workflows?per_page=100`, true);
  if (!Array.isArray(pages) || pages.some(p => !Array.isArray(p.workflows))) throw new Error('Invalid workflow inventory');
  const removed = removedDiagnosticWorkflows(pages.flatMap(p => p.workflows), trackedPaths);
  const manifest = await readManifest();
  if (!manifest || manifest.schema !== 3) throw new Error('Invalid published frequency manifest');
  // Presence alone is insufficient: malformed upgrade metadata must block,
  // rather than suppressing the refresh or flooding the production queue.
  if (manifest.applied_profiles && (manifest.applied_profiles.schema !== 1 ||
    manifest.applied_profiles.file !== 'profiles.json.gz' ||
    !/^[a-f0-9]{64}$/.test(manifest.applied_profiles.sha256 || ''))) throw new Error('Invalid aggregate publication metadata');
  let active = [];
  if (!manifest.applied_profiles) {
    const statuses = ['queued', 'in_progress', 'requested', 'waiting', 'pending'];
    const runs = await Promise.all(statuses.map(status => api('GET',
      `repos/${repo}/actions/workflows/service-frequency.yml/runs?status=${status}&per_page=100`, true)));
    if (runs.some(pages => !Array.isArray(pages) || pages.some(p => !Array.isArray(p.workflow_runs)))) throw new Error('Invalid frequency run inventory');
    active = runs.flatMap(pages => pages.flatMap(p => p.workflow_runs)).filter(r => r.head_branch === 'main' &&
      ['schedule', 'workflow_dispatch'].includes(r.event) && r.status !== 'completed');
  }
  for (const w of removed) await api('PUT', `repos/${repo}/actions/workflows/${w.id}/disable`);
  if (!manifest.applied_profiles && !active.length) await api('POST',
    `repos/${repo}/actions/workflows/service-frequency.yml/dispatches`, false, {ref:'main'});
  return {disabled: removed.map(w => w.path), frequency: manifest.applied_profiles ? 'aggregate-present' : active.length ? 'already-running' : 'refresh-dispatched'};
}

async function run() {
  const repo = process.env.GITHUB_REPOSITORY, ref = process.env.GITHUB_REF;
  const api = async (method, endpoint, paginate = false, body) => {
    const args = ['api', '--method', method, endpoint];
    if (paginate) args.push('--paginate','--slurp');
    if (body) for (const [key,value] of Object.entries(body)) args.push('-f',`${key}=${value}`);
    const {stdout} = await execute('gh', args, {maxBuffer:16_000_000, timeout:120_000});
    return stdout.trim() ? JSON.parse(stdout) : null;
  };
  const directory = await mkdtemp(join(tmpdir(),'atlas-frequency-maintenance-'));
  try {
    const trackedPaths = (await readdir('.github/workflows')).map(n => '.github/workflows/'+n);
    const result = await maintainDataWorkflows({repo, ref, trackedPaths, api, readManifest: async () => {
      await execute('gh', ['release','download','service-frequency-data','--repo',repo,'--pattern','manifest.json','--dir',directory], {timeout:120_000});
      return JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
    }});
    console.log(JSON.stringify(result));
  } finally { await rm(directory,{recursive:true,force:true}); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
