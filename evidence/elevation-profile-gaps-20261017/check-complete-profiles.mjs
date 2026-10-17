import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root = path => pathToFileURL(resolve(path) + '/styles/elevation.mjs');
const before = await import(root(process.argv[2])), after = await import(root(process.argv[3]));
let seed = 17012026;
const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
for (let example = 0; example < 500; example++) {
  const count = 2 + Math.floor(random() * 199), km = .001 + random() * 10;
  const profile = Array.from({length: count}, (_, i) => ({at: i * km / (count - 1), height: (random() - .5) * 2000}));
  assert.deepEqual(after.profileStats(profile), before.profileStats(profile));
}
console.log(JSON.stringify({completeProfilesCompared: 500, exactSummaryMatches: 500, randomSeed: 17012026, exclusions: 'zero-length profiles explicitly change to unknown gradient; incomplete profiles intentionally change'}, null, 2));
