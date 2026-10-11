import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';
import assert from 'node:assert/strict';
import {BROWSER_LIBRARIES} from './browser-libraries.mjs';
import {backportMapLibre524} from '../styles/map-controls.mjs';
import {verifyMapLibreBackportSource} from './maplibre-backport.mjs';
// Embedded in the cached code bundle: never fetch the current remote HEAD.
const commit=process.env.GITHUB_SHA || '';
if(commit && !/^[a-f0-9]{40}$/i.test(commit))throw new Error('Invalid build commit');
const app=await readFile('styles/app.mjs','utf8');
const version=/const assetVersion[^\n]+\|\| '([^']+)'/.exec(app)?.[1];
if(!version)throw new Error('Missing application asset version');
const repository=process.env.GITHUB_REPOSITORY || '';
if(repository && !/^[\w.-]+\/[\w.-]+$/.test(repository))throw new Error('Invalid build repository');
const server=new URL(process.env.GITHUB_SERVER_URL || 'https://github.com');
if(!['https:','http:'].includes(server.protocol) || server.username || server.password)throw new Error('Invalid build server');
const sourceUrl=commit && repository ? `${server.href.replace(/\/$/,'')}/${repository}/commit/${commit.toLowerCase()}` : '';
const buildInfo={version,commit:commit.toLowerCase(),sourceUrl};
await mkdir('styles/vendor',{recursive:true});
for (const library of BROWSER_LIBRARIES) {
  const root = `node_modules/${library.package}`;
  const installed = JSON.parse(await readFile(`${root}/package.json`, 'utf8'));
  assert.equal(installed.version, library.version, `${library.package}: browser URL must pin its installed version`);
  const source = `${root}/${library.source}`;
  let bytes = await readFile(source);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), library.sourceSha256 || library.sha256,
    `${library.package}: immutable browser URL must contain the pinned distribution`);
  if (library.sourceSha256) {
    await verifyMapLibreBackportSource(root);
    bytes = await backportMapLibre524(bytes, webcrypto.subtle);
  }
  assert.equal(createHash('sha256').update(bytes).digest('hex'), library.sha256);
  await writeFile(`styles/${library.target}`, bytes);
}
await copyFile('node_modules/maplibre-gl/LICENSE.txt','styles/vendor/maplibre-gl-5.24.0-LICENSE.txt');
await copyFile('scripts/licenses/pmtiles-4.2.1-LICENSE.txt','styles/vendor/pmtiles-4.2.1-LICENSE.txt');
await copyFile('scripts/licenses/fflate-0.8.2-LICENSE.txt','styles/vendor/fflate-0.8.2-LICENSE.txt');
await build({entryPoints:['styles/track-worker.mjs'],outfile:'styles/vendor/track-worker.js',bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
await build({entryPoints:['styles/tile-labels.mjs'],outfile:'styles/vendor/tile-labels.js',define:{__ATLAS_BUILD_INFO__:JSON.stringify(buildInfo)},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
await build({entryPoints:['styles/depth-worker.mjs'],outfile:'styles/vendor/depth-worker.js',bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
await build({entryPoints:['styles/dem-worker.mjs'],outfile:'styles/vendor/dem-worker.js',bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
await build({entryPoints:['styles/polar-layer.mjs'],outfile:'styles/vendor/polar-layer.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
await copyFile('node_modules/earcut/LICENSE','styles/vendor/earcut-LICENSE.txt');
await copyFile('node_modules/maplibre-contour/dist/index.min.js','styles/vendor/maplibre-contour.js');
await copyFile('node_modules/maplibre-contour/LICENSE','styles/vendor/maplibre-contour-LICENSE.txt');
for (const [source,target] of [['@mapbox/point-geometry/LICENSE','point-geometry-LICENSE.txt'],['ieee754/LICENSE','ieee754-LICENSE.txt'],['vt-pbf/LICENSE','vt-pbf-LICENSE.txt'],['pbf/LICENSE','pbf-LICENSE.txt'],['@mapbox/vector-tile/LICENSE.txt','vector-tile-LICENSE.txt']]) await copyFile(`node_modules/${source}`,`styles/vendor/${target}`);

// A reused development/deployment directory may contain the old generated
// distribution. Only publish the fixed immutable asset after a successful build.
await rm('styles/vendor/maplibre-gl-5.24.0.js', {force:true});
