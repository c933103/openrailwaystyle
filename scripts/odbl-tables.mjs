// The ODbL download tables, served from the release `odbl-tables` instead of
// the website (#330, A3). The site is limited to 1 GB by GitHub Pages and the
// four tables are about 193 MB of it, while only people who want the raw data
// download them. Each table stays on its data branch, where other workflows
// read it; `odbl-tables.yml` copies it into the release:
//   node scripts/odbl-tables.mjs stage <directory> [previous odbl-tables.json]
// writes each table and `odbl-tables.json` (size, sha256, source branch and
// commit) into the directory, and prints the files that differ from the
// previous manifest, which are the ones to upload.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const RELEASE = 'odbl-tables';
export const TABLES = [
  // Split into 80 MB parts on its branch (snapshot.yml), joined here.
  {file: 'lifecycle.geojson.gz', branch: 'rail-data', parts: 'lifecycle.geojson.gz.part-'},
  {file: 'crossings.tsv.gz', branch: 'crossing-data'},
  {file: 'branch-lines.ndjson.gz', branch: 'branch-data'},
  {file: 'service-routes.ndjson.gz', branch: 'service-data'},
];
export const releaseUrl = (repository, file) => `https://github.com/${repository}/releases/download/${RELEASE}/${file}`;

const git = (args, options = {}) => execFileSync('git', args, {maxBuffer: 1 << 30, ...options});

// The table's bytes from its branch's head commit, or null while the branch
// does not exist yet (`git ls-remote --exit-code` status 2). Any other git
// failure throws.
export function readTable({file, branch, parts}, run = git) {
  try { run(['ls-remote', '--exit-code', '--heads', 'origin', branch], {stdio: 'ignore'}); }
  catch (error) { if (error.status === 2) return null; throw error; }
  run(['fetch', '--depth=1', 'origin', branch], {stdio: 'ignore'});
  const commit = String(run(['rev-parse', 'FETCH_HEAD'])).trim();
  const names = String(run(['ls-tree', '--name-only', 'FETCH_HEAD'])).split('\n').filter(Boolean);
  const chosen = parts ? names.filter(name => name.startsWith(parts)).sort() : names.filter(name => name === file);
  if (!chosen.length) throw new Error(`${branch} has no ${file}`);
  const bytes = Buffer.concat(chosen.map(name => run(['show', `FETCH_HEAD:${name}`])));
  return {bytes, commit};
}

export function describe(table, {bytes, commit}) {
  gunzipSync(bytes); // a broken table is never published
  return {file: table.file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), branch: table.branch, commit};
}

// The files whose content differs from the previous manifest.
export function changed(entries, previous) {
  const before = new Map((previous?.tables || []).map(entry => [entry.file, entry.sha256]));
  return entries.filter(entry => before.get(entry.file) !== entry.sha256).map(entry => entry.file);
}

export async function stage(directory, previous, {read = readTable, now = () => new Date()} = {}) {
  await mkdir(directory, {recursive: true});
  const entries = [], fresh = [];
  for (const table of TABLES) {
    const found = read(table);
    if (!found) {
      // Not published yet: keep whatever the release already has.
      const kept = previous?.tables?.find(entry => entry.file === table.file);
      if (kept) entries.push(kept);
      continue;
    }
    await writeFile(join(directory, table.file), found.bytes);
    const entry = describe(table, found);
    entries.push(entry); fresh.push(entry);
  }
  const manifest = {schema: 1, release: RELEASE, license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors',
    updated: now().toISOString(), tables: entries};
  await writeFile(join(directory, 'odbl-tables.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return {manifest, upload: changed(fresh, previous)};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [command, directory, previousPath] = process.argv.slice(2);
  if (command !== 'stage' || !directory) throw new Error('Usage: odbl-tables.mjs stage <directory> [previous odbl-tables.json]');
  let previous = null;
  if (previousPath) {
    try { previous = JSON.parse(await readFile(previousPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const {upload} = await stage(directory, previous);
  process.stdout.write(upload.map(file => `${file}\n`).join(''));
}
