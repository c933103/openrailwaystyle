// Requested refresh: forget the cached Overpass responses downloaded in full
// longest ago so this run fetches them again. Only about REFRESH_BYTES of raw
// responses are replaced per run, so the whole world is renewed over several
// runs while each run stays far below the public Overpass server's fair-use
// volume.
import {readdir, stat, rename, open} from 'node:fs/promises';
const dir = '.snapshot-cache';
const budget = Number(process.env.REFRESH_BYTES || 100_000_000);
const minAge = Number(process.env.REFRESH_MIN_AGE_DAYS || 6) * 86_400_000;
// When a region was last downloaded in full: build-snapshot.mjs writes it
// first in the file. Change updates rewrite the file every run, so its
// modification time says nothing about that. A response saved before the
// time was recorded counts as the oldest.
async function fetched(path) {
  const handle = await open(path);
  try {
    const {buffer, bytesRead} = await handle.read(Buffer.alloc(64), 0, 64, 0);
    const time = /^\{"fetched":"([^"]+)"/.exec(buffer.subarray(0, bytesRead).toString('utf8'))?.[1];
    return Number.isFinite(Date.parse(time)) ? Date.parse(time) : 0;
  } finally { await handle.close(); }
}
const files = [];
for (const name of await readdir(dir).catch(() => [])) {
  // Region responses only: keep split decisions, download budgets and the
  // weekly change log.
  if (!name.endsWith('.json') || name.startsWith('budget-') || name === 'delta.json') continue;
  // A failed replacement may have restored an older release-cache file at
  // this name. Keep the pending source intact until the builder reconciles
  // a complete replacement; never rename over an existing .previous.
  try { await stat(`${dir}/${name}.previous`); continue; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const info = await stat(`${dir}/${name}`);
  files.push({name, size: info.size, fetched: await fetched(`${dir}/${name}`)});
}
files.sort((a, b) => a.fetched - b.fetched);
let removed = 0;
for (const file of files) {
  if (removed >= budget || Date.now() - file.fetched < minAge) break;
  // Kept until the new download's differences are logged (build-snapshot.mjs).
  await rename(`${dir}/${file.name}`, `${dir}/${file.name}.previous`);
  removed += file.size;
  console.log('Refreshing', file.name, file.fetched ? new Date(file.fetched).toISOString().slice(0, 10) : 'before download times were recorded', file.size);
}
console.log(`Cached regions: ${files.length}; refreshing ${(removed / 1e6).toFixed(0)} MB of the oldest responses`);
