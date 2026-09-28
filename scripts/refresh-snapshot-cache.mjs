// Scheduled refresh: forget the oldest cached Overpass responses so this run
// fetches them again. Only about REFRESH_BYTES of raw responses are replaced
// per run, so the whole world is renewed over several runs while each run
// stays far below the public Overpass server's fair-use volume.
import {readdir, stat, unlink} from 'node:fs/promises';
const dir = '.snapshot-cache';
const budget = Number(process.env.REFRESH_BYTES || 100_000_000);
const minAge = Number(process.env.REFRESH_MIN_AGE_DAYS || 6) * 86_400_000;
const files = [];
for (const name of await readdir(dir).catch(() => [])) {
  // Region responses only: keep split decisions, download budgets and the
  // weekly change log.
  if (!name.endsWith('.json') || name.startsWith('budget-') || name === 'delta.json') continue;
  const info = await stat(`${dir}/${name}`);
  files.push({name, size: info.size, mtime: info.mtimeMs});
}
files.sort((a, b) => a.mtime - b.mtime);
let removed = 0;
for (const file of files) {
  if (removed >= budget || Date.now() - file.mtime < minAge) break;
  await unlink(`${dir}/${file.name}`);
  removed += file.size;
  console.log('Refreshing', file.name, new Date(file.mtime).toISOString().slice(0, 10), file.size);
}
console.log(`Cached regions: ${files.length}; refreshing ${(removed / 1e6).toFixed(0)} MB of the oldest responses`);
