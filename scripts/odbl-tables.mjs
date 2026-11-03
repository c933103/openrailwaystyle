// ODbL tables from existing data branches, not new provider acquisitions.
// Stage locally, upload immutable hash-named tables, then commit a complete
// generation by uploading its hash-named manifest last. Published assets are
// never renamed/deleted: old deployments keep their exact download URLs.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const RELEASE = 'odbl-tables';
export const TABLES = [
  {file: 'lifecycle.geojson.gz', branch: 'rail-data', parts: 'lifecycle.geojson.gz.part-'},
  {file: 'crossings.tsv.gz', branch: 'crossing-data'},
  {file: 'branch-lines.ndjson.gz', branch: 'branch-data'},
  {file: 'service-routes.ndjson.gz', branch: 'service-data'},
];
export const releaseUrl = (repository, file) => `https://github.com/${repository}/releases/download/${RELEASE}/${file}`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const assetName = entry => `${entry.sha256}-${entry.file}`;
const manifestPattern = /^[a-f0-9]{64}-odbl-tables\.json$/;
const git = (args, options = {}) => execFileSync('git', args, {maxBuffer: 1 << 30, ...options});

// Status 2 means a branch does not exist; other git errors are not absence.
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
  gunzipSync(bytes);
  const entry = {file: table.file, bytes: bytes.length, sha256: sha256(bytes), branch: table.branch, commit};
  return {...entry, asset: assetName(entry)};
}

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
      const kept = previous?.tables?.find(entry => entry.file === table.file);
      if (kept) entries.push(kept);
      continue;
    }
    const entry = describe(table, found);
    await writeFile(join(directory, table.file), found.bytes);
    entries.push(entry); fresh.push(entry);
  }
  const manifest = {schema: 2, release: RELEASE, license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors',
    updated: now().toISOString(), tables: entries};
  await writeFile(join(directory, 'odbl-tables.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return {manifest, upload: changed(fresh, previous)};
}

export function validateManifest(manifest) {
  if (manifest?.schema !== 2 || manifest.release !== RELEASE || manifest.license !== 'ODbL-1.0' ||
      manifest.attribution !== '© OpenStreetMap contributors' || !Array.isArray(manifest.tables) ||
      manifest.tables.length !== TABLES.length) throw new Error('Incomplete or invalid ODbL manifest');
  for (const table of TABLES) {
    const matches = manifest.tables.filter(entry => entry.file === table.file);
    const entry = matches[0];
    if (matches.length !== 1 || entry.branch !== table.branch || !/^[a-f0-9]{40}$/.test(entry.commit) ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        entry.asset !== assetName(entry)) throw new Error(`Invalid manifest entry: ${table.file}`);
  }
  return manifest;
}

// Only uploaded manifests commit generations. A corrupt newest committed
// generation is an error, not permission to silently select an older one.
export function latestManifest(assets) {
  return assets.filter(asset => asset.state === 'uploaded' && manifestPattern.test(asset.name))
    .sort((a, b) => b.id - a.id)[0] || null;
}

export function verifyAsset(assets, name, bytes, digest) {
  const matches = assets.filter(asset => asset.name === name);
  const asset = matches[0];
  if (matches.length !== 1 || asset.state !== 'uploaded' || asset.size !== bytes || asset.digest !== `sha256:${digest}`)
    throw new Error(`Release asset not verified: ${name}`);
  return asset;
}

export async function currentGeneration(client) {
  const assets = await client.list();
  const pointer = latestManifest(assets);
  if (!pointer) return null;
  if (pointer.size > 64 * 1024) throw new Error('ODbL manifest exceeds 64 KiB');
  const bytes = await client.download(pointer.name);
  verifyAsset(assets, pointer.name, bytes.length, sha256(bytes));
  if (pointer.name !== `${sha256(bytes)}-odbl-tables.json`) throw new Error('Manifest name does not match its bytes');
  const manifest = validateManifest(JSON.parse(bytes));
  for (const entry of manifest.tables) verifyAsset(assets, entry.asset, entry.bytes, entry.sha256);
  return {pointer: pointer.name, manifest};
}

// No clobber, rename or deletion of uploaded assets. A lost successful upload
// response is reconciled by reading authoritative metadata. Only an incomplete
// starter left by a failed upload can be removed on the next attempt.
export async function ensureAsset(client, directory, file, name, bytes, digest) {
  const assets = await client.list();
  const existing = assets.filter(asset => asset.name === name);
  if (existing.length === 1 && existing[0].state === 'starter' && existing[0].size === 0) {
    await client.removeStarter(existing[0].id);
  } else if (existing.length) {
    verifyAsset(assets, name, bytes, digest);
    return;
  }
  const source = await readFile(join(directory, file));
  if (source.length !== bytes || sha256(source) !== digest) throw new Error(`Staged bytes changed: ${file}`);
  await copyFile(join(directory, file), join(directory, name));
  try { await client.upload(join(directory, name)); }
  catch (error) {
    // If the server did commit the upload, do not repeat/delete it.
    try { verifyAsset(await client.list(), name, bytes, digest); }
    catch { throw error; }
  }
  verifyAsset(await client.list(), name, bytes, digest);
}

export async function publish(directory, client, options = {}) {
  const previous = await currentGeneration(client);
  const {manifest, upload} = await stage(directory, previous?.manifest, options);
  validateManifest(manifest); // all four tables before any initial cutover
  if (previous && !upload.length) {
    // The job summary must describe the committed provenance, not the newer
    // branch commits inspected while discovering identical table bytes.
    await writeFile(join(directory, 'odbl-tables.json'), `${JSON.stringify(previous.manifest, null, 2)}\n`);
    return previous;
  }
  for (const entry of manifest.tables)
    await ensureAsset(client, directory, entry.file, entry.asset, entry.bytes, entry.sha256);
  // Existing workflow concurrency serializes publishers. Refuse a detected
  // competing generation rather than overwriting its publication order.
  if ((latestManifest(await client.list())?.name || null) !== (previous?.pointer || null))
    throw new Error('ODbL generation changed during publication; rerun from current data');
  const bytes = await readFile(join(directory, 'odbl-tables.json'));
  const pointer = `${sha256(bytes)}-odbl-tables.json`;
  await ensureAsset(client, directory, 'odbl-tables.json', pointer, bytes.length, sha256(bytes));
  const committed = await currentGeneration(client);
  if (committed?.pointer !== pointer) throw new Error('Concurrent ODbL publication; verify current generation');
  return committed;
}

export function pinLinks(html, repository, {pointer, manifest}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository');
  validateManifest(manifest);
  if (!manifestPattern.test(pointer)) throw new Error('Invalid generation pointer');
  for (const file of ['lifecycle.geojson.gz', 'crossings.tsv.gz']) {
    const entry = manifest.tables.find(table => table.file === file);
    const marker = new RegExp(`data-odbl-table="${file.replaceAll('.', '\\.')}" href="[^"]*"`, 'g');
    if ([...html.matchAll(marker)].length !== 1) throw new Error(`Missing or duplicate download link: ${file}`);
    html = html.replace(marker, `data-odbl-table="${file}" href="${releaseUrl(repository, entry.asset)}"`);
  }
  const marker = /data-odbl-manifest href="[^"]*"/g;
  if ([...html.matchAll(marker)].length !== 1) throw new Error('Missing or duplicate ODbL manifest link');
  return html.replace(marker, `data-odbl-manifest href="${releaseUrl(repository, pointer)}"`);
}

// Only manifests (a few KiB) are downloaded here; GitHub's uploaded-state,
// byte-size and sha256 metadata binds the large assets to the staged bytes.
export function githubClient(repository, directory, run = (args, options = {}) =>
  execFileSync('gh', args, {maxBuffer: 16 * 1024 * 1024, ...options})) {
  const api = path => JSON.parse(run(['api', path]));
  const repo = `repos/${repository}`;
  return {
    list: () => {
      const release = api(`${repo}/releases/tags/${RELEASE}`);
      if (release.draft || release.prerelease) throw new Error('ODbL release is not public and stable');
      return JSON.parse(run(['api', `${repo}/releases/${release.id}/assets?per_page=100`, '--paginate', '--slurp'])).flat();
    },
    download: async name => {
      await mkdir(directory, {recursive: true});
      const path = join(directory, 'downloaded-manifest.json');
      run(['release', 'download', RELEASE, '--repo', repository, '--pattern', name, '--output', path, '--clobber']);
      return readFile(path);
    },
    upload: path => run(['release', 'upload', RELEASE, path, '--repo', repository]),
    removeStarter: id => run(['api', '-X', 'DELETE', `${repo}/releases/assets/${id}`]),
  };
}

export async function pinSite(path, client, repository) {
  const current = await currentGeneration(client);
  if (!current) throw new Error('No complete ODbL generation published; keep the deployed site unchanged');
  const html = pinLinks(await readFile(path, 'utf8'), repository, current);
  await writeFile(path, html);
  return current;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [command, directory, extra] = process.argv.slice(2);
  if (command === 'stage' && directory) {
    let previous = null;
    if (extra) {
      try { previous = JSON.parse(await readFile(extra, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const {upload} = await stage(directory, previous);
    process.stdout.write(upload.map(file => `${file}\n`).join(''));
  } else if (['publish', 'pin'].includes(command) && directory && process.env.GITHUB_REPOSITORY) {
    const repository = process.env.GITHUB_REPOSITORY;
    const client = githubClient(repository, command === 'pin' ? extra : directory);
    const current = command === 'pin' ? await pinSite(directory, client, repository) : await publish(directory, client);
    console.log(`Verified ODbL generation: ${current.pointer}`);
  } else throw new Error('Usage: odbl-tables.mjs stage <dir> [previous] | publish <dir> | pin <index.html> <scratch-dir>');
}
