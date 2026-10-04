// Refresh icon URLs from their actual bytes without changing the manifest URL,
// app identity, repository path, or any stored user settings.
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const ICON_FILES = ['atlas-icon.svg', 'atlas-icon-192.png', 'atlas-icon-512.png', 'atlas-icon-maskable-512.png', 'atlas-icon-touch-180.png'];
const root = new URL('../', import.meta.url);
export function iconUrl(file) {
  if (!ICON_FILES.includes(file)) throw new Error(`Unknown brand asset: ${file}`);
  const bytes = readFileSync(new URL(`styles/${file}`, root));
  return `${file}?rev=${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`;
}
export function syncBranding({check = false} = {}) {
  const urls = new Map(ICON_FILES.map(file => [file, iconUrl(file)]));
  const pattern = /\b(atlas-icon(?:-(?:192|512|maskable-512|touch-180))?\.(?:png|svg))(?:\?rev=[a-f0-9]+)?(?=["'])/g;
  const changed = [];
  for (const file of ['styles/index.html', 'styles/manifest.webmanifest', 'styles/data-check.html', 'styles/terrain-credits.html']) {
    const path = new URL(file, root), before = readFileSync(path, 'utf8');
    const after = before.replace(pattern, (match, name) => urls.get(name) ?? match);
    if (after === before) continue;
    changed.push(file);
    if (!check) writeFileSync(path, after);
  }
  return changed;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== '--check')) {
    console.error('Usage: node scripts/sync-branding.mjs [--check]');
    process.exitCode = 2;
  } else {
    const check = process.argv.includes('--check'), changed = syncBranding({check});
    for (const file of changed) console.log(`${check ? 'Outdated' : 'Updated'} icon URLs: ${file}`);
    if (check && changed.length) process.exitCode = 1;
  }
}
