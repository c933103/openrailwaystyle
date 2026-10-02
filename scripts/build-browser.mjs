import {build} from 'esbuild';
import {mkdir,copyFile,readFile} from 'node:fs/promises';
// Embedded in the cached code bundle: never fetch the current remote HEAD.
const commit=process.env.GITHUB_SHA || '';
if(commit && !/^[a-f0-9]{40}$/i.test(commit))throw new Error('Invalid build commit');
const app=await readFile('styles/app.mjs','utf8');
const version=/const assetVersion[^\n]+\|\| '([^']+)'/.exec(app)?.[1];
if(!version)throw new Error('Missing application asset version');
const buildInfo={version,commit:commit.toLowerCase()};
await mkdir('styles/vendor',{recursive:true});
await build({entryPoints:['styles/track-worker.mjs'],outfile:'styles/vendor/track-worker.js',bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
await build({entryPoints:['styles/tile-labels.mjs'],outfile:'styles/vendor/tile-labels.js',define:{__ATLAS_BUILD_INFO__:JSON.stringify(buildInfo)},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
await build({entryPoints:['styles/dem-worker.mjs'],outfile:'styles/vendor/dem-worker.js',bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
await build({entryPoints:['styles/polar-layer.mjs'],outfile:'styles/vendor/polar-layer.js',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
await copyFile('node_modules/earcut/LICENSE','styles/vendor/earcut-LICENSE.txt');
await copyFile('node_modules/maplibre-contour/dist/index.min.js','styles/vendor/maplibre-contour.js');
await copyFile('node_modules/maplibre-contour/LICENSE','styles/vendor/maplibre-contour-LICENSE.txt');
for (const [source,target] of [['@mapbox/point-geometry/LICENSE','point-geometry-LICENSE.txt'],['ieee754/LICENSE','ieee754-LICENSE.txt'],['vt-pbf/LICENSE','vt-pbf-LICENSE.txt'],['pbf/LICENSE','pbf-LICENSE.txt'],['@mapbox/vector-tile/LICENSE.txt','vector-tile-LICENSE.txt']]) await copyFile(`node_modules/${source}`,`styles/vendor/${target}`);
