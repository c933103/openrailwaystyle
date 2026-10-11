// A frequency-workflow repair may dispatch maintenance, but must not query
// Overpass merely because both jobs share one workflow-level push filter.
import {execFileSync} from 'node:child_process';
import {appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const sources = new Set(['scripts/download-stages.mjs','scripts/overpass-errors.mjs',
  'scripts/service-acquisition-trigger.mjs','scripts/build-service-routes.mjs',
  'scripts/service-routes.mjs','scripts/service-geometry.mjs','scripts/service-geometry-health.mjs',
  'scripts/branch-lines.mjs','styles/pbf-utf8.mjs','.github/workflows/service-routes.yml']);
export const needsServiceAcquisition = (event, paths = []) =>
  ['schedule','workflow_dispatch'].includes(event) || event === 'push' && paths.some(path => sources.has(path));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = process.env.EVENT;
  let enabled = needsServiceAcquisition(event);
  if (event === 'push') {
    const before = process.env.BEFORE, head = process.env.GITHUB_SHA;
    if (![before,head].every(sha => /^[a-f0-9]{40}$/.test(sha || ''))) throw new Error('Invalid push boundary');
    if (/^0{40}$/.test(before)) enabled = true;
    else {
      // A push can contain several commits; compare the actual event boundary,
      // not just HEAD's parent. Fetch only the missing immutable boundary.
      try { execFileSync('git',['cat-file','-e',before+'^{commit}'],{stdio:'pipe'}); }
      catch { execFileSync('git',['fetch','--depth=1','origin',before],{stdio:'pipe',timeout:120000}); }
      const paths = execFileSync('git',['diff','--name-only',before,head],{encoding:'utf8',maxBuffer:2_000_000}).trim().split('\n');
      enabled = needsServiceAcquisition(event,paths);
    }
  }
  if (!process.env.GITHUB_OUTPUT) throw new Error('Missing workflow output');
  await appendFile(process.env.GITHUB_OUTPUT,`enabled=${enabled}\n`);
  console.log(enabled ? 'Service acquisition requested' : 'Maintenance only; no service acquisition');
}
