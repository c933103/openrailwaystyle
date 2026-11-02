// The size of the site that GitHub Pages will publish. GitHub limits a
// published Pages site to 1 GB ("GitHub Pages limits" in GitHub's docs), and
// nothing else checks the total, so a growing dataset would only show up as a
// failed deployment. This runs on the assembled `styles/` directory before it
// is uploaded (site.yml):
//   node scripts/check-site-size.mjs [directory]
// It prints the total and a breakdown (each `data/<dataset>` directory, then
// the rest of the site), writes the same table to the step summary, warns
// above WARN_BYTES and fails above LIMIT_BYTES, leaving 100 MiB of the limit
// for what the deploy job adds and for a margin.
// Hidden entries (names starting with '.') are skipped: the site artifact
// leaves them out, so they are never published. Symbolic links are not
// followed: they are counted as links, not as their targets.
import {lstat, readdir, appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const MiB = 1024 * 1024;
export const WARN_BYTES = 750 * MiB;
export const LIMIT_BYTES = 900 * MiB;

async function sizeOf(path) {
  const stats = await lstat(path);
  if (!stats.isDirectory()) return {bytes: stats.size, files: 1};
  let bytes = 0, files = 0;
  for (const entry of await readdir(path)) {
    if (entry.startsWith('.')) continue;
    const part = await sizeOf(join(path, entry));
    bytes += part.bytes; files += part.files;
  }
  return {bytes, files};
}

// Each data directory separately, everything else as one "rest of the site"
// row, largest first.
export async function measureSite(root) {
  const rows = [];
  let restBytes = 0, restFiles = 0;
  for (const entry of await readdir(root)) {
    if (entry.startsWith('.')) continue;
    const path = join(root, entry);
    const stats = await lstat(path);
    if (entry === 'data' && stats.isDirectory()) {
      for (const dataset of await readdir(path)) {
        if (dataset.startsWith('.')) continue;
        rows.push({name: `data/${dataset}`, ...await sizeOf(join(path, dataset))});
      }
    } else {
      const part = await sizeOf(path);
      restBytes += part.bytes; restFiles += part.files;
    }
  }
  rows.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
  rows.push({name: 'rest of the site', bytes: restBytes, files: restFiles});
  return {total: rows.reduce((sum, row) => sum + row.bytes, 0), rows};
}

export function siteSizeVerdict(total) {
  if (total > LIMIT_BYTES) return 'fail';
  if (total > WARN_BYTES) return 'warn';
  return 'pass';
}

const mib = bytes => (bytes / MiB).toFixed(1);

export function siteSizeReport({total, rows}) {
  const lines = [
    `Site size: ${mib(total)} MiB (warning above ${mib(WARN_BYTES)} MiB, failure above ${mib(LIMIT_BYTES)} MiB; GitHub Pages limit 1 GB)`,
    '',
    '| Part | MiB | Files |',
    '| --- | ---: | ---: |',
    ...rows.map(row => `| ${row.name} | ${mib(row.bytes)} | ${row.files} |`),
  ];
  return `${lines.join('\n')}\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const root = process.argv[2] || 'styles';
  const measured = await measureSite(root);
  const report = siteSizeReport(measured);
  process.stdout.write(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  const verdict = siteSizeVerdict(measured.total);
  if (verdict === 'fail') {
    console.log(`::error::The site is ${mib(measured.total)} MiB, above the ${mib(LIMIT_BYTES)} MiB limit kept under GitHub Pages' 1 GB`);
    process.exitCode = 1;
  } else if (verdict === 'warn') {
    console.log(`::warning::The site is ${mib(measured.total)} MiB, above the ${mib(WARN_BYTES)} MiB warning level`);
  }
}
